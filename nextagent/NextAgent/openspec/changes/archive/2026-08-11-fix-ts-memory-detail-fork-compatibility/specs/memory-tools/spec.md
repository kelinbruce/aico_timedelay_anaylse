## Function

- **所属 Function**：`FN-8.2 检索和写入记忆`
- **Function 变更类型**：`MODIFIED`
- **spec 角色**：主规格

## MODIFIED Requirements

### Requirement: get_memory_detail L2 retrieval

`get_memory_detail` SHALL 按 `longTermMemoryIds[]` 批量获取当前 owner scope 下的 L2 长期记忆详情，单次最多 20 条。不存在、不属于当前 owner 或不可披露时 MUST 在对应 result 中返回同一个 not-found SafeError，防止对象存在性泄露；单条失败不得中断其他条目。

**触发机制**：模型基于 `search_memory` 返回的 L1 候选，判断需要完整结构化内容时显式调用；同步等待结果。

**Default tool description**：除非 Agent definition 通过 `capabilityBindings[].description` 提供可信覆盖，内置 `CapabilityDescriptor.description` MUST 使用以下默认文案：

> Fetch full L2 details for long-term memory entries returned by search_memory when their briefIndex suggests relevant details are needed. Pass up to 20 longTermMemoryIds. Returns per-entry results with full structured fields such as procedural steps, pitfalls, verification criteria, or conceptual definitions.

**Tool description semantic guidance**：默认英文文案是完整的内置模型可见描述；以下条目是描述必须覆盖的语义约束，不要求逐字拼接到默认 description 中。若 Agent definition 通过 `capabilityBindings[].description` 覆盖描述，覆盖后的模型可见描述 MUST 仍覆盖这些语义——
- "Call this after search_memory when entries' briefIndex suggests they have relevant details you need."
- "Pass up to 20 longTermMemoryIds when multiple search results need full content."
- "L2 content includes full structured fields (steps, pitfalls, verification criteria for PROCEDURAL; full definitions for CONCEPTUAL; etc.)."

**输入与前置条件**：
- 输入字段：`longTermMemoryIds[]`。
- `longTermMemoryIds` MUST 非空，且数量 MUST 不超过 20。
- 每个 `longTermMemoryId` MUST 通过 owner-scoped lookup 验证可见性，并把 not found、not owned 和不可披露统一映射为 per-entry `LTM_ENTRY_NOT_FOUND`。
- 当前 capability invocation 仍受公共单个 Capability 结果容量约束。

**输出与副作用**：
- 成功结果 MUST 包含 `{results: [{longTermMemoryId, entry?, error?}]}` 结构。
- 成功 `entry.content` MUST 包含该 `category` 的完整结构化业务内容；“完整”只约束 category-specific 业务内容，不表示完整 retained record 或内部来源。
- 成功 `entry` 的顶层 output schema 和实际结果 MUST NOT 包含 `sourceTrace` 或原始 `source`；系统 MUST NOT 将 session、request、run、message 或 extraction cycle 的来源坐标作为 `entry` 顶层 provenance 字段的替代表示。
- 当 retained source 可解析时，系统 MUST 在 `CapabilityInvocationResult.metadata.sourceTrace` 中保留由 `longTermMemoryId` 关联的来源，供本地 canonical `toolOutput` 诊断使用；该 metadata MUST NOT 属于 output schema、`structuredPayload`、模型可见 Tool 结果或持久化 `CAPABILITY_RESULT`。
- `metadata.sourceTrace` 的体积 MUST 与 `structuredPayload` 一并计入规范化 `CapabilityInvocationResult` 的公共单结果容量；不得通过把来源移入 metadata 绕过该容量约束。
- `entry` 顶层 output schema MUST 继续拒绝未声明字段；违反该 schema 的结果 MUST 按既有 Capability 输出校验语义失败，不得把未声明字段交给后续模型轮次。
- L2 result 可被后续模型轮次消费；不得被直接写入 system prompt。
- 访问计数和 `lastAccessedAt` 副作用由 memory core 负责。

