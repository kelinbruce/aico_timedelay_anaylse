## 背景与问题（Why）

CLIP Server 作为电信网络 API-backed Tool source 时，`clipc list` 可能返回大量运行时可用 API。当前 `clip_server` 适配路径按 eager discovery 处理：启动发现会把 CLIP API 都注册为普通 Tool，并且默认模型工具披露只依赖通用 Tool 列表治理。这个形态在小规模 API 集合中可工作，但在大规模 API 场景下会放大上下文和模型工具列表压力，也不利于验证“先搜索、再按需加载具体工具 schema”的集成模式。

Skill 懒加载已经通过 `<available-deferred-skills>`、`ToolSearch`、`<available-skills>` 和 request-local `allowedTools` 形成可验证链路。CLIP 需要同类搜索门控能力，但 CLIP 与 Skill 的差异是：ToolSearch 命中后必须把具体 CLIP API 作为普通 model tool descriptor 激活，方便模型按该 API 的 input schema 提取参数，而不能退化成一个泛化的 `clipc` 分发工具。

## 变更范围（What Changes）

- 为 CLIP-backed Tool source 增加 ToolSearch-deferred disclosure 模式。该模式下系统 prompt 默认只展示 `<available-deferred-clipc>` 候选 id，不把 CLIP API 的描述和 schema 全量拼入默认工具上下文。
- 扩展 ToolSearch 对 CLIP-backed Tool 命中的投影：命中 CLIP Tool 后返回 `<available-clipc>`，并通过既有 `CapabilityContextPatch.allowedTools` 激活具体 CLIP Tool，使下一轮模型调用可以看到普通 Tool descriptor 及 input schema。
- 增加业务集成配置开关，用于在 `list` 与 `tool-search` 模式之间选择 CLIP disclosure 行为；未配置时保持现有兼容行为。
- 构造代表性 CLIP 验证 fixture/test，覆盖 `<available-deferred-clipc>` 初始披露、ToolSearch 命中 `<available-clipc>`、以及命中后 CLIP Tool 进入模型工具列表的端到端链路。
- 不引入新的 public invocation envelope，不引入通用 `clipc` dispatch Tool，不改变 CLIP 执行仍经 sandbox/gateway runner 的安全边界。

## Capability 影响（Capabilities）

### 新增 Capability

无。

### 修改的 Capability

- `api-backed-tool-source`: 修改 CLIP Server discovery/disclosure 语义，支持 ToolSearch-deferred lazy disclosure，并要求 ToolSearch 命中后把具体 CLIP API 作为普通 Tool 激活。

## 影响范围（Impact）

- 代码：`agent-capability` 的 CLIP discovery、ToolSearch result projection；`agent-context-engine` 的 system prompt disclosure 和 model-visible tool activation；`agent-app` 的配置解析和 composition wiring。
- 配置：新增 CLIP disclosure 模式配置项，业务可选择是否对 CLIP API 走 ToolSearch 懒加载。
- 测试：新增/调整 capability unit test、context render test 和 e2e 测试，构造代表性 CLIP API 集合验证 lazy loading 场景。
- 运维与安全：CLIP API 仍使用已有 sandbox/gateway runner；ToolSearch-deferred 模式只改变 prompt/tool disclosure，不暴露 provider-private routing facts、路径、endpoint secret 或 raw CLIP payload。

## 归档前更新基线（Baseline Promotion Plan）

行为契约：
- `openspec/specs/api-backed-tool-source/spec.md`：归档时合并 CLIP ToolSearch-deferred disclosure、ToolSearch 命中 `<available-clipc>`、以及 ordinary Tool activation 的稳定行为。

长期背景：
- `openspec/overview.md`：无。

设计视图：
- `openspec/designs/architecture/capability-spi.md`：归档时补充 API-backed Tool source 与 request-local `allowedTools` 激活的协作说明。
- `openspec/designs/modules/agent-capability.md`：归档时补充 CLIP discovery mode、ToolSearch result projection 和 provider-private registry 边界。
- `openspec/designs/modules/agent-context-engine.md`：归档时补充 `<available-deferred-clipc>` / `<available-clipc>` 的 prompt shaping 责任。
- `openspec/designs/adr/<id>.md`：无。
- `openspec/designs/spec-to-design-map.md`：归档时更新 `api-backed-tool-source` 到相关 architecture/module 设计的导航。

验证入口：
- `packages/agent-capability` CLIP/ToolSearch 单元测试。
- `packages/agent-context-engine` prompt render 测试。
- `tests/e2e` CLIP ToolSearch lazy disclosure 端到端测试。

## ToolSearch Spec Ownership Note

This change includes a `tool-search-tool` spec delta for the ToolSearch-owned part of the behavior. The API-backed Tool source owns `clip_server` discovery, CLIP disclosure configuration, descriptor validation, and private runner routing. ToolSearch owns result projection for matched deferred CLIP Tools, including the `<available-clipc>` meta message and request-local `contextPatch.allowedTools` activation of the concrete ordinary Tool descriptor.
