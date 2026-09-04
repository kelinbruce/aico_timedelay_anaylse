## Function

- **所属 Function**：`FN-10.3 自定义路由策略`
- **Function 变更类型**：`MODIFIED`
- **spec 角色**：主规格

## ADDED Requirements

### Requirement: agent-router-plugin按配置限制目标类型

`agent-router-plugin` 的 Agent policy config MUST 接受 optional `selectionMode`，允许值 MUST 恰好为 `SKILL`、`WORKFLOW`、`SKILL_OR_WORKFLOW`，省略时 MUST 默认为 `SKILL_OR_WORKFLOW`。系统 MUST 在 capability 可用性治理与可选 RAG 预筛之前应用该配置：`SKILL` MUST 排除全部 `WORKFLOW` bindings，`WORKFLOW` MUST 排除全部 `SKILL` bindings，`SKILL_OR_WORKFLOW` MUST 保留两类 enabled bindings。客户端字段、accepted user input、模型输出、Capability 参数或 RAG 结果 MUST NOT 改写 `selectionMode`。

**需求类别**：功能性需求

#### Scenario: 只选择Skill

- **GIVEN** Agent policy config 声明 `selectionMode=SKILL`
- **WHEN** 当前 Agent 同时存在可用的 enabled Skill 与 Workflow bindings
- **THEN** 路由候选 MUST 只包含 Skill
- **AND** 模型与 RAG 预筛 MUST NOT 收到 Workflow 候选

#### Scenario: 只选择Workflow

- **GIVEN** Agent policy config 声明 `selectionMode=WORKFLOW`
- **WHEN** 当前 Agent 同时存在可用的 enabled Skill 与 Workflow bindings
- **THEN** 路由候选 MUST 只包含 Workflow
- **AND** 模型与 RAG 预筛 MUST NOT 收到 Skill 候选

#### Scenario: 未配置时保留两类候选

- **GIVEN** Agent policy config 省略 `selectionMode`
- **WHEN** 当前 Agent 同时存在可用的 enabled Skill 与 Workflow bindings
- **THEN** 系统 MUST 按 `SKILL_OR_WORKFLOW` 处理
- **AND** 两类 bindings MUST 继续接受相同的 scope、availability 与候选成员校验

### Requirement: agent-router-plugin仅选择当前Agent绑定的可用能力

当 accepted Agent 激活 `agent-router-plugin` 且显式路由解析未产生决策时，系统 MUST 只从该请求 frozen `AgentAssembly.capabilityBindings` 中 `enabled=true`、`capabilityType` 为 `SKILL` 或 `WORKFLOW`，并且在当前 Agent Scope、Owner Scope 与会话作用域下仍可解析为同类型可用 capability 的条目构造路由候选。系统 MUST NOT 把 disabled binding、其它 capability 类型、其它 Agent 的 binding、default-visible 但未显式绑定的 capability、全局 catalog 条目、客户端字段、模型自报目标或插件配置目标加入候选。

模型路由结果 MUST 恰好为以下三类之一：选中候选中的一个 `SKILL`、选中候选中的一个 `WORKFLOW`、no-match。选中 `SKILL` 时，系统 MUST 产出 `DETERMINISTIC_FLOW` 与匹配候选名称的 `skillName`；选中 `WORKFLOW` 时，系统 MUST 产出 `DETERMINISTIC_FLOW` 与匹配候选名称的 `recipeName`；no-match 或候选集合为空时，系统 MUST 产出 `MODEL_DRIVEN_LOOP`。系统 MUST NOT 同时产出 `skillName` 与 `recipeName`，也 MUST NOT 用同名但类型不同的 capability 替换模型选择。

**需求类别**：功能性需求

#### Scenario: 当前Agent绑定的Skill被选择

- **WHEN** accepted Agent 激活 `agent-router-plugin`
- **AND** 当前 Agent 有一个 enabled `SKILL` binding，且该 Skill 在当前 Agent Scope、Owner Scope 与会话作用域下可用
- **AND** 当前模型返回该 Skill 的精确名称和 `SKILL` 类型
- **THEN** 路由结果 MUST 为 `DETERMINISTIC_FLOW`
- **AND** `skillName` MUST 等于该 binding 的 capability id
- **AND** 系统 MUST 继续进入既有受治理 Skill 定向加载路径

#### Scenario: 当前Agent绑定的Workflow被选择

