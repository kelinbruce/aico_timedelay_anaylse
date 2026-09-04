## 背景和现行状态（Context）

本设计只改动一件事情：*历史候选集如何在上一次上下文装配中被选出来。*

它不回答预算 explainability、真正的压缩算法、摘要持久化或 UI 展示，只定义候选集选择本身的稳定顺序和失败边界。

## 目标和现行状态（Goals / Non-Goals）

### 目标

- 定义历史选择的唯一触发机制：在一次同步上下文装配中完成。
- 定义 current request 与 prior conversation 的选择顺序。
- 定义 complete turn、visible-history、hidden replacement exclusion 的稳定规则。
- 定义内部输出产物：完整合法的 current-request records 与 prior-turn candidates，供既有后续策略生成最终 `ContextAssembly.selectedMessageRefs`。

### 非目标

- 不定义 prompt shaping、model routing、summary generation 或 output UI。
- 不定义 Query Policy 的预算分配、窗口截断、压缩、摘要或 insufficient-context 策略。
- 不定义 attachment descriptor、attachment content loading、attachment compaction 或 attachment availability 行为。
- 不定义具体类名、现成 helper 名称或算法微调实现；实现仍必须落在 `agent-context-engine` owner 内，并遵守既有 contract/gateway 边界。

## 选定方案（Chosen Design）

### 1. 触发机制：同步上下文装配内完成

历史选择必须发生在一次同步上下文装配流程之内。调用方只能提供 location + intent；不得预选历史条目。

### 2. 输入与前置条件

历史选择阶段的最小输入是：

- 当前请求定位信息（location，来自 `ContextAssemblyRequest`，如 `requestId`）
- 当前步骤用途（intent）

注意：prior conversation 可见历史**不是调用方传入的入参**，而是本阶段从权威来源 `ActiveContextView` 自行推导的。调用方只给 location + intent。

前置条件：

- owner scope 已通过校验；
- current request 必须可被安全消费；
- 调用方不得传入 message refs、turn refs 或其他预选条目；
- 模型可见历史的权威来源是 `ActiveContextView`，不是全量 transcript/session history scan。

### 2.1 输入 / 输出边界

本阶段是 Context Engine 装配流程内的一段，输入和输出边界如下：

```text
输入（调用方可提供）            权威来源（本阶段自行读取）
┌──────────────────────┐      ┌────────────────────────────┐
│ ContextAssemblyRequest│      │ ActiveContextView           │
│  - requestId(location)│      │  -> immutable session       │
│  - intent             │      │     message records         │
└──────────┬───────────┘      └─────────────┬──────────────┘
           │                                │
           │  调用方不得传入 message/turn refs │
           ▼                                ▼
      ┌──────────────────────────────────────────────┐
      │ History Selection（本 change）                  │
      │  解析 current request -> 分组 prior turn        │
      │  -> 排除 hidden replacement / 不完整 turn        │
      │  -> 形成完整合法候选集                           │
      └──────────────────────┬───────────────────────┘
                             │  内部中间结果（非 public contract）
                             ▼
      ┌──────────────────────────────────────────────┐
      │ 输出：history candidate set                     │
      │  - required current-request records（必含）      │
      │  - optional prior-turn candidates（仅 complete   │
      │    visible turn）                               │
      │  约束：不新增 public DTO / 持久化 record / SPI    │
      └──────────────────────┬───────────────────────┘
                             │  交给既有 downstream policy
                             ▼
      ┌──────────────────────────────────────────────┐
      │ downstream context-window / query-policy /      │
      │ prompt-shaping（不属本 change）                  │
      │  -> 决定最终 ContextAssembly.selectedMessageRefs │
      └──────────────────────────────────────────────┘
```

失败边界：current request 无法建立、或任一 `ActiveContextView` message ref 无法安全解析时，本阶段返回显式 safe failure，不产出"只含 prior history"或"空 current request"的伪成功候选集。

### 3. 核心判断顺序

历史选择必须按以下顺序执行：

