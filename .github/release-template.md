## 更新内容

- 同步上游 AnGe-ClashBoard `v1.92`，包含首次配置页与修改后端配置字段统一、后端标签位置优化、规则源检测结果精简等更新
- 保留 Bin-ClashBoard 自定义功能与品牌，包括订阅流量进度、下次重置时间、Docker/GHCR 发布配置和安装脚本
- 保留订阅卡片的手动重置日逻辑，后端未返回 `Reset` 时仍可按手动设置计算并显示“下次重置”
- 合并上游 Nikki/OpenClash 规则源检测改进，同时保留 Bin-ClashBoard 的 managed rule-provider 缓存同步逻辑

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
