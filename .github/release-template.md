## 更新内容

- Clash Mi 桌面端的 HTTP 订阅在生成的主配置里没有 `path`，此前挂载方式会报「订阅「x」暂无可用节点缓存」，只能退回手动导入。`v2.06-6` 起在没有 `path` 时按订阅地址的 MD5 命中客户端 `proxies/<md5(订阅地址)>` 缓存，兼容无扩展名、`.yaml`、`.yml` 与大写十六进制命名。
- 订阅更新后仍无需重新导入：Clash Mi 刷新订阅会覆盖同名缓存文件，查询时读取当前内容。
- 客户端配置里的 `path` 仍然优先；找不到缓存或名称有歧义时的报错保持不变，不会随意选同名文件，也不会写入 Clash Mi 数据目录。

## 一次性配置

更新为 `ghcr.io/fourgetu/bin-clashboard:v2.06-6` 或更新 `latest`。保留原 `/app/data` 挂载，把包含 `service_core_runtime_profile.yaml` 的 Clash Mi 完整数据目录只读挂载到 `/app/clashmi`，重建面板容器。进入「设置 → 修改后端配置 → 节点检测配置」，点击「连接配置目录」。

之前用「手动导入 YAML」的部署可以继续使用；改用挂载后订阅更新不再需要重复导入。

镜像支持 `linux/amd64`、`linux/arm64`、`linux/arm/v7`。完整步骤见 [电脑 Docker 部署说明](https://github.com/Fourgetu/Bin-ClashBoard/blob/v2.06-6/docs/desktop-docker.zh-CN.md)。
