# memory-configuration Specification

## Purpose

Defines how memory extraction prompt customization consumes the context-engine prompt template assembly boundary.
## Requirements
### Requirement: Memory extraction prompts consume prompt template assembly
Memory extraction prompt customization SHALL consume prompt template assembly with `PromptPurpose=MEMORY_EXTRACTION`. Agent-level memory extraction prompts SHALL be discovered from the Agent package `prompts/` directory and registered as Agent-scoped prompt template candidates for that purpose. Memory configuration MUST NOT define a separate prompt file format, loader chain, hand-written prompt id allowlist or request-path parser for extraction prompts.

#### Scenario: Memory extraction uses purpose-scoped template
- **WHEN** memory extraction needs a Chinese extraction prompt for an Agent
- **THEN** it MUST resolve a prompt template assembly request with `PromptPurpose=MEMORY_EXTRACTION` and the trusted Agent scope
- **AND** the selected prompt MUST come from registered prompt template facts or built-in fallback

#### Scenario: Missing custom extraction prompt falls back
- **WHEN** the Agent has no matching custom memory extraction prompt template
- **THEN** memory extraction MUST use the built-in fallback selected through prompt template assembly
- **AND** it MUST NOT scan Agent package files during the request or extraction execution path

#### Scenario: Extraction prompt errors and observations are redacted
- **WHEN** a memory extraction prompt binding is missing, rejected or falls back
- **THEN** safe errors or internal observations MAY include safe purpose, language and template identifiers when available
- **AND** they MUST NOT include extraction prompt text, raw template body, local path, memory content, model output, credential or token

### Requirement: Memory configuration snapshot

系统 SHALL 在应用启动和 Agent 装配进入可执行状态之前，加载、校验并冻结长期记忆配置为稳定的 `MemoryConfig` 运行时快照。已定义的 memory gateway/core consumers、capability consumers 和后续通过 OpenSpec 明确接入的 memory consumers 只能消费该快照或 app composition 派生的窄投影，不得重新解析源配置。

**触发机制**：
1. 应用 composition 加载产品配置时同步触发 memory configuration 加载。
2. Agent 装配需要 memory 资源覆盖解析结果时，同步读取已经冻结的配置快照和资源解析结果。
3. 该流程不属于 request lifecycle，不由用户请求、模型输出、capability invocation、后台 job 或 stream reconnect 触发。
4. 该流程没有异步后台调度；配置快照在应用 ready 前必须已经稳定。

**输入与前置条件**：
- 源配置已经由 app configuration 边界读取。
- 配置源属于不可信输入，必须接受 runtime schema validation。
- 当前代码基线的 app 配置 schema 中，`nextAgent` 已作为 app-private namespace 存在；本 change 必须在同一个 app-private `RawDefaultSystemConfig` / runtime schema 边界中把 `memory` 作为 `nextAgent.system` 的 sibling group 接入，不得新增第二套配置文件或绕过 `defaultSystemSchema`。
- `nextAgent` 对象允许只包含已定义的 `system` group、只包含已定义的 `memory` group，或同时包含二者；缺失 `nextAgent.memory` 等价于 memory 使用默认 enabled 配置，不要求在默认配置文件中显式写入 `nextAgent.memory.enabled=true`。
- 如需解析 Agent 级覆盖资源，必须具备已校验的 agent id、agent workspace/root ref 或等价安全装配上下文。
- 配置不得包含 `tenantId`、`subjectId`、owner、userId 或等价身份覆盖字段。

**输出与副作用**：
- 产生一个冻结的 `MemoryConfig` 快照。
- 产生配置诊断状态，至少包含 `VALID`、`INVALID`、`DISABLED` 三类可观察结果。
- 产生脱敏 structured log 和 metric；不得产生用户可见 stream delta、session message、memory record、learning event、checkpoint、artifact 或 pending input。

