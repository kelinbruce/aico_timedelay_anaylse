## 目标和边界

`Skill` tool 是模型侧 Skill 执行入口。模型返回 `Skill` tool_use 后，Agent Core 按普通 capability 流程 resolve 原始 `Skill` tool 并通过 `CapabilityInvocationPort` 进入该 Tool 的实现；目标 Skill `name` dispatch、metadata 读取和 Skill source 选择的 authority 均归 `Skill` Tool 实现。

The outer `Skill` wrapper is a builtin `TOOL` capability. It registers through the existing `builtin-tools` provider, `BuiltinToolCatalog`, `BuiltinToolsExecutor`, and normal `CapabilityInvocationPort` path, so the model-facing wrapper stays on the same builtin tool execution path as other builtin tools.

`Skill` Tool 实现在同一次 execution 内解析 `{ name, args? }`、通过 request-scope governed capability resolver 校验 trusted scope 并把 Skill name 解析到 governed Skill id/descriptor、读取受治理 Skill metadata，并在首版闭环 `context=inline`。`name` 的唯一语义是 target Skill name，首版等同于 Skill `CapabilityDescriptor.capabilityId` / manifest `name`；model-visible disclosure 披露 `CapabilityDescriptor.modelInvocable=true` 的子集，target Skill resolve 使用 governed available view。目标 Skill descriptor/facts 是治理后的执行输入，inline body 读取和 hidden context 注入都在这同一次 wrapper invocation 内完成；当目标 Skill metadata 声明 `context=fork` 时，当前 change 以安全 `SKILL_CONTEXT_UNSUPPORTED` 结果保持单次 tool_result 契约，后续 fork child execution 由 `add-ts-fork-skill-execution` 承接。

`CapabilityDescriptor.modelInvocable` 是所有 Capability 的统一模型披露资格字段，执行授权由 governed availability、binding、policy 和 resolver 共同决定。builtin Tool 和 builtin Skill descriptor 均声明 `modelInvocable=true`。非默认激活的 provider，包括 MCP Server、CLIP 等，默认其 capabilities `modelInvocable=false`，capability 显式声明 `modelInvocable=true` 时进入模型披露候选。`SkillMetadata.userInvocable=true` 表示可信 channel/user 显式入口也可以请求该 Skill；该显式入口由 channel/core 单独治理并生成自己的 request/command 语义，同时复用当前 agent/owner scope、resolver governance 和 Skill result contract。

Catalog、runtime resolver、Context Engine 的职责必须分开：

- Catalog universe：在可信 Agent Scope 和 Owner Scope 下发现/列出 capability descriptor。Catalog list request 支持 `modelInvocable` 查询条件，供 Context Engine 要求 catalog/discovery 直接产出模型披露候选；未带该条件时返回可用全集，用于 resolver 和 allowedTools 治理。
- Runtime resolver：由 app/core/capability composition 绑定当前 `agentId`、`agentVersion`、`tenantId`、`subjectId` 后注入执行路径；它负责按 `kind + providerId? + capabilityId` 从 governed available capability view 解析 descriptor。它的职责范围是 governed descriptor lookup；request-local activation/exclusion 归 Context Engine 的上下文披露流程。
- Model visible set：由 Context Engine 在每次模型 step 组装时向 catalog 请求 `modelInvocable=true` 的 baseline capability view，再把 request-local `CapabilityContextPatch.allowedTools` 中解析成功的 governed available `TOOL` descriptors 作为本轮额外激活工具并入模型可见工具集合，最后用 `CapabilityContextPatch.deniedTools` 从合并后的模型可见 `TOOL` 集合中排除匹配项。Catalog MUST apply `modelInvocable` after governance and pass it through to search/discovery criteria so non-default providers such as MCP/CLIP can avoid returning default-hidden capabilities when possible.

`visibleCapabilities` 表示 ContextAssembly/RenderedModelInput 的模型可见结果。执行期 capability lookup 通过 request-scope governed capability resolver 完成，resolver 是 Skill Tool 以及后续 MCP/CLIP/内部工具执行路径的权威 lookup port。

方案 B 的最小 contract 命名如下，放在 `agent-contracts/capability` 的 in-process port 区域，作为 in-process execution-time lookup contract：

