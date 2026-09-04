## 设计范围

| Function | 本次目标变化 | 涉及 delta specs | 设计章节 |
|---|---|---|---|
| `FN-4.1 调用模型` | 可信模型 profile 可选择隐式 reasoning 起点，并获得一致的流式与非流式 reasoning/content 归一化 | `model-invocation-contract` | `FN-4.1 调用模型` |

## `FN-4.1 调用模型`

### 目标与规范依据

本设计使平台集成方能够为确实省略 `<think>` 开启标签的 OpenAI-compatible 模型显式声明输出分帧模式，同时保持其他模型的默认归一化路径不变。该配置描述模型输出契约，不形成调用级 reasoning 控制，也不允许不可信调用方修改。

#### 本 Function 的目标 Requirements

canonical spec：`model-invocation-contract`

- `ADDED`：`模型 profile 可声明隐式 reasoning 起点`
- `MODIFIED`：`Agent App system config 使用 canonical model/provider 配置`

### 当前实现

`agent-contracts/model` 的 `ModelProfile` 和 runtime schema 当前没有 reasoning 文本分帧字段。`agent-app` 使用 closed allowlist 校验并冻结每个子 profile，未知字段会阻止 ready；`agent-model` 的 runtime registry 保留同一 frozen `ModelProfile` definition，并按 `modelId` 建立 private provider binding。

OpenAI-compatible adapter 为一个父 provider profile 创建共享 runtime，并在每次调用中使用请求的 `modelId`。adapter 通过 AI SDK `wrapLanguageModel` 和 `extractReasoningMiddleware({ tagName: 'think' })` 同时服务 `generateText` 与 `streamText`。AI SDK 默认 `startWithReasoning=false`，因此它支持原生 reasoning 字段和成对 `<think>...</think>`，但不会把 `reasoning</think>content` 的首段 text 识别为 reasoning。Core 和 Web 只消费归一化后的 `ModelStreamDelta.reasoning/content`，不解释 provider 文本标签。

现有 provider tests 已覆盖原生 `reasoning_content`、非流式显式 think 标签、跨 chunk 显式 think 标签以及普通 content。配置测试覆盖 closed model profile、深冻结和 unknown-field fail-closed，但没有隐式 reasoning 起点配置。

### GAP 分析

| 规范目标 | 当前事实 | GAP |
|---|---|---|
| 每个 OpenAI-compatible 模型可显式选择 `IMPLICIT_OPEN_THINK_TAG` | `ModelProfile` 和 app config 不接受该字段 | 可信配置无法声明模型输出分帧契约 |
| 隐式模式在 stream/complete 中使用同一分界 | middleware 固定使用 `startWithReasoning=false` | 孤立 `</think>` 之前的 reasoning 被当作公开 content |
| 未配置、显式模式和其他 provider 保持受控 | adapter 没有模式选择；其他 provider 也没有对应配置校验 | 需要按 selected model 精确选择，并对不支持 provider fail closed |

### 修改方案

唯一实现路径是在既有 `ModelProfile` closed contract 中增加 optional `reasoningTextMode`，值域为 `EXPLICIT_THINK_TAG | IMPLICIT_OPEN_THINK_TAG`。字段缺失按 `EXPLICIT_THINK_TAG` 解释，不向默认 YAML 写入冗余值。`agent-app` 继续作为 raw config 的唯一 owner：allowlist 接受该字段、校验精确 enum、仅允许父 profile 为 `openai-compatible`，并把合法值原样冻结到子 profile。非法值、显式 `null` 或 Model Gateway 携带该字段均沿既有配置诊断路径阻止 ready。

该字段属于 provider binding 使用的可信输出格式事实，不进入 `ModelInferenceOptions`、`ResolvedModelConfiguration` 或 `ModelInvocationRequest`，也不参与 profile/Prompt/Capability patch/request/hook precedence。这样既不扩大调用级 authority，也不让 Context Engine、Core、Workflow 或 Web 观察 provider framing。

OpenAI-compatible invocation service 在准备调用时，从构造时持有的 frozen provider profile 中按 `request.modelId` 精确找到子 profile。它继续复用现有 AI SDK middleware，只把 `startWithReasoning` 设置为 `reasoningTextMode === 'IMPLICIT_OPEN_THINK_TAG'`；`tagName='think'` 保持不变。`generateText` 与 `streamText` 使用同一个 wrapped model，因此非流式和流式路径不新增第二套 parser 或累计状态。AI SDK 继续拥有 raw SSE、chunk 聚合、跨 chunk 标签识别和原生 reasoning 字段解析；NextAgent 不读取 raw transport。

未配置或显式模式仍使用 `startWithReasoning=false`。隐式模式是平台集成方对 selected model text-level 输出格式的可信声明；配置错误不会通过模型名称或响应正文启发式补救。Core、runtime、channel 和 frontend 不修改，仍按现有 provider-neutral reasoning/content delta 和 terminal result 工作。

