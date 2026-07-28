// API Handler - Shared logic for both Workers and Pages Functions

interface Env {
  DB: D1Database;
  JWT_SECRET: string;
}

interface User {
  id: number; email: string; uuid: string; avatar: string;
  trust_level: number; traffic_limit: number; traffic_used: number;
  traffic_upload: number; traffic_download: number; status: string; created_at: string;
}

// ====== Utilities ======

export function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export function error(message: string, status = 400): Response {
  return json({ error: message }, status);
}

function base64UrlEncode(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function hmacSha256(key: string, data: string): Promise<ArrayBuffer> {
  const enc = new TextEncoder();
  const keyData = enc.encode(key);
  const dataBytes = enc.encode(data);
  const cryptoKey = await crypto.subtle.importKey("raw", keyData, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return crypto.subtle.sign("HMAC", cryptoKey, dataBytes);
}

async function createJWT(payload: Record<string, unknown>, secret: string): Promise<string> {
  const header = { alg: "HS256", typ: "JWT" };
  const now = Math.floor(Date.now() / 1000);
  const fullPayload = { ...payload, iat: now, exp: now + 86400 * 7 };
  const headerB64 = base64UrlEncode(new TextEncoder().encode(JSON.stringify(header)));
  const payloadB64 = base64UrlEncode(new TextEncoder().encode(JSON.stringify(fullPayload)));
  const signature = await hmacSha256(secret, headerB64 + "." + payloadB64);
  return headerB64 + "." + payloadB64 + "." + base64UrlEncode(signature);
}

async function verifyJWT(token: string, secret: string): Promise<Record<string, unknown> | null> {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;
    const [headerB64, payloadB64, sigB64] = parts;
    const expectedSig = await hmacSha256(secret, headerB64 + "." + payloadB64);
    if (base64UrlEncode(expectedSig) !== sigB64) return null;
    const payload = JSON.parse(new TextDecoder().decode(
      Uint8Array.from(atob(payloadB64.replace(/-/g, "+").replace(/_/g, "/")), (c: string) => c.charCodeAt(0))
    ));
    if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch { return null; }
}

function generateUUID(): string {
  return crypto.randomUUID();
}

export async function auth(env: Env, request: Request): Promise<{ userId: number; email: string } | Response> {
  const h = request.headers.get("Authorization");
  if (!h || !h.startsWith("Bearer ")) return error("Unauthorized", 401);
  const token = h.slice(7);
  const payload = await verifyJWT(token, env.JWT_SECRET);
  if (!payload || !payload.sub) return error("Invalid or expired token", 401);
  const user = await env.DB.prepare('SELECT id, email FROM users WHERE id = ? AND status = "active"')
    .bind(payload.sub).first<{ id: number; email: string }>();
  if (!user) return error("User not found or suspended", 401);
  return { userId: user.id, email: user.email };
}

async function hashPassword(password: string): Promise<string> {
  const enc = new TextEncoder();
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const saltHex = Array.from(salt).map(b => b.toString(16).padStart(2, "0")).join("");
  const keyMaterial = await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveBits"]);
  const hash = await crypto.subtle.deriveBits({ name: "PBKDF2", salt, iterations: 100000, hash: "SHA-256" }, keyMaterial, 256);
  const hashHex = Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, "0")).join("");
  return saltHex + ":" + hashHex;
}

async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [saltHex, hashHex] = stored.split(":");
  if (!saltHex || !hashHex) return false;
  const salt = new Uint8Array(saltHex.match(/.{2}/g)!.map(b => parseInt(b, 16)));
  const expected = new Uint8Array(hashHex.match(/.{2}/g)!.map(b => parseInt(b, 16)));
  const enc = new TextEncoder();
  const km = await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveBits"]);
  const hash = await crypto.subtle.deriveBits({ name: "PBKDF2", salt, iterations: 100000, hash: "SHA-256" }, km, 256);
  const hb = new Uint8Array(hash);
  if (hb.length !== expected.length) return false;
  for (let i = 0; i < hb.length; i++) { if (hb[i] !== expected[i]) return false; }
  return true;
}

