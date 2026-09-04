# Tasks

## 1. streamTransport.ts — 增加 headers 支持

- [x] `ConnectStreamParams` 新增可选 `headers?: Record<string, string>` 字段
- [x] `createSseConnection` 解构 `headers`，SSE fetch 合并 `headers: { Accept: 'text/event-stream', ...(headers ?? {}) }`
- [x] `createWebSocketConnection` 不解构 `headers`，WS URL 构建逻辑不变

验证：`stream-transport.test.ts` 通过，包括新增的 headers 断言测试

## 2. 调用方传入非续期头

- [x] `SessionActivityConnectionController.tsx` 传入 `headers: { 'x-non-renewal-session': 'true' }`
- [x] `useStreamConnection.ts` 传入 `headers: { 'x-non-renewal-session': 'true' }`
- [x] `authProbe.ts` 传入 `{ headers: { 'x-non-renewal-session': 'true' } }`

验证：`sessionActivityConnection.test.tsx`、`useStreamConnection.test.tsx` 非回归通过

## 3. 补充测试断言 header 实际发送

- [x] `stream-transport.test.ts` 新增测试：传入 `headers` 时 SSE fetch 的 headers 包含对应字段
- [x] `stream-transport.test.ts` 新增测试：不传 `headers` 时 SSE fetch 只包含 `Accept` 头

验证：新增测试通过

## 4. 验证

- [x] `frontend/agent-web` `npm run build` (tsc --noEmit) 通过
- [x] `stream-transport.test.ts` 全部通过
- [x] `sessionActivityConnection.test.tsx` 全部通过
- [x] `useStreamConnection.test.tsx` 全部通过
- [x] 确认 WebSocket URL 不包含 `x-non-renewal-session` query parameter
- [x] 确认所有文件 CRLF、无 BOM、缩进一致
