# 组件规范：Pending Input 卡片（Pending Input Card）

> 当前事实来源：pending-input stable specs、`cross-session-activity-awareness`、`agent-common`/runtime/channel/frontend public contracts、代码与测试；`openspec/designs/architecture/conversation-ui-state.md` 第 3、6 节仅作长期设计导航。稳定契约已经明确 workflow 等待输入继续复用 `QUESTION`，不得新增第 5 种 durable kind。本文档是 UCD 设计表达层，非 OpenSpec 基线，不定义契约。

## 职责

渲染 pending input 请求与应答生命周期。Pending input 是 Agent 暂停执行、等待用户输入的交互入口。

> ⚠️ **实现位置标注**：`useChatSessionStream.ts` 在 live `USER_INPUT_REQUIRED` 到达时写入 `userInputStore`，`ChatPage.tsx` 在 composer 上方渲染 `RespondInput.tsx`；收到 `RECEIVED`/`TIMEOUT`/`CANCELED` 后只清空 `activeInput`。`processDetails.ts` 会把各 pending-input event 分别投影为 system 条目，但不会连接成一张 lifecycle 卡。所以下述可应答 REQUIRED 卡有当前实现，received/timeout/canceled 只读终态卡和 history lifecycle 卡仍是 `[UCD目标]`。

## 状态机

```
┌─────────────────┐  USER_INPUT_RECEIVED  ┌─────────────┐
│ USER_INPUT_     │ ─────────────────────▶│ received    │
│ REQUIRED        │                        └─────────────┘
└─────────────────┘
     │  USER_INPUT_TIMEOUT
     ▼
┌─────────────┐
│ timeout     │
└─────────────┘
     │  USER_INPUT_CANCELED
     ▼
┌─────────────┐
│ canceled    │
└─────────────┘
```

### 终态卡片样例

**received（已应答）**——用户提交应答后，卡片进入只读终态：
```
┌─ 📋 Pending Input · ✅ 已应答 ───────────────────┐
│                                                    │
│  问题：需要确认是否执行该节能策略？                 │
│  应答：是                                          │
│                                                    │
│  （按钮已禁用/隐藏，卡片只读）                      │
└──────────────────────────────────────────────────┘
```

**timeout（已超时）**——倒计时归零，未提交应答：
```
┌─ 📋 Pending Input · ⏱ 已超时 ────────────────────┐
│                                                    │
│  问题：需要确认是否执行该节能策略？                 │
│  ⏱ 已过期                                         │
│                                                    │
│  （按钮已禁用，卡片只读）                           │
└──────────────────────────────────────────────────┘
```

**canceled（已取消）**——用户或系统取消（如 fork/supersede）：
```
┌─ 📋 Pending Input · ⏹ 已取消 ────────────────────┐
│                                                    │
│  问题：需要确认是否执行该节能策略？                 │
│  ⏹ 已取消                                         │
│                                                    │
│  （按钮已禁用，卡片只读）                           │
└──────────────────────────────────────────────────┘
```

## durable kind 与目标分支

| 状态 | durable kind / 识别方式 | 呈现 | answer shape | runtime spec 主承载 |
|---|---|---|---|---|
| `[已实现-主干]` | `QUESTION`（含 AskUserQuestion） | 问题卡片：`questions[]` prompt + options + multiple/custom | 选中的 `options[].value` 或 custom 文本 | `question-pending-input`、`ask-user-question-tool` |
| `[已实现-主干]` | `AUTHORIZATION` | 授权卡片：单操作 approve/deny | approve / deny | `authorization-pending-input` |
| `[已实现-主干]` | `CONFIRMATION` | 确认卡片：approve/reject | approve / reject | `confirmation-pending-input` |
| `[已实现-主干]` | `HUMAN_HANDOFF` | 人工接管卡片：模式选择 + 交接内容输入 | `[[mode], [content]]` | `human-pending-input-core`、`human-pending-input-timeout`、`human-handoff` |
| `[已冻结-稳定规格]` | Workflow 等待输入复用 `QUESTION` | 复用问题卡片，不新增 workflow 专用 kind | QUESTION answer shape | `workflow-interaction-nodes`、`cross-session-activity-awareness` |