```ts
export interface RuntimeCapabilityResolveRequest {
  readonly kind: CapabilityKind;
  readonly capabilityId: CapabilityId;
  readonly providerId?: string;
}

export interface RuntimeCapabilityResolver {
  resolveCapability(
    request: RuntimeCapabilityResolveRequest,
    signal: AbortSignal
  ): Promise<CapabilityDescriptor | undefined>;
}

export interface CapabilityInvocationRuntimeContext {
  readonly capabilityResolver?: RuntimeCapabilityResolver;
}
```

现有 `CapabilityResolveRequest` 保留为 catalog resolve request。`RuntimeCapabilityResolveRequest` 使用平铺字段，保持 runtime resolver request 与 catalog query request 分离。

`CapabilityInvocationPort.invoke(...)` 接受 optional `CapabilityInvocationRuntimeContext`，Agent Core 在 tool-loop/request 执行时创建并传入。`RuntimeCapabilityResolver` 实现归 `agent-core`，因为它组合 catalog、accepted `AgentAssembly` 和 trusted owner scope；`agent-capability` 通过该 port 消费 resolver，由 composition root 提供 resolver lifecycle。

## 非目标与延期范围

- 本 change 不实现 fork child run、isolated context、结果映射和取消级联；`context=fork` 在本 change 中映射为安全 `SKILL_CONTEXT_UNSUPPORTED` 结果，完整 fork 执行由 `add-ts-fork-skill-execution` 承接。
- 本 change 不定义 Skill resource access；Skill resource refs、资源列表、资源读取边界和 raw path 禁止规则由后续 change 承接。
- 本 change 不新增 `CapabilityRef` contract，也不复用 catalog `CapabilityResolveRequest` 作为 runtime resolver request；runtime resolver request 使用平铺字段。
- 本 change 不实现模型协议层后台 `accepted` / pending Skill invocation；后台 pending/resume/result-delivery 机制由后续 change 定义。
- 本 change 不把 `visibleCapabilities` 扩展为 execution-time lookup authority；执行期 lookup authority 是 request-scope governed capability resolver。

## 黑盒输入输出

Input schema:

```text
{ name: string, args?: object }
```

`args` is optional target Skill data. Skill tool validates a bounded generic JSON envelope: when present it is a JSON object root, is JSON-serializable, stays within `skillToolArgsMaxBytes` and `skillToolArgsMaxDepth`, and carries only task data for the target Skill. First release defaults are `skillToolArgsMaxBytes=8192` serialized UTF-8 bytes and `skillToolArgsMaxDepth=8` unless product configuration provides smaller values. Per-Skill semantic argument validation belongs to a later Skill input schema contract.

Success output schema:

```text
Inline success visible result:
{ name: string, status: "loaded" }
```

Failure reason codes: `INVALID_INPUT`, `SKILL_NOT_AVAILABLE`, `SKILL_CONTEXT_UNSUPPORTED`, `SCOPE_MISMATCH`, `TIMEOUT`, `ABORTED`, `EXECUTION_FAILED`.

Execution result contract:

- Skill tool execution returns one `CapabilityInvocationResult` to Agent Core.
- Agent Core MUST project that result into exactly one provider tool_result correlated with the original `Skill` tool_use id.
- Internal generated messages, requested context patches and audit refs are facets of the same execution result.
- Runtime timeline/history MAY record safe facts, while the authoritative delivery path remains the provider tool_result produced from the same `CapabilityInvocationResult`.
- Provider tool-result settlement is mandatory: timeout, abort, runner interruption, recovery of a pending/running call, or result-shape rejection MUST produce one safe terminal tool_result for the original `Skill` tool_use.

## 可见 Skill 列表与 Body 边界

Model-visible Skill discovery discloses the current-run governed Skill names and safe descriptions for Skills available to the current Agent scope and Owner scope whose descriptor has `modelInvocable=true`. The disclosed name is the governed Skill `CapabilityDescriptor.capabilityId` produced from manifest `name`, and the disclosure surface is limited to that governed name plus safe description.

Responsibility for assembling and refreshing the model-visible Skill list stays with the existing context assembly / capability disclosure path. Before each model step, that path builds the model-visible list from the request-scope catalog/resolver view after Agent Scope, Owner Scope, binding, availability, policy gates and `CapabilityDescriptor.modelInvocable=true`. The `Skill` Tool implementation consumes `CapabilityInvocationRuntimeContext.capabilityResolver` for target resolution, while list refresh stays in the existing context capability disclosure path.

Current code baseline already carries `visibleCapabilities` in `ContextAssembly`; this remains a model-visible assembly/render field populated from `CapabilityCatalog.listAvailable(..., modelInvocable: true)`. The target implementation path keeps model-visible rendering and execution-time resolving separate:

- Context Engine asks Capability Catalog for `modelInvocable=true` before producing baseline `visibleCapabilities`; catalog applies the filter and passes it through to discovery/search providers.
- When request-local `CapabilityContextPatch.allowedTools` is present, Context Engine also queries the governed available catalog view, resolves each allowed tool ref against `TOOL` descriptors by `capabilityId` or `@providerId/capabilityId`, and unions the resolved descriptors into `visibleCapabilities`.
- When request-local `CapabilityContextPatch.deniedTools` is present, Context Engine applies it after baseline model-visible descriptors and `allowedTools` activation have been merged. It excludes matching `TOOL` descriptors from the current model-visible set by `capabilityId` or `@providerId/capabilityId`; denied refs absent from the current model-visible set are ignored.
- `TOOL` capabilities are selected by `kind === "TOOL"`.
- Provider tool descriptors are then projected from the visible `TOOL` subset: baseline entries come from descriptors whose `modelInvocable=true`, and request-local allowedTools entries come from resolved governed available `TOOL` descriptors even when their descriptor has `modelInvocable=false`; all projected tools must have an `inputSchema` present and valid for the model contract.
- `SKILL` disclosure entries are selected by `kind === "SKILL"` and `CapabilityDescriptor.modelInvocable=true`.
- The English Skill disclosure section is rendered only when the visible `TOOL` subset still contains the model-callable `Skill` tool entry for that step.
- Skill Tool target resolution calls `CapabilityInvocationRuntimeContext.capabilityResolver.resolveCapability({ kind: "SKILL", capabilityId: <name> }, signal)`.

`SkillMetadata.allowedTools` is mapped into `CapabilityContextPatch.allowedTools` when the Skill is activated. `SkillMetadata.deniedTools` is mapped into `CapabilityContextPatch.deniedTools`. They are request-local context policy metadata. Agent Core stores and forwards the whole request-local `CapabilityContextPatch` to Context Engine. Because allowed tools may include default-hidden MCP/CLIP/internal tools, Context Engine validates `allowedTools` against the governed available catalog view, and successful entries become model-visible for the next model step. Invalid allowed entries fail at the Context Engine governance boundary with `CAPABILITY_CONTEXT_PATCH_DENIED`. `deniedTools` is then applied by Context Engine as the final exclusion over the merged model-visible `TOOL` set; denied entries absent from the current visible set are ignored.

`allowedTools` keeps its string list shape. Tool references SHOULD use provider-qualified capability refs such as `@providerId/toolId`; unqualified `toolId` is only valid when the activating Skill has an unambiguous provider binding rule. Resolver matching uses `providerId + capabilityId + kind`, never `capabilityId` alone when provider ambiguity exists.

The rendered Skill disclosure section stays in English to match the existing implemented system prompt language. Its target-state shape is:

```md
### Available skills
- <skill-name>: <safe description>
- <skill-name>: <safe description>

### How to use skills
- Use the `Skill` tool only when the user request clearly matches one of the available skills above.
- Set `name` to the exact skill name from the list. Do not invent or rewrite skill names.
- Put only task-specific JSON input in `args`. Do not include mode, timeout, provider, path, directory, budget, or other execution-governance fields.
- Skills are governed capabilities. They are not filesystem paths, directories, or external packages.
- Do not assume any skill exists unless it appears in the list above.
- Do not refer to hidden implementation details such as local paths, package layout, source roots, loader keys, or internal provider identities.
- If no available skill is a clear match, continue with normal tools and normal reasoning.
- After a skill is loaded, follow the instructions it adds to context, but continue to obey higher-priority system, developer, and runtime constraints.
- Do not claim a skill was used unless you actually called the `Skill` tool successfully.
- If a skill call fails or the requested skill is unavailable, continue safely with other available tools when possible.
```

The section consists only of visible Skill names, safe descriptions, and usage instructions consistent with the existing English system-prompt language baseline.

The `Skill` Tool descriptor description also carries model tool-choice guidance because provider tool schemas expose descriptor descriptions directly to the model. It MUST describe `Skill` as executing a governed Skill within the main conversation, tell the model to call `Skill` before answering when a listed available Skill clearly matches, treat slash commands such as `/commit` as possible Skill names only on exact match, keep built-in CLI commands such as `/help` and `/clear` on their existing CLI path, require exact available Skill names and task-specific JSON object `args`, and tell the model to claim Skill use only after the tool was actually called successfully. Provider-qualified Skill name examples and string-typed args examples are outside this change.