**核心判断逻辑**：
1. 校验配置字段名、类型和数值范围。
2. 拒绝任何身份/owner 覆盖字段；该拒绝不得被后续模块覆盖。
3. 若关键配置无效，配置状态为 `INVALID`，应用不得以 memory-enabled 状态启动。
4. 若 `nextAgent.memory.enabled=false`，配置状态为 `DISABLED`，memory consumers 必须看到稳定 disabled 快照。
5. 若 `nextAgent.memory.enabled` 缺失或为 `true` 且配置有效，则填充默认值并冻结 `VALID` 快照；冻结后同一进程内不得热更新。

**状态 / 产物契约**：
- `MemoryConfig` 是配置快照，不是 memory record、learning event、audit fact 或用户偏好。
- `MemoryConfig` 生命周期与当前应用进程的 app composition 生命周期一致。
- `MemoryConfig` 不代表授权事实；owner scope 仍只能来自 trusted identity boundary。
- 配置诊断只用于运维、测试和健康检查消费，不得进入模型输入或用户对话历史。

**流程接入**：
- 上游是 app configuration loading 和 Agent assembly。
- 下游是 app-composed selected memory ports / core consumer boundaries、agent-capability、后续显式接入的 memory consumers、observability，以及后续 local memory 编排实际接入时的 `agent-memory`。
- Runtime request lifecycle、channel stream projection 和 context assembly 不得拥有或修改该配置快照。

#### Scenario: Valid configuration becomes frozen snapshot
- **WHEN** 应用启动时源配置包含合法的 `nextAgent.memory.*` 字段且 `nextAgent.memory.enabled=true`
- **THEN** 系统 MUST 生成一个状态为 `VALID` 的 `MemoryConfig` 快照
- **AND** 所有已接入 memory consumers MUST 消费同一个快照
- **AND** 同一进程内后续源配置变化 MUST NOT 改变该快照

#### Scenario: Default memory configuration becomes valid snapshot
- **WHEN** 应用启动时源配置省略 `nextAgent.memory` 或省略 `nextAgent.memory.enabled`
- **AND** 源配置没有非法 memory 字段
- **THEN** 系统 MUST 生成一个状态为 `VALID` 且 `enabled=true` 的 `MemoryConfig` 快照
- **AND** 配置诊断 MUST 显示 memory enabled 来自默认值

#### Scenario: Owner override fields are rejected
- **WHEN** 源配置中出现 `tenantId`、`subjectId`、`owner`、`userId` 或等价身份覆盖字段
- **THEN** 系统 MUST 将 memory configuration 标记为 `INVALID`
- **AND** MUST 产生安全诊断 `MEMORY_CONFIG_OWNER_OVERRIDE_FORBIDDEN`
- **AND** 不得以这些字段作为任何 memory owner scope

#### Scenario: Memory explicitly disabled snapshot
- **WHEN** `nextAgent.memory.enabled=false`
- **THEN** 系统 MUST 生成状态为 `DISABLED` 的 `MemoryConfig` 快照
- **AND** app-composed selected memory port / core consumer boundary MUST 按 memory core 的 disabled 契约返回 `LTM_DISABLED`
- **AND** memory consumers MUST 不得把 disabled 伪装为成功空结果

### Requirement: Memory configuration namespace and defaults

系统 SHALL 定义 `nextAgent.memory.*` 外部配置命名空间。本 requirement 作为命名空间注册中心和校验入口，定义全局字段（`enabled`、`search.*`）并汇总已由对应 memory change 明确定义且获准进入实施范围的配置字段。后续新增 memory change 的配置字段 MUST 通过显式 spec delta 增加。

运行时配置的物理入口固定为 `default-system.yaml` / application overlay 中的 `nextAgent.memory` group。`search`、`extraction`、`aging` 等长期记忆子能力只允许作为 `nextAgent.memory.<subsystem>` 子组出现；系统 MUST NOT 接受 `nextAgent.extraction.*`、`nextAgent.aging.*`、`memory-extraction.*`、`memory-aging.*` 或独立 memory 子能力配置文件作为同等运行时入口。Agent 级绑定仍归已有 `agent.yaml` / Agent definition，不写入 `default-system.yaml`。

