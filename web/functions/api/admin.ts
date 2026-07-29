import bcrypt from "bcryptjs";

export interface AdminEnv {
  DB: D1Database;
  ADMIN_BOOTSTRAP_TOKEN?: string;
}

export interface AdminSessionUser {
  id: string;
  email: string;
  username: string;
  status: string;
  role: string;
}

interface ProductRow {
  id: string;
  name: string;
  price_cents: number;
  traffic_bytes: number;
  traffic_label: string;
  duration_months: number;
  sort_order: number;
  is_active: number;
}

const GB = 1024 ** 3;

const BASE_SCHEMA = [
  `CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    email TEXT NOT NULL UNIQUE COLLATE NOCASE,
    password_hash TEXT NOT NULL,
    username TEXT NOT NULL,
    avatar_url TEXT NOT NULL DEFAULT '',
    trust_level INTEGER NOT NULL DEFAULT 0 CHECK (trust_level >= 0),
    role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'admin')),
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended', 'banned')),
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS products (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    price_cents INTEGER NOT NULL CHECK (price_cents >= 0),
    traffic_bytes INTEGER NOT NULL CHECK (traffic_bytes > 0),
    traffic_label TEXT NOT NULL,
    duration_months INTEGER NOT NULL DEFAULT 1 CHECK (duration_months > 0),
    sort_order INTEGER NOT NULL DEFAULT 0,
    is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1))
  )`,
  `CREATE TABLE IF NOT EXISTS allocations (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    uuid TEXT NOT NULL UNIQUE,
    sub_token TEXT NOT NULL UNIQUE,
    quota_bytes INTEGER NOT NULL CHECK (quota_bytes > 0),
    used_bytes INTEGER NOT NULL DEFAULT 0 CHECK (used_bytes >= 0),
    product_id TEXT REFERENCES products(id),
    product_name TEXT NOT NULL,
    claimed_at INTEGER,
    expires_at INTEGER,
    is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS traffic_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    allocation_id TEXT NOT NULL REFERENCES allocations(id) ON DELETE CASCADE,
    uplink_delta INTEGER NOT NULL DEFAULT 0 CHECK (uplink_delta >= 0),
    downlink_delta INTEGER NOT NULL DEFAULT 0 CHECK (downlink_delta >= 0),
    recorded_at INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS orders (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    product_id TEXT NOT NULL REFERENCES products(id),
    order_type TEXT NOT NULL CHECK (order_type IN ('purchase', 'renewal', 'upgrade')),
    amount_cents INTEGER NOT NULL CHECK (amount_cents >= 0),
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'paid', 'cancelled', 'expired', 'refunded')),
    payment_url TEXT,
    created_at INTEGER NOT NULL,
    paid_at INTEGER,
    expires_at INTEGER
  )`,
  `CREATE TABLE IF NOT EXISTS redeem_codes (
    id TEXT PRIMARY KEY,
    code TEXT NOT NULL UNIQUE COLLATE NOCASE,
    product_id TEXT REFERENCES products(id),
    used_by TEXT REFERENCES users(id),
    used_at INTEGER,
    is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
    created_at INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS nodes (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    address TEXT NOT NULL,
    port INTEGER NOT NULL CHECK (port BETWEEN 1 AND 65535),
    protocol TEXT NOT NULL DEFAULT 'vless',
    network TEXT NOT NULL DEFAULT 'ws',
    security TEXT NOT NULL DEFAULT 'tls',
    path TEXT NOT NULL DEFAULT '/',
    sni TEXT NOT NULL DEFAULT '',
    public_key TEXT NOT NULL DEFAULT '',
    short_id TEXT NOT NULL DEFAULT '',
    fingerprint TEXT NOT NULL DEFAULT 'chrome',
    flow TEXT NOT NULL DEFAULT '',
    sort_order INTEGER NOT NULL DEFAULT 0,
    is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
    created_at INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS checkins (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    checkin_date TEXT NOT NULL,
    bonus_bytes INTEGER NOT NULL CHECK (bonus_bytes > 0),
    created_at INTEGER NOT NULL,
    UNIQUE(user_id, checkin_date)
  )`,
];

