# 动态行为与交互响应规范

> 本文是跨组件的动态行为规范，定义界面在不同执行阶段如何动态变化、各组件的交互响应模式统一标准。各组件规格（`05-component-specs/`）引用本文并补充组件特有行为。

> **状态基线（2026-08-13，`origin/main@4f27c4a9f`）**：当前事实由 owning stable/active OpenSpec、代码和测试交叉确认；active change 尚待归档时会明确标注。任务准入以 owning spec 与 roadmap 为准。

---

## 1. 执行过程动态时序

### 1.1 完整时序图

以 2 轮 think+tool 为例，展示从用户发送到面板折叠的完整动态过程：

```
T0    用户发送消息
      → USER 气泡出现，过程面板 auto-expanded
      → Composer 发送按钮切换为停止按钮

T1    LLM_THINKING_DELTA 开始到达
      → think #1 条目出现（auto-expanded），流式文本 replace 累积
      → idle-sweep 扫光效果作用于条目 summary 行（4s 循环）

T2    flushThinking() —— 遇到非思考事件
      → think #1 条目关闭，文本停止增长

T3    CAPABILITY_STARTED 到达
      → tool #1 条目出现（auto-expanded），running 动画
      → think #1 条目：[UCD 设计建议] 延迟 800ms 后 auto-collapse

T4    CAPABILITY_RESULT_DELTA 到达
      → tool #1 结果增量呈现

T5    CAPABILITY_COMPLETED 到达
      → tool #1 进入终态（success/failure）
      → tool #1 条目：[UCD 设计建议] 延迟 800ms 后 auto-collapse

T6    LLM_THINKING_DELTA 开始到达
      → think #2 条目出现（auto-expanded）

T7    flushThinking() + CAPABILITY_STARTED
      → think #2 完成，tool #2 条目出现
      → think #2 条目：[UCD 设计建议] auto-collapse

T8    CAPABILITY_COMPLETED
      → tool #2 进入终态
      → tool #2 条目：[UCD 设计建议] auto-collapse

T9    RUN_COMPLETED + LLM_CONTENT_DELTA 开始
      → 过程面板 auto-collapsed（150ms 延迟，视口在底部时）
      → 助手消息气泡出现，打字机效果流式追加

T10   LLM_CONTENT_DELTA 结束
      → 助手气泡显示终态指示（✅ 已完成）
      → Composer 停止按钮切换回发送按钮
```

> ℹ️ **并行工具调用变体**：T3 阶段多个 `CAPABILITY_STARTED` 几乎同时到达，多个 tool 条目同时出现且同时 running。各自独立完成后 auto-collapse（`[UCD 设计建议]`）。见 `01-user-journeys.md` 旅程 27。

#### 1.1.1 关键时间点界面快照

以下快照展示用户在对话区看到的实际界面演变（仅展示 turn 区域，省略侧边栏/composer）：

**T0 — 用户刚发送消息**

```
┌─ 对话区 ─────────────────────────────────────────────┐
│                                                        │
│  ┌─ 🧑 用户 ──────────────────────────────────────┐  │
│  │  排查 Edge-RTR-02 丢包问题，先查告警再查配置    │  │
│  └────────────────────────────────────────────────┘  │
│                                                        │
│  ┌─ 📋 过程面板 ▼ auto-expanded ───────────────────┐  │
│  │  （空，等待第一个事件）                            │  │
│  └────────────────────────────────────────────────┘  │
│                                                        │
│  🤖 助手 · ⏳ 思考中...                                │
│                                                        │
└────────────────────────────────────────────────────────┘
```

**T1 — think #1 流式输出中**

```
┌─ 📋 过程面板 ▼ ──────────────────────────────────────┐
│  💭 思考 #1 · ⏳                                     │  ← auto-expanded
│    ░▒▓ 用户提到丢包问题，先查告警再查配置... ▓▒░      │  ← summary 行扫光（idle-sweep）
│    先调用 queryAlerts...                              │
└──────────────────────────────────────────────────────┘
```

**T3 — think #1 完成，tool #1 开始执行**（`[UCD 设计建议]` per-entry auto-collapse）

```
┌─ 📋 过程面板 ▼ ──────────────────────────────────────┐
│  💭 思考 #1 · ✅                              ▸       │  ← auto-collapsed（800ms 后）
│  🔧 queryAlerts · ⏳ running                  ▼       │  ← auto-expanded（当前）
│    ┌─ 执行中 ────────────────────────────────────┐  │
│    │  ⏳ 正在查询告警...                           │  │  ← running 动画
│    │  ▸ args: { device: "Edge-RTR-02" }           │  │
│    └──────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────┘
```

**T5 — tool #1 完成，think #2 开始**（`[UCD 设计建议]`）

```
┌─ 📋 过程面板 ▼ ──────────────────────────────────────┐
│  💭 思考 #1 · ✅                              ▸       │  ← collapsed
│  🔧 queryAlerts · ✅ 成功                     ▸       │  ← auto-collapsed（800ms 后）
│    │ 查到 3 条告警（hover 可展开）                │  ← 折叠为标题行
│  💭 思考 #2 · ⏳                              ▼       │  ← auto-expanded（当前）
│    ░▒▓ 告警显示 CPU 过载，需要查配置确认... ▓▒░       │  ← summary 行扫光
└──────────────────────────────────────────────────────┘
```

**T9 — run 完成，面板折叠，答案流式输出**

```
┌─ 对话区 ─────────────────────────────────────────────┐
│  ┌─ 🧑 用户 ──────────────────────────────────────┐  │
│  │  排查 Edge-RTR-02 丢包问题，先查告警再查配置    │  │
│  └────────────────────────────────────────────────┘  │
│                                                        │
│  ┌─ 📋 过程面板 ▶ auto-collapsed ──────────────────┐  │
│  │  ✅ 已完成 · 2 次思考 · 2 次工具调用             │  │  ← 150ms 后折叠
│  └────────────────────────────────────────────────┘  │
│                                                        │
│  ┌─ 🤖 助手 · ✅ 已完成 ───────────────────────────┐  │
│  │  # Edge-RTR-02 丢包根因分析                      │  │  ← 打字机效果
│  │  ## 摘要                                          │  │    流式追加
│  │  本次诊断结论：CPU 过载导致转发丢包|              │  │    （| 为光标）
│  └────────────────────────────────────────────────┘  │
└────────────────────────────────────────────────────────┘
```

> 以上 T3/T5 快照中的 think #1 / tool #1 折叠状态为 `[已实现-主干]`：条目完成后保留 800ms，再自动折叠。

### 1.2 per-entry auto-expand/collapse 行为

这是用户最关心的动态行为：执行过程中当前步骤展开、已完成步骤折叠，形成"跟随执行进度"的视觉效果。

| 行为 | 状态 | 说明 |
|------|------|------|
| 新条目 auto-expand | `[已实现]` | running 阶段新条目自动展开详情。`ProcessPanel.tsx` L276-314（`executionDetailsPhase !== "settled"` 时加入 expanded set） |
| 面板刚展开时全展开 | `[已实现]` | `justOpened` 时所有条目加入 expanded set。L283-289 |
| settled 阶段新条目不展开 | `[已实现]` | `executionDetailsPhase === "settled"` 时不 auto-expand。L248 |
| **条目完成后 auto-collapse** | `[已实现]` | 条目进入终态后延迟 800ms 自动折叠，让用户先看到结果；think 条目完成后使用同一规则 |
| **同一时刻只有一个自动展开项** | `[已实现]` | 当前 running 条目展开，已完成条目折叠为标题行；用户手动展开不强制折叠其他条目 |
| degradation/compaction 不参与 | `[已实现]` | 降级提示和压缩通知作为独立条目保留 |
| 用户手动覆盖 | `[已实现]` | 用户手动展开/折叠某条目后保留该 run 内的选择 |
| reduced-motion | `[已实现]` | 跳过视觉过渡，但状态结果一致 |

