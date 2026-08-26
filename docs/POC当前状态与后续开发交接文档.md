# POC 当前状态与后续开发交接文档

> 保存日期：2026-08-26
>
> 工作目录：`/Users/flacko/Documents/Codex/SummerIntern/poc`
>
> 安全主线：`main`，当前提交 `f44492b`
>
> 当前开发分支：`feature/rfid-inventory-session`；业务代码基线为 `371b449`，其后只有本交接文档更新
>
> 当前分支基于此前已验收的 feature 提交链；业务代码基线相对 `main` 领先 8 个提交，本交接文档另有 1 个提交。尚未合并、尚未推送本轮改动、尚未部署到 Azure。

## 1. 一句话说明当前状态

当前 POC 只保留两条产品主线：

1. **岩点库**：让岩馆知道有哪些岩点、长什么样、数量多少、每个已追踪实物在哪里，并为后续租借业务积累可信资产数据。
2. **线路库**：让岩馆把线路建档、标记实际墙面位置、发布二维码、收集反馈并复盘。

近期开发集中在岩点库，已经从“规格档案 + 数量库存”向下扩展了两个可选层：自动 GLB 清理和物理岩点/RFID 追踪。它们没有改变线路库第一阶段边界，也没有恢复旧 W06 虚拟定线工作台。

认证、员工权限、租户隔离、审计、对象存储、错误兜底和数据库约束仍是两条主线共用的工程底座。

## 2. 当前产品边界与核心关系

```text
岩点库                                      线路库
同款岩点规格（型号、品牌、颜色、模型）       线路档案与不可变发布版本
数量库存（仓库、上墙、预留、维护）           跨相邻墙段的位置表达
可选物理单件（资产码、状态、当前场馆）       W03–W05 视觉标注与 S/T
可选 RFID 标签和批量盘点                     二维码匿名反馈与版本复盘
不可变库存/实物事件流水                       未来摄像头事件独立记录来源
```

三条必须保持清楚的口径：

- 规格档案回答“这是什么岩点”；数量库存回答“这一款共有多少”；物理单件回答“其中哪一颗被单独追踪”。
- 数量字段继续保留。岩馆约 3000+ 岩点不要求一开始全部建立单件行；`QUANTITY / HYBRID / SERIALIZED` 三种模式支持渐进式追踪。
- RFID 读取目前只用于盘点和发现差异，不因“读到标签”自动改变库存、所有权、保管方或租借关系。

线路第一阶段仍不要求逐颗绑定岩点库存。只有真实定线/拆线施工流程经过验证后，才考虑把物理岩点和线路安装联动。

## 3. 当前用户可见入口

登录后侧边栏只保留：

- 总览：`/dashboard`
- 岩点库：`/dashboard/assets/holds`
- 线路库：`/dashboard/assets/routes`
- 员工管理：`/dashboard/team`

岩点库右侧现在包含：

- 首次盘点工具：建立规格级初始数量。
- RFID 批量盘点：创建盘点快照、粘贴/上报 EPC、查看差异、完成或取消。

线路“反馈与复盘”并入线路库。公开会员反馈页为 `/r/:token`。

已删除入口继续返回 404：墙面资产页、旧虚拟定线页、独立数据页及其他 Dummy 页面。

## 4. 岩点库当前完成度

### 4.1 规格档案与数量库存

- 同款岩点用一条规格档案表示，不按数量重复建规格。
- 档案记录用途分类、名称、品牌、业务颜色、尺寸、固定方式、SKU、照片和可选 GLB。
- 库存分为仓库、已上墙、预留、维护四个桶。
- 支持初始化盘点、入库/调整、库存流水、撤销、停用、恢复和受约束删除。
- 列表展示品牌、类型、库存/上墙数量、总量、模型状态；点击查看完整档案和实物单件。
- 库存写入带组织事务锁、幂等键、乐观版本和审计。

### 4.2 非阻塞 GLB 自动清理

提交 `973d8b2` 已实现后台模型处理骨架：