**配置契约**：
- `nextAgent.memory.enabled`：默认 `true`，允许值 `true|false`。显式 `false` MUST 禁用所有长期记忆能力。
- `nextAgent.memory.search.default-limit`：默认 `20`，范围 `[1, 100]`。
- `nextAgent.memory.search.min-confidence`：默认 `0.3`，范围 `[0.0, 1.0]`。
- `nextAgent.memory.extraction.enabled`：默认 `true`。该字段控制 extraction scheduler gate 和受控触发是否可用。
- `nextAgent.memory.extraction.crossSessionSchedule`：默认 `0 0 0 * * ?`，表示每天 00:00 触发本地 extraction scheduler。
- `nextAgent.memory.aging.enabled`：默认 `true`。该字段控制 aging scheduler gate 和受控触发是否可用。
- `nextAgent.memory.aging.schedule`：默认 `0 0 0 * * ?`，表示每天 00:00 触发本地 aging scheduler。
- App config schema MUST treat `nextAgent.system` and `nextAgent.memory` as sibling groups. `nextAgent.system` MUST NOT be required merely because `nextAgent.memory` is present, and `nextAgent.memory` MUST NOT be required merely because `nextAgent.system` is present.
- If owning memory changes register `extraction`, `aging`, `maintenance`, or similar runtime fields, those fields MUST remain child groups under `nextAgent.memory`; equivalent sibling groups under `nextAgent` MUST be rejected or marked explicitly inactive.

**命名空间扩展规则**：
- 后续 memory change MAY 在 `nextAgent.memory.*` 下新增字段，但必须在自身 OpenSpec delta 中定义触发机制、输入、输出、副作用、失败规则和验收样例。
- 已获准进入实施范围的 memory change 已在 `nextAgent.memory.*` 下注册了自身配置字段。`promotion`、`curator` 和 `sharing` 配置字段由后续 change 定义。
- 未被当前已合并规格定义的字段 MUST 被视为未知字段并拒绝，除非 app configuration 边界已经通过明确的兼容策略标记为非生效字段。

**触发机制**：
- 命名空间校验只在配置加载和快照冻结阶段触发。
- 本 requirement 不创建 scheduler、background job、maintenance job 或 sharing policy。

**输入与前置条件**：
- 源配置中缺失的字段使用上述默认值。
- 源配置中存在但非法的字段必须使配置校验失败；不得 warn 后使用默认值继续作为成功配置。

**输出与副作用**：
- 输出标准化后的配置值和字段级诊断。
- 不产生 memory lifecycle transition，不启动后台任务，不触发 extraction，不改变 capability catalog。

**核心判断逻辑**：
1. 对每个字段执行类型校验。
2. 对数值字段执行闭区间范围校验。
3. 对布尔字段执行允许值校验。
4. 任一非法字段使快照进入 `INVALID`，并阻止 memory-enabled 启动。
5. `nextAgent.memory.enabled=false` 使快照进入 `DISABLED`，并使所有长期记忆子能力 effective disabled。
6. `nextAgent.memory.enabled` 省略或为 `true` 且所有字段合法时，快照进入 `VALID`。
7. 省略 `extraction.crossSessionSchedule` 或 `aging.schedule` 时必须填充默认 cron `0 0 0 * * ?`；不得把字段缺失解释为对应 scheduler disabled。
8. 任一未定义的 memory 配置字段必须显式拒绝或由 app configuration 的兼容策略标记为不生效，不得被某个 consumer 私自解释。

**状态 / 产物契约**：
- `search.default-limit` 和 `search.min-confidence` 只是默认查询参数；搜索排序公式和 owner scope 语义由 memory core 规格定义。
- 配置快照不表达 maintenance、sharing 的状态机、调度计划、保留策略、共享策略、策略资源路径或写入策略。

