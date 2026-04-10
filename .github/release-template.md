## 更新内容

- 新增订阅卡片“下次重置”显示，支持年付但按自然月重置流量的套餐展示
- 保留现有到期时间、流量进度条和无限流量展示逻辑
- README 补充并固定保留 Docker 安装与 Docker 无损升级说明，后续版本沿用

## Docker 安装

安装前提：

- 服务器已安装 Docker
- 可以访问 `ghcr.io`
- 需要对外开放你准备使用的面板端口

默认端口：`2048`

```bash
docker run -d \
  --name bin-clashboard \
  -p 2048:2048 \
  -v ./data:/app/data \
  --restart unless-stopped \
  ghcr.io/fourgetu/bin-clashboard:latest
```

安装完成后访问：

```bash
http://<你的服务器IP>:2048
```

## Docker 无损升级

如果你是通过 `docker run -v ./data:/app/data` 这类挂载方式运行，升级镜像时会保留原有数据目录，属于无损升级：

```bash
docker pull ghcr.io/fourgetu/bin-clashboard:latest

docker stop bin-clashboard
docker rm bin-clashboard

docker run -d \
  --name bin-clashboard \
  -p 2048:2048 \
  -v ./data:/app/data \
  --restart unless-stopped \
  ghcr.io/fourgetu/bin-clashboard:latest
```
