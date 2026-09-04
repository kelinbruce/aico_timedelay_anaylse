# FN-4.1 调用模型

> 能力域 D4 模型与上下文 · 子域 [D4.1 模型调用与降级](.) · 返回 [功能树](../../index.md)

| 项 | 值 |
|---|---|
| 当前状态 | 稳定 |
| 覆盖特性 | [F-4.1](../../../features/D4-模型与上下文/D4.1-模型调用与降级/F-4.1-接入多种模型.md) |
| 主规格 | `model-invocation-contract` |
| 遗留规格 | `model-provider-adapter`、`model-stream-normalization` |
| 接口 | 系统内部，模型调用服务 |

## 描述

系统通过统一接口调用模型，支持流式和非流式两种方式，厂商细节隔离在专门的接入模块。

## 前置条件

- 模型配置已加载。
- 请求已进入模型调用阶段。

## 输入

| 参数 | 必填 | 说明 |
|---|---|---|
| modelId | 是 | Agent 已激活且目录当前可用的 canonical 模型标识 |
| 消息列表 | 是 | 上下文装配后的消息 |
| 调用选项 | 否 | 超时、最大输出、canonical `toolChoice` 等 provider-neutral 选项 |
| modelParams | 否 | opaque `JsonObject`，承载 recipe 级模型参数（如 temperature、top_p、seed）；不被 workflow 或 contract 层解释，provider 把字段展开到 HTTP 请求体顶层；合并时 override 替换 base |

## 输出

模型结果：流式方式通过 callback 返回规范化增量并以同一个 Promise 返回最终结果；非流式方式直接返回最终结果。最终结果分别提供 provider-neutral 停止原因与可选输出不完整原因；安全失败不携带输出不完整事实。

## 处理过程

1. 系统校验所选模型及可信调用范围，并取得该模型的有效配置。
2. 系统按 profile、Prompt、Capability patch、trusted request 和 Hook 的固定优先级合并受治理模型选项；`toolChoice` 只允许 `AUTO | NONE | REQUIRED`，厂商扩展不得建立平行控制。
3. 系统在总时限内执行同模型重试；流式调用发布首个增量后不再重启调用。
4. 系统返回统一的流式增量、完整工具调用、终态与用量信息；终态保留原 provider-neutral 停止原因，并仅在明确 Token 超限或预算饱和且 Tool call 结构残缺时标记可恢复的输出不完整原因。没有完整 Tool call 的 `finishReason="tool-calls"` 只有携带精确 `truncated-tool-call` 证据才进入恢复，缺失或使用 `output-limit` 等不匹配证据时安全失败。厂商原始错误只以安全错误呈现；usage 缺失、非法或预算未饱和时不猜测截断。
5. Agent core 只依据输出不完整原因进入唯一恢复流程。`output-limit` 与 `truncated-tool-call` 均先以原有效值 × 8（上限 `32000 tokens`，且不超过剩余上下文窗口）覆盖 `maxOutputTokens` 重试一次同请求；预算提升后仍为空 content、无 Tool call 且 reasoning 非空的 `output-limit` 先执行至多一次 request-local reasoning-only 收敛重试，再进入最多 3 次 request-local 续写。续写把上一段 assistant 文本和隐藏续写指令追加到本次恢复调用 messages，续写段按序拼接为单一最终回答，中间 correction、assistant 段和恢复指令均不持久化。`truncated-tool-call` 提升后仍有任一不完整原因时立即安全失败，不进入文本续写；原调用和恢复阶段的残缺 Tool call 均不得执行。恢复调用复用同一模型路由、消息、Tool 集合、provider-neutral options、当前 `AbortSignal`、timeout 和 Agent/Owner Scope。
6. direct model 累计可见文本首次超过 `150000` 个 UTF-16 code unit 硬上限时立即停止模型输出，保留顺序前缀（不拆分 surrogate pair，必要时闭合 Markdown 结构），追加固定截断标记，作为唯一 terminal assistant message 以 `REQUEST_COMPLETED` 提交；恰好等于上限时原样提交。

## 结果

- 正常：返回模型结果。
- 模型超时：安全失败。
- 模型错误：安全映射后输出，不暴露原始错误。
- 输出不完整：恢复成功只交付重新生成的完整回答或完整 Tool call；明确 Token 超限先提升预算，提升后 reasoning-only 空产出先做至多一次收敛重试，再最多续写 3 次；推断 Tool call 截断只允许一次预算提升；恢复耗尽、重生成后仍不完整、策略拦截或 provider error 均安全失败，残缺 Tool call 零执行。
- 硬字符上限触发：提交带固定截断标记、总长不超过 `150000` 个 UTF-16 code unit 的有界前缀，以 `REQUEST_COMPLETED` 结束。

