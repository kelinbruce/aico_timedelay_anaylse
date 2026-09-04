## 背景和现状（Context）

普通 assistant 正文的当前生产调用链是：

`MessageList -> TurnBlockComponent -> buildAnswerContent -> splitProgressiveMarkdownContent -> MarkdownContent -> MarkdownWithTables`

`buildAnswerContent` 选择普通 assistant `LLM_CONTENT_DELTA`，`TurnBlockComponent` 把可稳定展示的正文交给 `MarkdownContent`，后者再通过 `MarkdownWithTables` 区分普通 Markdown、pipe table 和 Mermaid。普通 Markdown 最终形成 HTML 语义结构；表格由 `MarkdownWithTables` 识别、整理并输出 table/thead/tbody。

当前 implementation-vs-spec gap 是：上述已完成普通正文的 Markdown、GFM 风格表格和普通代码行为已实现且有定向测试，但 Stable Specs 没有对应 owner。本 change 用新的独立 capability 填补规格缺口，不修改现有生产调用链。未完成 turn 的不稳定流式尾部仍由 `PlainTextLiveContent` 展示，不属于本 capability。

当前 owner 已随仓库归档状态更新：structured message 与 delta 分别由 Stable `agent-web-structured-message-rendering`、`tool-structured-delta` 拥有，Expand Panel 由 Stable `agent-web-expand-panel` 拥有，AICO answer actions 由 Stable `aico-piu-injection` 与 `aico-config-contract` 拥有；`add-ts-task-channel` 仍是未归档的 task transport owner。本 change 不能因这些路径复用 `MarkdownContent` 而接管其 dispatch、生命周期或交互契约。

## 目标和非目标（Goals / Non-Goals）

**目标：**

- 为状态为 `COMPLETED` 的普通 assistant `LLM_CONTENT_DELTA` 正文建立一个唯一的 Markdown 渲染行为 owner。
- 规格化当前测试证明的常用 Markdown、普通代码和 GFM 风格 pipe table 行为。
- 用真实 `AppProviders` 装配的窄测试证明用户可观察语义，不改变生产实现。

**非目标：**

- 不定义 `LLM_CONTENT_DELTA` 的聚合、排序、history 合并或 progressive reveal 算法。
- 不定义 structured `TOOL_STRUCTURED_DELTA`、Expand Panel、Capability result、ProcessPanel、PIU、DSL、FILE、ACTION 或 OPERATOR。
- 不定义 Mermaid 检测、渲染、SVG 清理、异步尺寸、滚动或错误日志。
- 不承诺完整 GFM、任意畸形 Markdown 修复、语法高亮、代码执行、代码复制按钮或精确 CSS。
- 不把当前 `xss` 调用提升为完整 sanitization 安全契约，也不处理 raw parser error 日志冲突。
- 不修改 Stable Specs、长期设计文档或其他未归档 change；这些内容只在后续单独授权的归档前 promotion 阶段更新。

## 设计决策（Decisions）

### D1. 用独立 capability 拥有普通 assistant 正文语义

唯一选定的规格 owner 是 `agent-web-assistant-markdown-rendering`。它只接收状态为 `COMPLETED` 的普通 assistant `LLM_CONTENT_DELTA` 已形成的可见正文作为行为边界，不重新定义上游 stream event、answer selection、history source 或未完成流式尾部。

放弃把行为并入 `agent-web-structured-message-rendering`：该 capability 的输入和 dispatch owner 是 `TOOL_STRUCTURED_DELTA`，合并会把普通回答与结构化消息的生命周期混为一体。

放弃仅把行为写入通用 `agent-web` module 设计而不建立行为规格：`openspec/designs/modules/agent-web.md` 现在是 Stable 长期 module owner，但 module 设计不能替代可归档、可验证的窄行为 capability。

### D2. 保持现有 renderer 调用链，不增加生产实现

