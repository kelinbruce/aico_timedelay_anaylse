## ADDED Requirements

### Requirement: Cron trigger 使用标准 request lifecycle
合法 Cron trigger SHALL 转换为标准 submit command 并进入 runtime acceptance。Cron gateway、scheduler 和 callback transport MUST NOT 直接调用 model、Agent core 或 capability。trigger 创建的 run MUST 固化 task 所属 `agentId`、当前可解析 `agentVersion` 与 `agentAssemblyRef`，并同时校验 Owner Scope 与 Agent Scope。

#### Scenario: 同 session 串行
- **WHEN** Cron trigger 与用户请求同时提交到同一 session
- **THEN** 两者 MUST 经过既有 same-session lane 排序，不得绕过 scheduler 并发执行

#### Scenario: terminal commit 非回归
- **WHEN** Cron 触发的 Agent 执行成功、失败或取消
- **THEN** runtime MUST 产生与普通 submit 相同的 canonical timeline 和唯一 terminal commit
