## REMOVED Requirements

### Requirement: Successful validation produces immutable configuration artifacts

**Reason**：原 Requirement 把通用配置产物、模型目录、模型选择、调用授权和 public `NextAgentApp` 投影写在同一 legacy block 中。

**Migration**：模型目录、Agent App 两层 `modelProfiles` 配置以及 `NextAgentApp` 顶层 public projection 的 host-only/non-authority 边界迁入 `model-invocation-contract`；只保留 `systemConfig` 顶层字段且不新增公共 model API，模型配置与 validation evidence 原子迁移到父层唯一 `providerId`、子层唯一 `modelId` 和同一冻结配置快照。没有独立消费者或路由语义的 `modelProfileRegistry` 与 `productModelProviderKind` 删除，不保留 alias；provider selection 与 binding 只使用 canonical `providerId`。Agent assembly 的模型激活引用迁入 `agent-package-assembly`；Capability 与 Gateway 的下游边界继续由 `capability-source-configuration` 和 `gateway-configuration` 的 canonical Requirements 承载；不可变配置对象、readiness/evidence 生成和 dependency injection 属于 composition design。
