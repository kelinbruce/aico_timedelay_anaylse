## 背景和现状（Context）

`agent-model` 通过 `@openrouter/ai-sdk-provider` 和 AI SDK `streamText()` 接入 OpenAI-compatible endpoint。依赖当前在某个 `tool_calls[index]` 第一次出现时即创建内部工具调用，要求该片段已有 `type=function` 和非 null `function.name`，之后只追加 `function.arguments`。空字符串名称会被接受并固化，延后或拆分的名称不会继续合并。

现有稳定规格已经要求 provider-native ToolCall 分片在 `agent-model` 内保持稳定关联并聚合 arguments，但当前实现依赖 SDK 的首片名称假设，无法覆盖更细碎的第三方兼容流。这是 implementation-vs-spec gap。

## 目标和非目标（Goals / Non-Goals）

**目标：**

- 在 OpenAI-compatible HTTP response 进入 OpenRouter SDK 解析前，按 ToolCall index 缓冲原始 SSE `tool_calls` 分片。
- 工具名称和 arguments 均完整后，向 SDK 输出一个协议兼容的完整 ToolCall chunk。
- 保持非 ToolCall SSE 内容、finish metadata、并行调用顺序、取消和 safe error 语义。
- 原始分片只存在于单次请求内存，不进入其他 package、日志或持久化。

**非目标：**

- 不改变 `ModelToolCall`、Web stream、runtime event 或 capability contract。
- 不修复非 OpenAI-compatible 的自定义文本/XML ToolCall。
- 不增加 provider 配置开关、重试策略或 Core 纠错语义。
- 不修改第三方依赖或 `node_modules`。

## 设计决策（Decisions）

唯一实现路径是在 `packages/agent-model/src/providers/openrouter/` 增加一个 OpenAI-compatible SSE response normalizer，并由 `withNextAgentHeaders` 包装后的 trusted fetch 在响应进入 `@openrouter/ai-sdk-provider` 前调用。

normalizer 仅处理成功且 `Content-Type` 为 `text/event-stream` 的 response。它增量解码 SSE frame，解析 `data:` JSON，并执行以下状态机：

1. 以 `tool_calls[index]` 为关联键；index 缺失时沿用同一 OpenAI-compatible choice 中最近的 active index。首次出现顺序记录为最终输出顺序。
2. 每个调用分别保存首个非空 id、`type`、有序 name fragments 和有序 argument fragments。空字符串不标记名称完成。
3. 含 `tool_calls` 的 frame 中，ToolCall delta 从转发 payload 移除；同 frame 的 content、reasoning、usage 等其他字段继续按原顺序转发。
4. 在收到该 choice 的非 null `finish_reason` 或 `[DONE]` 前，按首次出现顺序 flush 缓冲调用。每个调用必须具有非空 id、拼接后名称精确匹配本次请求下发的工具名、且拼接 arguments 能解析为 JSON object。
5. flush 时为每个调用生成一个完整 OpenAI-compatible delta：`index + id + type=function + function.name + function.arguments`，随后再转发 finish frame 或 `[DONE]`。SDK 因而只看到名称与 arguments 均完整的首个 ToolCall chunk。
6. 任何不完整、未知名称、非 object arguments、重复完成后的额外 ToolCall 分片或无法解析的 ToolCall SSE payload 都使 response stream error；现有 provider error normalization 将其映射到 safe model failure，且不会产生公共 ToolCall。

选择 HTTP SSE 预归一化而不是在 `streamText().fullStream` 后缓冲，是因为 SDK 会在首片缺少名称时立即报错，调用方无法看到后续修复片段。选择单次 response normalizer 而不是 fork/patch 依赖，可保持第三方 SDK 隔离并避免发布包依赖本地 patch。选择在 finish 时 flush，而不是猜测某个 name fragment 是否完整，可消除工具名互为前缀以及 arguments 暂时可解析造成的提前完成歧义。

非流式 `generateText()` 路径不经过该 normalizer，继续使用 SDK 对完整 ToolCall 的既有校验。

## 质量属性设计（Quality Attributes）

| 质量属性 | 设计结论 | 验证入口 |
|---|---|---|
| 安全 | 只使用请求内可信 tool descriptor 名称验证聚合结果；原始 chunk 不记录、不持久化、不投影；未知名称安全失败 | provider 单元测试、代码审查 |
| 性能/容量 | 每个响应只保留尚未 flush 的 ToolCall 名称与 arguments；受现有模型响应和 tool input 大小边界约束，无跨请求增长 | 多 chunk 测试、agent-model build |
| 可靠性/恢复 | finish 前原子完成归一化；不完整调用不向 Core 暴露，取消继续由原 AbortSignal 和 fetch stream 传播 | abort/invalid stream 既有测试、负例测试 |
| 可维护性 | normalizer 是 `agent-model` 内单一纯 transport adapter；OpenRouter provider 只组合它，不复制 ToolCall 执行业务语义 | 模块测试、语义代码审查 |
| 可测试性 | 使用内存 SSE Response 可确定性构造空首名、名称拆片、arguments 拆片和并行交错 | `openrouter-provider.test.ts` |
| 审计/可追溯性 | 不新增原始输出日志；现有 MODEL_INVOCATION completed/failed 安全事实继续生效 | 既有 observability contract、代码审查 |

