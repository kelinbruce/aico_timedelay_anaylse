## 背景和现状（Context）

当前 `clip_server` 适配器在 `agent-capability` 中通过 `ClipBackedToolDiscovery` 做 eager discovery：runner 先列出 CLIP 候选，再逐个 `describe` 得到完整 `CapabilityDescriptor`，并把 provider-private CLIP id 与 primitive 存入 `ClipToolRegistry`。执行时 `ClipToolExecutor` 仍按普通 `CapabilityInvocationRequest.capabilityId` 进入，不让模型提供 CLIP 私有路由字段。

Context Engine 已经有 request-local `CapabilityContextPatch.allowedTools` 激活机制：ToolSearch 场景保持既有模型工具列表不变，并通过 `allowedTools` 追加命中的 Tool descriptor；ToolSearch 结果可以把命中的 Tool id 放入 `allowedTools`，下一轮模型 step 再看到具体 Tool descriptor。这个机制适合承接 CLIP 大规模 API 的默认披露收敛，同时避免 ToolSearch 模式裁剪已有预置 Tool Calling。

implementation-vs-spec gap：稳定 spec 目前写明 API-backed Tool source 使用单一 startup eager discovery。新需求要求 CLIP 可配置为 ToolSearch-deferred disclosure，因此本 change 用 active spec delta 修改该行为。

## 目标和非目标（Goals / Non-Goals）

**目标：**
- 增加 CLIP disclosure 配置开关，未配置时保持兼容的既有默认披露行为。
- 在 `tool-search` 模式下，把 CLIP-backed Tool 作为 deferred CLIP 候选在 system prompt 中以 `<available-deferred-clipc>` 只列 id。
- ToolSearch 命中 CLIP-backed Tool 后生成 `<available-clipc>` 元消息，并通过 `allowedTools` 激活具体普通 model tool descriptor。
- 构造代表性 CLIP API 的可重复测试场景，验证初始上下文不暴露未命中工具 schema，命中后只激活选中的 CLIP Tool。

**非目标：**
- 不实现 CLIP daemon 热刷新、动态 unregister、周期 sync、缓存失效或后台轮询。
- 不把 `clipc describe` 改造成真正的按 ToolSearch 命中才执行的 describe-on-select 生命周期；本 change 的懒加载边界是 prompt/model tool disclosure 懒加载。
- 不改变 `CapabilityContextPatch` 形状，不新增 CLIP 专用 invocation envelope，不新增泛化 `clipc` dispatch Tool。
- 不把真实 CLIP CLI 参数形态作为本 change 的发布迁移任务；生产 runner 仍由现有 sandbox/gateway runner 边界承载。

## 设计决策（Decisions）

1. 唯一实现路径：保留 CLIP descriptor 的现有发现、校验和 registry 注册路径；新增 CLIP disclosure mode 只改变 descriptor 的 `disclosurePolicy` 和 prompt/tool disclosure。

   - `list`：保持兼容，CLIP-backed Tool 不额外标记为 deferred，也不强制改写既有 disclosure policy。
   - `tool-search`：`ClipBackedToolDiscovery` 生成 descriptor 时写入 `disclosurePolicy.mode="DEFERRED"`，并带安全 `searchHint`；descriptor 仍是普通 `TOOL`，仍包含 input schema。
   - 放弃方案：把 CLIP provider 注册为 catalog `SEARCH` discovery 并在 ToolSearch 命中后再 `describe`。该方案需要 Context Engine 改为按 allowedTools 异步 resolve、catalog resolve 支持 provider-qualified id、以及 CLIP descriptor 缓存生命周期，范围超过本次验证目标。

