# builtin-tool-framework Delta Specification

## REMOVED Requirements

### Requirement: Model-correctable Tool input failures expose safe diagnostics

**Reason**：该 Requirement 的三项诊断上限和独立 message 容量与完整 violations、公共结果容量和 `safeError.message` 契约冲突。

**Migration**：全部 runtime Capability 的输入诊断统一由 `capability-catalog / 参数校验一次返回当前阶段全部违规`、`Capability 结果复用统一容量和转储机制` 与 `Capability 失败证据不跨安全边界` 承载；Tool 自有语义校验仍由 owning Tool 提供安全 violation。
