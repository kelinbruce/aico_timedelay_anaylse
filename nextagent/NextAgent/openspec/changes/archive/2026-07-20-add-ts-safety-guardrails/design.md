## 背景和现状

NextAgent 需要接入外部内容护栏服务 RobotRouter IR，覆盖输入侧、输出侧与 nl2py 代码生成侧三类内容安全风险。现状：

- `risk-policy-enforcement` 是操作级安全治理（能不能执行 / 要不要授权），只消费 bounded 摘要，**禁止消费 raw content**，无法承担内容审核。
- `lifecycle-hook-execution` 已提供 `BEFORE_CAPABILITY_INVOKE` 的 `CONTROL` hook 机制，但无具体护栏 hook 实例。
- `gateway-configuration` 的稳定 adapter 集合不含护栏 adapter，外部服务只能被直连。
- `agent-contracts/src/channel/index.ts` 的 `StreamEventType` 已含 `LLM_CONTENT_DELTA` / `TOOL_STRUCTURED_DELTA` / `REQUEST_COMPLETED` / `REQUEST_FAILED`。本 change 经 `refine-stream-guard-blocked-event` **新增** `OUTPUT_GUARD_BLOCKED`（terminal 事件）+ guard-forward relay 注入例外，用于输出护栏命中。
- `core-contracts.md` 冻结 `StreamEventType` vocabulary 并规定"Stream 只能投影 canonical timeline 或 runtime status；不得暴露未列出的用户可见 stream event 名称"。本 change 严守该不变量。

约束（已与需求方确认）：

- RobotRouter 作 guard proxy：NextAgent 后端在 submit 路径转发到 `POST /api/v1/guard/sessions/{sessionId}/requests`，RobotRouter 做输入校验后回调 NextAgent 既有 `POST /api/v1/sessions/{sessionId}/requests` 触发 `runtime.submit`；RobotRouter 作为 run 流的观察者做输出校验。
- **客户端流始终由 NextAgent 经 `RuntimeSessionPort.streamEvents` + 共享 projection service 拥有**，RobotRouter 不直接产生或透传客户端可见 stream event。
- nl2py 走 `BEFORE_CAPABILITY_INVOKE` hook，调 RobotRouter `POST /rest/naie/guardrail/v1/application-sec/check`，BLOCKED 返回结构化工具错误供模型自纠正。
- 所有对 RobotRouter 的调用走 gateway（NextAgent 后端发起）。
- 默认 fail-closed，关闭开关是唯一放行方式。
- 拒答语由 RobotRouter 返回，NextAgent 只透传。
- **护栏只在 REMOTE 部署下可启动，LOCAL 始终不启动。**
- 被拦截轮次的 assistant 响应不进下一轮 model context。

## 目标和非目标

**目标**

- 新增 `guardrail` gateway adapter kind 与 `GuardrailGatewayPort`，作为 RobotRouter 的唯一受治理出口。
- REMOTE 部署下 submit 路径经 guard proxy 转发完成输入护栏；RobotRouter 观察 run 流完成输出护栏，命中时 run `FAILED` → `REQUEST_FAILED`。
- nl2py SYSTEM hook 在 python capability 执行前做代码检查，BLOCKED 回灌工具错误。
- 护栏配置可开关，故障默认 fail-closed。

**非目标**

- 不修改 `risk-policy-enforcement` 行为契约（guardrail 与 risk policy 独立共存）。
- 不修改任何已冻结核心契约（`StreamEventType` / `TimelineEventType` vocabulary 不变；不新增 stream event）。
- 不在 NextAgent 侧实现内容审核规则（规则全在 RobotRouter）。
- 不在 LOCAL 产品运行时启用护栏（LOCAL stub 仅测试用）。
- 不改变 canonical timeline / 客户端流 ownership（始终归 NextAgent，经 `RuntimeSessionPort.streamEvents`）。
- 不引入新的 authorization store 或长期授权（沿用现有 authorization pending input）。

