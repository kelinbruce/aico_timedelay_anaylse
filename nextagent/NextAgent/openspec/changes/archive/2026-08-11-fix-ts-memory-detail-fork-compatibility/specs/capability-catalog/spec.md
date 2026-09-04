## Function

- **所属 Function**：`FN-5.2 调用能力`
- **Function 变更类型**：`MODIFIED`
- **spec 角色**：主规格

## ADDED Requirements

### Requirement: Capability 内部来源诊断保持模型不可见

`CapabilityInvocationResult.metadata.sourceTrace` MUST 被视为有界的内部来源诊断。该顶层 metadata key MUST 只作为本地 canonical `toolOutput` 的内部诊断输入，MUST NOT 被视为安全 model-visible metadata。系统 MUST 在唯一的通用 Capability result 模型投影边界剔除该 key，并 MUST NOT 把它写入后续模型输入或 durable `CAPABILITY_RESULT`。

该过滤 MUST 只按 `CapabilityInvocationResult.metadata` 的顶层 exact key 工作。通用投影 MUST NOT 递归扫描 `structuredPayload`、解析 memory domain record、按 Tool 名称建立例外或删除其他已接受的安全 metadata。`metadata.sourceTrace` MUST NOT 扩散到 Web API、SSE、WebSocket、timeline event、SafeError、audit record、metric sample、trace attribute 或 `ObservabilityObservationEvent`。

**需求类别**：系统质量属性

**质量属性**：安全

**适用范围**：`FN-5.2 调用能力`

#### Scenario: 内部来源只进入本地 Tool 输出诊断
- **WHEN** Capability 成功结果包含安全业务 `structuredPayload` 和顶层 `metadata.sourceTrace`
- **THEN** 未触发既有单条日志容量 fallback 时，本地 canonical `toolOutput` MUST 在 credential 脱敏约束内记录两者
- **AND** 触发既有单条日志容量 fallback 时，系统 MUST 使用既有有界降级结果且不得把内部来源转移到其他 outward surface
- **AND** 后续模型输入和 durable `CAPABILITY_RESULT` MUST 保留业务 `structuredPayload` 但 MUST NOT 包含 `metadata.sourceTrace`
- **AND** public stream、timeline、SafeError、audit、metric、trace 和 observation MUST NOT 包含该内部来源

#### Scenario: 通用投影不理解 Tool 业务结构
- **WHEN** 通用 Capability result 投影处理包含 `metadata.sourceTrace` 的任意 Capability 结果
- **THEN** 投影 MUST 仅删除 metadata 的 exact top-level `sourceTrace` key
- **AND** 投影 MUST 保留其他已接受的安全 metadata
- **AND** 投影 MUST NOT 按 capability id、Tool name 或 `structuredPayload` 内部字段结构分支

## Function 变更汇总

### 输出

- **变更类型**：修改
- **目标内容**：Capability 通用消费边界明确区分模型可见安全 metadata 与仅供本地 canonical `toolOutput` 使用的顶层 `metadata.sourceTrace`，不修改 frozen `CapabilityInvocationResult` shape。
- **依据 Requirements**：`Capability 内部来源诊断保持模型不可见`
