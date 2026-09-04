# 工具输出呈现策略（Tool Output Presentation Policy）

> ⚠️ **实现状态标注**：当前已经实现启动期 `STATUS_ONLY` / `SUMMARY` / `DETAIL` 三档 Capability 结果披露配置，配置按 exact `capability-id` 匹配并受平台安全上限约束；它不提供场景级截断阈值、内容扫描或终端用户切换。本文以下 4 种策略及 `detailLevel` / `truncationThreshold` / `redactionPolicy` 框架仍是 UCD 设计建议，不是当前配置契约。当前 safeResult 采用字段白名单、截断和 fail-closed；runtime terminal `finalContent` 另有正则替换/私钥阻断，REMOTE configured guardrail 可整轮拦截输入/输出。下文 **[遗留]** 均是 `[UCD目标/Clarify]` 输入，实施准入以 `docs/roadmap/ucd-capability-delivery.md` 为准。

## 职责

NextAgent 定位为 Agent 平台，不同业务场景对工具输出的呈现期望不同。本规范定义 **4 种呈现策略** 和 **可配置的策略框架**，让产品团队按场景配置工具输出的呈现方式。

当前可用配置请查阅 [`docs/用户配置和使用指导.md`](../../用户配置和使用指导.md) 的“工具执行结果显示策略”。当前三档只控制成功结果披露：`STATUS_ONLY` 显示身份和状态，`SUMMARY` 增加有效安全摘要，`DETAIL` 才允许既有 projector 批准的有界详情；失败安全事实不随档位扩张。Bash、Python、Rag 当前内置基线为 `DETAIL`，Read、Write、Edit、Glob、Grep、ToolSearch、Workflow 为 `SUMMARY`，AskUserQuestion、TodoWrite、Cron 为 `DETAIL`，其余无安全 projector 的内置项保持 `STATUS_ONLY`。这些最新默认值和专用呈现已进入主干，对应 `refine-capability-result-card-presentation` active change 尚待归档同步 Stable Spec。

典型场景：
- **诊断场景**：期望工具输出完整呈现（完整 stdout/文件内容），便于排查问题
- **日常对话场景**：期望仅显示工具名+成功/失败状态，不显示详细结果，保持对话简洁
- **数据查询场景**：期望短输出完整呈现、长输出截断，平衡信息量与可读性
- **安全审核场景**：期望对输出内容进行脱敏处理（如 IP/密码/token 替换为 `***`）

## 4 种呈现策略

### 策略 1：完整呈现（Full）

工具输出完整显示，不截断、不折叠。

```
┌─ 🔧 Bash · ✅ 已完成 ──────────────────────────────┐
│  退出码：0                                          │
│  stdout：                                          │
│  ┌──────────────────────────────────────────────┐ │
│  │ (完整输出，可能很长，支持滚动)                 │ │
│  │ ...                                           │ │
│  │ ...                                           │ │
│  │ ...（第 8320 行）                             │ │
│  └──────────────────────────────────────────────┘ │
└────────────────────────────────────────────────────┘
```

**适用场景**：诊断、调试、深度分析

**当前系统支持**：⚠️ 部分支持——投影层硬限 4000 字符（`resultTextPreviewMaxChars`），超出部分截断。已实现的 header `⚡` 后台任务监控通过 output REST 最多读取 65536 字节（`OUTPUT_LIMIT_BYTES`），但仍有限制；capability-card 内联追踪区只是 `[UCD目标]`。

**[遗留] 需改造**：
- 投影层需支持"不截断"模式或更高阈值
- 前端需支持长内容虚拟滚动/分页加载
- 可能需要新增"加载更多"交互

---

### 策略 2：仅摘要（Summary-Only）

只显示工具名 + 执行状态（成功/失败），不显示任何详细结果。

```
┌─ 🔧 Bash · ✅ 已完成 ──────────────────────────────┐
│  命令执行完成                                       │
│  (详情已隐藏)                                       │
└────────────────────────────────────────────────────┘
```

**适用场景**：日常对话、简洁视图、移动端

**当前系统支持**：⚠️ 部分支持——
- ProcessPanel 折叠态仅显示 summary row（面板级），但条目仍可展开
- 部分 kind 硬编码 `isExpandable=false`（`fileWrite`、`skillLoaded`），但其他 kind（`commandOutput`、`fileRead`、`fileList`）默认可展开
- 无全局"仅摘要模式"开关

