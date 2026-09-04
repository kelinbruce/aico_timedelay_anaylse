## REMOVED Requirements

### Requirement: 使用者失败呈现包含阶段和固定修复指引

**Reason**：该 legacy Requirement 同时约束 request terminal failure 与非终态 Capability 步骤失败，并要求所有失败固定给出重试判断和修复指引；这会让单个 Capability 错误码被误解为整轮请求结论或尚未发生的恢复动作。用户可见失败呈现统一迁入 `FN-2.4 查看请求状态` 的 canonical spec，并按用户决策点拆分。

**Migration**：使用 `ts-run-status-visibility` 中 `请求终态失败只在有可靠行动依据时提供指导` 和 `Capability 安全失败投影必须只陈述已确认事实`。来源 spec 的 `Model 和 Capability 失败具有稳定可行动分类` 与 `客户可见失败不暴露开发诊断原文` 原位保留。
