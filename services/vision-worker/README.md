# Vision Worker

该服务读取主摄像头实时流，从 API 定期获取所有已发布的摄像头线路定义，并把真实攀爬观察幂等写回业务系统。

运行时只接受用户确认的线路轮廓、起点和终点。Worker 不按线路名称或固定颜色猜测业务 ID；摄像头、墙面或分辨率变化后必须重新确认视觉定义。

`worker-defaults.json` 只保存与具体线路无关的姿态、接触和时序阈值。生产多线路模式的线路 ID、监控区域、岩点轮廓、起点和终点均由 API 动态下发。若要运行旧的单线路离线实验，必须通过 `--calibration` 或 `CAMERA_WORKER_CALIBRATION_PATH` 显式指定包含线路几何的校准文件。

生产部署由仓库根目录的 `infra/deploy-vision-worker.sh` 完成。Worker 使用独立 Compose 项目和受限环境文件，通过主应用内部 Docker 网络访问 API，不开放公网端口。

本地测试：

```bash
python -m unittest discover -s services/vision-worker -p 'test_*.py'
```
