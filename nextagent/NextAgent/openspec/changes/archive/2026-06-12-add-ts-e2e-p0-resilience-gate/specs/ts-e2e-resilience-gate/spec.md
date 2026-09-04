## ADDED Requirements

### Requirement: Resilience E2E 使用真实故障和持久化状态

Resilience E2E gate SHALL 使用真实 stream connection、真实 local product process restart 和真实 local persistence 执行 e2e-P0-05、27、28。故障注入 MUST 位于 test composition，MUST NOT 暴露在产品入口。

#### Scenario: 真实恢复用例通过
- **WHEN** 三个必需 resilience E2E case 均通过
- **THEN** gate 产出 passed resilience E2E evidence

#### Scenario: 故障无法可靠触发
- **WHEN** 目标断连、终止点或恢复前持久化屏障无法确认
- **THEN** gate MUST 返回 failed

### Requirement: 恢复后保持 canonical 不变量

恢复 E2E MUST 证明 sequence 不重复或回绕、每个 run 最多一个 terminal result、history 与 terminal result 一致，并且非幂等 capability 在不确定恢复点不会被重复执行。

#### Scenario: Stream 断连后恢复
- **WHEN** client 在已确认 lastSeenSequence 后断连并重连
- **THEN** replay 从可恢复位置继续
- **AND** 最终 terminal result 与 history 一致

#### Scenario: Process 重启后恢复
- **WHEN** local product process 在 queued 或 executing run 期间终止并使用相同持久化状态重启
- **THEN** run 恢复到安全执行或显式失败终态
- **AND** run 不得长期停留在 running/executing

#### Scenario: 非幂等副作用不重复
- **WHEN** process 在非幂等 capability 调用状态不确定时重启
- **THEN** recovery guard 阻止不安全重复执行
- **AND** side-effect probe 次数不超过一次
