# network-connectivity Specification

## Purpose

定义进程监听配置的环境变量覆盖、IPv6/双栈入站可用性、启动提示地址投影、监听安全边界校验，以及首批关键出站集成路径连接 IPv6 literal 目标的行为。本能力不定义 IP 族选路策略或全局 HTTP transport 抽象。

## Function

- **所属 Function**：`FN-10.34 配置网络连通性`
- **Function 变更类型**：`ADDED`
- **spec 角色**：主规格

## Requirements
### Requirement: 监听地址和端口支持进程环境变量覆盖

系统 MUST 在 startup configuration freeze 之前分别解析可选的 `NEXTAGENT_CHANNEL_HOST` 和 `NEXTAGENT_CHANNEL_PORT`。环境变量不存在时，系统 MUST 保留 YAML 合并结果中的对应 `channel.host` 或 `channel.port`；环境变量存在时，系统 MUST 以环境变量值覆盖对应 YAML 结果。两个字段的覆盖判定 MUST 相互独立。

存在的 `NEXTAGENT_CHANNEL_HOST` MUST 是非空字符串。存在的 `NEXTAGENT_CHANNEL_PORT` MUST 匹配 `^[1-9][0-9]{0,4}$`，并且解析后的十进制整数 MUST 位于 `1..65535`。任一环境变量不满足约束时，全部支持的产品启动入口 MUST 在 ready 前安全失败，MUST NOT 使用 YAML 值或默认值静默回退，且安全诊断 MUST NOT 包含原始环境变量值。

**需求类别**：功能性需求

#### Scenario: 两个环境变量覆盖 YAML 监听配置

- **WHEN** YAML 合并结果包含 `channel.host=127.0.0.1` 和 `channel.port=3000`
- **AND** 进程环境包含 `NEXTAGENT_CHANNEL_HOST=::1` 和 `NEXTAGENT_CHANNEL_PORT=3100`
- **THEN** startup configuration freeze 后的监听配置 MUST 为 `channel.host=::1` 和 `channel.port=3100`

#### Scenario: 单个环境变量只覆盖对应字段

- **WHEN** YAML 合并结果包含 `channel.host=127.0.0.1` 和 `channel.port=3000`
- **AND** 进程环境只包含 `NEXTAGENT_CHANNEL_HOST=::1`
- **THEN** startup configuration freeze 后的监听配置 MUST 为 `channel.host=::1` 和 `channel.port=3000`

#### Scenario: 未提供环境变量时保留 YAML 结果

- **WHEN** 进程环境不存在 `NEXTAGENT_CHANNEL_HOST` 和 `NEXTAGENT_CHANNEL_PORT`
- **THEN** startup configuration freeze 后的 `channel.host` 和 `channel.port` MUST 与 YAML 合并结果一致
- **AND** 内置默认配置的监听结果 MUST 保持为 `127.0.0.1:3000`

#### Scenario: 非法监听环境变量阻断启动

- **WHEN** `NEXTAGENT_CHANNEL_HOST` 是空字符串，或 `NEXTAGENT_CHANNEL_PORT` 为空字符串、`0`、`65536`、带符号文本、含空白文本或非十进制整数文本
- **THEN** startup MUST 在 ready 前以安全配置错误失败
- **AND** startup MUST NOT 使用 YAML 值或默认值继续监听
- **AND** 安全诊断 MUST NOT 包含原始环境变量值

### Requirement: IPv6 入站监听提供可连接的启动地址

系统 MUST 接受 `::1` 和 `::` 作为有效的 `channel.host`。当 `channel.host=::1` 时，服务 MUST 接受来自 IPv6 loopback 的连接，启动提示 MUST 输出 `http://[::1]:<port>`。当 `channel.host=::` 且主机网络栈允许 IPv4-mapped IPv6 时，支持的 Windows/Linux release package 目标 MUST 接受来自 IPv6 loopback 和 IPv4 loopback 的连接，启动提示 MUST 输出 `http://localhost:<port>`。当 `channel.host=0.0.0.0` 时，启动提示 MUST 继续输出 `http://localhost:<port>`。

**需求类别**：功能性需求

#### Scenario: IPv6 loopback 监听可以访问

- **WHEN** 支持的产品启动入口使用 `channel.host=::1` 和有效端口进入 ready
- **THEN** 客户端通过 `http://[::1]:<port>` 发起的真实 HTTP 请求 MUST 到达服务
- **AND** 启动提示 MUST 包含 `http://[::1]:<port>`

#### Scenario: IPv6 unspecified 监听提供双栈 loopback 访问