// ====== Handlers ======

export async function handleRegister(env: Env, body: { email: string; password: string }): Promise<Response> {
  const { email, password } = body;
  if (!email || !password) return error("Email and password are required");
  if (password.length < 6) return error("Password must be at least 6 characters");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return error("Invalid email format");
  const existing = await env.DB.prepare("SELECT id FROM users WHERE email = ?").bind(email).first();
  if (existing) return error("Email already registered");

  const passwordHash = await hashPassword(password);
  const userUUID = generateUUID();
  const result = await env.DB.prepare(
    "INSERT INTO users (email, password_hash, uuid, traffic_limit) VALUES (?, ?, ?, ?)"
  ).bind(email, passwordHash, userUUID, 53687091200).run();
  if (!result.success) return error("Failed to create user", 500);
  const userId = result.meta.last_row_id;

  await env.DB.prepare(
    'INSERT INTO subscriptions (user_id, product_name, traffic_limit, status, end_date) VALUES (?, ?, ?, "active", datetime("now", "+30 days"))'
  ).bind(userId, "50GB 注册赠送", 53687091200).run();

  const token = await createJWT({ sub: userId, email }, env.JWT_SECRET);
  return json({ token, user: { id: userId, email, uuid: userUUID } });
}

export async function handleLogin(env: Env, body: { email: string; password: string }): Promise<Response> {
  const { email, password } = body;
  if (!email || !password) return error("Email and password are required");
  const user = await env.DB.prepare(
    "SELECT id, email, password_hash, uuid, status FROM users WHERE email = ?"
  ).bind(email).first<{ id: number; email: string; password_hash: string; uuid: string; status: string }>();
  if (!user) return error("Invalid email or password", 401);
  if (user.status !== "active") return error("Account is suspended or banned", 403);
  if (!(await verifyPassword(password, user.password_hash))) return error("Invalid email or password", 401);
  const token = await createJWT({ sub: user.id, email: user.email }, env.JWT_SECRET);
  return json({ token, user: { id: user.id, email: user.email, uuid: user.uuid } });
}

export async function handleMe(env: Env, userId: number): Promise<Response> {
  const user = await env.DB.prepare(
    "SELECT id, email, uuid, avatar, trust_level, traffic_limit, traffic_used, traffic_upload, traffic_download, status, created_at FROM users WHERE id = ?"
  ).bind(userId).first<User>();
  if (!user) return error("User not found", 404);
  const sub = await env.DB.prepare(
    'SELECT id, product_name, traffic_limit, status, start_date, end_date FROM subscriptions WHERE user_id = ? AND status = "active" ORDER BY id DESC LIMIT 1'
  ).bind(userId).first();
  return json({ user, subscription: sub || null });
}

export async function handleChangeUUID(env: Env, userId: number): Promise<Response> {
  const newUUID = generateUUID();
  await env.DB.prepare('UPDATE users SET uuid = ?, updated_at = datetime("now") WHERE id = ?').bind(newUUID, userId).run();
  return json({ uuid: newUUID });
}