- **WHEN** accepted Agent 激活 `agent-router-plugin`
- **AND** 当前 Agent 有一个 enabled `WORKFLOW` binding，且该 Workflow 在当前 Agent Scope、Owner Scope 与会话作用域下可用
- **AND** 当前模型返回该 Workflow 的精确名称和 `WORKFLOW` 类型
- **THEN** 路由结果 MUST 为 `DETERMINISTIC_FLOW`
- **AND** `recipeName` MUST 等于该 binding 的 capability id
- **AND** 系统 MUST 继续进入既有受治理 workflow 路由路径

#### Scenario: 未绑定能力不进入候选

- **WHEN** 当前请求的治理后 catalog 中存在一个可用 Skill 或 Workflow
- **AND** accepted Agent 没有该 capability 的 enabled 显式 binding
- **THEN** `agent-router-plugin` 的模型路由输入 MUST NOT 包含该 capability
- **AND** 模型即使返回其名称，系统也 MUST NOT 采用该目标

#### Scenario: 候选为空或没有匹配目标

- **WHEN** 当前 Agent 没有同时满足 binding 与治理可用性条件的 Skill 或 Workflow，或当前模型返回 no-match
- **THEN** 路由结果 MUST 为 `MODEL_DRIVEN_LOOP`
- **AND** 系统 MUST NOT 发起 Skill 或 Workflow capability 调用

### Requirement: agent-router-plugin可通过受治理RAG Tool预筛候选

`agent-router-plugin` 的 Agent policy config MAY 包含 optional `ragPrefilter`。配置存在时，`ragPrefilter` MUST 只接受 optional `indexes` 与 optional `topK`：`indexes` 存在时 MUST 为 1–5 个符合既有 RAG logical index 约束的名称，省略时 MUST 使用 builtin `Rag` 的 trusted default indexes；`topK` 存在时 MUST 为 1–10 的整数，省略时 MUST 默认为 5。配置缺失时，系统 MUST 跳过 RAG 预筛并把全部受控候选交给最终模型选择。

启用 `ragPrefilter` 后，系统 MUST 先应用 `selectionMode`、Agent binding 与 capability 可用性治理。受控候选数小于或等于 effective `topK` 时，系统 MUST 跳过 RAG 调用并把全部受控候选交给最终模型选择；受控候选数大于 effective `topK` 时，系统 MUST 通过当前 Agent enabled binding 下可用的 builtin `Rag` 执行恰好一次受治理 logical invocation，并 MUST 为该 invocation 设置 `maxRetries=0`。RAG query MUST 使用 accepted user input trim 后的前 256 个 Unicode code points；完整 accepted user input MUST 继续提供给最终模型选择。

用于预筛的 RAG 结果 MUST 通过 `source` 精确标识候选，格式 MUST 为 `capability/SKILL/<capabilityId>` 或 `capability/WORKFLOW/<capabilityId>`。系统 MUST 按 RAG result 顺序去重，并只保留 kind 与 capability id 同时匹配原受控候选集合的前 `topK` 个结果；其它 source、未绑定目标、不可用目标、类型不匹配目标与重复目标 MUST 被忽略，MUST NOT 扩大候选权限。RAG 完整成功但零命中，或结果过滤后没有合法候选时，系统 MUST 返回 no-match；RAG 返回包含至少一个合法候选的受治理部分结果时，系统 MUST 使用这些合法候选继续最终模型选择；RAG 调用失败、取消、超时、无可用 chunk 的 degraded/failure 或 `Rag` 未绑定/不可用时，系统 MUST 进入既有安全 plugin failure boundary。

**需求类别**：功能性需求

#### Scenario: 未配置ragPrefilter时跳过RAG

- **GIVEN** Agent policy config 未声明 `ragPrefilter`
- **WHEN** router 完成 `selectionMode`、binding 与 capability 可用性治理
- **THEN** 系统 MUST NOT 调用 builtin `Rag`
- **AND** MUST 把全部治理后候选交给最终模型

#### Scenario: 从N个候选预筛到配置上限

- **GIVEN** `ragPrefilter.topK=5`
- **AND** `selectionMode`、binding 与 capability 可用性治理后存在多于 5 个候选
- **WHEN** builtin `Rag` 返回按 relevance 排序且 source 可映射到原候选的结果
- **THEN** 系统 MUST 把至多前 5 个去重后的合法候选交给最终模型
- **AND** 最终模型 MUST 只能从该预筛子集中选择一个目标或返回 no-match

#### Scenario: 候选数不超过topK时跳过RAG