本 change 串行依赖 `raise-default-model-timeout-300s`。`Agent App system config 使用 canonical model/provider 配置` 的完整目标态保留 `timeoutMs=300000`，实现不回退该已完成 change 的代码或测试。`agent-contracts` 新增 public model config enum 与字段已由用户在 2026-08-20 明确批准；不修改 frozen request/result 核心 shape。

#### 质量属性影响

本 change 只有功能性 Requirements，无新增黑盒质量目标。

| 质量属性 | 规范依据 | 本 Function 内实现机制 | 验证关注点 |
|---|---|---|---|
| 安全 | 无新增黑盒质量目标；由 `模型 profile 可声明隐式 reasoning 起点` 派生 | 只允许可信启动配置选择模式，避免 provider reasoning 进入公开 content | 隐式 reasoning 不出现在 content；不可信调用边界没有该字段 |
| 可维护性 | 无新增黑盒质量目标；由 `模型 profile 可声明隐式 reasoning 起点` 派生 | 复用一个 AI SDK middleware，不建立 raw stream parser 或 Web/Core 分支 | stream/complete 共用选择逻辑，默认路径不变 |
| 可测试性 | 无新增黑盒质量目标；由两个目标 Requirements 派生 | closed enum、provider 约束和 provider-neutral 输出形成确定断言 | normal、跨 chunk、默认和非法配置均有可重复测试 |

## 验证策略（Verification Strategy）

配置 contract tests 验证合法 enum 被保留和深冻结，缺失字段保持缺失，显式 `null`、未知值及 Model Gateway 配置阻止 ready。模型 adapter unit tests 以真实 AI SDK compatible response 入口覆盖流式跨 chunk `</think>`、非流式隐式分界、默认显式标签、普通 content 和原生 reasoning 回归；断言 provider-neutral reasoning/content 与终态，不断言 middleware 私有状态。

类型与 contract schema 测试确认 `ModelProfile` 只增加配置字段，`ResolvedModelConfiguration`、`ModelInvocationRequest`、`ModelStreamDelta` 和 `ModelFinalResult` shape 不变。architecture gate 确认 Core/Web 不新增 provider tag 解析，完整 build、contract、architecture 和 OpenSpec strict validation 作为整体验收。

开发者部署文档在既有 `modelProfiles[].models[]` 配置 owner 下提供最小启用示例，明确 `reasoningTextMode` 只适用于 OpenAI-compatible 模型、字段缺失不会报错并保持显式模式，以及该开关只解释响应分帧而不控制模型是否生成 reasoning。

## 长期基线刷新计划（Baseline Promotion Plan）

- `openspec/specs/model-invocation-contract/spec.md`：归档时增加隐式 reasoning 起点 Requirement，并把 `reasoningTextMode` 合入目标态 closed model profile 配置 Requirement。
- `openspec/designs/functions/D4-模型与上下文/D4.1-模型调用与降级/FN-4.1-调用模型.md`：增加 reasoning 文本分帧规格并更新处理过程与输出摘要。
- Feature：无，`F-4.1 接入多种模型` 的用户价值、Function 组成和质量保证不变。
- `openspec/overview.md`：无。
- `openspec/designs/architecture/model-provider-boundary.md`：归档时补充 model-bound output framing 事实及其不进入 invocation authority 的边界。
- `openspec/designs/modules/agent-model.md`：归档时补充按 frozen model binding 选择 AI SDK reasoning middleware 模式。
- `openspec/designs/modules/agent-app.md`：归档时补充可信模型输出格式配置的校验与冻结职责。
- ADR：无，复用现有 AI SDK reasoning middleware，不形成新的长期技术取舍。
- `openspec/designs/spec-to-design-map.md`：更新 `model-invocation-contract` 验证入口说明，不改变导航目标集合。

## 风险与取舍（Risks / Trade-offs）

错误地为普通文本模型启用隐式模式会把公开回答误分类为 reasoning。系统无法从首个文本增量无歧义识别该错误，因此采用 trusted per-model opt-in，并拒绝自动推断；部署验证必须使用目标模型的真实响应格式。

隐式模式依赖 provider 最终输出 `</think>` 完成分界。缺少闭合标签表示 provider 未满足所声明的 framing，因而不在本 change 的成功互操作保证内；本 change 不通过模型名、正文启发式或跨层回滚猜测分界。

## 迁移与回滚（Migration / Rollback）

发布顺序固定为先部署支持新 closed config 字段的应用版本，再只对已验证采用隐式起点的 OpenAI-compatible 子 profile 增加 `reasoningTextMode: IMPLICIT_OPEN_THINK_TAG`。旧版本会把该字段视为 unknown 并 fail closed，因此不得先发布配置。

回滚到旧版本前必须先移除新增字段并确认配置可通过旧 schema；仅回滚配置会恢复显式标签默认行为，不改变其他模型 profile、消息、timeline 或持久化事实。

## 待确认问题（Open Questions）

无。