唯一选定的实现路径是保留当前 `TurnBlockComponent -> MarkdownContent -> MarkdownWithTables` 调用链。普通 Markdown 和代码由现有 Markdown 路径形成语义元素，pipe table 由现有表格分段和 `TableBlock` 路径形成语义表格。

本 change 不新增 renderer、adapter、配置、依赖或并行解析路径。structured TEXT 和 Expand Panel TEXT 可以继续复用 `MarkdownContent`，但这种代码复用不改变它们各自 Stable capability 的行为 owner。

### D3. 只规格化逐项有绿色测试的 table 输入

表格契约限定为测试已经覆盖的输入：带或不带首尾 pipe 的标准表格、cell 内 escaped/inline-code pipe 和行内 Markdown、跨行边界片段、同行拼接、单行扁平化、空行分隔数据行，以及代码围栏排除。

放弃声明完整 GFM 或通用容错 parser：当前实现和测试没有证明这些更宽承诺，且会把私有正则/整理算法错误地固化成产品接口。

### D4. 用窄表征测试修复证据，不治理整个 TurnBlock 测试套件

`markdown-gfm-table.test.tsx` 使用真实 `AppProviders` 装配状态为 `COMPLETED` 的现有表格场景；`assistant-markdown-rendering.test.tsx` 只覆盖已完成普通正文的标题、列表、引用、强调、inline code 和 fenced code 语义。本 capability 的 Requirement 证据只取两份测试中的语义 DOM 和 negative assertions；表格套件保留的既有宽度、overflow、margin 和 fontSize 断言不属于本 capability 契约。

放弃给整个 `TurnBlock.test.tsx` 统一加 Provider：该文件还包含 actions、动画、过程面板和 Mermaid 等其他行为，整体修复会扩大当前工作包，并会把既有无关断言漂移混入本 change。

### D5. Mermaid 和安全冲突保持独立

Mermaid 当前存在 dangerous `href` 未覆盖和 raw render error logging 冲突，必须由独立 change 先定义安全目标并修改生产实现。本 change 的 spec、tasks 和完成判定均不得把 Mermaid 或完整 sanitization 声明为已满足。

## 质量属性设计（Quality Attributes）

| 质量属性 | 设计结论 | 验证入口 |
|---|---|---|
| 安全 | 不改变任何渲染生产代码，也不把现有 `xss` 或 Mermaid 清理提升为安全保证；review 必须确认 spec 中没有 dangerous href、完整 sanitization 或 raw error 安全结论。 | Task 2.1 的范围/冲突扫描；独立 review |
| 性能/容量 | 不增加 parser、渲染分支、网络请求、缓存或生产时开销，因此不新增性能/容量契约。 | Task 1.1 的生产 diff 检查 |
| 可靠性/恢复 | 只规格化确定性 DOM 结果，不改变 stream lifecycle、terminal state、retry 或恢复路径。 | Task 1.2、1.3 的定向表征测试 |
| 可维护性 | 一个 capability 只拥有普通正文语义；shared renderer 的复用不改变 Stable structured/expand owner，避免平行实现和 owner 重叠。 | Task 2.1 的 Stable/Active owner 扫描 |
| 可测试性 | 每个 Requirement 映射到状态为 `COMPLETED`、真实 Provider 装配下的语义 DOM 或 negative assertion；不把 parser/library 或复用套件中的既有布局断言提升为 capability 契约。 | `assistant-markdown-rendering.test.tsx`、`markdown-gfm-table.test.tsx` |
| 审计/可追溯性 | 不新增 log、trace 或 audit event；规格、测试命令和 review 结果保存在 change artifacts 中，Mermaid raw error 冲突继续单独登记。 | Task 2.2-2.4 的验证结果；独立 review |

## 验证映射（Verification Map）