**当前视觉效果**（`[已实现-主干]`）：
```
┌─ 过程面板（running）──────────────────────────────┐
│  💭 思考 #1 · ✅ 已完成                    ▸      │  ← auto-collapsed
│  🔧 queryAlerts · ⏳ running               ▼      │  ← auto-expanded（当前执行）
│    ⏳ 执行中动画                                      │
│    （结果到达后展开显示，800ms 后折叠）                │
└──────────────────────────────────────────────────┘
```

**per-entry auto-collapse 4 帧演变**（`[已实现-主干]`）—— 展示“跟随执行进度”的视觉效果：

```
帧 A: think #1 执行中              帧 B: tool #1 执行中（think #1 已折叠）
┌────────────────────────────┐    ┌────────────────────────────┐
│ 💭 思考 #1 · ⏳        ▼   │    │ 💭 思考 #1 · ✅        ▸   │ ← 折叠
│   ░▒▓ 用户提到丢包... ▓▒░  │    │ 🔧 queryAlerts · ⏳    ▼   │ ← 展开
│                             │    │   ░▒▓ 查询告警中... ▓▒░    │ ← summary 扫光
└────────────────────────────┘    └────────────────────────────┘

帧 C: think #2 执行中              帧 D: 全部完成，面板折叠
┌────────────────────────────┐    ┌────────────────────────────┐
│ 💭 思考 #1 · ✅        ▸   │    │ 📋 ▶ 已完成 · 2思考 · 2工具 │
│ 🔧 queryAlerts · ✅    ▸   │    └────────────────────────────┘
│ 💭 思考 #2 · ⏳        ▼   │    ┌────────────────────────────┐
│   ░▒▓ 告警显示 CPU... ▓▒░  │    │ 🤖 # 根因分析               │
└────────────────────────────┘    │    CPU 过载导致转发丢包...   │
                                  └────────────────────────────┘
```

> 对比：当前代码（无 per-entry auto-collapse）在帧 B/C/D 时所有已完成条目保持展开，信息密度高，用户难以快速识别"当前在哪一步"。

### 1.3 面板级 auto-expand/collapse

`[已实现]`

| 触发条件 | 面板状态 | 说明 |
|----------|----------|------|
| run 开始（`ACCEPTED`/`QUEUED`/`PLANNING`/`EXECUTING`） | auto-expanded | 过程面板自动展开 |
| run 终态（`COMPLETED`/`FAILED`/`CANCELED`/`SUPERSEDED`） + 视口在底部 | auto-collapsed（150ms 延迟） | 延迟让用户看到最终结果 |
| run 终态 + 视口不在底部 | auto-collapsed（150ms 延迟）+ 锚定补偿 | ⚠️ **代码实际行为与预期不同**：文档原描述"保持展开"，但代码在 `isTerminal` 为 true 时即使视口不在底部也触发 auto-collapse，通过 `requestSummaryAnchorCompensation` 补偿视觉位置（保持用户视线锚点不跳动）而非保持面板展开。代码：`ProcessPanel.tsx` L378-398 |
| 用户手动折叠/展开 | user-collapsed / user-expanded | 用户覆盖优先 |
| 新 run 开始 | 恢复 auto | 用户手动覆盖在新 run 时重置 |
| history 模式 | 默认 collapsed | 无 streaming 中间态 |

代码：`ProcessPanel.tsx` L19-59（状态机）、L377-414（auto-collapse 逻辑）。

**面板级展开/折叠视觉对比**：

```
running 阶段（auto-expanded）              settled 阶段（auto-collapsed，150ms 后）
┌─ 📋 过程面板 ▼ ─────────────┐           ┌─ 📋 过程面板 ▶ ─────────────┐
│ 💭 思考 #1 · ✅          ▸  │           │ ✅ 已完成 · 2思考 · 2工具    │
│ 🔧 queryAlerts · ✅      ▸  │           └──────────────────────────────┘
│ 💭 思考 #2 · ✅          ▸  │           ┌─ 🤖 助手 ──────────────────┐
│ 🔧 queryConfig · ✅      ▸  │           │ # 根因分析                   │
│ 📦 上下文已压缩              │           │ CPU 过载导致转发丢包...      │
└──────────────────────────────┘           └──────────────────────────────┘
```

### 1.4 idle-sweep 流式空闲扫光

`[已实现]`

当流式数据暂停到达时（如模型正在思考但未输出 token），界面在**活跃条目的摘要文本**上显示扫光动画提示"仍在工作中"。

| 场景 | 触发条件 | 扫光位置 | 动画 | 代码位置 |
|------|----------|----------|------|---------|
| 过程面板 active entry | 2.5s 无新序列 | 条目展开详情区域内的 `entry.summary` 文本（非 `entry.title` 标题行）。⚠️ 条目折叠时扫光不可见 | 文字背景渐变扫光，4s 线性循环 | `ProcessPanel.tsx` L83-110, L634-638, L710 |
| 答案气泡流式空闲 | 2.5s 无新 content delta | markdown 最后一个子元素 | 文字背景渐变扫光，时长自适应（3s/3.5s/4s） | `TurnBlock.tsx` L1060, `MarkdownContent.tsx` L40-49 |
| 分析中占位符 | 最新 turn 无答案 + 流式中 | 占位文字 | 扫光动画，时长自适应（3s/3.5s/4s） | `TurnBlock.tsx` L735-785 |

> ⚠️ **扫光位置说明**：过程面板的扫光作用于**条目展开详情区域内的 `entry.summary` 文本**（`ProcessPanel.tsx` L710 的 div），**不是** `entry.title` 标题行（L643-681 的 titleButton）。由于 active 条目在 running 阶段通常 auto-expanded，扫光可见；但条目折叠时扫光不可见。

```
过程面板 active entry（4s 循环）：         答案气泡流式空闲（2.5s 无新内容）：

┌────────────────────────────────┐        ┌────────────────────────────────┐
│ 💭 思考 #1 · ⏳                 │        │ # 根因分析                      │
│   ░▒▓ 用户提到丢包问题... ▓▒░   │        │ ## 摘要                         │
│         ↑ 扫光在 summary 行      │        │ 本次诊断░▒▓结论是... ▓▒░        │
└────────────────────────────────┘        └────────────────────────────────┘
  扫光作用于 entry.summary（详情区域内）    扫光作用于 markdown 最后一个子元素
  条目必须展开才可见                        时长自适应：<40字→3s, <120字→3.5s, ≥120字→4s

  t=0s    ░▒▓____                    t=0s    ░▒▓____
  t=1s    __░▒▓__                    t=1s    __░▒▓__
  t=2s    ____░▒▓                    t=2s    ____░▒▓
  t=4s    ░▒▓____（循环）             t=2.5s  触发（无新 content delta）
```

### 1.5 打字机效果

`[已实现]`

助手消息气泡的内容流式追加使用打字机效果。

