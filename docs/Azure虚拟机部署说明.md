# Azure 虚拟机部署说明

## 架构

- Azure Ubuntu 虚拟机承载 Docker Compose。
- Caddy 作为唯一公网入口，自动申请和续期 HTTPS 证书。
- Next.js Web、NestJS API、PostgreSQL 和 MinIO 只在 Docker 内部网络通信。
- Azure 网络安全组常态只开放 HTTP 80、HTTPS 443；维护时临时开放 SSH 22，完成后立即关闭。
- 数据保存在 PostgreSQL、MinIO 和 Caddy 的 Docker 命名卷中。

## 当前实际部署

- 订阅：`Galsync-Lab`
- 资源组：`rg-climbing-demo-sea`
- 区域：Southeast Asia
- 虚拟机：`vm-climbing-demo-01`
- 规格：`Standard_D2s_v4`（2 vCPU、8 GiB）
- 系统：Ubuntu Server 24.04 LTS x64
- 系统盘：128 GiB Standard SSD
- 公网 IP：`20.212.51.123`（Static Standard）
- VNet 地址空间：`172.16.0.0/16`
- VM 所在子网：`snet-southeastasia-1`（`172.16.0.0/24`）
- 访问地址：<https://galsync-climbing-demo-01.southeastasia.cloudapp.azure.com>
- 服务器项目目录：`/opt/climbing-demo`
- 本机 SSH 私钥：`/Users/flacko/.ssh/climbing-demo-sea-key`
- 自动关机：每天 23:00（中国标准时间），提前 30 分钟邮件通知
- 资源组月预算：150 USD；实际费用 50%、80%、100% 和预测费用 100% 时发送邮件告警

2026-09-11 发布前检查确认生产环境已应用 31 个 Prisma 迁移；`release-2026-09-11` 发布时又应用 2 个识别复核与录像证据迁移，当前共 33 个且 schema 已是最新状态。Web、API、PostgreSQL、MinIO、Caddy 均由 Docker Compose 管理，并使用 `unless-stopped` 重启策略。视觉服务使用独立 Compose 项目，Docker 服务随虚拟机启动。本次发布详情见 [2026-09-11 正式发布记录](./发布记录-2026-09-11.md)。

## 生产环境文件

- `Dockerfile`：构建 Web 与 API 镜像。
- `infra/compose.production.yaml`：生产服务编排。
- `infra/Caddyfile`：HTTPS 与反向代理。
- `.env.production.example`：生产环境变量模板，不包含真实密码。

## 从 Azure 页面启动后首次运行

这里的“首次运行”指应用已经部署完成，虚拟机因自动关机而停止后，从 Azure Portal 再次启动并进行检查。正常访问网站并不需要 SSH；只有查看容器状态、日志或更新应用时才需要临时开放 SSH。

### 1. 在 Azure Portal 启动虚拟机

1. 打开资源组 `rg-climbing-demo-sea`。
2. 进入虚拟机 `vm-climbing-demo-01`。
3. 在 `Overview` 页面点击顶部 `Start`。
4. 等待状态显示为 `Running`，然后再等待约 1–3 分钟，让 Docker 服务自动恢复。

此时可以先直接访问：<https://galsync-climbing-demo-01.southeastasia.cloudapp.azure.com>。如果页面和 API 健康接口均正常，则日常使用无需继续执行 SSH 步骤。

### 2. 需要维护时，在 Azure Portal 临时开放 SSH

1. 回到资源组，打开 `vm-climbing-demo-01-nsg`。
2. 进入 `Inbound security rules`，点击 `Add`。
3. Source 选择 `My IP address`；如果页面没有该选项，则选择 `IP Addresses`，填写当前公网 IP，并使用 `/32` 掩码。
4. Protocol 选择 `TCP`，Destination port ranges 填写 `22`，Action 选择 `Allow`。
5. Priority 填写 `100`，Name 填写 `AllowSSHTemporary`，然后保存。

不要把 SSH 来源设置为 `Any` 或 `Internet`。

### 3. 从本地 Terminal 连接虚拟机

在 Mac 本地 Terminal 执行：

```bash
chmod 600 /Users/flacko/.ssh/climbing-demo-sea-key

ssh \
  -i /Users/flacko/.ssh/climbing-demo-sea-key \
  azureuser@galsync-climbing-demo-01.southeastasia.cloudapp.azure.com
```

第一次连接如果出现主机指纹确认，核对域名无误后输入 `yes`。

### 4. 在服务器检查和恢复服务

登录成功后执行：

```bash
cd /opt/climbing-demo

sudo docker compose \
  --env-file .env.production \
  -f infra/compose.production.yaml \
  ps
```

正常情况下应看到 `postgres`、`minio`、`api`、`web`、`caddy` 五个服务处于 `Up` 状态，其中 PostgreSQL、API 和 Web 应显示 `healthy`。

如果服务没有自动运行，执行：

```bash
sudo docker compose \
  --env-file .env.production \
  -f infra/compose.production.yaml \
  up -d
```

查看最近日志：

```bash
sudo docker compose \
  --env-file .env.production \
  -f infra/compose.production.yaml \
  logs --tail=200
```

检查结束后退出服务器：

```bash
exit
```

### 5. 从本地 Terminal 验证公网服务

```bash
curl -I https://galsync-climbing-demo-01.southeastasia.cloudapp.azure.com/

curl https://galsync-climbing-demo-01.southeastasia.cloudapp.azure.com/backend/health
```

