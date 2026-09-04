## 背景与问题（Why）

NextAgent 作为电信网络智能体平台，向用户开放自然语言交互与代码生成（nl2py）能力，存在三类内容安全风险：

- **输入侧**：用户 prompt 包含违规内容、注入攻击或越权意图；
- **输出侧**：模型流式生成违规、敏感或越界内容；
- **代码生成侧**：nl2py 生成的 Python 代码包含危险导入（如 `email`）、越权网络/文件操作等。

现有治理基线无法覆盖这些风险：

- `risk-policy-enforcement` 明确只消费 trusted/bounded 摘要，**禁止消费 raw prompt / raw model output / raw tool args**，因此无法承担内容审核职责；
- `lifecycle-hook-execution` 已提供 `BEFORE_CAPABILITY_INVOKE` 的 `CONTROL` hook 机制，但当前没有任何具体护栏 hook 实例；
- `gateway-configuration` 的稳定 adapter 集合（working-memory / long-term-memory / sqlite / sandbox / scheduled-maintenance / cron-tasks / rag-knowledge / skillhub / workflow-execution）不含任何护栏 adapter，外部内容护栏服务只能被直连 HTTP 调用，无法受 gateway 的 composition / 配置 / LOCAL-REMOTE 一致性 / 故障语义治理。

产品侧引入 **RobotRouter IR** 作为统一内容护栏服务，提供两类能力：作为 guard proxy 代理输入检测并观察输出；提供 nl2py 代码检查内部端点。本 change 使 NextAgent 以受治理方式接入 RobotRouter IR：所有对 RobotRouter 的调用必须走 gateway（可组合、可配置、LOCAL/REMOTE 一致、不直连 HTTP），护栏开关可配置，RobotRouter 故障时默认 fail-closed。

**Roadmap 对齐**：本 change 承接 roadmap P4 candidate `add-ts-safety-guardrails`（"安全护栏 gateway port，对接外部安全检测 API，输入/输出检查点，enable/disable 配置和 audit 记录"），作为其实现 change。与 workflow interaction node `guardrail_check`（`add-ts-workflow-interaction-nodes`）是不同层面的能力——本 change 只定义 gateway 层内容护栏，不涉及 workflow 节点。本 change 依赖 `refine-stream-guard-blocked-event`：输出护栏命中经 guard-forward relay 注入 terminal `OUTPUT_GUARD_BLOCKED` stream event（该 refinement 放宽冻结词汇 + relay 注入例外），前端收到后清空本轮；不再走 `failRun`/run FAILED/`REQUEST_FAILED` 路线。

## 变更范围（What Changes）

### 护栏网关（guardrail gateway）

- 新增 gateway adapter kind `guardrail` 与 `GuardrailGatewayPort`，作为所有 RobotRouter 调用的唯一受治理出口。
- **RobotRouter 护栏接口只能由 NextAgent 后端经 `GuardrailGatewayPort` 调用；前端/客户端绝不直连 RobotRouter**，只与 NextAgent 自有 web channel 端点交互，护栏转发在后端 request accept 边界内部透明完成。RobotRouter endpoint 不出现在任何前端可达响应或 bootstrap projection 中。
- REMOTE provider = RobotRouter IR；LOCAL provider = testing stub（仅供单元/契约测试，不承载真实风控）。
- `gateway-configuration` 稳定 adapter 选择集合新增 `guardrail`；`GatewayBindings` 新增 `guardrail?: GuardrailGatewayPort`；startup validation 与 registry resolve 覆盖 guardrail entry（遵守现有 LOCAL/REMOTE 静态选定、运行时不回退规则）。
- **部署模式约束**：安全护栏只在 `deployment.mode: "REMOTE"` 下可配置启动；`deployment.mode: "LOCAL"` 下护栏始终不启动。LOCAL 运行时即使配置了 guardrail 块，startup 也 MUST 将其视为禁用（不创建 guard binding、不转发、nl2py hook 不生效），并以 safe diagnostic 记录忽略原因；LOCAL testing stub 仅在测试 fixture 中显式注入时生效，不作为 LOCAL 产品运行时的护栏来源。

