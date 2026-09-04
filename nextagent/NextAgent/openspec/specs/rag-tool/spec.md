# rag-tool Specification

## Purpose
定义模型在 accepted request 中通过统一 Capability framework 检索当前 Agent 可用知识源的黑盒契约，包括索引选择、Owner/Agent scope、合法零命中、部分成功、失败和安全诊断语义。

## Function

- **所属 Function**：`FN-5.13 检索知识库`
- **Function 变更类型**：`MODIFIED`
- **spec 角色**：主规格
## Requirements
### Requirement: RAG Tool is a capability retrieval entrypoint

The system SHALL expose a builtin `rag` Tool that lets the model request semantic retrieval from the current Agent's available knowledge sources during an accepted request. The Tool MUST execute through the unified capability framework and MUST NOT own request lifecycle, session lane, context assembly, model invocation, Web transport, knowledge governance, indexing or document scanning semantics.

#### Scenario: Model invokes RAG during a request
- **GIVEN** a request has been accepted
- **AND** the current Agent capability binding allows builtin `rag`
- **AND** trusted owner scope, agent scope and workspace scope are available from trusted runtime/app context
- **WHEN** the model calls `rag`
- **THEN** the capability executor SHALL validate Tool input
- **AND** call the RAG retrieval gateway
- **AND** return a safe Tool result.

### Requirement: Tool input is bounded and cannot select authority

`rag` Tool input SHALL include a non-blank natural language `query`, MAY include provider-neutral logical `indexes`, and MAY include bounded result option `topK`. `query` MUST be bounded to 2048 characters. `indexes`, when present, MUST be a list of 1-5 non-blank strings selecting logical indexes from the current Agent's available knowledge sources. When `indexes` is omitted, the executor SHALL use the trusted app-composition default RAG logical indexes from frozen configuration; if no such configuration is present, it SHALL fall back to `["local"]`. `topK`, when omitted, MUST default to 5; when present, it MUST be an integer bounded to the public range 1-10. Tool input MUST NOT carry `tenantId`, `subjectId`, `agentId`, `agentVersion`, deployment mode, provider kind, workspace root, host path, SQLite path, raw FTS5 expression, provider-private connection/config, provider-private credential, token, provider-private index binding or provider-private retrieval parameters. Trusted owner scope, agent scope, knowledge-source scope, default logical indexes and provider selection MUST come from trusted app/runtime context.

#### Scenario: Valid query
- **WHEN** the model calls `rag` with `query="UPF timeout handling"`, `indexes=["local"]` and `topK=5`
- **THEN** the system SHALL use trusted scope and trusted provider selection
- **AND** return at most the bounded number of results allowed by the gateway contract.

#### Scenario: Explicit indexes override configured defaults
- **GIVEN** the trusted app-composition default RAG logical indexes are `["local", "remote-netops"]`
- **WHEN** the model calls `rag` with `query="UPF timeout handling"` and `indexes=["local"]`
- **THEN** the Tool SHALL call the retrieval gateway with `indexes=["local"]`
- **AND** it MUST NOT append or replace the explicit model-selected logical indexes with configured defaults.

#### Scenario: Configured defaults are applied when indexes are omitted
- **GIVEN** the trusted app-composition default RAG logical indexes are `["local", "remote-netops"]`
- **WHEN** the model calls `rag` with only `query="UPF timeout handling"`
- **THEN** the Tool input SHALL be treated as `indexes=["local", "remote-netops"]`
- **AND** `topK` SHALL be treated as 5.

#### Scenario: Retrieval gateway is selected by trusted gateway selection
- **GIVEN** app startup validation produced an enabled `rag-knowledge` gateway selection entry for the current deployment
- **WHEN** app composition wires the builtin `rag` Tool dependencies
- **THEN** the Tool SHALL receive the `RagRetrievalGateway` selected by trusted app composition
- **AND** model Tool input MUST NOT select local/remote deployment mode, provider kind, endpoint, credential or provider-private index binding.

#### Scenario: Local fallback default is applied when no configured defaults exist
- **GIVEN** no trusted app-composition default RAG logical indexes are configured
- **WHEN** the model calls `rag` with only `query="UPF timeout handling"`
- **THEN** the Tool input SHALL be treated as `indexes=["local"]`.