## 存量代码基线（Current State）

- 请求 submit：`packages/agent-channel-web/src/routes/requests.ts` 的 `POST /api/v1/sessions/:sessionId/requests`（line 450）与 `POST /api/v1/requests`（line 478）→ `submitStagedRequest`（line 791）→ `dependencies.runtime.submit(...)`（RuntimeCommandPort）。guard-forward 拦截点 = `submitStagedRequest` 内、`runtime.submit` 之前。
- 客户端流：`RuntimeSessionPort.streamEvents` + 共享 projection（`packages/agent-channel-web/src/projections/stream-envelope.ts`、`transports/web-stream-delivery.ts`）。guard-forward 不触碰该路径。
- 契约：`packages/agent-contracts/src/gateway/index.ts` 的 `GatewayAdapterKind`（line 61）与 `GatewayBindings`（line 100，无 `guardrail`）；`packages/agent-contracts/src/channel/index.ts` 的 `StreamEventType`（line 3，无 `OUTPUT_GUARD_BLOCKED`，本 change 不改）。
- 历史隔离落点：`SessionMessageRecord.visible: boolean`（`gateway/index.ts` line 580）已存在，被拦截轮次 assistant 响应以 `visible=false` 持久化即可，无需新契约字段（需验证 context assembly 对 `visible=false` 的排除行为）。
- Hook 机制：`packages/agent-app/src/assembly/agent-assembly-compiler.ts` 校验 `LifecycleHookDefinition`（含 `kind:"SYSTEM"`）；hook 经 `lifecycleHookDefinitions` 在 startup composition 注入。nl2py hook 复用该机制。

## 增量实施路径（Delta）

- 契约：`agent-contracts/gateway` 新增 `GuardrailGatewayPort` + DTO + `guardrail` adapter kind + `GatewayBindings.guardrail?`（加法）。`channel/index.ts` 不改。
- Provider：`agent-platform-gateway-remote` 新增 RobotRouter REMOTE provider；`agent-platform-gateway-local` 新增 testing stub；registry resolve `guardrail`（REMOTE-only）。
- Submit 路径：`submitStagedRequest` 在 `runtime.submit` 前增加 guard-forward 决策（REMOTE + 开关开启 → `forwardGuardProxy`，否则原 `runtime.submit`）。客户端流路径不变。
- 输出护栏：RobotRouter 观察 run 流；命中时 NextAgent 把 run 转 `FAILED`（guard reason）→ 共享 projection 投影既有 `REQUEST_FAILED`。
- Hook：startup composition 注入 nl2py SYSTEM hook。
- 配置：per-agent guardrail 单开关；bootstrap 投影开关状态。
- 不修改：`StreamEventType`、`TimelineEventType`、`risk-policy-enforcement`、客户端流路径、LOCAL 行为。

## 设计决策

### 决策 1：guardrail 作为 gateway adapter，而非 capability 或直连 client

RobotRouter 是外部服务，必须走 gateway composition 以满足 LOCAL/REMOTE 一致、配置治理、故障语义与"不直连 HTTP"约束。新增 adapter kind `guardrail`，`GatewayBindings.guardrail?: GuardrailGatewayPort`，owning subpath 为 `agent-contracts/gateway`。**RobotRouter 的护栏接口只能由 NextAgent 后端经 `GuardrailGatewayPort` 调用，前端/客户端绝不直连 RobotRouter**——前端只与 NextAgent 自有 web channel 端点交互，RobotRouter endpoint 不出现在任何前端可达响应或 bootstrap projection 中。备选方案（a）把 RobotRouter 封装成一种 GUARDRAIL capability——被放弃，护栏是横切在 submit 路径与 hook 上的治理设施，不是模型可调用的工具；（b）在 submit/hook 内直连 HTTP client——被放弃，违反 gateway 治理；（c）让前端直连 RobotRouter guard 端点——被放弃，暴露 RobotRouter 给前端、绕过 NextAgent 后端治理且 endpoint 泄漏。

