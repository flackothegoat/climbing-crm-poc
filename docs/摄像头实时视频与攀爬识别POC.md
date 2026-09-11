# 摄像头实时视频与攀爬识别 POC

保存日期：2026-09-11

## 已实现范围

1. 登录后的 `/dashboard/camera` 提供实时视频入口。
2. 播放器使用 Azure GB28181 平台的 H.264 WSS-FLV 分享页，通过配置化 iframe 嵌入。
3. API `/api/camera/live` 只返回经过环境配置校验的播放信息，不把地址散落在前端组件。
4. API `/api/camera/observations` 支持查询和幂等写入视觉 Worker 的真实观察。
5. 写入继续使用现有 `ClimbObservation`：绑定组织、线路、不可变线路版本和可选墙段，来源为 `CAMERA`。
6. 页面没有识别数据时显示真实空状态，不生成模拟 AI 结果。
7. 页面提供多线路视觉配置：从实时流截取 1280px 静态画面，用户使用 SlimSAM 逐块框选岩点，再标记起点和终点；点击已有轮廓可取消或恢复选择。
8. 摄像头线路定义绑定现有 `routeId + routeVersionId + wallSegmentId`，带修订号持久化；自动候选不直接成为业务真值。
9. 新线路采用“视觉确认 → 线路信息 → 创建”流程；编号由服务器按墙段、日期和序号生成。
10. 创建时根据最终选中岩点自动计算带边距的 Worker ROI，并裁剪为带线路岩点及 S/F 标识的 WebP 图片；线路库使用缩略图展示，点击可查看完整图片。
11. 用户可在视觉配置中创建新线路或绑定已有线路；线路库只负责搜索、查看、信息编辑和状态管理。
12. “添加岩点”在浏览器中加载量化 SlimSAM，以用户紧框和框中心正样本生成实例轮廓；同一截图复用图像 embedding，连续标注无需重复编码。
13. 系统从 SAM 的多张候选掩码中按 IoU、铺满提示框比例和边界接触进行选择；异常铺满框时用点击颜色作局部细化，模型不可用时自动退回框内颜色分割。
14. 起点和终点直接绑定单个已确认轮廓；同一物理岩点被拆成两块时，可在“高级修正”中用“合并轮廓”人工合并。限制批量区域、手动补点和颜色批量候选也统一收纳在高级修正中。
15. 实时 FLV 关键帧到达可能需要数秒；截图服务使用 20 秒可配置超时、合并并发请求，并在瞬时截帧失败时返回最近 5 分钟内的成功画面。响应头和页面提示会明确标记旧画面，避免把兜底截图误当成实时画面。
16. 识别历史使用服务端分页与筛选，默认只展示最近 10 条；每条结果可播放短期录像证据并追加不可变人工复核。
17. Worker 增加画面质量、完整人体、无人墙面前景差异和发布前二次校验，用于拦截空画面、局部物体和低质量画面误报。

## 线路生命周期

- `PUBLISHED`：页面显示“正常”，Worker 只读取此状态的线路定义。
- `INACTIVE`：页面显示“已停用”，保留版本、视觉定义和历史数据，可恢复或删除。
- `REMOVED`：页面不再显示，Worker 和摄像头选择器均不可读取，历史观察仍保留。

正常线路只能先停用；删除接口只接受已停用线路。历史遗留的已停用线路即使版本已经退役，也可以直接删除。

## 配置

```dotenv
CAMERA_LIVE_ENABLED=true
CAMERA_LIVE_NAME=攀岩墙主摄像头
CAMERA_PLAYER_URL='https://.../wvp/#/play/share?type=2&url=...'
CAMERA_RESOURCE_URL=wss://.../wvp-media/rtp/...live.flv?originTypeStr=rtp_push&videoCodec=H264
CAMERA_PROBE_URL=https://.../wvp-media/rtp/...live.flv?originTypeStr=rtp_push&videoCodec=H264
CAMERA_WORKER_RESOURCE_URL=http://media/rtp/...live.flv?originTypeStr=rtp_push&videoCodec=H264
CAMERA_PROBE_TIMEOUT_MS=4000
CAMERA_PROBE_CACHE_MS=10000
NEXT_PUBLIC_SAM_MODEL_ID=Xenova/slimsam-77-uniform
CAMERA_WORKER_TOKEN=<至少 32 字符随机值>
CAMERA_WORKER_ORGANIZATION_ID=<岩馆组织 ID>
```

`GET /api/camera/live` 会通过 `CAMERA_PROBE_URL` 建立短时 HTTPS-FLV 连接，并以“在超时时限内实际读取到媒体字节”作为在线依据。结果缓存 10 秒，避免每次页面刷新都新建长连接。iframe 的 `onload` 只表示播放器页面载入，两种状态在界面中分开显示。

`NEXT_PUBLIC_SAM_MODEL_ID` 是构建期前端配置。默认模型约 54 MB，首次使用“添加岩点”时下载，之后由浏览器缓存；同一截图只计算一次 embedding。生产浏览器需要能访问 Hugging Face 模型资源，若网络策略不允许，应将同一模型文件镜像到受控静态资源域名后再切换该配置。

## 2026-08-27 超时排查结论

- DNS 正常解析至 `20.212.51.123`。
- Let's Encrypt 证书域名匹配且验证通过，TLS 1.3 正常。
- `/wvp/` 返回 HTTP 200，未设置阻止 iframe 的 `X-Frame-Options`。
- HTTPS-FLV 12 秒读取约 3.55 MB，服务端返回 `video/x-flv`。
- WSS 握手返回 `101 Switching Protocols`，随后持续收到媒体数据。
- FFmpeg 实际识别为 H.264、3840×2160、15 FPS；Worker 统一缩放至 640×360 后分析。

