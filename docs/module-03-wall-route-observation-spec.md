# 模块 3：墙面、线路与攀爬事件持久化 SPEC

> 日期：2026-08-06  
> 状态：本地最小切片实施基线  
> 范围：把已验证的 W06 前端流程迁移为可持久化、可替换数据源的业务骨架。  
> 明确不包含：摄像头识别、现场校准、生产部署、Azure 变更、施工放样。

## 1. 本阶段目标

本阶段建立以下可替换数据链路：

```text
WallArea / WallSegment / WallHole
    -> Route / RouteVersion / RouteHoldPlacement
    -> ClimbObservation
    -> 按墙面、线路和月份聚合
```

W06 继续作为演示种子，但数据库和 API 必须明确保存其数据可信度：墙面与孔位是
`SURVEY_ESTIMATE`，测试线路、测试岩点引用和历史攀爬事件是 `DUMMY`。现场数据到达后，
通过新增 `FIELD_CALIBRATED` 墙面版本、正式线路版本和新的事件来源替换，不覆盖历史记录。

## 2. 稳定身份与租户边界

- `WallArea` 表示场馆内稳定区域，本切片为天宇一楼。
- `WallSegment` 表示业务可选择的稳定墙段身份，编号按组织唯一，例如 `W06`。
- `WallHole` 使用墙段内稳定 `code`，例如 `W06-C05-R01`，并保存行列和局部坐标。
- `Route` 是长期线路身份，颜色只用于显示，不能作为身份。
- `RouteVersion` 保存一次可追溯的定线方案快照。
- `RouteHoldPlacement` 属于一个线路版本，并引用一个墙孔。
- `ClimbObservation` 始终引用稳定 `routeId`；可选引用当时的 `routeVersionId`。
- 所有对象直接包含 `organizationId`，或同时包含它以便数据库约束和查询过滤。
- `organizationId` 只取自服务端 Session，任何请求体中的组织信息都不可信。

## 3. 数据可信度

墙面校准状态：

- `SURVEY_ESTIMATE`：扫描或测绘估算，不可宣称现场确认。
- `FIELD_CALIBRATED`：经现场复核后才允许使用。

线路与安装数据来源：

- `DUMMY`：产品演示数据。
- `MANUAL`：经过授权用户录入。
- `IMPORTED`：由未来受控导入流程写入。

攀爬事件来源：

- `DUMMY`：演示种子。
- `MANUAL`：人工新增或修正。
- `CAMERA`：未来摄像头流水；本阶段只预留枚举，不实现识别。

UI 必须持续显示数据来源，不得把 `DUMMY` 或 `SURVEY_ESTIMATE` 表述为正式数据。

## 4. 生命周期

墙面：

```text
ACTIVE -> RETIRED
```

线路：

```text
DRAFT -> READY_FOR_INSTALL -> PUBLISHED -> INACTIVE -> REMOVED
```

- 本切片保存和读取 `DRAFT`；W06 演示种子保持 `DRAFT + DUMMY`，不能借演示初始化绕过正式发布权限。
- 状态迁移由 Service 校验；发布能力使用 `ASSET_PUBLISH`，草稿写入使用
  `ASSET_DRAFT_WRITE`。
- 已有观察事件的线路、线路版本和墙面不能物理级联删除。
- 物理墙面退役或线路拆除只改变状态，不删除历史。

## 5. 线路版本与安装位置

- 一个 `Route` 可有多个 `RouteVersion`，`versionNumber` 在同一线路内唯一。
- 草稿保存更新当前草稿版本；发布后版本不可原地覆盖，后续修改创建新版本。
- `RouteHoldPlacement` 保存 `wallHoleId`、旋转角和 `START / NORMAL / FINISH` 角色。
- 正式安装事实必须引用 `HoldVariant.id`，不得复制岩点型号、颜色或库存字段。
- 当前三个清理后的测试 GLB 尚未与正式 `HoldVariant` 建立关系。因此仅当
  `source = DUMMY` 时允许 `holdVariantId` 为空，并要求 `demoAssetKey` 非空。
