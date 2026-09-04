# 组件规范：降级提示卡片（Degradation Notice）

> 长期设计导航：`openspec/designs/architecture/conversation-ui-state.md` 第 1、5、6 节。当前事实以 stable/active OpenSpec、public contracts、当前代码和测试为准；本文档是 UCD 设计表达层，非 OpenSpec 基线，不定义契约。

## 职责

渲染系统降级提示。降级不是 `RunStatus`（系统不引入 `DEGRADED` RunStatus），通过 `DEGRADATION_NOTICE` stream event 表达。来源：`ts-run-status-visibility` 的 `Run status visibility 的事实源` scenario "降级不是 RunStatus"。

> ℹ️ **降级提示是可选元素，非每次对话必然出现。** 仅当子系统发生降级或安全脱敏时才触发。最简正常路径（USER 消息 → 思考 + 能力调用 → ASSISTANT 回复）不包含降级提示。mock server 的正常路径为测试覆盖每次都发送降级提示，但这不代表真实后端行为。

## 触发场景

降级提示的触发原因分为两类：**安全脱敏**（子系统按设计执行 redaction）和**子系统降级**（子系统非预期能力受损）。两类都通过 `DEGRADATION_NOTICE` 事件表达，通过 `code` 和 `reason` 区分具体原因。从用户体验角度，两类效果相似——用户得到的信息经过了处理，需要被告知。

### 类型 A：安全脱敏（按设计执行）

子系统正常运行，但出于安全/隐私/策略原因对输出内容做了 redaction。run 不受影响，用户仍能得到完整回复，但部分原始细节被隐藏。

| 触发场景 | 典型 code / reason | 举例 |
|---|---|---|
| 可观测性脱敏 | `OBSERVABILITY_SAMPLE_REDACTED` / `SAFE_DIAGNOSTIC_REDACTION` | 隐藏原始 provider 诊断细节，仅保留安全摘要（见 `08-sample-scenarios.md` 场景 1） |
| checkpoint/audit/metric 脱敏 | — | 审计日志中对敏感字段做 redaction |

> 此类降级的子系统本身**没有故障**，redaction 是安全策略的预期行为。
>
> ℹ️ **think/answer 内容安全过滤**（见 `10-implementation-gap-analysis.md` B17/B18）：`[已实现-主干]` REMOTE guardrail 的整轮拦截使用 terminal `OUTPUT_GUARD_BLOCKED`，不属于本组件的字段级 `DEGRADATION_NOTICE`；terminal `finalContent` 另有正则替换。字段级 live stream 脱敏、占位文案及是否展示聚合提示仍是 `[UCD目标/Clarify]`，需先统一 owner、fail-closed 与 live/history/share 语义。

### 类型 B：子系统降级（非预期能力受损）

子系统确实出现了问题，以降级模式继续运行而非直接失败。run 仍可完成，但结果质量或完整性可能受影响。

| 触发场景 | 典型 code / reason | 举例 |
|---|---|---|
| 模型降级 | `MODEL_OUTPUT_LIMIT_EXCEEDED` / `SAFE_FAILURE` | 模型输出超过安全限制，已停止本次请求（见 `08-sample-scenarios.md` 场景 2） |
| 能力降级 | — | sandbox 不可用、CLIP Server 不可达，能力以降级模式运行 |
| context 降级 | — | 上下文压缩失败、上下文长度超限触发降级处理 |
| transport 降级 | `REPLAY_GAP_REFRESH_REQUIRED` | 传输层背压超时、断线期间遗漏事件过多需刷新会话（见 mock server `stream.js`） |
| projection failure（投影失败） | `STREAM_PROJECTION_PAYLOAD_UNSAFE` / `DEPRECATED_STREAM_EVENT_NAME` | 后端在将事件转换为前端可显示的安全内容时失败，原始事件无法安全呈现给用户 |

> 此类降级的子系统**确实出了问题**，但系统选择容错继续而非终止 run。
>
> ℹ️ **"投影"含义**：后端将原始事件中的数据过滤、脱敏、裁剪后，只保留可安全展示给前端的字段，这个过程称为"投影"（projection）。投影失败意味着某个事件的内容无法通过安全过滤，因此以降级提示替代。

