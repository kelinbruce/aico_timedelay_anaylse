# runtime-logging Specification

## Function

- **所属 Function**：`FN-7.1 输出结构化日志`
- **Function 变更类型**：`MODIFIED`
- **spec 角色**：主规格

## MODIFIED Requirements

### Requirement: 基线运营目录与信号预算已实现冻结

实现 SHALL 在其中明确编目的里程碑上遵循 `event-catalog.md`。该目录 MUST NOT 被解释为覆盖所有直接诊断的封闭 enum。

对一个孤立的普通 Web submit 流程，default-info 编目的 request 轨迹 MUST 包含 request/model/capability/terminal bookends，以及内部 run 诊断所需的关键安全子阶段里程碑。其他过程级组件日志不属于该 per-request 轨迹。Metrics MUST NOT 增加该轨迹；失败/降级 MUST 保持可见。

`scheduler/submit degradation` 目录行被修改：先前冻结在 debug 的 `queue/dispatched/execution-finished` 被拆分。`queue/execution-finished` 保持 debug；`dispatched` 升级为 info。"default info trajectory" 框架语句 "routine stream、queue/dispatch、task trajectory build 和 maintenance success 可继续保持 debug" 被更新，把 dispatch 从保持 debug 的清单中排除。

`runtime.run.dispatched` MUST 在 scheduler dispatch 之后（当 `resumeExecuting !== true` 时）以 info 级别发出，携带 `agentId`、`sessionId`、`requestId`、`runId`、`laneKey`、`runCreatedAtMs`，其中 `runCreatedAtMs` = `Number(run.createdAt)`，是 accept 时刻的代理值，与 `runtime.run.turn_completed` 的 `durationMs` 定义一致。该事件适用于所有 run（workflow 与非 workflow）。它 MUST NOT 进入 timeline event、audit、metric、trace 或 Web API response。

`runtime.run.turn_completed` MUST 在发布 terminal 事件时以 info 级别发出，携带 `agentId`、`sessionId`、`requestId`、`runId`、`runStatus`、`durationMs`，其中 `durationMs` = `terminalEvent.createdAt - run.createdAt`，表示 accept 到 terminal 的时延。该事件适用于所有 run。它 MUST NOT 进入 timeline event、audit、metric、trace 或 Web API response。

`runtime.run.dispatched` 与 `runtime.run.turn_completed` 一起构成 run 生命周期 bookends：accept 到 dispatch 到 terminal。对 DETERMINISTIC_FLOW run，`workflow.execution.started`（定义于 workflow-execution-engine spec）提供 dispatched 与 turn_completed 之间的 workflow 起始里程碑，从而支持三段分解：accept 到 dispatch 到 workflow start 到 terminal。

非 workflow run（MODEL_DRIVEN_LOOP）产生 `dispatched` 和 `turn_completed`，但不产生 `workflow.execution.started`。这是路由定义所致，不是孤儿事件：`dispatched` 在 workflow 时延计算之外具有独立诊断价值（用于 queue-wait 分析的 dispatch 时间戳）。

**需求类别**：功能性需求

#### Scenario: 普通 request 在 info 级别保持可诊断

- **WHEN** 一个孤立的普通 request 以一次 model 调用完成且没有 capability 调用
- **THEN** 其 info 轨迹 MUST 包含 request accepted/completed、model start/completion、context assembly 和 first-visible 里程碑
- **WHEN** 它以两次 model 调用和一次 capability 调用完成
- **THEN** 其 info 轨迹 MUST 额外包含 capability start/completion 以及定位执行推进或停止位置所需的 model/child-stage 里程碑

#### Scenario: 直接诊断不必进入目录

- **WHEN** 一个安全组件诊断不是被编目的必需里程碑之一
- **THEN** 它 MAY 仍通过共享 writer 发出
- **AND** 它 MUST 遵守 component、level、safety 和 duplicate-outcome 策略

#### Scenario: 服务器 access 只有一个 owner

