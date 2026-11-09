<template>
  <details
    class="text-base-content/65 text-xs"
    @keydown.enter.stop
  >
    <summary class="cursor-pointer">电脑 Docker 部署接入说明</summary>
    <div class="mt-2 flex flex-col gap-2">
      <p>
        Docker Desktop 连接同机 Clash Mi：主机填
        <code>host.docker.internal</code>，端口和密钥填客户端的 Clash API / 外部控制器设置。普通
        Docker 网络中的 <code>127.0.0.1</code> 指向容器自身。
      </p>
      <p>
        Linux 原生 Docker 可添加启动参数 <code>--add-host=host.docker.internal:host-gateway</code>。
        控制器需允许容器网络访问；HTTP / SOCKS 代理端口不能代替控制器端口。
      </p>
      <p>
        保存后端后，展开「节点检测配置」导入该客户端的 YAML，即可使用节点信息、风险和手动下载检测。
      </p>
    </div>
  </details>
</template>
