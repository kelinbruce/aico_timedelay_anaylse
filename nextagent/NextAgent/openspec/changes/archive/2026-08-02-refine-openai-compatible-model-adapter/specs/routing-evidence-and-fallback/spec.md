## REMOVED Requirements

### Requirement: Agent Core orchestrates model fallback explicitly

**Reason**：fallback lifecycle gate、trusted reassembly 和 evidence 共同构成 `FN-4.2 模型失败降级`，不应继续由 routing-evidence legacy spec 承载主行为。

**Migration**：该 Requirement 以同名目标态 Requirement 迁入 `model-fallback-semantics`；routing evidence 的通用记录行为仍由来源 spec 其他未触及 Requirements 承载。
