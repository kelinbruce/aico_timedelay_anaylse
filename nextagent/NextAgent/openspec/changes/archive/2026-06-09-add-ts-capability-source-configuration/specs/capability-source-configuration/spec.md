## ADDED Requirements

### Requirement: Capability provider 配置在启动期间加载并解析

系统 SHALL 在启动期间加载并校验 `adnclaw.system.capability-providers` 用户配置，将其解析为单一的 `ResolvedCapabilityProviders` 值，并在 app composition 边界消费该解析后的值。下游 capability discovery SHALL 消费解析后的 `CapabilityProviderConfig[]`，并且 MUST NOT 重新解析原始用户配置。

#### Scenario: 启动产生已解析的 capability provider 快照

- **WHEN** 系统启动并达到 ready 状态
- **THEN** 用户 capability provider 配置已被加载、校验并解析为单一的 `ResolvedCapabilityProviders`
- **AND** 下游 capability discovery 消费 `ResolvedCapabilityProviders.providers` 而不是原始用户配置

#### Scenario: 请求流量不触发用户配置重新校验

- **WHEN** 用户提交请求、恢复 stream、读取历史或发送 runtime control command
- **THEN** 系统不在该 request lifecycle 内重新运行 capability provider 用户配置校验

### Requirement: 用户配置使用直观的短字段名

面向用户的配置路径 `adnclaw.system.capability-providers` SHALL 持有一个扁平的 provider entry 数组。先前包裹该数组的 `providers` 中间对象包装已被移除——数组就是该路径的直接取值。数组中的每个 entry SHALL 使用以下字段名：

- `id`（必填、非空、在 providers 列表内唯一）
- `type`（必填，必须属于封闭的 kebab-case kind 集合）
- `path`（`local-directory` 必填，其余可选）
- `url`（`mcp-server`、`agent-registry`、`skill-hub` 必填）
- `credential`（`mcp-server`、`agent-registry`、`skill-hub` 可选；必须使用 `env:` 或 `file:` SecretReference 语法）
- `installDir`（`skill-hub` 必填）
- `adapter`（`custom` 必填）
- `config`（可选，透传给 `custom` provider 的 JSON object）

`id` MUST 非空且在 active provider 列表内唯一。出现在 providers 列表中的用户配置 entry SHALL 被视为已启用——不存在 `enabled` 字段。未知字段 SHALL 被 schema 校验拒绝。

#### Scenario: 未知字段在 schema 边界被拒绝

- **WHEN** 某 provider entry 包含面向用户的 schema 之外的字段（例如 `providerKind`、`providerType`、`locationRef`、`enabled`、`disabledCapabilityIds`、`customOptions`）
- **THEN** 启动 MUST 在 resolver 运行前拒绝该配置

### Requirement: Provider type 是封闭的 kebab-case 集合

`type` MUST 是以下值之一：

- `local-directory`
- `mcp-server`
- `agent-registry`
- `skill-hub`
- `custom`

`BUNDLED` / `builtin` / 任何其他值 MUST 以 `UNSUPPORTED_PROVIDER_TYPE` 被拒绝。`agent-capability` 在内部创建 builtin provider；用户配置 MUST NOT 尝试控制 builtin provider。

#### Scenario: 配置了不支持的 provider type

- **WHEN** 某 provider entry 使用封闭 kebab-case 集合之外的 `type`
- **THEN** 启动 MUST 以 `UNSUPPORTED_PROVIDER_TYPE` 拒绝该 provider entry，并将其作为 safe diagnostic 呈现
- **AND** 系统 MUST NOT 静默丢弃该 entry

#### Scenario: Builtin 风格的 type 值被拒绝

- **WHEN** 某 provider entry 使用 `type=bundled` 或任何其他不在封闭集合内的值
- **THEN** 启动 MUST 以 `UNSUPPORTED_PROVIDER_TYPE` 拒绝该 provider entry
- **AND** builtin provider 仍然只由 `agent-capability` 控制

### Requirement: 用户配置映射到内部 CapabilityProviderConfig 形状

resolver SHALL 按如下规则把每个用户 entry 转换为来自 `capability-catalog/spec.md` 的 `CapabilityProviderConfig`：

| 用户 `type` | `provider.providerId` | `provider.providerKind` | `provider.providerType` | `discoveryMode` | `options` 映射 |
|-------------|----------------------|----------------------|----------------------|-----------------|-------------------|
| `local-directory` | 来自 `id` | `LOCAL_DIRECTORY` | - | `EAGER` | `options.directoryRef` = 从 `path` 解析出的绝对路径 |
| `mcp-server` | 来自 `id` | `MCP_SERVER` | - | `SEARCH` | `options.endpoint` = `url`<br>`options.credentialRef` = `credential`（如存在） |
| `agent-registry` | 来自 `id` | `AGENT_REGISTRY` | - | `EAGER` | `options.registryRef` = `url`<br>`options.credentialRef` = `credential`（如存在） |
| `skill-hub` | 来自 `id` | `SKILL_HUB` | - | `SEARCH` | `options.endpoint` = `url`<br>`options.managedInstallRef` = 从 `installDir` 解析出的绝对路径<br>`options.credentialRef` = `credential`（如存在） |
| `custom` | 来自 `id` | `CUSTOM` | 从 `adapter` 必填 | `EAGER` | `options.customOptions` = `config`（如存在） |

