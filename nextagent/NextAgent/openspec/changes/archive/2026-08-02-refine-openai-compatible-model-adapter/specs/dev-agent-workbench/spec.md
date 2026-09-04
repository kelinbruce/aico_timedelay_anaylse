## Function

- **所属 Function**：`FN-10.11 开发工作台`
- **Function 变更类型**：`MODIFIED`
- **spec 角色**：主规格

## MODIFIED Requirements

### Requirement: Run-bound model invocations use one runtime timeline boundary

属于 `RequestRun` 的每次模型调用 SHALL 经过唯一 run-bound 模型调用边界。该边界 SHALL 调用模型契约拥有的 provider-neutral `ModelInvocationService`，并 SHALL 通过 runtime-owned timeline port 发布 canonical `MODEL_INVOCATION_STARTED` 以及 `MODEL_INVOCATION_COMPLETED` 或 `MODEL_INVOCATION_FAILED`。`agent-core`、workflow、context summary 和其他 run-bound caller MUST NOT 分别重复该事件 lifecycle。`agent-model` SHALL 归一化 provider request/result/error，但 MUST NOT 依赖或写入 runtime timeline。`RequestRun` 外的模型调用 MUST NOT 伪造 run timeline event。

**需求类别**：功能性需求

#### Scenario: run 内的 workflow 或 context summary 调用模型
- **WHEN** 任一 run-bound caller 通过已装配边界调用模型
- **THEN** 每次模型 attempt MUST 恰好记录一个 started event 和一个 completed-or-failed event
- **AND** event coordinates MUST 来自可信 runtime run/context
- **AND** local 与 production composition MUST 应用相同事件规则

#### Scenario: 模型调用没有 RequestRun
- **WHEN** provider-neutral model service 在 `RequestRun` lifecycle 外被调用
- **THEN** `agent-model` MUST NOT 伪造 session、request、run、context 或 timeline coordinates
- **AND** 该调用 MUST NOT 写入 canonical run timeline event

safe projection payload MUST NOT 包含 raw prompt、raw model output、raw tool args/result、provider raw body、credential、secret、token、attachment content、local path 或其他 production observability 禁止内容。safe projection payload SHOULD 优先使用 stable refs、ids、reason codes、counts、usage、selected refs、template refs、capability ids、canonical model ids、tool names、redacted summaries 和 bounded safe diagnostics。generic status、timing、coordinates 和 graph edges SHOULD 从既有 records/events 读取或计算。

safe projection payload schema MUST 由 producing fact 的 owning package 拥有，并且只通过该 owner 的 public surface 导出。v1 MUST NOT 向 `agent-contracts/runtime` 增加 shared timeline payload schema 或 dev DTO，也 MUST NOT 在没有真实业务 producer 时增加 capability gateway summary public contract。producer-side schema validation MUST 是 best-effort：validation、serialization、size-limit 或 projection failure MUST 丢弃 optional payload 或把它标记为 unavailable，并且 MUST NOT 使底层 runtime action 失败。

允许补充的投影信息限定为下列最小集合，且只有在字段来源映射证明现有 facts 不足时才补：

