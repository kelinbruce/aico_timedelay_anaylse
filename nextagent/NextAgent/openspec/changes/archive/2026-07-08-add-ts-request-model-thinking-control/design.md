## 背景和现状（Context）

当前代码已经具备两段未闭环的能力：

- `agent-contracts/model` 已定义 `ModelCommonOptions.thinking`，并允许 `ThinkingDepth = "OFF" | "LOW" | "MEDIUM" | "HIGH"`。
- `agent-model` 的 OpenRouter adapter 目前只映射 `temperature`、`maxOutputTokens`、`topP`，没有把 `thinking=OFF` 下发到 provider。

这造成一个 implementation-vs-spec gap：内部 model invocation contract 已把 `thinking` 视为稳定输入，但对外 submit API 没有可信入口，provider adapter 也没有保证 `OFF` 生效。结果是“能表达，但无法从外部请求真正生效”。

相关方包括：

- 外部 Web/API 调用方：希望对单次请求关闭 think，控制延迟、成本和输出行为。
- `agent-channel-web`：拥有 public request schema。
- `agent-runtime`：拥有 accepted request fact、retry、recovery、idempotency。
- `agent-core`：拥有 effective model invocation request 构造。
- `agent-model`：拥有 provider-neutral -> provider-native 映射。

约束：

- 不新增平行顶层 `enableThinking` / `disableThinking` 字段。
- 不把 provider-specific reasoning knobs 暴露给 channel/runtime public contract。
- 必须保证 retry/recovery 不丢失同一请求的 thinking-off 事实。

## 目标和非目标（Goals / Non-Goals）

**目标：**

- 为外部 submit API 增加一个最小、provider-neutral 的请求级关闭 think 能力。
- 让该能力以 typed request fact 形式从 channel 一直稳定传到 runtime、core 和 model adapter。
- 确保 `thinking.depth="OFF"` 真正作用到底层 provider 请求。
- 保持改动外科手术式，只覆盖 submit/retry/recovery/flatten/provider mapping 这条主路径。

**非目标：**

- 不在本 change 中开放 `LOW` / `MEDIUM` / `HIGH` 到 provider-specific 深度换算。
- 不开放 `temperature`、`topP`、`maxOutputTokens` 的外部请求级覆盖。
- 不改变 prompt 模板、profile 配置、workflow `model_params` 或 lifecycle hook 的现有模型选项机制。
- 不改变 reasoning delta 的已有 stream projection；只是让关闭后不再请求 reasoning 输出。

## 设计决策（Decisions）

### 1. 唯一入口：submit body 使用 `modelOptions.thinking.depth`

选定路径：public submit body 新增可选

```json
{
  "modelOptions": {
    "thinking": {
      "depth": "OFF"
    }
  }
}
```

理由：

- 与现有 `ModelCommonOptions` 词汇一致，不引入平行语义。
- 外部调用方表达的是“本次请求的模型行为偏好”，不是 routing 约束，也不是 provider 配置。
- 只开放 `OFF`，可以把首版边界收敛到一个唯一可验证能力。

放弃方案：

- 把字段塞进 `routingConstraints`：错误。`routingConstraints` 已明确不是 provider/model selection 或 model behavior owner。
- 新增顶层 `enableThinking`/`disableThinking`：会和 `ModelCommonOptions.thinking` 形成平行 contract。
- 直接暴露 `providerOptions.openrouter.reasoning`：把 provider 私有形状泄漏到对外接口，违背边界。

### 2. Runtime 独立承载：新增 `RequestModelOptions`

选定路径：在 `agent-contracts/runtime` 中新增一个独立、受限的 `RequestModelOptions` typed contract，并在 `SubmitRequestCommand` 与 `RequestContext` 上携带 `requestModelOptions?: RequestModelOptions`。

理由：

- 请求级 thinking 开关是 accepted request fact，不是临时 channel patch。
- `RequestContext` 是 retry/recovery/agent execution 共享的已接受事实容器，适合作为唯一 owner。
- 独立命名为 `requestModelOptions`，避免与 `ModelInvocationRequest.commonOptions` 混淆 owner 边界。