当前 `PendingInputKind` 只有上表前 4 种。workflow 需要用户补充信息时使用 `QUESTION`，前端按普通问题卡片呈现；`producerRef` 仍是 runtime/persistence 事实，不是 Web 用来派生第二套 presentation kind 的依据。`RespondInput.tsx` 的 `INPUT_KIND_COMPONENTS` 按前端 7 个 accepted identifier 分发，但这不扩展 durable kind 集合。

## 各 kind 详细呈现

以下按前端 7 种 `UserInputKind` 描述每个子组件的视觉结构与交互。来源：`RespondInput.tsx` 的各子组件实现。

### CLARIFICATION（澄清性自由文本）

**视觉结构**：

```
┌─────────────────────────────────────────────┐
│  [textarea: 2 rows, 自由文本输入]  [⬆ 提交] │
│  [submitError Alert（仅出错时显示）]         │
└─────────────────────────────────────────────┘
```

- **输入控件**：`<textarea>` 2 行，`placeholder` 来自 `respondInput.placeholder`。
- **提交按钮**：圆形 primary 按钮（`ArrowUpOutlined` 图标），提交中显示 `Spin` loading。
- **交互**：`Enter` 提交，`Shift+Enter` 换行。空内容禁用提交按钮。
- **answer shape**：`[[trimmedText]]`——单问题、单值。

### CONFIRMATION（确认/继续）

**视觉结构**：

```
┌──────────────────────────────────┐
│  [deny 按钮]  [confirm 按钮]     │
│  [submitError Alert（仅出错时）] │
└──────────────────────────────────┘
```

- **按钮排序**：按 `confirmationActionRank` 排序——`deny`/`reject`/`cancel`/`stop` → rank 0（左侧），`approve`/`confirm`/`continue` → rank 1（右侧，primary 样式）。
- **默认 options**（后端未提供时）：`deny` + `confirm`。
- **交互**：点击即提交，无中间态。提交中禁用所有按钮。
- **answer shape**：`[[optionId]]`。

### APPROVAL（审批 + 风险等级）

**视觉结构**：

```
┌──────────────────────────────────┐
│  ⚠ [风险等级徽章]                │
│  [reject 按钮]  [approve 按钮]   │
│  [submitError Alert（仅出错时）] │
└──────────────────────────────────┘
```

- **风险等级徽章**：当 `riskLevel` 存在时显示。
  - `LOW`/`MEDIUM`：黄色背景（`#fffbe6`）、黄色边框（`#ffe58f`）、深黄文字（`#ad6800`）。
  - `HIGH`/`CRITICAL`：红色背景（`#fff2f0`）、红色边框（`#ffccc7`）、深红文字（`#cf1322`）。
  - 徽章样式：圆角 999（pill 形）、`ExclamationCircleOutlined` 图标 + 风险等级文字。
- **按钮**：`reject`（danger 样式）+ `approve`（default 样式）。默认 options：`approve` + `reject`。
- **交互**：点击即提交。提交中禁用。
- **answer shape**：`[[optionId]]`。

### SELECTION（单选列表）

**视觉结构**：

```
┌──────────────────────────────────┐
│  ○ 选项 A                        │
│  ○ 选项 B                        │
│  ○ 选项 C                        │
│                          [⬆ 提交]│
│  [submitError Alert（仅出错时）] │
└──────────────────────────────────┘
```

- **输入控件**：`Radio.Group`（单选），`Space direction="vertical"` 垂直排列，间距 6px。
- **提交按钮**：圆形 primary 按钮（右下角），未选中时禁用。
- **交互**：选中后启用提交按钮，`Enter` 提交。
- **answer shape**：`[[selectedOptionId]]`。
- **备注**：`SELECTION` 无契约对应（见映射表），属于前端遗留词汇。

### QUESTION（多问题 + 选项 + 自定义答案）

**视觉结构**（多问题时）：

```
┌──────────────────────────────────┐
│  1. 第一题 prompt                │
│    ○ 选项 1   ○ 选项 2          │
│    ○ 自定义答案（展开 textarea） │
│  2. 第二题 prompt                │
│    ☑ 选项 A   ☑ 选项 B          │
│  [取消]                  [提交]  │
│  [submitError Alert（仅出错时）] │
└──────────────────────────────────┘
```

