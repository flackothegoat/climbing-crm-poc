# POC 当前状态与后续开发交接文档

> 更新日期：2026-09-11
>
> 代码目录：`/Users/flacko/Documents/Codex/SummerIntern/poc`
>
> 发布基线：以 `main` 和最新 `release-*` 标签为准，不以服务器目录中的散落文件判断版本
>
> 稳定基线：本文档所在提交，包含本地 Vision Worker、识别历史、录像证据、人工复核、单线路双来源复盘、线路管理界面优化和无人画面误报防护
>
> 部署边界：Azure 已部署 `release-2026-09-11` / `9e59ca8`；完整验证、备份与回退点见 `docs/发布记录-2026-09-11.md`

## 1. 一句话状态

POC 已从早期“岩点库 + 线路库”扩展为可运行、可追溯的摄像头视觉闭环：用户通过 SlimSAM 标注线路，实时 Worker 只监控 API 下发的已发布定义，回写真实观察并为有效线路上传短期录像证据；员工可以查询全部历史、查看算法事件并追加人工复核结论。生产与本地 Worker 相互独立，本地更新不会自动进入 Azure。

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
- 全局“反馈与复盘”入口已取消；每张线路卡片提供独立入口，后端按 `routeId` 和 `routeVersionId` 隔离数据。
- 线路概况以紧凑横条放在线路档案上方，不占用档案列表的横向空间；常见桌面宽度可同排三张线路卡片。编辑信息在独立弹窗内完成，不再把长表单插到页面顶部。
- 线路复盘首屏以小卡片展示 16:9 线路缩略图和难度、颜色、墙段、状态；点击缩略图可在弹窗中查看完整截图，没有图片时明确显示空状态。
- 线路复盘分为“摄像头记录”和“扫码反馈”两个易懂区域；无数据时展示空状态，不生成模拟值。
- 算法统计只读取 `source=CAMERA` 的 Worker 落库记录，完攀率为 `COMPLETED / (COMPLETED + FAILED)`，`ABANDONED` 和 `UNKNOWN` 单列。

### 2.3 摄像头和视觉 Worker

- `/dashboard/camera` 读取配置化的 WVP/GB28181 实时流，媒体在线状态以服务端实际读取 FLV 字节为准，不以 iframe `onload` 代替。
- 实时截帧失败时可回退到最近成功截图；页面会明确标注截图时间和过期状态。用户已确认该回退图可用于创建线路，前提是人工确认墙面未变化。
- 默认标注流程已简化为“添加岩点 → 紧框单块 → SlimSAM 轮廓 → 标记起终点 → 创建/绑定线路”。
- 再次点击已有轮廓可取消或恢复选择；颜色连通域候选、拆分和合并收纳在“高级修正”。
- Worker 不按颜色或线路名称猜测业务 ID；它通过受保护 API 读取已发布视觉定义，再幂等回写观察。
- Worker 是可解释的规则型 POC，不是经过大规模标注数据训练的通用裁判模型。
- 进入线路状态机前依次校验画面亮度/过曝、人体检测置信度、躯干与下肢关键点完整性、人体尺寸和无人墙面前景差异。
- 即使候选分析得出结果，发布前仍要求正式起步、足够长的有效人体跟踪、前景确认和足够的可用画面比例；不通过只写诊断日志，不写业务记录。
- 未匹配任何有效线路起步的候选录像和分析目录立即删除，不写业务记录、不上传对象存储。
- 有效识别录像转为无音频 H.264 后流式上传；上传进行 3 次退避重试，并通过轻量恢复记录支持 Worker 重启续传，成功后才删除原片，异常残留最多保留 24 小时。

### 2.4 识别历史与人工复核

- 摄像头页的标题统一为“识别结果”，默认读取最近 10 条，并在区域底部明示口径；完整历史使用服务端游标分页。
- 线路编号/名称、算法结果、复核状态和日期范围筛选始终显示，无需先点“查看全部”。
- 页面区分算法原判、规则型算法评分、人工最终结论和复核状态；不把评分描述为统计正确概率。
- 复核采用不可变追加记录，可以确认原判、改判完攀、改判失败或标记无效；改判和无效必须填写原因。
- 录像通过登录权限和 HTTP Range 播放，不保存到 PostgreSQL，也不提供永久公开地址。
- 页面明确区分历史未留存、处理中、可播放、上传失败和已过期，不把旧记录误报为 Worker 上传失败。
- 普通录像保留 72 小时，待复核 14 天，确认/无效后 72 小时，改判后 30 天；结构化历史永久保留。
- 完整技术边界见 `docs/摄像头识别历史与人工复核设计.md`。

## 3. 近期线路可见性与复盘改进

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

