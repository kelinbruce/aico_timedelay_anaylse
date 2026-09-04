## MODIFIED Requirements

### Requirement: Workspace Resolution And Package Validation Are Compile-Time Preconditions

系统 MUST 在 `workspacePolicy` 进入 runtime-facing assembly 之前完成解析和安全校验。compiler MUST 拒绝未解析 workspace policy、非法 schema version、非法 isolation mode、非法 root kind、非法 logical path/access、未授权系统目录引用、raw unresolved path 或会把 execution roots 指向 provider-private/source-private layout 的输入进入 runtime-facing assembly。`workspacePolicy` MUST NOT 承载 lifecycle、deployment mode、物理 root、trusted identity、request/run-specific fields 或 provider-private loading facts。Limits 只有在存在明确 per-agent 消费者时才进入 assembly contract；首版继续使用系统/工具默认限制。

`workspacePolicy.roots` MAY include the root kind `sharedData` with canonical logical path `shared-data` and access `read` only when trusted app composition is building a LOCAL deployment runtime-facing assembly. `sharedData` authorizes the local shared data root for root-aware file tools and sandbox filesystem preparation. `sharedData` MUST NOT contain a physical path in assembly, MUST NOT be readWrite, MUST NOT be interpreted as an Agent package source, MUST NOT be emitted for REMOTE/PaaS deployment mode, and MUST NOT change prompt-facing `workspaceDir`.

系统 MUST 在 compile-time 校验 required model/profile/template/provider 引用、resource path 和 Agent identity/version。缺失、非法或越界输入 MUST 在 assembly publication 前被拒绝。

#### Scenario: Invalid workspace policy causes fail-closed assembly compile

- **WHEN** package assembly 输入把 `workspacePolicy` 解析为非法 schema version、非法 isolation mode、非法 root kind、非法 logical path/access、未授权系统目录引用、raw unresolved path、lifecycle、deployment mode、物理 root、trusted identity、request/run-specific fields 或 provider-private loading facts
- **THEN** package assembly compile MUST fail closed
- **AND** runtime acceptance MUST NOT 为该 required assembly 开放

#### Scenario: Shared data root policy is logical and read-only

- **WHEN** package assembly 输入包含 `sharedData` root kind
- **THEN** trusted app composition MUST accept it only for LOCAL deployment mode when logical path is `shared-data` and access is `read`
- **AND** compiler or composition MUST reject any physical shared-data path, `readWrite` access, lifecycle, deployment mode or request/run-specific field in `workspacePolicy`
- **AND** REMOTE/PaaS composition MUST fail closed if `sharedData` would enter runtime-facing assembly

#### Scenario: Missing required references fail before assembly publication

- **GIVEN** app composition 选择了一个 enabled Agent package root
- **AND** 该 package 引用了 required model、prompt、provider 或 resource facts
- **WHEN** compile-time 校验发现至少一个 required reference 缺失、非法或越界
- **THEN** startup MUST 在 assembly publication 前 fail closed
- **AND** 该缺失事实 MUST NOT 被静默删除后继续发布 assembly