- **问题列表**：`questions[]` 数组，每个 question 含 `prompt`、`options[]`、`multiple?`、`custom?`。
  - 多问题时每题前缀 `"{index}. "`，单问题时无前缀。
  - 列表最大高度 `min(420px, 45vh)`，超出滚动。
- **选项交互**：
  - `multiple=false`：Radio 单选（点击选中即替换）。
  - `multiple=true`：Checkbox 多选（点击切换选中态）。
  - 选项行样式：选中时 primary 边框 + active 背景，未选中时 default 边框 + primary 背景。
- **自定义答案**（`custom=true` 时）：
  - 显示"自定义答案"选项行，点击展开 `<textarea>`（1 行，自适应高度，最大 3 行）。
  - 字符计数器 `{length}/500`（`CUSTOM_ANSWER_MAX_LENGTH`），右对齐，11px 灰色文字。
  - `Enter` 提交，`Shift+Enter` 换行。
- **无 options 的 question**：直接显示 `<textarea>`（2 行）。
- **提交校验**：所有问题都已回答（`ready` 状态）。`custom` 激活时要求自定义文本非空。
- **按钮**：`取消`（可选）+ `提交`（primary），提交中显示 loading。
- **answer shape**：`[[q1_answers], [q2_answers], ...]`——每问题一个数组。

### AUTHORIZATION（授权 + 蓝色徽章）

**视觉结构**：

```
┌══════════════════════════════════╗  ← 2px primary 边框（区别于其他 kind 的 1px）
║  prompt           [授权请求] ⏱  ║  ← 蓝色授权徽章 + 倒计时
║  授权提示文本                    ║
║  [deny 按钮]     [approve 按钮] ║
║  [submitError Alert（仅出错时）] ║
╚══════════════════════════════════╝
```

- **卡片边框**：`2px solid var(--color-primary)`（其他 kind 为 `1px solid var(--color-bg-tertiary)`），视觉强调授权的特殊性。
- **授权徽章**：`授权请求` 文字，蓝色背景（`#eaf3ff`）、蓝色边框（`#91caff`）、蓝色文字（`#0958d9`），pill 形。
- **授权提示文本**：`respondInput.authorizationHint`，13px secondary 文字色。
- **按钮排序**：`deny` → rank 0（左），`approve` → rank 1（右，primary 样式）。默认 options：`deny` + `approve`。
- **交互**：点击即提交。提交中禁用。
- **answer shape**：`[[optionId]]`。

### HUMAN_HANDOFF（人工接管：模式选择 + 内容输入）

**视觉结构**：

```
┌──────────────────────────────────┐
│  模式选择 prompt                 │
│  ○ 最终答案    ○ 恢复指令        │  ← 2 列 grid 布局
│  内容输入 prompt                 │
│  [textarea: 2 行]                │
│                         0/500    │  ← 字符计数器
│  [取消]                  [提交]  │
│  [submitError Alert（仅出错时）] │
└──────────────────────────────────┘
```

- **标题**：`respondInput.humanHandoffTitle`（替换默认 prompt 作为卡片标题）。
- **模式选择**：`questions[0]` 的 options，默认为 `final_answer`（最终答案）+ `resume_instruction`（恢复指令）。
  - 2 列 grid 布局（`gridTemplateColumns: repeat(2, minmax(0, 1fr))`）。
  - Radio 单选样式（选中 primary 边框 + active 背景）。
- **内容输入**：`questions[1]` 的 prompt + `<textarea>`（2 行，自适应高度，最大 3 行）。
  - 字符计数器 `{length}/500`（`HUMAN_HANDOFF_CONTENT_MAX_LENGTH`）。
  - `Enter` 提交，`Shift+Enter` 换行。
- **提交校验**：模式已选 + 内容非空（`ready` 状态）。
- **按钮**：`取消`（可选）+ `提交`（primary），提交中 loading。
- **answer shape**：`[[mode], [content]]`——模式与内容分别一个数组。

### Workflow 等待输入（复用 `QUESTION`）

