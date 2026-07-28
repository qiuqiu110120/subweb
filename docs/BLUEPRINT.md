# 🚀 ProxySubscription 开发总纲

> 基于 `traffic.dogegg.online` 完整逆向分析，打造一个功能等价、可部署在 Cloudflare Pages 免费平台上的代理订阅流量销售系统。

---

## 📋 项目概述

### 项目定位

一个**轻量级代理订阅流量销售平台**（俗称"机场面板"），用户可以注册登录、购买流量套餐、获取代理订阅链接导入各类客户端使用。

### 核心差异（与 DOGEGG 原版相比）

| 对比项 | DOGEGG 原版 | 本项目 |
|--------|------------|--------|
| 登录方式 | LinuxDo OAuth | **邮箱+密码注册登录** |
| 支付方式 | LDC 社区积分 | **可扩展（模拟支付 -> Stripe/支付宝）** |
| 部署平台 | LinuxDo Discourse 基础设施 | **Cloudflare Pages + Workers + D1** |
| 前端框架 | 原生 JS Canvas | **原生 JS SPA** |
| 后端 | Discourse 插件 (Ruby) | **Cloudflare Workers (TypeScript)** |
| 数据库 | PostgreSQL | **Cloudflare D1 (SQLite)** |
| 成本 | 托管在付费服务器 | **免费额度内运行** |

---

## 🎨 页面与 UI 组件清单

### 1. 登录/注册页 `/login`

**视觉还原要点：**
- 渐变网格背景 + `::before` 伪元素色彩光晕
- 居中毛玻璃卡片 `login-card`：白色半透明 + `backdrop-filter: blur(18px)`
- Logo 图标（96x96，圆角边框 + 阴影）
- 品牌标语区域：eyebrow（小号大写） + 标题 + 描述文字
- 卖点标签（Pills）：VLESS协议、自建节点、高速稳定
- 渐变色登录按钮：`linear-gradient(135deg, --primary, --accent)`
- 深色/浅色主题切换按钮（右上角）
- 表单：邮箱输入框 + 密码输入框 + 登录/注册切换
- 页脚品牌文字

**CSS 变量主题系统：**
```css
:root {
  --bg: #f6f8fb;
  --panel: #ffffff;
  --ink: #172033;
  --text: #26364d;
  --muted: #64748b;
  --line: #dbe3ee;
  --primary: #2563eb;
  --primary-strong: #1e40af;
  --accent: #0891b2;
  --accent-strong: #0f766e;
  --gold: #a16207;
  --warn: #b45309;
  --danger: #b42318;
  --success: #15803d;
  --shadow: 0 24px 70px rgba(37, 99, 235, 0.12);
  --motion-ease: cubic-bezier(0.22, 1, 0.36, 1);
}

/* 深色主题 */
html[data-theme="dark"] {
  --bg: #0b1120;
  --panel: #111827;
  --ink: #f1f5f9;
  --text: #cbd5e1;
  --line: #1e293b;
  ...
}
```

---

### 2. 仪表盘主页 `/`（需登录）

**布局结构（桌面端）：**

```
+--------------------------------------------------+
|  Topbar (固定顶部导航)                              |
|  [Brand] [服务在线]          [主题切换] [退出登录]   |
+--------------------------------------------------+
|  .shell (最大宽度 1180px 居中)                      |
|                                                    |
|  +-- .usage-notice (使用提示) --------------------+ |
|  | 部分节点连接不上请更新客户端；自建高速节点...      | |
|  +------------------------------------------------+ |
|                                                    |
|  +-- .meter-block (流量仪表盘) -------------------+ |
|  |  流量额度: 200GB 月度套餐                        | |
|  |  +----------+   0.6%                            | |
|  |  | SVG圆环  |   已用 1.15 GB                    | |
|  |  | 进度仪表  |   剩余 199 GB                     | |
|  |  +----------+                                   | |
|  |  [剩余199GB] [已用1.15GB] [0.6%]              | |
|  +------------------------------------------------+ |
|                                                    |
|  +-- .identity (用户身份卡) ----------------------+ |
|  |  [头像] 何哈哈 @autumn666   trust level 2       | |
|  +------------------------------------------------+ |
|                                                    |
|  +-- .panel (订阅详情) ---------------------------+ |
|  |  [订阅状态: 可用 绿点]    [兑换码][续订][升级]   | |
|  |                                                    |
|  |  服务账号   autumn666-4d8d95617d                  |
|  |  UUID       9d684cf0-...               [更换]    |
|  |  订阅商品   200GB 月度套餐                        |
|  |  生效时间   2026/7/11 17:28:28                    |
|  |  有效期至   2026/8/1 00:00:00                     |
|  |                                                    |
|  |  +-- 订阅链接 --------------------------------+  |
|  |  | V2Ray/Shadowrocket                  [复制] |  |
|  |  | Clash/Verge/Stash                   [复制] |  |
|  |  | Quantumult X                        [复制] |  |
|  |  | Loon                                [复制] |  |
|  |  | SingBox/NekoBox                     [复制] |  |
|  |  +-------------------------------------------+  |
|  +--------------------------------------------------+
+--------------------------------------------------+
```