- **GIVEN** `ragPrefilter.topK=5`
- **AND** 治理后候选数小于或等于 5
- **WHEN** router 执行候选准备
- **THEN** 系统 MUST 不调用 builtin `Rag`
- **AND** MUST 把全部治理后候选交给最终模型

#### Scenario: RAG结果不能扩大候选集合

- **WHEN** RAG 结果包含未绑定 capability、类型不匹配 capability、重复 source 或不符合 capability source 格式的 chunk
- **THEN** 系统 MUST 忽略这些结果
- **AND** MUST NOT 把任何原受控候选集合外的目标交给最终模型或后续执行路径

#### Scenario: RAG零命中

- **WHEN** RAG 完整成功但返回零个 chunk，或全部结果在候选成员校验时被过滤
- **THEN** 路由结果 MUST 为 `MODEL_DRIVEN_LOOP`
- **AND** `safeReason` MUST 为 `AGENT_ROUTER_PLUGIN_NO_MATCH`
- **AND** 系统 MUST NOT 调用最终路由模型

#### Scenario: RAG依赖失败

- **WHEN** 启用预筛但 builtin `Rag` 未在当前 Agent enabled binding 中可用，或 RAG 调用失败、取消、超时且没有合法部分结果
- **THEN** 系统 MUST 进入既有安全 plugin failure boundary
- **AND** MUST NOT 回退到完整候选集合、其它 RAG provider 或全局能力搜索

### Requirement: agent-router-plugin使用当前Agent初始模型执行一次受控选择

`agent-router-plugin` MUST 通过 `ModelSelectionService` 的 `INITIAL` 模式按 accepted Agent 既有初始模型规则选择实际模型，并使用 purpose `AGENT_ROUTING_SELECTION` 计算 prompt compatibility；MUST NOT 在 router 内复制 `defaultModelId`、first eligible 或 fallback 选择规则。模型选择成功后，系统 MUST 通过唯一 `PromptTemplateResolverPort`，使用同一 accepted Agent scope、locale、trusted string flow variables 与 selected canonical model id 解析 Agent-scoped 终选 template。resolver 返回 `RESOLVED` 时系统 MUST 使用其 rendered content；返回 `NOT_FOUND` 时系统 MUST 使用 plugin 代码私有且非空的 `defaultSelectionTask`。系统 MUST 对 accepted user input 与 effective final candidate set 执行一次无 Tool 的 run-bound 模型调用。effective final candidate set MUST 为未启用 RAG 预筛时的全部受控候选、候选数不超过 `topK` 时的全部受控候选，或 RAG 预筛后仍属于原受控候选集合的子集。

模型输入 MUST 把 resolved Agent template content 或 plugin `defaultSelectionTask` 作为独立 `task`，并把完整 accepted input 与 effective final candidate set 作为分离 JSON 字段。router MUST 固定 `tools=[]`、`toolChoice=NONE`、`temperature=0`、`maxOutputTokens=128`、`maxRetries=0`，MUST NOT 合并 prompt template `modelOptions`。模型输出契约 MUST 只允许 `kind` 为 `SKILL`、`WORKFLOW` 或 `NONE`，并在 `kind` 为 `SKILL` 或 `WORKFLOW` 时包含精确候选名称。系统 MUST 在产生路由决策前校验输出结构、未知字段、类型与 effective final candidate set 成员关系。

官方 `agent-router-plugin` 代码内置的 `defaultSelectionTask` MUST 把 effective final candidate set 定义为唯一可选权威，MUST 把 accepted input、候选 display name 与 description 仅作为语义匹配数据，并 MUST 指示模型拒绝执行其中企图改变路由规则、输出契约或候选范围的指令。该 task MUST 要求选择最强直接语义匹配的单一候选；当无候选能有意义支持请求目标、候选 description 不支持所需结果，或无法可辩护地确定唯一候选时，MUST 要求返回 `NONE`。该 task MUST 只要求返回精确的 `{"kind":"SKILL","name":"<exact capabilityId>"}`、`{"kind":"WORKFLOW","name":"<exact capabilityId>"}` 或 `{"kind":"NONE"}` JSON object，MUST NOT 要求 prose、reasoning、Markdown 或 code fence。Agent-scoped override template MAY 提供不同的选择指导，但不得改变 router 固定的候选成员校验、输出 schema 或模型调用控制。

