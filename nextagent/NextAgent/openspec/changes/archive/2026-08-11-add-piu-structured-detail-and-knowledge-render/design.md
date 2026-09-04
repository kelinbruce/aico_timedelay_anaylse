## 背景和现状（Context）

前端 `TOOL_STRUCTURED_DELTA` 流事件有两个维度：`toolEventType`（语义角色）和 `toolMessageType`（渲染类型）。`buildProcessEntries()`（display 版）负责把 `TOOL_STRUCTURED_DELTA` 转成 `ProcessEntry[]` 供 `ProcessPanel` 渲染。当前 DETAIL/SUB_DETAIL/SUB_CONCLUSION 分支只做字符串拼接（TEXT 无分隔符、非 TEXT 加 `\n` 分隔），把所有 content 塞进 `detail` 字符串，`toolMessageType` 被丢弃。只有 ANSWER（`buildAnswerSegments`）和 EXPAND_PANEL（`expandPanelData` 单槽）按 messageType 分发到结构化组件。

协作式 PIU（`registerAIAgentPIU` 入口）通过 `piu.attach()` 注册 handler 供集成方调用，已有 `loadAIAgent`、`displayAIAgent`、`minimizeAIAgent`、`switchLocale`、`switchTheme`、`sendQuestionToLui`。这些 handler 只在 `createHandlers` 返回类型声明，不修改 `prel.ts` 的 `PIU.attach` 类型。沉浸式入口（`immersive.tsx`）的 `piu.attach` 只注册 `switchLocale` 和 `switchTheme`。当前没有渲染知识来源的能力。

**Implementation-vs-spec gap**：stable spec `agent-web-structured-message-rendering` 的 "Process Panel Entry Generation" requirement 描述 `buildProcessTimelineEntries()`，但实际 `ProcessPanel` 渲染用的是 `buildProcessEntries()`（display 版）的 `ProcessDisplayEntry[]`。timeline 版输出 `ProcessTimelineContent` 组件（`TurnBlock.tsx`）是 dead code，从未渲染；timeline 只用 entry `.length` 做计数器。本 change 修改 display 版 `buildProcessEntries`，timeline 版不改。

## 目标和非目标（Goals / Non-Goals）

**目标：**
- DETAIL/SUB_DETAIL/SUB_CONCLUSION 按 `toolMessageType` 渲染结构化组件，复用 ANSWER 的 `AnswerSegment` 类型和 `AnswerSegments` 组件。
- 保留 `detail` 字符串（只含 TEXT）供摘要生成、长文本检测、可展开性和 Markdown 判断使用。
- 新增协作式 PIU attach handler `renderKnowledge`，渲染知识来源列表 + 点击查看 Markdown 详情弹窗。
- 保证结构化 workflow 在同 sequence、交错到达、重复答案投影和极速完成场景下稳定呈现 TITLE-DETAIL 链与单一最终答案。

**非目标：**
- 不做 accumulated 去重（workflow projector 的 `accumulateVisibleText` 返回累积全量导致 DETAIL content 重复，单独 change）。
- 不补前端 `contracts.ts` 的 `TOOL_EVENT_TYPES` 缺失 `EXPAND_PANEL`（单独 change）。
- 不改 `buildProcessTimelineEntries`（timeline 版）和 dead code `ProcessTimelineContent`。
- 不改 EXPAND_PANEL 单槽数据结构；只修正其 TITLE 关联目标。
- `renderKnowledge` 不适用于沉浸式和本地模式。

## 设计决策（Decisions）

### 需求 A：复用 AnswerSegment 数组与累积语义

**唯一实现路径**：在 `ProcessEntry`/`ProcessDisplayEntry` 新增 `structuredSegments?: readonly AnswerSegment[]`，复用 `answerContent.ts` 已有的 `AnswerSegment` 类型（`AnswerTextSegment | AnswerStructuredSegment`）和 `AnswerSegments.tsx` 组件。不新建类型或组件。

为什么是数组不是单槽：一个 TITLE 下可有多个 DETAIL 事件，messageType 可能交替（TEXT + DSL + TEXT），必须数组才能保序。EXPAND_PANEL 保持单槽 `expandPanelData` 不变，语义上是一个展开面板内容。

累积语义对齐 ANSWER 的 `buildAnswerSegments`：
- TEXT：与上一个 TEXT segment 相邻时做字符串拼接（合并到上一个 TEXT segment）。
- 非 TEXT（DSL/PIU/ACTION/OPERATOR/FILE）：每个事件独立成段，堆叠不替换。
- messageType 变化打断 TEXT 拼接链。

