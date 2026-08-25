# Climbing CRM POC

当前 POC 已包含邮箱注册与登录、基于 PostgreSQL 的会话、审计事件、`L1_ADMIN` / `L2_ADMIN` 角色模型，以及登录后的岩馆数字化看板骨架。

看板中的员工、岩点、墙面和线路是 POC 核心模块；日程、营销、数据和设置当前仅为 Dummy 页面。详细范围参见 [模块 2.1 看板说明](docs/module-02-dashboard-spec.md)。

岩点扫描建档会先保存不可变的手机扫描 GLB，再由后台自动生成档案展示级模型。建档和库存登记不等待模型清理；当前处理结果不承诺达到后期虚拟定线所需的安装锚点、碰撞体与姿态精度。

## 本地运行

请使用 Node 22 LTS 和 pnpm 11.9.0。

```bash
cp .env.example .env
pnpm install
pnpm services:up
pnpm db:migrate
pnpm dev
```

打开 `http://localhost:3100` 查看 Web 页面；API 的 OpenAPI 文档地址为 `http://localhost:3101/api/docs`。

Web 开发服务与生产构建分别使用 `.next-dev` 和 `.next-build`，因此可以在 `pnpm dev` 运行期间安全执行 `pnpm build`，不会覆盖正在使用的页面样式资源。

## 验证

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

本地 Compose 服务默认使用端口 `5434`、`6380`、`9002` 和 `9003`，可以与之前的 `ClimbingApp` 环境并行运行。

仓库分支、大型三维资产和 CI/CD 边界见 [Git 仓库与 CI 策略](docs/Git仓库与CI策略.md)。
