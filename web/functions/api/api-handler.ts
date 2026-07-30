import bcrypt from "bcryptjs";
import {
  handleAdminBootstrap,
  handleAdminRequest,
  handleAdminSetupStatus,
} from "./admin";
import { getSiteSettings } from "./settings";
import {
  encodeBase64Utf8,
  nodeConfig,
  serializeNodeUri,
  type NodeConfig,
  type ProxyNode,
} from "./node-formats";

export interface Env {
  DB: D1Database;
  JWT_SECRET: string;
  NODE_API_SECRET?: string;
  ADMIN_BOOTSTRAP_TOKEN?: string;
}

interface SessionUser {
  id: string;
  email: string;
  username: string;
  status: string;
  role: string;
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

interface NodeRow extends ProxyNode {
  id: string;
}

interface TrafficAllocation {
  id: string;
  user_id: string;
  quota_bytes: number;
  used_bytes: number;
}

interface TrafficCounter {
  uplink_bytes: number;
  downlink_bytes: number;
}

const GB = 1024 ** 3;
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
    "SELECT id, email, username, status, role FROM users WHERE id = ?",
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
  const settings = await getSiteSettings(env.DB);
  if (!settings.registrationEnabled) return apiError("当前站点已关闭新用户注册", 403, "REGISTRATION_DISABLED");
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
  const registrationQuota = Math.round(settings.registrationQuotaGb * GB);
  const passwordHash = await bcrypt.hash(password, 10);
  try {
    await env.DB.batch([
      env.DB.prepare(
        "INSERT INTO users (id, email, password_hash, username, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
      ).bind(userId, email, passwordHash, username, now, now),
      env.DB.prepare(
        "INSERT INTO allocations (id, user_id, uuid, sub_token, quota_bytes, product_name, claimed_at, expires_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      ).bind(allocationId, userId, uuid, subToken, registrationQuota,
        `${settings.registrationQuotaGb}GB 注册赠送`, now, addMonths(now, 1), now, now),
    ]);
  } catch (error) {
    console.error("register failed", error);
    return apiError("注册失败，请稍后重试", 500, "REGISTER_FAILED");
  }
  const user = { id: userId, email, username, status: "active", role: "user" };
  return json({ token: await createJwt(user, env.JWT_SECRET), user: { id: userId, email, username, role: "user" } }, 201);
}

async function handleLogin(request: Request, env: Env): Promise<Response> {
  const body = await parseBody(request);
  if (body instanceof Response) return body;
  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  const password = typeof body.password === "string" ? body.password : "";
  const user = await env.DB.prepare(
    "SELECT id, email, username, status, role, password_hash FROM users WHERE email = ?",
  ).bind(email).first<SessionUser & { password_hash: string }>();
  if (!user || !(await bcrypt.compare(password, user.password_hash))) return apiError("邮箱或密码错误", 401, "INVALID_CREDENTIALS");
  if (user.status !== "active") return apiError("账号已停用", 403, "ACCOUNT_DISABLED");
  return json({ token: await createJwt(user, env.JWT_SECRET), user: { id: user.id, email: user.email, username: user.username, role: user.role } });
}

