# POC 当前状态与后续开发交接文档

> 更新日期：2026-09-08
>
> 代码目录：`/Users/flacko/Documents/Codex/SummerIntern/poc`
>
> 当前分支：`main`
>
> 稳定基线：本文档所在提交，包含“反馈与复盘隐藏已删除线路”的本地修复
>
> 部署边界：本次只修改本地代码，**未部署 Azure，未修改云端数据库、WVP、NSG 或 Worker**

## 1. 一句话状态

POC 已从早期“岩点库 + 线路库”扩展为可运行的摄像头视觉闭环：用户通过 SlimSAM 逐块标注线路岩点和起终点，视觉定义与线路版本绑定，实时 Worker 按 API 下发的已发布定义监控并回写真实观察。线路库支持正常、已停用和语义删除，历史数据不物理删除。

## 2. 产品主线

### 2.1 岩点库

- 岩点规格档案、照片和可选 GLB 模型。
- 仓库、上墙、预留、维护数量及不可变库存流水。
- 可选物理单件、RFID 标签、批量盘点与差异分类。
- 原始 GLB 与后台自动清理候选均保留，人工复核是正式使用前提。

### 2.2 线路库

- 创建线路时由系统生成业务编号，保存名称、墙段、难度、颜色、风格和定线员等信息。
- 视觉配置保存原始截图、ROI、每块岩点轮廓、起点和终点，并绑定具体 `routeVersionId`。
- 线路卡片显示截图缩略图，点击后查看完整截图。
- 状态为 `PUBLISHED` 时正常使用；`INACTIVE` 时保留并可恢复/删除；`REMOVED` 时仅保留历史，普通页面不展示。
- 公开二维码反馈是主动反馈样本，不能冒充全馆客流或真实完攀率。

### 2.3 摄像头和视觉 Worker

- `/dashboard/camera` 读取配置化的 WVP/GB28181 实时流，媒体在线状态以服务端实际读取 FLV 字节为准，不以 iframe `onload` 代替。
- 实时截帧失败时可回退到最近成功截图；页面会明确标注截图时间和过期状态。用户已确认该回退图可用于创建线路，前提是人工确认墙面未变化。
- 默认标注流程已简化为“添加岩点 → 紧框单块 → SlimSAM 轮廓 → 标记起终点 → 创建/绑定线路”。
- 再次点击已有轮廓可取消或恢复选择；颜色连通域候选、拆分和合并收纳在“高级修正”。
- Worker 不按颜色或线路名称猜测业务 ID；它通过受保护 API 读取已发布视觉定义，再幂等回写观察。
- Worker 是规则型 POC，当前目标是可解释的粗略识别，不是经过大规模标注数据训练的完美模型。

## 3. 本次第6项修复

问题不是数据库恢复了已删除线路，而是反馈分析查询主动包含了 `REMOVED`。

当前本地行为：

- 线路库默认展示 `PUBLISHED` 和 `INACTIVE`。
- 反馈与复盘也只统计 `PUBLISHED` 和 `INACTIVE`。
- `REMOVED` 线路、版本、反馈和观察仍留在 PostgreSQL 中用于审计和历史追溯。
- 显式的管理/历史查询仍可按 `REMOVED` 读取，没有改变软删除语义。
- 已添加 Service 回归测试，防止分析查询再次把已删除线路带回页面。

涉及文件：

- `apps/api/src/routes/route-operations.service.ts`
- `apps/api/src/routes/route-operations.service.spec.ts`

**这项修复尚未部署到 Azure。** 下次正式发布后云端才会获得相同行为。

## 4. 本地与 Azure 必须分开理解

| 项目     | 本地                                                | Azure 生产                                          |
| -------- | --------------------------------------------------- | --------------------------------------------------- |
| 代码     | 当前 `main` + 本次第6项修复                         | 最后已部署为 `e3c931a` 所在版本；不含本次修复       |
| 数据库   | 本地 PostgreSQL，有开发和历史测试数据               | 独立 PostgreSQL，不会自动跟随本地改动               |
| 摄像头流 | 通过本地 API 访问同一 WVP 流，可受公网/场馆网络影响 | WVP/GB28181 和生产 API 独立运行                     |
| Worker   | 默认未必配置，页面应如实显示                        | 先前已以独立 Compose 项目部署，实际状态需发布前再查 |
| 业务线路 | 本地开发数据                                        | 先前通过受控数据迁移/写入建立过 `W04-260901-001`    |

`W04-260901-001` 不是前端写死的样例；它是生产数据库中的持久化线路及视觉定义。本地和生产显示同一编号不代表两个数据库自动同步。

## 5. Azure 最后已知状态（非本次实时验证）