细节：

- 首版 shape 仅允许 `thinking?: { depth: "OFF" }`。
- `EditLatestRequestCommand` 暂不新增该字段；本 change 只覆盖 submit 对外接口。
- retry/recovery 必须从已持久化请求事实恢复该字段。

### 3. 持久化锚点：通过 root USER message metadata 保存 request-scoped model option

选定路径：把 request-scoped model option 作为 root USER message metadata 的一部分持久化，并在 retry/recovery 时与 `inputText`、`attachmentIds` 一起重建 submit command/context。

理由：

- 当前 `RequestRunRecord` 只保存 run 事实，不保存完整 submit payload；直接扩 `RequestRunRecord` 会让 run fact 开始承载请求语义细节，边界更差。
- retry 已经通过 root USER message metadata 取回 `attachmentIds`；沿用同一锚点最小且一致。
- root USER message 与 requestId 一一对应，天然符合“该请求事实”的持久化 owner。

放弃方案：

- 扩 `RequestRunRecord`：会让 gateway run fact 兼容请求细节，扩大持久化面和 recovery mapping 复杂度。
- 只存内存 / flowVariables：retry、recovery、重启后 rebuild 都会丢。

### 4. 生效位置：在 `flattenModelRequest` 末端叠加 request-scoped override

选定路径：`agent-core` 在把 `RenderedModelInput` 展平为 `ModelInvocationRequest` 时，以 request-scoped override 覆盖 effective `rendered.modelOptions`。

理由：

- 这是 profile + prompt + capability patch 已经收敛后的最后 provider-neutral 出口。
- 能保证请求级关闭 think 只影响当前请求，不污染 profile 或 prompt。
- 逻辑集中，测试边界清晰。

规则：

- 仅在 `context.requestModelOptions?.thinking.depth === "OFF"` 时覆盖 `commonOptions.thinking`。
- 其他 `rendered.modelOptions` 字段保持不变。

### 5. Provider 映射：OpenRouter 使用 provider-native reasoning disable

选定路径：当 `commonOptions.thinking.depth === "OFF"` 时，OpenRouter adapter 自动补充 `providerOptions.openrouter.reasoning = { enabled: false, effort: "none", exclude: true }`，并与既有 `parallelToolCalls` 合并。

理由：

- 本地依赖类型已经明确 OpenRouter reasoning 支持 `enabled`、`exclude` 和 `effort: "none"`。
- 不需要外部调用方知道 provider-specific 形状。
- `exclude: true` 能避免 reasoning 仍以 provider metadata/response 形式返回。

放弃方案：

- 完全忽略 `thinking=OFF`：与 change 目标冲突。
- 只设 `exclude: true` 不设 disable：可能只是隐藏输出而不是关闭 provider 推理。
- 把 `thinking=OFF` 改写成模型名切换到 non-reasoning variant：会把 request-scoped option 变成 model selection，越过 profile owner。

## 质量属性设计（Quality Attributes）

| 质量属性 | 设计结论 | 验证入口 |
|---|---|---|
| 安全 | 外部只开放 provider-neutral `thinking.depth="OFF"`，拒绝 provider-private reasoning knobs、路径、credential、owner/agent override；channel schema fail-closed，runtime contract 继续保持 trusted owner/agent scope | channel schema tests, runtime carry tests |
| 性能/容量 | `thinking=OFF` 预期降低 reasoning token 与时延；实现只增加小型 schema/merge 逻辑，不引入额外 I/O 或新表 | provider mapping tests, existing build/tests |
| 可靠性/恢复 | request-scoped option 作为 root USER message metadata 持久化，retry/recovery 复用同一锚点恢复；避免恢复后回退默认 thinking | runtime retry/recovery tests |
| 可维护性 | 采用单一词汇 `modelOptions -> requestModelOptions -> commonOptions.thinking`；不新增平行 API；owner 清晰：channel schema、runtime carry、core merge、model mapping | code review, architecture checks |
| 可测试性 | 每层都有清晰断点：DTO schema、runtime accepted context、flattened model request、provider outbound payload | unit tests in channel/runtime/core/model |
| 审计/可追溯性 | 不新增 raw reasoning 记录；只新增安全 request fact carry，不改变现有 redaction/stream 语义 | existing observability invariants, focused tests |