- 普通用户上传手机扫描得到的原始 `MODEL_SOURCE` GLB。
- 后端建立 `HoldModelProcessingJob`，异步执行 `apps/api/scripts/hold-model-processor.py`。
- 处理器尝试移除扫描桌面/背景、保留岩点纹理并生成独立 `MODEL_3D` 输出及处理报告。
- 状态包括 `QUEUED / PROCESSING / COMPLETED / NEEDS_REVIEW / FAILED / CANCELLED`，失败可重试；超时和僵尸任务有兜底。
- 原始母版与清理后版本同时保留在对象存储，数据库只保存对象键、元数据和任务关系。
- 当前目标是网页查看和资产识别，不以未来施工级定线精度阻塞前期入库；人工复核仍是正式使用前的门槛。

该流水线不承诺自动识别品牌、型号、真实尺寸、安装孔，也不等同于单图生成三维模型。

### 4.3 物理岩点层

提交 `dc388ee` 建立了可选物理单件模型：

- `HoldUnit`：资产码、规格、所有者组织、当前保管组织、当前场馆、物理状态、运维状态和版本。
- `HoldUnitRegistrationBatch`：批量登记单件，避免逐颗手工创建。
- `RfidTag / HoldUnitTagBinding`：UHF EPC 标签及绑定历史。
- `HoldUnitEvent`：登记、绑定、移动、核验、退役等不可变流水。
- 物理状态：`WAREHOUSE / INSTALLED / IN_TRANSIT / UNKNOWN`。
- 运维状态：`ACTIVE / MAINTENANCE / LOST / RETIRED`。

数量库存是总账，物理单件是可追踪明细。数据库不变量阻止已追踪有效单件超过规格库存，并按追踪模式校验两者关系。

### 4.4 RFID 批量盘点

提交 `841af2b` 已实现完整的安全盘点会话：

- 按“组织 + 场馆 + 目标状态（仓库/已上墙）”创建盘点。
- 创建时冻结“应到的已绑定有效单件”快照，后续单件位置变化不会改写历史应到口径。
- 每批最多接收 500 条 EPC；统一去除分隔符并转大写，保留重复读取次数。
- 匹配结果分为：位置符合、位置异常、标签未绑定、未知标签；另计算应到但未读到。
- 会话、读取批次和完成/取消均支持幂等、乐观锁、审计和数据库级租户/操作者约束。
- 完成盘点只为位置符合的单件写入 `INVENTORY_CONFIRMED` 事件；不自动改库存、场馆、所有权或保管方。
- 取消和未完成盘点保留已读数据供审计，但不产生资产变更。
- 其他组织的标签按未知标签返回，不泄露外馆资产信息。

前端目前支持粘贴读写器 EPC 输出。实际硬件协议确定后，应新增薄适配器调用同一读取批次 API，不把串口/SDK 逻辑塞进业务 Service。

### 4.5 2026-08-26 RFID 报错修复

提交 `371b449` 修复了既有岩馆无法创建盘点快照的问题：

- 历史迁移给默认场馆生成的 ID 为 `facility_default_<organizationId>`，不是 CUID。
- RFID DTO 曾错误使用 `z.string().cuid()`，因此在进入业务逻辑前返回 `Invalid cuid`。
- 现在数据库实体 ID 使用共享 `databaseIdSchema`，按受限字符集和长度校验，兼容 CUID、UUID 和稳定前缀 ID。
- 幂等 `requestKey` 仍严格使用 UUID，不降低请求安全性。
- 同步替换岩点扫描/初始化 DTO 中相同的实体 ID 误用，防止出现下一个同类错误。
- 已用隔离测试岩馆和 `facility_default_<UUID>` 真实走通创建快照、EPC 上报、归一化和重复计数，测试数据随后清理。

工程规则：数据库 ID 对 API 客户端是**不透明字符串**，不得再根据当前 Prisma 默认生成器假设所有历史 ID 都是 CUID。

### 4.6 岩点库当前明确不做

- 不实现完整租借合同、计费、押金、物流或跨馆自动调拨。
- 不因岩馆 B 扫到岩馆 A 标签就自动转移所有权或库存；未来必须通过发出、在途、签收等显式业务单据。
- 不要求 3000+ 岩点立即全部序列化或贴标签。
- 不自动把墙面扫描中的岩点匹配到库存单件。
- 不要求普通用户使用 Blender，也不承诺施工级 GLB。