Skill body loading occurs only inside authorized `Skill` tool execution after target resolution. Discovery/indexing remains lightweight: Skill sources parse only standard manifest/metadata facts needed for descriptor registration, model visibility and governance, and retain provider/source-owned internal loading facts for later use.

`SkillDocumentService` in `agent-capability` is the single implementation owner for `SKILL.md` format interpretation. It owns leading-frontmatter detection, field interpretation, descriptor/`SkillMetadata` mapping, safe diagnostics, canonical body slicing and source consistency token construction. Catalog resolve, provider selection, source root lookup, agent package lookup, and loading authority stay with their existing catalog/source boundaries.

Invocation-time body loading stays with source/discovery implementations. The current baseline already has three Skill discovery instances backed by two classes: builtin bundled Skills, system-local Skills, and agent-owned-local Skills. These discovery/source implementations own source-private loading facts and implement a shared implementation-local `SkillSourceDiscovery` ability surface used by the `Skill` Tool implementation.

Target-state operations:

- `SkillDocumentService.parseMetadataView(...)`: used by Skill source discovery/indexing after the source implementation has already located the relevant `SKILL.md`. It parses standard manifest/metadata facts and produces descriptor input, typed `SkillMetadata`, safe diagnostics and consistency facts.
- `SkillDocumentService.loadCanonicalBodyView(...)`: used by Skill source discovery/source-loading implementations after the source implementation has already resolved the authoritative document location. It returns `SkillCanonicalBodyView`: canonical body with frontmatter excluded and safe internal source identity/version/hash facts needed for consistency checks.
- `SkillSourceDiscovery.loadCanonicalBodyView(...)`: implementation-local source/discovery operation used by Skill tool after catalog resolve and authorization. It encapsulates provider-specific loading facts, calls `SkillDocumentService`, and returns a canonical body view for the resolved descriptor.

Skill tool uses the resolved descriptor's `provider.providerId` to look up the already-registered source/discovery through an implementation-local catalog query, then calls that source's `loadCanonicalBodyView(...)`. Descriptor metadata, model context, visible tool_result, stream payload, safe error, audit detail and logs stay on governed identifiers and safe result fields; provider/source-private loading facts stay inside the provider/source boundary.

The invocation-time canonical body view MUST match the resolved descriptor's provider id, Skill identity/name and stable source identity/version/hash or equivalent consistency token. When the source changed, disappeared, or re-parsed to a different identity, Skill tool returns a safe mismatch outcome or forces a governed re-resolve according to catalog policy.

Skill resource access remains a separate governed resource boundary; future resource support should use scoped refs such as opaque `skill_resource_ref`.

## 核心流程

1. Validate schema and generic `args` JSON limits.
2. Treat `name` only as the model-visible target Skill name.
3. Resolve target by calling `CapabilityInvocationRuntimeContext.capabilityResolver.resolveCapability(...)` with `kind="SKILL"` and exact Skill name, where name is the Skill `CapabilityDescriptor.capabilityId` / manifest `name`; map it to internal Skill id/descriptor through governed availability.
4. Read resolved Skill metadata `context`.
5. If `context !== "inline"`, return safe `SKILL_CONTEXT_UNSUPPORTED` for the original tool_use.
6. Resolve the registered Skill source/discovery by `descriptor.provider.providerId` through an implementation-local catalog query and require it to implement `SkillSourceDiscovery`.
7. For `context=inline`, authorized deferred body loading through `SkillSourceDiscovery.loadCanonicalBodyView(...)` returns a canonical body view; the `Skill` Tool implementation performs injection boundary checks, then returns request-local hidden generated messages, optional requested context patch and a safe visible tool result.
8. Await completed/failed/timed_out/canceled outcome under timeout and AbortSignal.
9. Return one safe structured result for the original model tool_use, using the visible result for acknowledgement and the hidden generated message for inline instruction injection.

Timeout is a ToolExecutor/runtime governance concern. The model input surface is limited to governed Skill selection and target task data. Effective timeout MUST be derived from the current request/run deadline and AbortSignal, capability invocation policy and ToolExecutor defaults, using the most restrictive applicable value.

## Inline Result Assembly

Inline execution is part of this change. It assembles `CapabilityInvocationResult` from governed descriptor fields, typed `SkillMetadata`, authorized loaded Skill body and terminal execution state.