**[遗留] 需改造**：
- 前端需支持"仅摘要"呈现模式——所有工具条目不可展开，仅显示 `工具名 · 状态 · safeSummary`
- 可作为 ProcessPanel 的模式切换（expanded / collapsed / summary-only 三态）
- 或作为场景级配置，自动应用

---

### 策略 3：长度自适应截断（Adaptive Truncation）

短输出完整显示，长输出截断并提示。截断阈值可按场景配置。

```
┌─ 🔧 Bash · ✅ 已完成 ──────────────────────────────┐
│  退出码：0                                          │
│  stdout：                                          │
│  ┌──────────────────────────────────────────────┐ │
│  │ (前 1000 字符完整显示)                        │ │
│  │ ...                                           │ │
│  └──────────────────────────────────────────────┘ │
│  ⚠️ 输出已截断（共 8320 字符，显示前 1000 字符）    │
│  [展开完整输出]                                     │
└────────────────────────────────────────────────────┘
```

**适用场景**：数据查询、日志查看、通用场景

**当前系统支持**：✅ 已实现，但阈值硬编码——
- `resultTextPreviewMaxChars = 4000`（`stream-envelope.ts` L41 + `safeCapabilityResult.ts` L1）
- `resultListPreviewMaxItems = 50`（L42）
- `cronProjectionInlineTextMaxChars = 256`（L43）
- `OUTPUT_LIMIT_BYTES = 65536`（header `⚡` 后台任务 monitor 的按需 output REST）
- 折叠态摘要 `trimPreviewText` 限制 160 字符（`processDetails.ts` L1810）

**[遗留] 需改造**：
- 截断阈值需可配置——产品团队按场景设定（如诊断=10000、日常=1000、移动端=500）
- 当前 4 层硬编码常量需统一为配置入口
- 可能需要"展开完整输出"交互（当前截断后无法获取被截断部分）

---

### 策略 4：安全脱敏（Redacted）

对输出内容进行扫描式脱敏，将敏感信息（IP/密码/token/路径等）替换为掩码。

```
┌─ 🔧 Bash · ✅ 已完成 ──────────────────────────────┐
│  退出码：0                                          │
│  stdout：                                          │
│  ┌──────────────────────────────────────────────┐ │
│  │ Connecting to ***.***.***.***:**** ...       │ │
│  │ Auth token: ******************************** │ │
│  │ File: /***/***/config.yaml                   │ │
│  │ Connection established.                      │ │
│  └──────────────────────────────────────────────┘ │
│  🔒 输出已脱敏（3 处敏感信息已掩码）                │
└────────────────────────────────────────────────────┘
```

**适用场景**：安全审核、合规检查、跨团队共享

**当前系统支持**：✅ 部分实现——
- **白名单字段过滤**：`copySafeFields`（`stream-envelope.ts` L363-369）只复制显式列出的字段，其余丢弃
- **Cron prompt 丢弃**：投影层完全丢弃 `prompt` 字段（`projectCronSafeResult` L458-510）
- **unknown 兜底**：不匹配任何 kind 时不暴露 raw JSON
- **`canSerialize` fail-closed**：不可序列化时整个事件 reject
- **`redaction-policy` spec**：observability 层的统一脱敏策略（`openspec/specs/redaction-policy/spec.md`）

**`redactionPolicy` 对比样例**——3 种脱敏策略的视觉差异：

`none`（不脱敏，诊断/调试场景）：
```
┌─ 🔧 Bash · ✅ 已完成 ──────────────────────────────┐
│  退出码：0                                          │
│  stdout：                                          │
│  ┌──────────────────────────────────────────────┐ │
│  │ Connecting to 10.5.1.2:22 ...                │ │  ← 原始 IP 可见
│  │ Auth token: sk-abc123def456                  │ │  ← 原始 token 可见
│  │ File: /etc/ssh/sshd_config                   │ │  ← 原始路径可见
│  └──────────────────────────────────────────────┘ │
└────────────────────────────────────────────────────┘
```

