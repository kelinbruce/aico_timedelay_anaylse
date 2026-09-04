# 范围边界设计

## 目标

本分册定义最小内核的 `real`、`minimal`、`noop` 和 `deferred` 范围，防止实现阶段因为模块引用或便利性递归补齐配件能力。

总原则：Web submit/session route -> runtime session/request facade -> runtime-owned Agent Scope resolution -> agent-session -> runtime -> Agent core -> context -> model -> enabled capability invocation（当前产品只暴露 read）-> follow-up model -> timeline/SSE -> terminal commit -> history 主流程实际经过的路径必须满足本 change 对应的可验收规格；不在该主流程路径上的能力不得半实现，只能按 no-op、disabled descriptor 或 unavailable safe outcome 处理。若一个接口在主流程中只作为保留调用点存在但不决定问答结果、终态事实或安全边界，例如默认 hook/checkpoint/audit provider，本 change 只允许 no-op provider，并用 spy/sink 验证调用和无副作用。

## 范围级别

| 级别 | 处理规则 | 本 change 中的对象 |
|---|---|---|
| `real` | 主流程实际经过且不实现就不能完成问答或会破坏终态一致性，必须按本 change 的 spec、接口矩阵和验证项实现。 | `agent-app`、`agent-channel-web` confirmed route table/convenience submit/SSE/history、`agent-runtime` session/request facade、runtime-owned Agent Scope resolution、lifecycle/single-run dispatcher/timeline/terminal commit、同 owner+agent+session active-run conflict guard、`agent-core` Agent loop、`agent-model` OpenAI provider path、输出 no-silent-truncation guard、内部 cancellation propagation |
| `minimal` | 主流程实际经过但只需首个可用切片即可成立，必须按本 change 对该切片列出的 schema、port、state 和测试实现。 | `agent-session` `UserSessionPort`、message/history/cursor conversation/current-run tool state reconstruction、`agent-context-engine` minimal assembly/render、默认 prompt/profile、window/budget guard、locale/language hint、电信术语原文保留指令、`agent-capability` 通用 invocation 形态下的 read tool、gateway ports |
| `noop` | 主流程必须调用，但不影响一次问答成立；默认实现不产生真实副作用。 | lifecycle hook、checkpoint save、audit writer |
| `deferred` | 不属于主问答链路的一层直接依赖；不得进入产品路径。 | attachment、memory、多工具、多 Skill source、WebSocket、完整 cancel/retry/edit、多实例 recovery、terminal retry/takeover、远端 Agent、多 provider fallback、完整 glossary/语言检测/双语评测集、容量/SLA benchmark；output continuation flow 不属于本 change |

## Real 范围

### `agent-runtime`

必须真实实现：

- submit acceptance。
- session facade 和 request admission 的 trusted Agent Scope resolution；resolver 是 runtime 内部实现，不进入 `agent-contracts`。
- 通过 `agent-session` `UserSessionPort` 创建、校验、列出和读取 owner+agent scoped session。
- assembly active/require binding。
- RequestRun 创建和状态推进。
- single-run dispatcher/scheduler：只调度已持久化、assembly 已固化且未进入 terminal 的 accepted run，启动前使用 `RequestRunRecord + { expectedVersion }` 将同一 run 从 `ACCEPTED` CAS 推进到 `EXECUTING`；CAS 未更新时不得调用 Agent；成功启动后向 Agent 传入 runtime-owned signal，并把 resolve/reject 归一化到 terminal path。
- 同一 owner+agent+session 最多一个 active RequestRun；已有 active run 时，新 submit 返回 safe conflict/rejection，不创建 queued run，不引入 FIFO lane、scheduler queue、replacement 或 terminal-pending dispatch protection。
- runtime-owned timeline canonicalization。
- Agent execution 调度。
- terminal commit。
- 输出大小/长度 guard；除 read bounded slice 外，硬上限命中统一发布 `DEGRADATION_NOTICE` 并以 safe `REQUEST_FAILED` 结束。
- SafeError failure path。
- 内部 cancellation propagation；只覆盖 runtime、core、model、capability 和 stream delivery 慢边界接收/传播 cancellation context 和内部 abort safe normalization。gateway-local SQLite local atomic persistence transaction cancellation deferred。

不得实现：

- 完整 cancel/retry/edit 用户能力。
- cancel route、cancel runtime command、持久化 canceled terminal state、`REQUEST_CANCELED` 产品路径投影和 request-control 状态机。
- 多实例 lease/takeover。
- 真实 checkpoint recovery。

### `agent-channel-web`

必须真实实现：

- submit route。
- explicit create-session route。
- TS convenience submit route。
- SSE route。
- history routes。
- stream projection。

不得实现：

