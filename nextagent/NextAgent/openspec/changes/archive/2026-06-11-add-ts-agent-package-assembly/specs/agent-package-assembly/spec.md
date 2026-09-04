## ADDED Requirements

### Requirement: Agent Package Assembly Compiles Runtime-Ready Assembly At Startup

系统 MUST 在 request acceptance 开放前，由 `agent-app` 将 app composition 已选中的每个 Agent package root 同步编译为 runtime-ready `AgentAssembly`，并将结果发布到 in-memory `AgentAssemblyRegistry`。该编译行为 MUST 发生在启动期 composition 阶段，不得延迟到 request path、后台刷新或 lazy lookup。

app composition MUST 在启动期 compile 前决定哪些 package root 参与本次装配。本 capability 只约束“被选中的 package root 如何编译为 runtime-facing assembly”，MUST NOT 定义产品入口选择、default-agent 打包布局或 release-packaging 文件同步。

#### Scenario: Startup compile publishes runtime-ready assembly

- **GIVEN** app composition 已选择一个 enabled Agent package root
- **WHEN** backend startup 执行 package assembly
- **THEN** `agent-app` MUST 解析该 package root 的权威 `agent.yaml`
- **AND** MUST 在任何 channel 或 runtime acceptance 对外服务前完成 compile
- **AND** MUST 产出 runtime-ready `AgentAssembly` 和对应的 in-memory `AgentAssemblyRegistry` entry
- **AND** runtime、core、context、capability 和 recovery MUST 只消费该 compiled assembly 或 registry lookup 结果

#### Scenario: Request path never reparses package inputs

- **WHEN** runtime、core、context engine、capability routing 或 recovery 需要 Agent assembly 数据
- **THEN** 它们 MUST 通过 `AgentAssemblyRegistry` 或 accepted assembly facts 读取已编译结果
- **AND** MUST NOT 在 request path 重新解析 `agent.yaml`、`skills/`、`subagents/`、`prompts/` 或 provider/source package 输入

### Requirement: Agent Package Inputs Have Fixed Authority And Compile Order

系统 MUST 将 `agent.yaml` 视为一个 Agent package 的权威业务装配输入。package-scoped `skills/`、`subagents/`、`prompts/` 和 assembly-scoped provider/source 输入 MAY 提供候选事实，但 MUST NOT 自行成为 runtime-facing assembly。

compile 顺序 MUST 固定为：
1. 解析 package root 和 `agent.yaml`
2. 校验 `agentId`、`agentVersion`、display metadata、workspace 和 runtime settings
3. 收集 package-scoped candidate sources
4. 消费已验证的 model/profile/template ids 或 facts，以及 capability binding 需要的 registered provider facts
5. 生成 runtime-facing `AgentAssembly`
6. 将结果发布到 in-memory registry 和 assembly compile diagnostics

#### Scenario: Candidate sources do not bypass authoritative assembly input

- **WHEN** package-scoped `skills/`、`subagents/`、`prompts/` 或 provider/source 输入存在
- **THEN** 它们 MUST 只被当作 assembly compile 的候选输入
- **AND** MUST NOT 绕过 `agent.yaml` 权威性
- **AND** MUST NOT 被直接暴露为 runtime-facing `AgentAssembly`

#### Scenario: Half-compiled assembly is never exposed

- **WHEN** compile 在 package parsing 之后的任一步骤失败
- **THEN** 系统 MUST NOT 暴露半成品 `AgentAssembly`
- **AND** MUST 只在 fail-closed 或完整降级 assembly 两种结果之间收敛

### Requirement: Runtime-Ready AgentAssembly Contains Only Runtime-Facing Fields

系统 MUST 生成仅包含 runtime-facing 最小结果的 `AgentAssembly`。运行时结果 MUST 包含：

- `agentId`
- `agentType`
- `agentVersion`
- `agentAssemblyRef`
- `displayName`
- `description`
- `workspaceDir`
- `modelProfileIds`
- `promptTemplateIds`
- `capabilityBindings`
- `runtimeSettings`

系统 MUST NOT 将原始 `agent.yaml`、原始 package 布局、prompt 正文、provider/source 配置、provider secret、model profile 详情、shadowing records、deny rules 或 Skill/SubAgent package 内容放入 runtime-facing `AgentAssembly`。

#### Scenario: Assembly excludes raw package and provider inputs

- **WHEN** startup compile 生成一个 runtime-ready `AgentAssembly`
- **THEN** 该 assembly MUST 只包含 runtime-facing 字段
- **AND** MUST 排除 raw package files、prompt text、provider configuration、provider secrets 和 package contents

### Requirement: Capability Bindings Remain Assembly Facts Rather Than Discovery Results

系统 MUST 将 runtime-facing `AgentAssembly.capabilityBindings` 视为 Agent 的显式 enabled binding facts，而不是 capability descriptor 已发现或已可执行的快照。assembly compiler MUST 只校验 binding shape、安全 id、capability type 和 registered provider id；capability descriptor existence、availability、conflict 和 executability MUST 继续由 capability catalog 在 request-scope `listAvailable` / `resolve` 阶段判断。

compiler 透传全部 capability binding facts（含 `enabled`）到 runtime-facing assembly。compiler 只校验 binding shape 和 provider registration，enable/disable 决策由 Capability Catalog 在执行期根据 `enabled` 字段判断。