`whitelist`（白名单字段过滤，日常对话场景）：
```
┌─ 🔧 Bash · ✅ 已完成 ──────────────────────────────┐
│  退出码：0                                          │
│  stdout：                                          │
│  ┌──────────────────────────────────────────────┐ │
│  │ Connection established.                      │ │  ← 仅白名单字段
│  │ (敏感字段已过滤)                              │ │  ← IP/token/路径被丢弃
│  └──────────────────────────────────────────────┘ │
│  🔒 部分字段已过滤                                 │
└────────────────────────────────────────────────────┘
```

`content-scan`（内容扫描式脱敏，安全审核场景）：
```
┌─ 🔧 Bash · ✅ 已完成 ──────────────────────────────┐
│  退出码：0                                          │
│  stdout：                                          │
│  ┌──────────────────────────────────────────────┐ │
│  │ Connecting to ***.***.***.***:**** ...       │ │  ← IP 掩码
│  │ Auth token: ******************************** │ │  ← token 掩码
│  │ File: /***/***/config.yaml                   │ │  ← 路径掩码
│  │ Connection established.                      │ │  ← 安全内容保留
│  └──────────────────────────────────────────────┘ │
│  🔒 输出已脱敏（3 处敏感信息已掩码）                │
└────────────────────────────────────────────────────┘
```

**[UCD目标/Clarify] 决策输入**：
- capability safeResult 当前以**字段级白名单**保护；它与 runtime terminal guard、REMOTE whole-round guard 是不同安全层。
- 是否对 stdout/fileContent 等用户可见文本增加内容扫描、由谁在持久化前执行，必须先确认 authoritative owner 与 fail-closed 行为。
- 规则配置的 owner、scope、默认值、生效时机与审计要求尚未冻结；不能仅由前端或产品配置自行决定。
- “脱敏数量和位置”仅为视觉目标，只有后端提供安全、低敏的计数事实后才可显示。

## 当前系统的呈现控制机制

### 截断：4 层硬编码

| 截断层 | 常量 | 值 | 位置 | 可配置？ |
|---|---|---|---|---|
| 文本预览 | `resultTextPreviewMaxChars` | 4000 字符 | `stream-envelope.ts` L41 + `safeCapabilityResult.ts` L1 | ❌ 硬编码 |
| 列表截断 | `resultListPreviewMaxItems` | 50 项 | `stream-envelope.ts` L42 | ❌ 硬编码 |
| Cron 内联文本 | `cronProjectionInlineTextMaxChars` | 256 字符 | `stream-envelope.ts` L43 | ❌ 硬编码 |
| 后台任务输出 | `OUTPUT_LIMIT_BYTES` | 65536 字节 | header `⚡` monitor 的按需 output REST | ❌ 硬编码 |
| 折叠态摘要 | `trimPreviewText` | 160 字符 | `processDetails.ts` L1810 | ❌ 硬编码 |

### 5 种截断层样例

**文本预览截断**（4000 字符，`resultTextPreviewMaxChars`）：
```
┌─ 🔧 fileRead · ✅ 已完成 ──────────────────────────┐
│  ┌─ contentPreview ─────────────────────────────┐ │
│  │ (前 4000 字符完整显示)                        │ │
│  │ ...                                          │ │
│  └──────────────────────────────────────────────┘ │
│  ⚠️ 内容已截断（truncated=true）                    │
└────────────────────────────────────────────────────┘
```

**列表截断**（50 项，`resultListPreviewMaxItems`）：
```
┌─ 🔧 Glob · ✅ 已完成 ──────────────────────────────┐
│  找到 72 个文件（显示前 50 个）                     │
│  ┌──────────────────────────────────────────────┐ │
│  │ src/index.ts                                 │ │
│  │ src/app.tsx                                  │ │
│  │ ...（共 50 项）                               │ │
│  │ (22 项未显示)                                │ │  ← truncated=true
│  └──────────────────────────────────────────────┘ │
└────────────────────────────────────────────────────┘
```

**Cron 内联文本截断**（256 字符，`cronProjectionInlineTextMaxChars`）：
```
┌─ 🔧 Cron · ✅ 已完成 ──────────────────────────────┐
│  detailText: cron-abc123: Every day at 09:00…     │  ← 最多 256 字符
│  (超长 prompt 预览被截断)                           │
└────────────────────────────────────────────────────┘
```