const BASE_INDEXES = [
  "CREATE UNIQUE INDEX IF NOT EXISTS idx_allocations_active_user ON allocations(user_id) WHERE is_active = 1",
  "CREATE INDEX IF NOT EXISTS idx_allocations_user ON allocations(user_id)",
  "CREATE INDEX IF NOT EXISTS idx_traffic_allocation_time ON traffic_logs(allocation_id, recorded_at DESC)",
  "CREATE INDEX IF NOT EXISTS idx_orders_user_time ON orders(user_id, created_at DESC)",
];

const DEFAULT_PRODUCTS = [
  ["starter-50", "50GB 月度套餐", 990, 50 * GB, "50GB", 1, 1],
  ["standard-200", "200GB 月度套餐", 1990, 200 * GB, "200GB", 1, 2],
  ["pro-500", "500GB 月度套餐", 3990, 500 * GB, "500GB", 1, 3],
  ["max-1024", "1024GB 月度套餐", 6990, 1024 * GB, "1024GB", 1, 4],
] as const;

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}

function error(message: string, status = 400, code = "BAD_REQUEST"): Response {
  return json({ error: message, code }, status);
}

function now(): number {
  return Math.floor(Date.now() / 1000);
}

function randomCode(bytes = 6): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(bytes)), (value) =>
    value.toString(16).padStart(2, "0"),
  ).join("").toUpperCase();
}

async function bodyOf(request: Request): Promise<Record<string, unknown> | Response> {
  if (!request.headers.get("content-type")?.toLowerCase().includes("application/json")) {
    return error("Content-Type 必须为 application/json", 415, "UNSUPPORTED_MEDIA_TYPE");
  }
  try {
    const body = await request.json();
    return body && typeof body === "object" && !Array.isArray(body)
      ? body as Record<string, unknown>
      : error("请求 JSON 无效", 400, "INVALID_JSON");
  } catch {
    return error("请求 JSON 无效", 400, "INVALID_JSON");
  }
}

async function adminColumnExists(env: AdminEnv): Promise<boolean> {
  const columns = await env.DB.prepare("PRAGMA table_info(users)").all<{ name: string }>();
  return columns.results.some((column) => column.name === "role");
}

async function usersTableExists(env: AdminEnv): Promise<boolean> {
  const table = await env.DB.prepare(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'users'",
  ).first<{ name: string }>();
  return Boolean(table);
}

async function ensureBaseSchema(env: AdminEnv): Promise<void> {
  await env.DB.batch(BASE_SCHEMA.map((statement) => env.DB.prepare(statement)));
  await env.DB.batch(BASE_INDEXES.map((statement) => env.DB.prepare(statement)));
  await env.DB.batch(DEFAULT_PRODUCTS.map((product) => env.DB.prepare(`
    INSERT OR IGNORE INTO products
      (id, name, price_cents, traffic_bytes, traffic_label, duration_months, sort_order, is_active)
    VALUES (?, ?, ?, ?, ?, ?, ?, 1)
  `).bind(...product)));
}

async function ensureAdminSchema(env: AdminEnv): Promise<void> {
  await ensureBaseSchema(env);
  if (await adminColumnExists(env)) return;
  await env.DB.prepare(
    "ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'admin'))",
  ).run();
  await env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_users_role_status ON users(role, status)").run();
}

export async function handleAdminSetupStatus(env: AdminEnv): Promise<Response> {
  const configured = Boolean(env.ADMIN_BOOTSTRAP_TOKEN && env.ADMIN_BOOTSTRAP_TOKEN.length >= 16);
  if (!(await usersTableExists(env))) {
    return json({ required: true, configured, migrationRequired: true });
  }
  const migrationRequired = !(await adminColumnExists(env));
  if (migrationRequired) return json({ required: true, configured, migrationRequired: true });
  const result = await env.DB.prepare("SELECT COUNT(*) AS count FROM users WHERE role = 'admin'")
    .first<{ count: number }>();
  return json({ required: !result?.count, configured, migrationRequired: false });
}

