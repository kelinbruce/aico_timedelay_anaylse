# ADR：Skill Extension Metadata 边界与受控例外

## 上下文

NextAgent Skill manifest 通过 `metadata.extension` 字段承载结构化 authoring metadata。`add-skill-metadata-extension` change 建立了以下原则：

- extension value 仅允许 primitive 和递归 JsonObject（拒绝 array）。
- extension key 受 `unsafeKeyPattern` 校验（含 `api_key`、`authorization`、`base_url`、`credential`、`endpoint`、`headers`、`password`、`secret`、`token`、`url` 等）。
- extension key 长度 1-128 字符，nesting depth ≤3 levels，total size ≤32KB。
- **governed behavior 分离原则**：NextAgent 内部 governed behavior 路径（capability governance、Agent assembly、routing、policy、sandbox、model selection、prompt shaping、owner scope、availability、tool authorization）不消费 extension 值推导行为。extension 字段只用于 Skill authoring metadata preservation，上层集成服务可通过 `readSkillMetadata(descriptor).extension` 读取。

## 决策

维持 governed behavior 分离原则为默认规则，但记录以下受控例外。每个例外必须明确原因、适用范围（精确到 key 名和消费点）和验证方式。

## 受控例外 1：`api_header_params` key 白名单

**原因**：Skill 驱动 API 调用能力需要通过 `metadata.extension.api_header_params` 声明 API 调用需注入的 header 参数名。现有 `unsafeKeyPattern` 中 `headers?` pattern 会拦截含 `header` 的 key，导致 `api_header_params` 被 `EXTENSION_OMITTED` 静默丢弃。

**适用范围**：仅 `api_header_params` 这一个精确 key 名跳过 `unsafeKeyPattern` 检测。白名单内的 key 仍受 key 长度和其他安全约束。其他含 `header` 的 key（如 `authorization_header`）仍被 `unsafeKeyPattern` 拒绝。

**实现**：`isSafeExtensionKey` 中新增 `extensionKeyWhitelist = new Set(["api_header_params"])`，白名单内 key 跳过 `unsafeKeyPattern` 检测。

**验证**：`skill-manifest.test.ts` 覆盖 `api_header_params` accepted、其他 header 含 key 仍 reject。

**同形同策影响**：这是对统一 key safety policy 的受控例外。范围限定到单个 key 名，不扩大到其他 header 相关 key。新增类似例外必须先在 OpenSpec design 中写明原因和适用范围。

## 受控例外 2：governed behavior 消费 `_naie_agentic_loop_flag`

**原因**：Skill 驱动 API 调用能力需要编排层（`agent-core` routing）根据 `extension._naie_agentic_loop_flag` 决定走 agentic loop 还是非 agentic API 调用路径。如果不允许 governed behavior 读取此字段，非 agentic 路径无法触发。

**适用范围**：仅编排层（`agent-core` routing）允许读取 `extension._naie_agentic_loop_flag` 这一个具体 key，通过 `readSkillMetadata(descriptor).extension` 读取，不直接访问 raw metadata。

**不消费的字段**：
- `_naie_pass_through_flag`：预留字段，编排层不消费，语义留给后续 change 定义。
- `api_header_params`/`api_request_params`：不由 governed behavior 直接消费。由 `Skill` tool 从 extension 读取后放入返回结果 `structuredPayload`，编排层从结果中获取并传入 `ApiCall` tool。

**验证**：architecture boundary tests 断言编排层只读取 `_naie_agentic_loop_flag`，不读取 `_naie_pass_through_flag`、`api_header_params`、`api_request_params`。

**同形同策影响**：这是对 governed behavior 分离原则的受控例外。范围限定到编排层读取单个 key。新增类似例外必须先在 OpenSpec design 中写明原因、适用范围和消费点，不得扩大到其他 governed behavior 路径或其他 extension key。

## 被拒绝的方案

- **在 `Skill` tool 内部消费 `_naie_agentic_loop_flag` 并直接调 API tool**：被拒绝，因为需求方要求 `Skill` tool 和 `ApiCall` tool 各自独立返回结果，且 `ApiCall` tool 作为独立 Tool capability 需复用 `capabilityInvocation.invoke()` 的完整 governance/audit/validation 机制。
- **让 governed behavior 直接消费 `api_header_params`/`api_request_params`**：被拒绝，因为这会扩大 governed behavior 消费 extension 的范围。改为 `Skill` tool 读取后放入返回结果，编排层从结果中获取。
- **放开 `unsafeKeyPattern` 整体限制**：被拒绝，因为这会破坏所有含 `header` 的 key 的安全边界。改为单 key 白名单。
