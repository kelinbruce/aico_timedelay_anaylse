## ADDED Requirements

### Requirement: Extraction 调度与进程启动秒数无关

Memory extraction 调度器 SHALL 按分钟窗口评估配置的六字段 cron 调度。在某一分钟内任意秒启动的进程，在匹配分钟窗口到来时 MUST 仍执行秒字段为 `0` 的调度。同一 scheduler 实例对同一分钟窗口 MUST 最多执行一个调度 cycle。

#### Scenario: 非对齐启动后 Dreaming 调度仍触发
- **GIVEN** extraction 调度为 `0 0 2 * * ?`
- **AND** 进程于本地时间 `01:59:41` 启动
- **WHEN** 本地时间进入 `02:00` 分钟窗口
- **THEN** 恰好一个调度的 extraction cycle MUST 启动

### Requirement: Extraction 超时约束完整 cycle

`nextAgent.memory.extraction.timeoutMs` SHALL 为完整 extraction cycle 定义一个 deadline，包括 trajectory 查询、规则/LLM 提取、融合读取和 memory 写入。该 cycle MUST 向可取消的慢边界传播由 deadline 推导的 `AbortSignal`，MUST 在 deadline 之后停止启动新工作。已完成的 memory 写入 MUST 保持已提交并计数；在任何成功写入之前超时 MUST 返回 `FAILED`，而在一次或多次成功写入之后超时 MUST 返回 `PARTIAL`，reason 为 `MEMORY_EXTRACTION_TIMEOUT`。

#### Scenario: 挂起的 LLM 被 cycle deadline 取消
- **GIVEN** extraction 已启用且 `timeoutMs=10000`
- **AND** 被选择的 LLM 操作在 deadline 之前未完成
- **WHEN** cycle deadline 到期
- **THEN** LLM 操作 MUST 收到 cancellation
- **AND** cycle MUST 返回 reason 为 `MEMORY_EXTRACTION_TIMEOUT` 的 `FAILED`
- **AND** 之后不得启动任何 memory 写入

#### Scenario: 完成一次写入后超时为 partial
- **GIVEN** 一个 candidate 写入在 deadline 之前已完成
- **AND** deadline 在剩余 candidate 被写入之前到期
- **WHEN** cycle 完成其诊断
- **THEN** 它 MUST 返回 reason 为 `MEMORY_EXTRACTION_TIMEOUT` 的 `PARTIAL`
- **AND** 它 MUST 计入已完成的写入而不再启动剩余写入
