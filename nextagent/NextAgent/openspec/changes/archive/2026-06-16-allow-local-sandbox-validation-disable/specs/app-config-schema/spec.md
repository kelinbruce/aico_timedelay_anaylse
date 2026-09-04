## ADDED Requirements

### Requirement: Sandbox 功能禁用开关由启动校验并冻结

App composition 配置 schema SHALL 为 local deployment 分支包含 `sandbox.disable` 可选布尔字段。如果省略，启动校验 MUST 派生 `false`。如果以任何非布尔值出现，或出现在其他方面非法的 `sandbox` 形状下，启动校验 MUST 在 ready 状态之前安全失败。派生值 MUST 被冻结到 `DefaultSystemConfig.sandbox.disable`，并由 app composition 在组装本地 sandbox gateway 时消费。运行时请求 MUST NOT 重新读取源配置或修改该值。

#### Scenario: 缺失 sandbox 禁用开关默认为不禁用
- **WHEN** 启动校验不带 `sandbox.disable` 的配置
- **THEN** 冻结配置包含 `sandbox.disable=false`
- **AND** 下游 sandbox 组合消费该冻结值

#### Scenario: 非法 sandbox 禁用开关阻断启动
- **WHEN** 启动校验 `sandbox.disable` 被设置为非布尔值的配置
- **THEN** 启动校验在 ready 状态之前安全失败
- **AND** 下游 sandbox 组合不基于该非法值创建

#### Scenario: 运行时不能修改 sandbox 禁用开关
- **WHEN** 请求在启动之后被提交
- **THEN** request lifecycle 不重新运行 app 配置校验
- **AND** 它不能为当前进程改变 `DefaultSystemConfig.sandbox.disable`

