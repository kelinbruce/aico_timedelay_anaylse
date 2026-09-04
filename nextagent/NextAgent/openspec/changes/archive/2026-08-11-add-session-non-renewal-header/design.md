## 设计范围

| Capability | 本次目标变化 | 涉及 delta specs | 设计章节 |
|---|---|---|---|
| `ts-web-sse-ws-transports` | 定义 `x-non-renewal-session` 请求头在 SSE 流连接和关联 HTTP 请求中的语义、携带范围和安全约束 | `ts-web-sse-ws-transports` | `请求头传递机制` |

## 请求头传递机制

### 目标与规范依据

浏览器端常驻两条自动重连的 SSE 流连接（Session Activity Stream 和 Request Execution Stream），并在断连时触发 auth probe HTTP 请求。这些请求持续到达后端/网关，使会话超时机制无法判定用户是否已离开。需要一种受控信号告知后端/网关不要因这些自动请求续期会话超时。

### 当前实现

- `streamTransport.ts` 的 `createSseConnection` 使用 `fetch(url, { headers: { Accept: 'text/event-stream' } })` 建立 SSE 连接，不支持额外请求头。
- `SessionActivityConnectionController.tsx` 和 `useStreamConnection.ts` 通过 `connectStream(...)` 打开流连接，不传额外头。
- `authProbe.ts` 通过 `apiClient.get('/api/v1/sessions?offset=0&limit=1')` 探测认证状态，不传额外头。
- `createWebSocketConnection` 使用 `new WebSocket(url)` 建立 WS 连接。

### GAP 分析

| 规范目标 | 当前事实 | GAP |
|---|---|---|
| SSE 流连接携带 `x-non-renewal-session: true` | `createSseConnection` 只设置 `Accept` 头，不支持额外头 | 需要在 `ConnectStreamParams` 和 `createSseConnection` 中增加可选 `headers` 字段 |
| auth probe 携带非续期头 | `authProbe.ts` 不传额外头 | 需要在 `apiClient.get` 调用中传入 header |
| WebSocket 不携带该头 | WS 已不支持自定义头 | 无 GAP，作为受控例外在 spec 中明确 |

### 修改方案

1. `ConnectStreamParams` 新增可选 `headers?: Record<string, string>` 字段。
2. `createSseConnection` 解构 `headers`，并在 SSE `fetch` 调用中合并：`headers: { Accept: 'text/event-stream', ...(headers ?? {}) }`。
3. `createWebSocketConnection` 不解构 `headers`，不改变 WS URL 构建逻辑。WS 不携带该头是浏览器 API 限制的受控例外。
4. `SessionActivityConnectionController.tsx` 和 `useStreamConnection.ts` 在 `connectStream` 调用中传入 `headers: { 'x-non-renewal-session': 'true' }`。
5. `authProbe.ts` 在 `apiClient.get` 调用中传入 `{ headers: { 'x-non-renewal-session': 'true' } }`。

### 受控例外：WebSocket

浏览器 `new WebSocket(url)` API 不支持设置自定义 HTTP header。因此 WebSocket transport 不携带 `x-non-renewal-session` 头。该限制在 spec 中明确记录为受控例外。后续如需为 WS 传递该信号，MUST 通过独立 OpenSpec change 使用 WebSocket subprotocol 或 query parameter 扩展，并定义相应的安全约束。

### 安全约束

- `x-non-renewal-session` 头的值固定为字符串 `true`，不从客户端请求体、模型输出或用户 metadata 派生。
- 该头不携带 credential、owner scope、agent scope 或高基数字段。
- 该头不出现在 stream event payload、timeline event、audit log 或 safe error 中。
- 用户主动请求（submit、retry、edit、cancel、answer pending input）不携带该头，确保后端正常续期会话超时。

## 验证策略（Verification Strategy）

- `stream-transport.test.ts` 覆盖：传入 `headers` 时 SSE fetch 调用的 headers 包含对应字段；不传 `headers` 时 SSE fetch 只包含 `Accept` 头。
- `sessionActivityConnection.test.tsx` 非回归：连接行为和重连逻辑不变。
- `useStreamConnection.test.tsx` 非回归：stream 连接和恢复逻辑不变。
- authProbe 相关测试或手动验证：`apiClient.get` 调用携带 `x-non-renewal-session` 头。
- frontend build (tsc --noEmit) 通过。
- 确认 WebSocket URL 不包含 `x-non-renewal-session` query parameter。

## 长期基线刷新计划（Baseline Promotion Plan）

- `openspec/specs/ts-web-sse-ws-transports/spec.md`：归并 `会话非续期请求头` Requirement。
- `openspec/designs/modules/agent-web.md`：归并 stream transport headers 传递机制。
- `openspec/designs/spec-to-design-map.md`：更新验证入口。

## 风险与取舍（Risks / Trade-offs）

- WebSocket 不携带非续期头，意味着 WS transport 仍可能触发会话续期。如果后端使用 WS transport，会话超时机制可能仍无法生效。缓解方式：后续 OpenSpec change 通过 WS subprotocol 或 query parameter 扩展。
- 后端当前没有 session 续期/超时实现，该头可能由外部网关（反向代理、API 网关）消费。后端实现该机制时 MUST 遵循本 spec 定义的语义。

## 待确认问题（Open Questions）

无。