## 5. 线路库当前完成度

### 5.1 线路运营闭环

- 创建草稿并记录编号、名称、业务颜色、难度、评级体系、风格、定线员、说明、照片和计划拆线日。
- 一条线路可关联多个相邻墙段，位置按有序墙段表达，例如“一楼抱石区 · W04 → W05”。
- 发布生成不可变版本和签名公开 Token，可打印二维码。
- 会员无需登录即可提交完攀状态、实际难度、喜好、安全感和文字建议。
- 下线停止新反馈，但版本、照片和历史反馈保留。
- 反馈复盘显示样本量，主动二维码反馈不能冒充全馆真实客流。

### 5.2 W03–W05 视觉试点

- 试点模型：`apps/web/public/walls/regions/w03-w05-pilot.glb`，约 5 MB。
- 线路视觉标注使用墙段局部 `0..1` 坐标，可跨 W03/W04/W05，不绑定 GLB 网格拓扑。
- 标注有草稿与确认修订；只有确认版本用于正式展示和公开页。
- 选择线路后，目标业务颜色保留原纹理并显示黄色近似轮廓，其他区域灰度；S/T 标识起终点。
- 正立面是模型不可用或颜色分割不可靠时的稳定回退。
- 当前颜色分割是浏览器 Shader 候选效果，不是可靠的 AI 岩点实例识别。

### 5.3 线路库当前明确不做

- 不恢复 W06 参数墙、588 个估算孔位和拖拽岩点虚拟定线工作台。
- 不实现精确孔位吸附、碰撞、拆线和逐颗安装联动。
- 不把颜色当作线路 ID；身份仍由 `routeId + routeVersion` 决定。
- 不在没有现场视频样本前开发尝试/完攀自动识别。

## 6. 近期开发提交与意图

当前 feature 提交链（从旧到新）：

| 提交      | 内容                      | 意图                               |
| --------- | ------------------------- | ---------------------------------- |
| `94f9f96` | 减法前检查点              | 保留可恢复历史，不让删减不可逆     |
| `8a9b4ab` | POC 收敛为岩点库 + 线路库 | 删除 Dummy/旧虚拟定线运行时        |
| `973d8b2` | 非阻塞岩点 GLB 清理       | 普通用户无需 Blender，低精度先入库 |
| `dc388ee` | 物理岩点与 RFID 标签层    | 为单件追踪和未来租借打底           |
| `0d9df91` | 简化岩点库工作区          | 控制物理层增加后的界面复杂度       |
| `e9b19ef` | 放大档案模型预览          | 改善人工查看模型体验               |
| `841af2b` | 安全 RFID 批量盘点        | 先建立可信核验，不自动改资产归属   |
| `371b449` | 兼容历史数据库 ID         | 修复既有岩馆创建快照 400           |

这些提交目前都在 feature 链上，`main` 尚未移动。不要只 cherry-pick 最后一个修复而遗漏其依赖；若合并，应审查并合并整条已验收提交链，或先有意识地整理/压缩提交。

## 7. 数据可信度

| 数据类型                   | 当前口径                                        |
| -------------------------- | ----------------------------------------------- |
| 岩点规格与数量库存         | PostgreSQL 持久化业务数据；准确性取决于人工盘点 |
| 物理单件与 RFID 绑定       | 持久化资产明细；只覆盖已登记/贴标部分           |
| RFID 盘点结果              | 会话时点核验数据；不等于自动资产调拨            |
| 原始/清理后岩点 GLB        | 扫描资产及自动候选结果；正式使用前需人工复核    |
| 线路档案、版本、二维码反馈 | PostgreSQL 持久化业务数据                       |
| W03–W05 GLB                | 现场重扫试点资产；不是施工级测绘                |
| 颜色轮廓                   | 浏览器端纹理候选分割；需人工确认                |
| 摄像头数据                 | 目前只有传输链路验证，没有可靠业务事件          |

