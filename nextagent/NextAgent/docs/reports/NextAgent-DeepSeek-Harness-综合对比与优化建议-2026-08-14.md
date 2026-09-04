# NextAgent 与 DeepSeek Harness 综合对比及优化建议

> 报告日期：2026-08-14
>
> NextAgent 基线：`ef45e9a34fed6b420f71190f89c10edc4f0278ef`
>
> DeepSeek Harness 基线：`47f943859bef60e4160492346772ded9b24f765a`
>
> 分析方法：对两侧架构文档、OpenSpec、核心执行路径和测试进行静态代码审查；未执行 DeepSeek Harness 全量构建或真实模型测试。

## 1. 执行摘要

DeepSeek Harness 和 NextAgent 并不是同一类目标下的两种实现。

- DeepSeek Harness 更接近“高度可组合的通用 Agent Harness”：以 Cordis 插件树、可逆 effect、durable SessionEvent 和模型执行效率为中心。
- NextAgent 更接近“电信级 Agent 运行平台”：以稳定分层内核、Agent Scope、Owner Scope、请求生命周期、专用持久化和 OpenSpec 治理为中心。

综合结论如下：

1. NextAgent 不应改造成“一切皆插件”，也不应以通用事件日志替代 Message、Timeline、Checkpoint 和专用业务表。
2. NextAgent 已具备上下文压缩、Tool batch 并行、Workflow fork/join、跨 Session 调度和终态恢复，不存在整体能力缺失。
3. DeepSeek Harness 当前最值得 NextAgent 借鉴的是四项机制：
   - Provider 确认上下文溢出后的“强制压缩—持久进展证明—原路由重试”。
   - 逐 Tool 调用的并发安全分类、有界 rolling pool 和排他 barrier。
   - 最终模型请求与 durable evidence 的运行时一致性检查。
   - 已启动任务 drain、未启动 Tool 调用闭合等资源收敛语义。
4. 建议采用唯一实施顺序：先收敛 Tool 调度，再补上下文溢出恢复，随后建立最终模型请求证据，最后处理 Workflow 并行结果确定性和配置解释能力。

## 2. 总体能力对比

| 维度 | DeepSeek Harness | NextAgent | 综合判断 |
|---|---|---|---|
| 核心架构 | Cordis 插件树，一切皆插件 | 稳定分层内核，`agent-app` 唯一 composition root | 目标不同，不应互相替换 |
| 扩展方式 | Service、typed event、effect、profile、bundle、patch | OpenSpec、Capability、Plugin SDK、Agent Assembly、Hook | DeepSeek 动态性强；NextAgent 治理强 |
| 可信作用域 | Agent scope、Session identity | Agent Scope + Owner Scope + accepted-run 固化 | NextAgent 更适合多租户生产环境 |
| 上下文主动压缩 | pressure、Tool Result pruning、summary | micro-compact、large-content guard、summary compression | 两边均较完整 |
| Provider overflow 恢复 | 已形成压缩后重试闭环 | 尚无同等级闭环 | DeepSeek 领先 |
| 压缩提交一致性 | durable event bracket 和 surface replacement | CAS、幂等、composite write、专用 Record/table | NextAgent 领先 |
| 最终模型请求可证明性 | durable log 重建并在调用前运行 invariant | Workbench 明确存在部分不可重建项 | DeepSeek 领先 |
| 普通 Tool batch 并行 | 支持 | 支持 | 接近 |
| Tool 调度粒度 | per-call/per-argument 分类、rolling pool、barrier | batch 级并行，特殊依赖串行，ordered finalizer | DeepSeek 更成熟 |
| 跨请求并行 | 以 live Agent 和 Session 为中心 | same-session lane、priority、全局并发、terminal pending | NextAgent 领先 |
| Workflow | worker、parallel/pipeline、subagent | 持久执行、checkpoint、pending input、fork/join、远程模式 | NextAgent 业务治理更全面 |
| 异常终态 | durable turn/step、drain、replay | SafeError、terminal commit、幂等、恢复 | NextAgent 系统级更强 |
| 工程治理 | snapshot、生成式目录、100% 文件覆盖门禁 | OpenSpec、contract/architecture/E2E、push 前语义检视 | 各有所长 |

## 3. 架构与职责边界

### 3.1 DeepSeek Harness

DeepSeek Harness 的核心路径为：

