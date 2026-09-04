## 背景与问题（Why）

当前 `agent-model` 内部 `ModelInvocationRequest.commonOptions.thinking` 已经存在稳定 contract，`ThinkingDepth` 也包含 `OFF`，但外部 submit API 还不能把“本次请求关闭 think”这件事表达为可信请求事实。调用方只能接受 profile 默认值，无法在单次请求上显式关闭 reasoning/thinking。

这带来三个直接问题。第一，外部集成系统无法按场景在时延、成本和可见行为之间做单次请求级控制，例如对高频、低复杂度的电信运维问答关闭 think。第二，当前 Web API、runtime accepted context 和 provider adapter 之间没有一条一致的 request-scoped 传递链路，导致内部 contract 虽然有 `thinking=OFF` 语义，但对外不可达。第三，现有 OpenRouter adapter 仍允许 defer `thinking` 的 provider wire mapping，导致即便未来上层能传入关闭意图，也不能保证底层 provider 请求真正关闭 reasoning。

因此需要新增一个最小能力：让外部请求以 provider-neutral 的方式声明“本次请求关闭 think”，并把该事实稳定地携带到 accepted execution path 和 provider 调用边界，且不引入新的平行顶层字段或 provider-specific 外露接口。

## 变更范围（What Changes）

- Web submit API `POST /api/v1/requests` 与 `POST /api/v1/sessions/:sessionId/requests` 新增可选 `modelOptions` 字段，但只允许 request-scoped、provider-neutral、受限的 allowlist 形态；本 change 首版只开放 `modelOptions.thinking.depth`。
- Runtime `SubmitRequestCommand`、accepted `RequestContext` 与与其一致的 retry/recovery path 新增 typed request model options carry 语义，使“关闭 think”成为 accepted 后稳定存在的请求事实，而不是临时 channel patch。
- `agent-core` 在构造 `ModelInvocationRequest` 时，必须把 request-scoped thinking override 叠加到当前 effective `rendered.modelOptions` 上；该 override 仅作用于当前请求，不改变 profile、prompt 模板或全局默认值。
- `agent-model` OpenRouter adapter 必须把 `thinking.depth=OFF` 映射为 provider-supported reasoning disable 语义，而不是继续忽略该输入。`LOW|MEDIUM|HIGH` 在本 change 中继续沿用现状，不新增 provider-specific 深度换算。
- `request retry`、runtime recovery 和 idempotency semantic 必须保留同一请求的 thinking-off 事实，不得在重试或恢复时回退到 profile 默认 thinking 行为。
- 不新增平行顶层 `enableThinking` / `disableThinking` / `reasoning` 外部 API 字段；不开放 provider-specific reasoning knobs；不改变 channel stream 中 reasoning delta 的既有投影规则。

## Capability 影响（Capabilities）

### 新增 Capability

无。

### 修改的 Capability

- `ts-minimal-agent-kernel`: submit request body 的最小外部 contract 将允许携带受限的 `modelOptions.thinking.depth`，并继续拒绝其他未授权模型覆盖字段。
- `ts-core-contracts`: runtime request command 与 accepted context 需要新增 request-scoped model options carry 语义，确保关闭 think 作为可信请求事实稳定穿透 submit、retry、recovery 与 idempotency path。
- `model-provider-adapter`: OpenRouter-backed adapter 对 `thinking=OFF` 的处理从“允许 defer wire mapping”收敛为“必须映射到底层 provider 的 reasoning disable 语义”。

## 影响范围（Impact）

- 代码模块：`packages/agent-channel-web`、`packages/agent-contracts/runtime`、`packages/agent-core`、`packages/agent-runtime`、`packages/agent-model`。
- API：submit request JSON body schema 与对应 runtime submit contract。
- 持久化/恢复：run acceptance、retry、recovery、idempotency semantic 与 root user message metadata。
- 测试：channel schema/forwarding、runtime carry、model request flattening、OpenRouter request mapping、retry/recovery 相关验证。
- 运维与集成：外部调用方可对单次请求关闭 think，但不获得 provider-specific reasoning 参数控制权。

## 归档前更新基线（Baseline Promotion Plan）

- 行为契约：
  - `openspec/specs/ts-minimal-agent-kernel/spec.md`：修改 submit request body contract，纳入受限 `modelOptions.thinking.depth`
  - `openspec/specs/ts-core-contracts/spec.md`：修改 request-scoped runtime carry contract
  - `openspec/specs/model-provider-adapter/spec.md`：修改 `thinking=OFF` 的 provider wire mapping requirement

- 长期背景：
  - `openspec/overview.md`：无

- 设计视图：
  - `openspec/designs/architecture/<topic>.md`：无
  - `openspec/designs/modules/agent-channel-web.md`：需要补充 submit schema 对 request-scoped model option allowlist 的长期设计落点
  - `openspec/designs/modules/agent-runtime.md`：无
  - `openspec/designs/modules/agent-model.md`：需要补充 `thinking=OFF` 到 provider disable 语义的长期设计落点
  - `openspec/designs/adr/<id>.md`：无
  - `openspec/designs/spec-to-design-map.md`：需要更新上述 spec 到 module design 的导航

- 验证入口：
  - `packages/agent-channel-web` schema/route tests
  - `packages/agent-runtime` request carry / retry / recovery tests
  - `packages/agent-core` model request flattening tests
  - `packages/agent-model` provider mapping tests
