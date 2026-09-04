# Tasks: add-ts-tool-structured-delta

## 1. Backend: Timeline Event Type & Contracts

- [x] 1.1 Add `"TOOL_STRUCTURED_DELTA"` to `TimelineEventType` in `packages/agent-common/src/index.ts`
  - 验证: `npm run build` 通过，类型包含新值
- [x] 1.2 Add `"TOOL_STRUCTURED_DELTA"` to `StreamEventType` in `packages/agent-contracts/src/channel/index.ts`
  - 验证: `npm run build` 通过，channel contract 包含新值
- [x] 1.3 Define `ToolEventType` and `ToolMessageType` union types in `agent-common` or `agent-contracts`
  - `ToolEventType = "TITLE" | "DETAIL" | "ANSWER" | "SUB_TITLE" | "SUB_DETAIL" | "SUB_CONCLUSION"`
  - `ToolMessageType = "PIU" | "DSL" | "ACTION" | "OPERATOR" | "FILE" | "TEXT"`
  - 验证: `npm run build` 通过

## 2. Backend: Tool-loop Projection Logic

- [x] 2.1 Implement `isClipProvider(descriptor)` check in `packages/agent-core/src/tools/tool-loop.ts`
  - 检查 `descriptor.provider.providerKind === "CUSTOM"` 且 `descriptor.provider.providerType === "clip_server"`
  - 非 CLIP 工具完全跳过结构化识别
  - 验证: 单元测试覆盖 CLIP provider 命中、非 CLIP provider 跳过
- [x] 2.2 Implement `isClipStructuredEvent(payload)` validator
  - 校验 `eventType` ∈ {TITLE, DETAIL, ANSWER, SUB_TITLE, SUB_DETAIL, SUB_CONCLUSION}
  - 校验 `messageType` ∈ {PIU, DSL, ACTION, OPERATOR, FILE, TEXT}
  - 校验 `content` 存在
  - 校验 content 不含敏感模式（credential、token 等）
  - 验证: 单元测试覆盖合法/非法 eventType、非法 messageType、缺失 content、含敏感字段
- [x] 2.3 Implement structured delta emission logic in tool-loop
  - 只对 CLIP 来源触发
  - 场景 1 (string) → DEFERRED。`structuredPayload` 类型为 `JsonObject`，string 在类型层面不可到达。需在 CLIP runner 层包装或放宽 `assertCapabilityResultSafe` 约束后方可实现。
  - 场景 3 (structured event) → `TOOL_STRUCTURED_DELTA { ...原样映射 }`
  - 场景 2 (plain JSON) → 不发 TOOL_STRUCTURED_DELTA，走原有 CAPABILITY_RESULT_DELTA
  - 校验失败 → 走原有通道
  - 验证: 单元测试覆盖场景 2 + 3 + fallback + 非 CLIP 不触发
- [x] 2.4 Ensure `CAPABILITY_RESULT_DELTA` and `appendCapabilityResultMessage` remain unchanged
  - `TOOL_STRUCTURED_DELTA` 不替代现有事件
  - 验证: 单元测试断言两者都被发出

## 3. Backend: Stream Envelope Projection

- [x] 3.1 Add `TOOL_STRUCTURED_DELTA` to `streamVisibleTimelineEvents` in `packages/agent-channel-web/src/projections/stream-envelope.ts`
  - 验证: 检查列表包含新值
- [x] 3.2 Implement `TOOL_STRUCTURED_DELTA` case in `projectStreamPayload()`
  - 透传 `toolEventType`、`toolMessageType`、`content`、`capabilityId`、`toolCallId`
  - 验证: 单元测试覆盖投影输出

## 4. Frontend: Contracts & Stream Connection

- [x] 4.1 Add `"TOOL_STRUCTURED_DELTA"` to `STREAM_EVENT_TYPES` in `frontend/agent-web/src/state/contracts.ts`
  - 验证: 类型包含新值
- [x] 4.2 Add `"TOOL_STRUCTURED_DELTA"` to `FRAME_BATCHABLE_EVENT_TYPES` in `frontend/agent-web/src/features/chat/hooks/useStreamConnection.ts`
  - 验证: 批处理列表包含新值

## 5. Frontend: Process Panel Integration

- [x] 5.1 Add `TOOL_STRUCTURED_DELTA` handling in `buildProcessTimelineEntries()` in `processDetails.ts`
  - TITLE → 新建条目，主图标
  - DETAIL → 累积到最近 TITLE 条目的 detail
  - SUB_TITLE → 新建条目，小圆圈图标
  - SUB_DETAIL → 累积到最近 SUB_TITLE 条目的 detail
  - SUB_CONCLUSION → 追加到最近 SUB_TITLE 条目的 detail
  - ANSWER → 不创建条目
  - 非 TEXT 的 toolMessageType → JSON.stringify(content) 存为文本
  - 多条 TOOL_STRUCTURED_DELTA 全部追加
  - 验证: 组件测试覆盖六种 toolEventType + 非 TEXT 类型
