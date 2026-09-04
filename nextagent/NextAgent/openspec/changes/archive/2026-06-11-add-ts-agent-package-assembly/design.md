## 背景和现状（Context）

当前主干已经有稳定约束，但 package assembly 的规范性事实分散在多个长期文档中：

- `ts-core-contracts` 冻结了 `AgentAssembly` / `AgentAssemblyRegistry` 的 runtime-facing contract
- `ts-minimal-agent-kernel` 冻结了启动期 compile、acceptance lookup 和 accepted run freeze
- `capability-catalog` 冻结了 `capabilityBindings` 只是 binding facts、不是 descriptor discovery 快照

这让系统虽然“局部有规则”，但缺少一份独立 change 回答下面这些问题：

- app composition 选中的 package root 到 runtime-ready assembly 的唯一路径是什么
- `agent.yaml`、`skills/`、`subagents/`、`prompts/` 和 provider/source 候选的权威边界是什么
- assembly compiler 到哪里为止，capability catalog 从哪里开始接手
- 哪些失败是 package assembly fail-closed，哪些只是 assembly-level degradation

主干当前实现还存在一个明确的 implementation-vs-spec gap：`packages/agent-app/src/assembly/agent-assembly-compiler.ts` 目前会要求 capability descriptor 在 assembly compile 前就已经存在且唯一，而稳定 `capability-catalog` spec 已明确要求 assembly compilation MUST NOT 依赖 descriptor pre-discovery。该 gap 说明 package assembly 需要一个独立 change 来重新收敛实现路径。

同时，本 change 必须保持与两个冻结基线一致：

- `establish-ts-backend-architecture`：`agent-app` 是唯一 composition root，package 读取和 assembly compile 不得下沉到 runtime/core/context/capability。
- `establish-ts-core-contracts`：`AgentAssembly` 字段集合、`AgentAssemblyRegistry.active/require` 语义，以及 runtime-facing `capabilityBindings` 的冻结含义不得被本 change 重定义。

## 目标和非目标（Goals / Non-Goals）

**目标：**

- 为 Agent package assembly 建立独立 capability 和审查边界
- 固化从 package root 到 runtime-ready `AgentAssemblyRegistry` 的唯一实现路径
- 收敛 assembly compiler 与 capability catalog 的职责分界
- 明确 compile-time 权威输入、失败收敛和 request-path no-reparse 约束
- 给后续实现和 review 提供单独验证入口，而不再把 package assembly 混入最小内核或产品入口治理

**非目标：**

- 不定义产品入口选择策略
- 不定义 default-agent 文件布局或 release-packaging 同步
- 不定义 capability discovery、availability、conflict resolution 或 invocation 语义
- 不定义 persistent assembly store、hot reload、lazy compile 或后台 refresh
- 不定义统一 health/readiness contract，只定义 assembly compile diagnostics 边界

## 设计决策（Decisions）

### D1. package assembly 只处理“已选中的 package root 如何编译”

唯一 owner 是 `agent-app`。外层 app composition 先决定哪些 package root 参与本次启动；package assembly 只负责对这些 root 执行 parse、validate、compile 和 registry publication。

选中 package root 的策略不属于本 change。这样可以把 package assembly 从“产品入口治理”里拆出来，避免 scope 膨胀。

### D2. `agent.yaml` 是唯一权威业务装配输入

一个 package root 的 runtime-facing assembly 只由其 `agent.yaml` 主导。`skills/`、`subagents/`、`prompts/` 和 provider/source 只提供候选事实，不得直接成为 runtime-facing assembly，也不得在 request path 临时接管装配权。

### D3. assembly compiler 只做 compile-time 校验和 runtime-facing 结果生成

选定的唯一实现路径如下：

1. app composition 交给 assembly compile 一个已选中的 package root
2. loader/parser 读取并解析 `agent.yaml`
3. compiler 校验 identity/version/workspace/runtime settings
4. compiler 校验 required model/prompt/provider/resource 引用是否存在且安全
5. compiler 生成只包含冻结 contract 最小字段集的 runtime-facing `AgentAssembly`，其中包含 `agentAssemblyRef`
6. compiler 发布 `AgentAssemblyRegistry`
7. 失败写入 assembly compile diagnostics