> **转换规则**：
> 1. `provider.providerId` 直接从用户 `id` 复制
> 2. `provider.providerKind` 由用户 `type` 推导（kebab → SCREAMING_SNAKE）
> 3. `provider.providerType` 对 `CUSTOM` 必填并从用户 `adapter` 复制；其他 kind 省略
> 4. `discoveryMode` 由 `providerKind` 推导（用户不可覆盖）
> 5. `options` 字段按上表基于 `providerKind` 映射
> 6. `path` 和 `installDir` MUST 在启动时解析为绝对路径
> 7. 已解析的 provider MUST NOT 被 request-time 代码修改

#### Scenario: 用户 `local-directory` entry 映射为带绝对 `directoryRef` 的 LOCAL_DIRECTORY provider

- **WHEN** 用户配置包含 `{ id: "local-a", type: "local-directory", path: "./capabilities/a" }`
- **THEN** `ResolvedCapabilityProviders.providers` 包含一个 entry，其 `provider.providerId="local-a"`、`provider.providerKind="LOCAL_DIRECTORY"`、`discoveryMode="EAGER"`，且 `options.directoryRef` 被设为从 `./capabilities/a` 解析出的绝对路径

#### Scenario: 用户 `custom` entry 保留 `providerType` 和 `customOptions`

- **WHEN** 用户配置包含 `{ id: "custom-a", type: "custom", adapter: "vendor-a", config: { mode: "test" } }` 且 `vendor-a` 已注册
- **THEN** 解析后的 provider 具有 `provider.providerType="vendor-a"`、`discoveryMode="EAGER"` 和 `options.customOptions={ mode: "test" }`

### Requirement: Custom provider 需要显式 adapter 注册

当 `type=custom` 时，provider entry MUST 包含非空的 `adapter`。app composition 边界 MUST 已显式注册匹配的 custom adapter，该 provider 才能贡献可执行的 descriptor。resolver MUST 对任何 adapter 未注册的 custom entry 发出 `CUSTOM_ADAPTER_UNREGISTERED`，并且 MUST NOT 把该 provider 加入 `ResolvedCapabilityProviders.providers`。

#### Scenario: Custom provider 缺少 adapter

- **WHEN** 某 custom provider entry 省略了 `adapter`
- **THEN** resolver MUST 对该 entry 发出 `MISSING_REQUIRED_FIELD`
- **AND** 该 entry MUST NOT 出现在 `ResolvedCapabilityProviders.providers` 中

#### Scenario: Custom provider 的 adapter 未注册

- **WHEN** 某 custom provider entry 带有 `adapter` 但没有匹配的 app 级 adapter 注册
- **THEN** resolver MUST 发出 `CUSTOM_ADAPTER_UNREGISTERED`
- **AND** 该 entry MUST NOT 出现在 `ResolvedCapabilityProviders.providers` 中

### Requirement: Provider 引用和凭据在启动期间校验

Active provider entry MUST 在启动期间校验其配置的 `path`、`url` 和 `credential` 引用。`credential` MUST 使用 `SecretReference` 语法（`env:` 或 `file:` 前缀），active 的必需引用 MUST NOT 推迟到第一个请求。resolver MUST 消费 app 提供的用于 credential、URL 和 local-directory 路径可解析性的谓词。

#### Scenario: Active credential 引用无效

- **WHEN** 某 active provider 需要的 credential 引用缺失、格式错误或不可解析
- **THEN** resolver MUST 发出 `INVALID_CREDENTIAL_REFERENCE`
- **AND** 系统 MUST NOT 暴露原始 secret 内容、未解析的文件内容或 adapter 原生异常文本

#### Scenario: Active URL 引用无效

- **WHEN** 某 active provider 的 `url` 缺失、格式错误或被 app 的 `isUrlResolvable` 谓词拒绝
- **THEN** resolver MUST 发出 `INVALID_URL`

#### Scenario: Active local-directory 路径无效

- **WHEN** 某 active `local-directory` provider 的 `path` 缺失、为空白或被 app 的 `isLocalDirectoryPathResolvable` 谓词拒绝
- **THEN** resolver MUST 发出 `INVALID_PATH`

### Requirement: 空的或部分无效的用户配置永不阻塞启动