**UI 组件清单：**

| 组件 | CSS Class | 说明 |
|------|-----------|------|
| 顶部导航 | `.topbar` | 固定顶部，半透明背景，flex 布局 |
| 品牌标志 | `.brand-mark` | 42x42 圆角方块，渐变背景 |
| 流量仪表盘 | `.meter-block`, `.meter` | 渐变网格背景，SVG 圆环 |
| 用户卡片 | `.identity` | 头像 + 用户名 + 等级 |
| 内容面板 | `.panel` | 半透明白色背景，圆角边框 |
| 信息行 | `.row`, `.link-row` | 2 列 grid：标签 + 值 |
| 状态标签 | `.status-chip`, `.pill` | 绿色圆角胶囊标签 |
| 操作按钮 | `.ghost-button`, `.primary` | 不同权重按钮 |
| UUID 控制 | `.uuid-control` | flex 行：code 文本 + 按钮 |
| 订阅链接 | `.link-row` + `[data-copy]` | 每行：名称 + 复制 |
| 弹窗 | `.app-dialog` | `<dialog>` 元素 |
| 套餐卡片 | `.product-card` | 弹窗内选择卡片 |
| 通知系统 | `.notification-region` | 右上角 toast |
| 使用提示 | `.usage-notice` | 顶部信息栏 |

---

### 3. 弹窗组件

#### 3a. 套餐选择弹窗
- 触发：点击"升级套餐" / "续订套餐"
- 内容：套餐卡片列表，每个显示名称、流量、价格
- 不可选套餐灰色显示 + 原因提示
- 升级模式：只显示更高级套餐 + 差价
- 续订模式：显示全部套餐 + 原价

#### 3b. 兑换码弹窗
- 触发：点击"兑换码"
- 内容：输入框 + 提交按钮
- 成功后显示通知并刷新

---

## [GIT] 数据库设计 (Cloudflare D1)

### ER 图

```
+----------+     +--------------+     +--------------+
|  users   |---->| allocations  |---->| traffic_logs |
+----------+     +--------------+     +--------------+
      |                  |
      |            +-----+------+
      +----------->|   orders   |
                   +------------+
                         |
+--------------+         |
| redeem_codes |---------+
+--------------+

+--------------+
|   products   | (配置表)
+--------------+
```

### 表结构

