# POC 当前状态与后续开发交接文档

> 保存日期：2026-08-12
> 工作目录：`/Users/flacko/Documents/Codex/SummerIntern/poc`  
> 用途：让新的 Codex 窗口不依赖旧对话，能够准确理解当前 Demo 的目标、完成度、真实数据边界、云环境和下一步开发起点。  
> 当前阶段：云部署与区域 A/B 测试已告一段落；尚未去岩馆现场确认；已购买一台 800 万像素、RTSP、电动变焦、非 PoE 云台试验摄像头，正在等待收货，尚未采集现场样例。

## 1. 一句话说明当前状态

当前 POC 已经把“岩点资产—W06 虚拟定线—整馆墙面查看—线路运营统计”做成可演示流程；本地已完成墙面、孔位、线路版本、安装位置、攀爬事件和定线任务库存预留的持久化骨架。定线页默认打开空白虚拟墙，只读取本岩馆已完成扫描的真实岩点；草稿、锁定、取消和现场完成已分别对应不改库存、预留、释放和转为已安装。该切片尚未部署到 Azure，云端 Southeast Asia 仍运行上一版本；墙面与孔位仍属于测绘估算，不代表现场确认。

## 2. 新窗口必须先读什么

建议按以下顺序阅读：

1. 本文：`/Users/flacko/Documents/Codex/SummerIntern/poc/docs/POC当前状态与后续开发交接文档.md`
2. 现场确认和数字孪生交付清单：`/Users/flacko/Documents/Codex/SummerIntern/poc/docs/岩馆实地考察与POC演示确认清单.md`
3. 岩点模块真实设计：`/Users/flacko/Documents/Codex/SummerIntern/poc/docs/岩点模块设计与全栈实现详解.md`
4. 当前数据库事实来源：`/Users/flacko/Documents/Codex/SummerIntern/poc/apps/api/prisma/schema.prisma`
5. 当前墙面前端：`/Users/flacko/Documents/Codex/SummerIntern/poc/apps/web/src/features/walls/wall-explorer-page.tsx`
6. 当前定线前端：`/Users/flacko/Documents/Codex/SummerIntern/poc/apps/web/src/features/route-setting/route-setting-studio.tsx`
7. Azure 运行与更新：`/Users/flacko/Documents/Codex/SummerIntern/poc/docs/Azure虚拟机部署说明.md`
8. Azure 区域结论：`/Users/flacko/Documents/Codex/SummerIntern/poc/docs/Azure区域A-B测速报告.md`

历史文档 `/Users/flacko/Documents/Codex/SummerIntern/poc/docs/模块3墙面开发交接文档.md` 只保留早期数据库设计思路。它第 9 节所说“墙面和线路仍为 Dummy 页面”已经过时，不得用它判断当前前端完成度。事实优先级为：

```text
当前源代码与 Prisma Schema
    > 本文
    > 岩馆实地考察与 POC 演示确认清单
    > 各模块历史 SPEC / 旧交接文档
```

## 3. Demo 的完整目标

项目希望连接三个核心对象：

```text
岩点数字资产
    ↓
墙面、墙段和孔位数字化
    ↓
虚拟定线、拆线和施工沟通
    ↓
真实线路发布
    ↓
采集每次攀爬事件
    ↓
按墙面和线路查看运营表现
```

三大模块的职责必须保持清楚：

| 对象 | 模块职责                                           | 不应混入的职责               |
| ---- | -------------------------------------------------- | ---------------------------- |
| 岩点 | 型号、颜色规格、3D/照片资产、库存和状态            | 不负责墙上具体坐标和线路身份 |
| 定线 | 把岩点安装到墙孔、组成线路、旋转、碰撞、拆卸和导出 | 不承担整馆运营看板           |
| 墙面 | 整馆与墙段定位、墙面参数、已发布线路和攀爬统计     | 不作为定线编辑器的替代入口   |

当前 Demo 的产品定位是方案验证、定线辅助和施工沟通，不是施工放样系统，也不能替代定线员和墙体工程人员的结构、安全与承载判断。

