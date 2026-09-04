## Function

- **所属 Function**：`FN-8.1 持久化运行数据`
- **Function 变更类型**：`MODIFIED`
- **spec 角色**：主规格

## ADDED Requirements

### Requirement: 结构化增量记录在统一timeline gateway前有界

系统 MUST 在调用 `RunTimelineEventStoreGateway.appendEvent` 前确保每条非 Workflow `TOOL_STRUCTURED_DELTA` record 及每条 Workflow `NODE_COMPLETED` structured product record 的 `inlinePayload` 经 `JSON.stringify` 后不超过 49,000 UTF-8 bytes。该上限 MUST 同时适用于非 Workflow 聚合到界分批提交、显式 flush、`accumulated=true` direct write、run 终止兜底 flush，以及 Workflow `NODE_COMPLETED` structured product；local 与 remote binding MUST 接收同一 shape 和同一容量边界的 record。

超限内容经过有界归一化后，系统 MUST 继续使用既有 timeline gateway 持久化，并在确有内容丢失时设置 `truncated=true`。容量归一化 MUST NOT 产生 `DEGRADATION_NOTICE`、MUST NOT 产生新的 request-level terminal fact 或 annotation、MUST NOT 自行改变 request terminal status。真实 serialization、认证、连接或 storage failure MUST 按既有 gateway 失败语义传播，系统 MUST NOT 捕获并忽略该失败。

**需求类别**：系统质量属性

**质量属性**：性能/容量、可靠性/恢复

**适用范围**：该 Function

#### Scenario: 显式flush在gateway前满足容量上限

- **GIVEN** 聚合后的 `TOOL_STRUCTURED_DELTA.inlinePayload` 原始大小超过 49,000 UTF-8 bytes
- **WHEN** 系统执行显式 flush
- **THEN** 传给 `appendEvent` 的 `inlinePayload` MUST 不超过 49,000 UTF-8 bytes
- **AND** 该 record MUST 携带 `truncated=true`

#### Scenario: run终止兜底flush使用相同容量规则

- **GIVEN** run 终止时仍有超限的未提交结构化增量
- **WHEN** 系统执行兜底 flush
- **THEN** 传给 `appendEvent` 的每条 `inlinePayload` MUST 不超过 49,000 UTF-8 bytes
- **AND** 其 shape 与显式 flush 对相同输入产生的 shape MUST 相同

#### Scenario: 50,000-byte拒绝型gateway不会收到超限record

- **GIVEN** timeline gateway 会拒绝任一不小于 50,000 UTF-8 bytes 的 `inlinePayload`
- **WHEN** runtime 提交任一受支持的结构化增量
- **THEN** runtime 交给 gateway 的 record MUST 小于该拒绝边界
- **AND** 请求 MUST NOT 因可预防的 inline payload 超限而失败

#### Scenario: Workflow completed product通过同一gateway边界

- **GIVEN** 一个 Workflow `NODE_COMPLETED` structured product 的原始 `inlinePayload` 超过 49,000 UTF-8 bytes
- **WHEN** runtime 调用 timeline gateway
- **THEN** 传入 record 的 `inlinePayload` MUST 不超过 49,000 UTF-8 bytes
- **AND** record MUST 携带 `truncated=true` 与 Workflow product identity
- **AND** append 成功后的 canonical live record MUST 与 durable history record 同形

#### Scenario: 真实timeline存储失败继续传播

- **GIVEN** 已满足容量上限的结构化增量 record
- **AND** `appendEvent` 因连接、认证或存储故障失败
- **WHEN** runtime 等待该写入
- **THEN** 该失败 MUST 按既有 gateway failure contract 向上传播
- **AND** 系统 MUST NOT 把该失败伪装成成功或仅记录截断

## Function 变更汇总

### 处理过程

- **变更类型**：修改
- **目标内容**：非 Workflow 聚合结果与 Workflow completed product record 在统一 timeline gateway 前完成同形、同上限的有界归一化；真实存储失败仍显式传播。
- **依据 Requirements**：`结构化增量记录在统一timeline gateway前有界`

### 结果

- **变更类型**：修改
- **目标内容**：local 与 remote binding 均不会收到超过 49,000 UTF-8 bytes 的结构化增量 inline payload；内容截断不改变请求终态。
- **依据 Requirements**：`结构化增量记录在统一timeline gateway前有界`

### 规格

| 规格项 | 变更类型 | 原规格值 | 目标规格值 | 依据 Requirements |
|---|---|---|---|---|
| 结构化增量单记录 inline payload 上限 | 新增 | 不适用（新增） | 49,000 UTF-8 bytes，以 `JSON.stringify(inlinePayload)` 的编码结果计 | `结构化增量记录在统一timeline gateway前有界` |