```sql
-- 用户表
CREATE TABLE users (
  id            TEXT PRIMARY KEY,
  email         TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  username      TEXT NOT NULL,
  avatar_url    TEXT DEFAULT "",
",
  trust_level   INTEGER DEFAULT 0,
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL
);

-- 套餐/商品配置
CREATE TABLE products (
  id              TEXT PRIMARY KEY,
  name            TEXT NOT NULL,
  price_cents     INTEGER NOT NULL,
  traffic_bytes   INTEGER NOT NULL,
  traffic_label   TEXT NOT NULL,
  duration_months INTEGER NOT NULL DEFAULT 1,
  sort_order      INTEGER DEFAULT 0,
  is_active       INTEGER DEFAULT 1
);

-- 用户套餐分配
CREATE TABLE allocations (
  id            TEXT PRIMARY KEY,
  user_id       TEXT NOT NULL REFERENCES users(id),
  uuid          TEXT NOT NULL UNIQUE,
  sub_token     TEXT NOT NULL UNIQUE,
  quota_bytes   INTEGER NOT NULL,
  used_bytes    INTEGER DEFAULT 0,
  product_id    TEXT REFERENCES products(id),
  product_name  TEXT NOT NULL,
  claimed_at    INTEGER,
  expires_at    INTEGER,
  is_active     INTEGER DEFAULT 1,
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL
);

-- 流量日志
CREATE TABLE traffic_logs (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id         TEXT NOT NULL,
  allocation_id   TEXT NOT NULL,
  uplink_delta    INTEGER DEFAULT 0,
  downlink_delta  INTEGER DEFAULT 0,
  recorded_at     INTEGER NOT NULL
);

-- 订单表
CREATE TABLE orders (
  id            TEXT PRIMARY KEY,
  user_id       TEXT NOT NULL REFERENCES users(id),
  product_id    TEXT NOT NULL REFERENCES products(id),
  order_type    TEXT NOT NULL,
  amount_cents  INTEGER NOT NULL,
  status        TEXT NOT NULL DEFAULT "pending",
  payment_url   TEXT,
  created_at    INTEGER NOT NULL,
  paid_at       INTEGER,
  expires_at    INTEGER
);

-- 兑换码
CREATE TABLE redeem_codes (
  id            TEXT PRIMARY KEY,
  code          TEXT NOT NULL UNIQUE,
  product_id    TEXT REFERENCES products(id),
  used_by       TEXT,
  used_at       INTEGER,
  is_active     INTEGER DEFAULT 1,
  created_at    INTEGER NOT NULL
);
```

---

## [GitHub] API 设计

### 公开端点（无需认证）

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/site-info` | 站点品牌信息 |
| POST | `/api/auth/register` | 注册 `{ email, password, username }` |
| POST | `/api/auth/login` | 登录 `{ email, password }` |
| GET | `/sub/:token/:format` | 客户端订阅 (clash/v2ray/singbox) |

### 认证端点（需 Bearer Token）

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/me` | 用户完整仪表盘数据 |
| POST | `/api/auth/logout` | 退出登录 |
| POST | `/api/orders` | 创建支付订单 `{ productId, orderType }` |
| GET | `/api/orders/:id` | 查询订单状态 |
| POST | `/api/redeem` | 兑换码激活 `{ code }` |
| POST | `/api/rotate-uuid` | 更换订阅 UUID |
| GET | `/api/nodes` | 可用节点列表 |
| POST | `/api/checkin` | 每日签到 |

### `/api/me` 响应结构

```jsonc
{
  "authenticated": true,
  "user": {
    "id": "user_uuid", "username": "...", "email": "...",
    "avatar_url": "...", "trust_level": 0
  },
  "allocation": {
    "uuid": "xray-uuid", "sub_token": "token",
    "quota_bytes": 214748364800, "product_name": "200GB 月度套餐",
    "claimed_at": 0, "expires_at": 0
  },
  "quota": {
    "quota": 214748364800, "used": 1238555709,
    "remaining": 213509809091, "percent": 0.58,
    "exhausted": false, "expired": false
  },
  "availability": { "usable": true, "banned": false },
  "purchaseOptions": [ /* 可升级套餐列表 */ ],
  "renewalOptions": [ /* 可续订套餐列表 */ ],
  "subscriptions": {
    "links": {
      "v2ray": "/sub/TOKEN/v2ray",
      "clash": "/sub/TOKEN/clash",
      "singbox": "/sub/TOKEN/singbox"
    }
  },
  "config": {
    "products": [ /* 全部套餐 */ ],
    "statsPollIntervalMs": 10000
  }
}
```

---

## [GitHub] 前端架构

### 文件结构

```
web/
+-- index.html              # SPA 入口
+-- login.html              # 登录/注册页
+-- css/
|   +-- variables.css       # CSS 变量 + 主题
|   +-- base.css            # 全局样式
|   +-- login.css           # 登录页样式
|   +-- dashboard.css       # 仪表盘样式
+-- js/
|   +-- app.js              # 主入口：路由、状态管理
|   +-- api.js              # API 请求封装
|   +-- auth.js             # 认证逻辑
|   +-- dashboard.js        # 仪表盘渲染
|   +-- dialogs.js          # 弹窗组件
|   +-- notifications.js    # Toast 通知
|   +-- theme.js            # 主题切换
+-- assets/
    +-- logo.svg
```