#### Scenario: Defaults enable memory configuration
- **WHEN** 源配置省略 `nextAgent.memory.enabled` 且没有非法 memory 字段
- **THEN** `MemoryConfig` MUST 使用 `enabled=true`
- **AND** 配置状态 MUST 为 `VALID`
- **AND** search、extraction 和 aging MUST 使用各自已定义的默认值

#### Scenario: Explicit parent disabled disables all memory capabilities
- **WHEN** 源配置设置 `nextAgent.memory.enabled=false`
- **THEN** `MemoryConfig` MUST 使用 `enabled=false`
- **AND** 配置状态 MUST 为 `DISABLED`
- **AND** app-composed selected memory port / core consumer boundary MUST 按 memory core 的 disabled 契约返回 `LTM_DISABLED`
- **AND** memory tools、extraction、aging 的 effective enabled MUST 为 `false`

#### Scenario: Default-enabled background capabilities use midnight schedules
- **WHEN** 源配置省略 `nextAgent.memory.enabled`
- **AND** 源配置省略 `nextAgent.memory.extraction.crossSessionSchedule`
- **AND** 源配置省略 `nextAgent.memory.aging.schedule`
- **THEN** `MemoryConfig` MUST 为 `VALID`
- **AND** extraction 和 aging 的 effective enabled MUST 为 `true`
- **AND** `MemoryConfig.extraction.crossSessionSchedule` MUST 为 `0 0 0 * * ?`
- **AND** `MemoryConfig.aging.schedule` MUST 为 `0 0 0 * * ?`

#### Scenario: Child capability can be explicitly disabled
- **WHEN** 源配置设置 `nextAgent.memory.enabled=true`
- **AND** 源配置设置 `nextAgent.memory.extraction.enabled=false`
- **AND** 源配置设置 `nextAgent.memory.aging.enabled=false`
- **THEN** `MemoryConfig` MUST 为 `VALID`
- **AND** extraction 和 aging 的 effective enabled MUST 为 `false`
- **AND** search 和 memory core enabled 状态 MUST 不被子能力关闭影响

#### Scenario: Memory namespace coexists with existing system namespace
- **WHEN** 源配置包含 `nextAgent.memory.enabled=true` 但未包含 `nextAgent.system`
- **THEN** app config schema validation MUST accept the configuration if all defined memory fields are valid
- **AND** `MemoryConfig` MUST be derived from `nextAgent.memory`
- **AND** `userCapabilityProviders` MUST use its existing default/empty provider behavior
- **WHEN** 源配置只包含 `nextAgent.system.capability-providers` 且省略 `nextAgent.memory`
- **THEN** app config schema validation MUST accept the configuration
- **AND** `MemoryConfig` MUST use default-enabled memory values

#### Scenario: Memory sub-capability configuration remains nested
- **WHEN** merged memory changes define runtime fields for extraction or aging
- **THEN** source configuration MUST express them as `nextAgent.memory.extraction.*` and `nextAgent.memory.aging.*`
- **AND** app config schema validation MUST reject or mark inactive equivalent sibling groups such as `nextAgent.extraction.*` and `nextAgent.aging.*`
- **AND** `default-system.yaml` and application overlays MUST NOT split memory, extraction, and aging into three top-level runtime configuration blocks

#### Scenario: Invalid range fails validation
- **WHEN** `nextAgent.memory.search.default-limit=101`
- **THEN** 配置校验 MUST 失败
- **AND** 诊断 MUST 包含字段名 `nextAgent.memory.search.default-limit` 和约束 `[1, 100]`
- **AND** 系统 MUST NOT 将该字段改回默认值后继续报告配置成功

#### Scenario: Undefined consumer field is not silently accepted
- **WHEN** 源配置包含尚未被当前 OpenSpec 定义的 `nextAgent.memory.future.unreviewed-field`
- **THEN** 配置校验 MUST 失败或将该字段标记为明确不生效
- **AND** 任何 memory consumer MUST NOT 私自解释该字段
- **AND** 诊断 MUST 提示需要对应 memory change 定义该字段

