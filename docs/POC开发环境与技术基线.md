# POC 开发环境与技术基线

> 状态：本地开发基础环境已完成并验证；可开始生成 POC 工程骨架  
> 最后更新：2026-07-24

## 1. 已确认的技术决策

POC 采用 TypeScript 模块化单体。目标是以企业级 SaaS 的工程规范快速验证单馆场景，同时保留未来多租户、媒体处理与视觉服务的扩展边界。

| 层级            | 选型                                                | 决策理由                                                                                |
| --------------- | --------------------------------------------------- | --------------------------------------------------------------------------------------- |
| Monorepo        | pnpm workspace + Turborepo                          | 两位开发者共享类型、接口契约、校验规则和配置，减少前后端漂移                            |
| 管理端与扫码 H5 | Next.js + React + TypeScript                        | 同一 Web 技术栈覆盖老板/员工后台与用户扫码页；适合 SEO 非关键的 SaaS 应用               |
| API             | NestJS + Fastify + TypeScript                       | 模块、依赖注入、鉴权、校验、OpenAPI 和测试边界清晰；Fastify 更适合 API 性能与结构化日志 |
| 数据库          | PostgreSQL                                          | 多租户、关系数据、审计、聚合指标和事务都适用                                            |
| 数据访问        | Prisma                                              | 类型安全、迁移和团队可读性优先；任何结构变更必须通过 migration                          |
| 缓存/任务       | Redis                                               | 会话、限流、异步任务；视频转码/指标聚合不可放在 HTTP 请求内                             |
| 本地媒体        | MinIO（S3 兼容）                                    | 本地模拟对象存储；生产可替换腾讯 COS 或阿里云 OSS                                       |
| 身份            | POC：邮箱+密码；后续：手机号、微信 OAuth            | 员工/老板使用自建账号；Beta 投稿的微信身份为后续增强，保留短信备用                      |
| API 契约        | REST + OpenAPI                                      | 对管理端和 H5 清晰、易测试；不在 POC 引入 GraphQL                                       |
| 校验            | Zod DTO 校验                                        | 在 Web 表单和 API 边界统一校验规则                                                      |
| 测试            | Vitest + Playwright                                 | 单元/集成测试与关键端到端路径测试                                                       |
| 质量与 CI       | ESLint、Prettier、TypeScript strict、GitHub Actions | 每次 PR 执行 lint、typecheck、test 和 build                                             |
| 未来视觉能力    | 独立 Python 服务                                    | 仅当摄像头 POC 立项后引入；不污染当前业务 API                                           |

## 2. 推荐仓库结构

```text
ClimbingApp/
├── apps/
│   ├── web/                 # Next.js：管理台与扫码 H5
│   └── api/                 # NestJS：业务 API、认证、任务触发
├── packages/
│   ├── api-contract/        # OpenAPI 生成类型或共享 DTO
│   ├── config/              # ESLint、TypeScript、测试配置
│   └── ui/                  # 可复用界面组件（只在确有复用后创建）
├── infra/
│   └── compose.yaml         # PostgreSQL、Redis、MinIO 本地依赖
├── docs/
├── .env.example             # 仅变量名和示例值，绝不提交真实密钥
├── pnpm-workspace.yaml
├── turbo.json
└── README.md
```

初始阶段不拆微服务、不引入 Kubernetes、不接入云端数据库。API 内部按 `auth`、`organizations`、`memberships`、`walls`、`routes`、`feedback`、`beta`、`analytics`、`media`、`audit` 分模块。

## 3. 本地依赖与状态

| 项目                  | 基线                           | 当前检查结果                                                                           | 动作                                                         |
| --------------------- | ------------------------------ | -------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| macOS / Apple Silicon | 支持                           | macOS 15.1 / arm64                                                                     | 已满足                                                       |
| Node.js               | **22 LTS**，由项目版本文件锁定 | 已安装 Node 22.23.1，路径为 `/opt/homebrew/opt/node@22/bin/node`；系统默认仍为 Node 25 | 通过 README 中的项目级 PATH 使用 Node 22，不覆盖系统默认版本 |
| pnpm                  | 已固定项目版本                 | 已安装 v11.9.0                                                                         | 初始化时在 `package.json` 锁定团队版本                       |
| Docker Desktop        | 已启动且未暂停                 | 引擎正常运行，v29.6.1；Docker Hub 拉取已恢复                                           | 已满足                                                       |
| Docker Compose        | v2+                            | 已安装 v5.2.0                                                                          | Compose 配置、容器启动和健康检查均已验证                     |
| Git                   | 2.x                            | 已安装 v2.52.0，项目已初始化 `main` 分支                                               | 已满足                                                       |
| GitHub CLI            | 推荐                           | 已安装 v2.96.0，且已登录                                                               | 已满足；创建私有远程仓库前再确认仓库名称                     |
| Spec Kit              | v0.13.0，Codex 集成            | 已用 `uv` 安装并初始化；项目技能在 `.agents/skills/`                                   | 已满足；`~/.local/bin` 应在开发者终端 PATH 中                |
| GitHub 私有仓库       | 必需                           | 用户有 GitHub 账号，本地仓库已初始化但无远程仓库                                       | 确定仓库名称后创建私有远程仓库并推送                         |
| HTTPS / 备案域名      | 微信 OAuth 前必需              | 当前没有                                                                               | 不阻塞邮箱登录 POC；阻塞正式微信 OAuth                       |