Field rules:

- `status`: internal `CapabilityInvocationResult.status` is `SUCCEEDED` when the target resolves, body loads, body boundary checks pass and result shape is valid. The model-visible inline result body uses `status: "loaded"` because the observable effect is loading Skill instructions into request-local model context. Scope mismatch, unavailable Skill, body load failure, body boundary failure, timeout and abort return safe terminal failures.
- `structuredPayload`: inline Skill tool uses it for the fixed visible acknowledgement `{ name, status: "loaded" }`, because current Agent Core projects provider tool_result content from `CapabilityInvocationResult.structuredPayload`.
- `generatedMessages`: inline success includes one hidden generated message with `role=USER` and `meta=true`. Content is the authorized canonical Skill body with frontmatter excluded, as produced by the source/parser boundary, after deterministic injection boundary checks.
- `contextPatch`: current change maps Skill-emitted context patch fields to `allowedTools`, `deniedTools`, `modelName` and `modelOptions`.
- `resultRef` and `artifactRefs`: inline Skill tool leaves them unset.
- `metadata`: safe correlation such as target skill id, provider id and context mode belongs to audit/log layers unless the core result contract already defines bounded safe metadata for that purpose.
- `safeError`: uses stable reason code and sanitized message.

The normal visible tool result for inline success is the `structuredPayload` fixed safe acknowledgement derived from trusted facts: `{ name, status: "loaded" }`. The actual inline effect is the hidden generated message in the same capability result.

Generated message envelope:

```text
<skill_content name="{safe skill name}">
{authorized canonical markdown body with frontmatter excluded}
</skill_content>
```

The envelope uses a single `<skill_content>` wrapper. `name` is the authorized model-visible Skill name after deterministic escaping for the attribute context. The loaded body passes a boundary check that preserves wrapper integrity under the final message rendering/parsing rules. Agent Core/Context Engine consume it as request-local hidden `USER` context only.

## Unsupported Fork Context

When the resolved Skill metadata declares `context=fork`, the `Skill` Tool implementation returns a safe `SKILL_CONTEXT_UNSUPPORTED` failure for the original `Skill` tool_use. Fork execution details belong to `add-ts-fork-skill-execution`.

The detailed child run/branch lifecycle, isolated context, result refs and cancel cascade are specified by `add-ts-fork-skill-execution`.

## Inline Body Boundary Checks

Skill body checks are deterministic runtime injection boundary checks. They apply to the canonical body view returned by the currently supported bundled, system-local, and agent-owned-local Skill source loaders before any body enters model context.

Required checks confirm:

- the body was loaded only after target Skill resolution and scope authorization through the provider/source-owned loading boundary;
- the body is the canonical parser-produced body with frontmatter excluded;
- the body view source identity/version/hash or equivalent consistency token matches the resolved descriptor;
- the body is valid text in the expected encoding and remains non-empty after canonical frontmatter exclusion;
- the body contains no binary payload or disallowed control characters and stays within the inline Skill body budget;
- the generated message boundary preserves wrapper integrity and keeps source-private refs, raw local paths, package layout, and credentials out of result surfaces.

The inline body byte limit is owned by NextAgent runtime/context policy. First release default `inlineSkillBodyMaxBytes` is 65536 bytes unless product configuration provides a smaller value. The `Skill` Tool implementation enforces this byte/text boundary before returning generated messages.

Current model context budget enforcement for generated Skill messages is owned by Context Engine at next-turn assembly/render time. The existing tool loop baseline remains: invoke capability, validate result shape, save the capability result, persist the normal capability-result message, carry request-local hidden generated messages forward, then enter the next turn and call Context Engine. During that next assembly/render:

- the newly activated Skill generated message from the immediately preceding tool round is protected while older context is compressed first;
- compression MUST first target earlier selected/history context according to context policy;
- the protected active Skill message remains intact for normal success reporting.

Context Engine budget exhaustion after older-context compression safe-fails the run before the next model invocation. `{ name, status: "loaded" }` continues to mean the Skill body was accepted into request-local hidden context state for the subsequent turn.

## Context Patch Request Semantics

`model` and `modelOptions` are requested context changes emitted by the Skill result, saved as request-local state by Agent Core, and later governed by Context Engine / model selection governance during next-turn assembly.

