# POC 当前状态与后续开发交接文档

> 保存日期：2026-08-25
>
> 工作目录：`/Users/flacko/Documents/Codex/SummerIntern/poc`
>
> 当前分支：`feature/route-core-replan`
>
> 当前阶段：产品范围已收敛为“岩点库 + 线路库”两条主线；只在本地开发，尚未部署本轮改动到 Azure。

## 1. 一句话说明当前状态

系统不再尝试同时承担整馆数字孪生、精确虚拟定线、摄像头识别和运营 CRM。当前 POC 只保留两件有明确用户价值的事：

1. 让岩馆知道自己有哪些岩点、长什么样、数量多少、目前在哪。
2. 让岩馆把线路建档、视觉定位、发布二维码、收集反馈并复盘。

认证、员工权限、租户隔离、审计、对象存储、错误处理仍作为两条主线的必要工程底座保留。

## 2. 产品边界

```text
岩点库                                  线路库
同款岩点建一份档案                      创建线路并关联一个或多个相邻墙段
品牌 / 类型 / 颜色 / 尺寸               难度 / 颜色 / 定线员 / 照片 / 计划拆线日
照片 / 可选 GLB                         W03–W05 试点模型中的线路视觉定位
仓库 / 上墙 / 维护 / 预留数量            发布二维码并收集会员反馈
库存流水与撤销                          按发布版本复盘线路表现
```

两个方向暂不强耦合。第一阶段线路建档不要求逐颗绑定岩点库存；岩点库也不需要先完成墙上精确安装坐标。这样可以先验证真实业务，再决定是否恢复库存预留、安装实例和 3D 定线能力。

## 3. 当前用户可见入口

登录后侧边栏只保留：

- 总览：`/dashboard`
- 岩点库：`/dashboard/assets/holds`
- 线路库：`/dashboard/assets/routes`
- 员工管理：`/dashboard/team`

线路“反馈与复盘”已并入线路库，不再作为独立导航。公开会员反馈页保留为 `/r/:token`。

已删除的页面入口会返回 404：

- `/dashboard/assets/walls`
- `/dashboard/assets/routes/setting`
- `/dashboard/data`
- 其他 Dummy 占位页面

## 4. 岩点库完成度

### 4.1 当前可用

- 同款岩点用一条规格档案表示，实物数量不重复建档。
- 档案记录用途分类、名称、品牌、常见业务颜色、尺寸、固定方式和 SKU。
- 支持照片、GLB 和模型预览资产；文件存 MinIO，PostgreSQL 只存对象键与元数据。
- 库存分为仓库、已上墙、预留、维护四个桶。
- 支持初始化盘点、入库/调整、库存流水、撤销、停用、恢复和受约束删除。
- 列表直接按岩点规格展示品牌、类型、各桶数量、总量和模型状态；点击后展开对应档案。
- 所有数据按 `organizationId` 隔离，库存写入带事务锁、幂等与审计。

### 4.2 当前明确不做

- 不要求普通用户使用 Blender 清理模型。
- 不承诺单张照片自动生成施工级 GLB。
- 不自动识别品牌、型号、真实尺寸和安装孔。
- 不自动把扫描墙面的未知岩点匹配到库存档案。
- 不在本阶段实现岩点租借交易；当前数据模型只为未来租借打基础。

主要代码：

- `/Users/flacko/Documents/Codex/SummerIntern/poc/apps/api/src/holds`
- `/Users/flacko/Documents/Codex/SummerIntern/poc/apps/web/src/features/holds`
- `/Users/flacko/Documents/Codex/SummerIntern/poc/docs/岩点模块设计与全栈实现详解.md`

## 5. 线路库完成度

### 5.1 线路运营闭环

