# Azure 区域 A/B 测速报告

## 结论

当前不建议把 POC 从 `Southeast Asia` 迁移到 `East Asia`。

在 2026-08-05 从当前实际使用网络（上海本地开发机）进行的交替采样中，East Asia 的首页、API 和连接复用响应均稳定慢于 Southeast Asia。East Asia 仅在首次完整下载 27 MB 墙面模型时略快，但模型已配置浏览器缓存，后续日常使用更受页面和 API 往返延迟影响。

因此当前建议是：

1. 保留 Southeast Asia 作为演示环境。
2. 保留本次缓存和请求去重优化。
3. 暂不迁移到 East Asia，也不增加 Azure Front Door。
4. 如以后更换公司出口网络或主要用户所在地，再从目标场馆网络重新跑一次相同测试。

## 本次优化范围

已实施：

- `/_next/static/*`：一年浏览器缓存，并标记 `immutable`。
- `/walls/*`：一天浏览器缓存，允许七天后台复验。
- `/backend/*`：明确 `private, no-store`，防止业务接口被错误缓存。
- 服务端同一次页面渲染中的 Session 校验合并。
- 前端同时发起的相同 GET 请求合并。
- 岩点分类、盘点摘要和团队列表等低频数据增加 10～30 秒短缓存。
- 数据写入后自动失效前端 API 缓存。
- 首次盘点初始化请求跨组件合并。

明确未实施：

- 未压缩、拆分或分级加载 27 MB 墙面 GLB。
- 未改变模型几何、材质和显示逻辑。
- 未接入 Azure Front Door、CDN 或额外付费网关。

## 验证结果

- Web、API、PostgreSQL、MinIO 和 Caddy 容器均健康。
- 完整构建通过。
- Web 单元测试：26 项通过。
- Web TypeScript 检查通过。
- ESLint 检查通过。
- 静态 JS 响应头：`public, max-age=31536000, immutable`。
- 墙面 GLB 响应头：`public, max-age=86400, stale-while-revalidate=604800`。
- API 响应头：`private, no-store`。

## A/B 环境

| 项目       | Southeast Asia                    | East Asia                         |
| ---------- | --------------------------------- | --------------------------------- |
| VM         | `vm-climbing-demo-01`             | `vm-climbing-demo-ea-01`          |
| SKU        | `Standard_D2s_v4`                 | `Standard_D2s_v4`                 |
| CPU / 内存 | 2 vCPU / 8 GiB                    | 2 vCPU / 8 GiB                    |
| 系统       | Ubuntu Server 24.04 LTS           | Ubuntu Server 24.04 LTS           |
| 系统盘     | 128 GiB Standard SSD              | 128 GiB Standard SSD              |
| 安全       | Trusted Launch、Secure Boot、vTPM | Trusted Launch、Secure Boot、vTPM |
| 公网入站   | 80、443                           | 80、443                           |
| 应用版本   | 优化版                            | 同一优化版                        |

East Asia 测试域名：`galsync-climbing-demo-ea-01.eastasia.cloudapp.azure.com`。

完成测试后，East Asia VM 已停止并解除分配，停止产生 VM 计算费用。资源组和磁盘暂时保留，方便复核；临时私有部署包已删除。

## 测试方法

- 测试时间：2026-08-05。
- 测试来源：当前上海本地开发机和当前公司网络路径。
- 协议：HTTPS / HTTP/2。
- 首页和 API：两个区域交替请求，各采样 10 次。
- 完整模型：两个区域交替下载原始 28,312,764 字节 GLB，各采样 5 次。
- 连接复用：首页在同一 HTTP/2 连接内连续请求，排除首次 TLS 建连后各取 11 次结果。
- 表中使用中位数，减少瞬时网络波动影响。

## 测试结果

| 指标（中位数）     | Southeast Asia | East Asia | East Asia 相对结果 |
| ------------------ | -------------: | --------: | -----------------: |
| 首页 TLS 建连      |        0.461 s |   0.539 s |           慢 16.9% |
| 首页首字节         |        0.611 s |   0.728 s |           慢 19.1% |
| 首页总时长         |        0.626 s |   0.752 s |           慢 20.1% |
| API 总时长         |        0.610 s |   0.712 s |           慢 16.7% |
| 连接复用后首页     |        0.159 s |   0.185 s |           慢 16.4% |
| 27 MB 模型首字节   |        0.650 s |   0.724 s |           慢 11.4% |
| 27 MB 模型完整下载 |        2.608 s |   2.490 s |            快 4.5% |

## 如何理解结果

East Asia 的大文件完整下载略快，说明该次测试中持续传输带宽略好；但 TLS、首字节、API 和连接复用请求均更慢，说明当前用户网络到 East Asia 的实际路由并不占优。

模型第一次下载的 4.5% 优势只有约 0.12 秒，而且现在模型在浏览器内缓存一天，重复访问通常不会重新下载。相反，页面和 API 在每次操作中都会持续发生，因此 16%～20% 的延迟劣势更影响实际交互感受。

本次结论只代表当前实际用户网络路径，不代表 Azure 区域的绝对性能。如果未来主要访问者、出口网络或运营商发生变化，应在新网络上重新执行交替采样。