```text
Profile / Bundle / Patch
          ↓
      Cordis Plugin Tree
          ↓
Session log → Agent loop → LLM / Tools
          ↓          ↓
      Projection   Capability seams
```

其关键特征是：

- model adapter、Tool registry、Session log、Agent loop 都可以由插件提供或替换；
- 注册均由 `ctx.effect()` 或 `ctx.on()` 管理，插件卸载时可以自动撤销；
- capability seam 被要求形成 Definition、Provider、Consumer 三角色闭环；
- profile/bundle/patch 决定最终启动插件树，并可通过 `--dump-config` 查看；
- durable SessionEvent 是模型上下文、回放和 UI 投影的重要事实源。

这种架构有利于快速组合和第三方扩展，但对插件顺序、waterfall 短路、热更新和动态覆盖提出较高治理要求。

### 3.2 NextAgent

NextAgent 的主路径为：

```text
Channel / trusted identity
          ↓
Request Runtime ── same-session lane / terminal commit
          ↓
Agent Core ─────── routing / model-tool loop
          ↓
Context / Model / Capability
          ↓
Gateway Local / Remote
```

其关键特征是：

- Runtime 是 request lifecycle、scheduler、cancellation、checkpoint 和 terminal commit 的唯一 owner；
- Agent Core 拥有业务路由和 Tool loop，Runtime 不做业务语义路由；
- Context Engine 拥有历史选择、预算、压缩和 prompt shaping；
- Agent Scope 由可信 assembly 或持久化 Session/Run 决定；
- Owner Scope 由 channel/auth identity 决定；
- accepted run 固化 `agentId`、`agentVersion`、`agentAssemblyRef`；
- persistence 使用专用业务 store/table、CAS、幂等锚点和 composite transaction。

### 3.3 架构结论

NextAgent 应保留以下不可替换内核：

- identity 与 Owner Scope；
- Agent Scope 和 accepted-run assembly binding；
- Request Runtime 与 terminal commit；
- Capability authorization；
- Gateway persistence transaction；
- sandbox gateway；
- model provider safe-error normalization。

建议借鉴 DeepSeek 的机制，而不是引入 Cordis 或复制其 package 粒度。

## 4. 上下文动态压缩

### 4.1 NextAgent 当前实现

NextAgent 已有两层上下文压缩。

#### Micro-compact

执行路径为：

```text
History selection
  → 扫描旧 Tool / RAG result
  → 确定性 placeholder 替换
  → 记录 compacted message ids
  → large-content guard
  → budget evaluation
```

当前优点：

- 只改本轮 assembly 中的投影，不破坏原始 Message 内容；
- 当前请求的 Tool Result 不参与压缩；
- 历史 RAG 和白名单 Tool Result 使用稳定 placeholder；
- compacted ids 可以写入 ActiveContext metadata；
- 失败不会直接阻塞请求主路径。

当前不足：ActiveContext metadata 写入失败被非阻塞地忽略，但没有形成明确的安全降级证据。这可能导致跨实例或后续请求无法确认本轮 compact decision 是否已经持久化。

#### Summary compression

执行路径为：

```text
统一预算估算接近窗口阈值
  → 选择 prior-turn prefix
  → 保留 recent tail + current request
  → 生成并校验 summary draft
  → expectedActiveContextVersion CAS
  → 原子写入 SUMMARY + 新 ActiveContext
```

当前优点：

- Owner Scope 与 Agent Scope 完整；
- summary 和 ActiveContext 替换通过 composite write 原子完成；
- CAS 防止并发压缩覆盖；
- 幂等 key 锚定本次压缩提交；
- 空 covered range 不生成伪 summary；
- 同一 run 只触发一次 summary compression，避免 Tool loop 级联压缩；
- summary generation、draft invalid、version conflict、persistence failure 使用不同结果。

### 4.2 DeepSeek Harness 当前实现

DeepSeek 同时支持：

- step 前 pressure 检查；
- Tool Result model-free pruning；
- summary compaction；
- provider 确认 `CONTEXT_WINDOW_EXCEEDED` 后强制压缩；
- 压缩后仍高于阈值时有限次继续压缩；
- 历史范围选择时保护 assistant Tool call/result 配对；
- `compaction/start → replacement → compaction/end` durable bracket；
- 只有 surface generation 发生持久前进时才重试模型请求。