### 状态管理

```javascript
const state = {
  me: null,          // /api/me 响应缓存
  busy: false,       // 全局加载状态
  token: null,       // JWT（存 localStorage）
  theme: "light",    // 当前主题
  dialogs: { upgrade: false, renewal: false, redeem: false },
  notifications: []
};
```

---

## [GitHub] 后端架构 (Cloudflare Workers)

### 项目结构

```
worker/
+-- src/
|   +-- index.ts            # Worker 入口 + 路由
|   +-- auth.ts             # 注册/登录/JWT
|   +-- dashboard.ts        # /api/me 聚合逻辑
|   +-- orders.ts           # 订单管理
|   +-- redeem.ts           # 兑换码
|   +-- subscription.ts     # /sub/:token/:fmt
|   +-- traffic.ts          # 流量上报
|   +-- utils/
|       +-- jwt.ts          # JWT 签发/验证
|       +-- crypto.ts       # 密码哈希
|       +-- response.ts     # JSON 响应
+-- db/
|   +-- schema.sql          # D1 数据库 schema
+-- wrangler.toml           # Cloudflare 配置
+-- package.json
```

---

## [GitHub] 订阅端点 `/sub/:token/:format`

| 格式 | Content-Type | 客户端 |
|------|-------------|--------|
| `clash` | `text/yaml` | Clash Meta, Verge, Stash, Mihomo |
| `v2ray` | `application/json` | V2RayN, V2RayNG, Shadowrocket |
| `singbox` | `application/json` | Sing-Box, NekoBox |
| `loon` | `text/plain` | Loon |

---

## [GitHub] 部署方案：Cloudflare 全家桶

```
+------------------------------------------+
| Cloudflare Pages                         |
|  +-- 静态资源托管（HTML/CSS/JS）          |
|  +-- _worker.js (Pages Functions)        |
|       +-- /api/*  -> Worker 逻辑         |
|       +-- /sub/*  -> Worker 逻辑         |
+------------------------------------------+
| Cloudflare D1  -> 数据库                  |
| Cloudflare KV  -> 缓存 / Session          |
+------------------------------------------+
```

**免费额度：**

| 服务 | 免费额度 | 够用吗 |
|------|---------|--------|
| Pages | 无限请求, 500 builds/月 | Yes |
| Workers | 100,000 请求/天 | Yes |
| D1 | 5GB 存储, 5M 行读取/天 | Yes |
| KV | 1GB, 1M 读取/天 | Yes |

**部署命令：**
```bash
npm install -g wrangler
wrangler d1 create proxy-sub-db
wrangler d1 execute proxy-sub-db --file=db/schema.sql
wrangler deploy
wrangler pages deploy web/
```

---

## [GitHub] 开发阶段

### Phase 1：基础框架（预计 3-5 天）

- [ ] 1.1 初始化项目结构（web/ + worker/）
- [ ] 1.2 创建 D1 数据库并初始化表
- [ ] 1.3 实现 `/api/auth/register` + `/api/auth/login` (JWT)
- [ ] 1.4 实现 `/api/me` 聚合接口
- [ ] 1.5 前端登录/注册页（原生 JS + CSS）
- [ ] 1.6 前端路由：登录态检测 + 自动跳转
- [ ] 1.7 主题切换系统
- [ ] 1.8 部署到 Cloudflare Pages 验证

### Phase 2：仪表盘 UI（预计 3-4 天）

- [ ] 2.1 顶部导航栏 + 品牌标志
- [ ] 2.2 流量仪表盘（SVG 圆环 + 百分比文字）
- [ ] 2.3 用户身份卡片
- [ ] 2.4 订阅详情面板（信息行 + UUID + 链接）
- [ ] 2.5 订阅链接复制功能
- [ ] 2.6 Toast 通知系统
- [ ] 2.7 10 秒自动轮询刷新
- [ ] 2.8 响应式适配（移动端）