### Requirement: Agent-level memory tool description overrides

系统 SHALL 基于 app composition 已验证的 Agent 装配事实和 capability Tool catalog 的 trusted 配置通道来支持 memory 工具的 Agent 级描述覆盖，不引入新的文件覆盖机制、目录约定或单独 description section。本 change 只定义 `capabilityBindings[].description` 工具描述覆盖；不得改变工具运行时校验、scope、capability 权限、memory core contract 或模型 provider 配置。Memory extraction 提示词选择不属于 memory configuration snapshot，MUST 由 shared prompt template registry / assembler 按 owning change 定义的 prompt purpose 消费。

**工具描述覆盖——`capabilityBindings[].description` 到 trusted `ToolCatalogConfig.safeDescriptionOverride`**：
- Agent definition MAY 在已绑定 memory capability 的 `capabilityBindings[]` 条目上设置 `description`，表达该 Agent 对该工具的模型可见描述覆盖。
- 该 Agent definition 的产品入口是已有 `agent.yaml` / Agent package definition；系统 MUST NOT 为 memory tool description 新增 `tools.yaml`、`memory-tools.yaml`、`memory.descriptionOverrides` 或独立 override 文件。
- `ToolCatalogConfig` 是 app composition 生成并传给 `agent-capability` 的内部 trusted 投影，MUST NOT 作为用户直接编辑的配置文件格式。
- app assembly MUST 校验 `description` 为 safe text；非字符串 description MUST 被拒绝或使 Agent assembly 无效。
- app composition MUST 只基于已验证、已绑定、已注册 memory capability 的 binding description 生成 trusted `ToolCatalogConfig.safeDescriptionOverride`，直接覆盖内置工具描述文字。
- 若 binding description 未设置，capability 使用内置描述。
- 描述覆盖长度遵循通用 Tool 描述上限（当前 builtin Tool catalog 为 512 字符，除非后续 framework change 统一调整）；超出时截断并记录诊断。
- 覆盖的描述不影响工具运行时输入校验、capability 权限、provider identity、input/output schema、scope、enabled/disabled 或执行语义。
- 请求体、模型输出、客户端 metadata、capability invocation 参数和 runtime state MUST NOT 覆盖 `capabilityBindings[].description`。

**提示词边界——不通过 configuration snapshot 绑定**：
- Configuration MUST NOT define, parse, freeze, or expose `promptTemplateIds`.
- Configuration MUST NOT interpret `memory-extraction-*` names, language suffixes, LLM strategy, or extraction prompt fallback.
- Memory extraction prompt selection MUST use the shared prompt template registry / assembler and the owning change's prompt purpose, not memory configuration fields.

**触发机制**：
1. Agent assembly 解析 `agent.yaml` 时校验已绑定 memory capability 的 `capabilityBindings[].description`。
2. App composition 从已验证 binding description 生成 memory capability 的 trusted Tool catalog description override 投影。
3. Capability catalog 生成 memory capability descriptor 时消费 trusted description override。
4. Prompt templates 由 existing prompt registry / assembler 在 owning change 的执行边界解析；configuration 不产生 prompt template resource projection。

**输入与前置条件**：
- Agent 装配上下文必须提供已解析的 `agent.yaml`。
- binding 中的 capability id 必须与已注册 memory capability descriptor 的名称匹配，且该 capability 已在当前 Agent 上绑定。

**输出与副作用**：
- capability descriptor 的模型可见描述为 binding description 投影后的 trusted override 值或内置默认值。
- 本 change 不输出 prompt template 引用、prompt template 内容或 extraction prompt 选择结果。
- 产生脱敏诊断（如 `description` 截断）。