首页应返回 HTTP `200`，健康接口应返回：

```json
{ "status": "ok", "service": "climbing-crm-api" }
```

### 6. 完成后关闭临时 SSH

回到 Azure Portal：

1. 打开 `vm-climbing-demo-01-nsg`。
2. 进入 `Inbound security rules`。
3. 删除 `AllowSSHTemporary`。
4. 确认已删除 SSH 临时规则。GB28181 SIP/RTP 场馆白名单是业务必需规则，应保留且只允许已确认的场馆 `/32` 公网地址。

## 全新服务器的首次部署

当前 Azure 虚拟机已经完成部署，不要在现有环境重复创建 `.env.production`。只有重建全新服务器时才执行本节。

进入服务器项目目录后，先生成不会覆盖已有文件的生产环境配置：

```bash
cd /opt/climbing-demo

./infra/create-production-env.sh \
  /opt/climbing-demo \
  galsync-climbing-demo-01.southeastasia.cloudapp.azure.com
```

然后构建镜像、执行数据库迁移并启动服务：

```bash
sudo docker compose \
  --env-file .env.production \
  -f infra/compose.production.yaml \
  build

sudo docker compose \
  --env-file .env.production \
  -f infra/compose.production.yaml \
  run --rm api \
  pnpm --filter @climbing-crm/api prisma migrate deploy

sudo docker compose \
  --env-file .env.production \
  -f infra/compose.production.yaml \
  up -d
```

## 状态与日志

```bash
sudo docker compose --env-file .env.production -f infra/compose.production.yaml ps
sudo docker compose --env-file .env.production -f infra/compose.production.yaml logs --tail=200
```

公网健康检查：

```bash
curl -I https://galsync-climbing-demo-01.southeastasia.cloudapp.azure.com/
curl https://galsync-climbing-demo-01.southeastasia.cloudapp.azure.com/backend/health
```

健康接口的正常结果为：

```json
{ "status": "ok", "service": "climbing-crm-api" }
```

## 更新

应用发布必须使用已通过本地验证的确切 Git commit 生成仅含跟踪文件的发布包，不把 `.git`、`.env`、`node_modules`、本地录像和备份上传。服务器保留现有 `.env.production`，将发布 commit 写入 `/opt/climbing-demo/DEPLOYED_COMMIT`。

建议通过 `infra/deploy-production.sh` 完成主应用备份、构建、migration 和健康检查：

```bash
sudo /opt/climbing-demo/infra/deploy-production.sh \
  /opt/climbing-demo \
  galsync-climbing-demo-01.southeastasia.cloudapp.azure.com

sudo /opt/climbing-demo/infra/deploy-vision-worker.sh \
  /opt/climbing-demo \
  <岩馆组织 ID> \
  /opt/climbing-vision-worker
```

如果维护端网络禁止 SSH，可使用 Azure VM Run Command 执行同一个发布脚本；发布包下载凭据必须短时、只读并作为受保护参数传入，验证后删除临时 Blob。

发布后至少确认：

- `DEPLOYED_COMMIT` 与本地发布标签指向同一 commit。
- PostgreSQL 备份位于 `/opt/climbing-demo/deployment-backups/`，且 `prisma migrate status` 无待执行迁移。
- API、Web、PostgreSQL 健康，Caddy 和 MinIO 运行。
- 视觉 Worker 健康且能读取已发布线路定义。
- 公网首页、`/backend/health`、WVP 界面和媒体字节探测符合预期。

## 回退边界

发布前保留上一版应用目录和 PostgreSQL 压缩备份。代码或容器问题可切回上一目录并重建；数据库迁移不得自动倒放。如果新 migration 已写入生产数据，必须先评估前后兼容性和数据影响，再决定是修复向前还是从备份恢复。

## 场馆动态公网 IP

GB28181 入站当前仍使用 Azure NSG `/32` 场馆白名单。场馆地址变化会导致注册或推流中断；在自动化方案通过 HMAC、防重放、设备绑定、最小权限和端到端验收前，只能人工确认新公网 IP 后再更新，不能将 SIP/RTP 来源放宽为 Internet。

## 数据备份

至少备份以下内容：

- PostgreSQL 数据库：定时执行 `pg_dump`，并把备份复制到 VM 以外的存储。
- MinIO 数据：备份保存岩点模型和照片的对象存储卷。
- `.env.production`：安全保存，不提交到代码仓库。

Azure 预算只能告警，不会自动停止虚拟机。当前已在 `rg-climbing-demo-sea` 资源组设置每月 150 USD 预算，并配置 50%、80%、100% 的实际费用告警和 100% 的预测费用告警；通知发送至配置的预算收件邮箱。

## 当前性能配置与区域结论

当前生产网关已启用以下缓存策略：

- `/_next/static/*`：一年缓存，`immutable`。
- `/walls/*`：一天缓存，允许七天后台复验。
- `/backend/*`：`private, no-store`。

27 MB 墙面模型保持原始文件和原有加载方式，没有压缩、拆分或分级加载。应用内部同时增加了相同 GET 请求合并、短时数据缓存、写操作后失效以及服务端 Session 校验合并。

2026-08-05 已用同规格 `Standard_D2s_v4` 在 East Asia 完成 A/B 测试。当前实际网络下，East Asia 的页面和 API 响应慢约 16%～20%，因此不建议迁移，继续使用 Southeast Asia。完整采样与解释见 [Azure 区域 A/B 测速报告](./Azure区域A-B测速报告.md)。
