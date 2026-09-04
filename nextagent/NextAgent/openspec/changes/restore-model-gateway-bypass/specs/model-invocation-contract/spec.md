## MODIFIED Requirements

### Requirement: Invocation preconditions are validated before provider execution

provider execution 开始前，模型调用边界 MUST 校验真实 invocation scope、selected modelId、Agent activation、模型可用性、messages、tools、全部可选调用参数、cancellation 和 execution budget。run-bound 调用 MUST 在发布 started fact 前把 scope 的完整 session/request/run/operation coordinates 与 accepted run/context 原子校验；scope shape MUST NOT 决定 lifecycle。模型边界 MUST 在不发生 provider access 的情况下拒绝 unknown、UNAVAILABLE 或 non-activated model。

当且仅当 providerId=model-gateway 时，modelId 资格检查（ssembly.modelIds.includes(request.modelId)）MUST 被跳过；ssemblyRef 校验 MUST 仍然强制执行。此例外允许 Gateway 透传 recipe 中指定但未在 Agent assembly 中激活的 modelId。非 model-gateway provider 不受此例外影响。

**需求类别**：功能性需求

#### Scenario: 已选模型可调用
- **WHEN** modelId 在目录中为 AVAILABLE，且属于 invocation scope 标识的 accepted Agent assembly
- **THEN** 调用 MUST 通过该 model profile 对应的唯一受信 provider access 继续

#### Scenario: 已选模型不可调用
- **WHEN** modelId unknown、UNAVAILABLE 或未被 accepted Agent 激活
- **THEN** provider execution 不启动
- **AND** 模型调用返回安全失败

#### Scenario: model-gateway 透传未激活 modelId
- **WHEN** providerId=model-gateway 且 modelId 不在 ssembly.modelIds 中，但 ssemblyRef 匹配
- **THEN** modelId 资格检查 MUST 被跳过
- **AND** provider execution MUST 继续

#### Scenario: model-gateway 仍校验 assemblyRef
- **WHEN** providerId=model-gateway 且 ssemblyRef 不匹配
- **THEN** provider execution 不启动
- **AND** 模型调用返回 MODEL_NOT_ACTIVATED 安全失败

#### Scenario: Budget 禁止执行
- **WHEN** request step 在调用开始前超出允许 budget
- **THEN** provider execution 不启动