## safe field

`DEGRADATION_NOTICE` payload 暴露：`code`、`message`、`category`、`retryable`、`reasonCode`、`safeSummary`、`status`、`text`/`content`（= `message` 或 `safeSummary` 或 "Degradation notice"）。

来源：`stream-envelope.ts` 的 `projectStreamPayload` 对 `DEGRADATION_NOTICE` 的处理。

> ⚠️ 前端 `processDetails.ts` 的 `describeDegradationDetail`/`describeDegradationResult` 实际只消费 `code`（via `readFailureErrorCodeFromPayload`）和 `detail`（= `readProcessText()` 从 `text`/`content` 字段派生的可读文本），其余字段（`category`/`retryable`/`reasonCode`/`safeSummary`/`status`）虽由后端投影但前端未直接读取。

## 呈现

### 主呈现

- 卡片显示 `message` 或 `safeSummary` 作为用户可读提示。
- 根据 `category`/`code` 选择图标与颜色。

### 5 种 category 视觉样例

**TIMEOUT（超时）**：
```
┌─ ⚠️ 降级提示 ────────────────────────────────────┐
│  ⏱ 请求超时，已以降级模式继续执行                  │
│  （可展开：code=MODEL_OUTPUT_LIMIT_EXCEEDED       │
│   category=TIMEOUT retryable=true）               │
└──────────────────────────────────────────────────┘
```

**UNAVAILABLE（不可用）**：
```
┌─ ⚠️ 降级提示 ────────────────────────────────────┐
│  🚫 部分子系统不可用，结果可能不完整                │
│  （可展开：code=SAFE_FAILURE                      │
│   category=UNAVAILABLE retryable=true）            │
└──────────────────────────────────────────────────┘
```

**VALIDATION（校验失败 / projection failure）**：
```
┌─ ⚠️ 降级提示 ────────────────────────────────────┐
│  ⚠ 投影校验失败，部分事件未展示                     │
│  Timeline event cannot be projected to the        │
│  public stream.                                   │
│  （可展开：code=STREAM_PROJECTION_PAYLOAD_UNSAFE  │
│   category=VALIDATION retryable=false）            │
└──────────────────────────────────────────────────┘
```

**AUTHORIZATION / POLICY_DENIED（策略拒绝）**：
```
┌─ ⚠️ 降级提示 ────────────────────────────────────┐
│  🔒 安全策略已脱敏部分诊断细节                      │
│  （可展开：code=OBSERVABILITY_SAMPLE_REDACTED     │
│   category=AUTHORIZATION retryable=false）         │
└──────────────────────────────────────────────────┘
```

**其他 / 通用降级**：
```
┌─ ⚠️ 降级提示 ────────────────────────────────────┐
│  ℹ️ 系统以降级模式完成了请求                        │
│  （可展开：code / category / retryable）           │
└──────────────────────────────────────────────────┘
```

### 触发类型对比样例

**类型 A：安全脱敏（按设计执行）**——子系统正常运行，安全策略对输出做了 redaction：
```
┌─ Turn ───────────────────────────────────────────┐
│  > 🤖 助手 · ✅ 已完成                             │
│  > # 网络诊断报告                                  │
│  > 诊断结论：网络整体可用…                         │
│  > （原始 provider 诊断细节已脱敏）                │
│                                                    │
│  ┌─ ⚠️ 降级提示 ──────────────────────────────┐  │
│  │  🔒 安全策略已脱敏部分诊断细节                │  │
│  │  code=OBSERVABILITY_SAMPLE_REDACTED          │  │
│  │  category=AUTHORIZATION · 不可重试            │  │
│  └──────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────┘
  ← run 正常完成，降级提示是附加说明
```

**类型 B：子系统降级（非预期受损）**——子系统出问题但容错继续：
```
┌─ Turn ───────────────────────────────────────────┐
│  > 🤖 助手 · ✅ 已完成                             │
│  > # 网络诊断报告                                  │
│  > 诊断结论：网络整体可用（部分数据缺失）…         │
│                                                    │
│  ┌─ ⚠️ 降级提示 ──────────────────────────────┐  │
│  │  ⏱ 模型输出超时，已停止本次请求              │  │
│  │  code=MODEL_OUTPUT_LIMIT_EXCEEDED            │  │
│  │  category=TIMEOUT · 可重试                    │  │
│  └──────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────┘
  ← run 仍完成，但结果质量受影响
```