- request/planning：`agentAssemblyHash` 或 `agentAssemblySnapshotRef` 仅在 `agentAssemblyRef` 不能历史稳定解析时补；`laneKind`、`queueDepthBucket`、`schedulerDecisionCode` 仅在 scheduler owner 已有该决策且无法查询时补。
- model invocation start：`stepId`、`modelId`、`promptTemplateRef`、`promptTemplateVersion`、`selectedMessageRefs`、`disclosedCapabilityIds`、`modelMessageCount`、`modelOptionSummary`、`providerOptionKeys`。`stepId` MUST 是 run-bound `ModelInvocationScope.operationId` 的原值投影，`modelId` MUST 是同一次 canonical invocation request 的模型 identity；canonical timeline、history 和 workbench projection MUST NOT 暴露 `modelProfileId`、`providerKind` 或 `modelName`。其中 disclosure ids 和 message count MUST 从最终 `ModelInvocationRequest` 计算；budget/compression/degradation 继续由对应 context lifecycle event 表达，并携带同一 `stepId`，不得复制到模型事件。
- model completion/failure：`finishReason`、`usage`、`toolCallCount`、`safeErrorCode`、`safeErrorCategory`；`outputSizeBucket` 只有无法从 persisted message 计算且 owner 已有安全值时才补。
- capability start/completion：保留既有 lifecycle fields；`CAPABILITY_STARTED` 仅补 `stepId`，多调用批次补实际 `toolBatchExecutionMode`、`toolBatchOrdinal`、`toolBatchSize`。descriptor、参数和结果详情 MUST 从 exact run-bound catalog/assembly 与 persisted tool-use/result messages 派生，不得重复写入 timeline。
- policy：`policyId`、`policyVersion`、`policyDomain`、`policyPoint`，现有 operation/outcome/reason/risk fields 不得重复。
- context compaction：`strategyCode`、token estimate buckets、`retainedMessageCount`、`droppedMessageCount`、`summaryMessageId`、`reasonCode`，前提是不能从 compaction commit/message facts 读取。
- gateway：v1 不新增 generic gateway event 或 speculative capability gateway summary public contract。缺失正式业务事实时 MUST 标记 partial/unavailable；log 只能作为 evidence，不能构建 graph truth。

#### Scenario: gateway detail 没有正式业务事实
- **WHEN** 工作台不能从既有正式业务事实取得 gateway detail
- **THEN** gateway coverage MUST 标记为 partial 或 unavailable
- **AND** 工作台 MUST NOT 增加 capability payload contract 或解析 structured log text 来发现 gateway nodes

#### Scenario: 实现补充缺失的安全投影字段
- **WHEN** process graph 或 action detail 需要现有 facts 没有的调测信息
- **THEN** 实现 MUST 先证明该字段不能从已有 facts 读取或计算
- **AND** 新增信息 MUST 由该事实的 owner package 产生和命名
- **AND** 新增信息 MUST 通过 schema validation
- **AND** 新增信息 MUST NOT 包含 raw prompt、raw model output、raw tool args/result、credential、secret、token、attachment content 或 path

#### Scenario: 字段可从既有事实计算
- **WHEN** graph node timing、status、refs、edge 顺序、agent/run/session/request 坐标或 terminal outcome 能从已有 record、event 顶层字段或事件对计算
- **THEN** 系统 MUST 在 workbench projection 中计算该字段
- **AND** 系统 MUST NOT 为该字段新增 safe projection payload、durable record 字段或 workbench 私有事实

#### Scenario: raw detail 不可用
- **WHEN** 某动作只有 safe projection，没有 raw input/output
- **THEN** 工作台 MUST 显示 safe projection detail 和 `rawUnavailable` 或等价状态
- **AND** 系统 MUST NOT 通过 app-level decorator、系统 hook、日志解析或业务事实回写来补齐 raw

#### Scenario: 模型时间线使用 canonical identity
- **WHEN** 工作台重建任一 `MODEL_INVOCATION_*` event
- **THEN** process graph、event label、action detail、effective view 和 browser projection MUST 使用相同 `stepId/modelId`
- **AND** 没有 run-bound timeline event 的 background recommendation MUST NOT 显示为工作台 model action

### Requirement: Workbench exposes a reconstructed run effective view

Agent Dev Workbench SHALL 在 supporting facts 可用时为每个 request/run 暴露 reconstructed effective view。该视图 SHALL 描述形成该 run 的配置和输入，包括 Agent identity/version/assembly reference、Agent assembly summary refs、canonical model selection、prompt template ref、context selection/budget/compression evidence、capability binding/disclosure summary、rendered model tool names/count 和 final model invocation safe parameters。runtime settings summary 和 workspace policy summary 是 optional v1 details，只在可从 stable assembly refs 历史解析时显示。