| 参数 | 数值 | 说明 |
|------|------|------|
| tick 间隔 | 32ms | 每帧间隔 |
| 初始可见字符 | 120 字符 | 首次显示时最多 120 字符 |
| 自适应步长 | 8 / 24 / 48 / 96 字符 | backlog ≤ 80 → step=8；81-250 → step=24；251-1000 → step=48；> 1000 → step=96 |
| markdown 渲染 | 前缀正常渲染 + live tail 流式样式 | `splitProgressiveMarkdownContent` 分割 |
| 流式空闲动画 | `STREAMING_TEXT_SWEEP_CSS` | 文字背景渐变扫光 |
| reduced-motion | 直接全量显示 | 禁用打字机和扫光 |

代码：`TurnBlock.tsx` L169-236（打字机）、L135-154（reduced-motion）。

**打字机逐字显示效果**（`|` 为光标，每 32ms 一帧）：

```
t=0ms     ┌─────────────────────────────┐
          │ # 根因分析|                   │  ← 初始 120 字符内，step=8
          └─────────────────────────────┘
t=32ms    │ # 根因分|析                    │
t=64ms    │ # 根因分析|                    │
t=96ms    │ # 根因分析 |                   │
...
t=416ms   │ # 根因分析                    │  ← backlog ≤ 80，step=8
          │ ## 摘要|                       │
...
t=2000ms  │ # 根因分析                    │  ← backlog 81-250，step=24
          │ ## 摘要                        │
          │ 本次诊断结论是：CPU 过|载...    │
...
t=5000ms  │ ...CPU 过载导致转发丢包，      │  ← backlog > 1000，step=96
          │ 建议扩容。|（流式追加中）        │
...
终态      │ ...建议扩容。                  │  ← 流式结束，全量 markdown 渲染
          └─────────────────────────────┘

reduced-motion 模式：直接显示终态，无逐字动画。
```

### 1.6 think/answer 内容安全过滤

`[UCD 设计建议]`

think 与 answer 的流式内容在呈现前进行可配置的安全过滤，对应 `10-implementation-gap-analysis.md` B17 / B18。目标：安全合规（prod 过滤）与调试效率（dev 全显）双向满足，且 live 与 history 过滤结果一致。

> **当前边界**：`[已实现-主干]` 同时存在两条不同语义的安全路径：runtime terminal `finalContent` 的正则替换/私钥阻断，以及 REMOTE 且启用 guardrail 时由受治理外部服务执行的输入/输出整轮拦截；后者可投影 terminal `OUTPUT_GUARD_BLOCKED`，并把命中轮次的 assistant 消息从后续 model-visible history 排除。完成 thinking 已持久化并可在 history 恢复，但当前仍不存在统一的字段级 live thinking/answer streaming 脱敏、live/history/share 一致策略或 dev/prod 展示开关。以下多层过滤均是 `[UCD目标/Clarify]`，必须先澄清 conversation stream 安全 owner 和 fail-closed 策略。

**目标过滤模式（配置 owner/scope/default 尚待 B18 clarify）**：

| 模式 | think 流式呈现 | answer 流式呈现 | 适用场景 |
|---|---|---|---|
| dev（调测） | 原文完整显示，打字机/扫光正常 | 原文完整显示，打字机/扫光正常 | 开发调测，排查模型行为 |
| prod（运行） | 敏感信息替换为占位，打字机/扫光作用于过滤后文本 | 同 think，过滤后文本走打字机 | 生产环境，安全合规 |

**多层防御架构**：think 是模型自由文本，无法用字段白名单保护（对比：工具参数/结果/skill/prompt 靠字段白名单从源头阻断）。模型在推理时可能复述被白名单保护的内容（系统 prompt、工具参数、raw 结果、skill body），单层正则扫描不足以覆盖此类语义内容泄漏，需多层防御：

| 层级 | 机制 | 覆盖范围 | 配置 |
|---|---|---|---|
| **第 1 层 正则内容扫描** | 复用/扩展 `system-output-redaction-guard` 的 6 类规则（私钥/password/Bearer/sk-/手机号/路径）；IP 作为业务内容保留 | 模式化秘密（key/token/路径） | dev 关闭 / prod 开启 |
| **第 2 层 源内容匹配脱敏** | think 文本与模型可见的原始敏感内容做子串匹配，命中替换为语义占位 | 语义内容泄漏：系统 prompt → `[REDACTED_PROMPT]`、工具 raw 结果 → `[REDACTED_TOOL_OUTPUT]`、skill body → `[REDACTED_SKILL]`、工具 args → `[REDACTED_ARGS]` | dev 关闭 / prod 开启 |
| **第 3 层 prompt 工程约束** | 系统 prompt 约束模型"不得在思考中复述系统指令、工具原始参数与结果原文" | 软约束，降低泄漏概率（不可单独依赖） | 始终启用 |
| **第 4 层 可选隐藏 think** | prod 模式下完全隐藏思考过程，仅显示最终回答 | 兜底措施，适用安全要求极高场景 | B18 独立配置项 |

**live=history 一致性目标**：若 B17/B18 决策采用字段级替换，必须先确定 authoritative scan/persistence owner，使 live、history 与 share 消费同一安全事实，不能先假定一定在 streaming projection 层实现。当前主干的 `system-output-redaction-guard` 作用于 runtime terminal `finalContent`；REMOTE configured guardrail 还可整轮拦截输出并发出 `OUTPUT_GUARD_BLOCKED`。两者都不等同于统一的 live thinking/answer 字段级替换策略。

**视觉示例（prod 模式下 think 流式多层过滤）**：

```
t=0ms     ┌──────────────────────────────────────────┐
          │ 💭 思考 #1 · ⏳                           │
          │ 让我查询数据库连接，先用                  │
          │ 密码 [REDACTED_SECRET] 连接到│            │  ← 第1层：原文 "sk-abc123..." 命中 sk- 规则
          └──────────────────────────────────────────┘
t=32ms    │ 密码 [REDACTED_SECRET] 连接到 10.0.0.5│  ← IP 作为业务内容保留原文
t=64ms    │ 系统提示要求我 [REDACTED_PROMPT] 然后执行│  ← 第2层：复述系统 prompt 片段
t=96ms    │ 工具返回了 [REDACTED_TOOL_OUTPUT] 其中   │  ← 第2层：复述工具 raw 结果片段
```

**dev 模式同一帧**（第 1/2 层过滤关闭，原文完整显示，便于调测）：

```
t=0ms     ┌──────────────────────────────────────────┐
          │ 💭 思考 #1 · ⏳                           │
          │ 让我查询数据库连接，先用                  │
          │ 密码 sk-abc123... 连接到│                 │  ← 原文完整可见
          └──────────────────────────────────────────┘
t=64ms    │ 系统提示要求我检查所有核心交换机的LLDP   │  ← 复述系统 prompt 原文可见
t=96ms    │ 工具返回了 eth0: up, eth1: down 其中     │  ← 复述工具 raw 结果原文可见
```

> 注意：完成 think 的持久化与 history hydration 已交付；安全过滤多层防御仍见 B17，配置开关（含第 4 层隐藏 think）仍见 B18。已持久化不等于已经完成字段级脱敏治理。

### 1.7 历史过程渐进加载

历史会话采用“Message 先可见、Event 后补齐”的两阶段体验。过程历史的后台加载不得阻塞用户阅读消息，也不得在执行详情标题上短暂闪现“加载历史信息”文本。

