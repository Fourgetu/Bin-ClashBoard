## 更新内容

- 新增每个订阅可手动设置“重置日”，适配年付但按自然月重置流量的套餐
- 若后端未返回 `Reset`，前端会按手动设置的每月重置日计算并显示“下次重置”
- README 补充 Linux / bash 与 Windows PowerShell 两套 Docker 安装、升级命令，减少命令行换行踩坑

## Docker 安装

安装前提：

- 服务器已安装 Docker
- 可以访问 `ghcr.io`
- 需要对外开放你准备使用的面板端口

默认端口：`2048`

Linux / bash:

```bash
docker run -d \
  --name bin-clashboard \
  -p 2048:2048 \
  -v ./data:/app/data \
  --restart unless-stopped \
  ghcr.io/fourgetu/bin-clashboard:latest
```

Windows PowerShell:

```powershell
docker run -d --name bin-clashboard -p 2048:2048 -v ${PWD}/data:/app/data --restart unless-stopped ghcr.io/fourgetu/bin-clashboard:latest
```

安装完成后访问：

```text
http://<你的服务器IP>:2048
```

## Docker 无损升级

如果你是通过 `docker run -v ./data:/app/data` 这类挂载方式运行，升级镜像时会保留原有数据目录，属于无损升级。

Linux / bash:

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

Windows PowerShell:

```powershell
docker pull ghcr.io/fourgetu/bin-clashboard:latest
docker stop bin-clashboard
docker rm bin-clashboard
docker run -d --name bin-clashboard -p 2048:2048 -v ${PWD}/data:/app/data --restart unless-stopped ghcr.io/fourgetu/bin-clashboard:latest
```