export async function handleAdminBootstrap(request: Request, env: AdminEnv): Promise<Response> {
  const body = await bodyOf(request);
  if (body instanceof Response) return body;
  const token = typeof body.token === "string" ? body.token : "";
  if (!env.ADMIN_BOOTSTRAP_TOKEN || env.ADMIN_BOOTSTRAP_TOKEN.length < 16) {
    return error("服务端未配置 ADMIN_BOOTSTRAP_TOKEN", 503, "BOOTSTRAP_NOT_CONFIGURED");
  }
  if (token !== env.ADMIN_BOOTSTRAP_TOKEN) return error("管理员初始化令牌无效", 403, "INVALID_BOOTSTRAP_TOKEN");

  await ensureAdminSchema(env);
  const adminCount = await env.DB.prepare("SELECT COUNT(*) AS count FROM users WHERE role = 'admin'")
    .first<{ count: number }>();
  if (adminCount?.count) return error("管理员已经初始化", 409, "ADMIN_EXISTS");

  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  const username = typeof body.username === "string" ? body.username.trim() : "";
  const password = typeof body.password === "string" ? body.password : "";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) return error("邮箱格式无效");
  if (username.length < 2 || username.length > 32) return error("用户名长度必须为 2 到 32 个字符");
  if (password.length < 10 || password.length > 72) return error("管理员密码长度必须为 10 到 72 个字符");

  const existing = await env.DB.prepare(
    "SELECT id, password_hash FROM users WHERE email = ?",
  ).bind(email).first<{ id: string; password_hash: string }>();
  const timestamp = now();
  if (existing) {
    if (!(await bcrypt.compare(password, existing.password_hash))) {
      return error("该邮箱已注册，请使用原账号密码完成初始化", 409, "EMAIL_EXISTS");
    }
    await env.DB.prepare(
      "UPDATE users SET role = 'admin', username = ?, status = 'active', updated_at = ? WHERE id = ?",
    ).bind(username, timestamp, existing.id).run();
  } else {
    await env.DB.prepare(
      "INSERT INTO users (id, email, password_hash, username, role, status, created_at, updated_at) VALUES (?, ?, ?, ?, 'admin', 'active', ?, ?)",
    ).bind(crypto.randomUUID(), email, await bcrypt.hash(password, 10), username, timestamp, timestamp).run();
  }
  return json({ success: true, message: "管理员初始化成功，请使用管理员账号登录" }, 201);
}

async function stats(env: AdminEnv): Promise<Response> {
  const [users, activeUsers, allocations, nodes, orders, revenue, codes] = await Promise.all([
    env.DB.prepare("SELECT COUNT(*) AS value FROM users").first<{ value: number }>(),
    env.DB.prepare("SELECT COUNT(*) AS value FROM users WHERE status = 'active'").first<{ value: number }>(),
    env.DB.prepare("SELECT COUNT(*) AS value FROM allocations WHERE is_active = 1 AND (expires_at IS NULL OR expires_at > ?)").bind(now()).first<{ value: number }>(),
    env.DB.prepare("SELECT COUNT(*) AS value FROM nodes WHERE is_active = 1").first<{ value: number }>(),
    env.DB.prepare("SELECT COUNT(*) AS value FROM orders").first<{ value: number }>(),
    env.DB.prepare("SELECT COALESCE(SUM(amount_cents), 0) AS value FROM orders WHERE status = 'paid'").first<{ value: number }>(),
    env.DB.prepare("SELECT COUNT(*) AS value FROM redeem_codes WHERE is_active = 1 AND used_by IS NULL").first<{ value: number }>(),
  ]);
  return json({
    totalUsers: users?.value || 0,
    activeUsers: activeUsers?.value || 0,
    activeAllocations: allocations?.value || 0,
    activeNodes: nodes?.value || 0,
    totalOrders: orders?.value || 0,
    revenueCents: revenue?.value || 0,
    unusedCodes: codes?.value || 0,
  });
}