## 4. 当前各模块完成度

### 4.1 认证和员工管理

已具备正式全栈实现：

- 邮箱密码注册和登录。
- PostgreSQL 会话与 HttpOnly Cookie。
- 注册时创建 `Organization` 和 L1 管理员。
- L1 邀请、重发、撤销和管理员工；L2 接受邀请并查看目录。
- `organizationId` 租户隔离、Capability 权限、审计和安全错误输出。

主要代码：

- `/Users/flacko/Documents/Codex/SummerIntern/poc/apps/api/src/auth`
- `/Users/flacko/Documents/Codex/SummerIntern/poc/apps/api/src/team`
- `/Users/flacko/Documents/Codex/SummerIntern/poc/apps/web/src/features/auth`
- `/Users/flacko/Documents/Codex/SummerIntern/poc/apps/web/src/features/team`

### 4.2 岩点资产模块

已经具备正式数据库、API 和前端：

- 按 Jug、Crimp、Sloper、Pinch、Pocket、Foothold、Volume、Other 分类。
- `HoldModel` 表达产品型号，`HoldVariant` 表达精确颜色/SKU 档案。
- 仓库、已上墙、预留、维护四个库存分区。
- 入库、校准、初始化盘点、撤销、停用、恢复和用户视角永久删除。
- 不可变库存流水、幂等请求、乐观锁、组织级短事务锁和审计。
- GLB、照片和缩略图存入 MinIO；网页可查看三维岩点。

当前尚未实现：

- 用户拍照后自动生成可用的三维岩点。
- 自动识别品牌、型号、真实尺寸和安装孔。
- 将墙上未知岩点自动匹配到库内某个 `HoldVariant`。

主要代码：

- `/Users/flacko/Documents/Codex/SummerIntern/poc/apps/api/src/holds`
- `/Users/flacko/Documents/Codex/SummerIntern/poc/apps/web/src/features/holds`
- `/Users/flacko/Documents/Codex/SummerIntern/poc/docs/岩点模块设计与全栈实现详解.md`

### 4.3 定线模块

实际入口：`/dashboard/assets/routes`。

当前已完成 W06 可持久化定线工作流：

- 约 5.592 m 宽、4.10 m 高的参数化 W06 墙面。
- 28 × 21、中心距约 200 × 200 mm 的估算孔位网格。
- 默认打开空白虚拟墙，不预置线路或岩点。
- 从当前岩馆已完成扫描且具有 READY 3D 模型的 `HoldVariant` 动态读取岩点资产和库存。
- 岩点拖拽、最近孔位吸附、绕墙面法线旋转。
- 演示性主安装孔与墙孔匹配。
- 基于岩点投影半径的碰撞提示。
- 首次拖入岩点自动创建稳定 ID 的新线路；支持整线高亮、整线拆卸、单点删除和撤销。
- 导出版本化 JSON、孔位清单 CSV 和正立面截图。

当前持久化边界：

- 定线计划已通过 `/api/routes/setting-plan` 保存到本地 PostgreSQL，不再以浏览器 `localStorage` 为事实来源。
- JSON/CSV/截图是浏览器下载，不进入 PostgreSQL 或 MinIO。
- API 已有墙面、线路与攀爬事件 Controller/Service；Prisma 已有 `WallArea`、`WallSegment`、`WallHole`、`Route`、`RouteVersion`、`RouteHoldPlacement` 和 `ClimbObservation`。
- 定线任务通过 `WallSettingJob` 持久化；每个墙段同一时间只允许一个活跃任务。
- 草稿拖放只计算“仓库数量 - 本草稿使用量”，不写库存流水。
- “锁定并预留”在同一事务把 `WAREHOUSE -> RESERVED`，并写逐规格预留记录；数量不足时整单回滚。
- 取消任务把活动预留 `RESERVED -> WAREHOUSE` 并退役草稿版本；确认现场完成创建逐颗 `HoldInstallation` 和锚点，将 `RESERVED -> INSTALLED`，再发布线路版本。
- 任务动作使用 UUID 幂等键、组织级事务锁、审计和数据库租户约束。
- 当前编辑器仅允许中心螺栓型 `BOLT_ON` 岩点拖拽；多孔大岩点在安装孔型正式建模和现场复核前不可用。

