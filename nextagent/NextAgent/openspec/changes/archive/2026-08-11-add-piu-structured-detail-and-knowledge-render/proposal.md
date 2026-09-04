## 背景与问题（Why）

前端 `TOOL_STRUCTURED_DELTA` 流事件携带两个维度：`toolEventType`（语义角色：TITLE/DETAIL/SUB_TITLE/SUB_DETAIL/SUB_CONCLUSION/ANSWER/EXPAND_PANEL）和 `toolMessageType`（渲染类型：TEXT/DSL/PIU/ACTION/OPERATOR/FILE）。当前只有 `ANSWER`（进入对话回答区 `buildAnswerSegments`）和 `EXPAND_PANEL`（进入 `expandPanelData` 单槽 + 展开面板 overlay）按 `toolMessageType` 分发到结构化渲染组件。`DETAIL`/`SUB_DETAIL`/`SUB_CONCLUSION` 把所有 content 拼成一个 `detail` 字符串，`toolMessageType` 被忽略——例如 `DETAIL + DSL` 事件渲染成 JSON 文本而不是图表，`DETAIL + PIU` 渲染成 JSON 文本而不是 PIU 组件。进程面板里结构化能力输出无法正确呈现。

同时，协作式 PIU 需要对外提供一个独立的 attach handler `renderKnowledge`，用于渲染知识来源列表并支持点击查看详情。当前 PIU attach handler 有 `loadAIAgent`、`displayAIAgent`、`minimizeAIAgent`、`switchLocale`、`switchTheme`、`sendQuestionToLui`，但没有渲染知识来源的能力。

结构化 workflow 还存在三类稳定展示问题：同一 sequence 上的 TITLE 与 DETAIL 在 live/history 合并时可能互相覆盖；并发或批量到达时 DETAIL 仅按“最近 TITLE”关联会串到其他节点；极速完成的 workflow 首次渲染已是 settled 状态时过程面板默认折叠，只剩 ANSWER 可见。最终 DISPLAY 节点还会同时投影同文的结构化 TEXT ANSWER 和 canonical LLM 文本，页面不得重复展示同一答案。

三个需求均由 `frontend/agent-web` 拥有。需求 A 与需求 C 共用结构化消息展示链；需求 B 只影响协作式 PIU attach handler，与 A/C 无代码或数据依赖。

## 变更范围（What Changes）

### 需求 A：DETAIL/SUB_DETAIL/SUB_CONCLUSION 按 messageType 渲染

- `DETAIL`/`SUB_DETAIL`/`SUB_CONCLUSION` 事件在累积到最近 TITLE/SUB_TITLE 条目时，除现有 `detail` 字符串外，新增 `structuredSegments` 字段承载按 `toolMessageType` 分段的结构化内容。
- `detail` 字符串只累积 TEXT 部分内容，用于摘要生成（`summarizeToolRawDetail`）、长文本检测（`isLongProcessDetail`）、可展开性判断和 Markdown 渲染判断；非 TEXT 内容不进 `detail` 字符串，由 `structuredSegments` 数组承载。
- 累积语义对齐 ANSWER 的 `buildAnswerSegments`：TEXT 相邻段做字符串拼接（合并到上一个 TEXT segment），非 TEXT（DSL/PIU/ACTION/OPERATOR/FILE）每个事件独立成段堆叠不替换，messageType 变化打断 TEXT 拼接链。
- `ProcessPanel` detail 渲染区新增分支：`structuredSegments` 存在且非空时用 `AnswerSegments` 组件渲染（复用现有 `answerContent.ts` 的 `AnswerSegment` 类型和 `AnswerSegments.tsx` 组件），否则走现有 `shouldRenderProcessDetailAsMarkdown ? MarkdownContent : pre-wrap div` 逻辑。
- `TITLE`/`SUB_TITLE` 保持纯文本不变。
- 不改 `buildProcessTimelineEntries`（timeline 版），其输出 `ProcessTimelineContent` 组件为 dead code，timeline 只用 `.length` 做计数器。
- **非目标**：accumulated 去重（workflow projector 的 `accumulateVisibleText` 返回累积全量导致 DETAIL content 重复显示，单独 change）；前端 `contracts.ts` 补 `EXPAND_PANEL` 到 `TOOL_EVENT_TYPES`（单独 change）。

### 需求 C：结构化 workflow 稳定投影与默认展示

- live/history envelope 合并时，`TOOL_STRUCTURED_DELTA` 使用 `toolEventType + 稳定关联标识` 作为同 sequence 下的区分项，TITLE、DETAIL 和 ANSWER 不得互相覆盖；同一关联标识的 TITLE/SUB_TITLE 必须先于同 sequence 的详情事件投影。
- TITLE/SUB_TITLE 按稳定关联标识建立条目索引；DETAIL、SUB_DETAIL、SUB_CONCLUSION 和 EXPAND_PANEL 携带稳定关联标识时必须挂到对应 TITLE/SUB_TITLE。仅旧事件缺少稳定关联标识时回退到最近条目。
- 同一 turn 中，结构化 TEXT ANSWER 与 LLM answer 文本完全相同时只渲染一次结构化答案；内容不同或非 TEXT 结构化答案仍按 sequence 共存。
- 包含 TITLE/SUB_TITLE 结构化过程条目的 ProcessPanel 即使首次渲染已 settled，也默认展开且不自动折叠；用户手动折叠仍生效。普通 settled 过程面板保持原默认折叠行为。

### 需求 B：PIU renderKnowledge attach handler