`detail` 字符串只累积 TEXT content，非 TEXT 不进 detail。这保证 `summarizeToolRawDetail`、`isLongProcessDetail`、`shouldRenderProcessDetailAsMarkdown`、可展开性判断等现有消费者行为不变（它们只看 detail 字符串）。

**ProcessPanel 渲染**：detail 渲染区（`ProcessPanel.tsx` ~line 728）加分支：`entry.structuredSegments` 非空 → `<AnswerSegments segments={entry.structuredSegments} />`；否则走现有 `shouldRenderProcessDetailAsMarkdown ? <MarkdownContent> : <div pre-wrap>`。

**放弃的备选方案**：
- 新建独立 segment 类型：放弃，与 ANSWER 同形同策要求复用 `AnswerSegment`。
- 把非 TEXT content 也塞进 detail 字符串再用 JSON.parse 还原：放弃，破坏现有 detail 消费者且不可靠。
- 同时改 timeline 版：放弃，timeline 输出是 dead code，改动无收益且扩大范围。

### 需求 B：独立 React root + AppProviders

**唯一实现路径**：`renderKnowledge` 在 `registerAIAgentPIU.tsx` 的 `createHandlers` 新增，调用 `renderKnowledgeWithConfig` 函数。该函数用独立模块级变量（`knowledgeActiveContainerId`/`knowledgeActiveRoot`/`knowledgeActiveContainer`）管理 React root，不与 `loadAIAgentWithConfig` 共享状态。root 创建时用 `renderRoot(container, <AppProviders ...><KnowledgeSourceList .../></AppProviders>, ...)` 包裹。

为什么不共享 `loadAIAgentWithConfig` 的 root 状态：`renderKnowledge` 与 `loadAIAgent` 完全独立，不是 PIU 启动入口。共享状态会导致 `loadAIAgent` 和 `renderKnowledge` 互相 unmount 对方的 root。

theme 自动跟随：`AppProviders` 会设 `document.documentElement` 的 `data-theme` 属性，所有组件用 CSS 变量，antd `Modal` 走 ConfigProvider theme。所以 `MarkdownContent` 和 `Modal` 自动适配当前主题，无需额外处理。

重复调用同一 containerId：复用 root 重新渲染。新 containerId：unmount 旧 root、清空旧容器、建新 root。与 `loadAIAgentWithConfig` 同模式。

**列表项标题解析**：`source` 按 `|` 分割取第一项 trim 非空 → 用；空 → `title` trim 非空 → 用；空 → `knowledge` 前 100 字符。

**详情弹窗**：点击列表项打开 antd `Modal`，用 `MarkdownContent` 解析 `knowledge`。同一时间最多一个 Modal，点击新项替换内容。

**放弃的备选方案**：
- 修改 `prel.ts` 的 `PIU.attach` 类型加 `renderKnowledge`：放弃，与 `minimizeAIAgent`/`loadAIAgent` 同形同策，这些 handler 只在 `createHandlers` 返回类型声明。
- 复用 `loadAIAgentWithConfig` 的 root：放弃，两者独立，共享 root 状态会互相破坏。
- 不套 AppProviders 直接 createRoot：放弃，antd Modal 和 MarkdownContent 依赖 ConfigProvider/theme/locale context。

### 需求 C：结构化事件关联、答案去重与面板可见性

**唯一实现路径**：保持后端 stream contract 和事件持久化策略不变，只在共享浏览器投影层修正 envelope merge identity、process entry association、answer presentation 和 ProcessPanel 本地 view state。

- `buildEnvelopeMergeIdentity` 对 `TOOL_STRUCTURED_DELTA` 在 attempt/eventType/sequence 之外追加 `toolEventType + toolCallId`（依次回退 invocationId、metadata.invocationId、capabilityId），使同 sequence 的 TITLE 与 DETAIL 在 live/history 合并时保持为独立事件。
- `buildProcessEntries` 为 TITLE 和 SUB_TITLE 分别维护 correlation-to-entry index。DETAIL 族事件存在稳定关联标识时只更新对应条目；找不到对应 TITLE 时忽略，禁止串到其他节点。仅无稳定关联标识的旧事件使用最近 TITLE/SUB_TITLE 回退。
- `buildAnswerSegments` 先收集结构化 TEXT ANSWER 的完整文本；LLM answer 与其中任一文本完全一致时跳过该 LLM 投影。不同文本以及 DSL/PIU/ACTION/OPERATOR/FILE 等结构化答案继续按既有 sequence 规则共存。
- `ProcessPanel` 从 `processEntries` 识别 TITLE/SUB_TITLE。结构化 workflow 的初始模式固定为 auto-expanded，settled 自动折叠 effect 对该类条目不生效；user-collapsed/user-expanded 优先级不变。普通 settled 过程条目仍 auto-collapsed。