| 用户行为 | 调度与反馈 |
|---|---|
| 页面刷新或切换会话 | 先呈现 Message history；Event history 只为真实可视回合和一个视口预加载范围排队 |
| 鼠标滚轮或键盘滚动 | 每个 animation frame 最多发布一次可视目标；预加载目标需稳定 120ms |
| 拖动滚动条 | 拖动期间不发布中间目标；pointer release 后按最终可视区调度 |
| 预览 marker hover | 只显示已有摘要，不触发过程 Event 请求 |
| 预览 marker click | 目标回合进入显式优先队列；若目标页尚未加载，先加载目标页再定位 |
| 展开过程面板 | 已有缓存立即显示；尚未加载时在面板内容区显示局部 loading，不改写稳定标题 |
| 离开可视区或折叠面板 | 已发出的请求继续完成并进入缓存，不因视图抖动反复取消和重发 |
| 会话切换或 store dispose | 终止旧会话尚未完成的请求，防止跨会话回填 |

自动目标和显式目标分别最多保留 16 个，Event 请求全局最多并发 4 个，同一 run 的分页必须串行。首次等待不足 300ms 时不显示 loading-only 行；超过 300ms 后仍保持原标题，只在内容区使用非文本 spinner。失败时保留 Message，展开面板提供安全重试；旧数据明确不存在 Event history 时显示终态不可用提示，不循环重试。

### 1.8 长时任务三选择分流

> 对应 `openspec/designs/architecture/conversation-ui-state.md` "任务输出与上下文解耦原则"章节、`10-implementation-gap-analysis.md` A3 / A4 / B19 / B20。本节是跨组件的动态行为规范，定义用户面对长时任务时的三个选择及其动态呈现。

> **当前边界**：本节整体为 `[UCD目标]`。`[已实现-主干]` 仅 Bash 具备受控后台执行；通用 `outputContextMode`、运行中“转后台/Fork” CTA、tool `cancel()`/`reportProgress()` 尚未形成契约。Cron 当前仍以任务绑定的 `task.sessionId` 调用 `runtime.submit`，会进入原会话路径；既定架构目标要求 occurrence 不得污染原会话 active context。B19 只澄清改走派生 session、schedule-bound execution session 还是独立结果日志，以及对应查看入口；不能把继续写原会话当普通候选。

**核心原则**：长时任务的输出是否进入会话 active context，由用户在任务发起或运行中**显式选择**，系统不隐式决定。

**三个选择**：

| 选择 | 触发条件 | 输出与上下文关系 | 用户继续对话位置 | 原会话状态 |
|---|---|---|---|---|
| **1. 等待**（默认） | 用户愿意等 | ✅ 输出进入当前会话 active context | 当前会话 | 阻塞，等任务完成 |
| **2. 转后台** | 用户不愿等 + 输出**不需要**进上下文 | ❌ 输出不进 active context，存到监控面板 | 当前会话继续 | 不阻塞，任务在后台跑 |
| **3. Fork 继续** | 用户不愿等 + 输出**需要**进上下文 | ✅ 输出进入**原会话** active context（任务完成后） | **新派生会话**继续 | 原会话继续等任务完成 |

**决策树**：

```
用户调起长时任务
    │
    ├─ 用户愿意等待？ ──是──→ 选择 1：等待（默认，无 CTA）
    │                       │
    │                       └─ 任务完成 → 输出进 context → 用户继续对话
    │
    └─ 用户不愿等待
            │
            ├─ 输出需要参与后续上下文？ ──否──→ 选择 2：转后台
            │                                   │
            │                                   ├─ 任务移到 ⚡ 监控面板
            │                                   ├─ 输出存独立存储（不进 context）
            │                                   ├─ 对话流保留"已转后台"标记卡片
            │                                   └─ 用户在当前会话继续对话
            │
            └─ 是──→ 选择 3：Fork 继续
                        │
                        ├─ 从上一轮已完成答案处 fork 新会话
                        ├─ 新会话继承 fork 点之前的 active context
                        ├─ 原会话继续等待任务完成（输出仍进原会话 context）
                        └─ 用户在新会话继续对话
```

**状态转换**（inline-running ↔ backgrounded）：

| 转换 | 触发 | UI 动态行为 | 状态 |
|---|---|---|---|
| invoke → inline-running | 默认 | 能力卡片出现，展示扩展态（计时器/进度/CTA） | `[UCD 设计建议]` |
| invoke → backgrounded | `background: true` 参数 | 跳过 inline，直接进入 `⚡` 面板 | `[已实现]`（仅 Bash） |
| inline-running → backgrounded | 用户点"转后台" CTA | 卡片转为"已转后台"标记态，`⚡` 面板新增条目 | `[UCD 设计建议]` |
| inline-running → terminal | 任务完成 | 正常终态卡片，输出进 context | `[已实现]` |
| backgrounded → terminal | 任务完成/用户 Kill | `⚡` 面板条目转终态，对话流追加终态卡片（输出不进 context） | `[UCD 设计建议]`（tool 类型）/ `[已实现]`（shell 类型） |

**CTA 可见性规则**（受工具声明的 `outputContextMode` 调控）：

| `outputContextMode` | 含义 | 等待 | 转后台 CTA | Fork 继续 CTA | 典型工具 |
|---|---|---|---|---|---|
| `required` | 输出必须进 context | ✅ | ❌ 隐藏 | ✅ 显示 | 网络诊断、配置审计、复杂分析 |
| `decoupled` | 输出可不进 context | ✅ | ✅ 显示 | ❌ 隐藏（fork 无意义） | dev server、build、log watch、批量采集 |
| `user-choice`（默认） | 用户决定 | ✅ | ✅ 显示 | ✅ 显示 | 通用工具 |

**扩展态动态行为**（inline-running 态的能力卡片）：

- **运行计时器** `[UCD 设计建议]`：从 `startedAt` 累计运行时长，每秒更新；超过 60s 进入"长时"视觉态（边框/背景色变化提示用户考虑分流）
- **进度条** `[UCD 设计建议]`：若工具实现 `reportProgress()`，展示百分比进度条（300ms 宽度过渡）；未实现则隐藏
- **取消按钮** `[UCD 设计建议]`：若工具实现 `cancel()`，显示"取消"按钮（Popconfirm 二次确认 → loading → 终态）；未实现则 disabled 并 tooltip "此任务不支持取消"
- **转后台 CTA** `[UCD 设计建议]`：点击后卡片高度收缩（grid-template-rows 1fr→0fr 200ms ease-out）→ 转为"已转后台"标记态（折叠为单行 summary）→ `⚡` 面板新增条目（fade-in 200ms）
- **Fork 继续 CTA** `[UCD 设计建议]`：点击后 Popconfirm "将派生新会话继续对话，原会话继续等待任务完成？" → 确认后跳转新会话（fade-out 当前视图 + fade-in 新会话）

**转后台后的标记卡片动态行为** `[UCD 设计建议]`：

```
┌─ 🔧 能力卡片 · ⏰ 已转后台 ─────────────────────────┐
│  ▶ 网络拓扑扫描（cron-abc123）              [⚡ 查看] │  ← 折叠态，点击 [⚡ 查看] 跳到 ⚡ 面板
└────────────────────────────────────────────────────────┘
```

