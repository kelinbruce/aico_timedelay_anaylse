## ADDED Requirements

### Requirement: CLIP Server Provider 使用统一 Capability 契约

系统 MUST 支持把 CLIP Server 作为使用既有统一 capability 契约的自定义 capability provider/source。该 provider MUST 使用 `providerKind=CUSTOM` 和 `providerType="clip_server"`。本 change MUST NOT 引入新的 `CapabilityProviderKind`、新的公开 invocation envelope 或第二套 tool catalog。

#### Scenario: 已注册的 clip_server provider 可以激活

- **WHEN** app composition 注册 `clip_server` 自定义 provider adapter
- **AND** provider 配置使用 `providerKind=CUSTOM` 和 `providerType="clip_server"`
- **THEN** 该 provider MAY 通过既有 capability 组合路径创建 CLIP 支撑的 discovery 与 execution adapter
- **AND** adapter 注册 MUST 由匹配的 discovery wiring、executor wiring 和 injected runner wiring 支撑

#### Scenario: 缺少 wiring 的 adapter 注册被拒绝

- **WHEN** app composition 把 `clip_server` 标记为已注册的自定义 adapter 类型
- **AND** 匹配的 discovery adapter、executor adapter 或 injected runner 未被 wiring
- **THEN** 系统 MUST 安全拒绝 `clip_server` 激活
- **AND** CLIP 支撑的 descriptor MUST NOT 进入可执行可用性

#### Scenario: 未注册的 clip_server provider 不能贡献可执行 tools

- **WHEN** provider 配置引用 `providerType="clip_server"`
- **AND** app composition 尚未注册 `clip_server` 自定义 provider adapter
- **THEN** 该 provider 的任何 CLIP 支撑 descriptor 都 MUST NOT 进入可执行 catalog
- **AND** 系统 MUST 发出带稳定 reason code 的安全 diagnostic

### Requirement: 发现的 CLIP API 成为普通 Tool capability

CLIP Server MUST 被建模为 provider/source。从该 CLIP Server 发现的每个有效 API 或 capability MUST 各自归一化为拥有 `kind=TOOL` 的普通 `CapabilityDescriptor`。系统 MUST NOT 为该 source 暴露单一模型可见的 `clipc`、`clip_api_call` 或 `api_name + args` 分发 tool。

#### Scenario: 发现的 API capability 是模型可见的 tools

- **WHEN** 已注册的 `clip_server` provider 发现远端 API capability A、B 和 C
- **THEN** A、B 和 C MUST 各自表示为独立的普通 `TOOL` capability descriptor
- **AND** Agent binding、冲突解决、prompt 披露、invocation 和 audit MUST 使用这些普通 Tool descriptor 作为受治理的 capability 身份
- **AND** 模型可见的 tool 契约 MUST NOT 要求调用方以 API name 参数调用通用 CLIP 分发 tool

#### Scenario: Provider-private 映射保持内部

- **WHEN** 一个 CLIP 支撑的 API 被映射为 Tool descriptor
- **THEN** 从 descriptor `capabilityId` 到 provider-private CLIP id、command name 或 primitive 的映射 MUST 保持在由 discovery 与 execution 共享的 provider-scoped 内部 registry 中
- **AND** provider-private 路由事实 MUST NOT 出现在 descriptor metadata、模型 context、stream 输出、safe error 或用户可见输出中

#### Scenario: 发现的 descriptor 事实在进入 catalog 前被校验

- **WHEN** discovery 收到一个 CLIP 支撑的 tool 定义
- **THEN** source MUST 在 catalog 注册前校验 capability id、安全 description、输入 schema、provider identity、安全 metadata 和可用性状态
- **AND** 无效 descriptor MUST NOT 进入可执行可用性
- **AND** adapter-private id、raw CLIP payload、credential、本地路径、endpoint secret 和 raw provider error MUST NOT 暴露在 descriptor metadata、模型 context、stream 输出、safe error 或 diagnostic 中

### Requirement: 启动期 Discovery 使用由既有执行边界支撑的 Injected Runner

API-backed tool source MUST 通过既有 eager discovery 路径执行单次启动期 discovery。Discovery MUST 通过由既有 sandbox/gateway 执行边界支撑的 injected CLIP command runner 获取 CLIP 支撑的 tool 事实，而不是由 `agent-capability` 直接执行宿主进程。本 change MUST NOT 新增 CLIP 专用的公开 gateway port。

Runner 生产实现 MUST NOT 要求新的 `SandboxExecutionRequest.executable` enum 值。如果它调用 `clipc`，MUST 通过既有 sandbox/gateway 执行边界，使用既有 executable shape 和受控 command template 来完成。

#### Scenario: 启动期扫描注册已校验的 tools

- **WHEN** `clip_server` provider 以有效配置启用
- **THEN** 启动期 eager discovery MUST 调用一次 CLIP 支撑的 discovery 路径
- **AND** discovery MUST 调用 injected CLIP command runner 来列出或描述可用的 CLIP 支撑 tools
- **AND** runner 生产实现 MUST 在 `agent-capability` 之外组装，并由既有 sandbox/gateway 执行边界支撑
- **AND** 校验成功的 tools MUST 通过正常 capability governance 路径注册