- `demoAssetKey` 只用于兼容 `test-red / test-green / test-yellow` 演示资产，不能用于正式安装。

## 6. 库存事务边界

保存定线草稿、W06 Dummy 种子和修改估算孔位都不改变库存。

未来新增“确认安装”命令时，必须在同一个 PostgreSQL 短事务和同一个组织级 advisory
lock 中完成：

```text
正式安装记录
  + WAREHOUSE -> INSTALLED 余额
  + 两条库存流水
  + AuditEvent
```

拆卸同理执行 `INSTALLED -> WAREHOUSE`。任何一步失败都必须整体回滚。实现时应把当前
`HoldInventoryService.transfer()` 的内部逻辑提取为可复用的
`transferWithinTransaction()`，不能由前端连续调用多个库存接口。

已有初始化盘点产生的 `installedQuantity` 不得再次扣减。未来录入现状墙面基线时，先从
“未分配已上墙数量”认领，再决定是否产生库存转移。

## 7. 攀爬事件与统计口径

事件结果：

- `COMPLETED`
- `FAILED`
- `ABANDONED`
- `UNKNOWN`

默认口径：

```text
尝试次数 = COMPLETED + FAILED
完攀率 = COMPLETED / (COMPLETED + FAILED)
```

`ABANDONED` 和 `UNKNOWN` 保留并单独展示，但不进入默认分母。

- `climberKey` 是可选匿名周期键；无可靠身份来源时不得承诺去重人数。
- 人工写入使用组织内唯一 `requestKey` 实现幂等。
- 人工修正不覆盖原事件；未来通过 `correctsObservationId` 追加修正事件并保留审计。
- 月份筛选使用明确的时间区间，数据库保存 UTC 时间点，UI 按场馆时区展示。

## 8. 最小 API

```text
GET  /api/walls
GET  /api/walls/:wallCode
POST /api/walls/demo-seeds/w06

GET  /api/routes/setting-plan?wallCode=W06
PUT  /api/routes/setting-plan/:wallCode

GET  /api/climb-observations?wallCode=W06&from=...&to=...
POST /api/climb-observations
```

- `POST /walls/demo-seeds/w06` 是显式、幂等的本组织初始化动作，不在 GET 中隐式写数据。
- `PUT /routes/setting-plan/:wallCode` 保存当前草稿计划；JSON/CSV/截图导出继续保留在浏览器。
- 查询响应返回数据来源与校准状态，前端据此显示边界标签。

## 9. 数据库约束

- `(organizationId, code)`：区域、墙段和线路编号唯一。
- `(wallSegmentId, code)`：孔位编号唯一。
- `(routeId, versionNumber)`：线路版本号唯一。
- `(routeVersionId, wallHoleId)`：同一线路版本不能重复占用同一孔。
- `(organizationId, requestKey)`：人工攀爬事件幂等。
- 尺寸和版本号必须为正数，孔位行列从 `0` 开始；旋转角限制为 `[-359, 359]`，前端编辑后规范化为 `0–359`。
- 外键默认 `ON DELETE RESTRICT`，不对历史线路和事件级联删除。
- Dummy placement 必须有 `demoAssetKey`；非 Dummy placement 必须有 `holdVariantId`。

## 10. 验收标准

- 两个组织读取相同墙段编号时数据仍完全隔离。
- W06 种子重复执行不会产生重复墙面、线路、孔位或事件。
- 定线计划刷新页面后仍存在，不再以 `localStorage` 为事实来源。
- 人工新增完攀或失败事件刷新后仍存在，重复 `requestKey` 不重复计数。
- 统计从事件表聚合；累计次数不作为手工字段保存。
- 所有写入有审计记录，数据库变化有新 migration 和测试。
- 本地 lint、typecheck、test、build 与 migration status 通过。

## 11. 本切片暂缓项

- 摄像头、RTSP/ONVIF、人体跟踪和动作识别。
- 现场校准工具和全部 W01-W15 精确孔位。
- 正式安装/拆卸与库存联动命令。
- 自动把测试 GLB 匹配到 `HoldVariant`。
- Azure、生产数据库、生产 MinIO 和 27 MB 整馆模型加载策略变更。