尤其值得参考的是：摘要阶段即使失败，只要前置 Tool Result pruning 已产生持久减量，仍可以基于新的 surface 重试；但 cancellation 始终优先。

### 4.3 差距与建议

NextAgent 缺少的是 provider overflow 自恢复，而不是主动压缩能力。

建议建立 change：`harden-context-overflow-compaction-recovery`。

唯一运行路径：

```text
Provider adapter 规范化 CONTEXT_WINDOW_EXCEEDED
  → Agent Core 请求 Context Engine 强制压缩
  → Context Engine 使用现有 composite commit
  → 返回 sourceVersion / targetVersion / reductionEvidence
  → targetVersion > sourceVersion 时以原 model route 重试一次
  → 无进展、CAS 冲突、取消或无可压缩范围时保留原始失败
```

必须满足：

- 不按 provider 原始错误字符串猜测 overflow；
- 不重新选择默认 Agent、默认 model 或新 assembly；
- 每次实际 model invocation 最多执行一次 overflow recovery；
- cancellation 优先于压缩进展；
- evidence 只暴露安全版本、计数和 reason code；
- 原始 prompt、summary 内容和 provider raw error 不得进入 timeline、audit、metric 或 Web API。

## 5. 上下文拼接与模型请求

### 5.1 DeepSeek Harness

DeepSeek 将输入拆成 ordered system sections、runtime contexts、Tool schemas、prompt variables 和 durable conversation surface。

它支持：

- scoped contribution 覆盖 global contribution；
- section/context 显式排序；
- nearest scope variable 覆盖外层变量；
- complete prompt 单例约束；
- Tool schema 稳定排序；
- assembly waterfall 扩展。

其突出机制是“model-visible means logged”：实际模型请求中的 messages、system、tools 和主要 options 可以从 durable SessionEvent 重建，并在 `llm/stream` 前运行 invariant 比较。

### 5.2 NextAgent

NextAgent 使用更固定的可信流水线：

```text
ActiveContext
  → Agent Assembly
  → Capability visibility
  → Model selection
  → Prompt assembly
  → History selection
  → Attachment evidence
  → Micro-compact
  → Large-content guard
  → Budget / Summary compression
  → Final model input rendering
```

其优势是：

- 历史只能来自 ActiveContext refs；
- Capability 可见性来自 run-bound assembly；
- memory、attachment、prompt、history 各有明确 owner；
- identity、provider credential 和内部 model route 不进入 prompt authoring；
- message batch 可以并行读取，但最终按 selected refs 顺序重建。

当前不足是 Workbench 已明确存在 `TOOL_SCHEMAS_NOT_RECONSTRUCTED`、`BEFORE_MODEL_INVOKE_HOOK_MUTATIONS_NOT_RECONSTRUCTED` 等限制，最终模型请求只能部分近似。

### 5.3 建议

建议建立 change：`add-final-model-request-evidence`。

内部 evidence 至少包含：

- request/run/agent coordinates；
- ActiveContext version 和 selected message refs/digest；
- prompt template ref/version/digest；
- Capability descriptor/tool schema digest；
- attachment disclosure digest；
- compression source/target version；
- lifecycle hook result digest；
- final system/messages/tools/options digest。

责任划分：

- Context Engine 产生上下文选择、模板和压缩证据；
- Agent Core 产生最终 request evidence；
- Agent Model 在实际 provider 调用前校验；
- Gateway 使用专用 owner+agent scoped Record/table；
- Workbench 只读取安全 evidence，不读取原始 prompt。

不建议允许任意插件 waterfall 修改 NextAgent 的最终上下文。扩展仍应通过受治理的 Prompt、Capability patch 和 Lifecycle Hook 表达。

## 6. Tool 调度逻辑

### 6.1 NextAgent 当前实现

NextAgent 已实现：

- batch 级 descriptor、risk、hook、sandbox preparation；
- 普通 Tool batch 并行执行；
- `Promise.allSettled` 等待并行调用；
- ordered finalizer 保证结果、generated messages、context patch 按模型调用顺序提交；
- AskUserQuestion 形成强 barrier；
- `ToolSearch → Skill` 依赖使相关 batch 串行；
- Capability timeout 和统一调用边界；
- Tool failure 默认作为 model-visible feedback，而非直接结束 run。

因此 NextAgent 已经解决“并行完成顺序污染下一轮模型上下文”的核心风险。

