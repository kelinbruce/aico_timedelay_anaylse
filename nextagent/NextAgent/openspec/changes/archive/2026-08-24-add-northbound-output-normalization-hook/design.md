## 设计范围

| Function | 本次目标变化 | 涉及 delta specs | 设计章节 |
|---|---|---|---|
| `FN-10.1 注册和执行钩子` | 结果后 Hook 可基于已完成 Bash 调用的有效输入选择性返回 northbound action 结构化结果 | `lifecycle-hook-execution` | `FN-10.1 注册和执行钩子` |

## `FN-10.1 注册和执行钩子`

### 目标与规范依据

本设计满足 proposal 中“仅在 Bash 的有效 `command` 或 `args` 包含插件配置的 `matchText` 时，于执行完成后原样返回结构化结果”的黑盒目标。实现必须保持 lifecycle stage owner、Capability executor、Hook result validation、timeline 和 terminal snapshot 的既有单一路径。

#### 本 Function 的目标 Requirements

canonical spec：`lifecycle-hook-execution`

- `ADDED`：`Capability 结果后边界提供同次调用的有效输入`
- `ADDED`：`Northbound output normalization Hook 仅匹配目标 Bash action`
- `ADDED`：`Northbound Hook 原样返回已批准的 Bash 结构化结果`
- `ADDED`：`Northbound Hook 作为未激活插件资产随本地运行包交付`

### 当前实现

- `agent-contracts/runtime` 的 `CapabilityInvokeBoundary` 已提供 `capabilityId`、`capabilityKind`、`providerKind`、`toolCallId`、`arguments?` 和 `timeoutMs?`；`CapabilityResultBoundary` 只提供 `capabilityId`、invocation id、status、safe summary、counts、`structuredPayload?`、`generatedMessages?` 和 `contextPatch?`。
- `agent-core` tool loop 在 `BEFORE_CAPABILITY_INVOKE` 后生成 `effectiveArguments`，使用它构造 `CapabilityInvocationRequest.arguments` 并调用 executor；调用返回且 envelope 合法后，在同一栈帧组装 `AFTER_CAPABILITY_RESULT` boundary，但当前没有把 `effectiveArguments` 放入该 boundary。
- runtime stage executor 当前把同一个 stage boundary 引用交给同组 Hook；没有对 `AFTER_CAPABILITY_RESULT.arguments` 建立逐 invocation detached copy。`AFTER_CAPABILITY_RESULT` 的 mutation 白名单仍只有结果相关字段。
- `HookResult.resultSummary` 已由公共 runtime contract、runtime validation、单条 `HOOK_INVOKED` 和 terminal `hookResults` 快照组成单一路径，合法 JSON object 按 JSON 语义直接复制，非法或超限结果整体失败。
- `agent-plugin-sdk` 已用独立 subpath 交付 `developer-hook-trace`、`context-monitor` 和 `agent-router-plugin` 等开发者资产；现有 Hook factory 返回 startup-composed `NextAgentPlugin`，测试可通过 `agent-test-kit` harness 直接执行 Hook。
- 当前没有 `northbound-output-normalization-hook`，也没有结果后 Hook 跨阶段取得有效 Capability 输入的合法方式。

### GAP 分析

| 规范目标 | 当前事实 | GAP |
|---|---|---|
| 结果后 boundary 提供同次调用的有效输入 | tool loop 仍持有 `effectiveArguments`，但 `CapabilityResultBoundary` 不暴露 | 公共 stage contract 与 boundary 组装缺少只读 `arguments` |
| Hook 仅匹配 `Bash + matchText` | SDK 没有该 Hook；结果后 boundary 无输入 | 缺少可配置的确定性 predicate 和独立 SDK 资产 |
| 命中时原样返回结构化结果 | `resultSummary` 单一路径已存在 | 缺少受控 producer；不得新增 mapper、缓存或输出通道 |
| Hook 原地修改不影响已成立事实或其他 Hook | 当前同组 Hook 可收到同一 boundary 引用 | 必须为每个结果后 Hook invocation 隔离 `arguments`，不能只依赖 readonly TypeScript 类型 |
| 不扩大 raw Tool 输入输出权限 | Hook boundary 会被已激活 Hook 读取，resultSummary 会进入终态；developer trace Hook 另有显式诊断契约 | Runtime 不自动投影 arguments；每个 Hook 仍只能按自身已批准的结果或开发诊断契约输出 |
| backend-capable 包内可直接取得插件资产 | SDK 只有 TypeScript factory，打包流程未生成该插件目录 | 缺少静态 artifact helper 和既有 pack staging 接入 |

### 修改方案

唯一实现路径如下：