主要代码：

- `/Users/flacko/Documents/Codex/SummerIntern/poc/apps/web/src/features/route-setting/route-setting-studio.tsx`
- `/Users/flacko/Documents/Codex/SummerIntern/poc/apps/web/src/features/route-setting/route-setting-scene.tsx`
- `/Users/flacko/Documents/Codex/SummerIntern/poc/apps/web/src/features/route-setting/route-setting-domain.ts`
- `/Users/flacko/Documents/Codex/SummerIntern/poc/apps/web/src/features/route-setting/route-setting-demo-data.ts`
- `/Users/flacko/Documents/Codex/SummerIntern/poc/apps/web/src/features/route-setting/route-setting.types.ts`
- `/Users/flacko/Documents/Codex/SummerIntern/poc/apps/web/src/features/route-setting/route-setting.module.css`

### 4.4 墙面与线路运营模块

实际入口：`/dashboard/assets/walls`。

当前已完成前端可视化：

- 加载天宇一楼约 27 MB 的整体扫描 GLB。
- 旋转、缩放、整体视角、俯视和聚焦所选墙段。
- 按测绘资料显示 W01–W15 的空间覆盖层和平面折线定位。
- 点击墙段后显示展开宽度、估测墙高、数据状态等信息。
- W06 显示红、绿、黄三条线路的位置、起点和终点。
- 按月展示尝试、完攀、完攀率和去重攀爬者演示统计。
- 可在当前页面手工追加一次完攀或失败尝试，统计立即更新。

当前持久化边界：

- 本地数据库可通过幂等种子建立 W01–W15 墙段、W06 的 588 个估算孔位、3 条 Dummy 线路和事件级 Dummy 数据。
- 墙面页面从 API 加载 W06 定线计划和攀爬事件；人工追加事件带 UUID 幂等键并持久化，刷新后保留。
- 整馆三维覆盖层和平面折线仍使用前端 TypeScript 测绘常量；后端已提供 `/api/walls` 读取接口，后续可继续统一数据源。
- 除 W06 外，其余墙段只有空间定位与测绘估算信息。
- 本地切片尚未部署到 Azure 正式 Demo 环境。

主要代码：

- `/Users/flacko/Documents/Codex/SummerIntern/poc/apps/web/src/features/walls/wall-explorer-page.tsx`
- `/Users/flacko/Documents/Codex/SummerIntern/poc/apps/web/src/features/walls/wall-overview-scene.tsx`
- `/Users/flacko/Documents/Codex/SummerIntern/poc/apps/web/src/features/walls/wall-survey-data.ts`
- `/Users/flacko/Documents/Codex/SummerIntern/poc/apps/web/src/features/walls/w06-wall-data.ts`
- `/Users/flacko/Documents/Codex/SummerIntern/poc/apps/web/src/features/walls/wall-dummy-observations.ts`
- `/Users/flacko/Documents/Codex/SummerIntern/poc/apps/web/src/features/walls/wall-analytics.ts`
- `/Users/flacko/Documents/Codex/SummerIntern/poc/apps/web/src/features/walls/wall-route-map.tsx`
- `/Users/flacko/Documents/Codex/SummerIntern/poc/apps/web/src/features/walls/walls.module.css`

注意：`/Users/flacko/Documents/Codex/SummerIntern/poc/apps/web/src/features/dashboard/core-page-configs.ts` 中仍保留早期 `wallPageConfig` 和 `routePageConfig` Dummy 配置，但墙面和定线真实入口已经不再渲染它们。后续可以单独清理，不要误以为当前页面仍是该 Dummy 表格。

## 5. 数据可信度分层