**后台任务输出截断**（65536 字节，`OUTPUT_LIMIT_BYTES`）：
```
┌─ 🔧 bash · ✅ 已完成 ──────────────────────────────┐
│  stdout                              [↻ 刷新]      │
│  ┌──────────────────────────────────────────────┐ │
│  │ (前 65536 字节输出)                           │ │
│  │ …                                            │ │  ← 超出截断
│  └──────────────────────────────────────────────┘ │
└────────────────────────────────────────────────────┘
```

**折叠态摘要截断**（160 字符，`trimPreviewText`）：
```
┌─ 📋 过程面板（collapsed ▶）──────────────────────┐
│  ✅ 已完成 · 网络诊断结论是：当前网络整体仍可用…  │  ← 最多 160 字符
└──────────────────────────────────────────────────┘
```

### 详情级别：3 级控制

| 级别 | 机制 | 当前行为 | 场景级控制？ |
|---|---|---|---|
| 面板级 | ProcessPanel 容器展开/折叠 | settled 后 auto-collapse（150ms），用户可手动覆盖 | ❌ 无场景级策略 |
| 条目级 | per-entry 展开/折叠 | running 阶段自动展开，settled 阶段不自动展开 | ❌ 无场景级策略 |
| kind 级 | `isExpandable` | 按 kind 硬编码（fileWrite=false, skillLoaded=false, commandOutput=有输出时 true） | ❌ 按 kind 固定 |

### isExpandable by kind 样例

`isExpandable=true`（可展开详情，如 `commandOutput`）：
```
┌─ 🔧 Bash · ✅ 已完成 ──────────────────────────────┐
│  退出码：0                            ▸            │  ← 有展开箭头 ▸
│  （点击展开 stdout/stderr 预览）                    │
└────────────────────────────────────────────────────┘
```

`isExpandable=false`（不可展开，如 `fileWrite`、`skillLoaded`）：
```
┌─ 🔧 Write · ✅ 已完成 ─────────────────────────────┐
│  📄 文件已创建                                     │  ← 无展开箭头
│  （结果已完整呈现，无更多详情）                     │
└────────────────────────────────────────────────────┘

┌─ 🔧 Skill · ✅ 已完成 ─────────────────────────────┐
│  ✅ 已加载 network-diagnostics 技能                │  ← 无展开箭头
│  （结果已完整呈现，无更多详情）                     │
└────────────────────────────────────────────────────┘
```

### 安全脱敏：白名单机制

| 机制 | 作用 | 可配置？ |
|---|---|---|
| `copySafeFields` 白名单 | 按事件类型显式列出允许的字段 | ❌ 按事件类型固定 |
| Cron prompt 丢弃 | 投影层丢弃 prompt 字段 | ❌ Cron 专用 |
| unknown 兜底 | 不匹配 kind 时不暴露 raw JSON | ❌ 自动 |
| `canSerialize` fail-closed | 不可序列化时 reject 整个事件 | ❌ 自动 |
| `redaction-policy` spec | observability 层统一脱敏 | ⚠️ spec 定义规则，但执行在 observability 层非呈现层 |

> **think/answer 内容安全过滤**（见 `10-implementation-gap-analysis.md` B17/B18）：当前主干只有 terminal `finalContent` guard 与可选 REMOTE whole-round guard，没有统一的 live delta 字段级替换。B17/B18 仍是 clarify：先确认 whole-round guard、字段级 redaction、safe-result whitelist 的关系，以及 live/history/share 的 authoritative owner；不得预设由 streaming projection 层执行或已有 dev/prod 管理开关。

## UCD 设计建议：呈现策略框架

### 策略维度

工具输出呈现由 **3 个维度** 组合决定：

| 维度 | 取值 | 说明 |
|---|---|---|
| **detailLevel**（详情级别） | `full` / `summary` / `adaptive` | 完整呈现 / 仅摘要 / 长度自适应 |
| **truncationThreshold**（截断阈值） | 数值（字符数/项数/字节数） | 截断阈值，按场景配置 |
| **redactionPolicy**（脱敏策略） | `none` / `whitelist` / `content-scan` | 不脱敏 / 白名单字段过滤 / 内容扫描式脱敏 |

### 策略应用示例