export async function handleCreateOrder(env: Env, userId: number, body: { package_id: number; order_type: string }): Promise<Response> {
  const { package_id, order_type } = body;
  if (!package_id) return error("Package ID is required");
  const pkg = await env.DB.prepare("SELECT * FROM packages WHERE id = ? AND is_active = 1").bind(package_id)
    .first<{ id: number; name: string; traffic_gb: number; duration_days: number; price_cents: number }>();
  if (!pkg) return error("Package not found");
  const trafficLimit = BigInt(pkg.traffic_gb) * 1073741824n;

  const orderResult = await env.DB.prepare(
    'INSERT INTO orders (user_id, package_id, order_type, amount_cents, status, paid_at) VALUES (?, ?, ?, ?, "paid", datetime("now"))'
  ).bind(userId, package_id, order_type || "purchase", pkg.price_cents).run();
  if (!orderResult.success) return error("Failed to create order", 500);

  const ot = order_type || "purchase";
  if (ot === "renew" || ot === "upgrade") {
    await env.DB.prepare('UPDATE subscriptions SET status = "expired" WHERE user_id = ? AND status = "active"').bind(userId).run();
  }
  await env.DB.prepare(
    'INSERT INTO subscriptions (user_id, package_id, product_name, traffic_limit, status, start_date, end_date) VALUES (?, ?, ?, ?, "active", datetime("now"), datetime("now", "+' + pkg.duration_days + ' days"))'
  ).bind(userId, package_id, pkg.name, Number(trafficLimit)).run();

  if (ot === "upgrade" || ot === "purchase") {
    await env.DB.prepare('UPDATE users SET traffic_limit = ?, updated_at = datetime("now") WHERE id = ?').bind(Number(trafficLimit), userId).run();
  }
  return json({ success: true, order_id: orderResult.meta.last_row_id });
}

export async function handleGetOrders(env: Env, userId: number): Promise<Response> {
  const orders = await env.DB.prepare(
    "SELECT o.*, p.name as package_name FROM orders o LEFT JOIN packages p ON o.package_id = p.id WHERE o.user_id = ? ORDER BY o.created_at DESC LIMIT 20"
  ).bind(userId).all();
  return json(orders.results);
}

export async function handleRedeem(env: Env, userId: number, body: { code: string }): Promise<Response> {
  const { code } = body;
  if (!code) return error("Code is required");
  const redeemCode = await env.DB.prepare("SELECT * FROM redeem_codes WHERE code = ? AND is_used = 0").bind(code)
    .first<{ id: number; package_id: number }>();
  if (!redeemCode) return error("Invalid or used redeem code");
  const pkg = await env.DB.prepare("SELECT * FROM packages WHERE id = ?").bind(redeemCode.package_id)
    .first<{ id: number; name: string; traffic_gb: number; duration_days: number }>();
  if (!pkg) return error("Package not found for this code");
  const trafficLimit = BigInt(pkg.traffic_gb) * 1073741824n;

  await env.DB.prepare('UPDATE redeem_codes SET is_used = 1, used_by = ?, used_at = datetime("now") WHERE id = ?').bind(userId, redeemCode.id).run();
  await env.DB.prepare('UPDATE subscriptions SET status = "expired" WHERE user_id = ? AND status = "active"').bind(userId).run();
  await env.DB.prepare(
    'INSERT INTO subscriptions (user_id, package_id, product_name, traffic_limit, status, start_date, end_date) VALUES (?, ?, ?, ?, "active", datetime("now"), datetime("now", "+' + pkg.duration_days + ' days"))'
  ).bind(userId, pkg.id, pkg.name, Number(trafficLimit)).run();
  await env.DB.prepare('UPDATE users SET traffic_limit = ?, updated_at = datetime("now") WHERE id = ?').bind(Number(trafficLimit), userId).run();
  return json({ success: true, package: pkg.name });
}

export async function handleSubLink(env: Env, token: string, format: string, request: Request): Promise<Response> {
  const user = await env.DB.prepare("SELECT id, uuid, traffic_limit, traffic_used FROM users WHERE uuid = ?")
    .bind(token).first<{ id: number; uuid: string; traffic_limit: number; traffic_used: number }>();
  if (!user) return error("Invalid subscription token", 404);
  const sub = await env.DB.prepare('SELECT id, end_date FROM subscriptions WHERE user_id = ? AND status = "active" ORDER BY id DESC LIMIT 1')
    .bind(user.id).first<{ id: number; end_date: string }>();
  if (!sub) return error("No active subscription", 404);
  const nodes = await env.DB.prepare("SELECT * FROM nodes WHERE is_active = 1 ORDER BY sort_order ASC").all();

  const remaining = Math.max(Number(user.traffic_limit) - Number(user.traffic_used), 0);

  if (format === "clash" || format === "yaml") {
    return generateClashConfig(user, remaining, sub.end_date, nodes.results as any[]);
  }
  return generateV2RayConfig(user, nodes.results as any[]);
}

