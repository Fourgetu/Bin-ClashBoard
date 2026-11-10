## 更新内容

**修好「节点信息 / 风险评估」间歇性失败：探测内核被内核自身劫持形成回环**

- 症状：某些节点（尤其服务器写的是 IP 的节点）总是报「节点到查询站点的 TLS 连接在建立前断开」或超时，而内核自己的健康检查明明是 30ms 正常。
- 原因：OpenClash 打开「路由本机代理」（`router_self_proxy=1`）后，本机出站流量也会被 TUN / TPROXY 劫持进内核；面板的独立探测内核走默认路由出网时就会被兜回 OpenClash，节点写 IP 时直接形成回环，TCP 连接因此超时。
- 修复：探测内核的出站绑定到真实 WAN 网卡（`interface-name`），绕开劫持。网卡自动探测：优先 `ZASHBOARD_DIAGNOSTICS_INTERFACE` 环境变量，其次按默认路由挑选，并跳过 `tun/utun/wg/docker/br-/veth/tailscale` 等虚拟网卡；非 Linux 或探测不到时保持原有行为（不绑定）。结果缓存 5 分钟。

同机实测（OpenClash + `router_self_proxy=1` + TUN）：

| 节点 | 修复前 | 修复后 |
|---|---|---|
| 自建中转 🇭🇰香港狗妈（IPv4 直连） | connect timeout | `216.236.60.76` · Hong Kong · AS36002 GoMami |
| 自建中转 🇭🇰香港-WaWo（仅 AAAA） | TLS 断开 / 超时 | `2400:c620:26:c::a` · Hong Kong |
| 自建中转 🇸🇬新加坡-Wave | 可用 | 可用（`2a0a:d687:f007::fd`） |
| 自建中转 🇸🇬新加坡-star家宽 | 可用 | 可用（`104.28.222.43` · Singapore） |

另外验证了手动复现：同一份探测配置不绑定网卡时 `216.236.60.76:51214 connect error: context deadline exceeded`；加上 `interface-name: pppoe-wan` 后 200 / 0.5s。

## 说明

- 只改服务端 `server/diagnostics.mjs`，前端无改动。
- 若自动探测到的网卡不对（例如多出口路由），可用 `ZASHBOARD_DIAGNOSTICS_INTERFACE=pppoe-wan` 指定。
- 升级方式：`docker pull ghcr.io/fourgetu/bin-clashboard:v2.06-15`（或 `latest`）后重建容器，保留原有 `/app/data` 挂载。
- 镜像支持 `linux/amd64`、`linux/arm64`、`linux/arm/v7`。
