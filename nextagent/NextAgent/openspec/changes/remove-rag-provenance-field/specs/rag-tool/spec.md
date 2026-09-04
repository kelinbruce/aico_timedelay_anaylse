## Function

- **所属 Function**：`FN-5.13 检索知识库`
- **Function 变更类型**：`MODIFIED`
- **spec 角色**：主规格

## MODIFIED Requirements

### Requirement: Result shape is safe and bounded

RAG Tool result MUST return a `results` array whose length is at most the effective `topK`. The Tool MUST preserve its existing provider-result validation and map accepted result items to `content`, `source`, optional `title`, `score`, and `rankHint`. The Tool output MAY contain additional top-level fields and a `diagnostics` object with arbitrary fields. The output schema MUST NOT impose a closed result-item field set or length, format, numeric-range, or required-field constraint on result-item or diagnostics fields.

The Tool MUST preserve its existing status vocabulary, failure mapping, trusted-scope behavior, and result-count limit.

**需求类别**：功能性需求

#### Scenario: 提供方结果按既有字段投影
- **WHEN** RAG 检索提供方返回状态有效、结果数组有效且结果项通过既有校验
- **THEN** RAG Tool MUST 在不超过有效 `topK` 的前提下返回每项的 `content`、`source` 及可选 `title`、`score`、`rankHint`
- **AND** 输出 schema 校验 MUST NOT 因诊断对象或输出结果项的额外 schema 限制拒绝该结果

#### Scenario: 结果数量仍受检索请求约束
- **WHEN** RAG 检索提供方返回的结果数量超过有效 `topK`
- **THEN** RAG Tool MUST 只返回前 `topK` 条结果

#### Scenario: Safe result
- **WHEN** retrieval returns chunks
- **THEN** Tool result consumers SHALL receive bounded `results` items with `content`, `source`, optional `title`, optional `score` and optional `rankHint`
- **AND** storage, transport and provider-private details SHALL remain hidden.

#### Scenario: Invalid provider result
- **GIVEN** the retrieval gateway returns a malformed or over-limit result
- **WHEN** `rag` maps the gateway result to Tool output
- **THEN** the Tool SHALL return failed or degraded safe output
- **AND** MUST NOT pass through unsafe fields.

#### Scenario: Diagnostics are safe
- **WHEN** retrieval succeeds, degrades or fails
- **THEN** Tool output MAY include a `diagnostics` object with low-cardinality reason codes
- **AND** diagnostics MUST NOT include raw query, returned content, host path, provider-private request/response, endpoint, credential or raw provider error.

### Requirement: RAG 检索具有低基数执行诊断

RAG Tool 完成时，系统 MUST 将 Tool 结果状态、结果数量桶和可用原因码投影到 capability completed 的结构化可观测事件。结果数量 MUST 使用有限桶值，不得写入精确结果数量。local RAG governance MUST 为索引构建和每次检索写入结构化 runtime diagnostic，包含状态、原因码（如有）、数量桶、请求 `topK` 和耗时。

这些派生日志 MUST NOT 包含 query、检索正文、source、工作区路径、SQLite 路径或提供方原始错误。

#### Scenario: 成功检索记录结果数量桶
- **WHEN** RAG Tool 成功返回五条结果
- **THEN** capability completed 的结构化可观测事件 MUST 包含 `toolResultStatus="OK"` 和 `toolResultCountBucket="2-10"`

#### Scenario: 本地检索诊断不泄露语料
- **WHEN** local RAG governance 完成一次检索
- **THEN** runtime diagnostic MUST 包含状态和结果数量桶
- **AND** runtime diagnostic MUST NOT 包含 query、结果正文或来源

## Function 变更汇总

### 描述

- **变更类型**：修改
- **目标内容**：从 RAG Tool 结果项中移除 `provenance` 字段，该字段在展示链路中从未被消费。
- **依据 Requirements**：`Result shape is safe and bounded`、`RAG 检索具有低基数执行诊断`

### 结果

- **变更类型**：修改
- **目标内容**：RAG Tool 结果项包含 `content`、`source`、可选 `title`、`score`、`rankHint`；不再包含 `provenance`。
- **依据 Requirements**：`Result shape is safe and bounded`

### 规格

- **规格项**：RAG Tool 结果项字段
- **变更类型**：修改
- **原规格值**：`content`、`source`、可选 `provenance`、`score`、`rankHint`
- **目标规格值**：`content`、`source`、可选 `title`、`score`、`rankHint`
- **依据 Requirements**：`Result shape is safe and bounded`

### 主规格

- **变更类型**：修改
- **目标内容**：`rag-tool`
- **依据 Requirements**：`Result shape is safe and bounded`、`RAG 检索具有低基数执行诊断`