`GuardrailGatewayPort` 暴露两个稳定操作：

```ts
interface GuardrailGatewayPort {
  // submit guard proxy 转发：把 submit 请求体转发到 RobotRouter guard 端点，
  // 返回输入拒答 JSON 或放行结果；并接收 RobotRouter 的 output-guard-block 信号
  forwardGuardProxy(input: GuardProxyForwardInput): GuardProxyForwardResult;
  // nl2py 代码检查
  checkNl2Python(input: { content: string }): { status: boolean; errorMsg: string[] };
  readonly readiness: GatewayBindingReadiness;
}
```

port 只暴露稳定操作 + safe 诊断，不暴露 RobotRouter endpoint/credential/SDK 类型，不透传 RobotRouter 的 stream event。

### 决策 2：REMOTE-only，LOCAL 禁用

护栏只在 `deployment.mode: "REMOTE"` 下生效。LOCAL 下 startup 忽略 guardrail 配置块、不创建 binding、不转发、nl2py hook 不生效，并以 safe diagnostic 记录忽略原因，不 fail。LOCAL guardrail provider 仅作 testing stub 在测试 fixture 显式注入。运行时不在 LOCAL↔REMOTE 间回退（沿用 gateway-configuration 的静态选定规则）。这样 LOCAL 部署无外部依赖、无风控副作用，REMOTE 部署才挂载真实 RobotRouter。

### 决策 3：guard proxy 拓扑——NextAgent 始终拥有客户端流

```
Client ──submit──► NextAgent submit 路径 (submitStagedRequest, runtime.submit 之前)
                      │ (REMOTE + 护栏启用)
                      ▼
              GuardrailGatewayPort.forwardGuardProxy
                      ▼
              RobotRouter POST /api/v1/guard/sessions/{id}/requests
                      │ ① 输入校验
                      │   BLOCKED → 拒答 JSON → NextAgent 透传给 Client（不 runtime.submit）
                      │   PASS → 回调 NextAgent POST /api/v1/sessions/{id}/requests → runtime.submit
                      │ ② 输出校验：RobotRouter 作为 run 流观察者
                      ▼
              (命中) output-guard-block → guard-forward relay 注入 terminal OUTPUT_GUARD_BLOCKED
Client ◄──guard-forward relay（RobotRouter 流 → 共享 projection）── NextAgent
                      │   正常 → LLM_CONTENT_DELTA / TOOL_STRUCTURED_DELTA / REQUEST_COMPLETED
                      │   输出拦截 → OUTPUT_GUARD_BLOCKED (guard reason + refusalMessage) → 前端清本轮
```

关键不变量：**客户端流始终由 NextAgent 经 `RuntimeSessionPort.streamEvents` + 共享 projection service 投影**，RobotRouter 不直接产生或透传客户端可见 stream event。RobotRouter 回调的是 NextAgent 自有 submit 端点（触发 `runtime.submit`），canonical timeline 与 runtime status 仍由 NextAgent 拥有，RobotRouter 只做输入校验、回调放行、输出观察与 block 信号。这满足 `ts-web-sse-ws-transports` 的"transport 不拥有执行事实 / 复用共享 projection service"与 `core-contracts` 的"流只从 canonical timeline 或 runtime status 派生"不变量。

### 决策 4：输出护栏命中经 guard-forward relay 注入 terminal OUTPUT_GUARD_BLOCKED

输出护栏命中时，guard-forward relay 在客户端流注入 terminal `OUTPUT_GUARD_BLOCKED` stream event，payload 携带 guard reason 与 RobotRouter 的 `refusalMessage`；前端收到后只清空本轮已渲染内容替换拒答语。`OUTPUT_GUARD_BLOCKED` 之后禁止再投影增量内容事件。

