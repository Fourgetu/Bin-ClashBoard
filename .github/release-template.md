## 更新内容

**规则页（规则穿透）也接入规则引擎**

- 规则页此前只查面板自己抓取的规则源缓存：缓存里的 provider 命名（如 `Google / Domain`、`Globe / Domain`）和内核里的规则集命名（`youtube_domain`、`google_domain`）完全不同，名字对不上就被过滤掉，于是输入 `youtube.com` 显示"未命中规则缓存，将落到兜底规则 Match → 兜底流量"——而实际上内核命中的是第 17 条 `RULE-SET,youtube_domain,YouTube`。
- 现在同一查询会同时返回内核规则引擎的判定结果，页面顶部直接显示「规则引擎 · 第 17 条 · RuleSet(youtube_domain) → YouTube」，并注明"不依赖面板规则缓存、不访问目标站点，未访问过的域名同样适用"；缺少本地缓存的规则集也会列出来。
- 兜底卡片改为只在规则引擎确实判定为 `Match` 时才出现，不再把规则集命中的域名误报成走兜底。
- `/api/rule-provider-search` 响应新增 `engine` / `engineError` 字段，旧客户端不受影响。

## 说明

- 本次改动为规则页展示与接口字段；路由页、节点检测、挂载绑定、`/app/data` 均不受影响。
- 升级方式：`docker pull ghcr.io/fourgetu/bin-clashboard:v2.06-12`（或 `latest`）后重建容器。
- 规则集来源支持 `type: inline`、`./ruleset/geosite/*.mrs`、`rules/<md5(订阅地址)>` 三种本地缓存，见 [v2.06-10 发布说明](https://github.com/Fourgetu/Bin-ClashBoard/releases/tag/v2.06-10)。