| 层级             | 当前内容                                           | 使用边界                           |
| ---------------- | -------------------------------------------------- | ---------------------------------- |
| 正式业务实现     | 认证、会话、员工、岩点档案、资产、库存、流水和审计 | 可继续作为后续模块的全栈基础       |
| 可持久化业务骨架 | W06 定线任务、线路版本、库存预留与安装完成         | 已进入本地正式表，墙面几何仍待现场 |
| 可交互业务原型   | 整馆查看、墙段选择、线路统计                       | 能证明流程，部分仍使用估算或 Dummy |
| 测绘/扫描估算    | W01–W15 分段、墙宽墙高、W06 倾角、200 mm 孔距      | 只用于 Demo，现场复核后替换        |
| Dummy 数据       | 三条测试线路和攀爬事件                             | 只验证界面、聚合计算和产品口径     |
| 尚未采集         | 真实孔位、现状线路、真实攀爬事件、摄像头标定       | 不得在代码或文档中伪装成已确认事实 |

现有整馆 GLB 是扫描参考模型，墙体、岩点和环境仍以单体网格为主，不能直接删除某个真实岩点或作为干净可编辑墙面使用。

## 6. 原始资料和三维资产的绝对路径

### 6.1 原始场馆资料

- 点云：`/Users/flacko/Documents/Codex/SummerIntern/files/3d_model/天宇一楼_15_51_51.ply`
- 整馆扫描 GLB：`/Users/flacko/Documents/Codex/SummerIntern/files/3d_model/天宇一楼_15_52_35.glb`
- 测绘工程图 PDF：`/Users/flacko/Documents/Codex/SummerIntern/files/3d_model/天宇岩馆一楼岩壁_扫描测绘工程图_初版.pdf`

### 6.2 原始岩点素材

- 绿色：`/Users/flacko/Documents/Codex/SummerIntern/files/3d_model/3d_rock/test-green.glb`
- 红色：`/Users/flacko/Documents/Codex/SummerIntern/files/3d_model/3d_rock/test-red.glb`
- 黄色：`/Users/flacko/Documents/Codex/SummerIntern/files/3d_model/3d_rock/test-yellow.glb`

### 6.3 网页实际使用的处理后资产

- 整馆模型：`/Users/flacko/Documents/Codex/SummerIntern/poc/apps/web/public/walls/areas/tianyu-1f-scan.glb`
- 绿色清理模型：`/Users/flacko/Documents/Codex/SummerIntern/poc/apps/web/public/walls/w06/holds/test-green-clean.glb`
- 红色清理模型：`/Users/flacko/Documents/Codex/SummerIntern/poc/apps/web/public/walls/w06/holds/test-red-clean.glb`
- 黄色清理模型：`/Users/flacko/Documents/Codex/SummerIntern/poc/apps/web/public/walls/w06/holds/test-yellow-clean.glb`
- 清理参数和限制：`/Users/flacko/Documents/Codex/SummerIntern/poc/apps/web/public/walls/w06/holds/test-green-clean.metadata.json`
- 清理参数和限制：`/Users/flacko/Documents/Codex/SummerIntern/poc/apps/web/public/walls/w06/holds/test-red-clean.metadata.json`
- 清理参数和限制：`/Users/flacko/Documents/Codex/SummerIntern/poc/apps/web/public/walls/w06/holds/test-yellow-clean.metadata.json`
- 视觉 QA：`/Users/flacko/Documents/Codex/SummerIntern/poc/apps/web/public/walls/w06/qa`

三个模型的主安装孔锚点均由扫描影像估计，碰撞轮廓只用于编辑器提示；正式施工前必须现场复核。

## 7. 当前后端、数据库与部署文件

### 7.1 后端和数据库

