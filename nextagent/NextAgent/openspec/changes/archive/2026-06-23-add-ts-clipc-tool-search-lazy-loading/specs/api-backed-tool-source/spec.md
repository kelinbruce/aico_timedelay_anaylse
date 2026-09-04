## ADDED Requirements

### Requirement: CLIP Tool Disclosure Supports ToolSearch-Deferred Lazy Loading

当 `clip_server` provider 被配置为 ToolSearch-deferred CLIP disclosure 时，系统 MUST 将 CLIP API 候选作为可搜索的 deferred CLIP Tool 候选处理。初始模型上下文 MUST 只披露 `<available-deferred-clipc>` 中的候选 `capabilityId`，不得把所有 CLIP API 的描述和 schema 默认拼入 system prompt 或模型工具列表。

ToolSearch 命中 CLIP-backed Tool 后，系统 MUST 生成 `<available-clipc>` 元消息，并 MUST 通过 request-local `CapabilityContextPatch.allowedTools` 激活命中的具体 CLIP Tool。后续模型 step MUST 看到被激活 CLIP Tool 的普通 model tool descriptor，包括该 Tool 的 `inputSchema`，以便模型进行参数提取。系统 MUST NOT 为 CLIP source 暴露单一 `clipc`、`clip_api_call` 或 `api_name + args` 泛化分发工具。

#### Scenario: 初始上下文只披露 deferred CLIP id

- **WHEN** `clip_server` provider 处于 ToolSearch-deferred CLIP disclosure 模式
- **AND** 该 provider 发现多个可用 CLIP-backed Tool
- **THEN** 初始 system prompt MUST 包含 `<available-deferred-clipc>` 和 `</available-deferred-clipc>`
- **AND** `<available-deferred-clipc>` 内 MUST 只列出候选 CLIP Tool 的 `capabilityId`
- **AND** 初始模型工具列表 MUST NOT 包含这些 deferred CLIP Tool，除非其中某个 Tool 同时被 request-local `allowedTools` 激活

#### Scenario: ToolSearch 命中 CLIP Tool 后激活普通工具

- **WHEN** ToolSearch 搜索命中一个或多个 deferred CLIP Tool
- **THEN** ToolSearch result MUST 包含这些 CLIP Tool 的安全 metadata
- **AND** ToolSearch MUST 生成 `<available-clipc>` 元消息，列出 `capability_id`、`name`、`kind=TOOL`、`defer_loading=true` 和安全描述
- **AND** ToolSearch MUST 在 `contextPatch.allowedTools` 中包含命中的 CLIP Tool `capabilityId`
- **AND** 下一次模型输入 MUST 将命中的 CLIP Tool 作为普通 model tool descriptor 暴露
- **AND** 暴露的 model tool descriptor MUST 使用该 CLIP Tool 自身的 `inputSchema`，不得要求模型填写 provider-private CLIP id、primitive、command 或 API selector 字段

#### Scenario: ToolSearch 未命中时不激活 CLIP 工具

- **WHEN** ToolSearch 对 deferred CLIP Tool 的查询没有命中结果
- **THEN** ToolSearch MUST NOT 生成 `<available-clipc>`
- **AND** ToolSearch MUST NOT 在 `contextPatch.allowedTools` 中加入 CLIP Tool
- **AND** 后续模型工具列表 MUST 保持未命中 CLIP Tool 不可见

### Requirement: CLIP Disclosure Mode Is Configurable

系统 MUST 提供 CLIP disclosure 配置开关，使业务集成方能够选择 CLIP-backed Tool 的默认披露策略。未显式配置时，系统 MUST 保持既有默认披露行为，不额外把 CLIP-backed Tool 标记为 deferred。配置为 `tool-search` 时，CLIP-backed Tool MUST 使用 ToolSearch-deferred disclosure，并通过 ToolSearch 激活具体普通 Tool descriptor。

#### Scenario: 未配置时保持兼容行为

- **WHEN** 系统配置没有声明 CLIP disclosure mode
- **THEN** `clip_server` provider MUST 保持现有默认披露行为
- **AND** 已有 CLIP-backed Tool discovery、governance、invocation 行为 MUST 不因该配置缺省而改变

#### Scenario: 配置 tool-search 后启用 CLIP ToolSearch 懒加载

- **WHEN** 系统配置声明 CLIP disclosure mode 为 `tool-search`
- **THEN** `clip_server` provider 发现的 CLIP-backed Tool MUST 使用 ToolSearch-deferred disclosure
- **AND** 初始 system prompt、ToolSearch result、request-local `allowedTools` 激活和后续模型工具列表 MUST 满足 `CLIP Tool Disclosure Supports ToolSearch-Deferred Lazy Loading`

## MODIFIED Requirements

### Requirement: Startup Discovery Uses An Injected Runner Backed By The Existing Execution Boundary

API-backed Tool source MUST obtain CLIP-backed tool facts through an injected CLIP command runner backed by the existing sandbox/gateway execution boundary rather than direct host-process execution from `agent-capability`. This change MUST NOT add a CLIP-specific public gateway port.

The runner production implementation MUST NOT require a new `SandboxExecutionRequest.executable` enum value. If it invokes `clipc`, it MUST do so through the existing sandbox/gateway execution boundary using existing executable shapes and a controlled command template.

When CLIP disclosure mode is the default list mode, the source MUST preserve the existing startup discovery behavior and register successfully validated CLIP-backed tools through the normal capability governance path without adding deferred disclosure policy. When CLIP disclosure mode is `tool-search`, startup discovery MAY still use the existing discovery pass to obtain governed CLIP descriptors, but default model disclosure MUST be ToolSearch-deferred and MUST NOT put the full CLIP API set into the initial model tool list.

#### Scenario: Startup scan registers validated tools

- **WHEN** the `clip_server` provider is enabled with valid configuration
- **THEN** startup discovery MUST invoke the CLIP-backed discovery path through the injected CLIP command runner
- **AND** discovery MUST call the injected CLIP command runner to list or describe available CLIP-backed tools
- **AND** the runner production implementation MUST be composed outside `agent-capability` and backed by the existing sandbox/gateway execution boundary
- **AND** successfully validated tools MUST be registered through the normal capability governance path
- **AND** ToolSearch-deferred CLIP disclosure MUST keep those registered tools out of the default model-visible tool list until ToolSearch activates them through request-local `allowedTools`

#### Scenario: Sandbox executable vocabulary is not expanded

- **WHEN** the runner production implementation invokes `clipc`
- **THEN** it MUST use the existing sandbox/gateway execution contract without adding a new CLIP-specific executable kind
- **AND** `agent-capability` MUST NOT depend on the concrete sandbox or gateway-local implementation

#### Scenario: Periodic sync is outside this change

- **WHEN** the system needs periodic polling, dynamic unregister, manual refresh, hot update, or long-lived cache invalidation for CLIP-backed tools
- **THEN** those behaviors MUST be defined by a later change
- **AND** this change MUST NOT add a polling task, manual refresh command, or catalog mutation path outside startup discovery