assembly compiler MUST NOT 为 framework-default builtin capability、default-enabled trusted provider 或 request-scope search 结果写入 synthetic enabled binding。explicit `enabled=false` 表示显式禁用同 key 默认 capability，MUST 被透传到 runtime-facing assembly 供 Catalog 处理。

#### Scenario: Assembly compiles without requiring descriptor pre-discovery

- **WHEN** Agent definition 包含一个 shape 合法、provider 已注册的 capability binding
- **THEN** assembly compiler MUST 能在不先读取 capability catalog descriptor 快照的情况下生成 `AgentAssembly.capabilityBindings`
- **AND** descriptor 是否存在、是否 AVAILABLE、是否发生冲突 MUST 留给 capability catalog 后续判断

#### Scenario: Default-enabled capability visibility is not written back into assembly

- **WHEN** 某个 builtin capability 或 trusted default-enabled provider capability 对当前 request scope 默认可见
- **THEN** 该默认可见性 MUST 由 capability catalog 负责
- **AND** 系统 MUST NOT 为表达该默认可见性向 `AgentAssembly.capabilityBindings` 写入 synthetic enabled binding

### Requirement: AgentAssemblyRegistry Lookup Semantics Stay Frozen

系统 MUST 提供 in-memory `AgentAssemblyRegistry` 作为 runtime-facing lookup boundary。

- `active(agentId)` MUST 只用于 request acceptance 或等价的 pre-acceptance active-version 解析
- `require(agentId, agentVersion)` MUST 只用于 accepted request execution、recovery、context engine、core 和 capability routing
- request 一旦被 accepted，系统 MUST 持续通过 `require(agentId, agentVersion)` 使用冻结 assembly
- accepted execution MUST NOT 回退到 `active(agentId)` 或静默切换到另一个 active version

#### Scenario: Acceptance uses active lookup and accepted run uses require lookup

- **WHEN** runtime 即将接受一个新 request
- **THEN** MUST 通过 `AgentAssemblyRegistry.active(agentId)` 解析当前 active assembly
- **AND** acceptance 之后的执行与恢复路径 MUST 通过 `AgentAssemblyRegistry.require(agentId, agentVersion)` 读取冻结 assembly
- **AND** runtime MUST 在 accepted request state 中固化 `agentId`、`agentVersion` 和 `agentAssemblyRef`
- **AND** 后续处理 MUST NOT 重新读取 package 输入来改写该 request 的 assembly

#### Scenario: Missing assembly does not fall back to a default assembly

- **WHEN** `active(agentId)` 或 `require(agentId, agentVersion)` 无法解析所需 assembly
- **THEN** 系统 MUST 返回明确的 missing-assembly / not-found safe failure
- **AND** MUST NOT 合成 implicit default assembly 或静默切换版本

### Requirement: Workspace Resolution And Package Validation Are Compile-Time Preconditions

系统 MUST 在 `workspaceDir` 进入 runtime-facing assembly 之前完成解析和安全校验。compiler MUST 拒绝路径越界、未解析 workspace 引用、未授权系统目录和 raw unresolved path 进入 runtime-facing assembly。

系统 MUST 在 compile-time 校验 required model/profile/template/provider 引用、resource path 和 Agent identity/version。缺失、非法或越界输入 MUST 在 assembly publication 前被拒绝。

#### Scenario: Invalid workspace causes fail-closed assembly compile

- **WHEN** package assembly 输入把 `workspaceDir` 解析到非法或未授权路径
- **THEN** package assembly compile MUST fail closed
- **AND** runtime acceptance MUST NOT 为该 required assembly 开放

#### Scenario: Missing required references fail before assembly publication

- **GIVEN** app composition 选择了一个 enabled Agent package root
- **AND** 该 package 引用了 required model、prompt、provider 或 resource facts
- **WHEN** compile-time 校验发现至少一个 required reference 缺失、非法或越界
- **THEN** startup MUST 在 assembly publication 前 fail closed
- **AND** 该缺失事实 MUST NOT 被静默删除后继续发布 assembly

### Requirement: Failure And Degradation Are Explicit At The Package Assembly Boundary

系统 MUST 区分 fail-closed assembly failure 和 safe unavailable assembly degradation。

fail-closed 条件至少包括：

- 缺失权威 `agent.yaml`
- 非法 `agentId` 或 `agentVersion`
- 非法或未授权 `workspaceDir`
- required model / prompt / provider / resource reference 缺失或非法
- required assembly compile failure
- registry 无法提供 startup serving 所需的 active lookup

safe unavailable / degraded assembly 条件至少包括：

- 未被显式 binding 消费的非关键 candidate source unavailable
- 非关键 package-scoped candidate 输入校验失败，但权威 assembly 仍然合法

系统 MUST NOT 静默吞掉失败候选、暴露半成品 assembly、或在 request path 重新尝试解析 package 输入来绕过启动期 compile 失败。

#### Scenario: Missing authoritative input fails closed

- **WHEN** required Agent package 缺失权威 `agent.yaml`
- **THEN** startup assembly MUST fail closed
- **AND** request-serving path MUST 在问题修复前保持不可用

#### Scenario: Non-critical unbound candidate source degrades with safe diagnostics

- **WHEN** 一个未被显式 binding 消费的非关键 package-scoped candidate source 无法加载或校验
- **THEN** compiler MAY 在权威 assembly 仍合法时继续生成 runtime-ready assembly
- **AND** MUST 从 resulting assembly 中排除该失败候选
- **AND** MUST 产出 safe assembly compile diagnostics 记录该降级