- 新增 PIU attach handler `renderKnowledge`，仅在 `registerAIAgentPIU`（协作式入口）注册。沉浸式入口（`immersive.tsx`）和本地入口（`local.tsx`）不注册此 handler。
- 接收 `{ containerId: string, data: Array<{ source: string, title: string, knowledge: string }> }`，在 `containerId` 容器内渲染知识来源列表。
- 列表项标题解析优先级：`source` 按 `|` 分割取第一项 trim 非空 → 用；空 → `title` trim 非空 → 用；空 → `knowledge` 前 100 字符。
- 点击列表项打开 antd Modal，用 `MarkdownContent` 解析显示 `knowledge` 内容。
- 新建独立 React root 套 `AppProviders`（和 `loadAIAgentWithConfig` 同模式），保证 antd ConfigProvider/theme/locale 完整；theme 通过 CSS 变量自动跟随。
- 重复调用同一 containerId 替换内容复用 root，新 containerId unmount 旧 root 建新 root。
- `renderKnowledge` 与 `loadAIAgent` 完全独立，不是 PIU 启动入口，仅用于知识来源渲染。仅在 `createHandlers` 返回类型声明，不修改 `prel.ts` 的 `PIU.attach` 类型（与 `minimizeAIAgent`、`loadAIAgent` 等协作式自定义 handler 同形）。

## Capability 影响（Capabilities）

### 新增 Capability
- `agent-web-piu-knowledge-render`: 协作式 PIU 通过 attach handler `renderKnowledge` 渲染知识来源列表与详情弹窗的行为契约。

### 修改的 Capability
- `agent-web-structured-message-rendering`: 修改 "Process Panel Entry Generation" 和 "Non-TEXT messageType content is JSON.stringified in process panel" 两个 requirement，使 DETAIL/SUB_DETAIL/SUB_CONCLUSION 按 `toolMessageType` 渲染结构化内容而非全部拼成纯文本。
- `agent-web-process-panel`: 结构化 workflow 过程条目在极速完成后仍默认展开，普通过程面板折叠策略不变。

## 影响范围（Impact）

需求 A：
- `frontend/agent-web/src/features/chat/process/processDetails.ts`: `ProcessEntry`/`ProcessDisplayEntry` 新增 `structuredSegments?: readonly AnswerSegment[]`；`buildProcessEntries` 的 DETAIL/SUB_DETAIL/SUB_CONCLUSION 分支（display 版）从纯字符串拼接改为同时构建 segment 数组；`buildProcessDisplayEntries` 透传该字段。
- `frontend/agent-web/src/features/chat/components/ProcessPanel.tsx`: detail 渲染区新增 `structuredSegments` 分支，import `AnswerSegments`。
- `frontend/agent-web/src/features/chat/process/processDetails.test.ts`: 更新 non-TEXT DETAIL 断言，新增 messageType 渲染测试。

需求 B：
- `frontend/agent-web/src/piu/registerAIAgentPIU.tsx`: `createHandlers` 返回类型新增 `renderKnowledge`；新增独立 root 管理逻辑和 `renderKnowledgeWithConfig` 函数。
- 新建 `frontend/agent-web/src/features/knowledge/KnowledgeSourceList.tsx`: 列表组件 + antd Modal，复用 `MarkdownContent`。
- 不修改 `prel.ts`。

需求 C：
- `frontend/agent-web/src/features/chat/utils/streamingHelpers.ts`、`src/state/conversationStore.ts`: 区分同 sequence 的不同结构化事件。
- `frontend/agent-web/src/features/chat/process/processDetails.ts`: 按稳定关联标识归并 TITLE/DETAIL 族事件，并保留无关联标识的旧事件回退。
- `frontend/agent-web/src/features/chat/presentation/answerContent.ts`: 抑制与结构化 TEXT ANSWER 完全同文的 LLM answer 投影。
- `frontend/agent-web/src/features/chat/components/ProcessPanel.tsx`: 结构化 workflow 默认展开且不自动折叠。
- 对应 Vitest 覆盖同序号、交错关联、重复答案和 settled 首屏 DOM 展示。

## 归档前更新基线（Baseline Promotion Plan）

行为契约：
- `openspec/specs/agent-web-structured-message-rendering/spec.md`: 修改 DETAIL/SUB_DETAIL/SUB_CONCLUSION 的累积与渲染 requirement。
- `openspec/specs/agent-web-process-panel/spec.md`: 新增结构化 workflow 默认展开行为。
- `openspec/specs/agent-web-piu-knowledge-render/spec.md`: 新增 PIU 知识来源渲染行为契约。

长期背景：
- `openspec/overview.md`: 无。

设计视图：
- `openspec/designs/architecture/`: 无。
- `openspec/designs/modules/agent-web.md`: 归档时补充结构化详情渲染和 PIU 知识来源渲染的模块职责。
- `openspec/designs/adr/`: 无。
- `openspec/designs/spec-to-design-map.md`: 归档时新增 `agent-web-piu-knowledge-render` 导航，更新 `agent-web-structured-message-rendering` 导航。

验证入口：
- `frontend/agent-web` 下 Vitest：`processDetails.test.ts`（需求 A/C）、`streamingHelpers.test.ts`、`answerContentExpandPanel.test.ts`、`ProcessPanel.test.ts`（需求 C）、`piu-runtime-contract.test.tsx`（需求 B handler 注册与渲染）。
- `frontend/agent-web` 下 `npm run build` 和 `npm run build:vite:modes`。
- `openspec validate add-piu-structured-detail-and-knowledge-render --strict`。
