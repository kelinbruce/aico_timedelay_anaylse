## 1. 契约层（agent-contracts）

- [x] 1.1 在 `packages/agent-contracts/src/gateway/index.ts` 的 `GatewayAdapterKind` 新增 `"guardrail"`，并在 `GatewayBindings` 新增 `readonly guardrail?: GuardrailGatewayPort`。验证：`npm run build` + 新增类型导出单测。来源：spec `gateway-configuration` MODIFIED "Validation follows deterministic rule order"、ADDED "GatewayBindings exposes an optional guardrail port"。
- [x] 1.2 新增 `GuardrailGatewayPort`、`GuardProxyForwardInput`、`GuardProxyForwardResult`、`GuardrailCheckNl2PythonInput/Result`、guardrail 单开关 config 契约类型（owning subpath `agent-contracts/gateway`）。验证：类型导出单测 + `npm run lint:architecture`。来源：spec `guardrail-gateway` "GuardrailGatewayPort is the sole governed egress"、"Guardrail is controlled by a single enable switch"。
- [x] 1.3 经 `refine-stream-guard-blocked-event` 在 `agent-contracts/src/channel/index.ts` 的 `StreamEventType` 新增 `"OUTPUT_GUARD_BLOCKED"`（terminal 事件）。验证：`tsc -b` + contract 测试枚举断言。来源：`refine-stream-guard-blocked-event`、spec `ts-core-contracts` "Guard-forward relay output-guard terminal event"。

## 2. Guardrail Gateway Provider

- [x] 2.1 在 `packages/agent-platform-gateway-remote/` 新增 RobotRouter REMOTE guardrail provider，实现 `GuardrailGatewayPort`：`forwardGuardProxy`（转发 submit 到 `POST /api/v1/guard/sessions/{sessionId}/requests`，返回 RobotRouter 的输入拒答 JSON 或回调放行结果，并接收 RobotRouter 的 output-guard-block 信号）、`checkNl2Python`（调 `POST /rest/naie/guardrail/v1/application-sec/check`）、`supportedAdapterKinds` 含 `guardrail`。验证：provider 契约测试（mock RobotRouter）。来源：spec `guardrail-gateway` "sole governed egress"、"Input guard is enforced by RobotRouter guard proxy at request submit"、"nl2py guard hook checks python capability"。
- [x] 2.2 在 `packages/agent-platform-gateway-local/` 新增 LOCAL guardrail testing stub provider，仅供测试 fixture 注入，不进入 LOCAL 产品运行时 composition。验证：stub 契约测试。来源：spec `guardrail-gateway` "Guardrail is effective only in REMOTE deployment"、design 决策 2。
- [x] 2.3 在 gateway registry/composition 中支持 resolve `guardrail` entry：仅 `deployment.mode: "REMOTE"` 下创建 binding；LOCAL 下忽略 selected guardrail entry 并输出 safe diagnostic，不创建 binding、不 fail。验证：startup resolve 测试（REMOTE 创建 binding、LOCAL 忽略）。来源：spec `guardrail-gateway` "Guardrail is effective only in REMOTE deployment"、`gateway-configuration` "Guardrail selected in LOCAL is disabled"。

## 3. Submit 路径 Guard-Forward 与输出护栏