### 6.2 DeepSeek Harness 当前实现

DeepSeek 对每个 Tool 调用使用实际参数执行 concurrency classification：

```text
isConcurrencySafe(args) === true
  → bounded parallel rolling pool

false / unknown / classifier throws
  → exclusive
  → 等待前置并行调用 drain
  → 独占执行并完成 finalization
  → 后续调用才允许启动
```

此外：

- `maxParallelToolCalls` 与单轮 Tool call 数量上限分离；
- 不会一次启动整个 batch；
- 每次启动前重新判断尚未启动调用；
- abort 会停止补充新调用；
- 已启动调用会 drain；
- 未启动调用生成 synthetic aborted result；
- Tool result 和 additional context 始终按模型顺序提交。

### 6.3 NextAgent 当前差距

- 普通 batch 默认整体并行；
- 没有独立的 `maxParallelToolCalls` rolling pool；
- 通用并发冲突策略尚未形成；
- 当前串行条件主要处理 `ToolSearch → Skill`；
- 对取消后未启动调用的 canonical 闭合语义还可以加强。

### 6.4 建议

建议第一个实施 change：`harden-tool-call-concurrency-scheduling`。

建议只增加内部执行结论，不立即扩大 frozen public contracts：

```ts
type CapabilityExecutionDisposition =
  | { mode: 'PARALLEL_SAFE'; conflictKey?: string }
  | { mode: 'EXCLUSIVE' };
```

第一版规则：

| Capability | 默认调度策略 |
|---|---|
| Read、Glob、Grep | `PARALLEL_SAFE` |
| RAG、只读 Search | `PARALLEL_SAFE` |
| Write、Edit | `EXCLUSIVE`；后续再评估可信 file conflict key |
| Bash、Python | `EXCLUSIVE` |
| Skill | `EXCLUSIVE` |
| Agent、Workflow | `EXCLUSIVE` 或由其受治理执行器提供固定结论 |
| AskUserQuestion | 强 barrier |
| 未知/custom Capability | fail closed 为 `EXCLUSIVE` |

必须满足：

- 模型参数不能声明调度模式；
- classifier 缺失、异常或未知返回值时必须排他；
- 新增独立 `maxParallelToolCalls`；
- 使用 rolling pool，而不是整批启动；
- exclusive Tool 前后形成 barrier；
- 持久结果继续按模型顺序提交；
- cancellation 后，未启动 Tool 形成稳定 skipped/canceled result；
- 已启动 Tool 必须 drain 或到达可证明的终止状态。

## 7. 异常、取消和恢复

### 7.1 DeepSeek Harness 优势

- compaction lifecycle 有 durable start/end bracket；
- scheduler internal failure 与 Tool business failure 分开；
- abort 后停止补充，但 drain 已启动任务；
- Tool timeout 能区分 caller cancel 和本地 deadline；
- subprocess 只负责响应 abort，不越权决定 timeout/cancel 分类；
- 未闭合 lifecycle 和 orphan process 可以被检测。

### 7.2 NextAgent 优势

- `SafeError` 有稳定 code/category/retryable；
- timeout/retry 位于统一 Capability invocation boundary；
- Request Runtime 对 completed、failed、canceled、superseded 均进入 terminal commit；
- terminal commit 使用 checkpoint、幂等、恢复和专用错误边界；
- terminal pending 会阻塞同一 Session lane；
- persistence、stream、audit、logging 各自不取代业务事实 owner。

### 7.3 建议的异常优先级

```text
Caller cancellation
  > Runtime cancel / supersede
  > Local timeout
  > Policy / hook interruption
  > Capability safe business failure
  > Scheduler / internal failure
```

实施约束：

- cancellation 分类先检查上层原始 signal，再检查派生/合并 signal；
- 已确认产生 side effect 的 Tool 不得自动重试；
- 只有显式 idempotent、没有确认 side effect 且错误为 transient 的调用可以重试；
- Workflow 不得在 Capability boundary 已经重试后再次执行同一逻辑调用；
- scheduler failure 必须停止补充并 drain；
- terminal commit failure 不得转换为普通业务失败；
- observability/audit failure 不得重新投影进相同 failure path，避免递归。

## 8. 并行执行

### 8.1 跨请求调度

NextAgent 的 Runtime 已具备：

