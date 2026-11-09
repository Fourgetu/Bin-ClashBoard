## 更新内容

- 桌面 Docker 接入 Clash Mi 新增只读目录挂载：把客户端完整数据目录挂载到 `/app/clashmi`，在后端设置连接一次，之后无需逐个选择 YAML。
- 自动识别 Clash Mi 运行配置，按原目录结构匹配 Windows / macOS 路径对应的订阅缓存。每次发起查询读取当前文件，订阅更新后无需重新导入。
- 配置目录按后端绑定；拒绝越界路径、指向目录外的链接及无法区分的同名缓存。面板不会写入 Clash Mi 数据目录。
- 手动 YAML 导入收起为备用方式。悬停仅展示、点击延迟只测延迟、信息/风险缓存和仅手动下载测速保持原有行为。
- 提供 Compose 只读挂载示例与 PowerShell 7 辅助脚本。

## 一次性配置

更新为 `ghcr.io/fourgetu/bin-clashboard:v2.06-5` 或更新 `latest`。保留原 `/app/data` 挂载，额外将包含 `service_core_runtime_profile.yaml` 的 Clash Mi 完整数据目录只读挂载到 `/app/clashmi`，重建面板容器。进入「设置 → 修改后端配置 → 节点检测配置」，点击「连接配置目录」。

以后更新订阅无需再次导入。信息/风险已有结果仍会缓存，手动刷新时使用当前配置；不会自动下载测速。

镜像支持 `linux/amd64`、`linux/arm64`、`linux/arm/v7`。完整步骤见 [电脑 Docker 部署说明](https://github.com/Fourgetu/Bin-ClashBoard/blob/v2.06-5/docs/desktop-docker.zh-CN.md)。