- 创建线路草稿，记录编号、名称、业务颜色、难度、评级体系、风格、定线员、说明、照片和计划拆线日。
- 一条线路可关联多个相邻墙段，位置按有序墙段表达，例如“一楼抱石区 · W04 → W05”。
- 发布时生成不可变版本和签名公开 Token，可打印二维码。
- 会员无需登录即可提交完攀状态、实际难度、喜好、安全感和文字建议。
- 线路下线后停止新反馈，但发布版本、照片和历史反馈保留。
- 反馈复盘明确展示样本量；主动二维码反馈不能冒充全馆真实客流或自动识别结果。

### 5.2 W03–W05 视觉试点

- 试点模型：`apps/web/public/walls/regions/w03-w05-pilot.glb`，约 5 MB。
- 线路视觉标注使用墙段局部 `0..1` 坐标，支持跨 W03/W04/W05，不绑定 GLB 网格拓扑。
- 标注有草稿与确认修订；只有已确认修订用于正式展示和会员公开页。
- 3D 视图按线路业务颜色与关联墙段过滤：目标颜色保留原纹理、加黄色近似轮廓，其他区域灰度显示。
- 正立面视图作为模型不可用或颜色分割不可靠时的稳定回退。
- S/T 表示起点和终点；当前颜色分割是浏览器 Shader 候选效果，不是训练完成的 AI 实例识别。
- 只有 W03–W05 使用试点 GLB。其他墙段不再加载旧整馆 27 MB 模型，只显示正立面位置。

### 5.3 当前明确不做

- 不恢复 W06 参数墙、588 个估算孔位和拖拽岩点的虚拟定线工作台。
- 不实现精确孔位吸附、碰撞、拆线、库存预留和逐颗安装联动。
- 不把颜色当作线路 ID；身份仍由 `routeId` 和发布版本决定。
- 不把扫描纹理颜色分割宣称为可靠的自动线路识别。
- 不在没有现场视频样本前开发尝试/完攀识别。

主要代码：

- `/Users/flacko/Documents/Codex/SummerIntern/poc/apps/api/src/routes`
- `/Users/flacko/Documents/Codex/SummerIntern/poc/apps/web/src/features/routes`
- `/Users/flacko/Documents/Codex/SummerIntern/poc/apps/web/src/app/r/[token]`

## 6. 本次“减法”处理

2026-08-25 已从产品运行时和源码移除：

- W06 虚拟定线前端及测试。
- Dummy 墙面浏览、Dummy 攀爬事件和独立数据页。
- Walls 后端 Nest 模块及对应 Controller/Service。
- 摄像头“现场画面”占位页。
- 27 MB 旧整馆 GLB、W06 测试岩点 GLB 和 QA 截图。
- 日程、营销、设置等 Dummy 导航与通用占位页面。

删除内容可从 Git 检查点 `94f9f96` 恢复。`main` 没有移动，也没有合并本轮改动。

数据库未做破坏性回退：历史 Wall、Installation、SettingJob、ClimbObservation 等表和 25 个 migration 暂时保留为休眠结构，避免丢失本地历史数据和制造不可逆迁移。它们没有对应用户入口，Walls 模块也未在 `AppModule` 注册。确认新范围稳定后，再单独设计归档或 schema 清理 migration。

## 7. 数据可信度

| 数据类型                   | 当前口径                                        |
| -------------------------- | ----------------------------------------------- |
| 岩点档案与库存             | PostgreSQL 持久化业务数据；准确性取决于人工盘点 |
| 线路档案、版本、二维码反馈 | PostgreSQL 持久化业务数据                       |
| W03–W05 GLB                | 现场重扫试点资产；不是施工级测绘                |
| 颜色轮廓                   | 浏览器端纹理候选分割；需人工确认                |
| W04-BLUE                   | 本地流程验收数据，不是已现场校准的正式线路      |
| 摄像头数据                 | 目前只有传输链路验证，没有可靠业务事件          |

## 8. 摄像头状态

- 试验型号：TP-LINK `TL-IPC48AN`，800 万像素、RTSP、非 PoE、电动变焦云台。
- 公司网络已跑通：摄像头 → Wi-Fi → 公网 → Azure GB28181 平台 → 浏览器实时显示。
- 尚待岩馆验证：Wi-Fi 覆盖、上行稳定性、NAT/公网 IP、机位、遮挡、逆光、夜间画质、时间同步和隐私告知。
- 摄像头只作为后续增强。系统当前不显示虚假实时画面，也不生成模拟 AI 分析结果。