async function handleMe(env: Env, user: SessionUser, request: Request): Promise<Response> {
  const profile = await env.DB.prepare(
    "SELECT id, email, username, avatar_url, trust_level, role FROM users WHERE id = ?",
  ).bind(user.id).first();
  const allocation = await activeAllocation(env, user.id);
  const products = await getProducts(env);
  const settings = await getSiteSettings(env.DB);
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
    universal: `${origin}/sub/${allocation.sub_token}`,
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
    config: {
      products: renewalOptions,
      siteName: settings.siteName,
      siteDescription: settings.siteDescription,
      statsPollIntervalMs: settings.statsPollIntervalSeconds * 1000,
    },
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
  const settings = await getSiteSettings(env.DB);
  const checkinBonus = settings.checkinBonusMb * 1024 ** 2;
  try {
    await env.DB.batch([
      env.DB.prepare("INSERT INTO checkins (id, user_id, checkin_date, bonus_bytes, created_at) VALUES (?, ?, ?, ?, ?)")
        .bind(crypto.randomUUID(), user.id, date, checkinBonus, now),
      env.DB.prepare("UPDATE allocations SET quota_bytes = quota_bytes + ?, updated_at = ? WHERE id = ? AND is_active = 1")
        .bind(checkinBonus, now, allocation.id),
    ]);
    return json({ success: true, bonus_bytes: checkinBonus });
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

function subscriptionHeaders(allocation: Allocation, contentType: string, filename: string): HeadersInit {
  return {
    "Content-Type": contentType,
    "Content-Disposition": `attachment; filename="${filename}"`,
    "Cache-Control": "private, no-store",
    "profile-update-interval": "24",
    "subscription-userinfo": `upload=0; download=${allocation.used_bytes}; total=${allocation.quota_bytes}; expire=${allocation.expires_at || 0}`,
  };
}

function uniqueNodeNames(nodes: NodeRow[]): NodeRow[] {
  const counts = new Map<string, number>();
  return nodes.map((node) => {
    const count = (counts.get(node.name) || 0) + 1;
    counts.set(node.name, count);
    return count === 1 ? node : { ...node, name: `${node.name} (${count})` };
  });
}

function configString(config: NodeConfig, key: string, fallback = ""): string {
  const value = config[key];
  return typeof value === "string" ? value : value === undefined || value === null ? fallback : String(value);
}

function configNumber(config: NodeConfig, key: string, fallback = 0): number {
  const value = Number(config[key]);
  return Number.isFinite(value) ? value : fallback;
}

function configBoolean(config: NodeConfig, key: string): boolean {
  return config[key] === true || config[key] === 1 || config[key] === "1" || config[key] === "true";
}

function configStrings(config: NodeConfig, key: string): string[] {
  const value = config[key];
  if (Array.isArray(value)) return value.map(String).map((item) => item.trim()).filter(Boolean);
  return configString(config, key).split(",").map((item) => item.trim()).filter(Boolean);
}

function configNumbers(config: NodeConfig, key: string): number[] {
  const value = config[key];
  const values = Array.isArray(value) ? value : configString(config, key).split(",");
  return values.map(Number).filter(Number.isFinite);
}

function yamlValue(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(yamlValue).join(", ")}]`;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return JSON.stringify(value === undefined || value === null ? "" : String(value));
}

function appendClashTransport(lines: string[], node: NodeRow): void {
  if (node.network === "ws") {
    lines.push("    ws-opts:", `      path: ${yamlValue(node.path || "/")}`);
    if (node.host) lines.push("      headers:", `        Host: ${yamlValue(node.host)}`);
  }
  if (node.network === "grpc") {
    lines.push("    grpc-opts:", `      grpc-service-name: ${yamlValue(node.path || "")}`);
  }
  if (node.network === "h2") {
    lines.push("    h2-opts:", `      path: ${yamlValue(node.path || "/")}`);
    if (node.host) lines.push(`      host: [${yamlValue(node.host)}]`);
  }
  if (node.network === "http") {
    lines.push("    http-opts:", `      path: [${yamlValue(node.path || "/")}]`);
    if (node.host) lines.push("      headers:", `        Host: [${yamlValue(node.host)}]`);
  }
  if (node.network === "httpupgrade") {
    lines.push("    http-upgrade-opts:", `      path: ${yamlValue(node.path || "/")}`);
    if (node.host) lines.push("      headers:", `        Host: ${yamlValue(node.host)}`);
  }
}

function appendClashTls(lines: string[], node: NodeRow, config: NodeConfig): void {
  if (node.sni) lines.push(`    ${node.protocol === "vmess" || node.protocol === "vless" ? "servername" : "sni"}: ${yamlValue(node.sni)}`);
  if (configBoolean(config, "allow_insecure")) lines.push("    skip-cert-verify: true");
  const alpn = configStrings(config, "alpn");
  if (alpn.length) lines.push(`    alpn: ${yamlValue(alpn)}`);
  if (node.fingerprint && node.security !== "none") lines.push(`    client-fingerprint: ${yamlValue(node.fingerprint)}`);
  if (node.security === "reality") {
    lines.push("    reality-opts:", `      public-key: ${yamlValue(node.public_key)}`, `      short-id: ${yamlValue(node.short_id)}`);
  }
}

function clashProxy(node: NodeRow, allocation: Allocation): string[] {
  const config = nodeConfig(node);
  const clashType = node.protocol === "shadowsocks" ? "ss" : node.protocol;
  const lines = [
    `  - name: ${yamlValue(node.name)}`,
    `    type: ${clashType}`,
    `    server: ${yamlValue(node.address)}`,
    `    port: ${node.port}`,
  ];
  if (node.protocol === "vmess" || node.protocol === "vless") {
    lines.push(
      `    uuid: ${yamlValue(configString(config, "uuid", allocation.uuid))}`,
      "    udp: true",
      `    network: ${node.network}`,
      `    tls: ${node.security !== "none"}`,
    );
    if (node.protocol === "vmess") {
      lines.push(`    alterId: ${configNumber(config, "alter_id")}`, `    cipher: ${yamlValue(configString(config, "cipher", "auto"))}`);
    }
    if (node.flow) lines.push(`    flow: ${yamlValue(node.flow)}`);
    appendClashTls(lines, node, config);
    appendClashTransport(lines, node);
    return lines;
  }
  if (node.protocol === "shadowsocks") {
    lines.push(`    cipher: ${yamlValue(configString(config, "method"))}`, `    password: ${yamlValue(configString(config, "password"))}`, "    udp: true");
    const plugin = configString(config, "plugin");
    if (plugin) {
      lines.push(`    plugin: ${yamlValue(plugin)}`);
      const options = config.plugin_opts;
      if (options && typeof options === "object" && !Array.isArray(options)) {
        lines.push("    plugin-opts:");
        for (const [key, value] of Object.entries(options)) lines.push(`      ${key}: ${yamlValue(value)}`);
      }
    }
    return lines;
  }
  if (node.protocol === "trojan") {
    lines.push(`    password: ${yamlValue(configString(config, "password", allocation.uuid))}`, "    udp: true", `    network: ${node.network}`);
    appendClashTls(lines, node, config);
    appendClashTransport(lines, node);
    return lines;
  }
  if (node.protocol === "hysteria2") {
    lines.push(`    password: ${yamlValue(configString(config, "password", allocation.uuid))}`);
    appendClashTls(lines, node, config);
    for (const [field, key] of [["obfs", "obfs"], ["obfs-password", "obfs_password"], ["up", "up"], ["down", "down"]] as const) {
      const value = configString(config, key); if (value) lines.push(`    ${field}: ${yamlValue(value)}`);
    }
    return lines;
  }
  if (node.protocol === "tuic") {
    lines.push(
      `    uuid: ${yamlValue(configString(config, "uuid", allocation.uuid))}`,
      `    password: ${yamlValue(configString(config, "password", allocation.uuid))}`,
      `    congestion-controller: ${yamlValue(configString(config, "congestion_control", "bbr"))}`,
      `    udp-relay-mode: ${yamlValue(configString(config, "udp_relay_mode", "native"))}`,
    );
    appendClashTls(lines, node, config);
    if (configBoolean(config, "disable_sni")) lines.push("    disable-sni: true");
    return lines;
  }
  if (node.protocol === "wireguard") {
    const addresses = configStrings(config, "local_address");
    const ipv4 = addresses.find((address) => !address.includes(":"));
    const ipv6 = addresses.find((address) => address.includes(":"));
    lines.push(
      `    private-key: ${yamlValue(configString(config, "private_key"))}`,
      `    public-key: ${yamlValue(configString(config, "peer_public_key"))}`,
      "    udp: true",
    );
    if (ipv4) lines.push(`    ip: ${yamlValue(ipv4)}`);
    if (ipv6) lines.push(`    ipv6: ${yamlValue(ipv6)}`);
    const reserved = configNumbers(config, "reserved");
    if (reserved.length) lines.push(`    reserved: ${yamlValue(reserved)}`);
    const mtu = configNumber(config, "mtu");
    if (mtu) lines.push(`    mtu: ${mtu}`);
    const preSharedKey = configString(config, "pre_shared_key");
    if (preSharedKey) lines.push(`    pre-shared-key: ${yamlValue(preSharedKey)}`);
    return lines;
  }
  if (node.protocol === "socks5") {
    const username = configString(config, "username");
    const password = configString(config, "password");
    if (username) lines.push(`    username: ${yamlValue(username)}`);
    if (password) lines.push(`    password: ${yamlValue(password)}`);
    lines.push(`    udp: ${config.version !== "4" && config.udp !== false}`);
    return lines;
  }
  if (node.protocol === "http") {
    const username = configString(config, "username");
    const password = configString(config, "password");
    if (username) lines.push(`    username: ${yamlValue(username)}`);
    if (password) lines.push(`    password: ${yamlValue(password)}`);
    lines.push(`    tls: ${configBoolean(config, "tls") || node.security !== "none"}`);
    appendClashTls(lines, node, config);
    return lines;
  }
  if (node.protocol === "anytls") {
    lines.push(`    password: ${yamlValue(configString(config, "password", allocation.uuid))}`);
    appendClashTls(lines, node, config);
    for (const field of ["idle_session_check_interval", "idle_session_timeout", "min_idle_session"] as const) {
      const value = config[field]; if (value) lines.push(`    ${field.replace(/_/g, "-")}: ${yamlValue(value)}`);
    }
    return lines;
  }
  if (node.protocol === "naive") {
    const username = configString(config, "username");
    const password = configString(config, "password");
    if (username) lines.push(`    username: ${yamlValue(username)}`);
    if (password) lines.push(`    password: ${yamlValue(password)}`);
    lines.push(`    tls: ${node.security !== "none"}`);
    appendClashTls(lines, node, config);
    return lines;
  }
  return lines;
}

function clashConfig(allocation: Allocation, nodes: NodeRow[]): string {
  const proxies = nodes.flatMap((node) => clashProxy(node, allocation));
  const groupProxies = nodes.length
    ? nodes.map((node) => `      - ${yamlValue(node.name)}`)
    : ["      - DIRECT"];
  return [
    "mixed-port: 7890", "allow-lan: false", "mode: rule", "log-level: info",
    ...(proxies.length ? ["proxies:", ...proxies] : ["proxies: []"]),
    "proxy-groups:", "  - name: Proxy", "    type: select", "    proxies:", ...groupProxies,
    "rules:", "  - MATCH,Proxy", "",
  ].join("\n");
}

function singBoxTls(node: NodeRow, config: NodeConfig): Record<string, unknown> | undefined {
  if (node.security === "none") return undefined;
  const alpn = configStrings(config, "alpn");
  return {
    enabled: true,
    server_name: node.sni || node.address,
    insecure: configBoolean(config, "allow_insecure") || undefined,
    alpn: alpn.length ? alpn : undefined,
    utls: node.fingerprint ? { enabled: true, fingerprint: node.fingerprint } : undefined,
    reality: node.security === "reality"
      ? { enabled: true, public_key: node.public_key, short_id: node.short_id }
      : undefined,
  };
}

function singBoxTransport(node: NodeRow): Record<string, unknown> | undefined {
  if (node.network === "ws") return { type: "ws", path: node.path || "/", headers: node.host ? { Host: node.host } : undefined };
  if (node.network === "grpc") return { type: "grpc", service_name: node.path || "" };
  if (node.network === "httpupgrade") return { type: "httpupgrade", path: node.path || "/", headers: node.host ? { Host: node.host } : undefined };
  if (node.network === "http" || node.network === "h2") return { type: "http", host: node.host ? [node.host] : undefined, path: node.path || "/" };
  return undefined;
}

function singBoxOutbound(node: NodeRow, allocation: Allocation): Record<string, unknown> {
  const config = nodeConfig(node);
  const base = { tag: node.name, server: node.address, server_port: node.port };
  if (node.protocol === "vmess") return {
    ...base, type: "vmess", uuid: configString(config, "uuid", allocation.uuid),
    security: configString(config, "cipher", "auto"), alter_id: configNumber(config, "alter_id"),
    tls: singBoxTls(node, config), transport: singBoxTransport(node),
  };
  if (node.protocol === "vless") return {
    ...base, type: "vless", uuid: configString(config, "uuid", allocation.uuid), flow: node.flow || undefined,
    tls: singBoxTls(node, config), transport: singBoxTransport(node),
  };
  if (node.protocol === "shadowsocks") {
    const pluginOptions = config.plugin_opts && typeof config.plugin_opts === "object" && !Array.isArray(config.plugin_opts)
      ? Object.entries(config.plugin_opts as NodeConfig).map(([key, value]) => value === true ? key : `${key}=${String(value)}`).join(";")
      : "";
    return {
      ...base, type: "shadowsocks", method: configString(config, "method"), password: configString(config, "password"),
      plugin: configString(config, "plugin") || undefined, plugin_opts: pluginOptions || undefined,
    };
  }
  if (node.protocol === "trojan") return {
    ...base, type: "trojan", password: configString(config, "password", allocation.uuid),
    tls: singBoxTls(node, config), transport: singBoxTransport(node),
  };
  if (node.protocol === "hysteria2") return {
    ...base, type: "hysteria2", password: configString(config, "password", allocation.uuid),
    up_mbps: configNumber(config, "up") || undefined, down_mbps: configNumber(config, "down") || undefined,
    obfs: configString(config, "obfs") ? { type: configString(config, "obfs"), password: configString(config, "obfs_password") } : undefined,
    tls: singBoxTls(node, config),
  };
  if (node.protocol === "tuic") return {
    ...base, type: "tuic", uuid: configString(config, "uuid", allocation.uuid), password: configString(config, "password", allocation.uuid),
    congestion_control: configString(config, "congestion_control", "bbr"), udp_relay_mode: configString(config, "udp_relay_mode", "native"),
    tls: singBoxTls(node, config),
  };
  if (node.protocol === "wireguard") return {
    ...base, type: "wireguard", local_address: configStrings(config, "local_address"),
    private_key: configString(config, "private_key"), peer_public_key: configString(config, "peer_public_key"),
    pre_shared_key: configString(config, "pre_shared_key") || undefined, reserved: configNumbers(config, "reserved"),
    mtu: configNumber(config, "mtu", 1420),
  };
  if (node.protocol === "socks5") return {
    ...base, type: "socks", version: configString(config, "version", "5"),
    username: configString(config, "username") || undefined, password: configString(config, "password") || undefined,
  };
  if (node.protocol === "http") return {
    ...base, type: "http", username: configString(config, "username") || undefined,
    password: configString(config, "password") || undefined, tls: singBoxTls(node, config),
  };
  if (node.protocol === "anytls") return {
    ...base, type: "anytls", password: configString(config, "password", allocation.uuid),
    idle_session_check_interval: configString(config, "idle_session_check_interval") || undefined,
    idle_session_timeout: configString(config, "idle_session_timeout") || undefined,
    min_idle_session: configNumber(config, "min_idle_session") || undefined, tls: singBoxTls(node, config),
  };
  if (node.protocol === "naive") return {
    ...base, type: "naive", username: configString(config, "username") || undefined,
    password: configString(config, "password") || undefined, network: configString(config, "protocol", "https"),
    tls: singBoxTls(node, config),
  };
  return { ...base, type: node.protocol };
}

function singBoxConfig(allocation: Allocation, nodes: NodeRow[]) {
  const nodeOutbounds = nodes.map((node) => singBoxOutbound(node, allocation));
  const nodeTags = nodeOutbounds.map((outbound) => outbound.tag);
  const outbounds = nodeTags.length
    ? [{ type: "selector", tag: "Proxy", outbounds: nodeTags }, ...nodeOutbounds]
    : [{ type: "direct", tag: "Proxy" }];
  return {
    log: { level: "info" },
    inbounds: [{ type: "mixed", tag: "mixed-in", listen: "127.0.0.1", listen_port: 2080 }],
    outbounds,
    route: { auto_detect_interface: true, final: "Proxy" },
  };
}

async function handleSubscription(env: Env, token: string, format: string): Promise<Response> {
  const context = await subscriptionContext(env, token);
  if (context instanceof Response) return context;
  const { allocation } = context;
  const nodes = uniqueNodeNames(context.nodes);
  if (format === "clash") return new Response(clashConfig(allocation, nodes), { headers: subscriptionHeaders(allocation, "text/yaml; charset=utf-8", "clash.yaml") });
  if (format === "v2ray") {
    const subscription = nodes.map((node) => serializeNodeUri(node, allocation.uuid)).join("\n");
    return new Response(encodeBase64Utf8(subscription), { headers: subscriptionHeaders(allocation, "text/plain; charset=utf-8", "v2ray.txt") });
  }
  if (format === "singbox") return new Response(JSON.stringify(singBoxConfig(allocation, nodes)), { headers: subscriptionHeaders(allocation, "application/json; charset=utf-8", "sing-box.json") });
  if (format === "loon" || format === "quantumult") {
    const subscription = nodes.map((node) => serializeNodeUri(node, allocation.uuid)).join("\n");
    return new Response(subscription, { headers: subscriptionHeaders(allocation, "text/plain; charset=utf-8", `${format}.conf`) });
  }
  return apiError("不支持的订阅格式", 404, "FORMAT_NOT_FOUND");
}

function detectSubscriptionFormat(request: Request, explicitFormat?: string): string {
  const requested = explicitFormat || new URL(request.url).searchParams.get("target") || "";
  const normalized = requested.toLowerCase().replace(/[^a-z0-9]/g, "");
  if (["clash", "clashmeta", "mihomo", "stash"].includes(normalized)) return "clash";
  if (["singbox", "nekobox"].includes(normalized)) return "singbox";
  if (normalized === "quantumult" || normalized === "quantumultx") return "quantumult";
  if (normalized === "loon") return "loon";
  if (normalized === "v2ray" || normalized === "v2rayn" || normalized === "shadowrocket") return "v2ray";
  if (explicitFormat || requested) return requested.toLowerCase();
  const userAgent = (request.headers.get("user-agent") || "").toLowerCase();
  if (/clash|mihomo|stash/.test(userAgent)) return "clash";
  if (/sing-?box|nekobox/.test(userAgent)) return "singbox";
  if (userAgent.includes("quantumult")) return "quantumult";
  if (userAgent.includes("loon")) return "loon";
  return "v2ray";
}

function trafficString(body: Record<string, unknown>, ...keys: string[]): string {
  for (const key of keys) {
    if (typeof body[key] === "string" && String(body[key]).trim()) return String(body[key]).trim();
  }
  return "";
}

function trafficInteger(body: Record<string, unknown>, keys: string[]): { found: boolean; value: number } {
  for (const key of keys) {
    if (!Object.prototype.hasOwnProperty.call(body, key)) continue;
    const raw = body[key];
    if (typeof raw !== "number" && typeof raw !== "string") return { found: true, value: Number.NaN };
    if (typeof raw === "string" && !raw.trim()) return { found: true, value: Number.NaN };
    return { found: true, value: Number(raw) };
  }
  return { found: false, value: 0 };
}

async function trafficAllocation(env: Env, body: Record<string, unknown>): Promise<TrafficAllocation | null> {
  const fields = "a.id, a.user_id, a.quota_bytes, a.used_bytes";
  const allocationId = trafficString(body, "allocationId", "allocation_id");
  if (allocationId) {
    return env.DB.prepare(`SELECT ${fields} FROM allocations a WHERE a.id = ? AND a.is_active = 1`)
      .bind(allocationId).first<TrafficAllocation>();
  }
  const uuid = trafficString(body, "uuid", "userUuid", "user_uuid");
  if (uuid) {
    return env.DB.prepare(`SELECT ${fields} FROM allocations a WHERE a.uuid = ? COLLATE NOCASE AND a.is_active = 1`)
      .bind(uuid).first<TrafficAllocation>();
  }
  const subToken = trafficString(body, "subToken", "sub_token", "subscriptionToken", "subscription_token");
  if (subToken) {
    return env.DB.prepare(`SELECT ${fields} FROM allocations a WHERE a.sub_token = ? AND a.is_active = 1`)
      .bind(subToken).first<TrafficAllocation>();
  }
  const email = trafficString(body, "email", "userEmail", "user_email");
  if (email) {
    return env.DB.prepare(`SELECT ${fields} FROM allocations a JOIN users u ON u.id = a.user_id WHERE u.email = ? COLLATE NOCASE AND a.is_active = 1`)
      .bind(email).first<TrafficAllocation>();
  }
  const identifier = trafficString(body, "identifier", "user");
  if (!identifier) return null;
  return env.DB.prepare(`SELECT ${fields} FROM allocations a JOIN users u ON u.id = a.user_id
    WHERE a.is_active = 1 AND (a.id = ? OR a.uuid = ? COLLATE NOCASE OR a.sub_token = ? OR u.email = ? COLLATE NOCASE)
    ORDER BY a.created_at DESC LIMIT 1`)
    .bind(identifier, identifier, identifier, identifier).first<TrafficAllocation>();
}

function trafficValues(body: Record<string, unknown>): { mode: "delta" | "total"; uplink: number; downlink: number } | null {
  const explicitUplinkDelta = trafficInteger(body, ["uplinkDelta", "uplink_delta", "uploadDelta", "upload_delta"]);
  const explicitDownlinkDelta = trafficInteger(body, ["downlinkDelta", "downlink_delta", "downloadDelta", "download_delta"]);
  const explicitUsedDelta = trafficInteger(body, ["usedTrafficDelta", "used_traffic_delta"]);
  const explicitUplinkTotal = trafficInteger(body, ["uplinkTotal", "uplink_total", "uploadTotal", "upload_total"]);
  const explicitDownlinkTotal = trafficInteger(body, ["downlinkTotal", "downlink_total", "downloadTotal", "download_total"]);
  const explicitUsedTotal = trafficInteger(body, ["usedTrafficTotal", "used_traffic_total"]);
  const genericUplink = trafficInteger(body, ["uplink", "upload", "up"]);
  const genericDownlink = trafficInteger(body, ["downlink", "download", "down"]);
  const genericUsed = trafficInteger(body, ["usedTraffic", "used_traffic"]);
  const requestedMode = trafficString(body, "mode").toLowerCase();
  const hasExplicitTotal = explicitUplinkTotal.found || explicitDownlinkTotal.found || explicitUsedTotal.found;
  const mode = requestedMode === "total" || requestedMode === "absolute" || (!requestedMode && hasExplicitTotal) ? "total" : "delta";
  if (requestedMode && !["delta", "increment", "total", "absolute"].includes(requestedMode)) return null;

  const uplinkField = mode === "total"
    ? (explicitUplinkTotal.found ? explicitUplinkTotal : genericUplink)
    : (explicitUplinkDelta.found ? explicitUplinkDelta : genericUplink);
  const downlinkField = mode === "total"
    ? (explicitDownlinkTotal.found ? explicitDownlinkTotal : genericDownlink)
    : (explicitDownlinkDelta.found ? explicitDownlinkDelta : genericDownlink);
  const usedField = mode === "total"
    ? (explicitUsedTotal.found ? explicitUsedTotal : genericUsed)
    : (explicitUsedDelta.found ? explicitUsedDelta : genericUsed);
  if (!uplinkField.found && !downlinkField.found && !usedField.found) return null;
  const uplink = uplinkField.found ? uplinkField.value : 0;
  const downlink = downlinkField.found ? downlinkField.value : usedField.value;
  if (!Number.isSafeInteger(uplink) || !Number.isSafeInteger(downlink) || uplink < 0 || downlink < 0
    || !Number.isSafeInteger(uplink + downlink)) return null;
  return { mode, uplink, downlink };
}

async function trafficResponse(env: Env, allocationId: string, uplinkDelta: number, downlinkDelta: number): Promise<Response> {
  const allocation = await env.DB.prepare("SELECT quota_bytes, used_bytes FROM allocations WHERE id = ?")
    .bind(allocationId).first<{ quota_bytes: number; used_bytes: number }>();
  if (!allocation) return apiError("订阅分配不存在", 404, "ALLOCATION_NOT_FOUND");
  return json({
    success: true,
    allocationId,
    counted: { uplink: uplinkDelta, downlink: downlinkDelta, total: uplinkDelta + downlinkDelta },
    usage: {
      used: allocation.used_bytes,
      quota: allocation.quota_bytes,
      remaining: Math.max(allocation.quota_bytes - allocation.used_bytes, 0),
      exhausted: allocation.used_bytes >= allocation.quota_bytes,
    },
  });
}

async function handleTraffic(request: Request, env: Env): Promise<Response> {
  const authorization = request.headers.get("authorization") || "";
  const reportingSecret = request.headers.get("x-node-secret") || (authorization.startsWith("Bearer ") ? authorization.slice(7) : "");
  if (!env.NODE_API_SECRET || reportingSecret !== env.NODE_API_SECRET) return apiError("无权上报流量", 401, "UNAUTHORIZED");
  const body = await parseBody(request);
  if (body instanceof Response) return body;
  const values = trafficValues(body);
  if (!values) return apiError("流量数据无效");
  const allocation = await trafficAllocation(env, body);
  if (!allocation) return apiError("订阅分配不存在", 404, "ALLOCATION_NOT_FOUND");
  const now = nowSeconds();
  if (values.mode === "delta") {
    const totalDelta = values.uplink + values.downlink;
    if (!Number.isSafeInteger(allocation.used_bytes + totalDelta)) return apiError("累计流量超出安全范围");
    if (totalDelta) {
      await env.DB.batch([
        env.DB.prepare("UPDATE allocations SET used_bytes = used_bytes + ?, updated_at = ? WHERE id = ? AND is_active = 1")
          .bind(totalDelta, now, allocation.id),
        env.DB.prepare("INSERT INTO traffic_logs (user_id, allocation_id, uplink_delta, downlink_delta, recorded_at) VALUES (?, ?, ?, ?, ?)")
          .bind(allocation.user_id, allocation.id, values.uplink, values.downlink, now),
      ]);
    }
    return trafficResponse(env, allocation.id, values.uplink, values.downlink);
  }

  const reporterId = trafficString(body, "reporterId", "reporter_id", "nodeId", "node_id", "source") || "default";
  if (reporterId.length > 128) return apiError("上报节点标识无效");
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS traffic_counters (
    allocation_id TEXT NOT NULL REFERENCES allocations(id) ON DELETE CASCADE,
    reporter_id TEXT NOT NULL,
    uplink_bytes INTEGER NOT NULL DEFAULT 0 CHECK (uplink_bytes >= 0),
    downlink_bytes INTEGER NOT NULL DEFAULT 0 CHECK (downlink_bytes >= 0),
    updated_at INTEGER NOT NULL,
    PRIMARY KEY (allocation_id, reporter_id)
  )`).run();
  const previous = await env.DB.prepare(
    "SELECT uplink_bytes, downlink_bytes FROM traffic_counters WHERE allocation_id = ? AND reporter_id = ?",
  ).bind(allocation.id, reporterId).first<TrafficCounter>();
  const uplinkDelta = previous && values.uplink >= previous.uplink_bytes ? values.uplink - previous.uplink_bytes : values.uplink;
  const downlinkDelta = previous && values.downlink >= previous.downlink_bytes ? values.downlink - previous.downlink_bytes : values.downlink;
  const totalDelta = uplinkDelta + downlinkDelta;
  if (!Number.isSafeInteger(totalDelta) || !Number.isSafeInteger(allocation.used_bytes + totalDelta)) return apiError("累计流量超出安全范围");
  const statements = [];
  if (totalDelta) {
    statements.push(
      env.DB.prepare("UPDATE allocations SET used_bytes = used_bytes + ?, updated_at = ? WHERE id = ? AND is_active = 1")
        .bind(totalDelta, now, allocation.id),
      env.DB.prepare("INSERT INTO traffic_logs (user_id, allocation_id, uplink_delta, downlink_delta, recorded_at) VALUES (?, ?, ?, ?, ?)")
        .bind(allocation.user_id, allocation.id, uplinkDelta, downlinkDelta, now),
    );
  }
  statements.push(env.DB.prepare(`INSERT INTO traffic_counters
    (allocation_id, reporter_id, uplink_bytes, downlink_bytes, updated_at) VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(allocation_id, reporter_id) DO UPDATE SET
      uplink_bytes = excluded.uplink_bytes, downlink_bytes = excluded.downlink_bytes, updated_at = excluded.updated_at`)
    .bind(allocation.id, reporterId, values.uplink, values.downlink, now));
  await env.DB.batch(statements);
  return trafficResponse(env, allocation.id, uplinkDelta, downlinkDelta);
}

