# ProxySubscription - 代理订阅流量销售平台

轻量级代理订阅流量销售平台（机场面板），基于 traffic.dogegg.online 完整逆向分析。

## 技术栈

| 层级 | 技术 |
|------|------|
| 前端 | 原生 JS SPA |
| 后端 | Cloudflare Pages Functions / Workers (TypeScript) |
| 数据库 | Cloudflare D1 (SQLite) |
| 认证 | JWT (HS256) |
| 部署 | Cloudflare Pages (免费额度) |

## 项目结构

```
web/                    # 前端 + Pages Functions
  index.html            # SPA 入口
  css/style.css         # 设计系统 + 全局样式
  js/
    api.js              # API 客户端
    app.js              # 路由 + 主题 + Toast + Modal
    pages/
      login.js          # 登录/注册页
      dashboard.js      # 仪表盘主页
      admin.js          # 管理后台（Phase 6）
  functions/api/
    [[route]].ts        # Pages Functions 路由
    api-handler.ts      # 共享 API 逻辑
worker/                 # 独立 Worker（可选）
  src/index.ts
  schema.sql            # D1 数据库 schema
docs/BLUEPRINT.md       # 开发蓝图
```

## 快速开始

### 1. 安装依赖
```
cd worker
npm install
```

### 2. 创建 D1 数据库
```
npx wrangler d1 create proxy-subscription-db
npx wrangler d1 execute proxy-subscription-db --file=./schema.sql
```

### 3. 本地开发
```
npx wrangler pages dev web/
```

### 4. 部署
```
npx wrangler pages deploy web/
```