## 9. 本地运行与验证

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

提交前检查：

```bash
pnpm typecheck
pnpm lint
pnpm test
pnpm format
pnpm build
pnpm --filter @climbing-crm/api prisma migrate status
```

2026-08-25 验证结果：类型检查、ESLint、Prettier、生产构建通过；Web 21 项、API 73 项单测通过，6 项需显式数据库测试开关的集成测试跳过；25 个 migration 全部应用且 schema 为最新。保留页面在未登录时正确重定向，已删除页面返回 404，API 健康检查返回 200。

## 10. Azure 状态与开发纪律

- 本轮只改本地 feature 分支、本地静态资产和本地开发进程。
- 没有修改 Azure VM、Azure PostgreSQL、云端 MinIO、域名、网络或 GB28181 平台。
- 在用户明确批准部署前，不执行云端 migration 或发布。
- `main` 继续作为安全基线；新功能只在短期 feature 分支开发，经人工验收后再合并。
- `.env`、`.env.production`、密码、MinIO 密钥、SSH 私钥、数据库卷、`node_modules` 和 `.next-*` 不得提交。

## 11. 下一阶段建议

先不要再扩模块，分别完成两条主线的真实数据验收：

1. 用 20–50 款真实岩点走一遍建档、品牌、照片/GLB、初始数量、库存调整、撤销和查询，确认“同款”的业务口径。
2. 用 W03–W05 的黄色、紫色、蓝色真实线路建立三条档案，逐条人工标记 S/T 与关键岩点，发布二维码并用手机提交反馈。
3. 根据定线员反馈调整最少字段和操作顺序，不先开发自动识别。
4. 到岩馆安装摄像头，只采集获得授权的样例并记录网络与画面质量；算法开发需另开独立 feature。
5. 两条主线经过真实验收后，再决定是否恢复“岩点库存 ↔ 线路施工”的联动，且只能复用库存流水与线路版本，不恢复旧 W06 演示架构。

## 12. 工程边界

- 所有业务查询和写入必须按 `organizationId` 隔离。
- Controller 只处理路由和参数；租户过滤、状态机和事务放在 Service。
- 数据库变化必须带新 migration、约束和测试；不得改写已应用 migration。
- 二进制文件进入对象存储，PostgreSQL 只保存对象键和元数据。
- 库存余额、不可变流水、审计和幂等必须保持一致。
- 线路统计按版本聚合；主动反馈、人工观察和未来摄像头事件必须分开标注来源。
- 任何估算、候选识别和真实数据都必须在 UI 中明确区分。
- 不为假设中的未来需求预先引入微服务、消息队列、Kubernetes 或复杂 AI 管线。

## 13. 新窗口开工提示

```text
请先完整阅读：
/Users/flacko/Documents/Codex/SummerIntern/poc/docs/POC当前状态与后续开发交接文档.md

工作目录：/Users/flacko/Documents/Codex/SummerIntern/poc
安全基线：main
当前开发分支：feature/route-core-replan
减法前可恢复检查点：94f9f96

系统当前只做两条主线：岩点库和线路库。不要恢复 W06 虚拟定线、Dummy 墙面/数据页、摄像头占位或旧整馆 27 MB 模型。数据库中的旧墙面/安装/任务表暂时休眠，不做破坏性删除。

岩点库负责同款档案、品牌、颜色、照片/可选 GLB、库存桶与流水。线路库负责跨墙段建档、W03–W05 视觉定位、发布二维码、匿名反馈和按版本复盘。认证、员工、租户隔离、审计与错误处理是必要底座。

所有开发先在 feature 分支完成并运行 typecheck、lint、test、format、build；人工确认后才能合并 main。不要修改 Azure，除非用户另行批准。
```