effective view MUST 从 trusted app composition、accepted request/run facts、persisted session/request facts、context safe projection payload、capability catalog/disclosure safe projection payload、model invocation safe projection payload 和 stable refs 派生。runtime settings summary 和 workspace policy summary SHALL 在 `agentAssemblyRef` 可历史解析时从该 ref 派生；否则 MUST 标记为 `partial`、`current-view` 或 `unavailable`，并且 MUST NOT 成为 first-wave workbench payload fields。存在 run-specific facts 时，effective view MUST NOT 从 client request body values、model output、raw logs、log text 或 mutable current defaults 重建。

当 local assembly registry 能解析 run 的 exact `agentId`、`agentVersion` 和 `agentAssemblyRef` 时，effective view SHALL 暴露完整 compiled `AgentAssembly` configuration，包括 identity metadata、canonical `modelIds` 与 optional `defaultModelId`、capability bindings、runtime settings、workspace policy、routing、hooks 和 policies。工作台 MUST 要求三个 coordinates 全部匹配。assembly 缺失或 assembly ref 不匹配 MUST 报告为 unavailable，并且 MUST NOT 回退到 active 或 current Agent configuration。credential values 和 provider-resolved secrets 不属于 `AgentAssembly`，MUST NOT 加入该视图。

对于缺少充分 run-specific facts 的历史 run，工作台 MAY 显示 best-effort reconstructed 或 current-registry view，但 MUST 明确标记为 `reconstructed`、`current-view`、`partial`、`unavailable` 或等价 non-authoritative status。

**需求类别**：功能性需求

#### Scenario: run 从安全事实暴露 effective view
- **WHEN** 开发者查看已完成 request/run 且相关 safe projection payload 存在
- **THEN** 开发者 MUST 能查看该 run 的 Agent identity/version/assembly reference、assembly summary refs、canonical `modelId` selection、prompt template ref、context selection evidence、visible capability ids、rendered model tool names/count 和 final model invocation safe parameters
- **AND** runtime settings summary 和 workspace policy summary MUST 只在可从 historically stable assembly refs 派生时显示，否则 MUST 标记为 partial/current-view/unavailable
- **AND** 这些信息 MUST 关联到 process graph 中的 effective-state 节点或对应 `context`/`model` 节点详情

#### Scenario: 历史 run 只有部分 effective view
- **WHEN** 开发者查看缺少 run-specific projection payload 的历史 run
- **THEN** 工作台 MAY 根据已有持久化事实和当前 registry 展示 best-effort 配置视图
- **AND** 该视图 MUST 标记为非历史权威或 partial
- **AND** 系统 MUST NOT 将当前配置伪装为该历史 run 当时实际生效的配置

#### Scenario: run 暴露 exact Agent assembly configuration
- **WHEN** local assembly registry 能解析 run 的 `agentId` 和 `agentVersion`
- **AND** resolved assembly ref 恰好等于 persisted `agentAssemblyRef`
- **THEN** 生效视图 MUST 展示该 compiled `AgentAssembly` 的完整非密钥配置
- **AND** capability bindings MUST 可用于分类 bound Tool、Skill 和 Agent capabilities
- **AND** assembly 不存在或 ref 不匹配时 MUST 显示配置不可用，且不得回退到 active/current Agent 配置

## Function 变更汇总

### 输入

- **变更类型**：修改
- **目标内容**：工作台读取 canonical run-bound timeline 与 Agent assembly 中的 `stepId/modelId/modelIds/defaultModelId`。
- **依据 Requirements**：`Run-bound model invocations use one runtime timeline boundary`、`Workbench exposes a reconstructed run effective view`

### 处理过程

- **变更类型**：修改
- **目标内容**：工作台过程图、事件标签、详情与 effective view 使用 canonical model identity，并且只从正式 run-bound facts 建立模型动作。
- **依据 Requirements**：`Run-bound model invocations use one runtime timeline boundary`、`Workbench exposes a reconstructed run effective view`

### 结果

- **变更类型**：修改
- **目标内容**：开发者看到与 runtime timeline 一致的 `stepId/modelId`；background recommendation 不进入 run-bound workbench projection。
- **依据 Requirements**：`Run-bound model invocations use one runtime timeline boundary`
