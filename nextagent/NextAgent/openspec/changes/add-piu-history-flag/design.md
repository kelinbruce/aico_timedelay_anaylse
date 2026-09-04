# add-piu-history-flag 设计

## 设计范围（Design Scope）

| Function | 目标变化 | delta specs | 设计章节 |
|---|---|---|---|
| `FN-10.6 前端定制` | 答案区结构化 PIU emit payload 新增可信 `isHistory`，区分历史回显与实时问答 | `agent-web-structured-message-rendering` | [FN-10.6 前端定制](#fn-106-前端定制) |

## FN-10.6 前端定制

### 目标与规范依据

外部答案区 PIU 需要在不解析不可信 stream content 的情况下区分历史回显与实时问答。前端把 turn 投影的 trusted view state 传给结构化答案渲染层，并作为 host field 注入 PIU emit payload。

本 Function 的目标 Requirements：

- canonical spec：`agent-web-structured-message-rendering`
- `MODIFIED PIU Message Rendering`

### 当前实现

- `TurnBlock` 已基于 `aiEvents` 计算 `isLiveStreamed`：任一事件不携带 `history-load` transport hint 即为实时流；该判定是整轮状态，不能代表单个结构化 PIU segment 的来源。
- `PiuMessage` 的本地不可预览和等待宿主渲染提示是硬编码中文。
- `AnswerSegments` 只接收 `segments` 和 `sessionId`，PIU 分支把解析后的 content 传给 `PiuMessage`。
- `PiuMessage` 的 `buildPiuEmitPayload` 支持 whole-content 与 `dte-bi-agent` spread-data 两种形态，并后置展开 `wrapperId`、`containerId`、expand panel 回调和 `expandPanelId`。
- 当前 payload 不包含 `isHistory`，外部 PIU 无法从 trusted 字段判断渲染场景。

### GAP 分析

- 规范要求两种 payload 形态都包含可信布尔 `isHistory`，且该字段覆盖 content/data 同名字段。
- 规范要求 fallback 提示使用 active i18n locale。
- 当前 turn 层已有 live/history 判定，但该判定描述的是整个 turn 是否存在实时事件，不能代表某个结构化 PIU 内容本身的来源；而持久化层会把结构化 PIU 的对象 `data` 聚合为数组，形成可识别的历史回显形状。
- 当前 `PiuMessage` 的 host fields 不包含 `isHistory`，无法保证不可信 stream 字段被覆盖。

### 修改方案

- `buildAnswerSegments` 在生成 PIU segment 时解析 object 或 JSON-string content，并把 `content.data` 为数组投影为 `isHistory: true`，其他形状投影为 `false`。
- `AnswerSegments` 在有 uuid 聚合和无 uuid 两条 PIU 渲染路径中，都把当前结构化 segment 的 `isHistory` 传给 `PiuMessage`。
- `PiuMessage` 使用 i18n 资源渲染本地不可预览与等待宿主渲染提示，并新增 zh-CN/en-US 文案。
- `PiuMessage` 增加 `isHistory?: boolean` prop，缺省值为 `false`；将 `isHistory` 加入 `PiuHostFields` 并后置展开，使 whole-content 与 spread-data 两种 payload 都携带该字段并覆盖同名的不可信字段。
- spread-data 分支显式排除数组 `data`，确保数组不会展开为 index key，payload 只保留宿主字段。
- 不修改后端 structured delta、PIU 加载、emit 去重、uuid 聚合、expand panel 行为和其他 PIU 宿主入口。
- 无新增黑盒质量目标。

### 备选方案（Alternatives Considered）

- 让外部 PIU 从 `uuid`、事件顺序或整个 turn 的 live 状态推断历史/实时：语义不稳定，未采用。
- 后端在每个 PIU content 中写入 `isHistory`：会把前端渲染场景混入持久化事实，并扩大后端契约，未采用。

## 验证策略（Verification Strategy）

- unit/contract：在 `AnswerSegments.test.tsx`、`answerContent.test.ts` 和 `answerContentExpandPanel.test.ts` 中断言 whole-content payload 默认 `isHistory: false`、数组 `data` 投影为 `true`、spread-data payload 携带该字段，且 content/data 中的同名不可信字段被 host field 覆盖；同时覆盖数组 `data` 不产生 index key 的降级行为和 zh-CN/en-US fallback 文案。
- integration：在 `TurnBlock.piuHistory.test.tsx` 中断言历史回显与实时问答分别透传 `isHistory: true` 和 `false` 到 `piu.emit` payload，并覆盖同一 turn 混有 live event 时历史 PIU segment 仍保持 `true`。
- build：运行 `frontend/agent-web` 的 TypeScript build，确认新增 prop 与透传路径类型正确。
- OpenSpec：运行 `openspec validate --all --strict`，确认 delta 与 stable requirement 匹配。
- 无需 e2e：本次是组件 payload 投影变更，已有宿主加载和交互行为不变；未运行浏览器用户旅程测试。

## 长期基线刷新计划（Baseline Promotion Plan）

- `openspec/specs/agent-web-structured-message-rendering/spec.md`：修改 `PIU Message Rendering`。
- `openspec/designs/functions/D10-二次开发与平台集成/D10.2-集成与定制/FN-10.6-前端定制.md`：新增答案区 PIU 历史标识规格行。
- `openspec/designs/features/`：无。
- `openspec/overview.md`：无。
- `openspec/designs/architecture/`：无。
- `openspec/designs/modules/agent-web.md`：补充结构化 `PiuMessage` emit payload 携带 `isHistory`。
- `openspec/designs/adr/`：无。
- `openspec/designs/spec-to-design-map.md`：无导航变化。

## 风险与取舍（Risks / Trade-offs）

- 外部 PIU 若把 `isHistory` 误解为请求状态或后端持久化字段，可能产生错误分支；规范中明确它仅表示前端渲染场景。
- `AnswerSegments` 的 `isHistory` 缺省为 `false`，独立复用该组件的调用方必须显式传入历史值才能获得 `true`；产品路径由 `TurnBlock` 统一计算。

## 待确认问题（Open Questions）

无。