- 任务完成时：标记卡片自动展开 200ms，显示终态（completed/failed）+ "查看结果"按钮（跳到 `⚡` 面板查看输出，**不进 context**）
- 任务失败时：标记卡片高亮 error 色调，显示 safeErrorCategory

**与 cron 任务的关联**：cron 触发执行等价于**选择 2 转后台**——输出不应进入原会话 active context。这为 cron 执行结果会话归属策略（见 `10-implementation-gap-analysis.md` B19）提供共同约束：任何方案都必须保证 cron 触发产生的 think/tool/answer 不污染原会话 context。

**reduced-motion 降级** `[UCD 设计建议]`：
- 计时器仍每秒更新（无动画）
- 进度条立即跳到目标值（无宽度过渡）
- 转后台 CTA 触发后立即切换（无高度收缩动画）
- Fork 继续 CTA 触发后立即跳转（无 fade 过渡）

> 注意：三选择场景的完整架构原则与契约层定义见 `conversation-ui-state.md` "任务输出与上下文解耦原则"章节；能力卡片扩展态的具体 UI 行为见 `05-component-specs/capability-card.md`；后台任务监控面板的 taskType 泛化方向见 `05-component-specs/background-task-monitor.md`。

---

## 2. 滚动行为与焦点跟随

| 行为 | 状态 | 说明 | 代码位置 |
|------|------|------|---------|
| 视口跟随底部 | `[已实现]` | 答案内容/面板高度变化 + viewport 在底部时 auto-scroll 到底 | `TurnBlock.tsx` L1181-1193 |
| 滚动锚定补偿 | `[已实现]` | 面板高度变化导致内容偏移时，`onRequestAnchorCompensation` 补偿 | `ProcessPanel.tsx` L199-211 |
| 会话列表 scrollIntoView | `[已实现]` | 选中会话时 `scrollIntoView` 到视口 | `Sidebar.tsx` L245-254 |
| slash 命令 scrollIntoView | `[已实现]` | 键盘上下选择时高亮项滚动到视口 | `MessageInput.tsx` L516 |
| 关联问题 scrollIntoView | `[已实现]` | 关联高亮索引变化时滚动到视口 | `MessageInput.tsx` L527 |
| 过程面板 active 条目跟随 | `[已实现]` | active key/sequence 接入共享 bottom-following viewport owner；不调用 `scrollIntoView`，不创建第二个 viewport controller |
| 用户滚动后暂停 auto-scroll | `[UCD 设计建议]` | 用户手动向上滚动后暂停视口跟随；新内容到达时显示"↓ 新内容"提示，点击后恢复跟随 |

**滚动行为视觉**：

```
场景 1: 视口跟随底部（auto-scroll）      场景 2: 用户向上滚动后暂停（[UCD 设计建议]）
┌─ 对话区（viewport）────────────┐      ┌─ 对话区（viewport）────────────┐
│  🧑 用户消息                     │      │  🧑 用户消息                     │
│  📋 过程面板                     │      │  📋 过程面板                     │
│  🤖 助手回复...                  │      │  🤖 助手回复（部分）              │
│  ↓ 跟随到底部                    │      │                                │
└──────────────────────────┬──────┘      │  ┌──────────────────────────┐  │
                           ▼ 新内容       │  │ ↓ 3 条新内容              │  │ ← 提示条
                           持续追加       │  └──────────────────────────┘  │
                                         │  │（viewport 停在此处）        │  │
                                         └──────────────────────────────┘
  视口始终在底部，新内容自动滚入视野         用户向上滚动后暂停跟随，显示"↓ 新内容"
                                          点击提示后恢复跟随到底部
```

---

## 3. 通用交互响应模式

定义所有组件共用的 7 个维度。每个组件规格的"动态行为与交互响应"章节引用本文并补充组件特有行为。

### 3.1 hover

| 组件 | 状态 | 当前效果 / 设计建议 |
|------|------|---------------------|
| 会话列表项 | `[已实现]` | hover 高亮 + 显示操作菜单（`SessionHistoryEntryRow.tsx` L66, L127-163） |
| 消息气泡（USER 气泡） | `[已实现]` | USER 气泡 hover 显示操作按钮（`TurnBlock.tsx` L1255 `visible={isUserRegionHovered}`） |
| 消息气泡（ASSISTANT 气泡） | `[已实现]` | ⚠️ ASSISTANT 气泡操作按钮始终可见（`visible` 为 true，L1354），不受 hover 控制 |
| Composer 按钮 | `[已实现]` | hover 背景色变化 120ms（theme.css L545-546, L568-569） |
| 过程面板 summary row | `[UCD 设计建议]` | hover 背景色变化 + cursor pointer |
| 能力卡片 | `[UCD 设计建议]` | hover 边框/阴影变化 |
| 降级提示卡片 | `[UCD 设计建议]` | hover 背景色变化 |
| Expand Panel Close 按钮 | `[UCD 设计建议]` | hover 背景色变化 |
| 导航卡片 | `[UCD 设计建议]` | hover 边框/阴影变化，提示可点击 |
| 文件下载卡片 | `[UCD 设计建议]` | hover 边框/阴影变化 |
| Cron 管理面板行 | `[UCD 设计建议]` | hover 背景色变化 |
| 后台任务监控列表项 | `[UCD 设计建议]` | hover 背景色变化 |

**统一 hover 规范** `[UCD 设计建议]`：背景色变化 + 可选阴影，120ms transition。

**hover 视觉对比**（以会话列表项和能力卡片为例）：

```
会话列表项 hover（已实现）：               能力卡片 hover（[UCD 设计建议]）：
┌────────────────────────────┐          ┌────────────────────────────┐
│  网络诊断         ⚡ ✏️ 🗑️  │  ← hover │ ╭─ 🔧 queryAlerts · ✅ ───╮ │  ← hover
│  丢包排查                   │  显示菜单 │ │  3 条告警               │ │  边框加深
│  ▸ 告警分析                 │          │ ╰────────────────────────╯ │  + 阴影
└────────────────────────────┘          └────────────────────────────┘
  无 hover 时：无背景色、无操作菜单         无 hover 时：标准边框、无阴影
```

### 3.2 click/激活

| 组件 | 状态 | 当前效果 / 设计建议 |
|------|------|---------------------|
| action 按钮 | `[已实现]` | color transition 160ms（`TurnBlock.tsx` L274） |
| 所有可点击元素 | `[UCD 设计建议]` | active 态视觉反馈：scale 0.98 或背景色加深，100ms transition |

**统一 click 规范** `[UCD 设计建议]`：active 态 scale(0.98) 或背景色加深，100ms transition。

**click 视觉对比**：

```
按钮按下（active 态）：                    卡片按下（active 态）：
┌──────────────────┐                      ┌──────────────────────────┐
│  发送  ← scale(0.98) │  ← 按下瞬间     │  ╭─ 🔧 queryAlerts ───╮   │ ← scale(0.98)
│  ████             │    背景色加深       │  │  ...               │   │   背景色加深
└──────────────────┘                      │  ╰───────────────────╯   │
                                            └──────────────────────────┘
  释放后 100ms 恢复原始尺寸和颜色            释放后 100ms 恢复
```

### 3.3 focus（键盘可达性）

| 组件 | 状态 | 当前效果 / 设计建议 |
|------|------|---------------------|
| 会话列表项 | `[已实现]` | `role=button, tabIndex=0, aria-current=page`，Enter/Space 打开（`session-list-item.md` L336） |
| 所有可交互元素 | `[UCD 设计建议]` | `focus-visible` 样式：2px primary 色 outline + 2px offset，支持 Tab 键导航 |

