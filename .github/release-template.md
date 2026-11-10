## 更新内容

**「HTTP 蜜罐黑名单」不再把「干净」显示成「暂无数据」**

- Net.Coffee 用 `intelligence.rep_threat: null` 表示"没有蜜罐记录"（它网页上显示为「纯净」），此前面板只接受数字，`null` 一路被渲染成「暂无数据」，看着像没采集到。
- 服务端现在返回三态 `httpThreatState`：`count`（收录条数，值在 `httpThreat`）、`clean`（情报对象存在但无记录）、`unknown`（整份情报缺失）；节点检测接口向后兼容，旧字段语义不变。
- 前端按三态显示：`已收录 · N` / `纯净（无记录）` / `暂无数据`；只有真正有收录时才用告警色。
- 新增 1 项测试（`null` + intelligence 存在 = clean、`0`/`12` = count、整份缺失 = unknown），服务端测试 91 项全部通过。

## 说明

- 只改风险评估的展示与服务端字段；节点检测、路由页、挂载绑定、`/app/data` 均不受影响。
- 升级方式：`docker pull ghcr.io/fourgetu/bin-clashboard:v2.06-13`（或 `latest`）后重建容器。
