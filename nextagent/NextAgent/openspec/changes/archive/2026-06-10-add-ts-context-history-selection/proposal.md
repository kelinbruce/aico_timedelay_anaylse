## 1. 解决的问题是什么

当前系统已具备上下文装配、历史读取和后续预算治理能力，但"历史消息如何形成一份可供后续流程消费的候选集"始终没有独立、稳定的规格。

现有约束只零散说明了两点：prior conversation 必须以完整可见 turn 为单位参与；被替换或隐藏的历史默认不进入模型可见上下文。但仍缺一份规格统一回答：

- 历史选择在请求生命周期的哪个阶段触发；
- current request 与 prior conversation 的选择顺序是什么；
- complete turn 的判断边界是什么；
- active context 引用读取失败时如何显式失败，而不是静默降级成 current-request-only。

没有这份规格，后续 budget / compression / summary / prompt-shaping change 就缺一个稳定的输入边界，各自对"候选集长什么样"做隐式假设。本 change 把"历史候选集选择"固化成一个稳定黑盒行为，不绑定到当前代码层级。

## 2. 黑盒目标

- 历史选择在一次同步上下文装配内完成；调用方只能提供 location + intent，不得预选历史条目。
- current request 永远先于 prior conversation 在模型可见上下文中建立；current request 不是"最近 N 条历史消息"，而是由 `requestId` 锚定的当前请求事实集合：root user message + 同一 `requestId`/`runId` 下协议必需消息 + latest-request-required attachment/tool state；required current-request context 无法建立时显式失败，绝不静默丢弃。
- prior conversation 只能以完整可见 turn（根用户消息 + 完整有序工具协议 + 终态 assistant 响应）进入候选集；不完整 turn 与 hidden replacement 整体排除。
- 模型可见历史的唯一 authority 是 `ActiveContextView`，不扫描全量 session transcript。
- 历史选择阶段只输出全部合法候选集，不在该阶段做预算截断、压缩或替换；任何合法候选被省略只能归因于既有后续策略。
- 任一 active context 引用无法被 owner/session/agent scope 安全解析时显式失败，不得归类为 prior history 继续。

## 3. 核心设计和规格

本 change 的核心规格是：

- **触发点**：历史选择发生在 `assemble()` 的同步装配流程内，因为该阶段已拥有 active context 读取、message refs 加载和后续窗口策略入口。
- **判断顺序**：读取 `ActiveContextView` → 解析 current request records → 解析 prior conversation 可见历史 → 按 `requestId`（root user message identity）分组 complete visible turn → 排除 hidden replacement 与不完整 turn → 形成 raw candidate set → 输出。
- **current-request-first**：current request 是 latest request correctness 的最小基础输入，永远先于 prior 建立；任何含 prior 的最终 `selectedMessageRefs` 必含全部 required current-request records。
- **complete turn 边界**：一个 prior turn 必须同时满足"含 root user message + 工具协议序列完整有序 + 末条可见消息是非 tool-use 终态 assistant response"才可进入；否则整体排除，不部分保留。
- **协议完整性**：完整 tool-use / capability-result / terminal response 序列整体保留；pending / orphan tool fragment 整体排除，不得进入最终模型输入。
- **输出边界**：历史候选集是 Context Engine 内部中间结果，不新增 public contract、不新增持久化 selection record、不扩展顶层 SPI。既有后续策略消费候选集后，仍通过核心契约的 `ContextAssembly.selectedMessageRefs` 表达最终进入模型上下文的 immutable active-context messages；该产出必须以本次装配读取的单一 `ActiveContextView` snapshot 为唯一权威。render 阶段不得静默跳过缺失或不再可见的 selected ref，必须显式 failure 或 explicit degrade（render 侧读取收紧归 `add-ts-context-prompt-shaping`）。**`activeContextVersion` per-ref 锚点机制（早期 spec 草稿中的一部分）已经在 2026-06-10 的 spec-to-impl 审查中被判定为对当前架构的过度设计，相应 sub-requirement 已从 spec 删除**：`SessionMessage` append-only + same-session lane 串行已经保证 assemble 用的 snapshot 在 render 时仍可用，per-ref version anchor 不再必要。
- **失败边界**：current request 读取失败、或任一 active context message ref 无法安全解析时，返回显式 safe failure，不静默降级。

详细的 observable 行为与失败边界以 `specs/context-engine/spec.md` 的 5 个 requirement / 12 个 scenario 为准。具体选择序列、分组算法、诊断形状属于 design，可在不改变外部可观察行为与架构不变量的前提下演进。

## 4. 变更范围（What Changes）

- **新增** `add-ts-context-history-selection` change，定义 current request 与 prior conversation 如何形成候选上下文集。
- **新增** `context-engine` capability 基线：本 change 是该 capability 的第一个 delta，以 `## ADDED Requirements` 建立历史选择触发点、输入对象、顺序、complete turn 规则和失败边界；归档时整体迁入 `openspec/specs/context-engine/spec.md`，供后续并行 change 以 `## MODIFIED Requirements` 叠加。

### 修改的 Capability

- `context-engine`（新建基线）

## 5. 与相邻 change 的边界

本 change 只承接 Context Assembly 共享输入中的"历史候选集选择"子范围；预算、压缩、摘要、大内容、附件由相邻 change 在此基础上继续治理：

| 相邻 change | 承接范围 | 与本 change 的边界 |
|---|---|---|
| `add-ts-context-budget-explainability` | 历史预算占比、超预算 explainability、minimum safe context 显式失败/降级 | 只消费本 change 产出的候选集，不重写候选集规则 |
| `add-ts-context-compression` / `add-ts-traceable-summary-generation` | 较旧历史摘要、prefix compaction、summary metadata、摘要失败降级 | 只在候选集进入后续窗口治理时处理 |
| `add-ts-large-content-references` / attachment changes | 附件、大工具结果的安全 descriptor、引用策略、可用性失败 | 被排除的 prior turn 不得绕过 `ActiveContextView` 重新进入附件上下文 |
| `add-ts-context-prompt-shaping` | prompt section ordering、selected history slot、current input slot 的最终装配 | 只消费 `selectedMessageRefs`，不参与候选集选择 |

## 6. 影响范围（Impact）

- 上下文装配内部需形成可检查的完整历史候选集，再交既有后续策略生成最终 `ContextAssembly.selectedMessageRefs`。
- 测试需覆盖 complete turn、hidden replacement exclusion、current-request-first 和 unresolvable ref 显式失败。
- 本 change 为 spec-only delta，`agent-context-engine` 实现与 npm workspace 脚手架尚未建立，实现任务在后续 change 落地。

## 7. 非目标（Non-Goals）

- 不定义 prompt template、model profile 选择或 model routing。
- 不定义摘要生成与正式压缩算法。
- 不定义或修改预算分配、窗口截断、压缩、替代或降级策略。
- 不定义 attachment、memory、runtime context、project instructions 或其他非历史 context source 的行为。
- 不引入新的持久化对象、后台任务或调用方预选历史字段。

## 8. 归档基线说明（Archive Baseline Notes）

归档时把稳定结论同步到以下既有长期文档，不新增独立 baseline design 文档：

- `openspec/specs/context-engine/spec.md`（新建 capability 基线）
- `openspec/designs/modules/agent-context-engine.md`
- `openspec/designs/architecture/core-contracts.md`
- `openspec/designs/architecture/ts-backend-architecture.md`