#### Scenario: Sandbox executable 词表不被扩展

- **WHEN** runner 生产实现调用 `clipc`
- **THEN** 它 MUST 使用既有 sandbox/gateway 执行契约，不新增 CLIP 专用的 executable kind
- **AND** `agent-capability` MUST NOT 依赖具体的 sandbox 或 gateway-local 实现

#### Scenario: 周期同步不在本 change 范围内

- **WHEN** 系统需要为 CLIP 支撑的 tools 提供周期轮询、动态注销、手动刷新、热更新或长效缓存失效
- **THEN** 这些行为 MUST 由后续 change 定义
- **AND** 本 change MUST NOT 在启动期 discovery 之外新增轮询任务、手动刷新命令或 catalog 变更路径

### Requirement: Source 配置在 Adapter 边界被校验

API-backed tool source MUST 在 discovery 或 execution 继续之前要求已校验的配置。该配置 MUST 通过既有自定义 provider 配置 shape 提供，并由 `clip_server` adapter 校验。

#### Scenario: 无效配置阻塞 source 激活

- **WHEN** 必需的 source 配置缺失、格式错误或违反 trusted path 或 endpoint 规则
- **THEN** source MUST 安全地使激活失败
- **AND** 系统 MUST NOT 从该 source 注册部分可执行的 descriptor
- **AND** 该失败 MUST 产生安全的 diagnostic outcome

### Requirement: 调用使用统一的 Request 与 Result 契约

API-backed tool source MUST 通过既有 `CapabilityInvocationRequest` 和 `CapabilityInvocationResult` 边界执行 CLIP 支撑的 tools。它 MUST NOT 定义独立的 invocation envelope、result shape 或 audit 词表。

#### Scenario: 调用请求在 CLIP 执行前被归一化

- **WHEN** runtime 调用一个 CLIP 支撑的 tool
- **THEN** `CapabilityInvocationRequest.capabilityId` MUST 标识要执行的已发现普通 Tool capability
- **AND** 从该 Tool capability 到 CLIP primitive、command name 或 provider-private capability id 的任何映射 MUST 从 provider-scoped 内部 registry 读取，并保持在已注册的 `clip_server` adapter、injected runner 或既有 sandbox/gateway 执行边界之内
- **AND** runner 请求 MUST 从被调用的 Tool capability 身份派生，而不是从模型提供的 `clipc` 命令、CLIP primitive 或 API selector 字段派生
- **AND** source MUST 保持统一 capability 契约要求的 timeout、cancellation、idempotency 和 safe-input 边界

#### Scenario: CLIP 支撑的 descriptor 拥有 executor

- **WHEN** 一个 CLIP 支撑的 descriptor 进入可执行可用性
- **THEN** 既有 capability executor factory 路径 MUST 能为该 descriptor 解析一个 `clip_server` executor
- **AND** invocation MUST NOT 仅因只注册了 builtin tool executor 而失败

#### Scenario: 调用结果在 runner 执行后被归一化

- **WHEN** injected runner 返回一个 CLIP 支撑的执行结果
- **THEN** source MUST 校验并把该结果归一化为 `CapabilityInvocationResult`
- **AND** 它 MUST 在适用处保持受治理的可用性、安全 diagnostics、generated messages 和结构化 payload 语义
- **AND** 它 MUST NOT 把 raw adapter-private 响应直接暴露给 runtime、模型 context、stream 输出、safe error 或用户可见输出

### Requirement: 失败与 Diagnostics 显式且安全

API-backed tool source 中的 discovery 或 execution 失败 MUST 是显式的。Source MUST NOT 静默丢弃失败的 tools、静默降级 provider 身份、从 `agent-capability` 直接执行宿主命令，或静默绕过 injected runner 和既有 sandbox/gateway 执行边界。

#### Scenario: Discovery 失败把受影响 tools 标记为不可用而不阻塞无关 tools

- **WHEN** discovery 无法加载或校验一部分 CLIP 支撑的 tools
- **THEN** source MAY 继续提供其他校验成功的 tools
- **AND** 每个失败的 tool MUST 被排除出可执行可用性，或通过受治理的 catalog 状态被标记为不可用
- **AND** source MUST 为失败的 discovery outcome 发出安全 diagnostics

#### Scenario: Runner 或 daemon 不可用不被静默处理

- **WHEN** injected runner、支撑的 sandbox/gateway 执行边界或支撑的 daemon 在 discovery 或 execution 期间不可用
- **THEN** source MUST 返回或记录一个安全的不可用 outcome
- **AND** 它 MUST NOT 伪装成 discovery 或 execution 已成功
- **AND** diagnostics MUST NOT 包含 raw credential、本地路径、endpoint secret、raw 参数、raw tool 结果或 adapter-private 失败细节
