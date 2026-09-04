## MODIFIED Requirements

### Requirement: Sandbox 功能禁用开关在启动时校验并冻结

本地 app composition 配置 SHALL 将 `sandbox.enabled` 视为受限本地 sandbox 的冻结校验模式开关。如果省略，启动校验 MUST 推导出 `true`。如果以任何非布尔值出现，或出现在其他方面非法的 `sandbox` shape 下，启动校验 MUST 在 ready 状态之前安全失败。推导出的值 MUST 被冻结进 `DefaultSystemConfig.sandbox.enabled`，并由 app composition 在组装本地 sandbox gateway 和 Bash 工具 policy 模式时消费。Runtime 请求 MUST NOT 重新读取源配置或变更该值。

当 `sandbox.enabled=true` 时，本地受限 sandbox 和 Bash 工具 MUST 保持其严格校验行为。当 `sandbox.enabled=false` 时，本地 app composition MUST 将受限本地 sandbox 置于可信 shell 模式用于 Bash 执行，同时仍保留 sandbox gateway 的所有权。

#### Scenario: 缺失 sandbox enabled 开关默认为严格校验

- **WHEN** 启动校验不带 `sandbox.enabled` 的配置
- **THEN** 冻结配置包含 `sandbox.enabled=true`
- **AND** 下游 sandbox 组装消费严格校验模式

#### Scenario: 禁用 sandbox 校验冻结为可信 shell 模式

- **WHEN** 启动校验带 `sandbox.enabled=false` 的配置
- **THEN** 冻结配置包含 `sandbox.enabled=false`
- **AND** app composition 将该模式传入本地受限 sandbox 和 Bash 工具
- **AND** runtime 请求不能覆盖它