Workflow 暂停并请求用户补充信息时，使用既有 `QUESTION` 卡片、问题与选项结构以及统一 answer shape。UI 不显示由未投影 producer 信息推断出的“工作流中断”专用徽章，也不自行发明“跳过节点”等未被问题 options 提供的动作。

### APPROVAL 风险等级徽章样例

APPROVAL kind 的风险等级徽章按 `riskLevel` 呈现 4 种视觉样式：

**LOW（低风险）**——黄色背景：
```
┌──────────────────────────────────┐
│  ⚠ [LOW 低风险]                  │  ← 黄色背景 #fffbe6 / 边框 #ffe58f
│  [reject 按钮]  [approve 按钮]   │
└──────────────────────────────────┘
```

**MEDIUM（中风险）**——黄色背景（与 LOW 相同样式，仅文字不同）：
```
┌──────────────────────────────────┐
│  ⚠ [MEDIUM 中风险]               │  ← 黄色背景 #fffbe6 / 边框 #ffe58f
│  [reject 按钮]  [approve 按钮]   │
└──────────────────────────────────┘
```

**HIGH（高风险）**——红色背景：
```
┌──────────────────────────────────┐
│  ⚠ [HIGH 高风险]                 │  ← 红色背景 #fff2f0 / 边框 #ffccc7
│  [reject 按钮]  [approve 按钮]   │
└──────────────────────────────────┘
```

**CRITICAL（严重风险）**——红色背景（与 HIGH 相同样式，仅文字不同）：
```
┌──────────────────────────────────┐
│  ⚠ [CRITICAL 严重]               │  ← 红色背景 #fff2f0 / 边框 #ffccc7
│  [reject 按钮]  [approve 按钮]   │
└──────────────────────────────────┘
```

## 倒计时计时器

所有 kind 共享倒计时行为（`RespondInput.tsx` 顶层组件实现）：

- **数据源**：`activeInput.expiresAt`（`WireTimestamp`）。
- **更新频率**：`setInterval(update, 1000)`——每秒更新。
- **格式化**（`formatCountdown`）：
  - 剩余 ≤ 0：显示 `respondInput.expired`（"已过期"）。
  - > 1 小时：`{hours} 小时 {minutes} 分`。
  - > 1 分钟：`{minutes} 分 {seconds} 秒`。
  - < 1 分钟：`{seconds} 秒`。
- **位置**：卡片 header 右侧，与标题/授权徽章同行。12px tertiary 文字色。

### 倒计时格式样例

```
┌─ 4 种倒计时格式 ─────────────────────────────────┐
│                                                    │
│  > 1 小时：    ⏱ 2 小时 35 分                      │
│  > 1 分钟：    ⏱ 3 分 42 秒                        │
│  < 1 分钟：    ⏱ 28 秒                             │
│  已过期：      ⏱ 已过期                            │
│                                                    │
│  （位于卡片 header 右侧，每秒更新）                 │
└──────────────────────────────────────────────────┘
```
- **无 expiresAt**：不显示倒计时。

## 提交错误内联告警

所有 kind 共享错误处理：

- **数据源**：`useUserInputStore` 的 `submitError`。
- **呈现**：`<Alert type="error">`，圆角 10px，内边距 `6px 10px`，`showIcon=false`。
- **位置**：kind 子组件底部（按钮组下方）。
- **生命周期**：提交失败时设置，下次提交尝试或新 input 到达时清除。

## 提交中间态

所有 kind 共享提交中间态：

- **状态来源**：`useUserInputStore` 的 `submitStatus === "submitting"`。
- **视觉表现**：
  - 所有输入控件 `disabled`。
  - 提交按钮显示 `Spin` loading（CLARIFICATION/SELECTION）或 `loading` prop（QUESTION/HUMAN_HANDOFF）。
  - 圆形提交按钮的图标替换为 `Spin`。
- **退出条件**：POST `submitUserInputResponse` 成功后，`ChatPage` 当前会立即本地清空 `activeInput`；后续 live `USER_INPUT_RECEIVED`，以及 `TIMEOUT`/`CANCELED` event，也会走清空路径。POST 成功即退出是客户端当前行为，不得误写成已经等待 canonical stream confirmation。失败时设置 `submitError` 并保留卡片。

