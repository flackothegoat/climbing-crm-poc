# Git 仓库、分支与 CI/CD 策略

> 日期：2026-08-07  
> 适用范围：`/Users/flacko/Documents/Codex/SummerIntern/poc`

## 1. 仓库定位

`poc` 作为独立私有 Git 仓库维护，不继承旧项目 `ClimbingApp` 的历史。`main` 的第一次提交是当前可运行 POC 的基线。

本地 PostgreSQL 备份、`.env`、生产环境文件、SSH 私钥、Docker 数据卷和生成产物不得进入 Git。

## 2. 分支策略

当前团队规模使用一个长期主线加短生命周期分支即可，不建立长期 `develop`：

```text
main
  ├── feature/wall-installation
  ├── feature/route-lifecycle
  ├── fix/observation-idempotency
  └── docs/field-survey-checklist
```

- `main`：始终保持可构建、可演示，是后续部署来源。
- `feature/*`：一个业务切片一个分支，合并后删除。
- `fix/*`：缺陷修复，合并后删除。
- `docs/*`：纯文档或交接更新，合并后删除。
- 功能开发通过 Pull Request 合并到 `main`，默认 squash merge。
- 不把多个互不相关的功能放入同一分支或 PR。
- 当前不需要 `develop`、release train 或 GitFlow；发布节奏增加后再引入 `release/*` 标签或分支。

因此，“`main` + feature”足够，但 feature 是分支类型，不是一条永久存在的第二主线。

## 3. 大型三维文件策略

当前网页使用的 `tianyu-1f-scan.glb` 约 27 MB，作为 Demo 运行必需资产，可在本次基线中直接进入普通 Git。

边界如下：

- 经过清理、网页运行必需且单文件小于 50 MiB 的 GLB 可以进入 Git。
- 单文件接近或超过 50 MiB 时，不再直接提交；先评估 Git LFS 或对象存储。
- 原始点云、高精度母版、批量扫描中间产物和可再生成的 QA 输出不进入 Git，继续保存在受控文件存储或 MinIO/Azure Blob。
- 任何超过 GitHub 普通 Git 100 MiB 硬限制的文件必须使用 Git LFS 或外部存储。
- 引入 Git LFS 前应确认协作者、CI、存储和带宽额度；不要在文件已进入长期历史后才临时迁移。

当前机器未安装 Git LFS，且只有一个 27 MB 必需资产，因此本次不引入 Git LFS。

## 4. CI 策略

从第一次推送开始启用最小 GitHub Actions CI：

- 触发：Pull Request，以及向 `main` 推送。
- Node：`22.23.1`。
- pnpm：读取根 `package.json` 中的 `11.9.0`。
- 检查：依赖锁定安装、Prisma Client 生成、ESLint、TypeScript、测试和生产构建。
- 不在 CI 中连接正式数据库、MinIO 或 Azure。
- Workflow 只授予 `contents: read` 权限。

仓库创建后建议为 `main` 开启分支保护：要求 CI 通过后才能合并，并禁止 force push。若目前只有一个开发者，可暂不强制审批人数。

## 5. CD 策略

当前不启用自动 CD，原因是：

- Azure Southeast Asia 是唯一正式 Demo 环境。
- 数据库 migration 和现场数据模型仍在快速演进。
- 尚未建立自动备份、迁移前检查、失败回滚和独立 staging 环境。
- Dummy 数据和正式数据边界仍需人工确认。

近期继续按部署文档人工发布。满足以下条件后再增加手动触发的 CD：

1. CI 稳定通过。
2. 生产数据库自动备份及恢复演练完成。
3. migration 使用生产安全的 `prisma migrate deploy`。
4. 镜像或提交 SHA 可追溯并可回滚。
5. 部署后健康检查和冒烟测试自动化。
6. GitHub Environment 配置审批与最小权限 secrets。

第一版 CD 应使用 `workflow_dispatch` 人工触发；不建议一开始就让每次合并 `main` 自动更新正式 VM。