- NestJS 入口：`/Users/flacko/Documents/Codex/SummerIntern/poc/apps/api/src/app.module.ts`
- Prisma Schema：`/Users/flacko/Documents/Codex/SummerIntern/poc/apps/api/prisma/schema.prisma`
- 迁移目录：`/Users/flacko/Documents/Codex/SummerIntern/poc/apps/api/prisma/migrations`
- 岩点库存事务：`/Users/flacko/Documents/Codex/SummerIntern/poc/apps/api/src/holds/hold-inventory.service.ts`
- 组织级事务锁：`/Users/flacko/Documents/Codex/SummerIntern/poc/apps/api/src/holds/hold-transaction-lock.ts`
- 对象存储：`/Users/flacko/Documents/Codex/SummerIntern/poc/apps/api/src/storage/object-storage.service.ts`

当前 Prisma 共 22 个迁移，最后两个目录是：

- `/Users/flacko/Documents/Codex/SummerIntern/poc/apps/api/prisma/migrations/20260811102000_anchor_parent_update_guards`
- `/Users/flacko/Documents/Codex/SummerIntern/poc/apps/api/prisma/migrations/20260812110000_wall_setting_inventory_reservations`

后续任何数据库变化必须新建 migration，不得修改已经应用的旧 migration。

### 7.2 本地和生产部署

- 本地 Compose：`/Users/flacko/Documents/Codex/SummerIntern/poc/infra/compose.yaml`
- 生产 Compose：`/Users/flacko/Documents/Codex/SummerIntern/poc/infra/compose.production.yaml`
- Caddy 网关与缓存：`/Users/flacko/Documents/Codex/SummerIntern/poc/infra/Caddyfile`
- 生产环境模板：`/Users/flacko/Documents/Codex/SummerIntern/poc/.env.production.example`
- Azure 操作文档：`/Users/flacko/Documents/Codex/SummerIntern/poc/docs/Azure虚拟机部署说明.md`
- A/B 测速报告：`/Users/flacko/Documents/Codex/SummerIntern/poc/docs/Azure区域A-B测速报告.md`

真实 `.env`、`.env.production`、数据库密码和 MinIO 密钥不得写入 handoff 或提交到代码库。

## 8. Azure 当前状态

### 8.1 正式 Demo 环境

- 订阅：`Galsync-Lab`
- 资源组：`rg-climbing-demo-sea`
- 区域：Southeast Asia
- VM：`vm-climbing-demo-01`
- 规格：`Standard_D2s_v4`，2 vCPU / 8 GiB
- 系统：Ubuntu Server 24.04 LTS x64，Trusted Launch
- 系统盘：128 GiB Standard SSD
- 域名：`https://galsync-climbing-demo-01.southeastasia.cloudapp.azure.com`
- 服务器项目目录：`/opt/climbing-demo`
- 本机 SSH 私钥位置：`/Users/flacko/.ssh/climbing-demo-sea-key`
- 公网常态只开放 80/443，SSH 22 仅维护时对当前 IP 临时开放。
- 自动关机：每天 23:00，中国标准时间。
- 资源组预算：150 USD/月；实际 50%、80%、100% 及预测 100% 告警。
- VNet：`172.16.0.0/16`；VM 子网：`172.16.0.0/24`。`/16` 是 VNet 地址空间，`/24` 是当前子网，不冲突，也无需修改。

正常健康响应：

```json
{ "status": "ok", "service": "climbing-crm-api" }
```

### 8.2 East Asia A/B 环境

- 资源组：`rg-climbing-demo-ea`
- VM：`vm-climbing-demo-ea-01`
- 域名：`galsync-climbing-demo-ea-01.eastasia.cloudapp.azure.com`
- VNet：`172.17.0.0/16`；子网：`172.17.0.0/24`
- 与正式环境采用相同规格和同一优化版本。
- 测试结束后 VM 已停止并解除分配，不再产生 VM 计算费用；资源组、磁盘、公网 IP 等仍可能产生少量费用。

2026-08-05 上海当前网络实测结论：不迁移。Southeast Asia 的首页、API 和连接复用请求比 East Asia 快约 16%–20%；East Asia 仅在首次完整下载 27 MB 模型时快约 4.5%。详细数据见 A/B 报告。

### 8.3 已完成的性能优化