- WebSocket。
- 独立 session detail/title/feedback/attachment/user-input/control routes。
- channel-owned replay truth。
- channel-owned session port 或直接调用 `agent-session`/gateway store。
- 业务语义路由。

### `agent-core`

必须真实实现：

- direct answer model loop。
- 通用 capability descriptor/invocation 规格下的 read tool loop。
- final agent message fact through timeline。
- tool loop 上限：`maxToolRounds=3`、`maxToolCallsPerRound=5`。

不得实现：

- 复杂 routing policy。
- parallel DAG。
- parallel tool execution。
- human pending input。
- 多 capability source、复杂 governance 和 parallel tool scheduling。

### `agent-model`

必须真实实现：

- fixed minimal OpenAI provider adapter。
- `complete`/`stream` async contract。
- provider stream normalization。
- multi-chunk tool-use normalization for read tool calls。
- safe provider error mapping。

不得实现：

- multi-provider fallback。
- model gateway federation。
- provider SDK leakage outside adapter。

## Minimal 范围

### `agent-session`

只实现问答成立所需的 session/message/history 和 current request message query。conversation history 默认最近 visible message window，通过 public `cursor/nextCursor` 加载更早记录；session title update、feedback、retention、aging、cleanup 都 deferred。

### `agent-context-engine`

只实现当前 request、必要 session history、locale/language hint、owner metadata、默认 prompt/profile、电信术语原文保留指令、enabled capability disclosure 和真实最小 window/budget guard。完整 budget explainability、compression、large content references、memory retrieval、完整 glossary、语言检测、双语评测集和 prompt profile governance 由既有 context follow-up changes 补齐。

### `agent-capability`

只实现通用 capability catalog/invocation 形态和 read capability 这一种产品启用工具。read 只支持 workspace-relative 单文件切片读取；绝对路径、目录、glob、write/edit/bash/search 都 deferred 或 safe rejected。多个 read calls 只允许同轮串行执行，parallel tool scheduling deferred；未启用 capability 不进入模型可见 tools，若被调用必须 unavailable safe outcome。

### Gateway

只实现 session/message/run/timeline/current request/history/terminal commit 所需 async logical ports。当前 gateway-local SQLite local atomic persistence transaction 以一致性为先，不承诺事务中途 abort；多 store adapter、remote gateway、远程或长耗时 Gateway cancellation、artifact download 和 attachment/blob lifecycle 都 deferred。

## No-op 范围

No-op provider 必须满足：

- 接口形态与对应 public contract 一致。
- 主流程真实调用。
- 显式装配为产品 composition provider，不是缺失依赖、隐式空值或 test-only stub。
- 默认不失败。
- 产品路径无副作用，调用证据通过 test spy/sink 验证。
- 后续真实 provider 替换时不改变调用语义。

No-op 不得用于：

- owner scope。
- terminal commit。
- visible history。
- model invocation。
- read capability。
- safe error mapping。

## Deferred 边界

实现阶段如果需要引用 deferred 能力，只能以 disabled descriptor、empty provider 或 explicit unavailable safe outcome 表达，不得新增用户可见 route、stream event、runtime command、capability descriptor 或 persistence behavior。不得把 deferred 能力做成“局部可用”的半实现后挂到产品路径。

需要后续独立 change 的能力：

- `add-ts-web-sse-ws-transports` 补齐 WebSocket。
- attachment 能力组补齐附件 request/context flow。
- web API extension changes 补齐独立 session detail、title、feedback、user-input 和 request-control routes。
- memory 能力组补齐长期记忆。
- capability source/governance changes 补齐多工具、多 Skill source、API-backed tools、复杂 conflict/idempotency/audit governance。
- runtime recovery changes 补齐多实例 recovery、terminal retry/takeover 和真实 checkpoint。
- request control changes 补齐 cancel/retry/edit。
- output continuation flow 不属于本 change；若未来要恢复自动续写能力，必须新增独立 change，不能隐式纳入本 change。
- capacity gate change 补齐并发容量和 SLA benchmark。

## 验证

- capability catalog tests 断言产品路径只暴露 read。
- route registry tests 断言没有 WebSocket 和 deferred routes。
- architecture tests 断言 deferred packages 不被最小内核产品 composition 隐式依赖。
- no-op smoke tests 断言 hook/checkpoint/audit 被调用但不产生真实副作用。
- context render tests 断言 locale/language hint 和电信术语原文保留指令。
- output guard tests 断言超限不静默截断。
- concurrency smoke tests 断言同 session active-run conflict safe rejection、不串写，跨 session 并发不串标识。
- route registry tests 断言已确认最小 route table 和 TS convenience submit 存在，deferred routes 不存在。
- dependency-cruiser negative fixture 断言 private path import 失败。
