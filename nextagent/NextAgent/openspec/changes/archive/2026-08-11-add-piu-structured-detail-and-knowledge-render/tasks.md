## 1. 需求 A：DETAIL/SUB_DETAIL/SUB_CONCLUSION 结构化渲染

- [x] 1.1 在 `processDetails.ts` 的 `ProcessEntry` 和 `ProcessDisplayEntry` 新增 `structuredSegments?: readonly AnswerSegment[]` 字段，import `AnswerSegment` 类型（来自 `answerContent.ts`）；修改 `buildProcessEntries`（display 版）的 DETAIL/SUB_DETAIL/SUB_CONCLUSION 分支：TEXT content 同时累积进 `detail` 字符串和 `structuredSegments`，非 TEXT content 只进 `structuredSegments`（独立成段不合并，非 TEXT content 不进 `detail`），messageType 变化打断 TEXT 合并链；`buildProcessDisplayEntries` 透传 `structuredSegments`。
  验证：`frontend/agent-web/src/features/chat/process/processDetails.test.ts` 新增自动化断言：TEXT DETAIL 进 detail 和 structuredSegments；非 TEXT DETAIL 只进 structuredSegments 不进 detail；混合 TEXT+DSL+TEXT 场景 detail 只含 TEXT；相邻 TEXT 合并，messageType 变化后不合并；SUB_DETAIL/SUB_CONCLUSION 同样累积到 SUB_TITLE。
  来源：Requirement "Process Panel Entry Generation"、Requirement "Non-TEXT messageType content is rendered by structured renderer in process panel"、Design "需求 A：复用 AnswerSegment 数组与累积语义"。

- [x] 1.2 在 `ProcessPanel.tsx` 的 detail 渲染区（~line 728）新增分支：`entry.structuredSegments` 非空时渲染 `<AnswerSegments segments={entry.structuredSegments} />`，否则走现有 `shouldRenderProcessDetailAsMarkdown ? MarkdownContent : pre-wrap div` 逻辑；import `AnswerSegments` 组件。
  验证：渲染测试断言 structuredSegments 非空时 AnswerSegments 组件被渲染并按 messageType 分发（DSL→DslRenderer、PIU→PiuMessage）；structuredSegments 为空时回退现有渲染分支。
  来源：Requirement "Process Panel Entry Generation" Scenario "structuredSegments rendered by AnswerSegments component"、Scenario "Empty structuredSegments falls back to detail rendering"。

- [x] 1.3 更新 `processDetails.test.ts` 中原有 "non-TEXT DETAIL fragments" 相关断言，原断言 detail 含 JSON.stringify 内容，改为断言非 TEXT content 不进 detail，structuredSegments 承载结构化段。
  验证：`processDetails.test.ts` 该组测试更新后通过。
  来源：Requirement "Non-TEXT messageType content is rendered by structured renderer in process panel"。

## 2. 需求 B：PIU renderKnowledge attach handler

- [x] 2.1 在 `registerAIAgentPIU.tsx` 的 `createHandlers` 返回类型新增 `renderKnowledge?: (payload: unknown) => void`，并在返回对象中实现该方法，调用 `renderKnowledgeWithConfig(payload)`；不修改 `prel.ts`。
  验证：`frontend/agent-web/tests/piu-runtime-contract.test.tsx` 断言 handler 注册存在；immersive.tsx 和 local.tsx 不注册 renderKnowledge；prel.ts 无修改（git diff 检查）。
  来源：Requirement "renderKnowledge capability is scoped to collaborative PIU only"、Requirement "PIU exposes renderKnowledge handler through attach"、Design "需求 B：独立 React root + AppProviders"。

- [x] 2.2 实现 `renderKnowledgeWithConfig`：用独立模块级变量（`knowledgeActiveContainerId`/`knowledgeActiveRoot`/`knowledgeActiveContainer`）管理 React root，不与 `loadAIAgentWithConfig` 共享状态；root 创建时用 `renderRoot` 包裹 `<AppProviders>` + `<KnowledgeSourceList>`；重复调用同一 containerId 复用 root 重新渲染；新 containerId unmount 旧 root、清空旧容器、建新 root；缺 containerId 时 warn 返回。
  验证：`piu-runtime-contract.test.tsx` 断言：首次调用创建独立 root 并包裹 AppProviders；同 containerId 复用 root；新 containerId unmount 旧 root；缺 containerId warn 返回；renderKnowledge 不影响 loadAIAgent 状态。
  来源：Requirement "Knowledge source list renders into container with independent React root"、Requirement "PIU exposes renderKnowledge handler through attach"。

