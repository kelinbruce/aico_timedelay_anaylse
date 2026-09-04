## Function

- **所属 Function**：`FN-4.5 压缩转储工具结果`
- **Function 变更类型**：`MODIFIED`
- **spec 角色**：主规格

## MODIFIED Requirements

### Requirement: Capability-result large content is externalized to the execution workspace as a readable file

当 Capability Executor 产生的文本结果被保存为 `CAPABILITY_RESULT` Message，或被 Direct Workflow、非 agentic `ApiCall` 两类受信 direct-terminal caller 选择为 terminal answer 时，系统 MUST 在持久化对应 Message 前使用同一字符阈值和 replacement policy 物化该结果。结果正文不超过 50,000 个 UTF-16 code units 时，系统 MUST 保持 inline；结果正文超过 50,000 个 UTF-16 code units 时，系统 MUST 先把完整原始内容写入 execution workspace 的 `workspace/tool-results/<refId>.txt`，再把 Message 正文物化为 `PERSISTED_PREVIEW`。

`PERSISTED_PREVIEW` MUST 携带 `file_path=tool-results/<refId>.txt`、原始字符数、不超过 2,048 字符的 preview、`ContentRef.refType=CAPABILITY_RESULT`、replacement evidence，以及使用既有 `read` 工具按 `file_path` 和可选 `offset`/`limit` 分页读取全文的指令。完整原始内容 authority MUST 是 owner-scoped workspace 文件，不得是 preview Message、terminal Event、stream cache 或浏览器状态。

普通 Capability Result Message，以及仅由 Direct Workflow 或非 agentic `ApiCall` 成功 direct-terminal 路径产生的 Capability 来源 terminal answer，MUST 复用相同 externalizer、阈值、preview renderer、ref 生成、owner scope 与失败语义。其他 Capability、普通 Model Loop、model-driven Capability 和 Workflow-as-Tool MUST NOT 使用 direct-terminal materialization。直接 terminal consumer MUST NOT 为调用 externalizer 而持久化伪造的 `CAPABILITY_RESULT` Message，也 MUST NOT 新建 terminal 专用截断、BlobStore 或文件路径。LLM Executor 产生的 terminal answer MUST NOT 被本 Requirement 误分类为 Capability result；其输出长度由 `model-invocation-contract` 在 Agent Core 有界交付，并由 Runtime terminal guard 提供纵深保护。

Direct Workflow 与非 agentic `ApiCall` 的 inline terminal result MUST 继续以既有 `PLAIN_TEXT` terminal Assistant Message 呈现，MUST NOT 新增来源标签、Capability 卡片、content type 或前端分支。只有正文超过 50,000 字符时，Message content 才能变为本 Requirement 定义的 preview/ref projection。

**需求类别**：系统质量属性

**质量属性**：性能/容量

**适用范围**：该 Function

#### Scenario: 普通Capability Result超限时外置

- **GIVEN** Capability Executor 返回 50,001 个字符的文本结果
- **WHEN**系统把该结果保存为普通 `CAPABILITY_RESULT` Message
- **THEN**完整原文 MUST 先写入 owner-scoped `workspace/tool-results/<refId>.txt`
- **AND** Message `content` MUST 是不超过 50,000 字符的 `PERSISTED_PREVIEW`
- **AND** replacement evidence MUST 指向该文件

#### Scenario: Capability结果直接终态化时使用同一物化规则

- **GIVEN**受信 Agent caller 选择 50,001 个字符的 Capability 结果作为 terminal answer
- **WHEN** Runtime 准备 terminal composite write
- **THEN**系统 MUST 使用与普通 Capability Result Message 相同的 externalizer 物化结果
- **AND** terminal Assistant Message `content` MUST 不超过 50,000 字符
- **AND**完整原文 MUST 可通过 replacement evidence 指向的 workspace 文件读取
- **AND**系统 MUST NOT 仅为 terminal materialization 持久化伪造或额外的 `CAPABILITY_RESULT` Message
- **AND**非 agentic ApiCall 已有的真实 matching Capability Result Message MUST 保持不变