### 输入/输出护栏（guard proxy 转发 + 输出观察）

- Web channel 的 submit 路径（`POST /api/v1/sessions/:sessionId/requests`，鉴权 + 路由之后、`runtime.submit` 之前）在启用护栏时，把原本要交给 runtime 的 submit 请求经 `GuardrailGatewayPort` 转发到 RobotRouter `POST /api/v1/guard/sessions/{sessionId}/requests`，由 RobotRouter 做输入校验。调用 RobotRouter 的发起方始终是 NextAgent 后端。
- RobotRouter 完成输入校验后回调 NextAgent 既有 `POST /api/v1/sessions/{sessionId}/requests` 触发 `runtime.submit` 执行 Agent。**客户端流始终由 NextAgent 经 `RuntimeSessionPort.streamEvents` 与共享 projection service 拥有**，RobotRouter 不直接产生或透传客户端可见 stream event。
- 输出校验由 RobotRouter 作为 run 流的观察者进行；命中风控时 guard-forward relay 在客户端流注入 terminal `OUTPUT_GUARD_BLOCKED` stream event（依 `refine-stream-guard-blocked-event`），payload 携带 guard reason 与 RobotRouter `refusalMessage`；前端收到后只清空本轮已渲染内容并替换拒答语（历史轮次展示不受影响）。本 change 不再使用 `failRun`/run FAILED/`REQUEST_FAILED` 路线（已撤除）。
- **被拦截轮 assistant 消息隔离（race-free hide）**：为保证"被拦截轮次不可见"，NextAgent 在输出护栏命中时把该 run 的 assistant 终态消息以 `visible=false` 持久化，使其不进入下一轮 model context。机制：`RuntimeCommandPort.hideRunMessages` 在 run 标记为 guard-blocked 时隐藏其 assistant 消息（`VisibilityReason="GUARD_BLOCKED`）；`TerminalCommitOptions.guardBlocked` 让终态提交时直接以 `visible=false` 落库。race-free 主路径：guard 服务在**检测时**（模型生成中、终态提交前）回调 NextAgent 内部端点 `POST /api/v1/sessions/:sessionId/runs/:runId/guard-blocked` 触发 `hideRunMessages` 置标志；web channel 在客户端流投递 `OUTPUT_GUARD_BLOCKED` 时也触发 `hideRunMessages` 作为通用兜底（适用于不回调的 guard 服务）。`guardBlocked` 标志为内存态，post-commit 的 `hideMessage` 兜底覆盖已提交情形。
- 输入校验不通过时，RobotRouter 直接返回拒答 JSON（`status=BLOCKED` / `phase=INPUT_GUARD` / `reason` / `refusalMessage` / `sessionId`），NextAgent 不调用 `runtime.submit`，把 RobotRouter 返回的拒答响应透传给客户端。
- 拒答语（`refusalMessage`）由 RobotRouter 返回，NextAgent 只透传，不自行生成、不改写、不配置。
- **被拦截轮次不可见**：因输入 BLOCKED（不调用 `runtime.submit`）或 output-guard block（run 正常终态提交但 assistant 终态消息 `visible=false`）被拦截的轮次，其 assistant 响应 MUST NOT 持久化为 model-visible 历史消息，下一轮组装 model context 时 MUST NOT 看到该轮 assistant 内容；可保留不进入 model context 的 safe 标记（复用 `SessionMessageRecord.visible=false`）用于审计/前端展示。输入拦截轮虽不进后端持久化，但前端 MUST 展示其用户输入与拒答语并在页面刷新后仍可见（前端侧持久化，不进 model context）。

### nl2py 代码护栏（python capability 路径检查）