1. 读取当前 `ActiveContextView`；
2. 基于 active context items 解析 current request 可见消息；
3. 基于 active context items 解析 prior conversation 可见历史；
4. 对 prior conversation 按 complete visible turn 分组。实现阶段以 `requestId`（root user message identity）为分组键边界，spec 不固化具体取值方式；同一 `requestId` 视为同一 turn，跨 `requestId` 不合并。
5. 排除 hidden replacement 和不完整 turn；
6. 形成 raw history candidate set；
7. 输出完整合法的 current-request records 与 prior-turn candidates；本阶段到此结束。

### 4. current request 优先

current request 是 latest request correctness 的最小基础输入，必须先于 prior conversation 建立。它不是"最近 N 条历史消息"，而是由 `requestId`（root user request message identity）锚定的当前请求事实集合：root user message + 同一 `requestId`/`runId` 下协议必需消息（如 assistant tool-use 与 capability-result）+ latest-request-required attachment/tool state。"优先"在实现上有三层确定含义：

- **解析顺序**：先从 `ActiveContextView` 解析出全部 required current-request records，再去分组余下的 prior conversation；prior 分组不得反过来影响 current request 的识别。
- **保护语义**：current-request records 是 required context，不可被本阶段省略；prior turn 是 optional candidate。两者的"required vs optional"标签随候选集一起交给 downstream policy，使后续窗口裁剪只能先丢 optional prior、绝不丢 required current request。
- **失败而非降级**：若 required current-request context 无法建立，本阶段返回显式 safe failure，不得通过"只保留 prior history"或"返回空 current request"伪装成功。

本阶段不决定 current request 与 prior 在最终 prompt 中的排列位置（属 prompt-shaping），只确定"current request 先被解析、被标记为 required、缺失即失败"。

### 5. prior conversation 只能按完整 turn 进入

一个 prior turn 只有在满足以下条件时才可进入候选集：

- 包含 root user message；
- 中间 tool-use / capability-result 协议序列完整且有序；
- 最后一条可见消息是非 tool-use 的终态 assistant response。

不完整 turn 必须整体排除，而不是部分保留。

### 6. hidden replacement 默认排除

retry / edit replacement 形成的 hidden history 默认不进入模型可见上下文。除非显式 audit/diagnostic policy 启用，否则不得重新引入。

### 7. 历史选择不负责预算与压缩

历史选择只负责形成全部合法候选集，不执行窗口预算分配、截断、压缩、替代或预算降级。本 change 不定义这些后续流程。

### 8. 输出与副作用

历史候选集是 Context Engine 内部中间结果，不新增 public contract。既有后续策略消费候选集后，仍通过核心契约输出：

- `ContextAssembly.selectedMessageRefs`

`selectedMessageRefs` 表达最终进入模型上下文的 immutable active-context messages，而不是未经后续策略处理的完整候选集。本阶段读取的是单一 `ActiveContextView` snapshot；最终产出的 `selectedMessageRefs` 必须只来自该 snapshot，render 阶段不得静默跳过缺失或不再可见的 selected ref（render 侧读取收紧归 `add-ts-context-prompt-shaping`）。

> 注（2026-06-10，spec-to-impl 审查后）：早期 spec 草稿要求 `selectedMessageRefs` 携带每条 ref 对应的 `activeContextVersion` 作为解析锚点，并要求 render 按版本号回校。该 sub-requirement 已从 spec 删除。理由：`SessionMessage` 在本仓库契约里是 append-only（核心 fact 不会被原地修改）；`same-session lane scheduler` 默认同一 session 同一时间最多一个 run 在 executing/terminal-writing path，没有"assemble 已完成、render 尚未进行时另一个 request 改了 active context"这种 race window。anchor 机制要防的故障在当前架构里不会发生；保留它要扩 `agent-contracts/context` 公共契约 + 在 render 加版本对账，成本明显大于收益。被保留的本质保护是：assemble 内只读一次 snapshot（impl 内已成立）+ render 不得静默 skip（由本 change 的 render 路径补足）。

selection diagnostics 不作为新的 public contract 字段，也不进入 `RenderedModelInput`。