#### Scenario: 边界内Capability结果保持inline

- **GIVEN** Capability 来源结果正文恰好包含 50,000 个字符
- **WHEN**该结果进入普通 Message 或直接 terminal consumer
- **THEN**结果 MUST 保持 inline
- **AND**系统 MUST NOT 只因该字符数创建 workspace result 文件
- **AND** direct terminal consumer MUST 继续使用既有 `PLAIN_TEXT` Assistant answer presentation

#### Scenario: 其他Capability不得直接终态化

- **WHEN**普通 model-driven Capability、Workflow-as-Tool 或其他非 Direct Workflow、非 agentic ApiCall 的 Capability 完成
- **THEN**系统 MUST NOT 调用 Capability terminal answer handoff
- **AND** MUST 保持该路径既有 Tool result 或 Model Loop 语义

#### Scenario: 模型终态回答不冒用Capability外置

- **GIVEN** terminal answer 来自 LLM Executor
- **WHEN** Runtime 准备 terminal commit
- **THEN**系统 MUST NOT 以 Capability result 身份调用本 Requirement 的 externalizer
- **AND**超过 50,000 字符的模型输出 MUST 由 `model-invocation-contract` 在 Agent Core 形成带固定标记的有界成功正文
- **AND**绕过该 producer 保护而到达 Runtime 的原始超限正文 MUST 由 terminal guard 显式拒绝

#### Scenario: 两种consumer冻结同一replacement形态

- **GIVEN**一个 Capability 结果已被物化为 `PERSISTED_PREVIEW`
- **WHEN**系统保存对应 Message 或在恢复路径重放该结果
- **THEN**系统 MUST 保留既有 preview、ref 和 replacement evidence
- **AND** MUST NOT 重新外置、扩大 preview 或把原文重新 inline

#### Scenario: Oversized capability result is externalized to a workspace file before persistence

- **WHEN** a `CAPABILITY_RESULT` whose content exceeds the inline threshold is written to the message store
- **THEN** the full original content MUST be written to `workspace/tool-results/<refId>.txt` under the owner-scoped execution workspace before the Message write
- **AND** the persisted Message content MUST be the `PERSISTED_PREVIEW` carrying the file path, original size, bounded preview and read instruction
- **AND** the original full content authority MUST be the workspace file

#### Scenario: Assembly and render pass through the conformant form

- **WHEN** assembly or render loads a previously externalized Capability result
- **THEN** it MUST present the same `PERSISTED_PREVIEW` form with its file path and access instruction
- **AND** it MUST NOT re-inline the original full content unless the model explicitly invokes `read`
- **AND** it MUST NOT emit a reference-less preview

## Function 变更汇总

### 描述

- **变更类型**：修改
- **目标内容**：系统对普通 Capability Result Message 与 Capability 来源直接 terminal answer 使用同一大结果物化规则。
- **依据 Requirements**：`Capability-result large content is externalized to the execution workspace as a readable file`

### 处理过程

- **变更类型**：修改
- **目标内容**：Capability 结果超过 50,000 字符时先写入 owner-scoped workspace 文件，再把 consumer Message 物化为有界 preview/ref；模型来源终态不进入该路径。
- **依据 Requirements**：`Capability-result large content is externalized to the execution workspace as a readable file`

### 规格

- **规格项**：Capability 结果 inline 上限
- **变更类型**：修改
- **原规格值**：单一 fresh text result 超过 50,000 chars 时外置；只明确 `CAPABILITY_RESULT` Message 写入路径
- **目标规格值**：普通 Capability Result Message 与 Capability 来源直接 terminal answer 均以 50,000 个 UTF-16 code units 为 inline 上限
- **依据 Requirements**：`Capability-result large content is externalized to the execution workspace as a readable file`
