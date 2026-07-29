# ProxySubscription

基于 Cloudflare Pages、Workers 和 D1 的轻量级代理订阅流量销售平台。实现以 `docs/BLUEPRINT.md` 为准。

## 项目结构

```text
web/                         静态 SPA 与 Pages Functions
  functions/api/            /api/*
  functions/sub/            /sub/*
  js/                        原生 JavaScript 页面与状态管理
worker/                      可独立部署的 Worker 入口
  db/schema.sql              D1 schema 与默认套餐
docs/BLUEPRINT.md            产品与技术蓝图
```

## 本地开发

需要 Node.js 20+ 和 pnpm/npm。

```bash
cd web
pnpm install
cp .dev.vars.example .dev.vars
npx wrangler pages dev .
```

另开终端初始化本地 D1：

```bash
cd worker
pnpm install
npx wrangler d1 execute proxy-subscription-db --local --file=./db/schema.sql
```

## Cloudflare 部署

1. 使用 `wrangler d1 create proxy-subscription-db` 创建 D1。
2. 将两个 `wrangler.toml` 中的占位 `database_id` 替换为实际 ID。
3. 执行 `wrangler secret put JWT_SECRET`，密钥至少 32 个字符。
4. 若启用节点流量上报，再执行 `wrangler secret put NODE_API_SECRET`。
5. 使用 `worker/db/schema.sql` 初始化远程 D1，再部署 Pages 或独立 Worker。

不要将 `.dev.vars` 或生产密钥提交到仓库。