该修复已纳入本次统一发布基线，是否已在 Azure 生效以发布记录中的上线验证为准。

单线路复盘当前行为：

- `GET /api/route-operations/:routeId/analytics` 在组织权限内只返回该线路的非草稿版本。
- Worker 结果按线路版本和原始 outcome 在数据库聚合；扫码反馈按 outcome、难度、喜好和安全疑虑聚合，不把全量明细加载到 API 内存。
- 页面用普通用户能理解的文案区分摄像头记录和扫码反馈；两类数据仍由后端分别统计，不混算。

## 4. 本地与 Azure 必须分开理解

| 项目     | 本地                                                | Azure 生产                                                  |
| -------- | --------------------------------------------------- | ----------------------------------------------------------- |
| 代码     | 本地 `main`；发布后可只增加文档提交                 | `release-2026-09-11` / `9e59ca8`，由 `DEPLOYED_COMMIT` 确认 |
| 数据库   | 本地 PostgreSQL，有开发和历史测试数据               | 独立 PostgreSQL，不会自动跟随本地改动                       |
| 摄像头流 | 通过本地 API 访问同一 WVP 流，可受公网/场馆网络影响 | WVP/GB28181 和生产 API 独立运行                             |
| Worker   | 已绑定“天天攀岩”，可通过本地脚本独立启停和检查心跳  | 已以独立 Compose 项目部署，不受本地 Worker 启停影响         |
| 业务线路 | 本地开发数据                                        | 先前通过受控数据迁移/写入建立过 `W04-260901-001`            |

`W04-260901-001` 不是前端写死的样例；它是生产数据库中的持久化线路及视觉定义。本地和生产显示同一编号不代表两个数据库自动同步。

## 5. Azure 发布前状态（2026-09-11 预检）

- 生产域名：`galsync-climbing-demo-01.southeastasia.cloudapp.azure.com`。
- Web 首页与 `/backend/health` 返回 HTTP 200，API、Web、PostgreSQL 健康，MinIO、Caddy 和独立 Worker 均在运行。
- Prisma 识别到 31 个 migration，生产数据库 schema 已是最新状态。
- 系统盘约 123 GiB，已用约 47 GiB，可用约 77 GiB。
- Worker 通过内部 Docker 网络解码 WVP HTTP-FLV，不绕公网域名回环，也不对公网开放 Worker 端口。
- GB28181 当前仍依赖场馆公网 IPv4 `/32` 入站白名单；预检时 NSG 中的场馆地址为 `121.235.8.173/32`。公网 IP 再次变化时，必须先人工确认新地址再收紧更新。

正式发布后生产数据库共有 33 个 migration，Web/API/Worker 均健康，Worker 成功读取 2 条已发布线路并解码实时流。详情以 `docs/发布记录-2026-09-11.md` 为准。

## 6. 重要：动态公网 IP 实验已隔离

此前工作区中的“摄像头动态公网 IP 自动白名单”实验改动已原样保存至本地分支 `feature/camera-dynamic-ip-allowlist-wip`，提交为 `40cbd14`，包括：

- API 心跳接口、HMAC 认证、防重放与设备绑定。
- Azure NSG 更新服务及数据库 migration。
- Caddy 内部网关限制、生产 Compose 配置。
- 岩馆侧 `camera-network-agent` 和安装脚本/文档。

这组改动不在当前 `main` 工作区中，且：

1. 不属于本次第6项修复。
2. 未经本次专项安全审查、数据库迁移验证和真实 Azure 端到端验证。
3. 未合并到本文档所定义的稳定基线。
4. 不得在下一窗口被当作已发布或已验收功能。

后续若继续该功能，应从上述分支恢复并先做专项安全审查、migration 验证和真实 Azure 端到端验收；不要把它与其他功能发布混杂。

## 7. 关键实现位置

| 功能                              | 位置                                                         |
| --------------------------------- | ------------------------------------------------------------ |
| 线路 CRUD、状态与单线路双来源分析 | `apps/api/src/routes/route-operations.service.ts`            |
| 线路库前端                        | `apps/web/src/features/routes/route-operations-page.tsx`     |
| 反馈与复盘前端                    | `apps/web/src/features/routes/route-analytics-page.tsx`      |
| 摄像头实时页                      | `apps/web/src/features/camera/camera-live-page.tsx`          |
| SlimSAM 视觉配置                  | `apps/web/src/features/camera/camera-route-configurator.tsx` |
| 单块提示分割                      | `apps/web/src/features/camera/prompt-segment-hold.ts`        |
| 截帧与最近成功回退                | `apps/api/src/camera/camera-snapshot.service.ts`             |
| 视觉定义 API                      | `apps/api/src/camera/camera-route-definition.service.ts`     |
| 实时 Worker                       | `services/vision-worker/live_stream_worker.py`               |
| 识别历史与复核前端                | `apps/web/src/features/camera/camera-observation-panel.tsx`  |
| 识别历史与复核 API                | `apps/api/src/camera/camera-observation.service.ts`          |
| 录像证据与过期                    | `apps/api/src/camera/camera-observation-evidence.service.ts` |
| 本地 Worker 启动与检查            | `infra/run-local-vision-worker.sh` 等本地脚本                |
| 摄像头/Worker 设计文档            | `docs/摄像头实时视频与攀岩识别POC.md`                        |
| 可重复生产部署                    | `infra/deploy-production.sh`                                 |

