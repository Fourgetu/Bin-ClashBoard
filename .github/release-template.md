## 更新内容

- 同步上游 AnGe-ClashBoard `v2.06`：连接页表格与域名穿透表跟随全局透明度设置。
- 统一连接、日志、规则、代理和设置页面的外边距与卡片间距。
- 自定义规则重启改为提示“已发送重启指令，请等待 30-60 秒后刷新网页”，重启期间不再误报后端请求失败。
- 修复“家宽节点”等嵌套节点组同时被规则引用时误归入“策略”标签的问题
- 规则目标中只有最上层业务组归入“策略”，其内部的家宽、地区、手动和中转组归入“节点”
- 修复 GitHub、YouTube、AI Services 等规则目标策略组被误归入“节点”标签的问题
- 策略/节点标签分类与自定义规则目标选择解耦，自定义规则仍可选择全部组或具体节点
- 同步上游 AnGe-ClashBoard `v2.04`
- 新增 prepend/append 自定义规则的新增、编辑、删除与拖拽排序
- 自定义规则目标支持选择策略组或具体节点，并过滤内部 `PASS-RULE`
- 节点选择新增协议、连接模式和 IPv6 状态展示
- 新增当前标签页一键测速；节点组默认只测速当前选中节点，单个项目仍可独立测速
- 修复手机端自定义规则布局、重复标签，以及设置页刷新按钮间距
- 保留 Bin-ClashBoard 的订阅流量进度、下次重置时间、规则源缓存同步、Docker/GHCR 发布和安装脚本

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