async function listUsers(request: Request, env: AdminEnv): Promise<Response> {
  const query = new URL(request.url).searchParams.get("q")?.trim() || "";
  const like = `%${query.replace(/[%_]/g, "")}%`;
  const result = await env.DB.prepare(`
    SELECT u.id, u.email, u.username, u.role, u.status, u.trust_level, u.created_at,
           a.id AS allocation_id, a.product_id, a.product_name, a.quota_bytes,
           a.used_bytes, a.expires_at
      FROM users u
      LEFT JOIN allocations a ON a.user_id = u.id AND a.is_active = 1
     WHERE ? = '' OR u.email LIKE ? OR u.username LIKE ?
     ORDER BY u.created_at DESC
     LIMIT 100
  `).bind(query, like, like).all();
  return json(result.results);
}

function userValues(body: Record<string, unknown>, existing?: {
  email: string;
  username: string;
  role: string;
  status: string;
  trust_level: number;
}) {
  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : existing?.email || "";
  const username = typeof body.username === "string" ? body.username.trim() : existing?.username || "";
  const role = body.role === "admin" || body.role === "user" ? body.role : existing?.role || "user";
  const status = body.status === "active" || body.status === "suspended" || body.status === "banned"
    ? body.status
    : existing?.status || "active";
  const trustLevel = body.trustLevel === undefined ? existing?.trust_level ?? 0 : Number(body.trustLevel);
  const password = typeof body.password === "string" ? body.password : "";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) throw new Error("邮箱格式无效");
  if (username.length < 2 || username.length > 32) throw new Error("用户名长度必须为 2 到 32 个字符");
  if (!Number.isInteger(trustLevel) || trustLevel < 0 || trustLevel > 10) throw new Error("信任等级必须为 0 到 10 的整数");
  if (password && (password.length < 10 || password.length > 72)) throw new Error("密码长度必须为 10 到 72 个字符");
  return { email, username, role, status, trustLevel, password };
}