- **WHEN** 支持的 Windows/Linux release package 目标使用 `channel.host=::` 和有效端口进入 ready
- **AND** 主机网络栈允许 IPv4-mapped IPv6
- **THEN** 客户端分别通过 `http://[::1]:<port>` 和 `http://127.0.0.1:<port>` 发起的真实 HTTP 请求 MUST 到达同一服务
- **AND** 启动提示 MUST 包含 `http://localhost:<port>`

#### Scenario: IPv4 unspecified 继续显示本机可连接地址

- **WHEN** 支持的产品启动入口使用 `channel.host=0.0.0.0` 和有效端口进入 ready
- **THEN** 启动提示 MUST 包含 `http://localhost:<port>`

### Requirement: 网络监听不得放宽已选择的安全暴露边界

监听配置覆盖和 IPv6 地址支持 MUST NOT 放宽当前产品入口已选择的认证或网络暴露边界。当有效监听配置违反已选择入口的安全边界时，startup MUST 在 ready 前安全失败；系统 MUST NOT 因环境变量优先级、IPv6 地址形态或启动提示转换而绕过该边界。

**需求类别**：系统质量属性

**质量属性**：安全
**适用范围**：该 Function

#### Scenario: 本地配置认证拒绝非 loopback 监听

- **WHEN** 产品入口选择本地配置认证
- **AND** 最终监听配置为 IPv4 或 IPv6 unspecified 地址
- **THEN** startup MUST 在 ready 前安全失败
- **AND** 本地 login、Web、REST、SSE 和 WebSocket endpoint MUST NOT 对外提供服务

#### Scenario: IPv6 loopback 保持本地配置认证边界

- **WHEN** 产品入口选择本地配置认证
- **AND** 最终监听配置为 `::1`
- **THEN** 本 Function MUST NOT 因 `::1` 的 IPv6 地址形态阻断 startup 进入 ready
- **AND** 服务 MUST 只接受 IPv6 loopback 范围内的连接

### Requirement: 首批关键出站路径可连接 IPv6 literal 目标

在仓库固定的 Node.js `22.22.0` 默认网络配置下，模型提供方调用、api-call 和 task callback MUST 接受包含方括号 IPv6 literal 的有效 HTTP/HTTPS URL。目标可达且未被既有安全策略拒绝时，请求 MUST 到达 IPv6 目标；目标不可达时，调用 MUST 按各路径既有安全失败契约返回，MUST NOT 把 IPv6 地址改写为 IPv4 地址或静默改用另一个目标。

本 Requirement 不定义 hostname 的 A/AAAA 选择顺序，也不提供强制 IP 族配置。

**需求类别**：系统质量属性

**质量属性**：可靠性/恢复
**适用范围**：该 Function

#### Scenario: Fetch 类出站调用访问 IPv6 HTTP 目标

- **WHEN** 模型提供方调用或 api-call 收到指向可达 IPv6 literal HTTP endpoint 的有效 URL
- **THEN** 请求 MUST 通过真实 IPv6 socket 到达该 endpoint
- **AND** 响应 MUST 按对应调用的既有成功契约返回

#### Scenario: Task callback 访问 IPv6 HTTP 和 HTTPS 目标

- **WHEN** task callback 收到指向可达 IPv6 literal HTTP 或 HTTPS endpoint 的有效 URL
- **THEN** callback 请求 MUST 通过真实 IPv6 socket 到达对应 endpoint
- **AND** callback 结果 MUST 按既有成功契约完成

#### Scenario: IPv6 目标不可达时安全失败

- **WHEN** 首批关键出站路径访问不可达的 IPv6 literal 目标
- **THEN** 调用 MUST 按该路径既有安全网络失败契约结束
- **AND** 调用 MUST NOT 改写为 IPv4 目标或泄露原始 transport error

### Requirement: IPv6 可用性必须由真实 socket 验证

IPv6 入站和首批关键出站路径的合规验证 MUST 在仓库固定的 Node.js `22.22.0` 下创建真实 IPv6 socket，并断言请求实际到达 IPv6 server。测试替身、mock DNS、mock `family` 参数或只检查配置对象 MUST NOT 作为上述网络可用性的唯一证据。双栈入站验证 MUST 分别发起 IPv6 loopback 和 IPv4 loopback 请求。

**需求类别**：系统质量属性

**质量属性**：可测试性
**适用范围**：该 Function

#### Scenario: IPv6 入站和出站验收使用真实网络

- **WHEN** release validation 验收本 Function
- **THEN** 验证 MUST 证明 IPv6 loopback 入站、IPv6 unspecified 双栈入站和首批关键出站路径实际完成真实 socket 请求
- **AND** 验证 MUST NOT 只通过 mock 或 source assertion 得出网络可用结论
