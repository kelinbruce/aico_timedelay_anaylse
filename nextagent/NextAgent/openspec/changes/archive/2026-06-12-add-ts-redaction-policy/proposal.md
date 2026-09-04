## 背景与问题（Why）

当前各类对外输出都会携带诊断信息，但哪些字段可以进入统一 observation stream、字段内容如何脱敏、失败时如何保守降级，还没有被统一冻结成稳定契约。

本 change 的目标，是把 redaction policy 收敛成 `ObservabilityProjectorHost.acceptObservation(event)` 接收边界上的统一、同步、可验证准入动作，而不是让 mapper、wrapper 或 projector 各自维护脱敏规则。

## 变更范围（What Changes）

- 新增 `redaction-policy` spec，冻结统一 observation 准入 redaction 的敏感分类、字段裁剪、字段内容脱敏和失败处理。
- 明确 `ObservabilityProjectorHost.acceptObservation(event)` 在同步接收边界执行 `ObservabilityObservationEvent` 字段裁剪和字段内容脱敏。
- 明确首版 `ObservationFieldPolicy` 字段级规则表，覆盖 owner scope、时间、边界、结果、stable refs、duration、usage、safe error、kind/category、diagnostic candidates 和明确禁止字段。
- 明确 redaction 不改变字段名称、不改变 `ObservabilityObservationEvent` shape、不新增 redacted event carrier；只有 sanitized `ObservabilityObservationEvent` 可以进入 host 内部异步 handoff。
- 明确 projector 继续从同一份 sanitized observation 中选择字段；不同 projector 输出同一字段时看到相同脱敏值。
- 明确 redaction 失败时必须 fail closed，不得回退到 raw 内容。

## 核心实现策略（Current Strategy To Freeze）

冻结以下黑盒策略：

- 固定高风险敏感分类；
- 固定字段裁剪和字段内容脱敏动作；
- 固定字段级策略表；
- 在 `ObservabilityProjectorHost.acceptObservation(event)` 同步执行；
- 不改字段名和 event shape；
- 失败时显式、安全、保守降级。

## Impact

- 需要统一 observation stream、safe error、stream diagnostic 和 health diagnostic 等输出边界的字段裁剪和字段内容脱敏规则。
- 需要补齐 redaction failure、预算不足和规则不可用时的降级契约。
- 测试需要覆盖 host 接收边界准入、多规则命中、fail-closed、字段名保持不变和 sanitized observation 被 projector 复用。

## 归档前基线提升计划（Baseline Promotion Plan）

- `openspec/specs/redaction-policy/spec.md`