- **WHEN** Fastify 完成或失败一个 HTTP request
- **THEN** server 边界 MUST 通过 common writer 发出 Fastify 默认原生的 `incoming request`，随后恰好一条 `request completed` 或 `request errored` 记录
- **AND** Fastify MUST 接收一个从同一 `agent-log` root writer 派生的受控原生 Pino child 作为其 `loggerInstance`，不得有 app 拥有的平行 logger facade 或自定义 `LogController`
- **AND** 默认 Fastify `LogController` MUST 保持为唯一的 access-log 生产者
- **AND** 任何产品 owner 都不得发出 `http.request.*` 或 `server.access.*`
- **AND** incoming 与 final 记录 MUST 共享 Fastify 原生服务端生成的 `reqId`；incoming 记录 MUST 保留安全的 `req.method` 和已校验的路由模板 `req.url`，final 记录 MUST 保留 `res.statusCode`、`responseTime` 和固定的原生 message
- **AND** access 记录对 MUST NOT 投影捕获的 Error 或 cause 链；意外 HTTP 异常证据只属于 channel termination diagnostic
- **AND** 原始 URL/query/header/request/reply 和客户端提供的 request id MUST NOT 进入记录
- **AND** HTTP server metric MUST 由官方 OpenTelemetry HTTP instrumentation 在共享 MeterProvider 上独立发出，MUST NOT 使用 app 拥有的 `onResponse` metric observer，也 MUST NOT 生成或修改 access 记录
- **AND** incoming request logging MUST 保持启用，作为 Fastify 原生 access 记录对的第一成员
- **AND** Fastify stream、serializer、write-head、error-handler 和 service-unavailable 失败 MUST 保留稳定的框架事件，并通过 common writer 传递捕获的 Error
- **AND** adapter MUST 只序列化被批准的原生 access 字段；原始 Fastify req/reply/header/URL/自由格式 message、router dump 和客户端控制的 request id MUST NOT 绕过 common writer 或进入运营输出

#### Scenario: 例行诊断不掩盖降级

- **WHEN** 发生 policy allow 或 context assembly 成功
- **THEN** 对应事件 MUST 为 info
- **WHEN** 发生 context budget/micro-compact 成功或 task trajectory enqueue/build/skip
- **THEN** 对应事件 MAY 保持 debug
- **WHEN** Skill 扫描是部分的、task trajectory 被丢弃，或 category-question source 进入 unavailable 状态
- **THEN** 对应事件 MUST 为 warn
- **AND** category-question unavailable/recovered 信号 MUST 只在按 agent 和 locale 的状态迁移时发出

#### Scenario: Run dispatched 以 info 级别带 runCreatedAtMs 发出

- **WHEN** 一个 run 被 scheduler dispatch（且 `resumeExecuting !== true`）
- **THEN** runtime MUST 以 info 级别发出 `runtime.run.dispatched`
- **AND** 日志 MUST 包含 `agentId`、`sessionId`、`requestId`、`runId`、`laneKey`、`runCreatedAtMs`
- **AND** `runCreatedAtMs` MUST 为 `Number(run.createdAt)` 且 MUST 大于 0
- **AND** 该事件 MUST NOT 出现在 timeline store、audit、metric、trace 或 Web API response 中

#### Scenario: Run turn completed 以 info 级别带 durationMs 发出

- **WHEN** 一个 run 到达 terminal 状态且发布了 terminal 事件
- **THEN** runtime MUST 以 info 级别发出 `runtime.run.turn_completed`
- **AND** 日志 MUST 包含 `agentId`、`sessionId`、`requestId`、`runId`、`runStatus`、`durationMs`
- **AND** `durationMs` MUST 为 `terminalEvent.createdAt - run.createdAt` 且 MUST 大于等于 0
- **AND** 该事件 MUST NOT 出现在 timeline store、audit、metric、trace 或 Web API response 中

#### Scenario: 非 workflow run 产生 dispatched 而不产生 workflow start

- **WHEN** 一个 MODEL_DRIVEN_LOOP run 被 dispatch 并完成
- **THEN** 它 MUST 以 info 级别产生 `runtime.run.dispatched`
- **AND** 它 MUST 以 info 级别产生 `runtime.run.turn_completed`
- **AND** 它 MUST NOT 产生 `workflow.execution.started`
- **AND** `runtime.run.dispatched` 保留用于 queue-wait 分析的独立诊断价值

## Function 变更摘要

### Specifications

- **变更内容**：新增规格
- **规格内容**：`runtime.run.dispatched` 从 debug 升级为 info，新增 `runCreatedAtMs` 字段；`runtime.run.turn_completed` 被规格化为 info 级别事件；两者构成 run 生命周期 bookends，与 `workflow.execution.started` 一起支持 accept 到 dispatch 到 terminal 的三段时延分解。
- **涉及 Requirements**：`Baseline operational catalog and signal budget are implementation-frozen`

### 测试

- **测试要点**：scheduler dispatched 事件级别
- **验证方式**：现有测试
- **初始级别**：debug
- **目标级别**：info，携带 `runCreatedAtMs` 字段
- **涉及 Requirements**：`Baseline operational catalog and signal budget are implementation-frozen`

- **测试要点**：run turn_completed 事件级别
- **验证方式**：现有测试
- **初始级别**：已是 info 但未被规格化
- **目标级别**：info，携带 `agentId`、`sessionId`、`requestId`、`runId`、`runStatus`、`durationMs`，MUST NOT 进入 timeline/audit/metric/trace/Web API
- **涉及 Requirements**：`Baseline operational catalog and signal budget are implementation-frozen`