### 前端历史词汇映射

前端 `state/contracts.ts` 的 `USER_INPUT_KINDS` 声明了 **7 个 accepted identifier**：其中 4 个与 durable `PendingInputKind` 同名，另有 3 个 frontend compatibility alias。`normalizeInputKind()` 对这 7 个值原样保留，对未知值降级为 `CLARIFICATION`；当前没有把 alias 自动改写成 durable kind 的语义映射。

| 前端 accepted identifier | durable kind | 当前处理 |
|---|---|---|
| `QUESTION` | `QUESTION` | `QuestionInput` |
| `CONFIRMATION` | `CONFIRMATION` | `ConfirmationInput` |
| `AUTHORIZATION` | `AUTHORIZATION` | `AuthorizationInput` |
| `HUMAN_HANDOFF` | `HUMAN_HANDOFF` | `HumanHandoffInput` |
| `CLARIFICATION` | — | frontend compatibility alias，`ClarificationInput`；也是未知 kind 的兼容性 fallback。该路径可提交自由文本，但 workflow 不使用该 alias，而是使用 canonical `QUESTION` |
| `APPROVAL` | — | frontend compatibility alias，`ApprovalInput` |
| `SELECTION` | — | frontend compatibility alias，`SelectionInput` |

> 前端注释说明："Accepts the current frontend vocabulary plus NextAgent PendingInputKind values"。这表示 parser 接受两组词汇，不表示三种 compatibility alias 是 durable contract；workflow 仍使用既有 `QUESTION` presentation。

## `USER_INPUT_REQUIRED` safe field

payload MUST 只暴露：`pendingInputId`、`id`、`kind`、`timeoutAt`、`status`、`questions[]`（每个 question 含 `prompt`、`options[]`；option 可含 `label`、`value`、`requiresTextInput?`、`inputPlaceholder?`，question 可含 `multiple?`、`custom?`）。

MUST NOT 暴露：identity、idempotency key、timeout behavior、raw prompt、raw answer、model-formatted answer。来源：`ts-run-status-visibility` 的 `Pending input status visibility 约束`。

## `USER_INPUT_RECEIVED`/`TIMEOUT`/`CANCELED` safe field

payload MUST 只包含：`pendingInputId`、`id`、`kind`、`status`、`safeSummary`。raw answer content MUST NOT 通过 status visibility 输出。

## live 模式 vs history 模式

| 维度 | live 模式 | history 模式 |
|---|---|---|
| `USER_INPUT_REQUIRED` | 实时到达，composer 上方卡片可应答 | `[已实现-主干]` 只在 process details 中重建独立 system 条目；`[UCD目标]` lifecycle 卡只读重建 |
| 应答入口 | 可交互（approve/deny/select/custom） | 不可交互（展示终态） |
| `USER_INPUT_RECEIVED`/`TIMEOUT`/`CANCELED` | 实时到达 | 重建（stored event type） |
| `timeoutAt` 倒计时 | 实时倒计时 | 不显示倒计时（展示终态） |

## 交互

### live 模式可应答

- `question`：用户选择 options 或输入 custom 文本，点击提交。
- `authorization`/`confirmation`：用户点击 approve/deny（reject）。
- `human-handoff`：用户选择 `final_answer` 或 `resume_instruction` 模式，填写交接内容并提交；不是纯等待提示。
- workflow 等待输入：复用 `QUESTION` 选择/文本输入与提交路径，不创建专用 kind 或第二套应答入口。
- 提交中卡片会禁用控件；POST 成功后当前前端立即清空卡片，并不等待 `USER_INPUT_RECEIVED`。若产品目标要求 canonical confirmation 后再进入只读终态，需要另行冻结状态路径。

### history 模式只读

- 卡片展示终态（received/timeout/canceled）与 `safeSummary`。
- 不提供应答入口。

## 超时处理

- live 模式：`timeoutAt` 到达前显示倒计时；到达后 runtime 投影 `USER_INPUT_TIMEOUT`，卡片转为"超时"态。
- late answer（超时后到达的应答）：由 runtime-owned boundary 处理，UI 按最终 `USER_INPUT_RECEIVED`/`TIMEOUT` 投影呈现。来源：各 pending input spec 的 late-answer scenario。
- 默认超时 30 分钟，最大超时 24 小时（见 `11-ux-limits-and-constraints.md` §7）。