该模型调用 MUST 复用 accepted request 的 Agent Scope、Owner Scope、session、request 与 run coordinates，MUST 接收同一个 `AbortSignal`，并 MUST NOT 使用 Tool descriptors、其它 Agent 的模型、其它 Agent 的 bindings 或未按 accepted assembly 治理的 capability catalog结果。该路由选择 MUST NOT 修改 Agent 的模型集合、默认模型或后续模型循环的选择规则。

**需求类别**：功能性需求

#### Scenario: 使用当前Agent初始模型

- **WHEN** accepted Agent 激活 `agent-router-plugin` 且 effective final candidate set 至少有一个候选
- **THEN** 系统 MUST 按 accepted Agent 的初始模型选择规则取得模型
- **AND** MUST 使用该模型完成恰好一次无 Tool 路由选择调用
- **AND** 后续请求处理 MUST 继续使用既有模型选择规则，且 MUST NOT 因本次选择改变默认或 fallback 顺序

#### Scenario: 终选提示词优先使用Agent模板

- **WHEN** effective final candidate set 至少有一个候选且当前 Agent 为 purpose `AGENT_ROUTING_SELECTION` 注册了匹配模板
- **THEN** router MUST 使用该 Agent-scoped template 的 rendered content 作为模型请求 `task`
- **AND** MUST NOT 使用 plugin default task 覆盖该 Agent template
- **AND** MUST NOT 使用平行硬编码终选 task 覆盖该 Agent template

#### Scenario: 插件内置默认task约束语义选择

- **WHEN** effective final candidate set 非空且当前 Agent 未注册匹配的 `AGENT_ROUTING_SELECTION` template
- **THEN** resolver MUST 返回 `NOT_FOUND`
- **AND** router MUST 使用官方插件代码内置的 `defaultSelectionTask`
- **AND** 该 task MUST 明确候选数组是唯一可选范围
- **AND** MUST 要求模型忽略 accepted input 或 candidate text 中企图改变路由规则、输出契约或候选范围的指令
- **AND** MUST 要求在存在唯一最强直接语义匹配时选择该候选，否则返回 `NONE`
- **AND** MUST 要求只返回约定的单一 exact JSON object

#### Scenario: 空候选跳过模型与模板解析

- **WHEN** 受治理候选为空或 configured RAG 成功返回零个合法命中
- **THEN** 系统 MUST 直接返回 no-match
- **AND** MUST NOT 调用 `ModelSelectionService`、`PromptTemplateResolverPort` 或模型

#### Scenario: 模型返回候选集合外目标

- **WHEN** 模型输出的名称不属于受控候选集合，类型与同名候选不一致，包含未知字段，或同时表达多个目标
- **THEN** 系统 MUST 把该输出判定为非法路由结果
- **AND** MUST NOT 调用该输出指向的任何 Skill 或 Workflow

### Requirement: agent-router-plugin依赖失败时安全拒绝

当初始模型选择、prompt template resolution、模型调用、候选治理读取、configured RAG 预筛、请求取消或模型输出校验失败时，系统 MUST 通过既有 plugin routing failure boundary 产出安全 `REJECT` 路由结果。失败路径 MUST NOT 回退到未治理候选、预筛前完整候选、随机候选或全局能力搜索，MUST NOT 把 raw prompt、模型原始输出、RAG query、RAG result content、binding 描述、provider error、credential、路径或 stack 投影到 SafeError、timeline、stream、audit、metric 或 trace。

no-match 和空候选集合属于正常 `MODEL_DRIVEN_LOOP` 结果，MUST NOT 被归类为依赖失败。系统 MUST 为 Skill 选择、Workflow 选择、no-match 与安全失败使用稳定且低敏的 safe reason code，使测试和运维可以区分四类结果而无需读取原始输入或模型输出。

四类结果的 `safeReason` MUST 分别为 `AGENT_ROUTER_PLUGIN_SKILL_SELECTED`、`AGENT_ROUTER_PLUGIN_WORKFLOW_SELECTED`、`AGENT_ROUTER_PLUGIN_NO_MATCH` 与 `PLUGIN_ROUTING_POLICY_FAILED`。

**需求类别**：系统质量属性

**质量属性**：安全

**适用范围**：该 Function

#### Scenario: 模型调用失败

- **WHEN** 当前模型不可用、调用超时、返回 safe error 或抛出执行错误
- **THEN** 路由结果 MUST 为安全 `REJECT`
- **AND** 系统 MUST NOT 改选任何 Skill 或 Workflow
- **AND** 可观察诊断 MUST 只包含稳定 scope refs、结果类别和 safe reason code