| 业务场景 | detailLevel | truncationThreshold | redactionPolicy |
|---|---|---|---|
| 诊断/调试 | `full` | 10000 字符 | `none` |
| 日常对话 | `summary` | —（不显示详情） | `whitelist` |
| 数据查询 | `adaptive` | 1000 字符 | `whitelist` |
| 安全审核 | `adaptive` | 4000 字符 | `content-scan` |
| 移动端 | `summary` | — | `whitelist` |
| 跨团队共享 | `adaptive` | 2000 字符 | `content-scan` |

### 策略应用层级

策略可在 3 个层级配置，低层级继承高层级默认值：

```
全局默认策略（平台级）
  └─ 场景级策略（业务场景覆盖）
       └─ 工具级策略（单个工具覆盖）
            └─ kind 级策略（特定 kind 覆盖）
```

**示例**：
- 全局默认：`detailLevel=adaptive, truncationThreshold=4000, redactionPolicy=whitelist`
- 诊断场景覆盖：`detailLevel=full, truncationThreshold=10000, redactionPolicy=none`
- 诊断场景中 Cron 工具覆盖：`detailLevel=adaptive, redactionPolicy=content-scan`（Cron prompt 始终脱敏）

### 用户控制

产品团队可决定是否向终端用户暴露策略切换：

| 控制方式 | 说明 | 适用场景 |
|---|---|---|
| **场景自动应用** | 系统按业务场景自动选择策略，用户无感 | 默认行为 |
| **用户手动切换** | 用户在 UI 上切换 verbose/compact/summary-only 模式 | 高级用户 |
| **per-entry 展开** | 用户点击展开查看详情（当前已实现） | 通用 |

```
┌─ ProcessPanel ──────────────────────────── [简洁▾] ┐
│  🔧 Bash · ✅ 已完成                                 │
│  🔧 Read · ✅ 已完成                                 │
│  🔧 Grep · ✅ 已完成                                 │
└──────────────────────────────────────────────────────┘
         ↑ 模式切换下拉菜单
         ├─ 简洁（summary-only）
         ├─ 自适应（adaptive，默认）
         └─ 完整（full）
```

## 视觉规范

### 策略 1：完整呈现

- 条目默认展开，显示完整 stdout/stderr/文件内容
- 长内容支持滚动（maxHeight 可配置，如 600px）
- **[遗留]** 截断后"展开完整输出"入口（需后端支持获取被截断部分）

### 策略 2：仅摘要

- 条目不可展开（无展开箭头）
- 仅显示：`图标 工具名 · 状态 · safeSummary`
- 失败时显示：`图标 工具名 · ❌ 失败 · safeSummary`（safeSummary 包含安全错误描述）
- 可选：显示执行时长

### 策略 3：长度自适应截断

- 短输出（≤ 阈值）：完整显示，无截断提示
- 长输出（> 阈值）：截断显示，底部提示 `⚠️ 输出已截断（共 N 字符，显示前 M 字符）`
- **[遗留]** "展开完整输出"入口（需后端支持）
- 截断提示视觉：浅色背景的 info 行，非 error 态

### 策略 4：安全脱敏

- 脱敏内容用 `***` 或 `████` 替换
- 底部提示 `🔒 输出已脱敏（N 处敏感信息已掩码）`
- 脱敏提示视觉：浅色背景的 security 行，带锁图标
- 脱敏规则对用户不可见（不暴露哪些模式被匹配）

## live 模式 vs history 模式

| 维度 | live 模式 | history 模式 |
|---|---|---|
| 策略应用 | ✅ 按场景策略呈现 | ✅ 同 live（策略是呈现层控制，不影响持久化数据） |
| 完整呈现 | ✅ 实时流式追加 | ✅ 终态重建后按策略呈现 |
| 仅摘要 | ✅ 条目不可展开 | ✅ 条目不可展开 |
| 自适应截断 | ✅ 流式追加中按阈值截断 | ✅ 终态按阈值截断 |
| 安全脱敏 `[UCD目标/Clarify]` | 目标：只呈现 authoritative owner 产出的安全内容 | 目标：与 live/share 消费同一安全事实；实现层尚未确定 |

> 截断、折叠和模式切换属于前端呈现控制。安全字段选择与内容 redaction 不是普通视觉策略：safeResult 白名单由后端投影执行；新增内容扫描必须在 B17/B18 中先确定 authoritative owner、持久化顺序和 live/history/share 一致性，不能由前端单独实现。

