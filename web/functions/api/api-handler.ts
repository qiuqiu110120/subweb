import bcrypt from "bcryptjs";

export interface Env {
  DB: D1Database;
  JWT_SECRET: string;
  NODE_API_SECRET?: string;
}

interface SessionUser {
  id: string;
  email: string;
  username: string;
  status: string;
}

interface Product {
  id: string;
  name: string;
  price_cents: number;
  traffic_bytes: number;
  traffic_label: string;
  duration_months: number;
  sort_order: number;
  is_active: number;
}

interface Allocation {
  id: string;
  user_id: string;
  uuid: string;
  sub_token: string;
  quota_bytes: number;
  used_bytes: number;
  product_id: string | null;
  product_name: string;
  claimed_at: number | null;
  expires_at: number | null;
  is_active: number;
  created_at: number;
  updated_at: number;
}

interface NodeRow {
  id: string;
  name: string;
  address: string;
  port: number;
  protocol: string;
  network: string;
  security: string;
  path: string;
  sni: string;
  public_key: string;
  short_id: string;
  fingerprint: string;
  flow: string;
}

const GB = 1024 ** 3;
const REGISTER_QUOTA = 50 * GB;
const CHECKIN_BONUS = 100 * 1024 ** 2;
const TOKEN_TTL_SECONDS = 7 * 24 * 60 * 60;
const ORDER_TTL_SECONDS = 15 * 60;

function json(data: unknown, status = 200, extraHeaders: HeadersInit = {}): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", ...extraHeaders },
  });
}

function apiError(message: string, status = 400, code = "BAD_REQUEST"): Response {
  return json({ error: message, code }, status);
}

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

function randomHex(bytes = 24): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(bytes)), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