- 生产域名：`galsync-climbing-demo-01.southeastasia.cloudapp.azure.com`。
- WVP UI 与 API 的 Caddy 路由修复已在 `e3c931a` 中完成，避免 UI 请求落到业务 API 而返回 404。
- Worker 通过内部 Docker 网络解码 WVP HTTP-FLV，不绕公网域名回环，也不对公网开放 Worker 端口。
- 场馆公网 IPv4 曾从 `121.235.3.55` 变为 `121.235.8.140`；当时已手动收紧到新 `/32` 白名单并恢复 GB28181 注册和推流。
- 以上是 2026-09-04 前后的最后已知结果，不是 2026-09-08 的实时运行承诺。下次部署前应重新验证 health、WVP 注册/流、媒体字节探测和 Worker 心跳。

## 6. 重要：当前工作区另有未纳入基线的改动

本次开始前，工作区已存在一组尚未提交的“摄像头动态公网 IP 自动白名单”实验改动，包括：

- API 心跳接口、HMAC 认证、防重放与设备绑定。
- Azure NSG 更新服务及数据库 migration。
- Caddy 内部网关限制、生产 Compose 配置。
- 岩馆侧 `camera-network-agent` 和安装脚本/文档。

这组改动在本次全量 lint、typecheck、unit test 和 build 中未导致失败，但它们：

1. 不属于本次第6项修复。
2. 未经本次专项安全审查、数据库迁移验证和真实 Azure 端到端验证。
3. 未纳入本文档所定义的稳定提交。
4. 不得在下一窗口被当作已发布或已验收功能。

下一窗口的第一步必须先运行 `git status --short`，将这组改动单独建分支/提交或在明确安全后放弃，不要与新功能混杂。

## 7. 关键实现位置

| 功能                      | 位置                                                         |
| ------------------------- | ------------------------------------------------------------ |
| 线路 CRUD、状态与反馈分析 | `apps/api/src/routes/route-operations.service.ts`            |
| 线路库前端                | `apps/web/src/features/routes/route-operations-page.tsx`     |
| 反馈与复盘前端            | `apps/web/src/features/routes/route-analytics-page.tsx`      |
| 摄像头实时页              | `apps/web/src/features/camera/camera-live-page.tsx`          |
| SlimSAM 视觉配置          | `apps/web/src/features/camera/camera-route-configurator.tsx` |
| 单块提示分割              | `apps/web/src/features/camera/prompt-segment-hold.ts`        |
| 截帧与最近成功回退        | `apps/api/src/camera/camera-snapshot.service.ts`             |
| 视觉定义 API              | `apps/api/src/camera/camera-route-definition.service.ts`     |
| 实时 Worker               | `services/vision-worker/live_stream_worker.py`               |
| 摄像头/Worker 设计文档    | `docs/摄像头实时视频与攀岩识别POC.md`                        |
| 可重复生产部署            | `infra/deploy-production.sh`                                 |

## 8. 本地运行与验证

```bash
cd /Users/flacko/Documents/Codex/SummerIntern/poc
pnpm services:status
pnpm dev
```

常用入口：

- Web：`http://localhost:3100`
- API：`http://localhost:3101/api`
- Swagger：`http://localhost:3101/api/docs`
- PostgreSQL：`localhost:5434`
- MinIO Console：`http://localhost:9003`

本次基线验证（2026-09-08）：

- `pnpm lint`：通过。
- `pnpm typecheck`：通过。
- `pnpm test`：通过；API 131 项、Web 33 项，共 164 项单元测试通过；8 项显式数据库集成测试按默认策略跳过。
- `pnpm build`：API 和 Web 生产构建通过。
- 本次未运行数据库 migration，未运行 Azure 或 WVP 外部健康检查。

在提交或部署新功能前，至少执行：

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm --filter @climbing-crm/api db:check
pnpm --filter @climbing-crm/api exec prisma migrate status
```

## 9. 新窗口的开始顺序

1. 先读完本文档和 `docs/摄像头实时视频与攀岩识别POC.md`。
2. 运行 `git status --short` 和 `git log --oneline -10`，不要覆盖第6节的未提交工作。
3. 用本地测试账号确认线路库和反馈复盘页不再显示已删除线路。
4. 在新目标明确前不修改 Azure；任何部署都要单独授权，并先备份、预检 migration、再执行服务和媒体健康检查。
5. 若下一阶段要继续做 Worker，先保存真实观察数据和失败样本，再调整阈值；不把演示数据写进业务页面。

## 10. 开发与安全纪律

- 本地开发验收后再合并/上线；不直接在生产服务器上开发。
- 不覆盖未知来源的工作区改动，不将无关功能混入基线提交。
- 未经明确授权，不推远程、不部署、不运行云端 migration、不修改 NSG 或 WVP。
- `.env`、`.env.production`、密码、Token、对象存储密钥、SSH 私钥和数据库备份不得提交。
- 摄像头 PTZ、变焦、分辨率或安装位置改变后，原视觉定义可能失效，必须停止相关监控并重新标定。
