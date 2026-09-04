# Design: Developer Hook Trace Timing

## 设计范围

| Function | 本次目标变化 | 涉及 delta specs | 设计章节 |
|---|---|---|---|
| `FN-10.1 注册和执行钩子` | 让模型结果 hook boundary 可选携带首个模型反馈耗时与模型调用端到端耗时 | `ts-core-contracts` | `FN-10.1 注册和执行钩子` |
| `FN-10.5 集成外部系统` | 让 `developer-hook-trace` 记录包含本次打印时间，并保持 lifecycle payload 只存在于 `boundary` | `developer-hook-trace-logging` | `FN-10.5 集成外部系统` |
| `FN-3.1 编写智能体配置` | 让本地运行包只从 `agents/{agentId}/agent.yaml` 提供 Agent definition | `local-runtime-package` | `FN-3.1 编写智能体配置` |

本设计补记已经落地的最小实现路径，不授权新的 Web API、stream、timeline、audit、metric、operational log 或默认插件激活行为。

## 存量 Requirement 迁移方案

| 当前 change delta | 当前 canonical Function / spec | 归档前所需原子处理 | 未触及行为处理 | 白盒落点 | stable spec 与导航影响 |
|---|---|---|---|---|---|
| `developer-hook-trace-logging` / `SDK developer hook trace logging is caller-owned` | `FN-10.5` / `plugin-developer-diagnostic-artifacts` | 该 Requirement 已被后续 change 从 stable source 迁出；归档前必须把仍有效的 `printedAt` 与单一 `boundary` payload 行为重述到当前 canonical Requirement，不能继续执行失效的 `MODIFIED` | 既有六个 hook stages、observe-only、原始 boundary 内容和统一 artifact sink 保持不变 | `agent-plugin-sdk` formatter 与生成的 plugin bundle | 保留 `developer-hook-trace-logging` 中未触及 Requirements；更新 canonical spec 与 map，不得恢复 caller-owned file sink |
| `ts-core-contracts` / `Runtime lifecycle hook boundaries expose safe execution context` | `FN-10.1` / `lifecycle-hook-execution` | 当前 stable `ts-core-contracts` 已无该同名 Requirement；归档前必须把 timing metadata 归入 lifecycle hook canonical Requirement，并移除失效的 legacy `MODIFIED` | 其他 stage boundary、mutation 和 hook authority 规则保持原位 | `agent-contracts/runtime` boundary 与 `agent-core` model loop | 保留 `ts-core-contracts`；更新 `lifecycle-hook-execution` 与直接导航 |
| `local-runtime-package` / `Packaged Agent definition has one source` | `FN-3.1` / `agent-package-assembly` | 当前 stable 已由后续基线承载 packaged Agent root 与无 config duplicate 约束；归档前必须逐条比对后删除重复 delta，或仅在 canonical Requirement 仍有缺口时形成精确 `MODIFIED` | package layout、active Agent selection、builtin fallback 和其他 package Requirements 保持不变 | local runtime pack staging 与 app-owned Agent source selection | 不新增第二个 package layout Requirement，不扩大 legacy 多 spec 映射 |

当前 active change 的三份 delta 均早于上述 stable baseline 迁移。它们可以作为实现来源证据，但在完成本表所述重定位前不得直接 archive，也不得使用 `--skip-specs`。

## `FN-10.1 注册和执行钩子`

### 目标与规范依据

模型调用成功形成 `AFTER_MODEL_RESULT` 时，hook author 可以读取安全、可选的首个模型反馈耗时和端到端耗时；没有 timing metadata 的既有 host 仍可执行生成的插件 artifact。

#### 本 Function 的目标 Requirements

canonical spec：`lifecycle-hook-execution`

- 当前 change 以 legacy `MODIFIED`：`Runtime lifecycle hook boundaries expose safe execution context` 表达目标。
- 归档前将其重定位为 canonical hook boundary Requirement 的精确 `MODIFIED`，并保留字段可选性与缺失时行为。

### 当前实现

