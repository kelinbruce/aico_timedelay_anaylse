## MODIFIED Requirements

### Requirement: 用户配置使用直观的短字段名

面向用户的配置路径 `nextAgent.system.capability-providers` SHALL 持有一个扁平的 provider entry 数组。该数组中的每个 entry SHALL 使用以下字段名：

- `id`（必需，非空，在 providers 列表内唯一）
- `type`（必需，必须属于封闭的 kebab-case kind 集合）
- `url`（`mcp-server` 和 `agent-registry` 必需）
- `credential`（`mcp-server` 和 `agent-registry` 可选；必须使用 `env:` 或 `file:` SecretReference 语法）
- `gatewayId`（`skill-hub` 必需）
- `installDir`（`skill-hub` 必需）
- `adapter`（`custom` 必需）
- `config`（可选，透传给 `custom` provider 的 JSON object）

`skill-hub` provider entry MUST NOT 接受 `url`、`credential`、endpoint、credential reference、token、tenant/subject 私有数据、raw remote payload 或 provider 私有加载 key。具体的 SkillHub 服务访问事实属于所选的 remote gateway adapter 或部署 overlay。

#### Scenario: Skill-hub 拒绝直接的服务访问字段

- **WHEN** 一个 `skill-hub` provider entry 包含 `url`、`credential`、endpoint、token、tenant/subject 私有数据、raw remote payload 或 provider 私有加载 key
- **THEN** startup MUST 在配置边界拒绝该 provider entry
- **AND** 诊断 MUST 是安全的，且 MUST NOT 回显被拒绝的 raw 服务访问值

### Requirement: 用户配置映射到内部 CapabilityProviderConfig 形态

resolver SHALL 把每个已接受的用户 entry 转换为来自 `capability-catalog/spec.md` 的 `CapabilityProviderConfig`，规则如下：

| 用户 `type` | `provider.providerId` | `provider.providerKind` | `provider.providerType` | `discoveryMode` | `options` 映射 |
|-------------|----------------------|----------------------|----------------------|-----------------|-------------------|
| `mcp-server` | 来自 `id` | `MCP_SERVER` | - | `SEARCH` | `options.endpoint` = `url`<br>`options.credentialRef` = `credential`（如存在） |
| `agent-registry` | 来自 `id` | `AGENT_REGISTRY` | - | `EAGER` | `options.registryRef` = `url`<br>`options.credentialRef` = `credential`（如存在） |
| `skill-hub` | 来自 `id` | `SKILL_HUB` | - | `SEARCH` | `options.gatewayId` = `gatewayId`<br>`options.managedInstallRef` = 由 `installDir` 解析出的绝对路径 |
| `custom` | 来自 `id` | `CUSTOM` | 必需，来自 `adapter` | `EAGER` | `options.customOptions` = `config`（如存在） |

`skill-hub` 映射 MUST 继续使用既有的 `skill-hub` 用户类型和 `SKILL_HUB` provider kind。它 MUST NOT 引入第二种远程 Skill provider kind，例如 `REMOTE_SKILL`。

#### Scenario: Skill-hub 映射到 gateway 支撑的 provider options

- **WHEN** 用户配置包含 `{ id: "hub-a", type: "skill-hub", gatewayId: "skillhub-main", installDir: "./skillhub-managed" }`
- **THEN** 解析出的 provider 带有 `provider.providerKind="SKILL_HUB"` 和 `discoveryMode="SEARCH"`
- **AND** `options.gatewayId` 为 `"skillhub-main"`
- **AND** `options.managedInstallRef` 由相对配置 workspace root 的 `installDir` 解析得到
- **AND** 解析出的 provider options MUST NOT 包含 `endpoint`、`credentialRef`、具体 URL、token 或服务特定的 wire 事实

### Requirement: Provider 引用和凭据在 startup 期间校验

active provider entry MUST 在 startup 期间校验其配置的引用。`mcp-server` 和 `agent-registry` MUST 校验配置的 `url` 和可选 `credential`。`skill-hub` MUST 校验配置的 `gatewayId` 和 `installDir`，且 MUST NOT 校验或要求直接的服务 URL 或 credential。必需的 active 引用 MUST NOT 推迟到第一个 request。

resolver MUST 消费由 app 提供的 credential、URL、install 目录路径规范化和 provider adapter 注册谓词。SkillHub `installDir` 路径规范化 MUST 使用配置的 workspace root，使远程 Skill 受管内容位于 runtime workspace 区域之内；这 MUST NOT 改变 `mcp-server` 或 `agent-registry` 的 `file:` credential reference 解析方式。具体的 SkillHub URL 和 credential 校验属于所选的 remote gateway adapter 或部署 overlay，而不属于面向用户的 capability provider resolver。

#### Scenario: Active skill-hub gateway 引用缺失

- **WHEN** 一个 active `skill-hub` provider 省略 `gatewayId` 或使用空白值
- **THEN** resolver MUST 发出 `MISSING_REQUIRED_FIELD`
- **AND** `ResolvedCapabilityProviders.providers` MUST NOT 包含该 provider

#### Scenario: Active skill-hub 安装目录缺失

- **WHEN** 一个 active `skill-hub` provider 的 `installDir` 缺失或为空白
- **THEN** resolver MUST 发出 `MISSING_REQUIRED_FIELD`
- **AND** `ResolvedCapabilityProviders.providers` MUST NOT 包含该 provider