这里明确放弃一个备选方案：让 assembly compiler 直接要求 capability descriptor 已发现、已 AVAILABLE 且无冲突。放弃原因是它与稳定的 `capability-catalog` contract 冲突，并且会让 `agent-app` 越界拥有 discovery / executability 判断。

### D4. capability binding 与 catalog visibility 必须分层

唯一边界如下：

- assembly compiler：校验 binding shape、安全 id、capability type、registered provider id，并只保留冻结 contract 允许进入 runtime-facing assembly 的 enabled bindings
- capability catalog：负责 default enablement、descriptor existence、availability、search result merge、conflict resolution 和 executable visibility

因此：

- compiler 不要求 descriptor pre-discovery
- compiler 不把 explicit disable fact 写入 runtime-facing `AgentAssembly.capabilityBindings`
- compiler 不为 framework-default builtin 或 default-enabled trusted provider 写 synthetic enabled binding
- catalog 也不得回写 assembly

这里明确不采用“把 disabled fact 也保留在 `AgentAssembly.capabilityBindings`”这个方案。本 change 采取的路径是：从 AgentCapabilityBinding 契约中删除 nabled?: boolean 字段。compiler 在 compile 时丢弃 nabled=false 的 binding，catalog 不再需要维护 disabledKeys 或按 inding.enabled 过滤——AgentAssembly.capabilityBindings 数组中的每一条 binding 天然就是 enabled。这同时也消除了原先“同一决策被 compiler 和 catalog 各执行一次”的冗余。

### D5. request path 只能消费 compiled registry 或 accepted assembly facts

启动期 compile 完成后，runtime acceptance 只走 `active(agentId)`；accepted request、recovery、core、context 和 capability routing 只走 `require(agentId, agentVersion)` 或 runtime 注入的 accepted assembly facts。任何 request path package reparse 都视为边界逃逸。
`agentAssemblyRef` 继续同时承担两层语义：一方面作为 runtime-facing `AgentAssembly` 的冻结执行坐标字段，另一方面在 accepted request state / runtime lookup 中被持久化和消费。

### D6. 失败在 package assembly 边界显式收敛

选定的失败模型只有两类：

- fail-closed：权威输入缺失、identity/version/workspace 非法、required reference 缺失、required assembly compile failure、registry active lookup 缺失
- safe unavailable：非关键且未被显式 binding 消费的候选输入失效，但权威 assembly 仍然合法

这样既满足可靠性和可诊断性，又不把统一 readiness/health contract 也吸入本 change。

## 质量属性设计（Quality Attributes）

| 质量属性 | 设计结论 | 验证入口 |
|---|---|---|
| 安全 | package 输入只在 `agent-app` 启动期读取；workspace、resource path 和 safe id 必须在 compile-time 校验；request path 不得重读 package 输入 | `tests/agent-kernel/config-assembly.test.ts` 的 workspace/path negative cases；code review 检查 request-path no-reparse |
| 性能/容量 | 只允许启动期同步 compile，不引入 request-time parse、background refresh 或 descriptor eager pre-discovery 依赖，避免把 package 解析成本带入主路径 | startup characterization tests；code review 检查 compile 仅在 composition 发生 |
| 可靠性/恢复 | accepted request 只消费冻结 assembly；missing assembly 不得 fallback；package assembly failure 只在 fail-closed / degraded 两类结果中收敛 | runtime acceptance / recovery negative tests；`tests/agent-kernel/config-assembly.test.ts` |
| 可维护性 | package selection 与 package compile 拆分；assembly compiler 与 catalog 分层；独立 capability 避免继续把规则散落在最小内核与 capability catalog 文档里 | OpenSpec review；`npm run lint:architecture`；文档归档时的 spec-to-design-map 同步 |
| 可测试性 | compile 顺序、workspace/path、missing refs、request-path no-reparse 和 missing assembly 都能写成 black-box characterization tests | `npm test -- tests/agent-kernel/config-assembly.test.ts` |
| 审计/可追溯性 | 本 change 只定义 safe assembly compile diagnostics，不定义统一 readiness/health contract；diagnostics 只记录安全原因，不暴露 raw path/secret/content | diagnostics characterization tests；code review 检查 safe messages |