这依赖 `refine-stream-guard-blocked-event`：该 refinement 把 `OUTPUT_GUARD_BLOCKED` 加入 `StreamEventType`，并为 guard-forward relay 路径开一个受控例外（允许 guard 层注入这一个 terminal 事件，其他事件仍从 canonical timeline/runtime status 派生）。本 change 不再走 `failRun`→run FAILED→`REQUEST_FAILED` 映射路线（该路线曾为绕开冻结词汇而设计，现因 refinement 放宽而撤除——`failRun` 契约/runtime 实现/测试已移除）。

取舍：refinement 放宽了两条治理规则（加事件 + relay 注入），但换来输出护栏的直观模型（拦截事件 → 前端清空），代码量远小于 failRun 链路，语义也直观（外部策略层拦截）。`OUTPUT_GUARD_BLOCKED` 不替代 runtime terminal commit 事实，run 的 canonical terminal 状态仍由 runtime 拥有。

### 决策 5：nl2py 在 python capability 路径内检查，不走 lifecycle hook

nl2py 代码护栏在 `python` capability 执行路径内、sandbox 提交前同步执行：`ToolDependencies.guardrail` 存在时，python capability 调 `GuardrailGatewayPort.checkNl2Python({content: code})`；`status=false` 时 python capability 不提交 sandbox，抛 `AgentError(NL2PY_GUARD_BLOCKED, error_msg)`，被 executor 转为结构化 capability 失败（`status="FAILED"`，safeError `NL2PY_GUARD_BLOCKED`）回灌 AgentLoop，模型据此改写代码重试（自纠正）；`status=true` 时放行至 sandbox 执行与后续 risk policy。`ToolDependencies.guardrail` 不存在（LOCAL/未启用）时跳过检查直接执行。

不走 lifecycle hook 的原因：`BEFORE_CAPABILITY_INVOKE` 的 `BLOCK` outcome 会使整轮 run FAILED（`submit.ts` 把非 PEND 的 interruption 转 `agentErrorFromLifecycleHookInterruption` → run FAILED），而非产出模型可见的工具失败，无法满足"模型自纠正"。在 capability 路径内返回结构化失败既能让模型自纠正、又不动 runtime。guardrail binding 经 composition 注入 `ToolDependencies.guardrail`（与 sandbox/rag 等 dep 同机制）。这与 `risk-policy-enforcement`"risk policy 不得注册为 lifecycle hook"不冲突——nl2py 是 capability 路径检查，不是 hook、不是 risk policy。

### 决策 6：fail-closed，开关即放行

护栏开关开启且 RobotRouter 不可用/超时/返回非法时 fail-closed：submit 转发失败→返回拒答或安全错误；nl2py→拦截 python 执行；记录 guardrail 专属降级审计事实（`HookInvocationEvent` status 或 guardrail audit event，**不复用 risk-policy 的 `DEGRADED` outcome 名**）。需要绕过护栏只能关闭 guardrail 开关，不在护栏开启时静默放行。这把"可配放行"收敛为单一开关，避免引入额外 fail-open 配置项，符合"配置层就是一个开关"的约束。

### 决策 7：被拦截轮次不进入下一轮 model context

因输入 BLOCKED 或 output-guard block（run `FAILED`）被拦截的轮次，其 assistant 响应不持久化为 model-visible 历史消息，下一轮 context assembly 不读取该轮 assistant 内容。实现上：被拦截轮次 assistant 响应以 `SessionMessageRecord.visible=false` 持久化（字段已存在），或写入带"不进 model context"标记的 safe 记录（只用于审计/前端展示）。前端清空只作用于本轮已渲染内容，历史轮次展示不动。需验证 context assembly 对 `visible=false` 的排除行为。这样避免被拦截的有害/部分内容污染后续模型上下文。

### 决策 8：拒答语由 RobotRouter 返回，NextAgent 只透传