- [x] 3.1 在 web channel submit 路径（`routes/requests.ts` 的 `POST /api/v1/sessions/:sessionId/requests`，进入 `submitStagedRequest`→`runtime.submit` 之前）增加护栏转发决策：REMOTE 且启用护栏时经 `GuardrailGatewayPort.forwardGuardProxy` 转发 submit 到 RobotRouter guard proxy，否则保持既有直连 `runtime.submit` 行为。验证：guard-forward 决策测试（启用转发 / 未启用直连）。来源：spec `ts-web-sse-ws-transports` "Guard-forward at submit does not bypass the shared stream path"、"Disabled guardrail keeps direct dispatch"。
- [x] 3.2 保证客户端流仍由 NextAgent 拥有：guard-forward 只作用于 submit 转发，客户端流始终经 `RuntimeSessionPort.streamEvents` 与共享 projection service（`projections/stream-envelope.ts`、`transports/web-stream-delivery.ts`）投影，不在 transport 层维护私有映射表或私有 terminal 状态，不由 RobotRouter 产生客户端 stream event。验证：negative verification——断言客户端流来自 `RuntimeSessionPort.streamEvents`，RobotRouter 不直接产出客户端可见事件。来源：spec `ts-web-sse-ws-transports` "Guard-forward keeps the client stream on RuntimeSessionPort"。
- [x] 3.3 实现输入 BLOCKED 处理：RobotRouter 返回 `BLOCKED`/`INPUT_GUARD` 拒答 JSON 时，不调用 `runtime.submit`，直接把拒答返回客户端。验证：negative verification——输入 BLOCKED 时不调用 `runtime.submit`（断言未被调用）。来源：spec `guardrail-gateway` "Input guard blocked refuses without dispatching agent"。
- [x] 3.4 实现 output-guard-block → guard-forward relay 注入 terminal `OUTPUT_GUARD_BLOCKED`：channel 层（guard-forward relay）收到 RobotRouter 的 output-guard-block 信号时，在客户端流投影 terminal `OUTPUT_GUARD_BLOCKED`（payload 携带 guard reason + refusalMessage），其后禁止投影增量内容事件、不推送已缓冲原文。验证：negative verification——terminal 为 `OUTPUT_GUARD_BLOCKED`、其后无增量事件、无缓冲原文泄漏、拒答语与 RobotRouter 返回一致、前端只清本轮。来源：spec `ts-web-sse-ws-transports` "Output-guard block projects terminal OUTPUT_GUARD_BLOCKED via the relay"、"does not leak buffered output"、`refine-stream-guard-blocked-event`。
- [x] 3.5 实现被拦截轮次历史隔离：因输入 BLOCKED 或 output-guard block（run FAILED）被拦截的轮次，其 assistant 响应不持久化为 model-visible 历史消息（复用 `SessionMessageRecord.visible=false`，或写入带"不进 model context"标记的 safe 记录），下一轮 context assembly 不读取该轮 assistant 内容。验证：negative verification——触发输出拦截后，下一轮组装的 model context 断言不包含被拦截轮次 assistant 原文/增量；`visible=false`/safe 标记存在但不进 model context。来源：spec `guardrail-gateway` "A blocked round is excluded from model-visible history"、design 决策 7。

## 4. nl2py Guard（python capability 路径）

- [x] 4.1 `ToolDependencies` 新增 `guardrail?: GuardrailGatewayPort`（`tool-spi.ts`）。验证：`tsc -b`。来源：spec `guardrail-gateway` "nl2py guard checks python code in the python capability path"。
- [x] 4.2 `python-tool.ts` 在 sandbox 提交前调 `checkNl2Python`：`status=false` 抛 `AgentError(NL2PY_GUARD_BLOCKED, error_msg)` → executor 转为 `status="FAILED"` 结构化失败回灌 AgentLoop（模型自纠正）；`status=true` 放行；无 guardrail dep 跳过。验证：`python-capability.test.ts` 3 测试（BLOCK→FAILED+runPython 未调 / PASS→SUCCEEDED / 无 dep→SUCCEEDED）。来源：spec `guardrail-gateway` "Blocked nl2py returns a model-visible tool failure"、"Passed nl2py forwards to sandbox execution"、"nl2py check is skipped when no guardrail dependency is present"。
- [x] 4.3 composition 接线：`composeCapabilityLayer` 接收 `guardrail?` → `toolDependencies.guardrail`；`create-app.ts` 传 `gatewayBindings?.guardrail`。验证：`tsc -b` + 277 契约 + 11 python 测试。来源：design 决策 5。
- [x] 4.4 nl2py 只对 python capability 生效（检查写在 python-tool 内，其他 capability 不受影响）。验证：non-python capability 不经该路径（架构上自然成立）。来源：spec `guardrail-gateway` "Non-python capability is not affected by nl2py"。

## 5. 配置与 Bootstrap