- `agent-contracts/runtime` 的 `ModelResultBoundary` 已包含可选 `firstContentLatencyMs` 与 `modelE2ELatencyMs`。
- `agent-core` 在每轮模型调用前读取单调时钟；第一个模型 token 到达时只写入一次 `firstContentLatencyMs`，成功取得最终结果后计算 `modelE2ELatencyMs`。
- token 判定覆盖模型提供的 content、reasoning 和 tool-call feedback；不使用 trace print time 反推模型耗时。
- `AFTER_MODEL_RESULT` boundary 只在既有成功路径产生。provider SafeError 或 thrown exception 不为了 timing 补造 AFTER boundary。
- 两个字段缺失时，hook contract 和生成的 plugin artifact 仍按原有路径工作。

### GAP 分析

| 规范目标 | 当前事实 | GAP |
|---|---|---|
| 成功模型结果可提供两项安全 timing metadata | public runtime boundary 与 core model loop 已实现并有测试 | 无实现 GAP |
| 旧 host 缺少 timing metadata 时仍可执行 | 字段为 optional，plugin 只透传整个 boundary | 无兼容 GAP |
| canonical hook spec 可在归档时接收 delta | 当前 delta 仍指向已失效的 `ts-core-contracts` Requirement | 存在归档规格重定位 GAP |

### 修改方案

唯一实现路径保持为：

1. `agent-core` 作为模型调用 owner，使用单调时钟计算本轮 timing。
2. 第一个模型反馈只在本轮首次可识别 token 到达时冻结；后续 token、打印或 sink 写入不重算。
3. 成功模型结果通过现有 `invokeLifecycleHook(..., "AFTER_MODEL_RESULT", boundary, ...)` 入口携带 timing。
4. `agent-contracts/runtime` 只定义两个 optional、non-negative millisecond boundary fields；不新增平行 timing DTO、runtime command 或 app composition adapter。
5. timing 缺失保持合法；失败路径不补造 hook boundary，原有 model failure 语义保持不变。

本 Function 无新增黑盒质量目标。实现继续使用已有模型调用与 hook 路径，测试关注首次赋值、tool-call-only feedback、非负值、字段缺失和失败路径不补造 boundary。

## `FN-10.5 集成外部系统`

### 目标与规范依据

显式启用的 `developer-hook-trace` 为每条受支持 lifecycle boundary 生成可定位的本地调测记录；记录自己的打印时刻，但不把 boundary 内业务 payload 或 model timing 复制到顶层。

#### 本 Function 的目标 Requirements

canonical spec：`plugin-developer-diagnostic-artifacts`

- 当前 change 以 legacy `MODIFIED`：`SDK developer hook trace logging is caller-owned` 表达目标。
- 归档前将仍有效的 formatter 行为合并到 canonical `内置调测插件提交统一记录` Requirement。

### 当前实现

- `agent-plugin-sdk` 的 source plugin 与生成的 `index.js` artifact 使用同一 entry shape。
- formatter 在创建 entry 时生成一次 `new Date().toISOString()` 并写入 `printedAt`。
- entry 保留可信运行坐标和原始 `boundary`；model timing 仍只存在于 `boundary`。
- plugin 通过宿主提供的 `DeveloperDiagnosticArtifactSink` 提交 payload；sink 或格式化失败被 observe-only hook 隔离，hook 返回 `PASS`。
- 生成 artifact 不依赖 `agent-app` 的 timing-aware 构造参数；旧 host 传入不含 timing 的 model result boundary 时仍可执行。

### GAP 分析

| 规范目标 | 当前事实 | GAP |
|---|---|---|
| 每条 trace entry 包含 ISO-8601 print time | source formatter 与生成 artifact 均写入 `printedAt` | 无实现 GAP |
| lifecycle payload 只有一个位置 | 顶层只保留定位坐标，业务 payload 与 timing 只在 `boundary` | 无实现 GAP |
| 调测失败不改变 hook 结果 | formatter/sink failure 被隔离并返回 `PASS` | 无实现 GAP |
| canonical diagnostic artifact spec 可在归档时接收 delta | caller-owned sink Requirement 已被后续 change 迁出 stable | 存在归档规格重定位 GAP |

### 修改方案

唯一实现路径保持为：

