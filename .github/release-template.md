## 更新内容

- 连接页合并路由、连接和日志入口，按来源 IP / 设备名分组，支持通过 SSH 读取 DHCP 设备名称。
- 路由面板分别展示规则推演及内核实际连接链路；缺少上下文时明确标注待核实。
- 节点延迟与下载速度分栏显示，悬停仅展开紧凑浮层；点击延迟数字只重新测延迟。
- 节点信息和 Net.Coffee 风险评估首次进入标签时加载，已有结果缓存复用，支持手动刷新。
- 风险卡片展示 IP 情报、滥用等级、代理标记、人机流量估算及完整报告入口，缺失数据不伪造为低风险。
- 带宽检测仅支持手动下载测速，单次最多 10 MB，可中止；不测上传、不自动测速。
- 优化 OpenClash 运行配置识别、目标订阅读取与依赖解析；并行查询节点信息和风险，短时复用配置，多个出口探测有序排队。
- 浮层固定尺寸，使用小字号，切换标签保持高度，无可见滚动条。

## 升级说明

本次需同时更新前端和 Node 后端。Docker 用户保留原有 `/app/data` 挂载目录，更新镜像后重建面板容器即可。节点信息、风险评估和下载测速需配置 OpenClash / Nikki SSH，或挂载与当前后端一致的 Mihomo 配置；纯静态部署不支持这些后端检测功能。

正式镜像：`ghcr.io/fourgetu/bin-clashboard:v2.06-2`。支持 `linux/amd64`、`linux/arm64` 和 `linux/arm/v7`。

详细操作与数据范围见 [检测说明](https://github.com/Fourgetu/Bin-ClashBoard/blob/v2.06-2/docs/network-diagnostics.zh-CN.md)。

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