不在前端删除后台事件或改变 canonical timeline；重复事件仍可用于实时投影与历史回放，浏览器仅消除同语义的视觉重复。

## 质量属性设计（Quality Attributes）

| 质量属性 | 设计结论 | 验证入口 |
|---|---|---|
| 安全 | `renderKnowledge` 只接受 `containerId` 和 `data` 数组，不接收身份、agent scope 或 capability 参数；detail 字符串只含 TEXT content，非 TEXT 不进 summary。无新增 secret/prompt 泄露面。 | 代码审查确认无身份/credential 字段进入 payload |
| 性能/容量 | structuredSegments 数组随事件增长，单 turn 内 DETAIL 事件数量有限，无内存膨胀风险。`renderKnowledge` 列表大小由调用方决定，复用 root 不重复创建。 | `processDetails.test.ts` 多事件累积测试 |
| 可靠性/恢复 | 纯前端渲染变更，无 stream 连接、持久化或 terminal commit 影响。`renderKnowledge` 容器不存在时 warn 返回，不崩溃。 | handler 缺 containerId 测试、空 data 测试 |
| 可维护性 | 复用 `AnswerSegment` 类型和 `AnswerSegments` 组件，不新建平行类型/组件；`renderKnowledge` 与 `loadAIAgent` 同形 root 管理。timeline 版不改，范围最小。 | 架构检查确认无平行类型、无 private import |
| 可测试性 | `buildProcessEntries` 是纯函数，segment 构建可单测；`AnswerSegments` 组件已有测试。`renderKnowledge` handler 注册、root 管理、列表标题解析、Modal 交互可单测。 | `processDetails.test.ts`、`piu-runtime-contract.test.tsx` |
| 审计/可追溯性 | 无新增日志/审计事件；纯前端 display 层变更。 | 不适用 |

## 验证映射（Verification Map）

| 约束 | Task | 验证入口 |
|---|---|---|
| DETAIL/SUB_DETAIL/SUB_CONCLUSION 累积 structuredSegments | A.1 | `processDetails.test.ts` 断言 segment 数组内容与顺序 |
| TEXT 进 detail 字符串，非 TEXT 不进 | A.1 | `processDetails.test.ts` 断言 detail 只含 TEXT |
| 相邻 TEXT 段合并，messageType 变化打断 | A.1 | `processDetails.test.ts` 混合事件测试 |
| ProcessPanel 用 AnswerSegments 渲染 structuredSegments | A.2 | 渲染测试断言 AnswerSegments 组件存在 |
| empty structuredSegments 回退现有渲染 | A.2 | 渲染测试断言回退分支 |
| renderKnowledge 仅在 registerAIAgentPIU 注册 | B.1 | `piu-runtime-contract.test.tsx` 断言 immersive/local 不注册 |
| 独立 root + AppProviders，不共享 loadAIAgent root | B.2 | `piu-runtime-contract.test.tsx` 断言独立 root 管理 |
| 列表项标题解析优先级 | B.3 | 单测覆盖 source/title/knowledge 三级 fallback |
| 点击打开 Modal + MarkdownContent | B.3 | 渲染测试断言 Modal 和 MarkdownContent |
| theme 自动跟随 | B.2 | 代码审查确认 AppProviders 包裹 |
| 不修改 prel.ts | B.1 | 架构检查确认 prel.ts 无改动 |
| 同 sequence 的 TITLE/DETAIL 合并后均保留 | C.1 | `streamingHelpers.test.ts` 断言 merge identity 不同 |
| 交错 DETAIL 按 toolCallId 归并且不串位 | C.2 | `processDetails.test.ts` 覆盖主/子条目、缺失 TITLE 与旧事件回退 |
| 同文结构化 ANSWER 与 LLM answer 只展示一次 | C.3 | `answerContentExpandPanel.test.ts` 断言单一 structured segment |
| settled 首屏结构化流程默认展示 TITLE 与 DETAIL | C.4 | `ProcessPanel.test.ts` 断言真实 DOM 可见；普通过程仍折叠 |

## 文档承载决策（Documentation Ownership）

- 行为契约：`openspec/specs/agent-web-structured-message-rendering/spec.md`（需求 A）、`openspec/specs/agent-web-piu-knowledge-render/spec.md`（需求 B）
- 架构和跨模块设计：无（纯前端 `agent-web` 内部变更，无跨模块流程）
- 模块设计：`openspec/designs/modules/agent-web.md`（归档时补充结构化详情渲染和 PIU 知识来源渲染的模块职责）
- ADR：无（复用现有 `AnswerSegment`/`AppProviders`/root 管理模式，无长期技术取舍）
- 导航：`openspec/designs/spec-to-design-map.md`（归档时新增 `agent-web-piu-knowledge-render` 导航，更新 `agent-web-structured-message-rendering` 导航）