## 8. 摄像头状态

- 试验型号：TP-LINK `TL-IPC48AN`，800 万像素、RTSP、非 PoE、电动变焦云台。
- 公司网络已跑通：摄像头 → Wi-Fi → 公网 → Azure GB28181 平台 → 浏览器实时显示。
- 尚待岩馆验证：Wi-Fi 覆盖、上行稳定性、NAT/公网 IP、机位、遮挡、逆光、夜间画质、时间同步和隐私告知。
- 摄像头仍是后续增强。当前不显示虚假实时画面，也不生成模拟 AI 分析结果。
- 现场部署前，不把摄像头接入与 RFID/租借开发耦合。

## 9. 本地运行、数据库与验证

```bash
cd /Users/flacko/Documents/Codex/SummerIntern/poc
pnpm services:status
pnpm dev
```

本地入口：

- Web：`http://localhost:3100`
- API：`http://localhost:3101/api`
- Swagger：`http://localhost:3101/api/docs`
- PostgreSQL：`localhost:5434`
- MinIO Console：`http://localhost:9003`

当前本地数据库已应用 30 个 migration。RFID 开发前备份：

`/Users/flacko/Documents/Codex/SummerIntern/poc/backups/local-postgres-before-rfid-session-20260826.sql`

提交前至少执行：

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm --filter @climbing-crm/api db:check
pnpm --filter @climbing-crm/api exec prisma migrate status
```

2026-08-26 最终验证：

- ESLint、TypeScript、生产构建通过。
- API 95 项单元测试通过；Web 22 项测试通过。
- 8 项 PostgreSQL 领域约束集成测试在显式数据库开关下通过。
- 数据库不变量全部为 0；30 个 migration 全部应用。
- 本地 API `/api/health` 返回 `status: ok`。
- 浏览器真实回归通过 `facility_default_<UUID>` 创建 RFID 快照和 EPC 上报。

## 10. Git、Azure 与开发纪律

- `main`：`f44492b`，作为安全基线；本地比 `origin/main` 多 1 个基线提交。
- 当前分支：`feature/rfid-inventory-session`；业务代码基线 `371b449` 相对 `main` 领先 8 个提交，其后只有本交接文档更新。
- 相关中间分支：`feature/route-core-replan`、`feature/hold-unit-tracking`。
- 本轮只改本地代码、本地 PostgreSQL 和本地开发进程。
- 没有修改 Azure VM、Azure PostgreSQL、云端 MinIO、域名、网络、摄像头平台或 GB28181 配置。
- 未经用户明确批准，不合并 `main`、不推远程、不运行云端 migration、不部署。
- `.env`、`.env.production`、密码、MinIO 密钥、SSH 私钥、数据库卷、`node_modules`、`.next-*` 和本地备份不得提交。

## 11. 下一窗口建议顺序

不要立刻扩展租借 SaaS 或摄像头算法。先把已建骨架用真实小样本跑通：

1. **人工复测本次修复**：在“天天攀岩”登录后创建仓库 RFID 盘点快照，确认不再出现 `Invalid cuid`。
2. **建立 5–20 颗真实测试单件**：从已有规格批量登记，绑定实际 EPC，覆盖仓库和已上墙两种状态。
3. **验证完整差异矩阵**：分别制造位置符合、位置异常、未绑定、未知、未读到五类结果，完成和取消各一次，核对库存/所有权没有被自动修改。
4. **接读写器样例**：拿到真实硬件输出格式或 SDK 后，新建独立 adapter；先把批量 EPC 转发到现有 reads API，不改核心匹配逻辑。
5. **继续验证模型清理**：用 5–10 个不同大小/颜色/桌面背景的真实扫描，记录 `COMPLETED / NEEDS_REVIEW / FAILED`，不要先追求施工级模型。
6. 上述通过后，再设计租借领域：租借单、发出批次、在途、接收确认、归还和异常；扫描只能作为单据操作的证据，不能单独触发跨馆资产转移。
7. 线路库保持当前 W03–W05 试点，不在这一轮同时扩建 AI 定线或摄像头识别。

## 12. 工程边界与易错点

- 所有业务查询和写入必须按 `organizationId` 隔离。
- Controller 只做路由和参数解析；租户过滤、状态机和事务属于 Service。
- 数据库变化必须带新 migration、约束和测试；不得改写已应用 migration。
- 数据库实体 ID 是不透明字符串，使用 `apps/api/src/common/database-id.ts`；只对 requestKey/token 等协议字段使用 UUID/CUID 专用校验。
- 数量总账、物理单件、标签绑定和事件流水必须可对账，不允许只更新其中一层。
- 跨馆扫描不得隐式改变 `ownerOrganizationId` 或 `currentCustodianOrganizationId`。
- 二进制文件进入对象存储，PostgreSQL 只保存对象键和元数据。
- 线路统计按版本聚合；主动反馈、人工观察和未来摄像头事件必须分开来源。
- 任何估算、候选识别和真实数据都必须在 UI 明确区分。
- 不为假设需求提前引入微服务、消息队列、Kubernetes 或复杂 AI 管线。

## 13. 关键代码与资产路径

- Prisma：`/Users/flacko/Documents/Codex/SummerIntern/poc/apps/api/prisma/schema.prisma`
- RFID migrations：
  - `apps/api/prisma/migrations/20260826110000_rfid_inventory_session/migration.sql`
  - `apps/api/prisma/migrations/20260826113000_rfid_inventory_actor_scope/migration.sql`
- 岩点 API：`/Users/flacko/Documents/Codex/SummerIntern/poc/apps/api/src/holds`
- RFID Service：`apps/api/src/holds/rfid-inventory.service.ts`
- 实物单件 Service：`apps/api/src/holds/hold-unit.service.ts`
- 模型处理 Service：`apps/api/src/holds/hold-model-processing.service.ts`
- 模型处理脚本：`apps/api/scripts/hold-model-processor.py`
- 数据库 ID 校验：`apps/api/src/common/database-id.ts`
- 岩点 Web：`/Users/flacko/Documents/Codex/SummerIntern/poc/apps/web/src/features/holds`
- RFID Web：`apps/web/src/features/holds/rfid-inventory-panel.tsx`
- 线路 API：`/Users/flacko/Documents/Codex/SummerIntern/poc/apps/api/src/routes`
- 线路 Web：`/Users/flacko/Documents/Codex/SummerIntern/poc/apps/web/src/features/routes`
- W03–W05 模型：`apps/web/public/walls/regions/w03-w05-pilot.glb`
- 原始试点文件：`/Users/flacko/Documents/Codex/SummerIntern/files/3d_model`

## 14. 可直接复制到新窗口的开工提示

```text
请先完整阅读：
/Users/flacko/Documents/Codex/SummerIntern/poc/docs/POC当前状态与后续开发交接文档.md