1. 在 `agent-contracts/runtime` 的 `CapabilityResultBoundary` 增加 required `arguments: JsonObject`。该字段的 trusted source 是 `agent-core` tool loop 已生成并实际写入 `CapabilityInvocationRequest.arguments` 的 `effectiveArguments`。不新增平行 input snapshot、provider 字段、tool 名称 alias 或专用 northbound boundary。
2. `agent-core` 在现有 `AFTER_CAPABILITY_RESULT` 调用点直接传入 `arguments: effectiveArguments`。字段不进入 `CapabilityResultMutation`，因此后置 Hook 不能通过 contract 返回输入替换。`agent-runtime` 在每次结果后 Hook invocation 组装 `HookInput` 时只对 `arguments` 创建 JSON 语义等价的 detached copy，使并行 observe Hook、串行 impact Hook和调用主路径不共享其嵌套引用；不复制或改写其他 stage 字段，不增加跨阶段 Map、AsyncLocalStorage、timeline lookup 或持久化关联。
3. 在 `agent-plugin-sdk` 增加独立 `northbound-output-normalization-hook` subpath，导出常量 `northboundOutputNormalizationHookId`、factory `createNorthboundOutputNormalizationPlugin()` 和静态 artifact helper。factory 产生 API `1.0` 的无 host dependency 插件；插件只包含一个 `CUSTOM`、`TRANSFORM`、`CONTINUE` Hook，supported stage 精确为 `AFTER_CAPABILITY_RESULT`。`matchText` 由既有 `LifecycleHook.configSchema + configure(config)` 在 Agent activation materialization 时注入；未配置的基础 executable 只返回 `SKIP`，显式空字符串或仅空白值失败，不提供隐式匹配文本。
4. Hook predicate 检查 `boundary.capabilityId === "Bash"`，再检查 `arguments.command` 是否为包含该实例 `matchText` 的 string，或 `arguments.args` 是否为 array 且至少一个 string 元素包含同一 `matchText`。所有其他 shape 返回 `{ outcome: "SKIP" }`；保持区分大小写的连续子字符串语义，不做宽松 coercion、不读取其他字段。
5. predicate 命中且 `structuredPayload` 存在时返回 `{ outcome: "PASS", resultSummary: structuredPayload }`。不构造新业务对象，不修改或解析 payload。runtime 继续在既有 result validation 点创建 JSON 语义等价 detached value；SDK 不增加第二次内容处理。
6. package export map 暴露该 subpath。artifact helper 生成 `plugin.json + index.js`；既有 `scripts/pack-local-runtime.mjs` 对所有 backend-capable profile 把这两个文件写入 `config/plugins/northbound-output-normalization-hook/`。`frontend-only` 在后端 staging 前返回，因此不包含该资产。打包不修改 `nextAgent.system.plugins[]` 或 packaged Agent，调用方仍需显式声明插件并以 activation `config.matchText` 激活 Hook。

失败路径保持单一：非匹配或缺少结构化结果是合法 `SKIP`；非法/超限 `resultSummary` 由 runtime 既有 validator 判为 Hook invalid result，transform Hook 只产生观测降级且不改变已完成 Bash 调用或请求 truth。Hook 自身不执行 I/O，因此不存在新 dependency unavailable、timeout 或外部 side effect 路径。

选择直接扩展后置 boundary，是因为 tool loop 在该 stage 已拥有同次调用的有效输入和结果。跨 `BEFORE_CAPABILITY_INVOKE`/`AFTER_CAPABILITY_RESULT` 缓存会让 Hook 在执行前也被调用，并引入并发、恢复、清理与 invocation correlation 状态，不满足“仅在执行后”和 KISS。把输入复制进 Bash output 会污染 Capability 公共输出并把通用 Hook 判定需求下沉到 Tool owner，也不采用。

#### 质量属性影响

| 质量属性 | 规范依据 | 本 Function 内实现机制 | 验证关注点 |
|---|---|---|---|
| 安全 | `Capability 结果后边界提供同次调用的有效输入`、`Northbound Hook 原样返回已批准的 Bash 结构化结果` | boundary 只进入当前 Agent 已激活 Hook；Runtime 不自动投影 arguments；Hook 输出仍受自身已批准契约限制；受控 Hook 只对精确匹配调用返回当前 scope 的 payload | negative tests 证明非 Bash、非 action、其他字段命中均无结果；Runtime 自动日志/事件不新增 arguments |
| 可测试性 | `Capability 结果后边界提供同次调用的有效输入` | effectiveArguments 直接注入结果后 boundary，并为每次 Hook invocation detached；无隐式缓存或恢复状态 | contract/kernel 测试覆盖 pre-hook mutation 后的有效输入和跨 Hook nested mutation isolation |
| 审计/可追溯性 | `Northbound Hook 原样返回已批准的 Bash 结构化结果` | 复用单条 `HOOK_INVOKED` 和 terminal hookResults；不新增平行事实 | 匹配结果恰好一次、JSON 语义等价，非法/超限不产生部分结果 |

## 验证策略（Verification Strategy）