- same-session lane 串行；
- 不同 lane 并行；
- 全局 `maxConcurrentRuns`；
- priority-aware reservation；
- durable lane snapshot；
- executing/terminal-pending run 阻塞；
- terminal commit 后释放 lane。

这一部分明显适合生产运行，不建议按 DeepSeek 方式重构。

### 8.2 单轮 Tool 并行

NextAgent 已有 ordered finalizer，但仍需要：

- per-call disposition；
- 独立并行上限；
- rolling pool；
- exclusive barrier；
- conflict key 的受控演进路径；
- abort 后 started/unstarted 调用的闭合语义。

### 8.3 Workflow fork/join

NextAgent 已支持：

- 分支同时启动；
- `break`/`wait` 失败策略；
- join timeout；
- parent cancellation；
- variables 按分支声明顺序合并；
- predecessor execution ids 聚合。

当前潜在风险：并行分支共享 `nodeResults` 数组，分支内部直接追加结果，因此变量归并是确定性的，但 node result 顺序可能受完成时序影响。

建议建立 change：`harden-workflow-fork-join-determinism`。

```text
每分支使用私有 nodeResults
  → allSettled
  → 按 branchNodeIds 声明顺序合并
  → 形成单一 join result
```

同时增加 `maxParallelBranches`、branch cancellation evidence、join timeout reason 和重复变量 key 冲突策略。

## 9. 工程治理与开发者体验

### DeepSeek 值得借鉴

- 可输出最终启动插件树的 `--dump-config`；
- Capability Definition/Provider/Consumer 完整性目录；
- 真实组装应用的 keyless transcript snapshot；
- generated service/event/tool/config/persistence catalog；
- 注册 disposer 和 HMR safety 测试；
- 模型可见行为变化要求更新 snapshot。

### NextAgent 应保留

- OpenSpec-first；
- frozen core contract；
- architecture/contract/E2E gate；
- push 前模型语义检视；
- Agent/Owner Scope 负向测试；
- persistence composite transaction 和幂等锚点原则；
- frontend/browser ownership 和多宿主一致性。

### 建议补充

1. `add-effective-agent-assembly-explain`
   - 输出配置来源与覆盖顺序；
   - 显示最终 Agent Assembly、主模型/fallback 原因、Capability binding、provider availability、prompt template 和 sandbox policy；
   - 仅限本地只读诊断；
   - 不暴露 credential、Owner Scope 数据和原始 prompt。

2. Capability 闭环矩阵 gate
   - 检查 Definition、Provider、Consumer、Assembly binding 和 contract test；
   - 缺失必要角色时 architecture gate 失败；
   - 不因此把当前 package 机械拆细。

3. 组装产品 transcript snapshot
   - 覆盖普通问答、Tool 多轮、Skill acquisition、guardrail、compaction、model fallback、Workflow；
   - snapshot 锁定用户/模型可见 contract，不锁死内部 DTO 和数据库 row。

## 10. 不建议照搬的设计

- 不把 Runtime、Gateway、identity、terminal commit 改成可替换插件。
- 不用一个通用 SessionEvent JSONL 取代 Message、Timeline、Checkpoint 和专用业务表。
- 不允许配置热更新改变 accepted run 的 assembly。
- 不把 raw stream chunk 作为长期 canonical conversation history。
- 不允许任意 waterfall 修改最终模型请求。
- 不复制 DeepSeek 的两百余 workspace package 粒度。
- 不把 provider callback 直接加入 frozen `agent-contracts`。
- 不机械采用每文件 100% 覆盖率。
- 不在普通 Tool loop 中引入未治理的模型生成 Code Mode。

## 11. 唯一实施路线

### 阶段 1：Tool 调度收敛

Change：`harden-tool-call-concurrency-scheduling`

交付：

- 内部 execution disposition；
- `maxParallelToolCalls`；
- bounded rolling pool；
- exclusive barrier；
- ordered finalization；
- cancellation/skipped result 闭合。

推荐优先原因：现有 ordered finalizer 可直接复用，改动边界最小，性能与安全收益最明确。

### 阶段 2：上下文溢出恢复

Change：`harden-context-overflow-compaction-recovery`

交付：

- provider 标准化 overflow；
- Context Engine 强制压缩；
- ActiveContext version progress evidence；
- 原 model route 最多一次重试；
- cancellation、CAS conflict、no-progress 禁止重试。