1. source plugin 与生成 artifact 在各自 formatter 内生成 `printedAt`，不从 runtime、provider 或宿主配置接收打印时间。
2. formatter 直接保留 `input.boundary`，只把 hook/run/model/capability 的既有定位坐标投影到顶层。
3. `firstContentLatencyMs`、`modelE2ELatencyMs` 和其他 stage-owned payload 不提升到顶层；`printedAt` 不参与模型 timing 计算。
4. entry 继续通过统一 `DeveloperDiagnosticArtifactSink` 提交；插件不拥有文件路径、轮转、保留或主日志输出。
5. source plugin 与生成 artifact 的 entry shape、失败隔离和 `PASS` 结果由同一测试矩阵约束。

`printedAt` 与宿主 artifact envelope 的 `recordedAt` 属于不同 owner：前者表示插件 formatter 创建 trace entry 的时间，后者表示宿主接受物理记录的时间。两者不得互相替代或被解释为模型 latency。

#### 质量属性影响

| 质量属性 | 规范依据 | 本 Function 内实现机制 | 验证关注点 |
|---|---|---|---|
| 安全 | 无新增黑盒质量目标；沿用 developer diagnostic artifact 的输出隔离 Requirement | timing 只使用数值；不新增 prompt、provider delta、credential、secret 或 model output 顶层副本 | 顶层 forbidden fields、原始 `boundary` 位置和旧 host compatibility |
| 可靠性/恢复 | 无新增黑盒质量目标；沿用产物失败不改变受保护操作 Requirement | formatter 或 sink failure 被 observe-only hook 捕获，结果保持 `PASS` | failing sink、缺失 timing 和生成 artifact 执行 |

## `FN-3.1 编写智能体配置`

### 目标与规范依据

本地运行包只保留 `agents/{agentId}/agent.yaml` 这一份可选 Agent definition，启动期通过已验证的 system config 与 Agent root 选择 active Agent，不从 `config/default-agent.yaml` 推断或覆盖。

#### 本 Function 的目标 Requirements

canonical spec：`agent-package-assembly`

- 当前 change 以 legacy `ADDED`：`Packaged Agent definition has one source` 表达目标。
- 当前 stable baseline 已承载相同 package-root 行为；归档前只保留 canonical spec 中仍缺失的精确 delta，不重复新增 Requirement。

### 当前实现

- `scripts/pack-local-runtime.mjs` 从 builtin default Agent source 读取定义。
- pack staging 先删除 `config/default-agent.yaml`，再只写入 package resource root 下的 `agents/default-agent/agent.yaml`。
- Agent root 从已暂存并验证的 `default-system.yaml` 中解析；非法或缺失的相对目录使用既有安全 fallback。
- package startup 继续通过 app-owned config/Agent assembly path 选择 active Agent。
- 本 change 不在 packaged Agent 中默认激活 `developer-hook-trace`。

### GAP 分析

| 规范目标 | 当前事实 | GAP |
|---|---|---|
| package 只保留一份 Agent definition | staging 删除 config duplicate 并写入 Agent root | 无实现 GAP |
| active Agent 由可信 system config 与 Agent root 决定 | startup 复用 app-owned Agent source selection | 无实现 GAP |
| stable baseline 不出现重复 package Requirement | 后续 stable spec 已包含同一 package-root约束 | 存在归档 delta 去重 GAP |

### 修改方案

唯一实现路径保持为：

1. pack owner 读取 builtin source并生成 packaged Agent definition。
2. staging 在写入前显式删除旧 `config/default-agent.yaml`，避免增量打包残留。
3. target 只写入已解析 package Agent root 下的 `{agentId}/agent.yaml`。
4. startup 继续消费 frozen system config 与 app-owned Agent assembly，不增加 config-side alias、deep merge 或默认 Agent 推断。
5. packaging tests 同时断言目标存在、duplicate 不存在和 startup 使用 Agent root。

本 Function 无新增黑盒质量目标；实现不改变运行期 request lifecycle、Agent Scope 或 Owner Scope。

## 跨 Function 协作与端到端流程

`FN-10.1` 与 `FN-10.5` 共享一条已有的 hook 调测路径：

