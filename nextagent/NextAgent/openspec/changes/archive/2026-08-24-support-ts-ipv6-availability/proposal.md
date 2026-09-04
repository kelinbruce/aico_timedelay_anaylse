## Why

电信网络运维人员和平台集成方需要在纯 IPv6 或 IPv4/IPv6 双栈部署环境中启动并访问 NextAgent。当前使用 IPv6 unspecified 地址启动时，CLI 给出的登录地址不能作为客户端目标；容器部署也不能通过直接环境变量调整监听地址和端口。关键出站集成路径虽依赖 Node.js 默认网络栈，却没有真实 IPv6 socket 的产品验证证据，运维人员无法据此判断当前版本能否连接 IPv6 目标。

仓库固定使用 Node.js `22.22.0`。本 change 以该版本和当前支持的 Windows/Linux release package 目标作为网络行为验证基线，保持默认监听地址 `127.0.0.1:3000`，并保持本地配置认证既有的 localhost-only 安全边界。

## 目标与非目标（Goals / Non-Goals）

**目标：**

- 运维人员可以通过 `NEXTAGENT_CHANNEL_HOST` 和 `NEXTAGENT_CHANNEL_PORT` 覆盖本次进程的监听地址和端口，并在启动前得到确定的校验结果。
- IPv6 loopback 地址可以用于入站访问；在支持的 release package 目标且主机网络栈允许 IPv4-mapped IPv6 时，IPv6 unspecified 地址按当前运行时语义提供双栈入站访问。
- CLI 对 IPv4/IPv6 unspecified 监听地址给出本机可连接的登录地址，对 IPv6 literal 给出合法的方括号 URL。
- 首批关键出站集成路径在默认网络配置下可以连接 IPv6 literal 目标，并由真实 socket 测试提供证据。

**非目标：**

- 不增加入站或出站 `ipFamily`、`dual`、`ipv6Only` 配置。
- 不提供强制 IPv4/IPv6 出站选路、DNS family 策略、连接回退策略或全局 HTTP transport 抽象。
- 不提供逐次连接实际 IP 族的 audit、trace 或 metric。
- 不改变默认监听地址、内容脱敏策略或本地配置认证的 localhost-only 安全边界。
- 不扩展到 `ping`、`traceroute`、`nslookup` 等网络诊断能力。

## What Changes

- 新增启动网络可用性行为：两个监听环境变量分别覆盖配置文件中的同名监听事实；未提供时继续使用配置文件结果，非法值在 ready 前安全失败。
- 新增 IPv6 入站可用性保证：IPv6 loopback 可被直接访问，支持的 release package 目标对 IPv6 unspecified 监听提供 IPv6 与 IPv4 loopback 访问。
- 修改启动提示行为：IPv4/IPv6 unspecified 地址均展示为 `localhost`，IPv6 literal 使用方括号 URL。
- 新增首批关键出站路径的 IPv6 literal 可用性保证，覆盖模型提供方调用、api-call 和 task callback；该保证不等同于全局强制 IP 族策略。

## Feature 影响（Features）

### 修改的 Feature

- `F-10.5 集成外部系统`：增加在 IPv6/双栈部署环境中启动服务并连接 IPv6 外部目标的可验证质量保证，由新增 `FN-10.34 配置网络连通性` 组成。

## Function 影响（OpenSpec Capabilities）

### 新增 Function

- `FN-10.34 配置网络连通性` → `specs/network-connectivity/spec.md`
  - 功能边界：系统校验并应用监听环境变量覆盖，提供可连接的 IPv6/双栈入站端点与启动提示，并保证首批关键出站集成路径能够连接 IPv6 literal 目标。
  - 系统质量属性：可靠性/恢复、可测试性、安全。

### 修改的 Function

无。

## 影响范围（Impact）

- 运维配置面新增两个进程启动环境变量；现有 YAML 配置和默认值保持有效。
- IPv6/双栈部署需要增加 application config、local runtime package、CLI、入站监听和首批出站集成路径的测试证据。
- 不新增或修改 `agent-contracts` 公共契约，不改变 Web API、stream event、runtime command 或持久化事实。