因此先前“自动化浏览器连接超时”不是摄像头或 WVP 断线，而是把不会自然结束的实时媒体长连接当作普通页面等待完成；Codex 内置浏览器的网络路径也不能替代部署服务器的媒体探测。系统现已改为短时读取媒体字节，不再依赖页面导航是否结束。

## 观察写入口径

视觉 Worker 使用 `x-camera-worker-token` 调用 `POST /api/camera/worker/observations`，并提交：

- UUID 幂等键；
- `routeId + routeVersionId`，不得只提交颜色；
- 观察时间和可选墙段；
- 结果、失败原因、置信度、复核标记；
- 起步、终点、跌落、异色接触等带时间和证据的事件；
- 模型版本和相机标定版本。

API 会验证线路版本属于当前组织，墙段属于该线路版本。相同幂等键重复上报不会生成重复观察。

离线脚本会额外生成 `observation-analysis.json`，内容可直接作为请求中的 `analysis`。Worker 仍需从业务系统选择实际的 `routeId`、`routeVersionId` 和可选 `wallSegmentId`，并补充 `requestKey`、`observedAt` 后提交，避免仅凭画面颜色猜测业务线路。

## 实时 Worker

`services/vision-worker/live_stream_worker.py` 已提供：

- WSS-FLV 到 HTTPS-FLV 的 FFmpeg 兼容转换；
- 断线重连和 `status.json` 心跳；
- 640×360、8 FPS 分析采样；
- 无人持续 2 秒时固化 `live-reference.jpg` 空墙参考，避免用攀爬者画面建立颜色 mask；
- 攀爬者进入/离开检测、3 秒预录和最长 600 秒尝试切片；
- 后台调用现有起步、终点、异色和掉落算法；
- 稳定幂等键及受保护 API 回写。
- 通过 `GET /api/camera/worker/route-definitions` 读取全部用户确认线路；对每段尝试验证各线路起点，并按线路接触比例和结果置信度选择最匹配线路。
- 人体检测候选必须同时通过置信度、躯干/下肢关键点完整性、尺寸、画面质量和无人墙面前景差异校验。
- 只有确认起步、有效人体跟踪时长、前景和画面质量全部达标的候选才能回写；其他候选目录立即删除且不上传录像。

只读探测：

```bash
cd services/vision-worker
python live_stream_worker.py \
  --stream-url "$CAMERA_RESOURCE_URL" \
  --probe-seconds 5
```

持续运行前必须配置实际业务 ID：

```dotenv
CAMERA_WORKER_API_URL=http://api:3101/api
CAMERA_WORKER_TOKEN=<与 API 相同的至少 32 字符随机值>
CAMERA_WORKER_ORGANIZATION_ID=<API 端绑定的岩馆组织 ID>
# 多线路模式从 API 自动读取线路 ID；以下只用于兼容旧的单线路模式：
# CAMERA_ROUTE_ID=
# CAMERA_ROUTE_VERSION_ID=
# CAMERA_WALL_SEGMENT_ID=
```

摄像头发生 PTZ、变焦、分辨率或安装位置变化后，必须停止 Worker、删除其输出目录中的 `live-reference.jpg`，重新生成参考帧并复核标定区域。

Worker 已提供独立 `Dockerfile`、带心跳/线路数校验的健康检查和 `infra/compose.vision-worker.yaml`。生产环境使用独立 Compose 项目，同时加入主应用网络和 GB28181 媒体网络：API 写回走主应用内网，HTTP-FLV 解码走 `media:80`，不再经过公网域名回环。Worker 不开放公网端口，也不会复制 API 凭据到镜像。部署脚本会生成权限为 `600` 的 `worker.env`，让 API 绑定明确的组织，再构建、启动并验证 Worker 与已发布线路定义：

```bash
sudo /opt/climbing-demo/infra/deploy-vision-worker.sh \
  /opt/climbing-demo \
  <岩馆组织 ID> \
  /opt/climbing-vision-worker
```

## 已完成的复核闭环

- 有效候选录像转为无音频 H.264，流式写入 MinIO；成功上传后删除 Worker 原片，异常残留最多保留 24 小时。
- 员工可在 UI 播放受权录像、核对事件时间点，追加确认、改判或无效结论；算法原判不被覆盖。
- 结构化历史永久保留，录像根据复核状态使用 72 小时、14 天或 30 天的分级过期策略。

## 待继续验证

- 在媒体流恢复后，采集“无人、路过、坐在墙下、攀爬其他线路、目标线路失败/完攀”真实正负样本，量化误报率、漏报率和复核改判率。
- 公网 IP 变化导致的 GB28181 注册/推流中断属于视频输入层问题，应先恢复可验证的媒体流，再调整算法阈值。
- 常驻运行的延迟、CPU/GPU、内存和断线恢复压测；
- 多机位、多人跟踪和通用异色岩点识别。
- 全局“一键候选”仍是传统颜色连通域算法；精确修正已接入 SlimSAM，但严重遮挡、反光、极低对比和没有紧框的密集岩点仍可能需要重新框选或使用合并轮廓。后续应保存用户修正样本，评估专用岩点分割模型。
- 第一版会对候选线路逐条运行状态机，线路数量增加时分析延迟近似线性增长；后续应把一次姿态推理结果复用于全部线路状态机。

早期离线算法实验仍保留在工作区同级的 `vision-poc` 目录；生产运行代码以本仓库 `services/vision-worker` 为准。
