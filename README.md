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

首次打开登录页，使用 `.dev.vars` 中的 `ADMIN_BOOTSTRAP_TOKEN` 点击“初始化管理员”。系统会自动创建本地 D1 表、默认套餐和首个管理员。也可以手动初始化数据库：

```bash
cd worker
pnpm install
npx wrangler d1 execute proxy-subscription-db --local --file=./db/schema.sql
```

## Cloudflare 部署

在 Cloudflare Pages 中连接 GitHub 仓库后，构建配置填写：

| 配置项 | 值 |
| --- | --- |
| 框架预设 | `None` |
| 根目录 | `web` |
| 构建命令 | 留空 |
| 构建输出目录 | `.` |

然后在 Pages 项目的“设置 -> 绑定”中添加 D1 数据库绑定：

| 变量名 | D1 数据库 |
| --- | --- |
| `DB` | `proxy-subscription-db`（或实际数据库名称） |

在“设置 -> 环境变量和机密”中配置生产环境变量：

| 变量名 | 要求 |
| --- | --- |
| `JWT_SECRET` | 至少 32 位随机字符串，必须配置 |
| `ADMIN_BOOTSTRAP_TOKEN` | 至少 16 位的一次性管理员初始化令牌，必须配置 |
| `NODE_API_SECRET` | 节点上报流量时使用，可选 |

保存配置并重新部署。部署成功后打开站点登录页，点击“初始化管理员”，输入 `ADMIN_BOOTSTRAP_TOKEN` 和管理员账号资料。Web 初始化会自动创建空 D1 的全部表和默认套餐；旧版本数据库也会自动补充管理员字段，因此 Pages 部署不需要命令行执行 SQL。

管理员登录后可以在 Web 后台完成：用户创建、资料/密码/权限/状态管理，套餐分配与订阅额度管理，节点和套餐增改停用，兑换码批量生成，订单状态处理及运营统计查看。

若选择独立部署 `worker/`，仍可使用 `worker/db/schema.sql` 和对应的 `worker/wrangler.toml` 通过 Wrangler 初始化及部署。

不要将 `.dev.vars` 或生产密钥提交到仓库。