- nl2py 检查在 `python` capability 执行路径内、sandbox 提交前同步执行（不走 lifecycle hook——`BEFORE_CAPABILITY_INVOKE` 的 `BLOCK` 会使整轮 run 失败而非产出模型可见的工具失败，无法满足"模型自纠正"）。
- `ToolDependencies.guardrail` 存在时，python capability 经 `GuardrailGatewayPort.checkNl2Python` 调用 RobotRouter 内部端点 `POST /rest/naie/guardrail/v1/application-sec/check`，body 为 `{"type":"nl2py","content":"<python 代码>"}`，响应为 `{"status": boolean, "error_msg": string[]}`。
- `status=false`（BLOCKED）时 python capability 不提交 sandbox，返回结构化 capability 失败（`status="FAILED"`，safeError `NL2PY_GUARD_BLOCKED`，message 含 `error_msg`）回灌 AgentLoop 供模型自纠正；`status=true`（PASS）时放行至 sandbox 执行与后续 risk policy。`ToolDependencies.guardrail` 不存在（LOCAL/未启用）时跳过检查直接执行。

### 配置与故障语义

- 配置层只是一个开关：per-agent config 暴露单个 guardrail enable 开关（仅在 REMOTE 部署下生效），控制是否启用 guard proxy 转发与 nl2py hook。RobotRouter endpoint 由 REMOTE gateway provider selection entry 提供，不进 per-agent config；拒答语由 RobotRouter 返回，不由 NextAgent 配置。LOCAL 部署下开关被 startup 忽略且不生效。
- **fail-closed**：护栏开关开启且 RobotRouter 不可用 / 超时 / 返回非法时，ER 转发失败 → 返回拒答或安全错误，nl2py → 拦截 python 执行，并记录 guardrail 专属降级审计事实（不复用 risk-policy 的 `DEGRADED` outcome 名）；需要绕过护栏只能通过关闭开关实现，不在护栏开启时静默放行。
- guardrail 与 risk policy 是两套独立机制，在 `BEFORE_CAPABILITY_INVOKE` 共存：guardrail hook 先做内容/代码检查，risk policy 随后做 trusted identity / capability 授权 / sandbox 边界治理。本 change **不修改** `risk-policy-enforcement` 行为契约。

## Capability 影响（Capabilities）

### 新增 Capability

- `guardrail-gateway`: `GuardrailGatewayPort` 契约、`guardrail` adapter kind、REMOTE/LOCAL provider binding、护栏单开关与 effective config、fail-closed 故障语义、被拦截轮次不进 model context、对 RobotRouter guard proxy 转发与 nl2py check 的统一调用边界。

### 修改的 Capability

- `gateway-configuration`: 稳定 adapter 选择集合新增 `guardrail`；`GatewayBindings` 新增 `guardrail?: GuardrailGatewayPort`；startup validation 与 registry resolve 规则覆盖 guardrail entry；新增“guardrail 仅在 REMOTE 部署下生效、LOCAL 始终禁用”的部署模式约束。
- `ts-web-sse-ws-transports`: submit 路径 guard-forward 不绕过共享 stream path（客户端流仍经 `RuntimeSessionPort.streamEvents` + 共享 projection service），以及 output-guard block 投影为既有 `REQUEST_FAILED`（run `FAILED`，不新增 stream event）并只清空本轮已渲染内容的 terminal 行为；与现有“transport 不拥有执行事实 / 复用共享 projection service / 流只从 canonical timeline 或 runtime status 派生”规则一致。

## 影响范围（Impact）