- Skill tool maps typed `SkillMetadata.model` / `modelOptions` to `contextPatch.modelName?` / `modelOptions?`.
- Agent Core persists only the request-local patch state for the current run.
- Context Engine / model selection governance validates and applies or rejects these patches against current request scope, model selection governance and context policy before later model steps.
- `allowedTools` is emitted as request-local context metadata by setting `CapabilityContextPatch.allowedTools = SkillMetadata.allowedTools`. `deniedTools` is emitted as `CapabilityContextPatch.deniedTools = SkillMetadata.deniedTools`. Agent Core stores the whole `CapabilityContextPatch` in request-local state for later Context Engine assembly/render; Context Engine owns both activation and final exclusion during model-visible capability assembly, and `RuntimeCapabilityResolver` remains scoped to governed descriptor lookup.

## Current Baseline And Minimal Delta

Current code already has:

- `CapabilityInvocationResult` and `CapabilityContextPatch` in `agent-contracts/capability`.
- `SkillMetadata.allowedTools` / `deniedTools` in Skill manifest parsing and schema.
- Three registered Skill discovery instances in `agent-capability`: builtin bundled Skills, system-local Skills, and agent-owned-local Skills.
- Two existing Skill discovery/source classes in `agent-capability`: `BuiltinSkillDiscovery` and `LocalSkillDiscovery`, both already holding provider-private loading facts.
- Agent Core projection of model-visible capability result content from `CapabilityInvocationResult.structuredPayload`.
- Tool-loop baseline already invokes capabilities, validates result shape, saves normal capability-result messages, carries `generatedMessages` in request-local state, and only then enters the next turn where Context Engine assembles the next model input.

Minimal delta for this change:

- Update Context Engine render semantics so it requests `CapabilityCatalog.listAvailable(..., modelInvocable: true)`, partitions visible capabilities by `kind`, projects provider tools from the `TOOL` subset, and renders the English Skill disclosure section from the `SKILL` subset only when the `Skill` tool remains visible for that step.
- Add `RuntimeCapabilityResolveRequest`, `RuntimeCapabilityResolver`, and `CapabilityInvocationRuntimeContext` in `agent-contracts/capability`; extend invocation runtime plumbing so Skill Tool target resolution uses `CapabilityInvocationRuntimeContext.capabilityResolver` rather than ContextAssembly `visibleCapabilities`.
- Keep model/modelOptions patch validation on the existing Context Engine / model selection governance boundary before later model steps; Skill tool and Agent Core continue to emit/store requested patch state only.
- Add `Skill` wrapper tool descriptor and Tool implementation in `agent-capability` under the existing builtin `TOOL` registration/execution path; Agent Core continues to invoke only the model-called `Skill` capability through `CapabilityInvocationPort`.
- Add implementation-local `SkillDocumentService` in `agent-capability` as the single `SKILL.md` format owner.
- Add implementation-local `SkillSourceDiscovery` ability surface, implemented by the existing builtin and local Skill discovery/source classes.
- Add an implementation-local catalog query for looking up the registered Skill source/discovery by `providerId`.
- Return inline visible acknowledgement through `CapabilityInvocationResult.structuredPayload={ name, status: "loaded" }`, plus hidden `generatedMessages`.
- Return safe `SKILL_CONTEXT_UNSUPPORTED` when resolved Skill metadata declares `context=fork`.
- Map `SkillMetadata.allowedTools` to `CapabilityContextPatch.allowedTools` and `SkillMetadata.deniedTools` to `CapabilityContextPatch.deniedTools`; Context Engine applies `deniedTools` as final model-visible `TOOL` exclusion.
- Move generated-message budget enforcement to next-turn Context Engine assembly/render: preserve the existing tool-loop save-then-next-turn sequence, protect the latest activated Skill generated message during compression, compress older context first, and safe-fail before the next model invocation on budget exhaustion.
- Add tests proving no parallel parser, no nested target `CapabilityInvocationPort` invocation, and no task/agent tool forwarding.

## Compatibility Impact

- Model-visible behavior changes by introducing `Skill({ name, args? })`; the model input surface is governed Skill selection plus target Skill task data.
- `name` is a governed visible Skill name equal to Skill `capabilityId` / manifest `name`.
- Inline success visible result is fixed to `{ name, status: "loaded" }`; Skill body is hidden request-local context only.
- `context=fork` returns safe `SKILL_CONTEXT_UNSUPPORTED` in this change; actual fork execution remains defined by `add-ts-fork-skill-execution`.
- `SkillMetadata.allowedTools` may affect request-local capability activation through `CapabilityContextPatch.allowedTools`; `SkillMetadata.deniedTools` may affect request-local model-visible Tool exclusion through `CapabilityContextPatch.deniedTools`.
- No Web API DTO or stream event is added by this change.
- Logs/audit/metrics remain limited to safe facts.