### second-level details

- 可展开查看 `code`、`category`、`reasonCode`、`retryable`、`status`。
- MUST NOT 暴露 raw prompt、raw model output、tool args/result、attachment content、secret、credential、本地路径、未授权对象内容、policy internals。

## 与失败卡片的关系

- 能力失败时，`CAPABILITY_RESULT_DELTA`/`CAPABILITY_COMPLETED` 携带 `safeErrorCode` 驱动的能力失败卡片是主要解释。
- `DEGRADATION_NOTICE` 可作为次要系统提示与能力失败卡片并存。
- `DEGRADATION_NOTICE` MUST NOT 是失败能力的唯一解释。来源：`ts-run-status-visibility` scenario "Failed capability completion carries safe failure facts"。

## projection failure（投影失败）的特殊呈现

当后端安全过滤过程本身失败（如 `STREAM_PROJECTION_PAYLOAD_UNSAFE`、`DEPRECATED_STREAM_EVENT_NAME`），后端转换为 `DEGRADATION_NOTICE` 携带：
- `code`：投影失败的错误码（如 `STREAM_PROJECTION_PAYLOAD_UNSAFE`）。
- `message`："Timeline event cannot be projected to the public stream."。
- `category`：`VALIDATION`。
- `retryable`：`false`。
- `eventType`：无法投影的原始 event type（在 payload 中）。

来源：`stream-envelope.ts` 的 `projectProjectionFailure`、`projectionFailure`。

## live 模式 vs history 模式

| 维度 | live 模式 | history 模式 |
|---|---|---|
| 卡片可见 | 实时到达 | ✅ 可见（由持久化消息重建） |
| 呈现效果 | 实时出现 | 直接呈现终态内容，无动画 |

来源：`conversation-ui-state.md` 第 6 节——`DEGRADATION_NOTICE` 在 history 由持久化消息重建，内容与 live 完成后完全相同。

**设计含义**：历史回看时，运维主管（见 `00-user-personas.md` 画像 B）可以看到当时的降级上下文，内容与 live 完成后完全相同。

## 视觉规范（UCD 设计人员决定）

- 卡片边框、背景色（区别于能力失败卡片，更弱的视觉权重）。
- 图标与颜色（按 `category`/`code`）。
- 展开详情的交互。
- 约束：不得通过视觉暗示非契约字段；不得展示 raw payload 或 policy internals。

## 动态行为与交互响应

> 跨组件的通用模式见 `02-dynamic-behavior-and-interaction.md`。本节补充降级提示特有行为。

### 已实现

> ⚠️ 当前前端 `processDetails.ts` 的 `describeDegradationDetail`/`describeDegradationResult` **仅消费 `code` 字段**，不读取 `category`。以下为文本内容层面的已实现项，视觉色调映射见 UCD 设计建议。

| 行为 | 说明 |
|------|------|
| 降级提示文本 | 从 `safeErrorCode` 派生用户可读的 code 文本 |

### UCD 设计建议

| 行为 | 说明 |
|------|------|
| 5 种 category 色调 | TIMEOUT/UNAVAILABLE/VALIDATION/AUTHORIZATION/通用各有图标与颜色。当前前端不读取 `category` 字段，**色调映射未实现** |
| projection failure 视觉 | `STREAM_PROJECTION_PAYLOAD_UNSAFE` 等 category=VALIDATION，retryable=false 的特殊视觉呈现。当前无特殊处理分支，**未实现** |
| 卡片 appear | `DEGRADATION_NOTICE` 到达时 fade-in 200ms ease-out |
| 展开/折叠 | 点击查看 code/category/reasonCode/retryable/status 时 grid-template-rows 过渡 200ms |
| hover | 卡片 hover 时背景色微变，120ms transition |
| focus | `focus-visible` outline 2px primary + offset 2px |