function generateClashConfig(user: { uuid: string; traffic_limit: number; traffic_used: number }, remaining: number, endDate: string, nodes: any[]): Response {
  let yaml = "# ProxySubscription Config\n";
  yaml += "# Remaining: " + (remaining / 1073741824).toFixed(2) + " GB\n";
  yaml += "# Expires: " + endDate + "\n\n";
  yaml += "port: 7890\n";
  yaml += "socks-port: 7891\n";
  yaml += "allow-lan: false\n";
  yaml += "mode: rule\n";
  yaml += "log-level: info\n\n";
  yaml += "proxies:\n";

  nodes.forEach((n, i) => {
    const name = n.name || "Node-" + (i + 1);
    yaml += "  - name: \"" + name + "\"\n";
    yaml += "    type: vless\n";
    yaml += "    server: " + n.address + "\n";
    yaml += "    port: " + n.port + "\n";
    yaml += "    uuid: " + user.uuid + "\n";
    yaml += "    network: " + (n.network || "ws") + "\n";
    yaml += "    tls: " + (n.security === "tls" ? "true" : "false") + "\n";
    if (n.security === "reality") {
      yaml += "    servername: " + (n.sni || "") + "\n";
      yaml += "    reality-opts:\n";
      yaml += "      public-key: " + (n.public_key || "") + "\n";
      yaml += "      short-id: " + (n.short_id || "") + "\n";
    }
    if (n.network === "ws" && n.path && n.path !== "/") {
      yaml += "    ws-opts:\n";
      yaml += "      path: " + n.path + "\n";
    }
    if (n.flow) yaml += "    flow: " + n.flow + "\n";
    yaml += "\n";
  });

  yaml += "proxy-groups:\n";
  yaml += '  - name: "🚀 自动选择"\n';
  yaml += "    type: url-test\n";
  yaml += "    proxies:\n";
  nodes.forEach((n, i) => { yaml += '      - "' + (n.name || "Node-" + (i + 1)) + '"\n'; });
  yaml += '    url: "http://www.gstatic.com/generate_204"\n';
  yaml += "    interval: 300\n\n";
  yaml += "rules:\n";
  yaml += "  - MATCH,🚀 自动选择\n";

  return new Response(yaml, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Content-Disposition": 'attachment; filename="proxy-config.yaml"',
      "profile-update-interval": "24",
      "subscription-userinfo": "upload=0; download=" + user.traffic_used + "; total=" + user.traffic_limit + "; expire=" + Math.floor(new Date(endDate).getTime() / 1000),
    },
  });
}

function generateV2RayConfig(user: { uuid: string }, nodes: any[]): Response {
  const links = nodes.map(n => {
    const name = encodeURIComponent(n.name);
    const base = "vless://" + user.uuid + "@" + n.address + ":" + n.port;
    const p = new URLSearchParams();
    p.set("type", n.network || "ws");
    p.set("security", n.security || "none");
    p.set("encryption", "none");
    if (n.path && n.path !== "/") p.set("path", n.path);
    if (n.sni) p.set("sni", n.sni);
    if (n.fingerprint) p.set("fp", n.fingerprint);
    if (n.alpn) p.set("alpn", n.alpn);
    if (n.public_key) p.set("pbk", n.public_key);
    if (n.short_id) p.set("sid", n.short_id);
    if (n.flow) p.set("flow", n.flow);
    p.set("headerType", "none");
    return base + "?" + p.toString() + "#" + name;
  });
  return new Response(links.join("\n"), {
    headers: { "Content-Type": "text/plain; charset=utf-8", "Content-Disposition": 'attachment; filename="proxy-links.txt"' },
  });
}