function encodeBase64Url(value: Uint8Array): string {
  let binary = "";
  for (const byte of value) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function decodeBase64Url(value: string): Uint8Array {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
  return Uint8Array.from(atob(padded), (char) => char.charCodeAt(0));
}

async function jwtKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

async function createJwt(user: SessionUser, secret: string): Promise<string> {
  const now = nowSeconds();
  const header = encodeBase64Url(new TextEncoder().encode(JSON.stringify({ alg: "HS256", typ: "JWT" })));
  const payload = encodeBase64Url(new TextEncoder().encode(JSON.stringify({
    sub: user.id,
    email: user.email,
    iat: now,
    exp: now + TOKEN_TTL_SECONDS,
  })));
  const signature = await crypto.subtle.sign("HMAC", await jwtKey(secret), new TextEncoder().encode(`${header}.${payload}`));
  return `${header}.${payload}.${encodeBase64Url(new Uint8Array(signature))}`;
}

async function verifyJwt(token: string, secret: string): Promise<{ sub: string } | null> {
  try {
    const [header, payload, signature, extra] = token.split(".");
    if (!header || !payload || !signature || extra) return null;
    const parsedHeader = JSON.parse(new TextDecoder().decode(decodeBase64Url(header)));
    if (parsedHeader.alg !== "HS256" || parsedHeader.typ !== "JWT") return null;
    const valid = await crypto.subtle.verify(
      "HMAC",
      await jwtKey(secret),
      decodeBase64Url(signature),
      new TextEncoder().encode(`${header}.${payload}`),
    );
    if (!valid) return null;
    const parsed = JSON.parse(new TextDecoder().decode(decodeBase64Url(payload)));
    if (typeof parsed.sub !== "string" || typeof parsed.exp !== "number" || parsed.exp <= nowSeconds()) return null;
    return { sub: parsed.sub };
  } catch {
    return null;
  }
}

async function parseBody(request: Request): Promise<Record<string, unknown> | Response> {
  if (!request.headers.get("content-type")?.toLowerCase().includes("application/json")) {
    return apiError("Content-Type 必须为 application/json", 415, "UNSUPPORTED_MEDIA_TYPE");
  }
  try {
    const body = await request.json();
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error();
    return body as Record<string, unknown>;
  } catch {
    return apiError("请求 JSON 无效", 400, "INVALID_JSON");
  }
}

async function authenticate(request: Request, env: Env): Promise<SessionUser | Response> {
  const authorization = request.headers.get("authorization") || "";
  if (!authorization.startsWith("Bearer ")) return apiError("请先登录", 401, "UNAUTHORIZED");
  const payload = await verifyJwt(authorization.slice(7), env.JWT_SECRET);
  if (!payload) return apiError("登录已过期，请重新登录", 401, "INVALID_TOKEN");
  const user = await env.DB.prepare(
    "SELECT id, email, username, status FROM users WHERE id = ?",
  ).bind(payload.sub).first<SessionUser>();
  if (!user || user.status !== "active") return apiError("账号不存在或已停用", 403, "ACCOUNT_DISABLED");
  return user;
}

async function activeAllocation(env: Env, userId: string): Promise<Allocation | null> {
  return env.DB.prepare(
    "SELECT * FROM allocations WHERE user_id = ? AND is_active = 1 ORDER BY created_at DESC LIMIT 1",
  ).bind(userId).first<Allocation>();
}

function addMonths(timestamp: number, months: number): number {
  const date = new Date(timestamp * 1000);
  date.setUTCMonth(date.getUTCMonth() + months);
  return Math.floor(date.getTime() / 1000);
}

function publicProduct(product: Product, amountCents = product.price_cents, available = true, reason = "") {
  return {
    id: product.id,
    name: product.name,
    price_cents: product.price_cents,
    amount_cents: Math.max(0, amountCents),
    traffic_bytes: product.traffic_bytes,
    traffic_label: product.traffic_label,
    duration_months: product.duration_months,
    available,
    reason,
  };
}

async function getProducts(env: Env): Promise<Product[]> {
  const result = await env.DB.prepare(
    "SELECT * FROM products WHERE is_active = 1 ORDER BY sort_order, price_cents, id",
  ).all<Product>();
  return result.results;
}

async function handleRegister(request: Request, env: Env): Promise<Response> {
  const body = await parseBody(request);
  if (body instanceof Response) return body;
  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  const password = typeof body.password === "string" ? body.password : "";
  const username = typeof body.username === "string" ? body.username.trim() : "";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) return apiError("邮箱格式无效");
  if (password.length < 8 || password.length > 72) return apiError("密码长度必须为 8 到 72 个字符");
  if (username.length < 2 || username.length > 32) return apiError("用户名长度必须为 2 到 32 个字符");

  const exists = await env.DB.prepare("SELECT id FROM users WHERE email = ?").bind(email).first();
  if (exists) return apiError("该邮箱已注册", 409, "EMAIL_EXISTS");

  const now = nowSeconds();
  const userId = crypto.randomUUID();
  const allocationId = crypto.randomUUID();
  const uuid = crypto.randomUUID();
  const subToken = randomHex();
  const passwordHash = await bcrypt.hash(password, 10);
  try {
    await env.DB.batch([
      env.DB.prepare(
        "INSERT INTO users (id, email, password_hash, username, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
      ).bind(userId, email, passwordHash, username, now, now),
      env.DB.prepare(
        "INSERT INTO allocations (id, user_id, uuid, sub_token, quota_bytes, product_name, claimed_at, expires_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      ).bind(allocationId, userId, uuid, subToken, REGISTER_QUOTA, "50GB 注册赠送", now, addMonths(now, 1), now, now),
    ]);
  } catch (error) {
    console.error("register failed", error);
    return apiError("注册失败，请稍后重试", 500, "REGISTER_FAILED");
  }
  const user = { id: userId, email, username, status: "active" };
  return json({ token: await createJwt(user, env.JWT_SECRET), user: { id: userId, email, username } }, 201);
}

async function handleLogin(request: Request, env: Env): Promise<Response> {
  const body = await parseBody(request);
  if (body instanceof Response) return body;
  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  const password = typeof body.password === "string" ? body.password : "";
  const user = await env.DB.prepare(
    "SELECT id, email, username, status, password_hash FROM users WHERE email = ?",
  ).bind(email).first<SessionUser & { password_hash: string }>();
  if (!user || !(await bcrypt.compare(password, user.password_hash))) return apiError("邮箱或密码错误", 401, "INVALID_CREDENTIALS");
  if (user.status !== "active") return apiError("账号已停用", 403, "ACCOUNT_DISABLED");
  return json({ token: await createJwt(user, env.JWT_SECRET), user: { id: user.id, email: user.email, username: user.username } });
}

async function handleMe(env: Env, user: SessionUser, request: Request): Promise<Response> {
  const profile = await env.DB.prepare(
    "SELECT id, email, username, avatar_url, trust_level FROM users WHERE id = ?",
  ).bind(user.id).first();
  const allocation = await activeAllocation(env, user.id);
  const products = await getProducts(env);
  const currentProduct = allocation?.product_id ? products.find((product) => product.id === allocation.product_id) : null;
  const now = nowSeconds();
  const quota = allocation?.quota_bytes || 0;
  const used = allocation?.used_bytes || 0;
  const remaining = Math.max(quota - used, 0);
  const expired = Boolean(allocation?.expires_at && allocation.expires_at <= now);
  const exhausted = quota > 0 && used >= quota;
  const usable = Boolean(allocation?.is_active) && !expired && !exhausted;
  const origin = new URL(request.url).origin;
  const links = allocation ? {
    v2ray: `${origin}/sub/${allocation.sub_token}/v2ray`,
    clash: `${origin}/sub/${allocation.sub_token}/clash`,
    quantumult: `${origin}/sub/${allocation.sub_token}/quantumult`,
    loon: `${origin}/sub/${allocation.sub_token}/loon`,
    singbox: `${origin}/sub/${allocation.sub_token}/singbox`,
  } : {};
  const currentPrice = currentProduct?.price_cents || 0;
  const purchaseOptions = products.map((product) => {
    const available = !allocation || product.traffic_bytes > allocation.quota_bytes;
    return publicProduct(product, product.price_cents - currentPrice, available, available ? "" : "仅可升级到更高流量套餐");
  });
  const renewalOptions = products.map((product) => publicProduct(product));
  return json({
    authenticated: true,
    user: profile,
    allocation,
    quota: {
      quota,
      used,
      remaining,
      percent: quota ? Math.round((used / quota) * 10000) / 100 : 0,
      exhausted,
      expired,
    },
    availability: { usable, banned: false },
    purchaseOptions,
    renewalOptions,
    subscriptions: { links },
    config: { products: renewalOptions, statsPollIntervalMs: 10000 },
  });
}

async function replaceAllocation(env: Env, userId: string, product: Product, claimedAt: number, expiresAt: number): Promise<Allocation> {
  const allocation: Allocation = {
    id: crypto.randomUUID(), user_id: userId, uuid: crypto.randomUUID(), sub_token: randomHex(),
    quota_bytes: product.traffic_bytes, used_bytes: 0, product_id: product.id, product_name: product.name,
    claimed_at: claimedAt, expires_at: expiresAt, is_active: 1, created_at: claimedAt, updated_at: claimedAt,
  };
  await env.DB.batch([
    env.DB.prepare("UPDATE allocations SET is_active = 0, updated_at = ? WHERE user_id = ? AND is_active = 1").bind(claimedAt, userId),
    env.DB.prepare(
      "INSERT INTO allocations (id, user_id, uuid, sub_token, quota_bytes, used_bytes, product_id, product_name, claimed_at, expires_at, is_active, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 0, ?, ?, ?, ?, 1, ?, ?)",
    ).bind(allocation.id, userId, allocation.uuid, allocation.sub_token, allocation.quota_bytes, product.id, product.name, claimedAt, expiresAt, claimedAt, claimedAt),
  ]);
  return allocation;
}

async function handleCreateOrder(request: Request, env: Env, user: SessionUser): Promise<Response> {
  const body = await parseBody(request);
  if (body instanceof Response) return body;
  const productId = typeof body.productId === "string" ? body.productId : "";
  const orderType = body.orderType === "renewal" || body.orderType === "upgrade" || body.orderType === "purchase" ? body.orderType : "";
  if (!productId || !orderType) return apiError("productId 和有效的 orderType 为必填项");
  const product = await env.DB.prepare("SELECT * FROM products WHERE id = ? AND is_active = 1").bind(productId).first<Product>();
  if (!product) return apiError("套餐不存在或已下架", 404, "PRODUCT_NOT_FOUND");
  const current = await activeAllocation(env, user.id);
  if (orderType === "upgrade" && current && product.traffic_bytes <= current.quota_bytes) {
    return apiError("升级套餐必须高于当前流量额度", 409, "INVALID_UPGRADE");
  }
  const currentProduct = current?.product_id
    ? await env.DB.prepare("SELECT price_cents FROM products WHERE id = ?").bind(current.product_id).first<{ price_cents: number }>()
    : null;
  const amount = orderType === "upgrade" ? Math.max(0, product.price_cents - (currentProduct?.price_cents || 0)) : product.price_cents;
  const now = nowSeconds();
  const orderId = crypto.randomUUID();
  const baseExpiry = orderType === "renewal" && current?.expires_at && current.expires_at > now ? current.expires_at : now;
  const newExpiry = addMonths(baseExpiry, product.duration_months);
  try {
    await env.DB.prepare(
      "INSERT INTO orders (id, user_id, product_id, order_type, amount_cents, status, payment_url, created_at, paid_at, expires_at) VALUES (?, ?, ?, ?, ?, 'paid', ?, ?, ?, ?)",
    ).bind(orderId, user.id, product.id, orderType, amount, `/api/orders/${orderId}`, now, now, now + ORDER_TTL_SECONDS).run();
    const allocation = await replaceAllocation(env, user.id, product, now, newExpiry);
    return json({ id: orderId, status: "paid", amount_cents: amount, allocation }, 201);
  } catch (error) {
    console.error("order failed", error);
    return apiError("订单处理失败", 500, "ORDER_FAILED");
  }
}

async function handleOrder(env: Env, user: SessionUser, orderId: string): Promise<Response> {
  const order = await env.DB.prepare(
    "SELECT id, product_id, order_type, amount_cents, status, payment_url, created_at, paid_at, expires_at FROM orders WHERE id = ? AND user_id = ?",
  ).bind(orderId, user.id).first();
  return order ? json(order) : apiError("订单不存在", 404, "ORDER_NOT_FOUND");
}

async function handleRedeem(request: Request, env: Env, user: SessionUser): Promise<Response> {
  const body = await parseBody(request);
  if (body instanceof Response) return body;
  const code = typeof body.code === "string" ? body.code.trim().toUpperCase() : "";
  if (!code || code.length > 64) return apiError("请输入有效兑换码");
  const row = await env.DB.prepare(
    "SELECT r.id, r.product_id, p.name, p.price_cents, p.traffic_bytes, p.traffic_label, p.duration_months, p.sort_order, p.is_active FROM redeem_codes r JOIN products p ON p.id = r.product_id WHERE r.code = ? AND r.is_active = 1 AND r.used_by IS NULL",
  ).bind(code).first<{ id: string; product_id: string } & Omit<Product, "id">>();
  if (!row) return apiError("兑换码无效或已使用", 404, "INVALID_REDEEM_CODE");
  const now = nowSeconds();
  const consumed = await env.DB.prepare(
    "UPDATE redeem_codes SET used_by = ?, used_at = ?, is_active = 0 WHERE id = ? AND used_by IS NULL AND is_active = 1",
  ).bind(user.id, now, row.id).run();
  if (!consumed.meta.changes) return apiError("兑换码已被使用", 409, "REDEEM_CODE_USED");
  const product: Product = { id: row.product_id, name: row.name, price_cents: row.price_cents, traffic_bytes: row.traffic_bytes, traffic_label: row.traffic_label, duration_months: row.duration_months, sort_order: row.sort_order, is_active: row.is_active };
  const allocation = await replaceAllocation(env, user.id, product, now, addMonths(now, product.duration_months));
  return json({ success: true, product: publicProduct(product), allocation });
}

async function handleRotateUuid(env: Env, user: SessionUser): Promise<Response> {
  const allocation = await activeAllocation(env, user.id);
  if (!allocation) return apiError("当前没有有效订阅", 404, "NO_ALLOCATION");
  const uuid = crypto.randomUUID();
  const result = await env.DB.prepare("UPDATE allocations SET uuid = ?, updated_at = ? WHERE id = ? AND is_active = 1")
    .bind(uuid, nowSeconds(), allocation.id).run();
  return result.meta.changes ? json({ uuid }) : apiError("UUID 更换失败", 409, "ROTATE_FAILED");
}

async function handleCheckin(env: Env, user: SessionUser): Promise<Response> {
  const allocation = await activeAllocation(env, user.id);
  if (!allocation) return apiError("当前没有有效订阅", 404, "NO_ALLOCATION");
  const date = new Date().toISOString().slice(0, 10);
  const now = nowSeconds();
  try {
    await env.DB.batch([
      env.DB.prepare("INSERT INTO checkins (id, user_id, checkin_date, bonus_bytes, created_at) VALUES (?, ?, ?, ?, ?)")
        .bind(crypto.randomUUID(), user.id, date, CHECKIN_BONUS, now),
      env.DB.prepare("UPDATE allocations SET quota_bytes = quota_bytes + ?, updated_at = ? WHERE id = ? AND is_active = 1")
        .bind(CHECKIN_BONUS, now, allocation.id),
    ]);
    return json({ success: true, bonus_bytes: CHECKIN_BONUS });
  } catch {
    return apiError("今天已经签到", 409, "ALREADY_CHECKED_IN");
  }
}

async function subscriptionContext(env: Env, token: string): Promise<{ user: { username: string }; allocation: Allocation; nodes: NodeRow[] } | Response> {
  const allocation = await env.DB.prepare("SELECT * FROM allocations WHERE sub_token = ? AND is_active = 1").bind(token).first<Allocation>();
  if (!allocation) return apiError("订阅不存在", 404, "SUBSCRIPTION_NOT_FOUND");
  if ((allocation.expires_at && allocation.expires_at <= nowSeconds()) || allocation.used_bytes >= allocation.quota_bytes) {
    return apiError("订阅已到期或流量已用尽", 403, "SUBSCRIPTION_UNAVAILABLE");
  }
  const user = await env.DB.prepare("SELECT username FROM users WHERE id = ? AND status = 'active'").bind(allocation.user_id).first<{ username: string }>();
  if (!user) return apiError("订阅不可用", 403, "SUBSCRIPTION_UNAVAILABLE");
  const result = await env.DB.prepare("SELECT * FROM nodes WHERE is_active = 1 ORDER BY sort_order, name").all<NodeRow>();
  return { user, allocation, nodes: result.results };
}

function nodeUri(node: NodeRow, uuid: string): string {
  const query = new URLSearchParams({ encryption: "none", type: node.network, security: node.security });
  if (node.path && node.path !== "/") query.set("path", node.path);
  if (node.sni) query.set("sni", node.sni);
  if (node.fingerprint) query.set("fp", node.fingerprint);
  if (node.public_key) query.set("pbk", node.public_key);
  if (node.short_id) query.set("sid", node.short_id);
  if (node.flow) query.set("flow", node.flow);
  return `vless://${uuid}@${node.address}:${node.port}?${query}#${encodeURIComponent(node.name)}`;
}

function subscriptionHeaders(allocation: Allocation, contentType: string): HeadersInit {
  return {
    "Content-Type": contentType,
    "Cache-Control": "private, no-store",
    "profile-update-interval": "24",
    "subscription-userinfo": `upload=0; download=${allocation.used_bytes}; total=${allocation.quota_bytes}; expire=${allocation.expires_at || 0}`,
  };
}

function clashConfig(allocation: Allocation, nodes: NodeRow[]): string {
  const names = nodes.map((node) => JSON.stringify(node.name));
  const proxies = nodes.map((node) => {
    const fields = [
      `name: ${JSON.stringify(node.name)}`, `type: ${node.protocol}`, `server: ${JSON.stringify(node.address)}`,
      `port: ${node.port}`, `uuid: ${allocation.uuid}`, "udp: true", `network: ${node.network}`,
      `tls: ${node.security === "tls" || node.security === "reality"}`,
    ];
    if (node.sni) fields.push(`servername: ${JSON.stringify(node.sni)}`);
    if (node.flow) fields.push(`flow: ${node.flow}`);
    if (node.network === "ws") fields.push(`ws-opts: {path: ${JSON.stringify(node.path || "/")}}`);
    if (node.security === "reality") fields.push(`reality-opts: {public-key: ${JSON.stringify(node.public_key)}, short-id: ${JSON.stringify(node.short_id)}}`);
    return `  - {${fields.join(", ")}}`;
  });
  return [
    "mixed-port: 7890", "allow-lan: false", "mode: rule", "log-level: info", "proxies:",
    ...(proxies.length ? proxies : ["  []"]), "proxy-groups:",
    `  - {name: Proxy, type: select, proxies: [${names.join(", ")}]}`, "rules:", "  - MATCH,Proxy", "",
  ].join("\n");
}

function singBoxConfig(allocation: Allocation, nodes: NodeRow[]) {
  const outbounds = nodes.map((node) => ({
    type: node.protocol,
    tag: node.name,
    server: node.address,
    server_port: node.port,
    uuid: allocation.uuid,
    flow: node.flow || undefined,
    tls: node.security === "none" ? undefined : {
      enabled: true,
      server_name: node.sni || node.address,
      utls: { enabled: true, fingerprint: node.fingerprint || "chrome" },
      reality: node.security === "reality" ? { enabled: true, public_key: node.public_key, short_id: node.short_id } : undefined,
    },
    transport: node.network === "ws" ? { type: "ws", path: node.path || "/" } : undefined,
  }));
  return { log: { level: "info" }, inbounds: [{ type: "mixed", tag: "mixed-in", listen: "127.0.0.1", listen_port: 2080 }], outbounds };
}

async function handleSubscription(env: Env, token: string, format: string): Promise<Response> {
  const context = await subscriptionContext(env, token);
  if (context instanceof Response) return context;
  const { allocation, nodes, user } = context;
  if (format === "clash") return new Response(clashConfig(allocation, nodes), { headers: subscriptionHeaders(allocation, "text/yaml; charset=utf-8") });
  if (format === "v2ray") return new Response(JSON.stringify({ version: 1, remarks: user.username, servers: nodes.map((node) => nodeUri(node, allocation.uuid)) }), { headers: subscriptionHeaders(allocation, "application/json; charset=utf-8") });
  if (format === "singbox") return new Response(JSON.stringify(singBoxConfig(allocation, nodes)), { headers: subscriptionHeaders(allocation, "application/json; charset=utf-8") });
  if (format === "loon") return new Response(nodes.map((node) => `${node.name} = vless,${node.address},${node.port},username=${allocation.uuid},transport=${node.network},tls=${node.security !== "none"}`).join("\n"), { headers: subscriptionHeaders(allocation, "text/plain; charset=utf-8") });
  if (format === "quantumult") return new Response(nodes.map((node) => `vless=${node.address}:${node.port}, method=none, password=${allocation.uuid}, obfs=${node.network}, tls-verification=true, tag=${node.name}`).join("\n"), { headers: subscriptionHeaders(allocation, "text/plain; charset=utf-8") });
  return apiError("不支持的订阅格式", 404, "FORMAT_NOT_FOUND");
}

async function handleTraffic(request: Request, env: Env): Promise<Response> {
  if (!env.NODE_API_SECRET || request.headers.get("x-node-secret") !== env.NODE_API_SECRET) return apiError("无权上报流量", 401, "UNAUTHORIZED");
  const body = await parseBody(request);
  if (body instanceof Response) return body;
  const allocationId = typeof body.allocationId === "string" ? body.allocationId : "";
  const uplink = Number(body.uplinkDelta);
  const downlink = Number(body.downlinkDelta);
  if (!allocationId || !Number.isSafeInteger(uplink) || !Number.isSafeInteger(downlink) || uplink < 0 || downlink < 0) return apiError("流量数据无效");
  const allocation = await env.DB.prepare("SELECT id, user_id FROM allocations WHERE id = ? AND is_active = 1").bind(allocationId).first<{ id: string; user_id: string }>();
  if (!allocation) return apiError("订阅分配不存在", 404, "ALLOCATION_NOT_FOUND");
  const now = nowSeconds();
  await env.DB.batch([
    env.DB.prepare("UPDATE allocations SET used_bytes = used_bytes + ?, updated_at = ? WHERE id = ?").bind(uplink + downlink, now, allocation.id),
    env.DB.prepare("INSERT INTO traffic_logs (user_id, allocation_id, uplink_delta, downlink_delta, recorded_at) VALUES (?, ?, ?, ?, ?)").bind(allocation.user_id, allocation.id, uplink, downlink, now),
  ]);
  return json({ success: true });
}

export async function handleRequest(request: Request, env: Env, path = new URL(request.url).pathname): Promise<Response> {
  try {
    if (!env.DB || !env.JWT_SECRET || env.JWT_SECRET.length < 32) {
      return apiError("服务端尚未完成安全配置", 503, "SERVER_NOT_CONFIGURED");
    }
    if (request.method === "GET" && path === "/api/site-info") return json({ name: "ProxySubscription", description: "高速稳定的代理订阅服务平台", registrationEnabled: true });
    if (request.method === "POST" && path === "/api/auth/register") return handleRegister(request, env);
    if (request.method === "POST" && path === "/api/auth/login") return handleLogin(request, env);
    const subMatch = request.method === "GET" ? path.match(/^\/sub\/([a-f0-9]{48})\/([a-z0-9-]+)$/i) : null;
    if (subMatch) return handleSubscription(env, subMatch[1], subMatch[2].toLowerCase());
    if (request.method === "POST" && path === "/api/traffic") return handleTraffic(request, env);

    const user = await authenticate(request, env);
    if (user instanceof Response) return user;
    if (request.method === "GET" && path === "/api/me") return handleMe(env, user, request);
    if (request.method === "POST" && path === "/api/auth/logout") return new Response(null, { status: 204 });
    if (request.method === "POST" && path === "/api/orders") return handleCreateOrder(request, env, user);
    const orderMatch = request.method === "GET" ? path.match(/^\/api\/orders\/([0-9a-f-]{36})$/i) : null;
    if (orderMatch) return handleOrder(env, user, orderMatch[1]);
    if (request.method === "POST" && path === "/api/redeem") return handleRedeem(request, env, user);
    if (request.method === "POST" && path === "/api/rotate-uuid") return handleRotateUuid(env, user);
    if (request.method === "GET" && path === "/api/nodes") {
      const nodes = await env.DB.prepare("SELECT id, name, protocol, network, security FROM nodes WHERE is_active = 1 ORDER BY sort_order, name").all();
      return json(nodes.results);
    }
    if (request.method === "POST" && path === "/api/checkin") return handleCheckin(env, user);
    return apiError("接口不存在", 404, "NOT_FOUND");
  } catch (error) {
    console.error("request failed", error);
    return apiError("服务器内部错误", 500, "INTERNAL_ERROR");
  }
}