| 约束 | Task | 验证入口 |
|---|---|---|
| 已完成普通 assistant 正文展示常用 Markdown 语义 | 1.3 | `npm test -- tests/assistant-markdown-rendering.test.tsx` |
| 已完成普通 assistant 正文展示 inline/fenced code 语义 | 1.3 | `npm test -- tests/assistant-markdown-rendering.test.tsx` |
| 带/不带边界 pipe 的表格形成 table/thead/tbody | 1.2 | `npm test -- tests/markdown-gfm-table.test.tsx` |
| cell 内 pipe 和 inline Markdown 保持在正确单元格 | 1.2 | `npm test -- tests/markdown-gfm-table.test.tsx` |
| code fence 内表格形状文本不转成表格 | 1.2 | `npm test -- tests/markdown-gfm-table.test.tsx` |
| 已验证的跨行、拼接、扁平化和空行分隔表格可恢复 | 1.2 | `npm test -- tests/markdown-gfm-table.test.tsx` |
| 不接管 Mermaid、structured/expand、actions、stream aggregation 或安全保证 | 2.1 | Stable/Active owner 与 forbidden-scope review |
| change 结构和 delta spec 严格有效 | 2.3 | `openspec validate establish-agent-web-assistant-markdown-rendering --strict` |
| 不与其他 change/spec 发生全局校验冲突 | 2.4 | `openspec validate --all --strict` |

## 文档承载决策（Documentation Ownership）

- 行为契约：归档后由 `openspec/specs/agent-web-assistant-markdown-rendering/spec.md` 唯一承载。
- 架构和跨模块设计：无新增长期事实；本 change 不拥有 stream、runtime、DTO 或 persistence 设计。
- 模块设计：归档前在 `openspec/designs/modules/agent-web.md` 提炼 renderer 职责、现有调用链、复用边界和 Mermaid 非职责。
- ADR：无；没有新增依赖、架构模式或需要长期保留取舍理由的决策。
- 导航：归档前由 `openspec/designs/spec-to-design-map.md` 增加新 capability、module 设计和测试入口导航。

## 风险与取舍（Risks / Trade-offs）

- [风险] “GFM 风格”被误读为完整 GFM 支持 -> spec 明确限定已验证输入形态，并逐 scenario 映射测试。
- [风险] shared `MarkdownContent` 被误解为 structured/expand owner 转移 -> proposal、design 和 owner review 同时声明代码复用不转移行为 owner。
- [风险] 当前表格整理规则未来变化 -> Stable contract 只保留用户可观察的受支持输入和语义结果，不固化 parser/library 或私有正则。
- [风险] Mermaid 安全冲突被当前完成状态掩盖 -> Mermaid 明确作为非目标，独立 review 必须确认其未进入 Requirement 或完成声明。
- [取舍] 不修复完整 `TurnBlock.test.tsx` 的既有失败 -> 保持本工作包只对两类 Requirement 提供绿色证据，其他失败由对应 owner 单独处理。

## 迁移计划（Migration Plan）

无数据、API、配置或生产部署迁移。本 change 只增加 active spec 和测试证据；回滚时可删除本 change 新增测试及 change 目录，不影响生产行为。change 保持未归档，归档必须由后续单独授权。

## 归档前更新基线（Baseline Promotion Plan）

- `openspec/specs/agent-web-assistant-markdown-rendering/spec.md`：提升本 change 中仍成立的三个 Requirement 和对应 scenarios。
- `openspec/overview.md`：无。
- `openspec/designs/architecture/<topic>.md`：无。
- `openspec/designs/modules/agent-web.md`：补充普通正文 renderer 的职责、现有调用链、shared renderer 复用边界和 Mermaid 非职责。
- `openspec/designs/adr/<id>.md`：无。
- `openspec/designs/spec-to-design-map.md`：增加 capability 到 `agent-web` module 设计及两份定向测试的导航。

上述长期基线只在归档前更新阶段处理，当前实施阶段不得直接修改。

## 待确认问题（Open Questions）

无。Mermaid 安全和 raw error logging 是明确排除的独立问题，不是本 change 的待定设计项。
