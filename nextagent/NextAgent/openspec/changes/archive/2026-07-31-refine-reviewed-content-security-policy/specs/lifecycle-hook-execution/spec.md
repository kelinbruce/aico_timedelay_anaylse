## Function

- **所属 Function**：`FN-10.1 注册和执行钩子`
- **Function 变更类型**：`MODIFIED`
- **spec 角色**：主规格

## MODIFIED Requirements

### Requirement: System output redaction guard protects final client-visible content

内置 `system.output-redaction-guard` SHALL 是运行于 `BEFORE_AGENT_TERMINAL` 的 `SYSTEM` lifecycle hook，并使用 `effects=["TRANSFORM","CONTROL"]`、`failureMode=FAIL`、明确的 system order、`configSchema` 和仅启动期执行的 `configure(config)`。

该 hook SHALL 检查最终 client-visible `finalContent`，在可安全替换时脱敏有界的 credential-like pattern、手机号和本地/内部路径，并对 private key 这类高风险内容返回 `BLOCK`。该 hook MUST NOT 因 IPv4 或 IPv6 地址形态改写或阻止 `finalContent`。该 hook MUST NOT 作为 `AFTER_MODEL_RESULT` 的替代实现，也 MUST NOT 记录 raw finding 或 raw final content。

**需求类别**：系统质量属性

**质量属性**：安全、可测试性
**适用范围**：该 Function

#### Scenario: 脱敏 guard 在 final-content event 前改写受保护内容

- **WHEN** 最终内容包含 credential-like pattern、手机号或本地/内部路径中的至少一种可脱敏文本
- **THEN** terminal stage MUST 消费 `AgentTerminalMutation.finalContent`
- **AND** 发出的最终内容 MUST 使用脱敏后的内容

#### Scenario: 业务 IP 内容保持原文

- **WHEN** 最终内容包含任意 IPv4 或 IPv6 地址，且不包含其他命中终态保护策略的内容
- **THEN** `system.output-redaction-guard` MUST 返回不含 `finalContent` mutation 的 `PASS`
- **AND** 发出的最终内容 MUST 保留 IP 地址原文

#### Scenario: IP 与其他受保护内容同时出现

- **WHEN** 最终内容同时包含 IP 地址和至少一种其他命中终态保护策略的内容
- **THEN** `system.output-redaction-guard` MUST 仅改写或阻止其他命中内容
- **AND** 产生的 `finalContent` mutation MUST 保留 IP 地址原文

## Function 变更汇总

### 处理过程

- **变更类型**：修改
- **目标内容**：系统在终态发送前检查最终内容，仅对 credential-like pattern、手机号、本地/内部路径和 private key 执行既有转换或控制；IP 地址不参与该 hook 的命中判断。
- **依据 Requirements**：`System output redaction guard protects final client-visible content`

### 结果

- **变更类型**：修改
- **目标内容**：业务 IP 内容保持原文；其他既有终态保护内容继续被脱敏或阻止。
- **依据 Requirements**：`System output redaction guard protects final client-visible content`