export async function handleRequest(request: Request, env: Env, path = new URL(request.url).pathname): Promise<Response> {
  try {
    if (!env.DB || !env.JWT_SECRET || env.JWT_SECRET.length < 32) {
      return apiError("服务端尚未完成安全配置", 503, "SERVER_NOT_CONFIGURED");
    }
    if (request.method === "GET" && path === "/api/site-info") {
      const settings = await getSiteSettings(env.DB);
      return json({ name: settings.siteName, description: settings.siteDescription, registrationEnabled: settings.registrationEnabled });
    }
    if (request.method === "GET" && path === "/api/admin/setup-status") return await handleAdminSetupStatus(env);
    if (request.method === "POST" && path === "/api/admin/bootstrap") return await handleAdminBootstrap(request, env);
    if (request.method === "POST" && path === "/api/auth/register") return await handleRegister(request, env);
    if (request.method === "POST" && path === "/api/auth/login") return await handleLogin(request, env);
    const subMatch = request.method === "GET" ? path.match(/^\/sub\/([a-f0-9]{48})(?:\/([a-z0-9-]+))?$/i) : null;
    if (subMatch) return await handleSubscription(env, subMatch[1], detectSubscriptionFormat(request, subMatch[2]));
    if (request.method === "POST" && path === "/api/traffic") return await handleTraffic(request, env);

    const user = await authenticate(request, env);
    if (user instanceof Response) return user;
    if (path.startsWith("/api/admin/")) return await handleAdminRequest(request, env, path, user);
    if (request.method === "GET" && path === "/api/me") return await handleMe(env, user, request);
    if (request.method === "POST" && path === "/api/auth/logout") return new Response(null, { status: 204 });
    if (request.method === "POST" && path === "/api/orders") return await handleCreateOrder(request, env, user);
    const orderMatch = request.method === "GET" ? path.match(/^\/api\/orders\/([0-9a-f-]{36})$/i) : null;
    if (orderMatch) return await handleOrder(env, user, orderMatch[1]);
    if (request.method === "POST" && path === "/api/redeem") return await handleRedeem(request, env, user);
    if (request.method === "POST" && path === "/api/rotate-uuid") return await handleRotateUuid(env, user);
    if (request.method === "GET" && path === "/api/nodes") {
      const nodes = await env.DB.prepare("SELECT id, name, protocol, network, security FROM nodes WHERE is_active = 1 ORDER BY sort_order, name").all();
      return json(nodes.results);
    }
    if (request.method === "POST" && path === "/api/checkin") return await handleCheckin(env, user);
    return apiError("接口不存在", 404, "NOT_FOUND");
  } catch (error) {
    console.error("request failed", error);
    return apiError("服务器内部错误", 500, "INTERNAL_ERROR");
  }
}