**核心判断逻辑**：
1. 遍历已验证的 Agent capability bindings，对每个已绑定 memory capability 检查 `description`。
2. 若 binding description 存在，校验其类型、scope 和 capability 匹配关系，并按通用 Tool 描述上限处理；超出上限则截断并记录 `MEMORY_DESCRIPTION_TRUNCATED`。
3. app composition 将有效 binding description 投影为 trusted Tool catalog override。
4. capability catalog 使用 trusted override 值生成 CapabilityDescriptor；未覆盖的 capability 使用内置描述。
5. 不解析 prompt template ids，不执行 extraction-specific 前缀匹配。
6. 不产生 extraction prompt fallback、language unsupported 或 LLM strategy 诊断。

**状态 / 产物契约**：
- 工具描述覆盖值是 CapabilityDescriptor 的派生值，不是授权事实、执行参数或 memory record。
- prompt template 内容不得进入 memory configuration snapshot 或 memory record 生命周期；具体 extraction prompt 选择结果由 `add-ts-memory-extraction` 通过 shared prompt registry 定义。
- 诊断可追溯到 capabilityId，不得暴露完整模板内容。

**流程接入**：
- 上游是 Agent assembly（解析 `agent.yaml`）。
- 下游是 capability catalog（消费描述覆盖）。

#### Scenario: Built-in tool description used when binding description absent
- **WHEN** `search_memory` 的 `capabilityBindings[]` 条目未设置 `description`
- **THEN** CapabilityDescriptor MUST 使用内置描述
- **AND** 不产生任何诊断或错误

#### Scenario: Tool description overridden via capability binding
- **WHEN** `agent.yaml` 为 `search_memory` 的 `capabilityBindings[]` 条目设置 `description = "在当前用户的长期记忆中搜索知识条目"`
- **THEN** CapabilityDescriptor MUST 使用该值作为模型可见的工具描述
- **AND** 工具的运行时校验、scope 绑定和执行语义 MUST 保持不变

#### Scenario: Tool description truncated when too long
- **WHEN** `capabilityBindings[].description` 超过通用 Tool 描述上限
- **THEN** 系统 MUST 按通用 Tool 描述上限截断并记录 `MEMORY_DESCRIPTION_TRUNCATED` 诊断
- **AND** 工具注册 MUST 继续使用截断后的描述

#### Scenario: Binding description does not change authorization
- **WHEN** `agent.yaml` 的 `capabilityBindings` 中同时设置 `providerId`、`capabilityType` 和 `description`
- **THEN** `description` MUST NOT change provider selection, capability enablement, permissions, input/output schema, owner scope, agent scope, or invocation arguments
- **AND** only CapabilityDescriptor.description MAY change through the trusted Tool catalog projection

#### Scenario: No separate tool description file
- **WHEN** a product customizes the model-visible description for `search_memory`
- **THEN** the customization MUST be represented on the bound `agent.yaml` / Agent definition `capabilityBindings[]` entry
- **AND** app composition MUST project it to trusted `ToolCatalogConfig.safeDescriptionOverride`
- **AND** the system MUST NOT require or load a separate memory-tool description file for this purpose

#### Scenario: Prompt template ids are not accepted as memory configuration
- **WHEN** source configuration or Agent definition attempts to use `promptTemplateIds` as memory configuration input
- **THEN** memory configuration MUST NOT copy that value into `MemoryConfig`
- **AND** this change MUST NOT decide extraction prompt fallback, supported languages, or LLM strategy
- **AND** this change MUST NOT emit extraction-specific unsupported-language diagnostics

### Requirement: Configuration failure and degradation semantics

系统 SHALL 对 memory 配置失败、trusted override 失败、资源引用失败、依赖缺失和预算超限给出明确结果。配置相关失败不得静默截断、静默丢弃或静默吞错。