**核心判断逻辑**：
1. 校验 `longTermMemoryIds` 非空且不超过 20。
2. 对每个 `longTermMemoryId` 使用可信 scope 通过 `retriever.getLongTermMemoryDetail` 执行 getDetail 语义。
3. 如果单条返回 not found/not owned，映射为该 result 的 `LTM_ENTRY_NOT_FOUND`。
4. 对成功详情只在 `structuredPayload` 投影声明的模型可见业务字段，排除 retained source 和内部来源坐标；当 retained source 可解析时，同时 MUST 在模型隐藏的 `metadata.sourceTrace` 中按 `longTermMemoryId` 保留 retained source 供本地诊断关联。
5. 对业务 payload 与诊断 metadata 应用同一个公共 Capability 结果容量；如果规范化结果超过该容量，系统 MUST 返回 `CAPABILITY_RESULT_LIMIT_EXCEEDED`，不得返回 `MEMORY_TOOL_RESULT_TOO_LARGE`，也不得静默截断或仅截断来源。

**需求类别**：功能性需求

#### Scenario: 正常读取完整业务详情
- **WHEN** 模型调用 `get_memory_detail(longTermMemoryIds=[E1])`
- **AND** `E1` 属于当前 scope
- **THEN** 工具 MUST 返回包含 `entry` 的 result
- **AND** `entry.content` MUST 包含 `E1` 的 category-specific 完整结构化业务内容

#### Scenario: 详情结果排除内部来源
- **WHEN** 当前 scope 下的 `E1` retained record 含有内部来源
- **AND** 模型调用 `get_memory_detail(longTermMemoryIds=[E1])`
- **THEN** 成功 `entry` 的顶层 output schema 和实际结果 MUST NOT 包含 `sourceTrace` 或原始 `source`
- **AND** 成功 `entry` MUST NOT 以其他顶层 provenance 字段返回该内部来源的 session、request、run、message 或 extraction cycle 坐标

#### Scenario: 本地诊断保留可关联来源
- **WHEN** 当前 scope 下的 `E1` retained record 含有可解析的内部来源
- **AND** `get_memory_detail(longTermMemoryIds=[E1])` 成功
- **THEN** 系统 MUST 在 `CapabilityInvocationResult.metadata.sourceTrace` 中记录 `E1` 的 `longTermMemoryId` 与 retained source
- **AND** 本地 canonical `toolOutput` MUST 在既有容量和 credential 脱敏约束内保留该 metadata
- **AND** 模型输入、durable `CAPABILITY_RESULT`、Web/stream/timeline、SafeError、audit、metric、trace 和 `ObservabilityObservationEvent` MUST NOT 获得该 metadata

#### Scenario: 诊断来源受公共结果容量约束
- **WHEN** `get_memory_detail` 的规范化 `CapabilityInvocationResult` 因业务 payload 与 `metadata.sourceTrace` 合计超过公共单结果容量
- **THEN** 系统 MUST 返回 `CAPABILITY_RESULT_LIMIT_EXCEEDED`
- **AND** 系统 MUST NOT 返回 `MEMORY_TOOL_RESULT_TOO_LARGE`
- **AND** 系统 MUST NOT 通过省略、截断或拆分来源把超限结果伪装成成功

#### Scenario: 详情不存在或不属于当前 owner
- **WHEN** 模型调用 `get_memory_detail(longTermMemoryIds=[E1,E9])`
- **AND** `E9` 不存在或不属于当前 owner scope
- **THEN** 工具 MUST 为 `E9` 返回 per-entry `SafeError { code: "LTM_ENTRY_NOT_FOUND" }`
- **AND** 响应 MUST NOT 区分不存在和无权限

#### Scenario: 未声明顶层字段被拒绝
- **WHEN** `get_memory_detail` 的成功 `entry` 包含 output schema 未声明的顶层字段
- **THEN** 系统 MUST 按既有 Capability 输出校验语义拒绝该结果
- **AND** 后续模型轮次 MUST NOT 收到该未声明字段

## Function 变更汇总

### 输出

- **变更类型**：修改
- **目标内容**：模型显式读取长期记忆详情时获得完整的 category-specific 结构化业务内容和既有业务状态，但不获得 retained source 或内部执行来源坐标；本地 canonical `toolOutput` 仍可通过模型隐藏的 Capability metadata 一步定位来源；检索结果、逐条未命中和写入确认的其他输出边界保持不变。
- **依据 Requirements**：`get_memory_detail L2 retrieval`