#### Scenario: Input attempts to override authority
- **WHEN** the model calls `rag` with a body containing `providerKind`, `deploymentMode`, an absolute path, provider-private connection/config, provider-private credential, raw FTS5 expression or provider-private index parameter
- **THEN** input validation MUST fail or ignore the unsupported field according to Tool schema policy
- **AND** the system MUST NOT use the supplied provider, path, provider-private connection/config, provider-private credential, index parameter or query expression.

#### Scenario: Index input is bounded
- **WHEN** the model calls `rag` with an empty `indexes` list, a non-string index item, a blank index, or an overlong index name
- **THEN** input validation MUST fail
- **AND** the system MUST NOT translate the invalid value into provider-private index binding.

### Requirement: RAG Tool calls the composed retrieval gateway

The `rag` executor SHALL depend only on the public `RagRetrievalGateway` contract and capability invocation context. It MUST NOT import local governance implementation, SQLite/FTS5 implementation, provider-private client, provider-private wire DTO or workspace host path. Product composition SHALL inject the gateway provider available for the current package/composition shape; Tool input MUST NOT choose or switch that provider.

For the local fallback provider, product composition SHALL treat local RAG governance as a workspace-scoped shared index for the trusted owner. Tool input, user request body, model output, and client metadata MUST NOT select a provider, switch workspace authority, override owner scope, set SQLite/FTS details, or turn `agentId`/`agentVersion` into provider-private index authority.

#### Scenario: Composed gateway is used
- **GIVEN** `agent-app` has composed a `RagRetrievalGateway`
- **WHEN** `rag` executes
- **THEN** the executor SHALL call the composed gateway with trusted scopes and bounded options
- **AND** MUST NOT inspect which provider implementation is behind the gateway.

#### Scenario: Explicit indexes override defaults
- **WHEN** the model calls `rag` with explicit logical `indexes`
- **THEN** the executor MUST use the explicit logical index list as provided after schema validation
- **AND** MUST NOT append, merge, or replace that list with app-composed defaults

#### Scenario: Tool input cannot override local RAG authority
- **WHEN** the model calls `rag` with input fields that attempt to provide owner, Agent, workspace, provider, SQLite, FTS, or private retrieval authority
- **THEN** schema validation or app composition MUST ignore or reject those fields
- **AND** local RAG retrieval authority MUST still come only from trusted owner and workspace composition

#### Scenario: Deployment shape does not change Tool semantics
- **GIVEN** local mode composes a local SQLite FTS/FTS5 fallback provider
- **AND** remote mode composes a provider backed by the real RAG service
- **WHEN** the model calls `rag`
- **THEN** both modes SHALL expose the same Tool input and output contract
- **AND** provider-specific request shape, endpoint, credential, index binding, recall parameters or ranking protocol SHALL remain provider-private.

#### Scenario: Gateway is unavailable
- **GIVEN** no RAG retrieval gateway is available for the current composition
- **WHEN** the model calls `rag`
- **THEN** the Tool result SHALL be unavailable or degraded with a safe low-cardinality reason
- **AND** MUST NOT report an empty successful retrieval.

### Requirement: Result shape is safe and bounded

RAG Tool result MUST return a `results` array whose length is at most the effective `topK`. The Tool MUST preserve its existing provider-result validation and map accepted result items to `content`, `source`, optional `provenance`, `score`, and `rankHint`. The Tool output MAY contain additional top-level fields and a `diagnostics` object with arbitrary fields. The output schema MUST NOT impose a closed result-item field set or length, format, numeric-range, or required-field constraint on result-item or diagnostics fields.

The Tool MUST preserve its existing status vocabulary, failure mapping, trusted-scope behavior, and result-count limit.

**需求类别**：功能性需求

#### Scenario: 提供方结果按既有字段投影
- **WHEN** RAG 检索提供方返回状态有效、结果数组有效且结果项通过既有校验
- **THEN** RAG Tool MUST 在不超过有效 `topK` 的前提下返回每项的 `content`、`source` 及可选 `provenance`、`score`、`rankHint`
- **AND** 输出 schema 校验 MUST NOT 因诊断对象或输出结果项的额外 schema 限制拒绝该结果