## 4. Docker 本地服务

恢复 Docker 后，Compose 只启动以下依赖：

| 服务       | 本地用途                               | 数据持久化    |
| ---------- | -------------------------------------- | ------------- |
| PostgreSQL | 账户、租户、路线、反馈、审计和聚合数据 | Docker volume |
| Redis      | 会话、限流、任务队列                   | Docker volume |
| MinIO      | Beta 视频、照片、施工图导出            | Docker volume |

开发服务端口应通过 `.env` 配置，默认端口仅供本机使用，不暴露到公网。每位开发者使用独立本地数据卷和示例种子数据，禁止提交数据库导出和视频文件。

NestJS 开发监视进程输出到 `apps/api/.dist-dev`，生产构建输出到 `apps/api/dist`。两个目录必须隔离，避免运行 `pnpm build` 时重建生产目录并使正在运行的开发 API 停留在旧路由。两类产物均不进入版本库，也不参与 ESLint 扫描。

### Docker 验证结果（2026-07-20）

已移除不可用的公共 Docker 镜像代理并恢复 Docker Hub 拉取。以下镜像已成功拉取：`postgres:17-alpine`、`redis:7-alpine`、`minio/minio:latest`。

项目 Compose 已成功创建独立网络和数据卷，并启动以下服务；全部健康检查通过：

| 服务       | 验证结果                                                           |
| ---------- | ------------------------------------------------------------------ |
| PostgreSQL | `pg_isready` 返回 accepting connections；本机端口 `5434`           |
| Redis      | `redis-cli ping` 返回 `PONG`；本机端口 `6380`                      |
| MinIO      | `mc ready local` 返回 ready；本机 API/Console 端口 `9002` / `9003` |

日常启动和检查命令：

```bash
docker compose --env-file .env -f infra/compose.yaml up -d
docker compose --env-file .env -f infra/compose.yaml ps
```

只有三个服务均为 `healthy` 后，才开始依赖数据库和对象存储的业务代码。

### 岩点与墙面对象存储约定（002 起）

- 岩点扫描使用 MinIO 的 `climbingapp-hold-assets` bucket；桶由应用启动时自动创建，开发者无需手工创建。墙面模块后续使用独立 bucket。
- API 启动时会读取根目录 `.env` 的本机 MinIO 凭据，并将 `MINIO_ROOT_USER`/`MINIO_ROOT_PASSWORD` 作为 API 专用 `MINIO_ACCESS_KEY`/`MINIO_SECRET_KEY` 的本机回退；`apps/api/.env` 可显式覆盖它们。不得把真实值提交到 Git。
- 岩点主模型接受标准 GLB，参考照片接受 JPEG、PNG、WebP、HEIC 和 HEIF；单文件最大 `20MB`，数据库只存对象键和元数据，不存文件内容。
- MinIO Console 仅供本机调试，默认地址为 `http://localhost:9003`；不得把 Console 或 API 端口暴露到公网。

## 5. 代码质量底线

- `main` 分支受保护；所有变更通过功能分支和 Pull Request 合入。
- PR 至少开发者审阅；不直接推送 `main`。
- 数据库 schema 的任何变更必须伴随 Prisma migration 和回滚说明。
- API 变更必须同步 OpenAPI、DTO 校验和至少一个测试。
- 所有业务查询以 `organization_id` 限制；服务端从身份上下文推导租户，不信任前端传来的租户 ID。
- 密钥只放本机 `.env` 或未来云密钥服务，`.env.example` 只含占位符。
- 视频上传必须采用对象存储直传/签名 URL；API 不代理大文件。
- 90 天视频清理由对象存储生命周期规则和应用记录双重保证。

## 6. 开发开始前的最小验收清单

1. Docker Desktop 已启动，`docker info` 能返回服务端版本。已完成。
2. Node 22 LTS 可在终端运行，项目根目录有版本锁定文件。已完成。
3. GitHub CLI 安装并完成登录，或至少确认私有仓库创建方式。已完成。
4. Git 仓库初始化完成，`.gitignore`、`.env.example`、分支规则和 README 已就位。已完成。
5. `docker compose up` 能启动 PostgreSQL、Redis、MinIO，并能通过健康检查。已完成。
6. `pnpm install`、lint、typecheck、test 和 build 在开发者机器上可复现。等待 POC 工程骨架生成后验证。

基础服务可用；在生成业务代码后，完成第 6 项的双开发者复现验证，再进入首个业务切片。