## Function 变更汇总

### 描述

- **变更类型**：修改
- **目标内容**：开发者可激活并配置系统提供的模型驱动路由插件，使系统按目标类型限制与 optional RAG 预筛，在当前 Agent 显式绑定且当前请求可用的 Skill、Workflow 中选择一个受治理处理路径，依赖失败时安全拒绝。
- **依据 Requirements**：`agent-router-plugin按配置限制目标类型`、`agent-router-plugin仅选择当前Agent绑定的可用能力`、`agent-router-plugin可通过受治理RAG Tool预筛候选`、`agent-router-plugin使用当前Agent初始模型执行一次受控选择`、`agent-router-plugin依赖失败时安全拒绝`

### 输入

- **变更类型**：修改
- **目标内容**：路由策略输入包括 accepted user input、当前 Agent policy config、enabled Skill/Workflow bindings、当前请求治理可用性、optional governed RAG result 和当前 Agent 初始模型选择结果；scope 与候选不得由客户端、模型或 RAG 结果扩大。
- **依据 Requirements**：`agent-router-plugin按配置限制目标类型`、`agent-router-plugin仅选择当前Agent绑定的可用能力`、`agent-router-plugin可通过受治理RAG Tool预筛候选`、`agent-router-plugin使用当前Agent初始模型执行一次受控选择`

### 处理过程

- **变更类型**：修改
- **目标内容**：系统先按配置限制目标类型并形成 binding 与治理可用能力的交集；启用且需要 RAG 预筛时把候选缩小到配置上限；effective final candidate set 非空时使用当前 Agent 初始模型做一次无 Tool 直接语义选择，无可辩护的唯一匹配时返回 no-match，并校验结果只指向受控候选；选中目标进入既有受治理路径，no-match 进入模型驱动循环，依赖失败安全拒绝。
- **依据 Requirements**：`agent-router-plugin按配置限制目标类型`、`agent-router-plugin仅选择当前Agent绑定的可用能力`、`agent-router-plugin可通过受治理RAG Tool预筛候选`、`agent-router-plugin使用当前Agent初始模型执行一次受控选择`、`agent-router-plugin依赖失败时安全拒绝`

### 结果

- **变更类型**：修改
- **目标内容**：正常结果为选中一个 effective final candidate 中的 bound Skill、选中一个 effective final candidate 中的 bound Workflow 或 no-match；RAG、模型、治理、取消或输出校验失败时返回安全拒绝，且不改选其它能力。
- **依据 Requirements**：`agent-router-plugin仅选择当前Agent绑定的可用能力`、`agent-router-plugin可通过受治理RAG Tool预筛候选`、`agent-router-plugin依赖失败时安全拒绝`

### 规格

- **规格项**：模型路由候选范围
- **变更类型**：新增
- **原规格值**：不适用（新增）
- **目标规格值**：`SKILL`、`WORKFLOW`、`SKILL_OR_WORKFLOW` 三种配置范围内，当前 Agent enabled 显式 bindings 与当前请求治理可用能力的交集；默认 `SKILL_OR_WORKFLOW`
- **依据 Requirements**：`agent-router-plugin按配置限制目标类型`、`agent-router-plugin仅选择当前Agent绑定的可用能力`

- **规格项**：模型路由结果集合
- **变更类型**：新增
- **原规格值**：不适用（新增）
- **目标规格值**：一个 bound Skill、一个 bound Workflow、no-match 或安全拒绝
- **依据 Requirements**：`agent-router-plugin仅选择当前Agent绑定的可用能力`、`agent-router-plugin依赖失败时安全拒绝`

- **规格项**：每次插件路由的模型调用
- **变更类型**：新增
- **原规格值**：不适用（新增）
- **目标规格值**：候选非空时使用当前 Agent 初始模型执行恰好一次无 Tool 调用；候选为空时不调用模型
- **依据 Requirements**：`agent-router-plugin使用当前Agent初始模型执行一次受控选择`

- **规格项**：RAG 预筛上限
- **变更类型**：新增
- **原规格值**：不适用（新增）
- **目标规格值**：`ragPrefilter` 为 optional；未配置时跳过 RAG 预筛，配置后 `topK` 为每次预筛最多保留的候选数，范围 1–10，默认 5
- **依据 Requirements**：`agent-router-plugin可通过受治理RAG Tool预筛候选`