#### Scenario: 结果数量仍受检索请求约束
- **WHEN** RAG 检索提供方返回的结果数量超过有效 `topK`
- **THEN** RAG Tool MUST 只返回前 `topK` 条结果

#### Scenario: Safe result
- **WHEN** retrieval returns chunks
- **THEN** Tool result consumers SHALL receive bounded `results` items with `content`, `source`, optional `provenance`, optional `score` and optional `rankHint`
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

这些派生日志 MUST NOT 包含 query、检索正文、source、provenance、工作区路径、SQLite 路径或提供方原始错误。

#### Scenario: 成功检索记录结果数量桶
- **WHEN** RAG Tool 成功返回五条结果
- **THEN** capability completed 的结构化可观测事件 MUST 包含 `toolResultStatus="OK"` 和 `toolResultCountBucket="2-10"`

#### Scenario: 本地检索诊断不泄露语料
- **WHEN** local RAG governance 完成一次检索
- **THEN** runtime diagnostic MUST 包含状态和结果数量桶
- **AND** runtime diagnostic MUST NOT 包含 query、结果正文、来源或 provenance

### Requirement: Failures and degradation are explicit

RAG Tool MUST 按真实检索事实返回确定结果：

- 合法检索完成但没有命中 chunk 时，MUST 返回成功空结果，MUST NOT 生成 `safeError`。
- 指定或默认 logical index 不存在时，MUST 返回 `FAILED + NOT_FOUND + retryable=false`；message MUST 要求选择当前可用 index 或结束检索。
- logical index 存在但未就绪时，MUST 返回 `FAILED + CONFLICT + retryable=false`；message MUST 要求选择其他可用 index 或稍后重新查询状态。
- provider 明确返回瞬态不可用时，MUST 返回 `FAILED + UNAVAILABLE` 并保持 provider 已安全化的 retryable；provider timeout MUST 返回 `TIMED_OUT + TIMEOUT`。
- scope mismatch MUST 返回 `FAILED + AUTHORIZATION + retryable=false`。
- provider/result/output 契约无效和未知执行异常 MUST 返回 `FAILED + INTERNAL + retryable=false`。
- invocation cancellation MUST 返回 `FAILED + CANCELED + retryable=false`。
- 只有 owning RAG contract 声明的检索范围可分解为可独立使用的 chunk 子结果、结果已经包含至少一个安全可用 chunk、且 provider 明确确认至少一个其余已声明检索范围未完成时，MUST 返回 `DEGRADED` 并携带 `safeError`；message MUST 说明已有 chunk 可用、缺失范围以及选择较小 index/range 或使用已有结果的下一步。完整检索结果、合法零命中和仅受 `topK` 等声明上限约束的结果 MUST 为 `SUCCEEDED`，MUST NOT 因可能存在更多未请求结果而降级。

没有安全 chunk 的 `NO_INDEX`、`UNAVAILABLE`、`TIMEOUT`、execution failure 或 invalid provider result MUST NOT 返回 `DEGRADED`，也 MUST NOT 返回空成功结果。diagnostics 可以保留安全低基数 reason code，但 MUST NOT 建立与 outer `safeError` 竞争的失败消息或分类。

RAG descriptor MUST 保持 `IDEMPOTENT`。没有安全 chunk 的 provider unavailable MUST 使用 `PROVIDER_UNAVAILABLE + UNAVAILABLE + retryable=true`；已确认没有业务结果的 provider timeout MUST 使用 `TIMED_OUT + TIMEOUT + retryable=true`，并由统一边界在缺省 `maxRetries` 下至多重试一次，显式 `maxRetries=0` 时只执行初始 attempt。没有 chunk 的 `NOT_FOUND`、`CONFLICT`、`AUTHORIZATION`、`UNAVAILABLE`、`TIMEOUT`、`CANCELED` 和 `INTERNAL` 结果 MUST 使用 `structuredPayload={}`，失败事实只能位于 `safeError`。invalid provider result、decode、build、cleanup 和未知 provider status MUST 使用标准 internal，MUST 丢弃 diagnostics payload。