**失败与降级规则**：
1. 源配置读取失败：配置状态 `INVALID`，错误码 `MEMORY_CONFIG_SOURCE_UNAVAILABLE`。
2. schema 校验失败：配置状态 `INVALID`，错误码 `MEMORY_CONFIG_INVALID`。
3. 非法 owner 字段：配置状态 `INVALID`，错误码 `MEMORY_CONFIG_OWNER_OVERRIDE_FORBIDDEN`。
4. 未定义 memory 配置字段：配置状态 `INVALID` 或明确不生效诊断，错误码 `MEMORY_CONFIG_FIELD_UNDEFINED`。
5. binding 工具描述 `description` 未设置：使用内置描述，不是失败。
6. binding 工具描述 `description` 非字符串：Agent assembly 校验失败或该 Agent configuration 标记为无效。
7. binding 工具描述 `description` 超长：按通用 Tool 描述上限截断并记录 `MEMORY_DESCRIPTION_TRUNCATED`，工具仍然可用。
8. extraction prompt 未在本 change 中解释；fallback 和 unsupported language 诊断由 memory extraction 定义。
9. memory disabled：`nextAgent.memory.enabled=false` 时，配置状态 `DISABLED`，app-composed selected memory port / core consumer boundary 按 `LTM_DISABLED` 行为处理。
10. memory default enabled：`nextAgent.memory.enabled` 缺失且其他 memory 配置合法时，配置状态 `VALID`，health 或配置诊断 MUST 能显示 memory enabled 来自默认值。

**输出与副作用**：
- 所有失败和降级必须产生 safe diagnostic。
- 配置失败不得创建 request terminal event、stream event、memory record 或 capability invocation。
- 覆盖资源拒绝只影响该资源的可用性，不得改变 request lifecycle。

#### Scenario: Source configuration unavailable
- **WHEN** 应用启动时 memory 源配置无法读取
- **THEN** 系统 MUST 产生 `MEMORY_CONFIG_SOURCE_UNAVAILABLE`
- **AND** memory configuration 状态 MUST 为 `INVALID`
- **AND** 应用 MUST NOT 以 memory-enabled 状态对外 ready

#### Scenario: Description exceeding limit is truncated
- **WHEN** 某 memory capability 的 `capabilityBindings[].description` 超过通用 Tool 描述上限
- **THEN** 系统 MUST 按通用 Tool 描述上限截断
- **AND** 诊断 MUST 包含 `MEMORY_DESCRIPTION_TRUNCATED` 和对应 `capabilityId`
- **AND** 工具 MUST 继续注册使用截断后的描述

#### Scenario: Explicit disabled memory is observable
- **WHEN** `nextAgent.memory.enabled=false`
- **THEN** memory configuration 状态 MUST 为 `DISABLED`
- **AND** health 或配置诊断 MUST 能显示 memory disabled 来自显式配置
- **AND** memory 调用失败 MUST 使用 stable disabled outcome，不得表现为存储不可用或空成功

#### Scenario: Default enabled memory is observable
- **WHEN** `nextAgent.memory.enabled` 缺失且 memory 配置合法
- **THEN** memory configuration 状态 MUST 为 `VALID`
- **AND** health 或配置诊断 MUST 能显示 memory enabled 来自默认值
- **AND** memory consumers MUST NOT 将默认 enabled 诊断报告为 `MEMORY_CONFIG_DISABLED_DEFAULT`

### Requirement: Configuration observability and redaction

系统 SHALL 为 memory configuration 提供可诊断且脱敏的 observability 结果。配置诊断、日志、metric、audit 或 SafeError 不得包含 prompt、模型输出、stream delta、raw provider error、credential、token、附件内容、完整工具 schema、prompt/template 内容、未脱敏本地路径或高基数字段。

**触发机制**：
- 配置加载完成、配置校验失败、memory disabled、覆盖资源命中、覆盖资源拒绝和配置消费者发现不可用时触发诊断。
- 诊断由配置/observability 边界产生，不进入用户请求流。

**输出与副作用**：
- metric 至少按配置状态、资源覆盖状态、拒绝原因和 consumer kind 聚合计数。
- structured log 必须包含 stable event name、config area、safe reason code 和 bounded field names。
- audit 只在配置变化进入受审计部署流程时记录；本 change 不要求为每次启动写用户审计事件。