2. Context Engine 保留 deferred CLIP descriptor 用于 prompt disclosure，但模型工具渲染只在 allowedTools 激活后输出该 CLIP Tool；其他预置 Tool Calling 不因 ToolSearch 场景被裁剪。

   - `applyToolSearchDisclosurePolicy` 在 ToolSearch 场景只控制 `ToolSearch` 是否进入模型工具面，不裁剪既有 Tool Calling；对 `clip_server` + `disclosurePolicy=DEFERRED` 的 CLIP descriptor 保留在 `visibleCapabilities`，供 system prompt 渲染 `<available-deferred-clipc>`。
   - `renderTools` 增加 request patch 感知：未被 `allowedTools` 激活的 deferred CLIP Tool 不输出为 model tool；被 `allowedTools` 激活后输出普通 model tool descriptor。
   - 这个选择避免新增 `ContextAssembly` 字段，也避免把 deferred CLIP 候选复制到 generated messages 或额外 side channel。

3. ToolSearch 结果对 CLIP 追加专用元消息，但继续使用现有 `contextPatch.allowedTools` 激活。

   - ToolSearch 已经搜索 governed runtime projection。CLIP Tool 命中后仍作为 `kind=TOOL` 返回。
   - 对 providerType 为 `clip_server` 或带 CLIP metadata 的结果生成 `<available-clipc>`，字段包含 `capability_id`、`name`、`kind=TOOL`、`defer_loading=true` 和安全描述。
   - `defer_loading=true` 在 CLIP 场景表示“默认披露被延迟；ToolSearch 命中后具体普通 Tool 已可由 allowedTools 激活”，不是要求模型调用一个 CLIP 加载工具。

4. 配置归属放在 `agent-app` 的 `capabilityDisclosure`。

   - 新增 `clipcDisclosureMode: "list" | "tool-search"`，原始 YAML 使用 `adnclaw.system.capability-disclosure.clipc-disclosure-mode`。
   - 未配置默认 `list`，保持兼容。
   - composition 将该模式传入 `createCapabilitySubsystem`，再传入 CLIP discovery。

5. 测试使用注入 runner 和代表性 fixture，不依赖真实 daemon。

   - `createNextAgentTestApp` 增加测试专用 provider/runner 注入入口。
   - e2e 构造多个 CLIP Tool facts，agent assembly 显式绑定这些 Tool，模型步骤先看初始 prompt/tool list，再调用 ToolSearch，最后验证下一轮工具列表只增加命中的 CLIP Tool。

## 质量属性设计（Quality Attributes）

| 质量属性 | 设计结论 | 验证入口 |
|---|---|---|
| 安全 | CLIP provider-private id、primitive、endpointRef、路径和 raw runner payload 仍留在 `ClipToolRegistry`/runner 内部；prompt 只露 capabilityId 和安全描述；不新增模型可填的 CLIP 私有路由字段。 | CLIP unit test、ToolSearch result test、e2e 中断言不出现 private id/primitive。 |
| 性能/容量 | `tool-search` 模式默认不把 CLIP Tool schema 全量放入模型工具列表；system prompt 只列 id。本 change 不承诺减少 startup describe 成本。 | context render test、CLIP e2e 检查初始 tools 不包含 CLIP schema，命中后只包含选中 Tool。 |
| 可靠性/恢复 | 未配置保持既有默认披露行为兼容；ToolSearch 未命中时不生成 `<available-clipc>`，不激活 `allowedTools`。Runner 失败仍走现有 safe diagnostic。 | config assembly test、ToolSearch no-match test、既有 CLIP failure tests。 |
| 可维护性 | 不新增 contract shape 或 CLIP 专用执行通道；复用 `disclosurePolicy`、`allowedTools` 和现有 ToolSearch。CLIP 专用判断集中在小型 helper。 | `npm run lint:architecture`、targeted unit tests、code review。 |
| 可测试性 | 测试 runner 直接构造代表性 Tool facts，e2e 无需真实 CLIP daemon 或绝对路径。 | `packages/agent-capability`、`packages/agent-context-engine`、`tests/e2e`。 |
| 审计/可追溯性 | 执行路径不变，CLIP invocation 仍通过普通 capability id、run/request context 和现有 runner；本 change 不新增 audit vocabulary。 | 代码审查确认无新 audit contract；既有 invocation tests 覆盖普通路径。 |