允许产生结构化日志和诊断，但不新增持久化 selection record。

## 最小增量路径

- `agent-context-engine` 在 `assemble(ContextAssemblyRequest)` 的同步装配流程内读取当前 `ActiveContextView`，并以 active context items 作为唯一模型可见历史 authority。
- Context Engine 解析 active context item 指向的 immutable session message records；任何 ref 无法按当前 owner/session/agent scope 安全加载或校验时返回 explicit safe failure。
- Context Engine 先解析并保留 current request records，再从余下 visible active-context messages 中按 `requestId`（root user message identity）分组 prior conversation。
- prior conversation candidate 只保留 complete visible turn：包含 root user message、完整有序的 tool-use / capability-result 协议序列，以及终态非 tool-use assistant response；pending、orphan、hidden replacement 或不完整 turn 整体排除。
- history candidate selection 输出完整合法候选集后即结束；既有 downstream context-window / query-policy / prompt-shaping 流程继续决定最终 `ContextAssembly.selectedMessageRefs`，本 change 不新增 public candidate DTO、不新增持久化 selection record，也不拓展顶层 SPI。

## 不变边界

- Runtime、core、channel、capability 和调用方不得预选历史条目，不得通过 `RequestContext.messageRefs`、client payload、capability 参数或 channel metadata 绕过 `ActiveContextView`。
- Gateway 仍只通过 `*Record` contract 暴露持久化事实；Context Engine 不直接读取 SQLite row，也不扫描 Web UI transcript。
- 预算、压缩、摘要、附件可用性和 prompt slot 渲染由相邻 changes 继续定义；本 change 只提供完整合法的历史候选输入。

## 长期设计文档更新

- `openspec/designs/modules/agent-context-engine.md`
- `openspec/designs/architecture/core-contracts.md`
- `openspec/designs/architecture/ts-backend-architecture.md`

本 change 不新增独立 baseline design 文档；归档时只把稳定结论同步到现有 TS Context Engine 模块设计、核心合同设计和 TS 后端架构设计。

> 提示：本 change 是 `add-ts-context-history-selection` 在 `openspec/changes/add-ts-context-history-selection/specs/context-engine/spec.md` 路径下的第一个 context-engine delta。归档时必须把 delta spec 整体同步到 `openspec/specs/context-engine/spec.md` 作为新建 capability 基线；后续并行 change（如 `add-ts-context-prompt-shaping`、`add-ts-context-budget-explainability`、`add-ts-context-compression`、`add-ts-traceable-summary-generation`、`add-ts-large-content-references`）各自以 `## ADDED Requirements` 向同一 capability 追加**各自独立命名**的 requirement，而非以 `## MODIFIED Requirements` 改写本基线 requirement；delta 中的具体 vocabulary（`complete prior turn`、`pending prior tool fragment`、`hidden replacement exclusion`、`unresolvable active context ref 显式失败` 等）不得只留 delta。

## 相邻 change 衔接

本 change 的输出只是一组内部 current-request records 与 prior-turn candidates。后续能力不得把本 change 解读为已经定义预算、压缩、摘要、大内容或附件处理策略：

- Query Policy 只消费本 change 产出的历史候选集；预算与降级规则由 budget/explainability change 定义。
- Compression 和 traceable summary changes 只在候选集历史进入后续窗口治理时处理较早历史摘要，不重写本 change 的候选集规则。
- Attachment 相关 changes 负责 attachment ref 校验、descriptor/content 读取、摘要引用和不可用失败；本 change 只保证被排除的 prior turn 不得通过可见历史边界重新引入到附件上下文。

## 待确认问题（Open Questions）

无。唯一实现策略已经固定为同步 current-request-first + complete-turn-based history selection。

## 规格与设计的边界

本 change 的 delta spec 只定义可观察的历史候选行为和持久安全边界:权威历史来源、current-request 保护、可见性、合法会话边界,以及显式选择失败。

具体的选择序列、分组算法、诊断形状和当前实现策略属于本 design;只要外部可观察行为和架构不变量保持等价,这些内容可以演进而不改动 spec。