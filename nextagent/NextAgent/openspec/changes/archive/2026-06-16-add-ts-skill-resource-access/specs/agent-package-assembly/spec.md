## MODIFIED Requirements

### Requirement: Runtime-Ready AgentAssembly Contains Only Runtime-Facing Fields

系统 MUST 生成仅包含 runtime-facing 最小结果的 `AgentAssembly`。运行时结果 MUST 包含：

- `agentId`
- `agentType`
- `agentVersion`
- `agentAssemblyRef`
- `displayName`
- `description`
- `workspacePolicy`
- `modelProfileIds`
- `promptTemplateIds`
- `capabilityBindings`
- `runtimeSettings`

`workspacePolicy` MUST be the runtime-facing policy for execution file access. It MUST contain a policy schema version, isolation mode and logical root policies for the execution roots authorized for the agent. Logical root policies MAY describe root kind, logical path and access, but MUST NOT contain lifecycle, host physical execution roots, raw tenant/subject/session identifiers, Skill source paths, provider-private loading facts, managed install paths or request/run-specific fields. Physical execution roots MUST be derived later by runtime from the system runtime workspace root, `workspacePolicy`, trusted owner scope and trusted run/session facts. The prompt-facing `workspaceDir` MUST be the logical path `workspace/`; the physical workspace root MUST NOT be stored as a raw `AgentAssembly` field.

For source compatibility, package compilation MAY accept an existing raw `agent.yaml.workspaceDir` field, but it MUST NOT copy that value into `AgentAssembly` and MUST NOT use it to derive physical execution roots. If `agent.yaml.workspaceDir` is present, the compiler MUST either ignore it with safe deprecation evidence or fail closed when the value is absolute, unresolved, points at a system/provider-private directory, or otherwise implies a physical execution root.

系统 MUST NOT 将原始 `agent.yaml`、原始 package 布局、prompt 正文、provider/source 配置、provider secret、model profile 详情、shadowing records、deny rules、`workspaceDir` raw path 或 Skill/SubAgent package 内容放入 runtime-facing `AgentAssembly`。

#### Scenario: Assembly exposes workspace policy instead of workspace dir

- **WHEN** startup compile 生成一个 runtime-ready `AgentAssembly`
- **THEN** 该 assembly MUST contain `workspacePolicy`
- **AND** 该 assembly MUST NOT contain `workspaceDir`
- **AND** runtime consumers that need prompt-facing `workspaceDir` MUST derive logical `workspace/`; consumers that need physical workspace access MUST use resolver-backed infrastructure
- **AND** physical execution roots MUST NOT be derivable from raw package paths alone

#### Scenario: Legacy workspaceDir does not enter assembly

- **WHEN** startup compile reads an Agent package that contains `agent.yaml.workspaceDir`
- **THEN** the compiler MAY accept the field for source compatibility
- **AND** the resulting runtime-ready `AgentAssembly` MUST still contain `workspacePolicy`
- **AND** it MUST NOT contain `workspaceDir`
- **AND** the raw `workspaceDir` value MUST NOT determine runtime physical execution roots
- **AND** unsafe `workspaceDir` values MUST fail closed before assembly publication

#### Scenario: Assembly excludes raw package and provider inputs

- **WHEN** startup compile 生成一个 runtime-ready `AgentAssembly`
- **THEN** 该 assembly MUST 只包含 runtime-facing 字段
- **AND** MUST 排除 raw package files、prompt text、provider configuration、provider secrets、package contents and raw workspace paths

### Requirement: Workspace Resolution And Package Validation Are Compile-Time Preconditions

系统 MUST 在 `workspacePolicy` 进入 runtime-facing assembly 之前完成解析和安全校验。compiler MUST 拒绝未解析 workspace policy、非法 schema version、非法 isolation mode、非法 root kind、非法 logical path/access、未授权系统目录引用、raw unresolved path 或会把 execution roots 指向 provider-private/source-private layout 的输入进入 runtime-facing assembly。`workspacePolicy` MUST NOT 承载 lifecycle、deployment mode、物理 root、trusted identity、request/run-specific fields 或 provider-private loading facts。Limits 只有在存在明确 per-agent 消费者时才进入 assembly contract；首版继续使用系统/工具默认限制。

系统 MUST 在 compile-time 校验 required model/profile/template/provider 引用、resource path 和 Agent identity/version。缺失、非法或越界输入 MUST 在 assembly publication 前被拒绝。

#### Scenario: Invalid workspace policy causes fail-closed assembly compile

- **WHEN** package assembly 输入把 `workspacePolicy` 解析为非法 schema version、非法 isolation mode、非法 root kind、非法 logical path/access、未授权系统目录引用、raw unresolved path、lifecycle、deployment mode、物理 root、trusted identity、request/run-specific fields 或 provider-private loading facts
- **THEN** package assembly compile MUST fail closed
- **AND** runtime acceptance MUST NOT 为该 required assembly 开放

#### Scenario: Missing required references fail before assembly publication

- **GIVEN** app composition 选择了一个 enabled Agent package root
- **AND** 该 package 引用了 required model、prompt、provider 或 resource facts
- **WHEN** compile-time 校验发现至少一个 required reference 缺失、非法或越界
- **THEN** startup MUST 在 assembly publication 前 fail closed
- **AND** 该缺失事实 MUST NOT 被静默删除后继续发布 assembly