**统一 focus 规范** `[UCD 设计建议]`：`:focus-visible` outline 2px primary + offset 2px。

**focus 视觉**（键盘 Tab 导航时）：

```
会话列表项获得焦点：                       发送按钮获得焦点：
                                          
  ┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄              ┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄
  ┊ ┌────────────────────────┐ ┊        ┊ ┌──────────────────┐ ┊
  ┊ │ ● 网络诊断      ⚡ ✏️ 🗑 │ ┊        ┊ │   发送 →          │ ┊
  ┊ └────────────────────────┘ ┊        ┊ └──────────────────┘ ┊
  ┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄              ┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄
    ↑ 2px primary outline              ↑ 2px primary outline
    ↑ 2px offset（虚线示意间距）          ↑ 2px offset
    Tab 键移入 → 获得焦点                Tab 键移入 → 获得焦点
```

### 3.4 disabled

| 组件 | 状态 | 当前效果 / 设计建议 |
|------|------|---------------------|
| Composer 发送按钮 | `[已实现]` | 空消息/上传中/重连中 disabled（`MessageInput.tsx` L1701） |
| Pending input 提交中 | `[已实现]` | 所有输入控件 disabled + 提交按钮 Spin loading（`RespondInput.tsx` L329-338） |
| 后台任务 Kill 进行中 | `[已实现]` | Popconfirm disabled（`background-task-monitor.md` L118） |
| 无 Write 权限菜单项 | `[已实现]` | 重命名和删除菜单项禁用（`session-list-item.md` L337） |

**统一 disabled 规范** `[UCD 设计建议]`：opacity 0.5 + cursor not-allowed。

**disabled 视觉对比**：

```
正常状态：                                disabled 状态：
┌──────────────────┐                      ┌──────────────────┐
│   发送 →          │  ← 可点击            │   发送 →          │  ← opacity 0.5
│                  │    cursor: pointer   │                  │    cursor: not-allowed
└──────────────────┘                      └──────────────────┘
  按钮实色、可 hover                         按钮半透明、不响应 hover
  （消息非空时）                             （消息为空 / 上传中 / 重连中）

权限门控示例：
┌─ 会话操作菜单 ──────────────┐
│  ✏️ 重命名        （disabled）│  ← 无 Write 权限，opacity 0.5
│  🗑️ 删除          （disabled）│  ← 无 Write 权限，opacity 0.5
│  📋 复制链接      （enabled）  │  ← View 权限可用
└──────────────────────────────┘
```

### 3.5 loading

| 组件 | 状态 | 当前效果 / 设计建议 |
|------|------|---------------------|
| 消息气泡 | `[已实现]` | antd Skeleton active（`TurnBlock.tsx` L1195-1211） |
| Composer 发送按钮 | `[已实现]` | antd Spin（`MessageInput.tsx` L1678） |
| 后台任务监控 | `[已实现]` | LoadingOutlined primary 色（`BackgroundTaskMonitorPanel.tsx` L48） |
| Run Graph running 节点 | `[已实现]` | CSS 脉冲动画 1.2s（`runGraph.css` L421-423） |
| 过程面板 idle-sweep | `[已实现]` | 文字扫光 4s（`ProcessPanel.tsx` L83-110） |
| Expand Panel | `[UCD 设计建议]` | skeleton 占位 |
| 会话列表 | `[UCD 设计建议]` | skeleton 占位 |

**统一 loading 规范** `[UCD 设计建议]`：骨架屏 shimmer（antd Skeleton active）或 spinner 16px primary 色。

**loading 视觉**：

```
消息气泡骨架屏（已实现）：                  发送按钮 spinner（已实现）：
┌────────────────────────────┐           ┌──────────────────┐
│ ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓ │           │   ◌ 发送中...     │  ← Spin 旋转
│ ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓ │           └──────────────────┘
│ ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓ │             antd Spin primary 色
└────────────────────────────┘
  antd Skeleton active（shimmer 扫光）      后台任务 running（已实现）：
                                            
  会话列表 skeleton（[UCD 设计建议]）：     ┌─ ⚡ 后台任务 ──────────────┐
  ┌────────────────────────────┐           │ ⏳ bash-rotate-logs  ◌  │  ← LoadingOutlined
  │ ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓ │           │ ✅ config-backup         │
  │ ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓ │           └──────────────────────────┘
  └────────────────────────────┘
```

### 3.6 error

| 组件 | 状态 | 当前效果 / 设计建议 |
|------|------|---------------------|
| 能力失败卡片 | `[UCD 设计建议]` | `safeErrorCategory` 色调映射未实现，当前只有文本内容（`capability-card.md` L726-798）。视觉色调映射为设计建议 |
| Pending input submitError | `[已实现]` | Alert type=error（`pending-input-card.md` L319-327） |
| 断线状态条 | `[已实现]` | warning/info 色区分（`ChatPage.tsx` L1943-1953） |
| 附件校验失败 | `[已实现]` | warning Alert（`composer.md` L307-313） |

**统一 error 视觉** `[UCD 设计建议]`：error 色 `var(--color-error)` + 错误图标 + 可重试时显示重试按钮。

**error 视觉**：

```
能力失败卡片（文本内容已实现，色调映射为 UCD 设计建议）：
┌─ 🔧 queryAlerts · ❌ 失败 ──────────────────┐
│ ⚠️ TIMEOUT                                  │  ← error 色 + ⚠️ 图标
│    查询超时（30s），设备可能不可达            │
│                                              │
│         [ 🔁 重试 ]   [ 查看详情 ▸ ]         │  ← 可重试时显示
└──────────────────────────────────────────────┘
> ⚠️ 当前代码只有文本内容（code/category/summary 文字呈现），按 category 映射不同边框色/背景色/图标的视觉色调映射未实现。

断线状态条（已实现）：
┌──────────────────────────────────────────────┐
│ ⚠️ 连接已断开，正在重连...（第 2 次尝试）     │  ← warning 色
└──────────────────────────────────────────────┘

Pending input submitError（已实现）：
┌─ ⏳ Pending Input 卡片 ──────────────────────┐
│ ⚠️ 提交失败                                  │  ← Alert type=error
│    网络错误，请重试                           │
│         [ 🔁 重新提交 ]                       │
└──────────────────────────────────────────────┘
```

### 3.7 appear/disappear

| 组件 | 状态 | 当前效果 / 设计建议 |
|------|------|---------------------|
| 压缩通知 | `[已实现]` | 出现后 3s 自动消失（`TurnBlock.tsx` L1088-1113） |
| antd Modal/Drawer | `[已实现]` | antd 内置打开/关闭动画 |
| 过程面板展开/折叠 | `[已实现]` | height + opacity 200ms（`ProcessPanel.tsx` L607-619） |
| 条目展开/折叠 | `[已实现]` | grid-template-rows 200ms（`ProcessPanel.tsx` L700-707） |
| Sidebar 宽度过渡 | `[已实现]` | width 200ms（`Sidebar.tsx` L535） |
| 面板宽度过渡 | `[已实现]` | width 120ms（`ChatPage.tsx` L470） |
| 消息气泡出现 | `[UCD 设计建议]` | fade-in + slide-up 200ms ease-out |
| 能力卡片出现 | `[UCD 设计建议]` | fade-in 200ms ease-out |
| 新会话出现 | `[UCD 设计建议]` | fade-in + slide-down 200ms |
| 降级提示出现 | `[UCD 设计建议]` | fade-in 200ms |
| 后台任务监控面板 | `[UCD 设计建议]` | fade-in/out 200ms |
| 删除动画 | `[UCD 设计建议]` | fade-out 150ms + height collapse |

