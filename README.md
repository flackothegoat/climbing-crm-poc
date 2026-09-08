# Climbing CRM POC

当前 POC 已包含邮箱注册与登录、基于 PostgreSQL 的会话、审计事件、`L1_ADMIN` / `L2_ADMIN` 角色模型，以及登录后的岩馆数字化看板骨架。

摄像头阶段已增加配置化实时视频入口 `/dashboard/camera`、实际媒体字节在线探测，以及视觉 Worker 攀爬观察的 token 保护写入与查询 API。多线路视觉配置以浏览器端轻量级 SlimSAM 逐块生成岩点轮廓，点击已有轮廓即可取消或恢复选择；Worker ROI 根据最终岩点自动计算，颜色批量候选和人工修正收纳在高级工具中。用户确认起点和终点后，定义绑定线路版本并供 Worker 自动选择线路。当前页面只展示真实写入事件，不生成模拟 AI 结果；离线与实时识别边界见 `docs/摄像头实时视频与攀爬识别POC.md`。

看板中的员工、岩点、墙面和线路是 POC 核心模块；日程、营销、数据和设置当前仅为 Dummy 页面。详细范围参见 [模块 2.1 看板说明](docs/module-02-dashboard-spec.md)。

岩点扫描建档会先保存不可变的手机扫描 GLB，再由后台自动生成档案展示级模型。建档和库存登记不等待模型清理；当前处理结果不承诺达到后期虚拟定线所需的安装锚点、碰撞体与姿态精度。

## 本地运行

请使用 Node 22 LTS 和 pnpm 11.9.0。

```bash
cp .env.example .env
pnpm install
pnpm services:up
pnpm db:migrate
pnpm dev
```

打开 `http://localhost:3100` 查看 Web 页面；API 的 OpenAPI 文档地址为 `http://localhost:3101/api/docs`。

Web 开发服务与生产构建分别使用 `.next-dev` 和 `.next-build`，因此可以在 `pnpm dev` 运行期间安全执行 `pnpm build`，不会覆盖正在使用的页面样式资源。

## 本地视觉 Worker

本地 Worker 复用生产算法代码，但只连接本机 API、写入本地 PostgreSQL；启动本地 Worker 不会修改或重启 Azure Worker。先在 `.env` 中配置与 API 相同的 `CAMERA_WORKER_TOKEN`、本地组织的 `CAMERA_WORKER_ORGANIZATION_ID` 和可从开发机访问的 `CAMERA_RESOURCE_URL`。

首次准备独立 Python 3.11/3.12 环境：

```bash
pnpm worker:setup
```

开发时分别运行：

```bash
# 终端一：Web 与 API
pnpm dev

# 终端二：先验证实时流，再持续运行 Worker
pnpm worker:probe
pnpm worker:dev
```

另一个终端可随时检查心跳：

```bash
pnpm worker:status
```

Worker 启动时必须从本地 API 读取到至少一条已发布的摄像头线路定义，否则会明确退出。运行状态也可在 `/dashboard/camera` 查看；输出参考帧和尝试片段默认保存在 `tmp/vision-worker`，不会进入 Git。若本机已有兼容的 Python 环境，可在 `.env` 设置 `CAMERA_WORKER_PYTHON` 跳过独立环境安装。

## 验证

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm worker:test
pnpm build
```

本地 Compose 服务默认使用端口 `5434`、`6380`、`9002` 和 `9003`，可以与之前的 `ClimbingApp` 环境并行运行。

仓库分支、大型三维资产和 CI/CD 边界见 [Git 仓库与 CI 策略](docs/Git仓库与CI策略.md)。
