# 摄像头实时视频与攀爬识别 POC

保存日期：2026-08-27

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
CAMERA_PROBE_TIMEOUT_MS=4000
CAMERA_PROBE_CACHE_MS=10000
NEXT_PUBLIC_SAM_MODEL_ID=Xenova/slimsam-77-uniform
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

## 尚未完成

- 将服务器侧实时算法 Worker 接入已确认的生产线路定义；
- 在有人现场攀爬时完成一次真实流端到端观察写入；
- 录像证据片段写入对象存储；
- UI 内人工纠正和 `correctsObservationId` 流程；
- 常驻运行的延迟、CPU/GPU、内存和断线恢复压测；
- 多机位、多人跟踪和通用异色岩点识别。
- 全局“一键候选”仍是传统颜色连通域算法；精确修正已接入 SlimSAM，但严重遮挡、反光、极低对比和没有紧框的密集岩点仍可能需要重新框选或使用合并轮廓。后续应保存用户修正样本，评估专用岩点分割模型。
- 第一版会对候选线路逐条运行状态机，线路数量增加时分析延迟近似线性增长；后续应把一次姿态推理结果复用于全部线路状态机。

离线算法与三段录像结果见 `/Users/flacko/Documents/Codex/SummerIntern/vision-poc/CAMERA_POC_REPORT.md`。