- [x] 2.3 新建 `KnowledgeSourceList.tsx`：渲染知识来源列表，列表项标题按优先级解析（source 按 `|` 分割取第一项 trim 非空 → title trim 非空 → knowledge 前 100 字符）；点击列表项打开 antd Modal 用 `MarkdownContent` 解析显示 knowledge；同一时间最多一个 Modal，点击新项替换内容；空 data 渲染空列表。
  验证：单测覆盖标题三级 fallback（source 含 `|`、source 为空用 title、source+title 均空用 knowledge 前 100 字符、whitespace-only source 视为空）；渲染测试断言列表项和 Modal 含 MarkdownContent；点击新项替换内容不新开 Modal；空 data 渲染空列表无报错。
  来源：Requirement "Knowledge source list item title resolution"、Requirement "Knowledge source detail opens in theme-aware modal"。

## 3. 验证与收尾

- [x] 3.1 运行需求 A 和需求 B 相关的 Vitest 全部通过。
  验证：`frontend/agent-web` 下 `processDetails.test.ts`、`piu-runtime-contract.test.tsx` 及相关测试通过。
  来源：Design "验证映射"。

- [x] 3.2 运行前端 build 和 strict validation。
  验证：`npm run build` 通过；`openspec validate add-piu-structured-detail-and-knowledge-render --strict` 通过。
  来源：AGENTS.md 验证门禁。

- [x] 3.3 Negative verification：确认 timeline 版 `buildProcessTimelineEntries` 未被修改（git diff 检查 `processDetails.ts` 中 timeline 版 DETAIL 分支无修改）；确认非 TEXT DETAIL 不再进 JSON.stringify 的 detail 字符串（自动化断言）。
  验证：git diff 确认 timeline 版分支无修改；`processDetails.test.ts` 断言非 TEXT content 不进 detail 字符串。
  来源：Design "非目标：不改 buildProcessTimelineEntries"、Requirement "Non-TEXT messageType content is rendered by structured renderer in process panel"。

## 4. 需求 C：结构化 workflow 稳定投影与默认展示

- [x] 4.1 区分同 sequence 的结构化 envelope，同关联标识下先投影 TITLE/SUB_TITLE，并将 DETAIL/SUB_DETAIL/SUB_CONCLUSION/EXPAND_PANEL 归并到对应条目；无稳定标识的旧事件保留最近条目回退。
  验证：`streamingHelpers.test.ts`、`processDetails.test.ts` 覆盖同序号 TITLE/DETAIL 反序输入、交错 toolCallId、缺失关联 TITLE 和 legacy fallback。
  来源：Requirement "Process Panel Entry Generation"。

- [x] 4.2 同一 turn 的结构化 TEXT ANSWER 与 LLM answer 完全同文时只展示一次，不同文本和非 TEXT structured answer 保持共存。
  验证：`answerContentExpandPanel.test.ts` 断言 duplicate LLM projection 被抑制。
  来源：Requirement "Answer Content Mixed Rendering"。

- [x] 4.3 结构化 workflow 在 settled 首屏保持默认展开且不自动折叠，用户手动折叠和普通 settled 过程面板行为不变。
  验证：`ProcessPanel.test.ts` 通过真实 DOM 断言 TITLE/DETAIL 可见，并覆盖普通过程默认折叠。
  来源：Requirement "Structured workflow process presentation remains visible"。


## 归档前更新基线（待实施后）

归档前执行 proposal 和 design 的“归档前更新基线”计划：

- 同步 `openspec/specs/agent-web-structured-message-rendering/spec.md`：将 MODIFIED 的 "Process Panel Entry Generation" 和 "Non-TEXT messageType content is rendered by structured renderer in process panel" requirement 同步到基线。
- 新增 `openspec/specs/agent-web-piu-knowledge-render/spec.md`：同步全部 ADDED requirement。
- 更新 `openspec/specs/agent-web-process-panel/spec.md`：同步结构化 workflow 默认展开 requirement。
- 更新 `openspec/designs/modules/agent-web.md`：补充结构化详情渲染（复用 AnswerSegment）和 PIU 知识来源渲染（独立 root + AppProviders）的模块职责。
- 更新 `openspec/designs/spec-to-design-map.md`：新增 `agent-web-piu-knowledge-render` 导航，更新 `agent-web-structured-message-rendering` 导航。
- 检查长期文档没有重复描述同一渲染能力或重复数据结构。
