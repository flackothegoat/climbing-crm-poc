# 模块 1——CRM 认证

## 范围

本模块仅提供 CRM 的入口能力：

- 初始页面为邮箱与密码登录。
- 没有账号的用户可以切换到注册页面。
- 注册会在一个事务中创建一个组织和一条 `L1_ADMIN` 成员关系。
- 数据模型预留 `L2_ADMIN`，供后续员工管理模块使用。
- 请求成功后写入 HTTP-only 会话 Cookie，仅展示登录成功确认状态。

## 明确不包含的内容

- 看板、运营页面、成员邀请、密码重置和组织切换。
- L2 账号创建或角色分配界面。
- 基于 Redis 的分布式限流和 MinIO 业务使用；本地服务会保留给后续模块。

## API 契约

| Endpoint                  | Request                                                | Success                                         |
| ------------------------- | ------------------------------------------------------ | ----------------------------------------------- |
| `POST /api/auth/register` | `email`, `password` (12–128 chars), `organizationName` | `201`, session cookie, organization, `L1_ADMIN` |
| `POST /api/auth/login`    | `email`, `password`                                    | `200`, session cookie, organization, role       |
| `GET /api/health`         | —                                                      | `200`                                           |

失败响应统一使用 `{ code, message, correlationId }`。密码不会出现在审计记录或响应中。

## 数据与安全决策

- 账号与组织相互独立；由 `Membership` 承载角色，为未来的多租户访问保留扩展空间。
- 密码使用 12 轮 bcrypt；会话令牌使用随机生成的 32 字节值，数据库只保存 SHA-256 哈希。
- 注册和登录按标准化邮箱在 PostgreSQL 中限流。当前方案适用于单实例 POC，后续可以迁移到 Redis，而无需改变认证 API。
- 初始数据结构通过 Prisma migration 管理。migration SQL 中注明了回滚顺序；生产环境必须使用经过评审的显式 migration 回滚，不能自动执行破坏性操作。