工作目录：/Users/flacko/Documents/Codex/SummerIntern/poc
安全主线：main（f44492b，不要直接开发）
当前开发分支：feature/rfid-inventory-session（业务代码基线 371b449；其后只有 handoff 文档提交）
减法前恢复检查点：94f9f96

当前产品只做岩点库和线路库。近期已完成自动 GLB 清理、可选物理岩点/RFID 标签层及安全 RFID 批量盘点。数量库存仍是总账，物理单件是可选明细；RFID 盘点只记录核验与差异，不自动改变库存、所有权、保管方或租借关系。

先检查 git status、分支、30 个 migration 和本地服务。优先用 5–20 颗真实测试岩点验证五类 RFID 差异及完成/取消，再决定是否接实际读写器 adapter。不要提前实现跨馆自动转移、租借计费、摄像头识别、AI 定线，也不要恢复 W06 虚拟定线或 Dummy 页面。

重要兼容规则：历史默认场馆 ID 形如 facility_default_<organizationId>。数据库实体 ID 是不透明字符串，必须使用 common/database-id.ts，不能假设全部是 CUID；requestKey 仍严格使用 UUID。

所有开发只在 feature 分支进行，完成 lint、typecheck、test、build、db:check 和人工验收后才能请求合并 main。不要修改 Azure，除非用户另行明确批准。
```
