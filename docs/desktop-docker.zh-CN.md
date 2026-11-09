# 电脑 Docker + Clash Mi / Mihomo 桌面客户端

适用于面板和 Clash Mi 在同一台 Windows / macOS 电脑运行的情况。面板运行在 Docker Desktop 的 Linux 容器中，Clash Mi 运行在电脑桌面。无需软路由或 SSH。节点配置导入要求面板 `v2.06-3` 或更新版本。

## 安装或更新面板

新安装可保存仓库中的 `compose.desktop.yaml` 到专用目录，然后在该目录执行（Windows 使用 PowerShell 7）：

```powershell
docker compose -f compose.desktop.yaml pull
docker compose -f compose.desktop.yaml up -d
```

访问 `http://localhost:2048`。示例仅发布到本机回环地址，持久化目录为同目录的 `data`。

已有面板请使用原来的 Compose 文件，把镜像更新为 `ghcr.io/fourgetu/bin-clashboard:v2.06-3`（或更新 `latest`），保留原来的 `/app/data` 挂载再执行 `docker compose pull` 和 `docker compose up -d`。不要切换到空的数据目录。

## 连接电脑里的 Clash Mi

在 Clash Mi 中找到实际的 Clash API / 外部控制器地址、端口和访问密钥；面板的后端设置填写：

| 项目 | 填写内容 |
| --- | --- |
| 主机 | 同机 Docker Desktop 通常使用 `host.docker.internal` |
| 端口 | Clash Mi 的实际控制器端口，不是 HTTP / SOCKS 代理端口 |
| 协议 | 与控制器一致，通常为 HTTP |
| 密码 | 控制器的访问密钥 / secret |

容器中的 `localhost` / `127.0.0.1` 指向容器自身，普通 Docker 网络下不能用它表示宿主机 Clash Mi。客户端在另一台电脑时应填写那台电脑可达的 IP / 主机名。

若连接失败，检查控制器是否监听容器可达的地址、密钥是否正确，以及宿主机防火墙是否允许 Docker 的连接。只打开“允许局域网代理”不一定同时开放控制器。应保留控制器密钥并限制访问来源；面板不会自动修改监听地址或防火墙。

Linux 原生 Docker 可在运行时增加 `--add-host=host.docker.internal:host-gateway`，或在 Compose 的服务中增加：

```yaml
extra_hosts:
  - "host.docker.internal:host-gateway"
```

这是宿主机地址映射，仍需确保控制器监听容器可达的接口。Docker Desktop 已提供该名称，无需覆盖其默认映射。

## 导入节点配置

1. 保存并选中 Clash Mi 后端，进入「编辑后端 → 节点检测配置（桌面客户端）」。
2. 从浏览器选择这台电脑上的 Clash / Mihomo YAML 文件，或粘贴配置，点击「检查配置」。文件由浏览器上传到当前面板容器，不需要把宿主机配置目录挂进容器。
3. 如果配置只引用 `proxy-providers`，按页面提示补充各订阅的节点缓存 YAML。仅订阅地址或节点 URI 列表不够；可以改用包含完整 `proxies` 的 YAML。
4. 点击「导入到此后端」。回到节点卡片，在「节点信息」或「风险评估」标签查询。悬停只展示，点击延迟数字只测延迟；下载测速仍需手动触发，不测上传。

导入配置只用于当前后端的独立诊断，保存在容器 `/app/data/zashboard.sqlite`，不会覆盖 Clash Mi 的配置或切换其当前节点。节点名称必须与该客户端当前运行的节点一致；订阅更新后需重新导入。多后端的配置分别保存。

独立检测内核随 Docker 镜像提供，检测从容器发起。依赖电脑本机文件、仅监听电脑回环地址的前置代理、特定网卡或其他不能迁移到容器的配置仍可能失败。不要把别的 IP 的结果当成所选节点的结果。

详细限制见 [连接、路由与节点检测](network-diagnostics.zh-CN.md)。Docker 网络行为参考 [Docker Desktop 官方说明](https://docs.docker.com/desktop/features/networking/networking-how-tos/) 和 [host-gateway 参数说明](https://docs.docker.com/reference/cli/docker/container/run/#add-entries-to-container-hosts-file---add-host)。