- [x] 5.2 Implement CAPABILITY_STARTED/COMPLETED suppression for structured tool calls
  - 预扫描所有 TOOL_STRUCTURED_DELTA 的 toolCallId 集合
  - 处理 CAPABILITY_STARTED/COMPLETED 时检查 toolCallId 是否在集合中
  - 在集合中 → 跳过不生成过程面板条目
  - 不在集合中 → 走原有逻辑
  - 验证: 组件测试覆盖有/无 TOOL_STRUCTURED_DELTA 两种情况
- [x] 5.3 Create circle icon assets (`circle-dark.svg`, `circle-light.svg`) in `src/assets/process-icons/`
  - 验证: 文件存在
- [x] 5.4 Add `"circle"` to `ProcessIconType` and update `resolveProcessIconType()` for SUB_TITLE
  - 验证: SUB_TITLE 条目使用 circle 图标
- [x] 5.5 Update `resolveProcessIconUrl()` to return circle icon variant
  - 验证: dark/light 正确切换

## 6. Frontend: Answer Content Mixed Rendering

- [x] 6.1 Update `buildAnswerContent()` or create new module to handle both `LLM_CONTENT_DELTA` and `TOOL_STRUCTURED_DELTA` ANSWER events
  - 按 sequence 混排
  - LLM_CONTENT_DELTA → 合并为文本
  - TOOL_STRUCTURED_DELTA ANSWER → 按 toolMessageType 分发到渲染组件
  - 验证: 组件测试覆盖混排、纯文本、纯结构化三种情况
- [x] 6.2 Create `FileCard` component in `src/features/chat/components/structured/`
  - 带圆角矩形的小文件卡片
  - props: `{ fileName: string }`
  - 验证: 组件测试覆盖渲染
- [x] 6.3 Create `ActionCard` component
  - 解析 content JSON，遍历所有 key
  - 每个 key: `JSON.parse(data)` 后 `document.dispatchEvent(new CustomEvent(key, { detail: parsedData }))`
  - 如有 text 展示文本
  - 验证: 组件测试覆盖多 key、无 text、无 data、dispatchEvent 调用
- [x] 6.4 Create `OperatorButtons` component
  - 解析 content JSON，渲染提示文本 + 按钮组
  - 按 `align` 排列，按 `type` 设置样式
  - 用户点击触发 `JSON.parse(data)` 后 `document.dispatchEvent(new CustomEvent(key, { detail: parsedData }))`
  - 验证: 组件测试覆盖按钮渲染、点击、dispatchEvent
- [x] 6.5 Create `DslRenderer` component
  - `import { DSLEngine } from '@cloudsop/dsl-engine-web'`
  - `return <DSLEngine data={[content]} />`，content 原样传入不做处理
  - 验证: stub 模式下渲染占位不报错
- [x] 6.6 Create `PiuMessage` component
  - 从 `PiuContext` 取 `piu`
  - 校验 `content.piuName`、`piu`、`window.Prel`
  - `useEffect` 中 `autoLoad` + `emit`
  - 渲染唯一 `id` 的 wrapper div
  - 验证: 组件测试覆盖 mock piu、缺失 piuName、emit 调用

## 7. Frontend: PiuContext & Mock Prel

- [x] 7.1 Create `PiuContext` in `src/features/chat/context/PiuContext.tsx`
  - `interface PiuContextValue { piu: PIU | null; site: HostSiteContext }`
  - 默认值 `{ piu: null, site: mockSite }`
  - 验证: context 存在且可消费
- [x] 7.2 Update PIU type definition in `src/host/prel.ts`
  - `attach` handlers 改为 `{ $stateChange?, userAction? }` 结构
  - 验证: 类型编译通过
- [x] 7.3 Create `src/host/prel-mock.ts`
  - 导出 `mockSite`、`mockPiu`、`mockPrel`、`installMockPrel()`
  - 验证: mock 模块编译通过
- [x] 7.4 Update `src/entries/local.tsx` to call `installMockPrel()` and wrap with `PiuContext.Provider`
  - 验证: 本地 dev 启动不报错，PiuContext 可用
- [x] 7.5 Update `src/entries/immersive.tsx` to pass `piu` and `site` into `PiuContext.Provider`
  - 验证: immersive 入口 PiuContext 有值
- [x] 7.6 Update `src/piu/registerAIAgentPIU.tsx` and `AIAgentPiuRuntime.tsx` to populate PiuContext
  - 验证: PIU 协作式入口 PiuContext 有值