## 验证映射（Verification Map）

| 约束 | Task | 验证入口 |
|---|---|---|
| 延后/拆分名称与 arguments 完整聚合后只发出一个 ToolCall | 2.1、2.2 | 定向 provider tests |
| 并行调用独立聚合且保持首次出现顺序 | 2.1、2.3 | 并行交错 SSE 测试 |
| 不完整、未知名称或非 object arguments 安全失败且不发出 ToolCall | 2.1、2.4 | 负例 provider tests |
| 原始 chunk 不越过 `agent-model` 边界 | 2.2、3.3 | 代码审查、架构约束检查 |
| 不改变非流式路径 | 2.2、3.1 | 现有 complete tests |

## 文档承载决策（Documentation Ownership）

- 行为契约：`openspec/specs/model-stream-normalization/spec.md`
- 架构和跨模块设计：`openspec/designs/architecture/model-provider-boundary.md`
- 模块设计：`openspec/designs/modules/agent-model.md`
- ADR：无
- 导航：`openspec/designs/spec-to-design-map.md` 保持现有映射

## 风险与取舍（Risks / Trade-offs）

- [ToolCall 直到 finish 才交给 SDK，增加工具调用可见延迟] -> ToolCall 本就只能在完整 JSON arguments 后执行；不增加模型生成时间或请求轮次。
- [SSE frame 预归一化可能破坏非标准 payload] -> 只变换 schema-valid `choices[].delta.tool_calls`，其他字段原样保留；异常 ToolCall payload安全失败。
- [缓冲增加单请求内存] -> 仅保留当前 response 的 ToolCall 字符串，并继续受现有输出大小限制；不新增持久状态。
- [index 缺失导致关联歧义] -> 只允许沿用当前 choice 最近 active index；无法确定时安全失败，不猜测跨调用关联。

## 迁移计划（Migration Plan）

无需数据或配置迁移。发布时随 `agent-model` 构建产物生效。若出现兼容性回归，可回滚本 change；公共 contract 和持久化数据不受影响。

## 归档前更新基线（Baseline Promotion Plan）

- `openspec/specs/model-stream-normalization/spec.md`：合并名称与 arguments 分片完整聚合、并行隔离及安全失败需求。
- `openspec/overview.md`：无。
- `openspec/designs/architecture/model-provider-boundary.md`：记录 OpenAI-compatible SSE 在 SDK 前预归一化及 raw chunk 不外泄边界。
- `openspec/designs/modules/agent-model.md`：记录 response normalizer 的模块职责、输入输出和验证入口。
- `openspec/designs/adr/<id>.md`：无。
- `openspec/designs/spec-to-design-map.md`：检查既有 `model-stream-normalization` 映射，无需新增条目。

## 待确认问题（Open Questions）

无。

## 长期基线刷新计划

本节将旧模板的“归档前更新基线”归一为可审计的归档门禁；以下均为**归档前待执行**，不表示 stable baseline 已刷新。

- **Function：**以 `FN-1.1-查看会话消息流` 为唯一用户可见行为 owner；若本 change 增加的行为不能被该 Function 的既有边界完整表达，先在同一能力域新增一个单一职责 Function，再更新 `openspec/designs/functions/index.md`，不得把实现细节直接写入 Function。
- **Stable spec：**将 delta Requirement 合并至 `openspec/specs/model-stream-normalization/spec.md`，逐条核对 Requirement 标题、MUST/SHALL 语义、场景、迁移和 metadata；不得以 `--skip-specs` 绕过同名 Requirement 重叠。
- **长期设计：**先执行本 design/proposal 已列出的“归档前更新基线”设计 owner；再在 `openspec/designs/spec-to-design-map.md` 为上述 stable spec 写入该 Function、实际承载的 architecture/module/ADR 与验证入口。若现有 map 无该 spec 行，先创建该行，而非把 change-local design 当作长期设计。
- **归档判定：**Function、stable spec、长期设计和 map 四端均完成 diff 审阅且 `openspec validate --all --strict` 通过后，才允许归档；任一端无法唯一归属时保留 active 并标记阻塞。