- `/_next/static/*`：一年缓存并标记 `immutable`。
- `/walls/*`：一天缓存，允许七天后台复验。
- `/backend/*`：`private, no-store`。
- 相同 GET 请求合并、低频数据短缓存、写操作后缓存失效。
- 服务端同一次渲染的 Session 校验合并。
- 明确没有压缩、拆分或分级加载约 27 MB 的整馆 GLB。
- 没有增加 Azure Front Door 或 CDN 成本。

除非用户明确要求，不要继续改 Azure 架构、迁移区域或改变整馆模型加载方式。

## 9. 本地启动和验证

环境要求：Node `>=22.23.1 <23`，pnpm `11.9.0`。

```bash
cd /Users/flacko/Documents/Codex/SummerIntern/poc
export PATH="/opt/homebrew/opt/node@22/bin:$PATH"
node -v
pnpm install
pnpm services:up
pnpm db:migrate
pnpm dev
```

本地地址：

- Web：`http://localhost:3100`
- API：`http://localhost:3101/api`
- Swagger：`http://localhost:3101/api/docs`
- PostgreSQL：`localhost:5434`
- MinIO Console：`http://localhost:9003`

提交前验证：

```bash
cd /Users/flacko/Documents/Codex/SummerIntern/poc
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm --filter @climbing-crm/api prisma migrate status
```

最近一次云性能优化验证已确认：完整构建、ESLint、Web TypeScript 和 Web 26 项测试通过；API、Web、PostgreSQL、MinIO 和 Caddy 容器健康。新窗口仍应在修改后重新执行检查，不能只依赖本文历史结果。

2026-08-06 本地持久化切片验证：ESLint、全仓 TypeScript、API 56 项测试、Web 26 项测试和生产构建通过；本地 PostgreSQL 已应用 14 个 migration，W06 幂等种子、定线保存/重读和人工事件幂等写入通过。L1 浏览器实测确认整线拆卸和恢复在刷新后保留、人工事件刷新后仍计入统计，浏览器控制台无错误。`migrate dev` 会因历史首个 migration 的 checksum 漂移要求重置数据库，本次没有重置，而是使用非破坏性的 `migrate deploy` 应用新 migration。

2026-08-12 本地库存联动切片验证：ESLint、全仓 TypeScript、API 74 项单元测试、Web 26 项测试、5 项 PostgreSQL 集成约束测试、生产构建和格式检查通过；22 个 migration 全部应用，schema 无漂移，11 类数据库不变量均为 0。浏览器实测确认定线页默认是 0 线路、0 岩点的空白墙，当前账号没有合格真实扫描资产时资产栏为空且控制台无错误。只修改本地代码和本地 PostgreSQL，未修改 Azure。

## 10. 现场与硬件状态

截至本文保存时：

- 尚未去岩馆完成正式现场考察。
- 尚未确认 W01–W15 是否就是馆方业务墙面划分。
- 尚未逐墙确认宽度、高度、倾角、边界、孔位原点、缺失孔和螺栓规格。
- 尚未确认现状线路的稳定 `routeId`、同色多线、跨墙和线路版本规则。
- 尚未确认尝试、完攀、失败、放弃和未知的业务口径。
- 已购买一台 800 万像素、支持 RTSP、电动变焦、非 PoE 的云台试验摄像头，正在等待收货；尚未购买边缘计算机、标定板或岩点拍摄台。
- 尚未取得授权样例录像、现有摄像头接口或隐私数据方案。
- 数字孪生公司愿意提供帮助，但模型分层、局部坐标系、逐孔数据、精度和版本交付尚未正式验收。

现场需要确认的完整内容在：

`/Users/flacko/Documents/Codex/SummerIntern/poc/docs/岩馆实地考察与POC演示确认清单.md`

尤其不能遗漏：

