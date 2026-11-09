## 更新内容

- 电脑 Docker 部署现在可以导入 Clash Mi / Mihomo 节点 YAML，无需 OpenClash、Nikki 或 SSH。
- 后端编辑新增文件选择、粘贴配置、订阅缓存补充、导入状态和移除入口。配置按后端及控制器地址绑定，错误导入不会覆盖原配置。
- 节点凭据仅保存在面板服务端独立数据库表，不回传到状态接口或普通浏览器设置快照。导入后清除该后端旧诊断缓存。
- 添加 Docker Desktop 同机连接说明及电脑部署 Compose 示例，明确 `host.docker.internal`、控制器端口和 Linux `host-gateway` 的用法。
- 悬停仅展示、点击延迟只测延迟、缓存复用和仅手动下载测速的行为保持一致。

## 使用方式

更新面板镜像并保留原来的 `/app/data` 挂载，选中桌面客户端后端，在「编辑后端 → 节点检测配置」导入该客户端当前使用的完整 YAML。若配置引用订阅缓存，按页面提示逐项补充。无需在其他人的电脑上配置任何软路由地址。

正式镜像：`ghcr.io/fourgetu/bin-clashboard:v2.06-3`（也更新 `latest`），支持 `linux/amd64`、`linux/arm64` 和 `linux/arm/v7`。

查看 [电脑 Docker 部署说明](https://github.com/Fourgetu/Bin-ClashBoard/blob/v2.06-3/docs/desktop-docker.zh-CN.md)。订阅更新后需重新导入配置；检测在面板容器内执行，依赖宿主机专用文件或网络环境的节点仍受迁移限制。

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