- contract tests 覆盖 `CapabilityResultBoundary.arguments` required shape、Plugin SDK 类型复用和 Hook result 的既有 JSON 边界。
- SDK unit tests 以自定义 `matchText` 的 decision-table 黑盒输入覆盖 command 命中、args 命中、同时命中、旧固定文本不命中、大小写不命中、非 Bash、非 string、其他字段命中、缺少 payload 和空白配置失败；命中结果断言 JSON 语义等价且没有 mutation/control。
- agent-core/kernel integration tests 使用真实 tool loop 证明 after boundary 得到 pre-hook mutation 后的 `effectiveArguments`，且 Hook 原地修改不改变调用或后续 Hook boundary。
- terminal snapshot integration 覆盖匹配结果恰好一次进入同一请求终态，非匹配不带 `resultSummary`，容量失败不产生部分结果且不改变请求 truth。
- packaging tests 覆盖 artifact helper 生成可加载 bundle、backend-capable candidate 目录存在、system config 与 packaged Agent 不自动声明/激活，以及 frontend-only 不进入后端 staging。
- product-path E2E 从 artifact helper 生成插件文件，经 system plugin config 加载并由 Agent activation 提供 `matchText`，再通过 HTTP 请求驱动真实 Bash Capability 生命周期；同一请求覆盖 `command` 命中、`args` 命中和不命中，并从请求终态断言仅命中结果按 JSON 语义原样进入 `HookResult.resultSummary`，同时确认有效入参不进入 timeline 自动投影。
- architecture/人工审查确认 SDK 只使用 public contract、没有跨阶段缓存、没有新日志或 public stream raw-arguments 投影，也没有自动激活。

## 长期基线刷新计划（Baseline Promotion Plan）

- `openspec/specs/lifecycle-hook-execution/spec.md`：合并四个新增 Requirements，并以归档时最新 stable 为准消解已完成前置 changes。
- `openspec/designs/functions/D10-二次开发与平台集成/D10.1-扩展与插件/FN-10.1-注册和执行钩子.md`：更新输入、输出、处理过程和 northbound Hook 关键规格。
- `openspec/designs/features/D10-二次开发与平台集成/D10.1-扩展与插件/F-10.1-扩展生命周期钩子.md`：摘要新增 northbound action 结果输出用例与安全边界。
- `openspec/overview.md`：摘要可选 northbound output normalization Hook。
- `openspec/designs/architecture/core-contracts.md`：更新 `CapabilityResultBoundary.arguments` 的 stage 语义和 `HookResult.resultSummary` 受控 producer 边界。
- `openspec/designs/architecture/runtime-boundaries.md`：更新 tool loop 组装有效输入到结果后 boundary 的流程。
- `openspec/designs/modules/agent-plugin-sdk.md`：记录 Hook identity、stage、predicate 和原样输出职责。
- `openspec/designs/modules/agent-core.md`：记录结果后 boundary 使用 `effectiveArguments`。
- `openspec/designs/adr/`：无；本 change 不引入需要独立保留的跨方案架构决策。
- `openspec/designs/spec-to-design-map.md`：补充 lifecycle Hook spec 到 SDK/core 设计和验证入口的导航。

## 风险与取舍（Risks / Trade-offs）

- `resultSummary` 会进入 authenticated terminal stream/history，原样 Bash stdout/stderr 可能包含当前 scope 调用方不应取得的内容。缓解是只允许显式激活、精确 `Bash + matchText` 条件，并把当前 Owner/Agent Scope 可公开性责任固定给该 Hook producer；部署方不得对不满足此前提的 action 激活该 Hook。
- additive public boundary 会让所有已激活的 `AFTER_CAPABILITY_RESULT` Hook 看见有效 arguments，扩大 Hook 内部可见面。缓解是该数据不进入任何 Runtime 自动投影、为每次 Hook invocation 创建 arguments detached copy，并通过契约与 architecture negative tests 防止扩散。
- `matchText` 是字符串子串而不是路径语义，例如配置 `action.py` 时仍可能匹配 `not-action.py.bak`。这是配置契约的精确规则；实现不擅自增加路径解析或 token 语义。

## 迁移与回滚（Migration / Rollback）

实施前提是 additive `agent-contracts/runtime` refinement 获得确认，并且 `refine-ts-hook-result-event-summary`、`add-ts-terminal-hook-result-snapshot` 的代码契约保持可用。先发布 host contract/runtime/core，再发布使用新字段的 SDK Hook；旧 Hook 无需修改，因新增字段不改变其输入读取逻辑。

回滚时先停用目标 Agent 的 Hook activation，再移除 SDK Hook 资产；`CapabilityResultBoundary.arguments` 可保留为兼容字段。若必须整体回滚 public contract，则 host、core 与 SDK 必须同版本回滚；已持久化的 Hook 结果继续按既有 terminal snapshot 契约读取，不需要数据迁移。

## 待确认问题（Open Questions）

无。2026-08-12 已确认 `CapabilityResultBoundary.arguments` additive `agent-contracts/runtime` 公共契约 refinement：字段为 executor 实际使用的只读有效输入，仅提供给已激活的 `AFTER_CAPABILITY_RESULT` Hook，不自动进入日志、timeline 或公开投影。