## DFX

- Security: target resolution must use trusted agent/owner scope.
- Reliability: timeout and AbortSignal required; timeout is controlled by ToolExecutor/runtime policy; first release returns terminal model-facing Skill outcomes.
- Observability: log only tool id, safe reason code, duration and target safe id.
- Testability: unavailable Skill, path-like `name`, oversized args, timeout, redaction and single tool_result negative cases.

## 质量属性设计（Quality Attributes）

| 质量属性 | 设计结论 | 验证入口 |
|---|---|---|
| 安全 | target resolution 必须使用 trusted agent/owner scope；模型/日志/result 表面仅承载 governed ids、safe descriptions 和 safe result fields | security test: scope override rejection; safe surface assertion |
| 性能/容量 | timeout 和 AbortSignal 必须支持；模型输入表面限于 Skill selection 和 target task data；args 大小和 inline body 大小受限 | unit test: timeout boundary; contract test: args/body size enforcement |
| 可靠性/恢复 | Skill tool execution 失败返回 safe structured error（INVALID_INPUT / SKILL_NOT_AVAILABLE / SCOPE_MISMATCH / TIMEOUT / ABORTED / EXECUTION_FAILED）；abort/cancel 以 terminal `FAILED` + `safeError.code=ABORTED` 返回；pending/running/interrupted tool_use 必须 settlement 为一个 terminal tool_result | contract test: error response format; integration test: timeout and abort propagation |
| 可维护性 | `Skill` tool 是模型侧 Skill 执行入口；inline 在该 Tool 实现内完成；`fork` 在本 change 中以 safe unsupported settlement 返回；同一次 wrapper invocation 产出唯一 authoritative result | architecture test: ownership boundary assertion |
| 可测试性 | unavailable Skill、path-like name、oversized args、timeout 和 redaction negative cases 均可独立验证 | unit test + contract test + integration test |
| 审计/可追溯性 | 日志只记录 tool id、safe reason code、duration 和 target safe id | observability test: safe log format |

## 验证映射（Verification Map）

| 约束 | Task | 验证入口 |
|---|---|---|
| input schema 验证 | T1.1 / T1.2 | `packages/agent-capability/tests/skill-tool-input-validation.test.ts` |
| args JSON size/depth/governance-field boundary | T2.1 / T5.10 | unit test: args validation boundary |
| name 作为 target Skill name 解析，并映射到 governed Skill id/descriptor；name 等于 Skill capabilityId / manifest name | T2.2 | integration test: skill capability resolution |
| target 通过 `RuntimeCapabilityResolver.resolveCapability(...)` 和 governed availability resolve | T2.2 | integration test: governed resolver enforcement |
| invocation-time body loading 通过 source/discovery 的 `loadCanonicalBodyView(...)` 调用 `SkillDocumentService`，且 descriptor/body source identity 一致 | T2.9 / T2.10 | integration test: deferred body loading consistency |
| `modelInvocable` 只控制模型披露资格，不控制 Skill Tool target resolve | T2.3 | contract test: modelInvocable disclosure-only behavior |
| owner scope 和 trusted agent scope 验证 | T2.2 / T5.1 | security test: scope override rejection |
| path-like name 拒绝 | T5.1 | negative test: path injection rejection |
| oversized inline body 拒绝 | T3.6 / T5.4 | unit test: inline body budget boundary |
| 最新激活 Skill message 在下一轮组装时受保护，超预算时先压缩旧上下文，仍无法组装则在下一次 model invoke 前 safe-fail | T3.11 / T5.4 | contract test: protected generated message budget enforcement |
| `Skill` Tool 实现根据受治理 metadata 只执行 inline，`fork` 返回 `SKILL_CONTEXT_UNSUPPORTED`，模型不选择模式 | T2.4 | contract test: context dispatch ownership |
| Skill tool 不产生第二个 public invocation envelope | T2.6 / T3.3 / T5.2 | architecture test: no nested CapabilityInvocationPort call for target Skill |
| timeout 和 AbortSignal 传播 | T2.8 | integration test: timeout and abort propagation |
| 原始 Skill tool_use 只产生一个 tool_result | T3.1 / T3.2 | contract test: single tool_result correlation |
| inline 可见 result 通过 structuredPayload 使用固定 `name/status=loaded` safe acknowledgement shape | T3.5 | contract test: inline result field shape |
| `context=fork` 返回安全 `SKILL_CONTEXT_UNSUPPORTED`，且不创建第二个 tool_result | T2.4 / T5.6 | contract test: unsupported fork context |
| `SkillMetadata.allowedTools` / `deniedTools` 映射到 `CapabilityContextPatch`；Context Engine 在 allowedTools 激活后应用 deniedTools 最终 TOOL 排除 | T3.7 / T3.10c / T5.5 / T5.12c | unit test: allowedTools activation and deniedTools final exclusion |
| pending/running/interrupted Skill tool_use 必须生成 safe terminal tool_result | T3.8 | resilience test: tool_result settlement |
| 可见 Skill 列表表面限定为 governed Skill names 和 safe descriptions | T3.9 | security test: disclosure boundary |
| Context Engine 按 `kind` 分流 `TOOL`/`SKILL`，并用英文固定模板渲染 Skill 清单 | T3.10 / T5.12 | unit test: render partition and disclosure format |
| 模型/日志/result 表面限定为 safe facts 和 governed refs | T5.1 / T5.4 / T5.8 / T5.9 | security test: safe surface scan |
| observability 日志只含 tool id、safe reason code、duration、target safe id | T5.11 | observability test: log format assertion |

