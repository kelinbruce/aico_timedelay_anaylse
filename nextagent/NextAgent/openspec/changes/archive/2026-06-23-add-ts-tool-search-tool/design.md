## 目标和边界

`ToolSearch` 是查询型 Tool entry，只搜索当前 run 已治理、已授权、可安全披露的候选工具 metadata。它不拥有 source discovery、安装、冲突解析或可见性授权。

## 黑盒输入输出

Input schema:

```text
{ query: string, limit?: integer > 0 }
```

Success output schema:

```text
{ tools: { capability_id: string, name: string, description?: string }[], truncated: boolean }
```

Failure reason codes: `INVALID_INPUT`, `SEARCH_UNAVAILABLE`, `SCOPE_MISMATCH`, `EXECUTION_FAILED`.

## 核心流程

1. Validate query and limit.
2. Resolve current-run governed tool projection from trusted runtime/capability context.
3. Search only safe metadata fields.
4. Filter by current Agent visibility and owner scope.
5. Return relevance-ranked stable bounded results.
6. Add returned Tool IDs to request-local allowed Tool context so the next model invocation may receive the bounded activated Tool schemas in addition to the unchanged pre-existing Tool Calling set.

## Search-first tool disclosure

When trusted app configuration sets `adnclaw.system.capability-disclosure.tool-disclosure-mode=tool-search` and `ToolSearch` is available, model input rendering exposes `ToolSearch` while preserving the existing governed model Tool Calling set. The default `list` mode preserves the existing governed non-ToolSearch Tool schema disclosure behavior and does not expose the new `ToolSearch` Tool Calling entry unless a trusted ToolSearch-based disclosure mode needs it.

- In ToolSearch disclosure mode, `ToolSearch` is added without removing, reordering, or rewriting any pre-existing model-visible Tool Calling entry.
- In default list mode, `ToolSearch` availability alone does not add `ToolSearch` to the model Tool Calling set.
- Existing non-bootstrap Tool schemas remain governed by their normal catalog visibility and disclosure behavior; ToolSearch mode itself is not a pruning rule.
- `ToolSearch` still searches the full current-run governed Tool projection through the trusted runtime resolver.
- Returned Tool IDs become request-local `allowedTools`; the next context assembly may add those bounded Tools to the unchanged pre-existing model-visible schema set.

## Skill descriptor disclosure mode

App composition owns `adnclaw.system.capability-disclosure.skill-disclosure-mode`:

- `list` (default): preserve existing Skill behavior. Visible model-invocable Skill descriptors are rendered in the system prompt, and `ToolSearch` searches only Tool metadata.
- `tool-search`: omit the full Skill descriptor list from the system prompt, but render a lightweight `<available-deferred-skills>` block containing only visible deferred Skill IDs. `ToolSearch` may search both governed visible Tool and Skill metadata and return bounded safe descriptions. Tool results still populate request-local `allowedTools`; Skill results are discovery hints only and must be loaded through the existing `Skill` tool.

The mode is frozen at app composition time and passed to `agent-context-engine` and `agent-core` as trusted dependencies. Client request body, model output, Skill manifest metadata, and capability arguments cannot override it.

## Capability disclosure policy and discovery state

Capability descriptors may carry optional trusted disclosure policy metadata:

- `EAGER`: disclose/load without a prior search gate.
- `DEFERRED`: omit from initial descriptor listing and require ToolSearch discovery before loading or default model tool disclosure.
- `HIDDEN`: do not disclose through prompt rendering or ToolSearch.

The app-level Skill disclosure mode supplies the default for Skills without a descriptor policy: `list` defaults to `EAGER`, while `tool-search` defaults to `DEFERRED`. Descriptor policy is additive trusted metadata for exceptions such as always-load Skills. This disclosure mode is distinct from `CapabilityDiscoveryMode.SEARCH`, which remains the provider/catalog discovery lifecycle state. The built-in local editing/execution Tools (`Read`, `Write`, `Glob`, `Grep`, `Bash`, `python`, and `Edit`) remain non-lazy default Tool Calling entries. ToolSearch scenarios must not mutate pre-existing Tool Calling entries; large external/custom Tool catalogs that need lazy disclosure must opt into their own deferred disclosure policy, such as CLIP `clipc-disclosure-mode=tool-search`.

`ToolSearch` writes returned Skill IDs to request-local `discoveredSkills` context, separate from `allowedTools`. `allowedTools` activates bounded Tool schemas; `discoveredSkills` authorizes ToolSearch-deferred Skill loading through the existing `Skill` tool. The state is request-local and assembled by `agent-core`, matching the existing ToolSearch activation lifecycle and avoiding durable persistence ownership changes.