## 约束

- **平台定位**：NextAgent 是 Agent 平台，呈现策略由产品团队按业务场景配置，非硬编码。
- **截断阈值不可配置（当前）**：4 层截断常量均为硬编码，**[遗留]** 需统一为配置入口。
- **无场景级策略控制（当前）**：当前无"场景→策略"映射机制，**[遗留]** 需设计策略配置接口。
- **无统一字段级内容扫描（当前）**：safeResult 有白名单，runtime terminal 与 REMOTE configured guardrail 另有独立护栏；是否新增统一扫描以及扫描位置仍为 **[UCD目标/Clarify]**。
- **投影层 4000 字符硬限**：完整呈现模式受限于投影层截断，**[遗留]** 需投影层支持"不截断"或更高阈值。
- **脱敏规则对用户不可见**：不暴露哪些模式被匹配，避免安全信息泄露。
- **失败卡片始终脱敏**：SafeError 呈现 MUST NOT 显示 raw error text（当前已实现）。
- **策略不影响持久化**：呈现策略控制前端渲染方式，不修改后端持久化的数据。

## [遗留] 改造清单

### 后端改造

| # | 改造项 | 说明 | 优先级 |
|---|---|---|---|
| 1 | 截断阈值可配置 | `resultTextPreviewMaxChars`/`resultListPreviewMaxItems`/`cronProjectionInlineTextMaxChars`/`OUTPUT_LIMIT_BYTES` 从硬编码改为配置注入 | 高 |
| 2 | 内容扫描式脱敏决策 | 先确认 authoritative owner、覆盖 surface、fail-closed 与持久化顺序，再决定是否新增扫描 | 中 |
| 3 | 完整呈现支持 | 投影层支持"不截断"模式或"按需加载完整内容"API | 低 |
| 4 | 策略配置接口 | 定义"场景→策略"映射的配置接口，供产品团队声明 | 中 |

### 前端改造

| # | 改造项 | 说明 | 优先级 |
|---|---|---|---|
| 5 | 呈现模式切换 | ProcessPanel 支持 `full`/`summary`/`adaptive` 三态模式切换 | 高 |
| 6 | "仅摘要"渲染 | 所有条目不可展开，仅显示工具名+状态+safeSummary | 高 |
| 7 | 截断阈值消费 | 前端从配置读取截断阈值（当前硬编码 4000/50/256/65536/160） | 中 |
| 8 | "展开完整输出"入口 | 截断后提供"加载更多"交互（需后端 API 支持） | 低 |
| 9 | 脱敏提示渲染 | 底部显示 `🔒 输出已脱敏（N 处已掩码）` | 中 |
| 10 | 长内容虚拟滚动 | 完整呈现模式下支持长内容滚动/分页 | 低 |

### UCD 设计建议

- **模式切换入口**：UCD 设计人员可设计 ProcessPanel 右上角的模式切换下拉菜单（简洁/自适应/完整）。
- **截断提示视觉**：UCD 设计人员可设计截断提示的视觉层次（info 级，非 error 级）。
- **脱敏标记视觉**：UCD 设计人员可设计脱敏标记的视觉（锁图标 + 浅色背景）。
- **"展开完整输出"交互**：UCD 设计人员可设计截断后的"展开"入口位置和交互。
- **策略配置 UI**：UCD 设计人员可设计管理端的策略配置界面（场景→策略映射表）。

## 与现有文档的关系

| 现有文档 | 本规范的关系 |
|---|---|
| `capability-card.md` | kind 呈现由本规范的 `detailLevel`/`truncationThreshold` 控制；`isExpandable` 可被策略覆盖 |
| `process-panel.md` | ProcessPanel 的展开/折叠是本规范 `detailLevel` 的实现基础 |
| `tool-ui-interface-overview.md` | safeResult 投影接口是本规范截断/脱敏的执行层 |
| `capability-card.md`（后台任务追踪区） | 后台任务输出（65536 字节）受本规范 `truncationThreshold` 约束 |
| `cron-task.md` | Cron prompt 脱敏是本规范 `redactionPolicy=whitelist` 的具体实例 |
| `degradation-notice.md` | 安全脱敏降级（类型 A）与本规范 `redactionPolicy` 相关 |