**统一 appear/disappear 规范** `[UCD 设计建议]`：
- 出现：fade-in 200ms ease-out（可选 slide-up/down 200ms）
- 消失：fade-out 150ms ease-in + height collapse 200ms
- 新条目：slide-down 200ms ease-out

**appear/disappear 视觉**：

```
压缩通知出现 → 3s 自动消失（已实现）：
t=0ms   ┌──────────────────────────┐
        │ 📦 上下文已压缩（保留 80%）│  ← fade-in 出现（opacity 0→1, 200ms）
        └──────────────────────────┘
t=3000ms（3s 后）
        ┌──────────────────────────┐
        │                          │  ← fade-out 消失（opacity 1→0, 150ms）
        └──────────────────────────┘
t=3150ms
                                     ← height collapse（200ms）后完全移除

新会话出现（[UCD 设计建议]）：
t=0ms     ┌────────────────────────┐
          │▓ 新会话                 │  ← fade-in + slide-down（从上方滑入）
          │▓                        │     opacity 0→1, translateY -8px→0
          └────────────────────────┘
t=200ms   ┌────────────────────────┐
          │ ● 新会话                │  ← 完成，opacity 1, translateY 0
          └────────────────────────┘

删除动画（[UCD 设计建议]）：
t=0ms     ┌────────────────────────┐
          │ ● 旧会话                │  ← fade-out + height collapse
          └────────────────────────┘
t=150ms   ┌────────────────────────┐
          │                        │  ← opacity 0, height 开始收缩
          └────────────────────────┘
t=350ms                                     ← 完全移除，下方条目上移
```

---

## 4. 动画参数规范

### 4.1 时长规范

| 参数 | 数值 | 用途 | 状态 |
|------|------|------|------|
| 过渡时长（标准） | **200ms** | 面板展开/折叠、条目展开/折叠、气泡 appear、卡片 appear | `[已实现]`（面板/条目）/ `[UCD 设计建议]`（气泡/卡片） |
| 过渡时长（快速） | **120ms** | 按钮 hover、边框色变化、背景色变化、面板宽度 | `[已实现]` |
| 过渡时长（click） | **100ms** | active 态 scale/背景色 | `[UCD 设计建议]` |
| 延迟（面板 auto-collapse） | **150ms** | run settled 后面板折叠前等待 | `[已实现]` |
| 延迟（per-entry auto-collapse） | **800ms** | 条目完成后折叠前等待（让用户看到结果预览） | `[已实现]` |
| tick（打字机） | **32ms** | 打字机每帧间隔 | `[已实现]` |
| idle 触发（答案） | **2.5s** | 无新 content delta 后触发 idle-sweep | `[已实现]` |
| idle 触发（过程面板） | **2.5s** | active entry 无新序列后触发 idle-sweep | `[已实现]` |
| 循环（idle-sweep，过程面板） | **4s** | 过程面板 active entry 文字扫光一个循环时长 | `[已实现]` |
| 循环（idle-sweep，答案气泡） | **3s/3.5s/4s** | 答案气泡/占位符扫光时长自适应：内容 <40 字符→3s，<120 字符→3.5s，≥120 字符→4s | `[已实现]` |
| 自动消失（压缩通知） | **3s** | 压缩通知显示后自动隐藏 | `[已实现]` |
| 循环（Run Graph running 脉冲） | **1.2s** | running 节点脉冲动画周期 | `[已实现]` |
| 循环（Run Graph active 脉冲） | **1s** | active 节点脉冲动画周期 | `[已实现]` |
| 循环（Run Graph active 扫描） | **1.05s** | active 节点扫描动画周期 | `[已实现]` |
| 复制反馈持续 | **1.5s** | 复制成功后"已复制"显示时长 | `[已实现]` |
| 进度条过渡 | **300ms** | safeProgress 进度条宽度过渡 | `[UCD 设计建议]` |

**参数关系时间轴**（以一次 run 为例，展示各动画参数在时间轴上的分布）：

```
0ms         32ms                        150ms                         800ms
│            │                           │                              │
├─ tick ─┤   │                           │                              │
│ 打字机  │   │                           │                              │
└────────┘   │                           │                              │
             │                           │                              │
             ├────── 120ms ──────────────┤                              │
             │ 按钮 hover / 背景色过渡    │                              │
             └───────────────────────────┘                              │
                                         │                              │
                                         ├────── 200ms ─────────────────┤
                                         │ 面板/条目展开折叠过渡        │
                                         └──────────────────────────────┤
                                                                        │
                                                                        ├─ 800ms 延迟 ─→
                                                                        │ per-entry auto-collapse
                                                                        │ （条目完成后等待）
                                                                        └─→ 折叠开始

循环类参数（独立于时间轴）：
┌─ 4s ──────────────────┐  ┌─ 1.2s ──────┐  ┌─ 1s ────┐  ┌─ 1.05s ───┐
│ idle-sweep 扫光循环    │  │ Run Graph   │  │ active  │  │ active    │
│ （2.5s 无活动后触发）  │  │ running 脉冲 │  │ 脉冲    │  │ 扫描      │
└───────────────────────┘  └─────────────┘  └─────────┘  └───────────┘

延迟类参数：
┌─ 150ms ─┐  ┌─ 800ms ──────────────────┐  ┌─ 3s ──────────────────────┐
│ 面板 auto│  │ per-entry auto-collapse   │  │ 压缩通知自动消失           │
│ -collapse│  │ 延迟                      │  │                           │
│ 延迟     │  └───────────────────────────┘  └───────────────────────────┘
└─────────┘
```

| 场景 | 缓动函数 | 说明 |
|------|----------|------|
| 展开出现 | `ease-out` | 快进慢出，适合展开/出现 |
| 折叠消失 | `ease-in` | 慢进快出，适合消失 |
| 脉冲循环 | `ease-in-out` | 呼吸感 |
| 按钮 hover | `ease` | 标准缓动 |

### 4.3 reduced-motion 规范

`[已实现]`

当用户系统设置开启"减弱动画"（`prefers-reduced-motion: reduce`）时：

| 行为 | 降级策略 | 代码位置 |
|------|----------|---------|
| 打字机效果 | 禁用，直接全量显示 | `TurnBlock.tsx` L135-154 |
| idle-sweep 扫光 | 禁用 | `TurnBlock.tsx` L773-779 |
| Run Graph 脉冲/扫描 | 禁用（`.turn-run-graph-canvas--reduced-motion`） | `runGraph.css` L451-465 |
| 过渡动画 | `[UCD 设计建议]` 降级为 0ms（即时切换） | — |

代码：`TurnBlock.tsx` L135-154（`matchMedia('(prefers-reduced-motion: reduce)')`）。

**reduced-motion 对比视觉**：