拒答语（`refusalMessage`）由 RobotRouter 在输入拒答 JSON / output-guard-block 信号中返回，NextAgent 透传不改写、不配置、不生成（`REQUEST_FAILED` payload 中的 `refusalMessage` 即 RobotRouter 原文）。NextAgent 不持有拒答语配置，简化配置层为单一开关。

## 质量属性设计

- **安全**：guardrail 消费 raw content 做内容审核，与 risk policy 的 bounded 摘要边界隔离；拒答 payload 只含 RobotRouter 返回的 `refusalMessage`，不暴露 RobotRouter 内部规则或 raw 拦截细节；被拦截轮次不进 model context，避免有害内容污染后续上下文；effective config 不投影 credential/secret；前端不直连 RobotRouter。验证入口：guardrail-gateway 契约测试、fail-closed 测试、被拦截轮次不进 model context 测试、前端不直连测试、bootstrap 投影 safe 字段测试。
- **性能/容量**：guard proxy 在 REMOTE 下增加 submit 一跳（NextAgent→RobotRouter→NextAgent `runtime.submit`）；输出护栏由 RobotRouter 观察 run 流，NextAgent 不做内容扫描，无额外 CPU 开销；命中时 run `FAILED` 走既有失败路径。超时即按 fail-closed 处理。验证入口：guard-forward submit 延迟测试。
- **可靠性/恢复**：fail-closed 保证 RobotRouter 故障时不放行风险内容；guard-forward 不改变 RequestRun status / terminal commit / latest-request 语义（输出拦截经 run `FAILED` → `REQUEST_FAILED`，属既有失败路径）。LOCAL 部署完全不受 RobotRouter 故障影响。验证入口：RobotRouter 故障 fail-closed 测试。
- **可维护性**：guardrail 走标准 gateway adapter 机制，与现有 adapter 一致；nl2py 走标准 SYSTEM hook 机制；客户端流路径不变；无新机制引入。验证入口：架构 lint（dependency-cruiser）确保无模块直连 RobotRouter。
- **可测试性**：LOCAL testing stub provider 供单元/契约测试；guard proxy 拓扑可用 stub 模拟 RobotRouter 回调与 output-guard-block 信号。验证入口：stub-based e2e。
- **审计/可追溯**：fail-closed 记录 guardrail 专属降级审计事实（不复用 risk-policy `DEGRADED`）；nl2py hook 产生 `HookInvocationEvent`；输出拦截经 run `FAILED` → `REQUEST_FAILED` 作为 terminal 事实可观测；被拦截轮次保留 `visible=false`/safe 标记用于审计。不记录 raw content（raw 在 RobotRouter 侧，NextAgent 只记录 reason code / safe 摘要）。验证入口：审计事实测试。

## 验证映射

| 关键约束 | 验证入口 |
|---|---|
| 所有 RobotRouter 调用经 GuardrailGatewayPort | guardrail-gateway 契约测试 + dependency-cruiser 禁止直连 |
| 前端不直连 RobotRouter | 前端 bundle/bootstrap 断言无 RobotRouter endpoint |
| LOCAL 禁用护栏 | startup 测试：LOCAL 下 `GatewayBindings.guardrail` undefined、不转发、hook 不生效 |
| 客户端流仍经 RuntimeSessionPort | guard-forward 测试断言客户端流来自 `RuntimeSessionPort.streamEvents`，RobotRouter 不产出客户端事件 |
| 输入 BLOCKED 不 runtime.submit | guard-forward 契约测试（断言 `runtime.submit` 未调用） |
| 输出拦截 → run FAILED → REQUEST_FAILED（无新事件） | 投影测试断言 terminal 为 `REQUEST_FAILED`、无 `OUTPUT_GUARD_BLOCKED` |
| 被拦截轮次不进下一轮 model context | context assembly / session store 测试（`visible=false` 排除） |
| nl2py BLOCKED 回灌工具错误 | nl2py hook 自纠正测试 |
| fail-closed（开关开启时） | RobotRouter 故障测试 |
| bootstrap 投影开关状态 | bootstrap 投影测试 |