1. 每面墙稳定 `wallId`、局部 `u/v/n` 坐标系和局部到世界的变换矩阵。
2. 每个孔稳定 `holeId`、行列、局部/世界坐标、法线、状态和螺栓规格。
3. 每条线路独立 `routeId`；颜色只用于显示，不作为身份。
4. 一次尝试、完攀、失败、放弃和未知的统一计算口径。
5. 摄像头是否支持 RTSP/ONVIF、视野遮挡、PoE、网络、录像保存、时间同步和隐私授权。
6. 数字孪生公司交付独立墙对象、独立现状岩点、GLB 轻量版、高精度母版、JSON/CSV 和精度报告。

## 11. 当前持久化切片与下一阶段建议

2026-08-06 已在本地完成第一版可持久化、可替换数据源的业务骨架，但尚未部署到云端。

### 11.1 已完成：短 SPEC

已新建：

`/Users/flacko/Documents/Codex/SummerIntern/poc/docs/module-03-wall-route-observation-spec.md`

SPEC 已明确：

- `WallArea` / `WallSegment` 的稳定身份和租户边界。
- 墙面几何、孔位和现状配置是否分版本保存。
- `Route` 与 `RouteVersion` 的生命周期：草稿、待施工、已发布、停用、已拆除。
- `RouteHoldPlacement` 如何引用 `HoldVariant.id`、`holeId`、旋转角、起点/终点角色。
- 定线安装/拆卸如何与 `WAREHOUSE`、`INSTALLED` 库存同事务变化。
- `ClimbObservation` 的结果、来源、时间、可选匿名攀爬者键和人工修正方式。
- Dummy、Manual、Camera 三种来源如何进入同一个事件接口。
- 历史线路、墙面版本和统计不能被物理级联删除。

### 11.2 已完成：本地最小持久化切片

已完成内容：

1. Prisma 模型、约束和新 migration。
2. `/api/walls`：墙面/墙段读取和 W06 演示数据种子。
3. `/api/routes`：线路保存、读取、版本记录和定线计划持久化。
4. `/api/climb-observations`：先支持人工新增和按墙/线路/月查询。
5. 前端定线从 `localStorage` 迁移为 API 保存/加载，同时保留 JSON/CSV/截图导出。
6. 前端墙面统计从 TS Dummy 常量迁移为 API 事件；仍允许生成明确标记为 `DUMMY` 的种子数据。
7. 增加 DTO、租户过滤和人工事件幂等单元测试；状态迁移和正式安装事务测试仍属于下一切片。

W06 作为 `SURVEY_ESTIMATE` 种子存入数据库，并为未来 `FIELD_CALIBRATED` 数据保留替换边界。以上实现仅在本地代码和本地 PostgreSQL 验证，尚未更新 Azure。

### 11.3 已完成：正式定线任务与库存联动

1. 定线页不再自动载入 Dummy 线路，空白工作区与历史演示种子分离。
2. 正式扫描岩点通过 `HoldVariant.id`、3D 资产和四分区库存进入资产栏。
3. 草稿保存、锁定预留、取消释放、现场完成安装形成显式状态机。
4. 库存余额、不可变流水、任务预留、安装事实、线路发布和审计在同一事务提交或回滚。
5. 已增加动作幂等键、租户触发器、不变量扫描和数据库集成测试。

### 11.4 建议下一项任务

1. 补充 L2 浏览器权限验证；L1 的页面加载、定线刷新持久化和人工事件刷新持久化已通过。
2. 增加已安装岩点的正式拆卸/换点命令，把 `INSTALLED -> WAREHOUSE`、安装记录释放和线路版本变更放入同一事务。
3. 为多孔大岩点新增可版本化安装孔型、孔位匹配和现场复核状态；未复核前继续禁用拖拽。
4. 将一个定线任务扩展为多个相邻墙段，并验证跨墙线路的连续性、局部坐标和几何版本锁定。
5. 增加线路名称、难度、点位角色的编辑 UI，以及任务完成前的二次确认清单。
6. 经用户确认后再规划 Azure 部署；部署前必须备份正式数据库并先运行 migration 检查。

### 11.5 暂时不要做