```
正常模式：                                reduced-motion 模式：
┌─ 🤖 助手 ──────────────────┐          ┌─ 🤖 助手 ──────────────────┐
│ # 根因分析|                  │          │ # 根因分析                  │
│  ↑ 打字机逐字显示             │          │ 本次诊断结论是：CPU 过载     │  ← 直接全量
│  ↑ idle-sweep 扫光           │          │ 建议扩容。                  │     无动画
│  ↑ 32ms tick                 │          │                             │
└──────────────────────────────┘          └──────────────────────────────┘

┌─ 📋 过程面板 ───────────────┐          ┌─ 📋 过程面板 ───────────────┐
│ 💭 思考 #1 · ⏳              │          │ 💭 思考 #1 · ⏳              │  ← 无扫光
│   ░▒▓ 用户提到丢包... ▓▒░   │          │   用户提到丢包问题...        │     summary 文字
│ 🔧 queryAlerts · ⏳          │          │ 🔧 queryAlerts · ⏳          │     正常显示
│   ░▒▓ 查询告警中... ▓▒░     │          │   查询告警中...              │
└──────────────────────────────┘          └──────────────────────────────┘
  summary 行扫光 4s 循环                    无循环动画
  展开折叠 200ms 过渡                       展开折叠即时完成（0ms）
```

---

## 5. 各组件动态行为速查表

| 组件 | running 动画 | hover | click | focus | disabled | loading | error | appear/disappear |
|------|-------------|-------|-------|-------|----------|---------|-------|------------------|
| 过程面板 | idle-sweep `[已实现]` | `[建议]` | `[已实现]` 过渡 | `[建议]` | N/A | N/A | `[已实现]` 终态 | `[已实现]` 展开/折叠 |
| 能力卡片 | `[建议]` 旋转/脉冲 | `[建议]` | `[建议]` | `[建议]` | N/A | N/A | `[建议]` 色调 | `[建议]` fade-in |
| 消息气泡 | `[已实现]` 打字机 | `[已实现]` 按钮 | `[已实现]` transition | `[建议]` | N/A | `[已实现]` Skeleton | `[已实现]` 终态 | `[建议]` fade-in |
| 会话列表项 | `[建议]` 脉冲点 | `[已实现]` | `[已实现]` | `[已实现]` | `[已实现]` 菜单 | `[建议]` skeleton | N/A | `[建议]` fade-in |
| Composer | `[已实现]` 停止按钮 | `[已实现]` 按钮 | `[建议]` | `[建议]` | `[已实现]` | `[已实现]` Spin | `[已实现]` Alert | N/A |
| Pending input | `[已实现]` 倒计时 | `[建议]` | `[建议]` | `[建议]` | `[已实现]` | `[已实现]` Spin | `[已实现]` Alert | `[建议]` fade-in |
| 降级提示 | N/A | `[建议]` | `[建议]` 展开 | `[建议]` | N/A | N/A | `[建议]` 色调 | `[建议]` fade-in |
| Expand Panel | N/A | `[建议]` Close | `[建议]` | `[建议]` | N/A | `[建议]` skeleton | N/A | `[建议]` slide-in |
| 导航卡片 | N/A | `[建议]` | `[建议]` scale | `[建议]` | N/A | N/A | N/A | `[建议]` fade-in |
| 文件下载 | N/A | `[建议]` | `[建议]` | `[建议]` | N/A | `[建议]` spinner | `[建议]` 过期 | `[建议]` fade-in |
| Cron 任务 | `[建议]` | `[建议]` | `[建议]` | `[建议]` | N/A | `[建议]` | N/A | `[建议]` fade-in |
| 后台任务监控 | `[已实现]` LoadingOutlined | `[建议]` | `[已实现]` Kill | `[建议]` | `[已实现]` Kill | `[已实现]` Spin | `[已实现]` 色调 | `[建议]` fade-in |
| Run Graph | `[已实现]` 脉冲 | `[已实现]` 节点 | `[已实现]` 按钮 | `[建议]` | N/A | `[已实现]` Suspense | N/A | `[已实现]` Drawer |
| 断线重连 | N/A | N/A | N/A | N/A | `[已实现]` composer | N/A | `[已实现]` 状态条 | `[建议]` 脉冲 |

> `[已实现]` = 代码已实现；`[建议]` = UCD 设计建议，代码未实现；N/A = 不适用于此组件。

**覆盖率汇总**（✅ 已实现 / ⚠️ 建议 / — 不适用）：

```
组件            running  hover  click  focus  disabled  loading  error  appear
──────────────  ───────  ─────  ─────  ─────  ────────  ───────  ─────  ──────
过程面板          ✅       ⚠️     ✅     ⚠️      —        —       ✅      ✅
能力卡片          ⚠️       ⚠️     ⚠️     ⚠️      —        —       ⚠️     ⚠️
消息气泡          ✅       ✅     ✅     ⚠️      —        ✅      ✅      ⚠️
会话列表项        ⚠️       ✅     ✅     ✅      ✅       ⚠️      —      ⚠️
Composer         ✅       ✅     ⚠️     ⚠️      ✅       ✅      ✅      —
Pending input    ✅       ⚠️     ⚠️     ⚠️      ✅       ✅      ✅      ⚠️
降级提示          —        ⚠️     ⚠️     ⚠️      —        —       ⚠️     ⚠️
Expand Panel     —        ⚠️     ⚠️     ⚠️      —        ⚠️      —      ⚠️
导航卡片          —        ⚠️     ⚠️     ⚠️      —        —       —      ⚠️
文件下载          —        ⚠️     ⚠️     ⚠️      —        ⚠️      ⚠️     ⚠️
Cron 任务         ⚠️       ⚠️     ⚠️     ⚠️      —        ⚠️      —      ⚠️
后台任务监控      ✅       ⚠️     ✅     ⚠️      ✅       ✅      ✅      ⚠️
Run Graph        ✅       ✅     ✅     ⚠️      —        ✅      —      ✅
断线重连          —        —      —      —      ✅       —       ✅      ⚠️
──────────────  ───────  ─────  ─────  ─────  ────────  ───────  ─────  ──────
已实现 / 适用      7/9     4/13   6/13   1/12    4/5      6/8     6/9    3/13
缺口数（⚠️）        2       9      7     11      1        2       3      10
```

> **快速识别**：focus（11/12 缺失）、appear/disappear（10/13 缺失）、hover（9/13 缺失）是缺口最集中的维度。详见 `10-implementation-gap-analysis.md` B15。

---

## 6. 导航

| 查什么 | 去哪里 |
|--------|--------|
| 过程面板状态机 | `05-component-specs/process-panel.md` |
| 能力卡片状态机与 long-running | `05-component-specs/capability-card.md` |
| 打字机效果详细参数 | `05-component-specs/message-bubble.md` |
| 会话列表项交互 | `05-component-specs/session-list-item.md` |
| Composer 交互 | `05-component-specs/composer.md` |
| Pending input 超时 | `05-component-specs/pending-input-card.md` |
| 降级提示 | `05-component-specs/degradation-notice.md` |
| Expand Panel | `05-component-specs/expand-panel.md` |
| Run Graph 动画 | `05-component-specs/process-panel.md`（Run Graph 抽屉章节） |
| UX 限制（并行工具数、附件上限等） | `11-ux-limits-and-constraints.md` |
| think/answer 内容安全过滤（可配置） | 本文第 1.6 节、`10-implementation-gap-analysis.md` B17 |
| 平台管理员配置管理 | `10-implementation-gap-analysis.md` B18 |
| 未实现的动态行为缺口 | `10-implementation-gap-analysis.md` 中除已交付 B11/B16 外的当前 disposition |