## 验证映射（Verification Map）

| 约束 | Task | 验证入口 |
|---|---|---|
| 启动期 compile 且 request path 不重解析 package 输入 | 2.1, 2.4 | `tests/agent-kernel/config-assembly.test.ts`; code review 检查 `create-app.ts`、runtime/core/context 不直接读 package |
| `agent.yaml` 权威输入与固定 compile 顺序 | 1.1, 2.1 | change spec review；compiler characterization tests |
| runtime-facing `AgentAssembly` 只保留最小字段 | 2.2 | compiler tests；contract assertions |
| compiler 不依赖 descriptor pre-discovery | 2.3 | `tests/agent-kernel/config-assembly.test.ts` negative/positive cases |
| `active/require` lookup 冻结语义 | 2.4 | runtime acceptance / recovery tests；contract tests |
| workspace/path 和 required refs compile-time 校验 | 2.2 | `tests/agent-kernel/config-assembly.test.ts` negative cases |
| fail-closed / safe-unavailable 显式收敛 | 2.5 | assembly failure/degradation tests |
| 全量非回归 | 3.1 | `npm run build`, `npm test`, `npm run test:contract`, `npm run lint:architecture`, `openspec validate --all --strict` |

## 文档承载决策（Documentation Ownership）

- 行为契约：`openspec/specs/agent-package-assembly/spec.md`
- 架构和跨模块设计：`openspec/designs/architecture/core-contracts.md` 承载 registry lookup 边界；`openspec/designs/architecture/configuration-boundary.md` 承载 package root selection 是 app-composition 前置条件
- 模块设计：`openspec/designs/modules/agent-app.md`
- ADR：无
- 导航：`openspec/designs/spec-to-design-map.md`

同一事实的主承载约束如下：

- runtime-facing assembly lookup 语义仍由 core contracts / runtime boundaries 主承载
- package assembly compile 边界由本 capability 主承载
- capability visibility / executability 仍由 capability catalog 主承载
- `AgentAssembly` 字段集合与 `capabilityBindings` 的冻结含义继续由 core contracts 主承载；本 change 不重定义这些 contract

## 风险与取舍（Risks / Trade-offs）

- [风险] 主干实现目前要求 descriptor pre-discovery，和稳定 capability-catalog 约束冲突 -> 缓解方式：本 change 把该 gap 显式记录，并在任务中要求收敛 compiler 边界
- [风险] `ts-minimal-agent-kernel` 仍含部分 package assembly 细节 -> 缓解方式：归档前把长期事实迁移到独立 `agent-package-assembly` capability，并在 `spec-to-design-map` 建立导航
- [取舍] 本 change 不处理产品入口选择 -> 好处是边界清楚；代价是产品入口治理仍由外层规格继续主承载

## 迁移计划（Migration Plan）

无。该 change 以规格收敛和实现边界修正为主，不要求引入数据迁移或发布期回滚脚本。

## 归档前更新基线（Baseline Promotion Plan）

- `openspec/specs/agent-package-assembly/spec.md`：保留 package assembly 的可验证行为契约
- `openspec/overview.md`：补充为什么 package assembly 需要独立 capability 的长期背景
- `openspec/designs/architecture/core-contracts.md`：如需补充 assembly compile capability 的导航则更新
- `openspec/designs/architecture/configuration-boundary.md`：如需补充 package root selection 是前置条件则更新
- `openspec/designs/modules/agent-app.md`：补充 `agent-app` 对 package assembly、registry 和 diagnostics 的职责
- `openspec/designs/spec-to-design-map.md`：增加 capability 到 architecture/modules/verification 的导航

## 待确认问题（Open Questions）

无。当前 change 的唯一实现路径已经收敛为“app composition 选中 package root -> `agent-app` 启动期 compile -> 发布 runtime-ready registry -> request path 只消费 compiled assembly facts”。