- 不要在没有样例录像前开发摄像头人体/动作识别。
- 不要承诺普通摄像头可以可靠获得“每月去重人数”。
- 不要实现用户拍一张照片就自动生成施工可用岩点模型。
- 不要把颜色当作线路唯一 ID。
- 不要从扫描单体网格中强行自动删除所有现状岩点并宣称得到精确墙体。
- 不要把测绘估算孔位标记为现场校准。
- 不要为后续可能的视觉算法提前引入微服务、消息队列、Kubernetes 或昂贵 Azure 服务。
- 不要在未被要求时改动已稳定的 Azure 环境和 27 MB 模型加载方式。

## 12. 后续实现必须保持的工程边界

- 所有新业务数据按 `organizationId` 隔离，前端提交的组织 ID 不可信。
- Controller 只处理路由和参数；状态机、租户过滤和事务在 Service。
- 数据库变化必须带新 Prisma migration、数据库约束和测试。
- 墙上具体安装事实引用 `HoldVariant.id`，不复制岩点型号、颜色和尺寸。
- 安装记录、库存余额、库存流水和审计必须同事务提交或回滚。
- 复用 `/Users/flacko/Documents/Codex/SummerIntern/poc/apps/api/src/holds/hold-transaction-lock.ts` 的组织级短事务锁策略。
- 二进制文件进入 MinIO，PostgreSQL 只保存对象键和元数据。
- 线路统计应从事件表聚合，不把累计数当作不可解释的手工字段保存。
- `ABANDONED` / `UNKNOWN` 默认不进入完攀率分母，但必须保留并展示数据质量。
- 人次与去重人数分开；无可靠身份来源时只承诺尝试人次。
- POC 中每处估算、Dummy 和真实数据必须在 UI 与文档中明确标识。

## 13. 可直接复制到新窗口的任务说明

```text
请先完整阅读：
/Users/flacko/Documents/Codex/SummerIntern/poc/docs/POC当前状态与后续开发交接文档.md

再阅读：
/Users/flacko/Documents/Codex/SummerIntern/poc/docs/岩馆实地考察与POC演示确认清单.md
/Users/flacko/Documents/Codex/SummerIntern/poc/apps/api/prisma/schema.prisma
/Users/flacko/Documents/Codex/SummerIntern/poc/apps/web/src/features/walls/wall-explorer-page.tsx
/Users/flacko/Documents/Codex/SummerIntern/poc/apps/web/src/features/route-setting/route-setting-studio.tsx

当前尚未现场确认；试验摄像头已购买但尚未收货和采集样例。不要开始摄像头识别。
先以当前代码为事实来源，检查本地状态。本地已完成 Wall / Route / RouteHoldPlacement / ClimbObservation，以及定线任务草稿、库存预留、取消释放和确认安装的持久化；W06 墙面孔位保持明确的 SURVEY_ESTIMATE，定线编辑器默认不载入 Dummy 线路；云端尚未部署。下一步优先补正式拆卸/换点、多孔安装型式和跨相邻墙段任务。不要改动 Azure 部署和 27 MB 模型加载方式，除非我另行要求。
```

## 14. 本次交接保存内容

2026-08-05 新增了这份全局 handoff，并在旧的 `/Users/flacko/Documents/Codex/SummerIntern/poc/docs/模块3墙面开发交接文档.md` 顶部增加了“历史状态已过时”的跳转提示。

2026-08-06 已在本地新增持久化 SPEC、14 号阶段的两个新 migration、墙面/线路/攀爬事件 API、W06 幂等种子，并把定线和墙面运营前端接入 API。只修改了本地代码和本地 PostgreSQL；没有修改 Azure VM、云端数据库、云端 MinIO、域名或网络资源。后续窗口从第 11.3 节继续。

2026-08-12 已在本地完成定线任务与正式库存联动：空白工作区、真实扫描资产、任务状态机、库存预留/释放/安装、逐颗安装记录、幂等、审计和数据库约束。只修改了本地代码与本地 PostgreSQL，Azure 未变。后续窗口从第 11.4 节继续。