## deferred gap

4 种 durable kind 的统一前端状态机（`USER_INPUT_REQUIRED` → answer → `RECEIVED`/`TIMEOUT`/`CANCELED` 的完整 UI 状态流转）、answer idempotency 的前端表现、late answer 的 UI 处理目前散在各 pending input spec，无单一 spec 主承载。本组件规范只描述 UI 呈现，不定义状态机；长期设计中的 5-kind 矩阵应在后续设计同步中收敛为稳定规格的 4-kind 模型。

> 以上 7 个 frontend identifier 的详细呈现基于 `RespondInput.tsx` 当前实现。live REQUIRED 激活与终态清理由 `useChatSessionStream.ts`/`userInputStore` 驱动，卡片组件本身只负责 REQUIRED 态的应答 UI。
>
> ⚠️ **终态卡片未实现**：文档描述的 received/timeout/canceled 终态卡片视觉（见上方样例）为 UCD 设计目标。当前终态 event 到达后 `activeInput` 被清空，`RespondInput` 从 DOM 消失；process details 仍只显示彼此独立的 system 条目。

## 视觉规范（UCD 设计人员决定）

- 卡片边框、背景色、圆角（AUTHORIZATION 的 2px primary 边框是代码已实现的视觉区分，UCD 设计人员可在此基础上调整）。
- kind 区分（图标/颜色/标题）。
- 应答按钮样式（approve/deny/select/custom 输入框）。
- 终态指示（received/timeout/canceled 图标与颜色）。
- `timeoutAt` 倒计时的视觉强调（接近超时时变色）——当前代码使用固定 tertiary 文字色，无接近超时变色逻辑，UCD 设计人员可设计阶梯式视觉强调（如最后 30 秒变黄、最后 10 秒变红）。
- 风险等级徽章的颜色阶梯（APPROVAL kind）——当前代码仅分两档（LOW/MEDIUM 黄色、HIGH/CRITICAL 红色），UCD 设计人员可考虑是否需要 4 档独立配色。
- 约束：不得通过视觉暗示非契约字段；不得展示 raw prompt 或 model-formatted answer。

## 动态行为与交互响应

> 跨组件的通用模式见 `02-dynamic-behavior-and-interaction.md`。本节补充 Pending Input 卡片特有行为。

### 已实现

| 行为 | 说明 | 代码位置 |
|------|------|---------|
| 倒计时 | `expiresAt` 存在时每秒更新显示 | `RespondInput.tsx` L1057-1069, L1147-1159 |
| 倒计时格式化 | 根据 remaining 时间格式化为 时:分 / 分:秒 / 秒 | L37-52 |
| 过期文字 | `remaining <= 0` 时显示"已过期" | L39-40 |
| 授权请求视觉强调 | AUTHORIZATION kind 时 2px border + label | L1095, L1130-1146 |
| 选中选项样式 | 选项被选中时边框变蓝 + 背景变色 | L59-76 |
| 提交中间态 | 所有输入控件 disabled + 提交按钮 Spin loading | L329-338 |
| submitError | Alert type=error，提交失败时显示 | L319-327 |

### UCD 设计建议

| 行为 | 说明 |
|------|------|
| 卡片 appear | `USER_INPUT_REQUIRED` 到达时 fade-in + slide-down 200ms |
| 接近超时变色 | 最后 60s 倒计时渐变 warning 色；最后 10s 脉冲动画。当前倒计时始终用 `var(--color-text-tertiary)` 色，不随时间变化 |
| 提交成功反馈 | 提交成功后显示 success checkmark 0.5s，然后转终态 |
| scrollIntoView | pending input 出现时滚动到视口 |
| hover | 卡片 hover 时背景色微变，120ms transition |
| focus | `focus-visible` outline 2px primary + offset 2px |

> ⚠️ 接近超时变色是 UCD 设计建议，当前代码使用固定 tertiary 文字色，无接近超时变色逻辑。见 `pending-input-card.md` L407。