## 8. 本地运行与验证

```bash
cd /Users/flacko/Documents/Codex/SummerIntern/poc
pnpm services:status
pnpm dev
# 另一个终端
pnpm worker:start
# 随时检查心跳
pnpm worker:status
```

本地页面只读取本地 API 收到的 Worker 心跳，与 Azure 上运行的 Worker 相互独立；因此 Azure 显示“实时算法监控中”时，本地仍可能因本地进程未启动而显示离线。`status.json` 只是最后一次心跳快照，不能单独证明进程仍在运行，统一使用 `pnpm worker:status` 同时检查进程和心跳。

修改或调试 Worker 前可执行 `pnpm worker:stop`。开发结束前必须执行 `pnpm worker:restore`，它会停止受管旧进程、使用当前工作区代码启动最新版并等待本次启动产生健康心跳；随后再执行 `pnpm worker:status` 复核。需要观察前台日志时可临时使用 `pnpm worker:dev`，但关闭终端会结束该进程，退出前仍须恢复受管 Worker。

常用入口：

- Web：`http://localhost:3100`
- API：`http://localhost:3101/api`
- Swagger：`http://localhost:3101/api/docs`
- PostgreSQL：`localhost:5434`
- MinIO Console：`http://localhost:9003`

本次发布候选基线验证（2026-09-11）：

- `pnpm lint`：通过。
- `pnpm typecheck`：通过。
- `pnpm test`：通过；当前为 API 127 项、Web 33 项，共 160 项单元测试通过；8 项显式数据库集成测试按默认策略跳过。
- `pnpm worker:test`：29 项 Worker 测试通过。
- `pnpm build`：API 和 Web 生产构建通过。
- 本地 migration 已应用至 `20260908170000_camera_observation_evidence_constraints`，数据库不变量全部为 0。
- 本地页面已验证识别筛选始终可见、默认最近 10 条提示、每张线路卡片的独立复盘入口，以及算法/扫码双区域空数据展示。
- 本地浏览器已验证线路概况横条、1280px 宽度三列线路卡片、编辑信息弹窗、复盘缩略图/完整截图弹窗和简化后的复盘文案。
- 视觉门控回归测试覆盖空画面、不完整人体、无前景变化、低照度和发布前二次拦截。
- 本地 Worker 与 Azure Worker 分开运行；本地开发结束前按上述流程恢复并验活当前工作区版本。若媒体流不可用，不把该状态直接描述为算法故障，应先核对场馆当前公网 IP、GB28181 注册与 WVP 媒体流。

在提交或部署新功能前，至少执行：

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm worker:test
pnpm build
pnpm --filter @climbing-crm/api db:check
pnpm --filter @climbing-crm/api exec prisma migrate status
```

## 9. 新窗口的开始顺序

1. 先读完本文档和 `docs/摄像头实时视频与攀岩识别POC.md`。
2. 运行 `git status --short` 和 `git log --oneline -10`；动态公网 IP 实验只存在于第6节所列独立分支。
3. 用本地测试账号确认线路库和反馈复盘页不再显示已删除线路。
4. 在新目标明确前不修改 Azure；任何部署都要单独授权，并先备份、预检 migration、再执行服务和媒体健康检查。
5. 若下一阶段要继续做 Worker，先保存真实观察数据和失败样本，再调整阈值；不把演示数据写进业务页面。

## 10. 开发与安全纪律

- 默认只在短生命周期 feature/fix 分支开发，验收后合并本地 `main`；不直接在生产服务器上开发。
- 合并本地 `main` 不代表自动发布。只有用户明确要求“上线新版本”时，才汇总待发布提交并同步 Azure；多个小功能可以累计后一次发布。
- 不覆盖未知来源的工作区改动，不将无关功能混入基线提交。
- 未经明确授权，不推远程、不部署、不运行云端 migration、不修改 NSG 或 WVP。
- `.env`、`.env.production`、密码、Token、对象存储密钥、SSH 私钥和数据库备份不得提交。
- 摄像头 PTZ、变焦、分辨率或安装位置改变后，原视觉定义可能失效，必须停止相关监控并重新标定。