## 文档承载决策（Documentation Ownership）

- 行为契约：`openspec/specs/skill-tool/spec.md`（新增）
- 模块设计：`openspec/designs/modules/agent-capability.md`（修改：补充 Skill tool 入口）
- 跨模块设计：`openspec/designs/architecture/skill-invocation-and-disclosure.md`（修改：补充 Skill tool 与 Skill invocation boundary 的关系）
- 导航：`openspec/designs/spec-to-design-map.md`（更新）

## 风险与取舍（Risks / Trade-offs）

- [风险] Skill tool 被用作 path traversal 入口。-> 严格验证 name 格式，拒绝 path-like 输入。
- [风险] oversized args 导致 Skill invocation 失败或资源耗尽。-> 强制 args 大小限制。
- [风险] wrapper result 与 Skill 执行效果分裂，破坏模型 tool call 闭环。-> Skill tool execution 只返回一个模型可见 tool_result；inline generated message 和 safe unsupported-context result 都是同一个 execution result 的内部投影。
- [风险] 要求模型理解 inline/fork 并选择不同工具。-> 模式只来自受治理 Skill metadata，模型只调用 `Skill` tool。
- [风险] 模型通过 timeout/budget 参数扩大执行资源。-> Skill tool schema 限定为 governed Skill selection 和 target task data；ToolExecutor/runtime policy 计算有效 timeout。
- [风险] Skill tool 提前做 tool/model patch 授权，越过既有上下文治理边界。-> Skill tool 只返回 requested context patch；Agent Core 只保存 request-local patch，Context Engine / model selection governance 统一校验和应用。
- [风险] 用户显式 Skill 入口和模型 Skill tool 入口混淆。-> `modelInvocable` 是模型披露资格，不是执行授权；`userInvocable` 只适用于可信 channel/core 显式入口，且仍需治理。
- [风险] 直接暴露 source location 让模型拼 raw path 访问资源。-> 当前 change 的模型/日志/result 表面限定为 governed ids、safe descriptions 和 safe result fields；Skill resource access 另行定义 scoped resource refs 和 read boundary。
- [取舍] 首版采用 terminal model-facing Skill outcomes。-> inline body loading 可以实现层 async，但 Agent Core 必须等待 terminal outcome、timeout 或 cancellation 后返回 tool_result；后台 pending/resume 由后续 change 定义。

## 归档前更新基线（Baseline Promotion Plan）

- 新增 `openspec/specs/skill-tool/spec.md`：工具黑盒规格、输入输出 schema、错误码、单 tool_result 闭环
- 更新 `openspec/designs/modules/agent-capability.md`：补充 `Skill` Tool implementation、target resolution、context dispatch、SkillDocumentService 和 inline execution 边界
- 更新 `openspec/designs/architecture/skill-invocation-and-disclosure.md`：补充 `Skill` Tool implementation 与 inline Skill disclosure 的关系
- 更新 `openspec/designs/spec-to-design-map.md`：新增导航