## 8. Frontend: Vite Alias for DSL Engine

- [x] 8.1 Create `src/vendor/dsl-engine-stub.ts`
  - 导出 `DSLEngine` 占位组件
  - 验证: stub 模块编译通过
- [x] 8.2 Update `vite.config.ts` with `@cloudsop/dsl-engine-web` alias
  - dev 模式指向 stub
  - build 模式指向真实包
  - 验证: `npm run dev` 不报错；`npm run build:vite` 正常（远端有包时）

## 9. Frontend: Conversation History Adapter

- [x] 9.1 Update `conversationAdapter.ts` to reconstruct `TOOL_STRUCTURED_DELTA` from stored `CAPABILITY_RESULT` messages
  - 当存储的 payload 匹配 `{eventType, content, messageType}` shape 且来自 CLIP 工具时，产出 `TOOL_STRUCTURED_DELTA` envelope
  - string payload → DEFERRED（与场景 1 同一原因）。
  - 不匹配 → 走原有 `CAPABILITY_RESULT_DELTA` 逻辑
  - 验证: 历史加载测试覆盖结构化事件重建、非结构化 fallback

## 10. Integration & Architecture Tests

- [x] 10.1 Add architecture test asserting `TOOL_STRUCTURED_DELTA` is in `TimelineEventType` and `StreamEventType`
  - 验证: `npm run lint:architecture` 通过
- [x] 10.2 Add contract test for tool-loop structured delta emission (CLIP-only, three scenarios, fallback)
  - 验证: `npm run test:contract` 通过
- [x] 10.3 Add contract test for stream-envelope projection of `TOOL_STRUCTURED_DELTA`
  - 验证: `npm run test:contract` 通过
- [x] 10.4 Run full validation
  - `openspec validate --all --strict`
  - `npm run build`
  - `npm test`
  - `npm run test:contract`
  - `npm run lint:architecture`
﻿
## 11. Workflow 流式 Level

- [x] 11.1 在 `packages/agent-contracts/src/core/index.ts` 中为 `WorkflowVisibleDelta` 接口和 `WorkflowVisibleDeltaSchema` 新增可选字段 `level?: ToolEventType`
  - Schema 必须包含 7 个 literal union 值：TITLE, DETAIL, ANSWER, SUB_TITLE, SUB_DETAIL, SUB_CONCLUSION, EXPAND_PANEL
  - 验证: `npm run build` 通过，schema 校验接受带 level 的 delta、拒绝未知 level 值

- [x] 11.2 为 `WorkflowRuntimeEventProjector` 新增 `levelScope` 参数和流式 level 投影
  - 构造函数接受 `levelScope: "MAIN" | "SUB"`（默认 `"MAIN"`）
  - `projectLlmNodeEvent`：当 `visibleDelta.level` 存在时，发送 `TOOL_STRUCTURED_DELTA` fragment，标记 step 到 `structuredStreamedSteps`，跳过 `LLM_CONTENT_DELTA`
  - `projectStructuredDelta`：NODE_COMPLETED 检查 `structuredStreamedSteps`，命中则抑制（dedup）
  - NODE_STARTED 和 NODE_COMPLETED 按 scope 自动分配 level（MAIN: TITLE/ANSWER/DETAIL，SUB: SUB_TITLE/SUB_CONCLUSION/SUB_DETAIL）
  - 新增 `mapDeltaChannelToMessageType` 辅助函数
  - 验证: 单元测试覆盖流式 level -> TOOL_STRUCTURED_DELTA fragment、dedup、levelScope MAIN/SUB、无 level -> LLM_CONTENT_DELTA

- [x] 11.3 在 `workflow-tool-delta-projection.ts` 中创建 projector 时传入 `levelScope: "SUB"`
  - 验证: `npm run build` 通过

- [x] 11.4 在 `executeDisplayContentNode` 中读取 `outputParser.level` 并传递到 `emitOutputDelta`
  - 从 `outputParser.level` 或 `presentation.outputParser.level` 读取
  - 校验 `TOOL_EVENT_TYPES`，归一化为大写
  - 验证: 单元测试覆盖有 level 配置、无 level 配置、无效 level

- [x] 11.5 修复 `workflow-tool-port.ts` 中 answer level 的大小写不敏感匹配
  - `extractAnswerPreviews`：`level !== "answer"` -> `typeof level !== "string" || level.toUpperCase() !== "ANSWER"`
  - `extractAnswerGeneratedMessages`：同样修复
  - 验证: 单元测试覆盖大写 ANSWER、小写 answer

- [x] 11.6 执行完整验证
  - `openspec validate --all --strict`
  - `npm run build`
  - `npm test`
  - `npm run test:contract`
  - `npm run lint:architecture`