## 规格

| 规格项 | 规格值 | 权威来源 |
|---|---|---|
| 调用模式 | 支持非流式完成和流式增量；两种模式交付相同的唯一终态语义 | `model-invocation-contract`：`Non-streaming and streaming invocation share one terminal result contract` |
| 支持的 provider 配置 | `openai-compatible`、`model-gateway` | `model-invocation-contract`：`全局模型目录提供安全模型配置` |
| 缺省调用参数 | `temperature=0.55`、`maxOutputTokens=32,000`、`topP=1`、总超时 `300,000 ms`（内置 `default-system.yaml` 默认模型 profile 显式使用 `300000 ms`）、同模型最多重试 2 次 | `model-invocation-contract`：`Target-state request fields are stable invocation inputs`、`Profile timeout constrains provider execution`、`可恢复错误按受控次数重试` |
| Provider 扩展 | `providerOptions` 保留非冲突的 selected-provider 扩展字段，但不得覆盖通用顶层参数或 provider access | `model-invocation-contract`：`Provider options remain an open selected-provider extension` |
| modelParams 透传 | optional `JsonObject` 承载 opaque recipe 级模型参数；不被 workflow 或 contract 层解释，provider 把字段展开到 HTTP 请求体顶层；合并时 override 替换 base；`toolChoice`/`tool_choice` 等规范化同名 key 作为 authority collision 被拒绝 | `model-invocation-contract`：`Target-state request fields are stable invocation inputs` |
| 输出 Token 恢复 | reasoning-only `output-limit` 首先在原预算下收敛至多 1 次，重复耗尽直接进入 fallback 或安全失败；普通纯文本 `output-limit` 保持一次预算提升和最多 3 次续写，`truncated-tool-call` 保持一次预算提升 | `model-invocation-contract`：`输出超限不得静默截断` |
| Provider runtime 构建能力 | 默认能力包含 `openai-compatible | model-gateway`；`model-gateway-only` 能力只包含 `model-gateway`（遇 openai-compatible profile 时 startup fail closed，诊断码 `MODEL_PROVIDER_BUILD_PROFILE_INCOMPATIBLE`） | `model-invocation-contract`：`Model provider runtime capability is explicit and build-scoped` |
| Reasoning 文本分帧 | 每个 OpenAI-compatible 模型支持缺省 `EXPLICIT_THINK_TAG` 与显式配置 `IMPLICIT_OPEN_THINK_TAG`；其他 provider 不接受该配置 | `model-invocation-contract`：`Reasoning 文本分帧策略可按模型配置` |
| thinking.depth OFF 处理 | `thinking.depth === "OFF"` 时 openai-compatible provider 注入 `enable_thinking: false` 和 `chat_template_kwargs: { enable_thinking: false }`，不发送 `reasoning_effort`；`thinking.depth` 为 `undefined` 时不注入任何 reasoning 或 `enable_thinking` 配置 | `model-invocation-contract`：`Target-state request fields are stable invocation inputs` |
| Tool 选择 | canonical `AUTO | NONE | REQUIRED`；省略时 resolved default 为 `AUTO`，`NONE` 保留 Tool descriptors 但禁止本轮选择 Tool | `model-invocation-contract`：`Target-state request fields are stable invocation inputs`、`全局模型目录提供安全模型配置` |
| 输出不完整恢复 | 仅精确 `truncated-tool-call` 证据允许空 Tool-call 终态恢复；`output-limit` 触发一次同请求预算提升（×8，上限 `32000 tokens` 且受剩余上下文窗口约束），提升后 reasoning-only 空产出先做至多一次 request-local 收敛重试，再执行最多 3 次纯文本续写；`truncated-tool-call` 提升后仍不完整则安全失败；恢复消息不持久化，两类路径均不得执行残缺 Tool call | `model-invocation-contract`：`Failure exits are explicit and safe`、`输出超限不得静默截断` |
| 硬字符上限 | direct model 可见文本硬上限 `150000` 个 UTF-16 code unit；超限时停止输出、保留有界前缀（不拆分 surrogate pair、闭合 Markdown 结构）、追加固定截断标记，以 `REQUEST_COMPLETED` 提交唯一 assistant message；恰好等于上限不降级；超限后缀和未完整 Tool call 不进入 stream/history | `model-invocation-contract`：`输出超限不得静默截断` |