### Phase 3：套餐与订单（预计 3-4 天）

- [ ] 3.1 套餐数据模型 + 管理接口
- [ ] 3.2 套餐选择弹窗（升级/续订）
- [ ] 3.3 订单创建 API `/api/orders`
- [ ] 3.4 支付窗口（先做模拟支付，后接真实网关）
- [ ] 3.5 支付状态轮询 + postMessage 通信
- [ ] 3.6 订单异常恢复（sessionStorage）

### Phase 4：订阅链路（预计 2-3 天）

- [ ] 4.1 节点管理数据模型
- [ ] 4.2 `/sub/:token/:format` 端点实现
- [ ] 4.3 Clash YAML 配置生成
- [ ] 4.4 V2Ray JSON 配置生成
- [ ] 4.5 Sing-Box 配置生成
- [ ] 4.6 流量信息注入（剩余/到期/用户名）
- [ ] 4.7 UUID 更换功能

### Phase 5：辅助功能（预计 2-3 天）

- [ ] 5.1 兑换码系统（生成 + 激活）
- [ ] 5.2 每日签到（赠送流量）
- [ ] 5.3 流量上报 API（Xray 节点 -> Worker）
- [ ] 5.4 流量统计聚合
- [ ] 5.5 闲置暂停机制
- [ ] 5.6 注册赠送流量

### Phase 6：管理后台 + 上线（预计 2-3 天）

- [ ] 6.1 简单管理后台页面
- [ ] 6.2 用户管理（列表、封禁）
- [ ] 6.3 节点管理（增删改查）
- [ ] 6.4 套餐管理
- [ ] 6.5 兑换码批量生成
- [ ] 6.6 数据统计看板
- [ ] 6.7 完整部署文档

---

## [GitHub] 设计标注速查

### 色彩

| 用途 | 浅色 | 深色 |
|------|------|------|
| 背景 | `#f6f8fb` | `#0b1120` |
| 面板 | `#ffffff` | `#111827` |
| 主文字 | `#172033` | `#f1f5f9` |
| 次要文字 | `#26364d` | `#cbd5e1` |
| 弱化文字 | `#64748b` | `#64748b` |
| 主色 | `#2563eb` | `#60a5fa` |
| 强调色 | `#0891b2` | `#22d3ee` |
| 成功 | `#15803d` | `#4ade80` |
| 警告 | `#b45309` | `#fbbf24` |
| 危险 | `#b42318` | `#fda4af` |
| 分隔线 | `#dbe3ee` | `#1e293b` |

### 间距与圆角

- 按钮最小高度：`36-40px`
- 按钮内边距：`0 16px`（普通）/ `0 13px`（ghost）
- 圆角：`8px`（按钮/卡片）/ `16-20px`（特殊元素）
- 卡片内边距：`42px 34px`（桌面）/ `28px 20px`（移动）
- 弹窗内边距：`28px 30px`
- 最大内容宽度：`1180px`

### 动效

```css
--motion-ease: cubic-bezier(0.22, 1, 0.36, 1);

@keyframes surface-enter {
  from { opacity: 0; transform: translateY(16px) scale(0.97); }
}

button:hover { transform: translateY(-2px); }
button:active { transform: translateY(0) scale(0.97); }
```

### 字体

```css
font-family: Inter, "Segoe UI", "Microsoft YaHei", "PingFang SC", Arial, sans-serif;
/* 字重: 800(标题) / 760(标签) / 600(正文) / 500(辅助) */
```

---

## [GitHub] 关键技术决策

| 决策 | 选择 | 原因 |
|------|------|------|
| 数据库 | D1 (SQLite) | Cloudflare 生态，免费额度充足 |
| 认证方式 | JWT (HS256) | 无状态，适合边缘计算 |
| 密码哈希 | bcryptjs | Worker 环境兼容 |
| 前端框架 | 原生 JS | 最小体积，最快加载 |
| 支付集成 | 先模拟，后接 Stripe | MVP 优先 |
| 订阅格式 | 服务端生成 | 无需依赖 subconverter |

---

*本文档作为整个项目的开发总纲，所有 Phases 的开发工作均围绕此文档展开。*