async function createUser(request: Request, env: AdminEnv): Promise<Response> {
  const body = await bodyOf(request);
  if (body instanceof Response) return body;
  try {
    const user = userValues(body);
    if (!user.password) return error("创建用户时必须设置密码");
    const existing = await env.DB.prepare("SELECT id FROM users WHERE email = ?").bind(user.email).first();
    if (existing) return error("该邮箱已经注册", 409, "EMAIL_EXISTS");
    const timestamp = now();
    const id = crypto.randomUUID();
    await env.DB.prepare(`
      INSERT INTO users
        (id, email, password_hash, username, role, status, trust_level, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(id, user.email, await bcrypt.hash(user.password, 10), user.username, user.role,
      user.status, user.trustLevel, timestamp, timestamp).run();
    return json({ success: true, id }, 201);
  } catch (exception) {
    return error(exception instanceof Error ? exception.message : "用户数据无效");
  }
}

async function updateUser(request: Request, env: AdminEnv, actor: AdminSessionUser, userId: string): Promise<Response> {
  const body = await bodyOf(request);
  if (body instanceof Response) return body;
  const target = await env.DB.prepare(
    "SELECT id, email, username, role, status, trust_level FROM users WHERE id = ?",
  ).bind(userId).first<{ id: string; email: string; username: string; role: string; status: string; trust_level: number }>();
  if (!target) return error("用户不存在", 404, "USER_NOT_FOUND");
  try {
    const user = userValues(body, target);
    if (actor.id === userId && (user.role !== "admin" || user.status !== "active")) {
      return error("不能停用或取消自己的管理员权限", 409, "CANNOT_DISABLE_SELF");
    }
    if (target.role === "admin" && (user.role !== "admin" || user.status !== "active")) {
      const activeAdmins = await env.DB.prepare(
        "SELECT COUNT(*) AS count FROM users WHERE role = 'admin' AND status = 'active'",
      ).first<{ count: number }>();
      if ((activeAdmins?.count || 0) <= 1) return error("系统必须保留至少一个可用管理员", 409, "LAST_ADMIN");
    }
    const duplicate = await env.DB.prepare("SELECT id FROM users WHERE email = ? AND id != ?")
      .bind(user.email, userId).first();
    if (duplicate) return error("该邮箱已经注册", 409, "EMAIL_EXISTS");
    if (user.password) {
      await env.DB.prepare(`UPDATE users SET email = ?, username = ?, password_hash = ?, role = ?,
        status = ?, trust_level = ?, updated_at = ? WHERE id = ?`)
        .bind(user.email, user.username, await bcrypt.hash(user.password, 10), user.role,
          user.status, user.trustLevel, now(), userId).run();
    } else {
      await env.DB.prepare(`UPDATE users SET email = ?, username = ?, role = ?, status = ?,
        trust_level = ?, updated_at = ? WHERE id = ?`)
        .bind(user.email, user.username, user.role, user.status, user.trustLevel, now(), userId).run();
    }
    return json({ success: true });
  } catch (exception) {
    return error(exception instanceof Error ? exception.message : "用户数据无效");
  }
}

async function assignProduct(request: Request, env: AdminEnv, userId: string): Promise<Response> {
  const body = await bodyOf(request);
  if (body instanceof Response) return body;
  const productId = typeof body.productId === "string" ? body.productId : "";
  const product = await env.DB.prepare("SELECT * FROM products WHERE id = ?").bind(productId).first<ProductRow>();
  if (!product) return error("套餐不存在", 404, "PRODUCT_NOT_FOUND");
  const user = await env.DB.prepare("SELECT id FROM users WHERE id = ?").bind(userId).first();
  if (!user) return error("用户不存在", 404, "USER_NOT_FOUND");
  const timestamp = now();
  const expiresAtInput = Number(body.expiresAt);
  const expiresAt = Number.isSafeInteger(expiresAtInput) && expiresAtInput > timestamp
    ? expiresAtInput
    : timestamp + product.duration_months * 30 * 86400;
  const allocationId = crypto.randomUUID();
  await env.DB.batch([
    env.DB.prepare("UPDATE allocations SET is_active = 0, updated_at = ? WHERE user_id = ? AND is_active = 1").bind(timestamp, userId),
    env.DB.prepare(`
      INSERT INTO allocations
        (id, user_id, uuid, sub_token, quota_bytes, used_bytes, product_id, product_name,
         claimed_at, expires_at, is_active, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, 0, ?, ?, ?, ?, 1, ?, ?)
    `).bind(allocationId, userId, crypto.randomUUID(), randomCode(24).toLowerCase(), product.traffic_bytes,
      product.id, product.name, timestamp, expiresAt, timestamp, timestamp),
  ]);
  return json({ success: true, allocationId });
}

async function updateAllocation(request: Request, env: AdminEnv, userId: string): Promise<Response> {
  const body = await bodyOf(request);
  if (body instanceof Response) return body;
  const allocation = await env.DB.prepare(
    "SELECT id, quota_bytes, used_bytes, expires_at FROM allocations WHERE user_id = ? AND is_active = 1",
  ).bind(userId).first<{ id: string; quota_bytes: number; used_bytes: number; expires_at: number | null }>();
  if (!allocation) return error("用户当前没有有效套餐", 404, "ALLOCATION_NOT_FOUND");
  const quotaGb = body.quotaGb === undefined ? allocation.quota_bytes / GB : Number(body.quotaGb);
  const usedGb = body.usedGb === undefined ? allocation.used_bytes / GB : Number(body.usedGb);
  const expiresInput = body.expiresAt;
  const expiresAt = expiresInput === null || expiresInput === ""
    ? null
    : expiresInput === undefined ? allocation.expires_at : Number(expiresInput);
  if (!Number.isFinite(quotaGb) || quotaGb <= 0 || quotaGb > 102400) return error("流量额度必须为 0 到 102400GB");
  if (!Number.isFinite(usedGb) || usedGb < 0 || usedGb > quotaGb) return error("已用流量必须介于 0 和流量额度之间");
  if (expiresAt !== null && (!Number.isSafeInteger(expiresAt) || expiresAt <= 0)) return error("到期时间无效");
  await env.DB.prepare(
    "UPDATE allocations SET quota_bytes = ?, used_bytes = ?, expires_at = ?, updated_at = ? WHERE id = ?",
  ).bind(Math.round(quotaGb * GB), Math.round(usedGb * GB), expiresAt, now(), allocation.id).run();
  return json({ success: true });
}

async function revokeAllocation(env: AdminEnv, userId: string): Promise<Response> {
  const result = await env.DB.prepare(
    "UPDATE allocations SET is_active = 0, updated_at = ? WHERE user_id = ? AND is_active = 1",
  ).bind(now(), userId).run();
  if (!result.meta.changes) return error("用户当前没有有效套餐", 404, "ALLOCATION_NOT_FOUND");
  return json({ success: true });
}

function nodeValues(body: Record<string, unknown>, existing?: Record<string, unknown>) {
  const value = (key: string, fallback = "") => typeof body[key] === "string" ? String(body[key]).trim() : String(existing?.[key] ?? fallback);
  const integer = (key: string, fallback = 0) => body[key] === undefined ? Number(existing?.[key] ?? fallback) : Number(body[key]);
  const name = value("name");
  const address = value("address");
  const port = integer("port");
  const protocol = value("protocol", "vless");
  const network = value("network", "ws");
  const security = value("security", "tls");
  if (!name || !address) throw new Error("节点名称和地址不能为空");
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("节点端口无效");
  if (protocol !== "vless") throw new Error("当前仅支持 VLESS 协议");
  if (!["ws", "tcp", "grpc"].includes(network)) throw new Error("传输协议无效");
  if (!["none", "tls", "reality"].includes(security)) throw new Error("安全类型无效");
  return {
    name, address, port, protocol, network, security,
    path: value("path", "/"), sni: value("sni"), public_key: value("public_key"),
    short_id: value("short_id"), fingerprint: value("fingerprint", "chrome"), flow: value("flow"),
    sort_order: integer("sort_order"), is_active: body.is_active === undefined ? Number(existing?.is_active ?? 1) : (body.is_active ? 1 : 0),
  };
}

async function createNode(request: Request, env: AdminEnv): Promise<Response> {
  const body = await bodyOf(request); if (body instanceof Response) return body;
  try {
    const node = nodeValues(body);
    const id = crypto.randomUUID();
    await env.DB.prepare(`
      INSERT INTO nodes (id, name, address, port, protocol, network, security, path, sni,
        public_key, short_id, fingerprint, flow, sort_order, is_active, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(id, node.name, node.address, node.port, node.protocol, node.network, node.security,
      node.path, node.sni, node.public_key, node.short_id, node.fingerprint, node.flow,
      node.sort_order, node.is_active, now()).run();
    return json({ success: true, id }, 201);
  } catch (exception) { return error(exception instanceof Error ? exception.message : "节点数据无效"); }
}

async function updateNode(request: Request, env: AdminEnv, id: string): Promise<Response> {
  const body = await bodyOf(request); if (body instanceof Response) return body;
  const existing = await env.DB.prepare("SELECT * FROM nodes WHERE id = ?").bind(id).first<Record<string, unknown>>();
  if (!existing) return error("节点不存在", 404, "NODE_NOT_FOUND");
  try {
    const node = nodeValues(body, existing);
    await env.DB.prepare(`UPDATE nodes SET name=?, address=?, port=?, protocol=?, network=?, security=?,
      path=?, sni=?, public_key=?, short_id=?, fingerprint=?, flow=?, sort_order=?, is_active=? WHERE id=?`)
      .bind(node.name, node.address, node.port, node.protocol, node.network, node.security,
        node.path, node.sni, node.public_key, node.short_id, node.fingerprint, node.flow,
        node.sort_order, node.is_active, id).run();
    return json({ success: true });
  } catch (exception) { return error(exception instanceof Error ? exception.message : "节点数据无效"); }
}

function productValues(body: Record<string, unknown>, existing?: ProductRow) {
  const name = typeof body.name === "string" ? body.name.trim() : existing?.name || "";
  const priceCents = body.priceCents === undefined ? existing?.price_cents ?? 0 : Number(body.priceCents);
  const trafficGb = body.trafficGb === undefined ? (existing ? existing.traffic_bytes / GB : 0) : Number(body.trafficGb);
  const durationMonths = body.durationMonths === undefined ? existing?.duration_months ?? 1 : Number(body.durationMonths);
  const sortOrder = body.sortOrder === undefined ? existing?.sort_order || 0 : Number(body.sortOrder);
  const active = body.isActive === undefined ? existing?.is_active ?? 1 : (body.isActive ? 1 : 0);
  if (!name || name.length > 80) throw new Error("套餐名称无效");
  if (!Number.isInteger(priceCents) || priceCents < 0) throw new Error("价格必须为非负整数分");
  if (!Number.isFinite(trafficGb) || trafficGb <= 0 || trafficGb > 102400) throw new Error("流量必须为 0 到 102400GB");
  if (!Number.isInteger(durationMonths) || durationMonths < 1 || durationMonths > 120) throw new Error("有效月数必须为 1 到 120");
  if (!Number.isInteger(sortOrder)) throw new Error("排序值必须为整数");
  return { name, priceCents, trafficBytes: Math.round(trafficGb * GB), trafficLabel: `${trafficGb}GB`, durationMonths, sortOrder, active };
}

async function createProduct(request: Request, env: AdminEnv): Promise<Response> {
  const body = await bodyOf(request); if (body instanceof Response) return body;
  try {
    const product = productValues(body);
    const id = crypto.randomUUID();
    await env.DB.prepare(`INSERT INTO products
      (id, name, price_cents, traffic_bytes, traffic_label, duration_months, sort_order, is_active)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(id, product.name, product.priceCents, product.trafficBytes, product.trafficLabel,
        product.durationMonths, product.sortOrder, product.active).run();
    return json({ success: true, id }, 201);
  } catch (exception) { return error(exception instanceof Error ? exception.message : "套餐数据无效"); }
}

async function updateProduct(request: Request, env: AdminEnv, id: string): Promise<Response> {
  const body = await bodyOf(request); if (body instanceof Response) return body;
  const existing = await env.DB.prepare("SELECT * FROM products WHERE id = ?").bind(id).first<ProductRow>();
  if (!existing) return error("套餐不存在", 404, "PRODUCT_NOT_FOUND");
  try {
    const product = productValues(body, existing);
    await env.DB.prepare(`UPDATE products SET name=?, price_cents=?, traffic_bytes=?, traffic_label=?,
      duration_months=?, sort_order=?, is_active=? WHERE id=?`)
      .bind(product.name, product.priceCents, product.trafficBytes, product.trafficLabel,
        product.durationMonths, product.sortOrder, product.active, id).run();
    return json({ success: true });
  } catch (exception) { return error(exception instanceof Error ? exception.message : "套餐数据无效"); }
}

async function listCodes(env: AdminEnv): Promise<Response> {
  const result = await env.DB.prepare(`
    SELECT r.id, r.code, r.product_id, p.name AS product_name, r.used_by,
           u.email AS used_by_email, r.used_at, r.is_active, r.created_at
      FROM redeem_codes r
      LEFT JOIN products p ON p.id = r.product_id
      LEFT JOIN users u ON u.id = r.used_by
     ORDER BY r.created_at DESC LIMIT 200
  `).all();
  return json(result.results);
}

async function createCodes(request: Request, env: AdminEnv): Promise<Response> {
  const body = await bodyOf(request); if (body instanceof Response) return body;
  const productId = typeof body.productId === "string" ? body.productId : "";
  const count = Number(body.count);
  const prefix = typeof body.prefix === "string" ? body.prefix.trim().toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 12) : "CODE";
  if (!Number.isInteger(count) || count < 1 || count > 100) return error("生成数量必须为 1 到 100");
  const product = await env.DB.prepare("SELECT id FROM products WHERE id = ?").bind(productId).first();
  if (!product) return error("套餐不存在", 404, "PRODUCT_NOT_FOUND");
  const timestamp = now();
  const codes = Array.from({ length: count }, () => `${prefix}-${randomCode()}`);
  await env.DB.batch(codes.map((code) => env.DB.prepare(
    "INSERT INTO redeem_codes (id, code, product_id, is_active, created_at) VALUES (?, ?, ?, 1, ?)",
  ).bind(crypto.randomUUID(), code, productId, timestamp)));
  return json({ success: true, codes }, 201);
}

async function listOrders(env: AdminEnv): Promise<Response> {
  const result = await env.DB.prepare(`
    SELECT o.id, o.user_id, u.email, u.username, o.product_id, p.name AS product_name,
           o.order_type, o.amount_cents, o.status, o.created_at, o.paid_at
      FROM orders o
      LEFT JOIN users u ON u.id = o.user_id
      LEFT JOIN products p ON p.id = o.product_id
     ORDER BY o.created_at DESC LIMIT 200
  `).all();
  return json(result.results);
}

export async function handleAdminRequest(
  request: Request,
  env: AdminEnv,
  path: string,
  actor: AdminSessionUser,
): Promise<Response> {
  if (actor.role !== "admin") return error("需要管理员权限", 403, "ADMIN_REQUIRED");
  if (request.method === "GET" && path === "/api/admin/stats") return stats(env);
  if (request.method === "GET" && path === "/api/admin/users") return listUsers(request, env);
  if (request.method === "POST" && path === "/api/admin/users") return createUser(request, env);
  const userMatch = path.match(/^\/api\/admin\/users\/([^/]+)$/);
  if (request.method === "PATCH" && userMatch) return updateUser(request, env, actor, userMatch[1]);
  const allocationMatch = path.match(/^\/api\/admin\/users\/([^/]+)\/allocation$/);
  if (request.method === "POST" && allocationMatch) return assignProduct(request, env, allocationMatch[1]);
  if (request.method === "PATCH" && allocationMatch) return updateAllocation(request, env, allocationMatch[1]);
  if (request.method === "DELETE" && allocationMatch) return revokeAllocation(env, allocationMatch[1]);

  if (request.method === "GET" && path === "/api/admin/nodes") {
    const result = await env.DB.prepare("SELECT * FROM nodes ORDER BY sort_order, name").all();
    return json(result.results);
  }
  if (request.method === "POST" && path === "/api/admin/nodes") return createNode(request, env);
  const nodeMatch = path.match(/^\/api\/admin\/nodes\/([^/]+)$/);
  if (request.method === "PATCH" && nodeMatch) return updateNode(request, env, nodeMatch[1]);
  if (request.method === "DELETE" && nodeMatch) {
    await env.DB.prepare("UPDATE nodes SET is_active = 0 WHERE id = ?").bind(nodeMatch[1]).run();
    return json({ success: true });
  }

  if (request.method === "GET" && path === "/api/admin/products") {
    const result = await env.DB.prepare("SELECT * FROM products ORDER BY sort_order, price_cents, id").all();
    return json(result.results);
  }
  if (request.method === "POST" && path === "/api/admin/products") return createProduct(request, env);
  const productMatch = path.match(/^\/api\/admin\/products\/([^/]+)$/);
  if (request.method === "PATCH" && productMatch) return updateProduct(request, env, productMatch[1]);
  if (request.method === "DELETE" && productMatch) {
    await env.DB.prepare("UPDATE products SET is_active = 0 WHERE id = ?").bind(productMatch[1]).run();
    return json({ success: true });
  }

  if (request.method === "GET" && path === "/api/admin/redeem-codes") return listCodes(env);
  if (request.method === "POST" && path === "/api/admin/redeem-codes") return createCodes(request, env);
  const codeMatch = path.match(/^\/api\/admin\/redeem-codes\/([^/]+)$/);
  if (request.method === "DELETE" && codeMatch) {
    await env.DB.prepare("UPDATE redeem_codes SET is_active = 0 WHERE id = ? AND used_by IS NULL").bind(codeMatch[1]).run();
    return json({ success: true });
  }

  if (request.method === "GET" && path === "/api/admin/orders") return listOrders(env);
  const orderMatch = path.match(/^\/api\/admin\/orders\/([^/]+)$/);
  if (request.method === "PATCH" && orderMatch) {
    const body = await bodyOf(request); if (body instanceof Response) return body;
    const status = typeof body.status === "string" ? body.status : "";
    if (!["pending", "paid", "cancelled", "expired", "refunded"].includes(status)) return error("订单状态无效");
    await env.DB.prepare("UPDATE orders SET status = ?, paid_at = CASE WHEN ? = 'paid' THEN COALESCE(paid_at, ?) ELSE paid_at END WHERE id = ?")
      .bind(status, status, now(), orderMatch[1]).run();
    return json({ success: true, warning: "订单状态已更新；退款状态不会自动撤销已分配套餐" });
  }
  return error("管理接口不存在", 404, "NOT_FOUND");
}
