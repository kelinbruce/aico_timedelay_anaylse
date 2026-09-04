# ts-core-contracts Delta

## MODIFIED Requirements

### Requirement: Runtime 生命周期 hook 边界暴露安全执行上下文

Runtime 生命周期 hook 边界 SHALL 只暴露 hook 作者观察或转换受保护操作所需的、由 stage 拥有的字段。用于诊断的边界字段 SHALL 是安全的 metadata，除非该 stage 被显式设计为本地 developer trace raw 边界。

#### Scenario: 模型结果边界携带安全时延 metadata
- **WHEN** 一次模型调用成功完成
- **THEN** `AFTER_MODEL_RESULT` 边界 MAY 在模型流返回首个 token 时包含 `firstContentLatencyMs`
- **AND** `AFTER_MODEL_RESULT` 边界 MAY 包含 `modelE2ELatencyMs`
- **AND** 这些字段 MUST 是非负的毫秒数
- **AND** 这些字段 MUST NOT 包含 prompt 文本、原始 provider delta、credential、secret 或原始 provider 错误。
