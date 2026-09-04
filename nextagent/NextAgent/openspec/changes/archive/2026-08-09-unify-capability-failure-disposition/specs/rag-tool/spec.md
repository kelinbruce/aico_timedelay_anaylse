# rag-tool Delta Specification

所属 Function：`FN-5.13 检索知识库`

Function 变更类型：修改

spec 角色：主规格

## MODIFIED Requirements

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

## Function 变更汇总

### 输出

- 变更类型：修改
- 目标内容：RAG 将合法零命中和声明范围内的完整/有界结果保持成功，将无 chunk 的失败按真实 category 返回，仅在已有安全 chunk 且其余已声明检索范围明确未完成时使用 `DEGRADED + safeError`。
- 依据 Requirements：`Failures and degradation are explicit`

### 处理过程

- 变更类型：修改
- 目标内容：RAG 保留 provider 安全错误，区分 index missing、index not ready、provider unavailable、timeout、cancel 和 invalid result。
- 依据 Requirements：`Failures and degradation are explicit`

### 结果

- 变更类型：修改
- 目标内容：模型可以依据 RAG `safeError.message` 的安全投影选择其他 index、稍后查询或使用已有部分 chunks；无结果失败不再绕过统一失败处置。
- 依据 Requirements：`Failures and degradation are explicit`