```text
agent-core model invocation
  -> AFTER_MODEL_RESULT ModelResultBoundary
  -> lifecycle hook executor
  -> developer-hook-trace formatter
  -> DeveloperDiagnosticArtifactSink
```

模型调用 owner 只计算 timing；hook contract 只携带 optional metadata；plugin formatter 只增加 `printedAt` 并保留 `boundary`；宿主 sink 只拥有物理 artifact 输出。任一后续步骤失败都不得反向改变模型结果或 hook protected operation。

`FN-3.1` 只负责 package 中 Agent definition 的唯一来源，不参与上述请求期调用链，也不隐式启用调测插件。

## 验证策略（Verification Strategy）

- contract/type validation 覆盖 optional model timing fields、non-negative millisecond value 和缺失字段兼容。
- unit/characterization tests 覆盖首个 content、reasoning 或 tool-call feedback 的首次赋值，以及完整模型调用 E2E timing。
- SDK black-box tests 覆盖 source formatter 与生成 artifact 的 `printedAt`、单一 `boundary` payload、failing sink 和无 timing boundary。
- package integration tests 覆盖 Agent root 目标存在、`config/default-agent.yaml` 不存在及 active Agent 从 Agent root 解析。
- OpenSpec strict validation覆盖 artifact graph 与 delta 格式；语义审查单独检查 current stable baseline 上的 canonical spec 重定位，不以 CLI 通过替代归档判断。

## 长期基线刷新计划（Baseline Promotion Plan）

- `openspec/specs/plugin-developer-diagnostic-artifacts/spec.md`：合并 `printedAt`、单一 `boundary` payload 和缺失 timing compatibility；不得恢复 caller-owned file sink。
- `openspec/specs/lifecycle-hook-execution/spec.md`：把 optional model result timing metadata 写入 canonical hook boundary Requirement。
- `openspec/specs/agent-package-assembly/spec.md`：仅在现有 packaged Agent single-source 行为仍有缺口时精确修改；否则删除重复 delta。
- `openspec/specs/developer-hook-trace-logging/spec.md`、`openspec/specs/ts-core-contracts/spec.md`、`openspec/specs/local-runtime-package/spec.md`：保留未触及 Requirements；不重新创建已经迁出的同名 Requirements。
- `openspec/designs/functions/`：刷新 `FN-10.1`、`FN-10.5` 与 `FN-3.1` 的 canonical spec 导航和发生变化的字段；不新增 Function。
- `openspec/designs/features/`：无 Feature delta，不更新。
- `openspec/overview.md`：无新的稳定基线入口，不更新。
- `openspec/designs/architecture/core-contracts.md`、`openspec/designs/architecture/agent-plugin-composition.md`、`openspec/designs/architecture/local-runtime-packaging.md`：只同步 hook timing owner、plugin payload位置与 packaged Agent single-source 中尚未承载的稳定事实。
- `openspec/designs/modules/agent-core.md`、`openspec/designs/modules/agent-plugin-sdk.md`、`openspec/designs/modules/agent-app.md`：只同步各自计算、格式化和 package/assembly owner 边界。
- `openspec/designs/adr/`：无新增长期取舍，不更新。
- `openspec/designs/spec-to-design-map.md`：把最终 canonical specs 指向上述 Function、architecture、module 与验证入口；不增加 legacy 多对多映射。

## 风险与取舍（Risks / Trade-offs）

- `printedAt` 使用 wall-clock，模型 timing 使用 monotonic clock；两者不可直接相减。通过字段 owner 分离与禁止二次 timing 计算消除误用。
- optional timing 保留旧 host/plugin artifact compatibility，但调测记录可能没有 timing。该缺失是合法输入，不由 plugin 猜测。
- 当前实现已经完成，而 active delta 落后于后续 stable migration。设计保留实现事实并阻塞直接归档，避免为消除 CLI 冲突恢复已淘汰 contract。

## 待确认问题（Open Questions）

无实现或验收阻塞项。

归档阻塞项已经在“存量 Requirement 迁移方案”中冻结：先把三份 legacy delta 重定位到当前 canonical specs，再评估 archive；不得直接归档或使用 `--skip-specs`。