### 阶段 3：最终模型请求证据

Change：`add-final-model-request-evidence`

交付：

- final request digest；
- hook mutation evidence；
- Tool schema digest；
- Workbench exact/partial/unavailable 状态；
- provider 调用前 invariant。

### 阶段 4：Workflow 并行确定性

Change：`harden-workflow-fork-join-determinism`

交付：

- branch-local result collection；
- declaration-order merge；
- `maxParallelBranches`；
- cancel/timeout/failure 闭合。

### 阶段 5：配置解释能力

Change：`add-effective-agent-assembly-explain`

交付：

- 本地只读 effective assembly；
- 配置来源和覆盖原因；
- model/capability/prompt/sandbox 决策解释；
- 安全脱敏和容量限制。

## 12. 建议验收指标

| 目标 | 验收指标 |
|---|---|
| Tool 调度安全 | 排他调用与任意兄弟调用不重叠；未知 Capability 默认排他 |
| Tool 调度容量 | 实际并发 Tool 数不超过 `maxParallelToolCalls` |
| Tool 顺序确定性 | 完成顺序任意时，持久结果和下一轮模型上下文仍按模型调用顺序 |
| Tool 取消闭合 | started 调用 drain；unstarted 调用均有 canonical skipped/canceled result |
| Overflow 恢复 | 只有 provider-confirmed overflow 且 ActiveContext version 前进时重试 |
| Overflow 有界性 | 每次实际 model invocation 最多一次恢复 |
| Scope 安全 | 压缩和重试全程保持原 Owner Scope、Agent Scope、assemblyRef 和 model route |
| 请求可证明性 | 实际 provider request digest 与 FinalModelRequestEvidence 一致 |
| Workflow 确定性 | branch 完成顺序变化不改变最终 node result 顺序和变量归并 |
| 回归门禁 | minimal kernel、contract、architecture、security、相关 frontend/E2E 全部通过 |

## 13. 最终结论

NextAgent 已经具备比 DeepSeek Harness 更适合电信生产系统的可信边界、请求生命周期、持久化事务和恢复能力。下一阶段不应扩大插件化范围，而应提高现有内核的执行效率和可证明性。

推荐的目标态是：

```text
稳定可信内核
  + 有界且冲突感知的 Tool 并行
  + Provider overflow 自动压缩恢复
  + 最终模型请求证据
  + 确定性的 Workflow 并行归并
  + 可解释的 Agent Assembly
```

若只能推进一个 change，应优先 `harden-tool-call-concurrency-scheduling`。若可以连续推进两个，则按“Tool 调度收敛 → Provider overflow 压缩恢复”的顺序实施。

## 附录 A：主要代码证据

### DeepSeek Harness

- `docs/architecture.md`
- `packages/core/agent-loop/src/agent.ts`
- `packages/core/agent-loop/src/tool-calls.ts`
- `packages/core/agent-loop/src/invariant.ts`
- `packages/core/session/src/index.ts`
- `packages/core/system-prompt/src/index.ts`
- `packages/core/tools/src/index.ts`
- `packages/compaction/compaction-basic/src/index.ts`
- `packages/compaction/compaction-basic/src/region.ts`
- `packages/guard/timeout-policy/src/index.ts`

### NextAgent

- `AGENTS.md`
- `docs/developer/02-architecture.md`
- `packages/agent-context-engine/src/assembly/assemble-context.ts`
- `packages/agent-context-engine/src/assembly/summary-compression-orchestrator.ts`
- `packages/agent-context-engine/src/micro-compact/micro-compact.ts`
- `packages/agent-core/src/tools/tool-loop.ts`
- `packages/agent-runtime/src/lifecycle/submit.ts`
- `packages/agent-workflow/src/engine/index.ts`
- `packages/agent-dev-workbench/src/index.ts`

## 附录 B：报告边界

- 本报告描述上述两个 commit 的实现状态，不代表后续版本。
- DeepSeek Harness 处于开发者预览阶段，其接口和目录可能继续发生破坏性变化。
- 本报告未执行真实性能基准，因此“效率更高”仅指调度机制具备更细粒度和更明确容量控制，不代表已证明吞吐或延迟领先。
- 任何生产代码、公共 contract、runtime lifecycle 或 persistence 行为变更，都必须先建立并验证对应 OpenSpec change。
