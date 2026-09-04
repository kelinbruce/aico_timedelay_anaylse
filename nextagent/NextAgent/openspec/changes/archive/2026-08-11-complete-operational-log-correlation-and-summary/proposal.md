## Why

Agent 开发者和运维人员已经可以在本地 operational log 查看 Model、Tool 和异常原始诊断，但复杂请求仍无法稳定完成跨事件关联和终态汇总：生命周期事件缺少 trace 坐标，`request.completed` 不能直接回答请求状态、总 token usage 和 Tool 调用次数，结构化事件仍混入重复 `msg`，deployment version 与 component 命名也没有形成唯一规则。定位人员必须在多条日志之间手工猜测关系，并可能把不完整统计误认为完整结果。

这些问题属于同一个 physical operational log 契约：每条日志应能标识实际部署、明确 owner、使用可信执行坐标，并让终态事件给出可验证的请求摘要。现在补齐该契约，才能使本地日志真正承担电信运维场景的问题关联、流程可视化和版本定位职责。

## 目标与非目标（Goals / Non-Goals）

**目标：**

- lifecycle、Model payload、Tool payload 和执行异常日志可通过可信 `traceId`、`spanId` 及既有 run/step/invocation 坐标关联。
- request terminal 日志直接提供 canonical status、聚合 Model usage、Tool 调用次数和汇总完整性。
- 带稳定 `event` 的结构化日志不再重复输出 `msg`；Fastify native access record 保持现有可识别形状。
- 每条 operational entry 使用实际 deployment `serviceVersion` 和 owning package component。
- `observation_derived` 继续表示安全 canonical lifecycle，`runtime_diagnostic` 继续表示本地原始或技术诊断，二者不互相扩散原始内容。

**非目标：**

- 不修改、抑制或验收 `udsGateway.call.start`、`udsGateway.call.complete` 及其采样策略。
- 不把 operational log、trace 坐标或请求汇总提升为 runtime、timeline、audit 或 persistence truth。
- 不把 `traceId`、`spanId`、本地原始 payload 或异常正文加入 Web API、stream、public DTO、SafeError、audit、metric label 或 `agent-contracts`。
- 不在 request terminal entry 重复输出原始异常 message、stack 或 cause；原始根因继续由同 run 的 runtime error diagnostic 承载。
- 不新增日志文件族、配置开关、远端日志服务或诊断 evidence store。

## What Changes

- 修改 operational log 的可信关联结果：适用的 lifecycle、Model/Tool payload 和 execution exception entry 输出有效 `traceId` 与 `spanId`，并保持既有 run/step/invocation 坐标。
- Refinement 既有 trace/log linking 架构：`ObservabilityObservationEvent`、public contract 和普通 projector 继续不携带 trace identifier；可信 timeline span snapshot 只通过进程内 sidecar 交给 LOG projector，direct runtime diagnostic 只读取当前 execution scope，caller 不能注入。
- 修改 request terminal 摘要：`request.completed`、`request.failed` 和 `request.canceled` 输出 canonical `status`、聚合 `usage.inputTokens/outputTokens/totalTokens`、`toolCallCount` 和 `summaryStatus=COMPLETE|PARTIAL`；无法证明完整时必须标记 `PARTIAL`，不得伪造零值或完整结果。
- 修改 physical message 规则：存在稳定 `event` 时不输出 `msg`；Fastify native access pair 继续只使用其既有 native `msg`。
- 修改 deployment identity：所有 product composition 必须提供可信 `serviceVersion`，不得回退到硬编码产品版本。
- 修改 component identity：product logger 的 `component` 使用 owning package 短名，细分角色只使用 `source`。
- 明确 surface 验收按信任边界而不是“业务/技术”字面分类：canonical lifecycle 进入 `observation_derived`，本地 Model/Tool/error 原始定位和技术诊断进入 `runtime_diagnostic`。

## Feature 影响（Features）

### 修改的 Feature

- `F-7.1 结构化日志`：运维人员可以从单一 operational log 获得可信 trace 关联、请求终态摘要、deployment identity 和统一 component owner，降低复杂请求定位与流程可视化成本。

## Function 影响（OpenSpec Capabilities）

### 新增 Function

无。

### 修改的 Function

- `FN-7.1 输出结构化日志` → `specs/runtime-logging/spec.md`
  - 功能边界：physical operational log 增加可信 trace 关联、request terminal 汇总、单一 message 规则、真实 deployment version 和 package-owned component identity。
  - 系统质量属性：可靠性/恢复、可维护性、可测试性、审计/可追溯性。
  - 映射说明：`runtime-logging` 是 canonical spec；本 change 不触及 legacy spec Requirement。

## 影响范围（Impact）

- 日志查询和可视化可以直接按 trace/run/step/invocation 串联请求，并展示终态 usage 和 Tool 次数；消费方需要识别 `summaryStatus`。
- 依赖结构化 event 同时读取 `msg` 的本地日志消费方式需要改用 `event` 和结构化字段；Fastify access record 不受影响。
- app、local/remote deployment entrypoint 必须提供实际 service version；测试 composition 需要显式 fixture version。
- observability projection、runtime logger writer、app composition、Tool/Model direct diagnostic 和相关 contract/architecture/system integration tests 受影响。
- Web、stream、timeline、SafeError、audit、metric 和 public contracts 不变。