- [x] 5.1 在 per-agent config schema 新增 guardrail 单开关（enable），LOCAL 下被 startup 忽略；RobotRouter endpoint 由 REMOTE gateway provider selection entry 提供，不进 per-agent config。验证：config schema 校验测试（开关有效、LOCAL 忽略）。来源：spec `guardrail-gateway` "Guardrail is controlled by a single enable switch"、"Guardrail switch is ignored in LOCAL"。
- [x] 5.2 扩展 `/api/v1/runtime/bootstrap` 投影 effective guardrail 开关状态，不投影 credential/secret/deployment-private 字段。验证：negative verification——bootstrap 响应不含 credential/secret。来源：spec `guardrail-gateway` "Bootstrap projects guardrail switch state"。

## 6. Fail 策略

- [x] 6.1 实现护栏开启时 fail-closed：RobotRouter 不可用/超时/返回非法时，ER 转发返回拒答或安全错误、nl2py 拦截 python、记录 guardrail 专属降级审计事实（`HookInvocationEvent` status 或 guardrail audit event，不复用 risk-policy 的 `DEGRADED` outcome 名）。验证：negative verification——护栏开启且触发 RobotRouter 超时/非法响应时断言不放行（ER 不 dispatch、python 不执行）。来源：spec `guardrail-gateway` "Guardrail fails closed when RobotRouter is unavailable"、"RobotRouter unavailable blocks when guardrail is on"。
- [x] 6.2 实现关闭开关即放行：关闭 guardrail 开关时跳过 guard proxy 直连 Agent、nl2py hook 不触发；护栏开启时不静默放行。验证：negative verification——护栏开启时 RobotRouter 故障不放行；关闭开关时放行且不调 RobotRouter。来源：spec `guardrail-gateway` "Disabling the switch is the only way to bypass"。

## 7. 前端

- [x] 7.1 前端识别 terminal `OUTPUT_GUARD_BLOCKED` 事件后只清空本轮已渲染内容（不影响历史轮次）并替换为 RobotRouter 返回的拒答语（`buildAnswerContent`/`resolveGuardBlockedRefusal`）；`TurnBlock` 显示 `GuardBlockedNotice` 徽标；输入拦截轮经 `sessionStorage` 持久化使刷新后仍展示。验证：前端 answerContent 单测 + 全栈 e2e（输出拦截清空+拒答、输入拦截刷新持久化、追问隔离）。来源：spec `ts-web-sse-ws-transports` "Output-guard block projects terminal OUTPUT_GUARD_BLOCKED via the relay"、`guardrail-gateway` "Input-blocked round is displayed and survives page refresh"。

## 8. 集成与架构守卫

- [x] 8.1 dependency-cruiser 规则：禁止除 guardrail gateway provider 外的模块直连 RobotRouter 端点 / new HTTP client 指向 RobotRouter。验证：`npm run lint:architecture`（含 negative case 触发违规报错）。来源：spec `guardrail-gateway` "sole governed egress"。
- [x] 8.2 前端不直连 RobotRouter：确认前端只调用 NextAgent 自有 web channel 端点，RobotRouter endpoint 不出现在 bootstrap projection 或任何前端可达响应中。验证：negative verification——grep/契约测试断言前端 bundle 与 bootstrap 响应不含 RobotRouter endpoint；前端代码无对 guard proxy / nl2py check 端点的调用。来源：spec `guardrail-gateway` "Frontend never calls RobotRouter directly"。
- [x] 8.3 LOCAL stub e2e：用 LOCAL stub 模拟 RobotRouter 完整 guard proxy + nl2py 流程。验证：`npm run test:smoke` + 专项 e2e。来源：design 验证映射。
- [x] 8.4 `openspec validate "add-ts-safety-guardrails" --strict` 通过。验证：命令直接执行。来源：OpenSpec 规范。

## 9. 归档前更新基线检查（非实施任务）

归档前依据 proposal/design 的"归档前更新基线"执行：更新 `specs/guardrail-gateway`（新建）、`specs/gateway-configuration`、`specs/ts-web-sse-ws-transports`、`overview.md`、`designs/architecture/guardrail-flow.md`、`designs/modules/guardrail-gateway.md` + `web-channel-guard-forward.md`、`designs/adr/`、`designs/spec-to-design-map.md`。本节不作为普通 checkbox 实现任务，由归档前流程执行。