## 验证映射（Verification Map）

| 约束 | Task | 验证入口 |
|---|---|---|
| `tool-search` 模式初始 prompt 只显示 `<available-deferred-clipc>` id，不输出 CLIP tool schema | 2.1, 4.2 | `packages/agent-context-engine` render test、CLIP e2e |
| ToolSearch 命中 CLIP 后生成 `<available-clipc>` 并写入 `allowedTools` | 3.1, 4.1 | `packages/agent-capability` ToolSearch test |
| 命中后下一轮模型工具列表包含具体普通 CLIP Tool descriptor/inputSchema | 2.2, 4.2 | CLIP e2e |
| 未配置保持既有默认披露行为兼容 | 1.1, 4.3 | config assembly test、既有 CLIP tests |
| 不暴露 provider-private CLIP id/primitive 或泛化 dispatch Tool | 3.2, 4.1 | CLIP unit test、ToolSearch/e2e safe text assertions |

## 文档承载决策（Documentation Ownership）

- 行为契约：`openspec/specs/api-backed-tool-source/spec.md` 主承载 CLIP disclosure mode、ToolSearch 命中和普通 Tool activation 行为。
- 架构和跨模块设计：`openspec/designs/architecture/capability-spi.md` 主承载 `allowedTools` 激活与 API-backed Tool source 的协作。
- 模块设计：`openspec/designs/modules/agent-capability.md` 主承载 CLIP discovery/registry/ToolSearch projection；`openspec/designs/modules/agent-context-engine.md` 主承载 prompt shaping 和 model tool rendering。
- ADR：无。
- 导航：`openspec/designs/spec-to-design-map.md` 更新 `api-backed-tool-source` 的设计入口。

## 风险与取舍（Risks / Trade-offs）

- [风险] `tool-search` 模式仍会在 startup discovery 阶段 describe CLIP Tool。-> 本 change 明确只解决上下文和模型工具列表爆炸；describe-on-select 作为后续 discovery 生命周期变更处理。
- [风险] `<available-deferred-clipc>` 中大量 id 仍占用 prompt token。-> 后续可增加分页、top-k 或 ToolSearch 完全无 prompt id 列表模式。
- [风险] CLIP Tool 与其他 provider 的 `capabilityId` 冲突。-> 继续依赖现有 catalog conflict resolution 和 agent binding；ToolSearch/allowedTools 不绕过治理。

## 迁移计划（Migration Plan）

无数据迁移。发布后未配置系统保持 `clipcDisclosureMode=list`。需要验证懒加载的业务环境显式配置 `clipc-disclosure-mode: tool-search` 后重启应用；如发现集成问题，回滚为 `list` 即可恢复旧披露行为。

## 归档前更新基线（Baseline Promotion Plan）

- `openspec/specs/api-backed-tool-source/spec.md`：合并 CLIP ToolSearch-deferred disclosure、ToolSearch `<available-clipc>` 和 ordinary Tool activation 需求。
- `openspec/overview.md`：无。
- `openspec/designs/architecture/capability-spi.md`：补充 API-backed Tool source 复用 `allowedTools` 激活的跨模块流程。
- `openspec/designs/modules/agent-capability.md`：补充 CLIP disclosure policy 和 ToolSearch projection 的模块职责。
- `openspec/designs/modules/agent-context-engine.md`：补充 `<available-deferred-clipc>` 渲染和 deferred CLIP Tool 输出规则。
- `openspec/designs/adr/<id>.md`：无。
- `openspec/designs/spec-to-design-map.md`：补充 `api-backed-tool-source` 到上述设计文档的导航。

## 待确认问题（Open Questions）

无。
