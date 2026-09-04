## ADDED Requirements

### Requirement: GuardrailGatewayPort 通过 RobotRouter 校验知识内容

`GuardrailGatewayPort` MUST 将 `checkKnowledge(input, signal?)` 暴露为知识内容安全检查的受治理后端操作。`input.texts` MUST 包含 1 到 5 个非空字符串，每个字符串至多包含 2000 个 Unicode code point。`input.isPrivacy` MUST 是可选布尔值：存在时，REMOTE adapter MUST 将其值作为 `is_privacy` 发送；缺席时，adapter MUST 省略 `is_privacy` 并允许 provider 默认值生效。

REMOTE guardrail adapter MUST 调用 `POST /rest/naie/guardrail/v1/text/security/check`，并按原始顺序发送 `texts`。它 MUST 使用与既有 guardrail 检查相同的出站 Header 策略：仅 `content-type: application/json`。它 MUST NOT 为该操作添加 `System-Language`、`X-Product-Id`、`X-Tenant-Id`、owner scope、Agent Scope 或调用方提供的任意 Header。

对 HTTP 200 响应，adapter MUST 校验顶层 `is_legal` 为布尔值，并校验每个有序 `check_results[].is_legal` 为精确字符串 `"true"` 或 `"false"`，然后将每个条目值归一化为布尔值。`check_results` MUST 包含与 `input.texts` 完全相同数量的条目；数组缺失、条目数不同或任何其他条目值 MUST 不论顶层值如何都 fail closed 为不可用结果。在该结构校验成功后，adapter MUST 仅在顶层值和每个归一化条目值都为 true 时返回 legal。顶层值为 false 或任一条目值为 false MUST 返回 blocked 结果。

`check_results[].detail` MUST NOT 出现在公开结果、SafeError、日志、metric、trace、audit 或诊断中，因为它可能包含被拒绝的知识片段。HTTP 400 MUST 返回安全且不可重试的 `GUARDRAIL_KNOWLEDGE_REQUEST_INVALID`；网络失败、超时、非 400 的非成功 HTTP status、JSON 解析失败或非法成功响应 MUST 返回可重试的 `GUARDRAIL_KNOWLEDGE_UNAVAILABLE`；调用方取消 MUST 返回不可重试的 `GUARDRAIL_KNOWLEDGE_CANCELED`。这些失败都不得暴露 provider 响应体、端点、credential 或被检查文本。

#### Scenario: 最多五个知识片段在一次请求中通过

- **WHEN** `checkKnowledge` 收到五个非空文本（每个至多 2000 个 Unicode code point）且 `isPrivacy=true`
- **AND** RobotRouter 返回顶层 legal 和五个有序 legal 条目结果
- **THEN** adapter MUST 以五个文本的原始顺序和 `is_privacy=true` 发送一个请求
- **AND** 它 MUST 返回 legal 结果

#### Scenario: Privacy 选项保持由调用方选择

- **WHEN** 调用方以 `isPrivacy=false` 调用 `checkKnowledge`
- **THEN** adapter MUST 发送 `is_privacy=false`
- **AND** 它 MUST NOT 用 provider 默认值替换调用方值

#### Scenario: 一个被阻断的片段阻断知识检查

- **WHEN** RobotRouter 返回的 HTTP 200 响应中至少一个有序条目为 false
- **THEN** `checkKnowledge` MUST 返回 blocked 结果
- **AND** 公开结果和所有可观察诊断 MUST NOT 包含对应的 `detail`

#### Scenario: 不一致的成功响应 fail closed

- **WHEN** RobotRouter 返回 HTTP 200，但 `check_results` 缺失、条目数不同，或包含非精确字符串 `"true"` 或 `"false"` 的值
- **THEN** `checkKnowledge` MUST 返回 `GUARDRAIL_KNOWLEDGE_UNAVAILABLE`
- **AND** 结果 MUST 可重试且 MUST NOT 暴露响应体

#### Scenario: 知识检查输入超出有界契约

- **WHEN** `checkKnowledge` 收到零个文本、超过五个文本、一个空文本或一个超过 2000 个 Unicode code point 的文本
- **THEN** 它 MUST 返回 `GUARDRAIL_KNOWLEDGE_REQUEST_INVALID`
- **AND** 它 MUST NOT 调用 RobotRouter
