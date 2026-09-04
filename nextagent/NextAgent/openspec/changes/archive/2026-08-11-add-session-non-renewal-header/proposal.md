## 背景与问题（Why）

Agent Web 浏览器在页面打开期间常驻两条自动重连的长连接——Session Activity Projection Stream（SSE/WS）和 Request Execution Stream（SSE/WS），并在每次 stream 断连时触发 auth probe HTTP 请求。这些请求持续到达后端或外部网关，导致后端/网关的 session 续期逻辑无法判定用户是否已离开，会话超时机制无法正常生效，页面打开后不会自动退出。

需要一种受控信号让前端告知后端/网关：某次请求属于自动重连的流式连接或诊断探针，不应续期会话超时。

## 目标与非目标（Goals / Non-Goals）

**目标：**

- 定义 `x-non-renewal-session: true` 请求头语义：当后端或外部网关收到该头时，MUST NOT 因该请求续期当前会话超时计时器。
- 前端在 SSE fetch（Session Activity Stream 和 Request Execution Stream）和 auth probe HTTP 请求中携带该头。
- 前端 `connectStream` 的 `headers` 参数只作用于 SSE fetch，不作用于 WebSocket（浏览器 WebSocket API 不支持自定义 HTTP header，作为受控例外在 design 中说明）。

**非目标：**

- 不修改后端 session 超时/续期实现逻辑；后端如何消费该头由后端实现负责。
- 不新增 endpoint、不修改 stream event payload、不修改 runtime lifecycle 或 persistence。
- 不为 WebSocket 传输该信号（浏览器限制，后续可通过 subprotocol 或 query parameter 扩展）。
- 不修改 `agent-contracts`、gateway contract 或 public DTO。

## 变更范围（What Changes）

- `ts-web-sse-ws-transports` spec 新增 Requirement：定义 `x-non-renewal-session` 请求头在 SSE 流连接和关联 HTTP 请求中的语义、携带范围和安全约束。
- 前端 `streamTransport.ts` 的 `ConnectStreamParams` 新增可选 `headers` 字段；SSE `fetch` 调用合并该字段到请求头。
- `SessionActivityConnectionController.tsx` 和 `useStreamConnection.ts` 在 `connectStream` 调用中传入 `headers: { 'x-non-renewal-session': 'true' }`。
- `authProbe.ts` 的 `apiClient.get` 调用传入 `headers: { 'x-non-renewal-session': 'true' }`。

## Capability 影响（Capabilities）

### 新增 Capability

无。

### 修改的 Capability

- `ts-web-sse-ws-transports`：补充 `x-non-renewal-session` 请求头的携带范围、语义和安全约束。

## 影响范围（Impact）

- 主要 owner：`frontend/agent-web`。
- 主要代码：`streamTransport.ts`、`SessionActivityConnectionController.tsx`、`useStreamConnection.ts`、`authProbe.ts`。
- 后端 package、public DTO、数据库和配置不变。
- 验证：stream-transport、session-activity-connection、useStreamConnection 和 authProbe 相关测试，以及 frontend build。

## 归档前更新基线（Baseline Promotion Plan）

- `openspec/specs/ts-web-sse-ws-transports/spec.md`：归并 `x-non-renewal-session` 请求头 Requirement。
- `openspec/designs/modules/agent-web.md`：归并 stream transport headers 传递机制。
- `openspec/designs/spec-to-design-map.md`：更新验证入口。