Safe `searchHint` metadata can improve matching, but it is never rendered as source/private metadata and never expands the result payload beyond safe metadata fields.

## DFX

- Security: no provider-private refs, raw schemas with secrets, credentials, file paths or hidden source metadata.
- Capacity: default result limit `20`, maximum `100`.
- Observability: log only safe reason code, duration and result count.
- Testability: unauthorized tool not returned, unknown source not scanned, limit/truncation and stable sorting.

## 质量属性设计（Quality Attributes）

| 质量属性 | 设计结论 | 验证入口 |
|---|---|---|
| 安全 | 只搜索当前 run 已治理、已授权、可安全披露的候选工具 metadata；不暴露 provider-private refs、raw schemas with secrets、credentials、file paths 或 hidden source metadata | security test: unauthorized tool not returned; negative test: no secret leakage |
| 性能/容量 | 默认结果限制 20，最大 100；搜索只扫描 safe metadata 字段，不加载完整 descriptor 内容 | unit test: limit enforcement; integration test: truncation behavior |
| 可靠性/恢复 | 搜索失败返回 safe structured error（INVALID_INPUT / SEARCH_UNAVAILABLE / SCOPE_MISMATCH / EXECUTION_FAILED）；不静默返回空结果伪装成功 | contract test: error response format; integration test: catalog unavailable fallback |
| 可维护性 | ToolSearch 是查询型 tool，不拥有 source discovery、安装、冲突解析或可见性授权 | architecture test: no ownership boundary violation |
| 可测试性 | 未授权工具不返回、未知 source 不扫描、limit/truncation 和稳定排序可独立验证 | unit test + contract test + integration test |
| 审计/可追溯性 | 日志只记录 safe reason code、duration 和 result count；不记录 query content 或 result details | observability test: safe log format |

## 验证映射（Verification Map）

| 约束 | Task | 验证入口 |
|---|---|---|
| query 参数验证（非空、长度限制） | T1.1 | `packages/agent-capability/tests/tool-search-input-validation.test.ts` |
| 结果数量限制（默认 20，最大 100） | T2.1 | unit test: limit boundary |
| 只搜索安全 metadata 字段 | T3.1 | contract test: search field whitelist |
| 当前 Agent 可见性过滤 | T4.1 | integration test: agent-scope filtering |
| owner scope 隔离 | T5.1 | security test: cross-owner rejection |
| 未授权工具不返回 | T6.1 | negative test: unauthorized tool excluded |
| 稳定排序（相关性 + 字母序） | T7.1 | unit test: sort stability |
| catalog 不可用时返回 SEARCH_UNAVAILABLE | T8.1 | integration test: catalog failure fallback |
| 不暴露 provider-private refs 或 credentials | T9.1 | security test: secret leakage scan |
| observability 日志只含 safe reason code、duration、result count | T10.1 | observability test: log format assertion |

## 文档承载决策（Documentation Ownership）

- 行为契约：`openspec/specs/tool-search-tool/spec.md`（新增）
- 模块设计：`openspec/designs/modules/agent-capability.md`（修改：补充 ToolSearch 能力）
- 跨模块设计：`openspec/designs/architecture/capability-discovery-and-governance.md`（修改：补充查询型 tool 边界）
- 导航：`openspec/designs/spec-to-design-map.md`（更新）

## 风险与取舍（Risks / Trade-offs）

- [风险] 搜索范围过大导致性能问题。-> 强制 limit 限制（默认 20，最大 100）和 safe metadata 字段白名单。
- [风险] 元数据泄露敏感信息。-> 字段白名单过滤 + redaction policy；不暴露 provider-private refs、credentials 或 file paths。
- [取舍] 不支持模糊搜索或语义搜索。-> 首版 KISS，使用 keyword match + stable sort；后续可扩展为语义搜索。

## 归档前更新基线（Baseline Promotion Plan）

- 新增 `openspec/specs/tool-search-tool/spec.md`：工具黑盒规格、输入输出 schema、错误码、limit 规则
- 更新 `openspec/designs/modules/agent-capability.md`：补充 ToolSearch 查询能力边界
- 更新 `openspec/designs/architecture/capability-discovery-and-governance.md`：补充查询型 tool 与 discovery/governance 的关系
- 更新 `openspec/designs/spec-to-design-map.md`：新增导航