## 风险与取舍（Risks / Trade-offs）

- [structuredSegments 数组与 detail 字符串双轨] -> detail 只含 TEXT 供现有消费者使用，structuredSegments 承载全部内容，两者并行不冲突。TEXT 段同时进 detail 和 structuredSegments，渲染时 structuredSegments 优先，detail 仅用于 summary/展开判断。
- [非 TEXT DETAIL 不进 detail 可能影响 isLongProcessDetail 判断] -> 接受。长文本检测原本针对纯文本场景；非 TEXT 内容由结构化组件渲染，不需要长文本展开判断。
- [renderKnowledge 独立 root 增加内存] -> 接受。与 `loadAIAgent` 同模式，调用方负责控制调用频率。新 containerId 时旧 root 被 unmount。
- [spec gap: buildProcessTimelineEntries vs buildProcessEntries] -> 本 change 修改 display 版 `buildProcessEntries`，spec requirement 重述时明确指向 display 版。timeline 版 dead code 不在本 change 清理范围。
- [后台实时事件与完成快照内容重复] -> 保留后端事实与持久化语义；前端只在同文 TEXT ANSWER 上做视觉去重，不做通用 accumulated 压缩。

## 迁移计划（Migration Plan）

无数据迁移。变更纯前端，发布后直接生效。未使用结构化 DETAIL 的能力输出不受影响（structuredSegments 为空时回退现有渲染）。未调用 `renderKnowledge` 的集成方不受影响。

## 归档前更新基线（Baseline Promotion Plan）

- `openspec/specs/agent-web-structured-message-rendering/spec.md`：归档时同步 DETAIL/SUB_DETAIL/SUB_CONCLUSION 的 structuredSegments 累积与渲染行为契约。
- `openspec/specs/agent-web-piu-knowledge-render/spec.md`：归档时新增 PIU 知识来源渲染行为契约。
- `openspec/specs/agent-web-process-panel/spec.md`：归档时同步结构化 workflow 默认展开行为。
- `openspec/designs/modules/agent-web.md`：归档时补充结构化详情渲染（复用 AnswerSegment）和 PIU 知识来源渲染（独立 root + AppProviders）的模块职责。
- `openspec/designs/spec-to-design-map.md`：归档时新增 `agent-web-piu-knowledge-render` 导航，更新 `agent-web-structured-message-rendering` 导航。

## 待确认问题（Open Questions）

无。

## 长期基线刷新计划

本节将旧模板的“归档前更新基线”归一为可审计的归档门禁；以下均为**归档前待执行**，不表示 stable baseline 已刷新。

- **Function：**以 `FN-5.6-向用户提问` 为唯一用户可见行为 owner；若本 change 增加的行为不能被该 Function 的既有边界完整表达，先在同一能力域新增一个单一职责 Function，再更新 `openspec/designs/functions/index.md`，不得把实现细节直接写入 Function。
- **Stable spec：**将 delta Requirement 合并至 `openspec/specs/agent-web-piu-knowledge-render/spec.md`、`openspec/specs/agent-web-process-panel/spec.md`、`openspec/specs/agent-web-structured-message-rendering/spec.md`，逐条核对 Requirement 标题、MUST/SHALL 语义、场景、迁移和 metadata；不得以 `--skip-specs` 绕过同名 Requirement 重叠。
- **长期设计：**先执行本 design/proposal 已列出的“归档前更新基线”设计 owner；再在 `openspec/designs/spec-to-design-map.md` 为上述 stable spec 写入该 Function、实际承载的 architecture/module/ADR 与验证入口。若现有 map 无该 spec 行，先创建该行，而非把 change-local design 当作长期设计。
- **归档判定：**Function、stable spec、长期设计和 map 四端均完成 diff 审阅且 `openspec validate --all --strict` 通过后，才允许归档；任一端无法唯一归属时保留 active 并标记阻塞。

## 归档阻塞记录（2026-07-31）

- **状态：**保持 active，禁止使用 `--skip-specs`。
- **原因：**stable `agent-web-structured-message-rendering` 中找不到 delta 的 `Non-TEXT messageType content is rendered by structured renderer in process panel` Requirement。
- **解除条件：**逐 Requirement 建立 delta、stable target、Function 与长期设计的双端映射；确认正文、元数据、Scenario 和任何 REMOVED→ADDED/MODIFIED 迁移均完整同步后，再重新执行 archive。