export async function handleAdminUsers(env: Env): Promise<Response> {
  const users = await env.DB.prepare("SELECT id, email, uuid, trust_level, traffic_limit, traffic_used, status, created_at FROM users ORDER BY id DESC LIMIT 50").all();
  return json(users.results);
}
export async function handleAdminPackages(env: Env): Promise<Response> {
  const pkgs = await env.DB.prepare("SELECT * FROM packages ORDER BY sort_order ASC").all();
  return json(pkgs.results);
}
export async function handleAdminNodes(env: Env): Promise<Response> {
  const nodes = await env.DB.prepare("SELECT * FROM nodes ORDER BY sort_order ASC").all();
  return json(nodes.results);
}
export async function handleAdminStats(env: Env): Promise<Response> {
  const tu = await env.DB.prepare("SELECT COUNT(*) as count FROM users").first<{ count: number }>();
  const as = await env.DB.prepare('SELECT COUNT(*) as count FROM subscriptions WHERE status = "active"').first<{ count: number }>();
  const to = await env.DB.prepare('SELECT COUNT(*) as count FROM orders WHERE status = "paid"').first<{ count: number }>();
  const tr = await env.DB.prepare('SELECT COALESCE(SUM(amount_cents), 0) as total FROM orders WHERE status = "paid"').first<{ total: number }>();
  return json({ totalUsers: tu?.count || 0, activeSubscriptions: as?.count || 0, totalOrders: to?.count || 0, totalRevenue: tr?.total || 0 });
}

// ====== Main request router ======
export async function handleRequest(request: Request, env: Env, path: string): Promise<Response> {
  try {
    if (path === "/api/auth/register" && request.method === "POST") {
      return handleRegister(env, await request.json() as any);
    }
    if (path === "/api/auth/login" && request.method === "POST") {
      return handleLogin(env, await request.json() as any);
    }
    if (path.startsWith("/sub/") && request.method === "GET") {
      const parts = path.split("/");
      return handleSubLink(env, parts[2], parts[3] || "clash", request);
    }
    if (path === "/api/me" && request.method === "GET") {
      const r = await auth(env, request); if (r instanceof Response) return r;
      return handleMe(env, r.userId);
    }
    if (path === "/api/me/uuid" && request.method === "PUT") {
      const r = await auth(env, request); if (r instanceof Response) return r;
      return handleChangeUUID(env, r.userId);
    }
    if (path === "/api/orders" && request.method === "POST") {
      const r = await auth(env, request); if (r instanceof Response) return r;
      return handleCreateOrder(env, r.userId, await request.json() as any);
    }
    if (path === "/api/orders" && request.method === "GET") {
      const r = await auth(env, request); if (r instanceof Response) return r;
      return handleGetOrders(env, r.userId);
    }
    if (path === "/api/redeem" && request.method === "POST") {
      const r = await auth(env, request); if (r instanceof Response) return r;
      return handleRedeem(env, r.userId, await request.json() as any);
    }
    if (path === "/api/admin/users" && request.method === "GET") {
      const r = await auth(env, request); if (r instanceof Response) return r;
      return handleAdminUsers(env);
    }
    if (path === "/api/admin/packages" && request.method === "GET") {
      const r = await auth(env, request); if (r instanceof Response) return r;
      return handleAdminPackages(env);
    }
    if (path === "/api/admin/nodes" && request.method === "GET") {
      const r = await auth(env, request); if (r instanceof Response) return r;
      return handleAdminNodes(env);
    }
    if (path === "/api/admin/stats" && request.method === "GET") {
      const r = await auth(env, request); if (r instanceof Response) return r;
      return handleAdminStats(env);
    }
    return error("Not Found", 404);
  } catch (e) {
    console.error("Error:", e);
    return error("Internal Server Error", 500);
  }
}