- **代码**：
  - `packages/agent-contracts/src/gateway/`：新增 `GuardrailGatewayPort`、`guardrail` adapter kind、`GatewayBindings.guardrail?`、guardrail config 契约（owning subpath `agent-contracts/gateway`）。`agent-contracts/src/channel/index.ts` 的 `StreamEventType` 不变。
  - `packages/agent-platform-gateway-remote/`：新增 RobotRouter REMOTE guardrail provider（submit guard proxy 转发 + output-guard-block 信号接收 + nl2py check）。
  - `packages/agent-platform-gateway-local/`：新增 LOCAL testing stub provider。
  - `packages/agent-channel-web/src/routes/requests.ts`（submit 路径 `submitStagedRequest`→`runtime.submit` 之前）：guard-forward 转发决策；客户端流仍经 `RuntimeSessionPort.streamEvents` + 共享 projection（`projections/stream-envelope.ts`、`transports/web-stream-delivery.ts`），不新增 stream event；output-guard block → run `FAILED` → `REQUEST_FAILED` 投影；被拦截轮次不进入 model-visible 历史的处理。
  - `agent-core` / hook 组装：新增 nl2py `BEFORE_CAPABILITY_INVOKE` SYSTEM hook。
  - session message store / context assembly：被拦截轮次的 assistant 响应不持久化为 model-visible 历史（复用 `SessionMessageRecord.visible=false`）、不进入后续轮次 model context。
  - 前端：识别 `REQUEST_FAILED` 的 guard reason 后只清空本轮已渲染内容替换拒答。
- **API**：客户端入口在护栏启用时改走 guard proxy 转发路径；NextAgent 既有 `POST /api/v1/sessions/{sessionId}/requests` 供 RobotRouter 回调（沿用既有端点安全，不新增回路鉴权）。
- **配置**：`agents/{agentId}/config/config.json` 新增 guardrail 单开关；`/api/v1/runtime/bootstrap` 投影 effective guardrail 开关状态。
- **依赖**：新增对 RobotRouter IR 的运行时依赖（REMOTE）；LOCAL 模式无外部依赖。
- **测试**：guardrail gateway 契约测试、submit guard-forward 测试、客户端流仍经 RuntimeSessionPort 测试、output-guard block → `REQUEST_FAILED` 投影测试、被拦截轮次不进下一轮 model context 测试、nl2py hook 自纠正测试、fail-closed 故障测试、LOCAL stub e2e。
- **运维**：RobotRouter endpoint（REMOTE gateway provider entry）需纳入部署配置与 readiness。

## 归档前更新基线（Baseline Promotion Plan）

归档前需将长期有效内容提炼到长期基线：

- `openspec/specs/guardrail-gateway/spec.md`：新建，承载 GuardrailGatewayPort 契约、adapter kind、配置开关、fail 策略、被拦截轮次历史隔离等可验证行为契约。
- `openspec/specs/gateway-configuration/spec.md`：合并 `guardrail` adapter kind、`GatewayBindings.guardrail`、startup validation/registry 相关 requirement 变更。
- `openspec/specs/ts-web-sse-ws-transports/spec.md`：合并 submit guard-forward 不绕过共享 stream path、output-guard block 投影为既有 `REQUEST_FAILED` 的 requirement。
- `openspec/overview.md`：补充 RobotRouter 护栏集成背景与产品范围。
- `openspec/designs/architecture/<guardrail-flow>.md`：跨模块护栏流程（submit→RobotRouter guard proxy→NextAgent 回调 `runtime.submit`→客户端流经 RuntimeSessionPort；output-guard block→run FAILED→REQUEST_FAILED；nl2py hook 流程）、guardrail 与 risk policy 的职责边界、安全边界、数据 ownership、可观测、fail 语义。
- `openspec/designs/modules/<guardrail-gateway>.md` 与 `<web-channel-guard-forward>.md`：模块职责、非职责、依赖、public contract 消费关系、核心设计落点。
- `openspec/designs/adr/`：fail-closed 默认决策、guardrail 与 risk policy 分离决策、guard proxy 回调拓扑决策。
- `openspec/designs/spec-to-design-map.md`：新增 guardrail-gateway 等 capability 到 design 的导航。