resolver MUST 对任何输入返回 `ResolvedCapabilityProviders`——包括 `undefined`、空 `[]`，以及每个 entry 都无效的输入。系统 MUST NOT 在 resolver 边界抛出异常。无论用户配置如何，由 `agent-capability` 创建的 builtin provider 始终存在。

#### Scenario: 用户配置缺失

- **WHEN** `adnclaw.system.capability-providers` 缺失或数组为空
- **THEN** resolver 返回 `{ providers: [], diagnostics: [] }`
- **AND** 系统仅以 builtin provider 继续启动

#### Scenario: 每个用户 entry 都无效

- **WHEN** 用户 providers 列表中的每个 entry 都未通过校验
- **THEN** resolver 返回空的 `providers` 数组和非空的 `diagnostics` 数组
- **AND** resolver MUST NOT 抛出异常
- **AND** 系统仅以 builtin provider 继续启动

### Requirement: 校验遵循确定性规则顺序

resolver MUST 对每个用户 entry 按以下顺序应用规则：

1. 校验 `id` 是非空字符串
2. 校验 `id` 在 providers 列表内唯一
3. 校验 `type` 属于封闭的 kebab-case kind 集合
4. 校验 type 特定的必填字段
5. 校验 `url` / `path` / `installDir` / `adapter` 形状
6. 校验 `credential` 的 SecretReference 语法
7. 查询 app 提供的谓词（`isUrlResolvable`、`isLocalDirectoryPathResolvable`、`isCredentialReferenceResolvable`、`isProviderAdapterRegistered`）
8. 把该 entry 映射为 `CapabilityProviderConfig` 并追加到 `providers`

无效 entry MUST 按输入顺序累积为 diagnostics；resolver MUST NOT 在第一个失败处中止。

#### Scenario: 多个校验错误按输入顺序累积

- **WHEN** 用户配置包含三个无效 entry（缺少 `adapter`、URL 无效、缺少 `installDir`）
- **THEN** `ResolvedCapabilityProviders.diagnostics` 包含三条 diagnostic 记录，顺序与用户 entry 相同
- **AND** `ResolvedCapabilityProviders.providers` 为空
- **AND** resolver 不抛出异常

### Requirement: Resolver 输出具有单一的 2 字段形状

成功的 resolver 输出 SHALL 是单一的 `ResolvedCapabilityProviders`，包含：

- `providers`：已校验、可供 `agent-capability` 消费的 `CapabilityProviderConfig[]`
- `diagnostics`：安全的只读 diagnostic 记录，包含 `reasonCode` / `severity` / `message` / 可选的 `providerId`

该输出 MUST NOT 包含 `readinessState`、`frozenAt`、`disabled` 列表、`disabledCapabilityIdsByProviderId` map 或任何其他平行的冻结 artifact。

#### Scenario: Resolver 输出形状恰好为 2 个字段

- **WHEN** resolver 成功返回
- **THEN** 返回的对象恰好暴露 `providers` 和 `diagnostics` 两个 key
- **AND** 下游消费者 SHALL 从 `providers` 推导 `providerIds`
- **AND** 下游消费者 SHALL 从 `diagnostics` 推导失败的 entry

### Requirement: Capability provider 配置流与下游 composition 边界集成

capability provider 配置流 SHALL 把启动连接到：

- capability discovery（`agent-capability` 消费 `ResolvedCapabilityProviders.providers`）
- Agent assembly 的 capability binding 解析
- readiness 与健康 diagnostics（消费 `ResolvedCapabilityProviders.diagnostics`）

任何下游模块 MAY NOT 创建与之竞争的 app 级 provider 配置状态机，或绕过启动 resolver 结果的 request-time fallback 路径。

#### Scenario: Agent assembly 消费解析后的 provider 而不是原始用户配置

- **WHEN** Agent assembly 为某个 Agent 解析启用的 capability binding
- **THEN** 它 MUST 消费由 `ResolvedCapabilityProviders.providers` 推导出的下游 capability discovery 或 catalog 结果
- **AND** 它 MUST NOT 直接解释原始的用户 provider 配置

### Requirement: Capability provider diagnostic 保持安全且非业务化

capability provider 校验 artifact 是启动 artifact，不是 request lifecycle 事实。它们 MUST NOT 成为 canonical runtime timeline 事实、request history、checkpoint payload、pending input record、memory record 或用户可见的会话内容。

#### Scenario: Provider diagnostic 仅保持面向 operator

- **WHEN** 系统通过 readiness、健康或启动证据呈现 capability provider diagnostic
- **THEN** 这些 diagnostic MUST 保持面向 operator 的安全 diagnostic
- **AND** 它们 MUST NOT 被追加为用户可见的聊天消息或 request terminal 消息
- **AND** diagnostic 消息 MUST NOT 回显用户提供的 `path`、`url`、`credential` 或 `config` 值