#### Scenario: Valid configuration emits safe diagnostic
- **WHEN** memory configuration 成功冻结
- **THEN** 系统 MUST 记录配置状态、enabled/disabled 状态和资源覆盖计数
- **AND** 日志和 metric MUST NOT 包含完整 tool schema 或 prompt/template 内容

#### Scenario: Rejected override is redacted
- **WHEN** capability trusted override 或 parsed resource ref 因格式非法被拒绝
- **THEN** 诊断 MUST 包含 resource kind、capability name、agent ref 和 reason code
- **AND** 诊断 MUST NOT 包含 prompt/template 内容、未脱敏绝对路径、secret、token 或 raw config JSON 原文

### Requirement: Configuration architecture boundaries

系统 SHALL 保持 memory configuration 与架构和核心契约一致。配置只能作为 app composition 冻结后的运行时输入被消费，不得创建第二套 memory behavior、request lifecycle、capability governance、gateway schema、owner scope 或 context assembly 入口。

**核心判断逻辑**：
1. `agent-app` 或等价 app composition 边界负责源配置加载、校验和快照冻结。
2. `MemoryConfig` 是 app composition 冻结后提供给下游的窄消费投影或 owning-boundary contract；本 change 不把完整 `DefaultSystemConfig` 暴露为跨包 public contract，也不新增竞争性的 catch-all configuration subpath。
3. app-composed selected memory ports / core consumer boundaries、后续 `agent-memory` 编排和显式 memory consumers 消费 memory behavior 参数，但不重新解析源配置。
4. `agent-capability` 通过 trusted Tool catalog config 消费由 binding description 投影出的描述覆盖结果，但不允许覆盖改变 capability 权限、provider identity、input/output schema 或运行时校验。
5. `agent-context-engine` 不因 memory configuration 自动注入长期记忆。
6. `agent-runtime` 不因 memory configuration 创建后台 job 或改变 terminal commit。
7. Platform gateway adapter 不因 memory configuration 暴露具体存储 driver、索引或表结构。

#### Scenario: Consumers do not parse source configuration
- **WHEN** app-composed selected memory ports / core consumer boundaries 或后续显式接入的 memory consumers 需要配置值
- **THEN** 它们 MUST 读取冻结后的 `MemoryConfig` 或 app composition 派生的窄投影
- **AND** 不得直接读取 env、配置文件、Agent package 原始文件或 app-private 配置对象

#### Scenario: Context assembly is unchanged
- **WHEN** memory configuration 启用长期记忆
- **THEN** context assembly MUST NOT 自动注入全部长期记忆
- **AND** 长期记忆检索、披露和预算仍由对应 memory/context 规格定义

#### Scenario: Runtime lifecycle is unchanged
- **WHEN** memory configuration 为后续 consumer 提供合法配置快照
- **THEN** 本配置 change 只提供配置快照和资源解析结果
- **AND** runtime MUST NOT 因本配置 change 改变 request terminal commit、cancel、retry、edit、后台 job 或 stream projection 语义

### Requirement: Memory scheduler cron configuration is validated before readiness

Memory scheduler configuration SHALL accept only the supported six-field cron subset: exactly six whitespace-separated fields, where each field is `*`, `?`, or one decimal integer within the field range; the day-of-week field also accepts `7` as Sunday. The seconds field MUST be `0` because memory schedulers operate on minute windows. Unsupported expressions, lists, ranges, steps, names, invalid field counts and out-of-range values MUST make memory configuration `INVALID` before application readiness.

#### Scenario: Supported memory cron is accepted
- **WHEN** memory aging schedule is `0 0 3 * * ?`
- **AND** memory extraction schedule is `0 0 2 * * ?`
- **THEN** memory configuration validation MUST accept both schedules

#### Scenario: Unsupported memory cron fails fast
- **WHEN** a memory schedule is `*/5 * * * * ?`, `0 0 3 * * MON-FRI`, or has any field outside its numeric range
- **THEN** memory configuration status MUST be `INVALID`
- **AND** no memory background scheduler may start