**需求类别**：功能性需求

#### Scenario: 默认 logical index 不存在

- **GIVEN** 模型省略 `indexes`
- **AND** 检索使用可信默认 logical indexes
- **WHEN** provider 报告默认 index 不存在
- **THEN** RAG MUST 返回 `FAILED + NOT_FOUND + retryable=false`
- **AND** `safeError.message` MUST 要求选择当前可用 index 或结束检索
- **AND** 结果 MUST NOT 是空 `DEGRADED` 或空成功结果

#### Scenario: Index 未就绪

- **WHEN** composed retrieval provider 报告选定 logical index 尚未就绪
- **THEN** RAG MUST 返回 `FAILED + CONFLICT + retryable=false`
- **AND** `safeError.message` MUST 要求选择其他可用 index 或稍后重新查询状态

#### Scenario: Provider 瞬态不可用

- **WHEN** provider 明确返回 `UNAVAILABLE + retryable=true`
- **AND** 尚未产生任何安全 chunk
- **THEN** RAG MUST 返回没有业务结果的最终失败
- **AND** 统一 Capability 执行边界 MUST 按 `IDEMPOTENT` 门禁最多自动重试一次
- **AND** RAG MUST NOT 把该结果改为 `DEGRADED`

#### Scenario: Timeout 返回 timed-out

- **WHEN** retrieval timeout
- **THEN** RAG MUST 返回 `TIMED_OUT + TIMEOUT`
- **AND** 结果 MUST NOT 返回 provider-private diagnostics 或空成功结果
- **AND** `safeError.retryable` MUST 为 `true`
- **AND** 缺省重试上限时 execution attempt 数 MUST 最多为 `2`

#### Scenario: 显式零次重试只执行一次 RAG timeout

- **GIVEN** `CapabilityInvocationRequest.maxRetries=0`
- **WHEN** provider 返回没有安全 chunk 的 timeout
- **THEN** execution attempt 数 MUST 为 `1`
- **AND** 最终 `structuredPayload` MUST 为 `{}`

#### Scenario: 取消返回 canceled

- **WHEN** 父 invocation 被取消
- **THEN** RAG MUST 返回 `FAILED + CANCELED`
- **AND** 结果 MUST NOT 返回 provider-private diagnostics 或空成功结果

#### Scenario: 已有安全 chunk 时允许显式降级

- **WHEN** RAG 已产生至少一个安全 chunk
- **AND** provider 明确报告至少一个其余已声明检索范围未完成
- **THEN** RAG MUST 返回 `DEGRADED` 并保留安全 chunks
- **AND** `safeError.message` MUST 说明可用 chunks、缺失检索范围和模型可采取的下一步

#### Scenario: 声明上限内完成不是降级

- **WHEN** RAG 完成声明的检索范围并返回零个或不超过 `topK` 的安全 chunks
- **THEN** RAG MUST 返回 `SUCCEEDED`
- **AND** 系统 MUST NOT 仅因知识库可能存在更多未请求 chunks 返回 `DEGRADED`

#### Scenario: Invalid provider result 属于内部错误

- **WHEN** provider 返回不符合 RAG result contract 的结果
- **THEN** RAG MUST 返回 `FAILED + INTERNAL + retryable=false`
- **AND** message MUST 说明结果校验阶段已停止调用
- **AND** 非法 provider 结果 MUST NOT 进入模型或公共投影
- **AND** `structuredPayload` MUST 为 `{}`

### Requirement: Observability is safe and low-cardinality

RAG invocation observability SHALL include only safe low-cardinality facts such as capability id, invocation id, status, result count, duration bucket and reason code. Logs, metrics, traces and audit MUST NOT include raw query text, result content, absolute paths, SQLite paths, FTS5 expressions, provider-private connection/config, provider-private credentials, prompt text, model output or raw provider error.

#### Scenario: RAG invocation is logged safely
- **WHEN** a RAG invocation completes
- **THEN** observability MAY record safe status, duration bucket, result count and reason code
- **AND** MUST NOT record raw query, returned content or provider-private details.