## 验证映射（Verification Map）

| 约束 | Task | 验证入口 |
|---|---|---|
| submit body 只允许 `modelOptions.thinking.depth="OFF"` | T1 | `packages/agent-channel-web` schema/route tests |
| runtime accepted context 稳定携带 request-scoped model option | T2 | `packages/agent-runtime` carry tests |
| retry/recovery 不丢失 thinking-off 事实 | T3 | `packages/agent-runtime` retry/recovery tests |
| request-scoped option 在 model request flatten 时覆盖 effective thinking | T4 | `packages/agent-core` model request builder tests |
| OpenRouter outbound request 真正关闭 reasoning | T5 | `packages/agent-model` provider tests |
| OpenSpec 与代码一致 | T6 | `openspec validate --all --strict` |

## 文档承载决策（Documentation Ownership）

- 行为契约：
  - `openspec/specs/ts-minimal-agent-kernel/spec.md`：submit body 对 `modelOptions.thinking.depth="OFF"` 的外部行为契约
  - `openspec/specs/ts-core-contracts/spec.md`：runtime-owned `RequestModelOptions` carry contract
  - `openspec/specs/model-provider-adapter/spec.md`：`thinking=OFF` 的 provider-native 映射契约
- 架构和跨模块设计：
  - 无新增独立 architecture 主文档；本 change 的跨模块事实规模较小，归档时主要提炼到 module design
- 模块设计：
  - `openspec/designs/modules/agent-channel-web.md`：public submit schema 的 request-scoped model option allowlist
  - `openspec/designs/modules/agent-model.md`：provider-neutral thinking-off 到 OpenRouter reasoning-disable 的落点
- ADR：
  - 无
- 导航：
  - `openspec/designs/spec-to-design-map.md`

## 风险与取舍（Risks / Trade-offs）

- [风险] 仅支持 `OFF`，外部调用方可能期待低/中/高档位控制 -> 缓解方式：本 change 明确非目标，后续单独 change 再定义跨 provider 深度映射。
- [风险] 通过 message metadata 持久化 request fact，需谨慎保持 metadata 安全形状 -> 缓解方式：只存低敏、低基数的 `thinking.depth="OFF"`，不存 provider-native payload。
- [风险] 某些上游 provider 可能仍返回非空 reasoning 片段 -> 缓解方式：adapter 先发 disable+exclude；若 provider 仍返回，保持既有 normalization，不在本 change 中新增 second-pass stripping 逻辑。

## 迁移计划（Migration Plan）

无。该能力为向前新增的可选 request 字段。未使用 `modelOptions` 的现有调用方行为保持不变；若新字段实现出现问题，可回退到不传该字段的既有路径。

## 归档前更新基线（Baseline Promotion Plan）

- `openspec/specs/ts-minimal-agent-kernel/spec.md`：保留 submit body 允许 `modelOptions.thinking.depth="OFF"` 且 fail-closed 拒绝其他字段的契约
- `openspec/specs/ts-core-contracts/spec.md`：保留 runtime-owned `RequestModelOptions` carry、retry/recovery 保真和最小 allowlist 契约
- `openspec/specs/model-provider-adapter/spec.md`：保留 `thinking=OFF` 必须映射到 provider-native reasoning disable 的契约
- `openspec/designs/modules/agent-channel-web.md`：保留 submit schema allowlist 设计落点
- `openspec/designs/modules/agent-model.md`：保留 OpenRouter reasoning disable 映射落点
- `openspec/designs/spec-to-design-map.md`：增加上述 spec 到 module design 的导航

## 待确认问题（Open Questions）

- 是否需要在后续 change 中把 `EditLatestRequestCommand` 也扩展为可显式传入新的 request-scoped model option，而不是只在 retry/recovery 中保留既有事实？本 change 暂不覆盖。
