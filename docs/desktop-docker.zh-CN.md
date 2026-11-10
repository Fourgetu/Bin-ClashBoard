# 电脑 Docker + Clash Mi / Mihomo 桌面客户端

适用于面板和 Clash Mi 在同一台 Windows / macOS 电脑运行的情况。面板运行在 Docker Desktop 的 Linux 容器中，Clash Mi 运行在电脑桌面。无需软路由或 SSH。节点配置导入从 `v2.06-3` 提供；一次主配置导入从 `v2.06-4` 提供；本页推荐的只读挂载方式要求 `v2.06-5` 或更新版本；`v2.06-6` 起在客户端配置没有 `path` 时，还会按订阅地址的 MD5 命中 Clash Mi 桌面端 `proxies/` 缓存。

## 安装或更新面板

新安装可保存仓库中的 `compose.desktop.yaml` 到专用目录，然后在该目录执行（Windows 使用 PowerShell 7）：

```powershell
docker compose -f compose.desktop.yaml pull
docker compose -f compose.desktop.yaml up -d
```

访问 `http://localhost:2048`。示例仅发布到本机回环地址，持久化目录为同目录的 `data`。

已有面板请使用原来的 Compose 文件，把镜像更新为 `ghcr.io/fourgetu/bin-clashboard:v2.06-10`（或更新 `latest`），保留原来的 `/app/data` 挂载再执行 `docker compose pull` 和 `docker compose up -d`。不要切换到空的数据目录。

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

## 推荐：一次挂载 Clash Mi 数据目录

适用于面板 Docker 和 Clash Mi 在同一台电脑运行。把**完整数据目录**只读挂载给面板，之后每次发起节点查询都读取当前主配置和对应订阅缓存，不需要逐个选 YAML，也不需要在更新订阅后重新导入。

1. 找到包含 `service_core_runtime_profile.yaml` 的 Clash Mi 数据目录。Windows 便携版通常是程序目录的 `portable`。挂载原始数据目录，保留全部订阅缓存和目录结构，不是导出到「下载」文件夹的一份主 YAML。
2. 在**现有** Compose 文件的面板服务下增加只读挂载，保留原 `/app/data`、端口、网络等设置：

```yaml
services:
  bin-clashboard:
    # 原有 image、ports、volumes 等配置保留；镜像更新为 v2.06-10 或 latest
    volumes:
      - ./data:/app/data
      - type: bind
        source: "C:/实际路径/ClashMi数据目录"
        target: /app/clashmi
        read_only: true
        bind:
          create_host_path: false
```

macOS / Linux 把 `source` 换成该电脑上的实际数据目录。仅挂载容器所在电脑的路径；其他电脑上的目录不会通过控制器 API 自动传输。

3. 在原 Compose 目录执行 `docker compose pull` 和 `docker compose up -d`，重建面板容器。此过程面板短暂不可用，持久化数据保留，Clash Mi 数据目录只读。
4. 进入「设置 → 修改后端配置 → 节点检测配置（桌面客户端）」，点击「连接配置目录」。Clash Mi 的运行配置会自动选中；普通 Mihomo 目录有多个主配置时仅需选择一次。页面显示「已连接配置目录」后即可使用节点卡片。

配置中的 Windows / macOS 绝对路径会按原目录结构匹配到挂载内的缓存，不要求修改客户端 YAML。Clash Mi 桌面端的 HTTP 订阅在生成的主配置里没有 `path`，`v2.06-6` 起会按订阅地址的 MD5（`proxies/<md5(订阅地址)>`，无扩展名，也兼容 `.yaml` / `.yml` 后缀）自动命中缓存。无法确定唯一文件时会明确报错，不随意选同名文件。目录绑定当前后端，换控制器地址需重新连接；不会把配置自动套用到其他后端。断开目录仅移除面板绑定，不删除客户端文件。

「自动读取」指查询时读取当前文件，不是后台自动测速。悬停只展示已有结果，节点信息和风险仍复用缓存，手动刷新时读取更新后的配置；下载测速仍只手动触发。

### Windows PowerShell 7 辅助配置

下载此版本仓库后，可用脚本生成一个独立 Compose 挂载覆盖文件，无需手工编辑原 Compose。替换两个路径后执行：

```powershell
pwsh.exe -NoProfile -File .\scripts\enable-clashmi-mount.ps1 -DataDirectory 'C:\实际路径\ClashMi数据目录' -ComposeFile 'C:\原面板目录\compose.yaml' -Apply
```

脚本验证运行配置存在，生成同目录的 `compose.clashmi.local.yaml`，校验 Compose 后拉取镜像并重建指定面板服务。默认服务名为 `bin-clashboard`；不同服务名追加 `-Service '你的服务名'`。已有不同内容的覆盖文件不会被覆盖。原 Compose 中的镜像应先更新为 `v2.06-10` 或 `latest`。

以后执行 Compose 更新时，同时带上原文件和 `compose.clashmi.local.yaml`，以保留挂载。也可使用仓库提供的 `compose.clashmi.yaml` 覆盖文件，但需自行设置 `CLASHMI_DATA_DIR`。已有容器若是 `docker run` 创建，需按原参数重建并额外添加 `--mount "type=bind,source=实际数据目录,target=/app/clashmi,readonly"`，保留原数据挂载。

## 备用：手动导入节点配置

1. 保存并选中 Clash Mi 后端，进入「编辑后端 → 节点检测配置（桌面客户端）→ 手动导入 YAML（备用）」。
2. 从浏览器选择这台电脑上的 Clash / Mihomo YAML 文件，或粘贴配置。文件由浏览器上传到当前面板容器，不需要把宿主机配置目录挂进容器。
3. 直接点击「导入到此后端」。面板会并行读取主配置中 `type: http` 的 HTTP / HTTPS 订阅，支持订阅请求头和常见重定向。无需为每个订阅选文件；「检查配置」仅作预览，不会请求订阅。
4. 若订阅读取失败或仅有本地路径，页面只列出这些订阅，可重试或补选各自包含 `proxies` 的节点缓存 YAML（不要重复选择主配置）。全部校验通过后才保存，失败保留原配置。成功后回到节点卡片，在「节点信息」或「风险评估」标签查询。悬停只展示，点击延迟数字只测延迟；下载测速仍需手动触发，不测上传。

导入配置只用于当前后端的独立诊断，保存在容器 `/app/data/zashboard.sqlite`，不会覆盖 Clash Mi 的配置或切换其当前节点。节点名称必须与该客户端当前运行的节点一致；订阅更新后需重新导入。多后端的配置分别保存。订阅仅在手动点击导入时读取，不定时同步，不触发带宽测速。请求从面板容器发出，容器须能直接访问订阅服务；不会复用客户端的 `proxy` 策略组。原始 URI / Base64 节点列表需先转换为 Clash / Mihomo YAML。

独立检测内核随 Docker 镜像提供，检测从容器发起。依赖电脑本机文件、仅监听电脑回环地址的前置代理、特定网卡或其他不能迁移到容器的配置仍可能失败。不要把别的 IP 的结果当成所选节点的结果。

详细限制见 [连接、路由与节点检测](network-diagnostics.zh-CN.md)。Docker 网络行为参考 [Docker Desktop 官方说明](https://docs.docker.com/desktop/features/networking/networking-how-tos/) 和 [host-gateway 参数说明](https://docs.docker.com/reference/cli/docker/container/run/#add-entries-to-container-hosts-file---add-host)。