## 文档承载决策

- 行为契约：`openspec/specs/guardrail-gateway/spec.md`（主）、`gateway-configuration/spec.md`、`ts-web-sse-ws-transports/spec.md`。
- 架构/跨模块设计：`openspec/designs/architecture/guardrail-flow.md`（guard proxy 拓扑、客户端流归属、output-guard block → run FAILED → REQUEST_FAILED、hook 与 risk policy 共存、fail 语义、被拦截轮次历史隔离）。
- 模块设计：`openspec/designs/modules/guardrail-gateway.md`、`openspec/designs/modules/web-channel-guard-forward.md`。
- ADR：`openspec/designs/adr/`（fail-closed 默认、guardrail 与 risk policy 分离、不新增 stream event 复用 REQUEST_FAILED、guard proxy 回调拓扑、REMOTE-only）。
- 导航：`openspec/designs/spec-to-design-map.md`。

## 风险与取舍

- [RobotRouter 单点] → REMOTE 下 RobotRouter 故障即护栏失效；fail-closed 保证不放行风险内容，可用性由关闭 guardrail 开关承担。
- [guard proxy 增加 submit 一跳延迟] → 仅 REMOTE 启用护栏时；接受该延迟换取统一内容审核。
- [输出拦截前已推送内容] → 前端识别 `REQUEST_FAILED` guard reason 后只清本轮已渲染内容替换拒答语，历史轮次不动；不回撤已发出的网络包（前端层清空）。
- [被拦截轮次历史一致性] → `visible=false` 或带标记 safe 记录；需验证 context assembly 排除 `visible=false`。
- [契约漂移] → `core-contracts.md` 冻结的 `StreamEventType` 列表与 `channel/index.ts` 现状已存在漂移（代码含 `BACKGROUND_TASK_*` 等未列事件）；记为 repo governance drift，本 change 不加重漂移（不改 `StreamEventType`），建议后续 contract refinement 一并收敛。

## 迁移计划

- 新增 adapter/hook/config，默认 REMOTE 未配置护栏时行为与现状完全一致（不转发、hook 不生效）。
- 部署 REMOTE + 启用护栏：在 REMOTE gateway provider entry 配置 RobotRouter endpoint、开启 guardrail 开关；启动后 readiness 校验 guardrail binding。
- 回滚：移除 guardrail 配置块即回退到直连 `runtime.submit` 行为，无数据迁移。

## 归档前更新基线（Baseline Promotion Plan）

- `specs/guardrail-gateway/spec.md`：新建。
- `specs/gateway-configuration/spec.md`、`specs/ts-web-sse-ws-transports/spec.md`：合并 delta。
- `overview.md`：补充护栏集成背景。
- `designs/architecture/guardrail-flow.md`：跨模块流程与边界。
- `designs/modules/guardrail-gateway.md`、`web-channel-guard-forward.md`：模块设计。
- `designs/adr/`：五项决策。
- `designs/spec-to-design-map.md`：导航。

## 待确认问题

- ~~RobotRouter guard proxy 是否需携带 owner/tenant 上下文~~ → 已定：NextAgent 仅转发 `sessionId` + submit 请求体，不额外注入 owner/tenant；owner scope 始终由 NextAgent 持有，RobotRouter 只做内容审核。若未来 RobotRouter 需多租户风控，再以独立 change 补充（不传 raw credential）。
- ~~输出拦截是否需 timeline-only 审计证据~~ → 已定：输出拦截经 run `FAILED` → `REQUEST_FAILED`（runtime-status 派生），terminal 事实可观测；nl2py 经 `HookInvocationEvent`；无需新增 `POLICY_APPLIED` 或新 `TimelineEventType`。
