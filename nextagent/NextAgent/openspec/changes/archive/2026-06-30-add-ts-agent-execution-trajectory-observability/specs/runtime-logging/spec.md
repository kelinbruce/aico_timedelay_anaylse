## ADDED Requirements

### Requirement: Runtime log and trajectory log SHALL keep separate responsibilities

`nextagent-runtime.log` MUST 继续承载运行编排和局部执行诊断，例如 queue、dispatch、execution start/finish、terminal commit、tool call start/finish 以及本地调试所需的少量运行细节。它 MUST NOT 成为 agent execution trajectory 的唯一复盘面，也 MUST NOT 替代 observation-derived structured trajectory log。

凡是需要跨 turn、context assembly、capability selection、sandbox execution、visible output 和 terminal 形成统一复盘视图的轨迹点，系统 MUST 通过 observation-derived structured log 提供；runtime log 只保留编排诊断职责。

#### Scenario: Runtime diagnostics do not replace trajectory replay
- **WHEN** 本地排障需要查看 queue、dispatch、terminal commit 和工具执行等运行诊断
- **THEN** runtime log MAY 继续输出这些运行细节
- **AND** 当需要完整复盘 agent 如何推进任务时，系统 MUST 依赖 structured trajectory log 而不是 runtime log 拼接出唯一真相
