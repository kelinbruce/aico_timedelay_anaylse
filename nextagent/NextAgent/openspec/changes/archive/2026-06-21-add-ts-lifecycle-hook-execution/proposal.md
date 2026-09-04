## 背景与问题（Why）

当前 TS 后端已经冻结了 `LifecycleStage`、`HookBoundary`、`BoundaryMutation`、`HookResult`、`RequestContext.nextLifecycleStage` 等核心契约，并明确 lifecycle hook 是 runtime-owned request lifecycle 中的可执行治理边界之一。

但在最小内核阶段，这一能力仍缺少正式的执行规格，带来几类问题：

- 缺少统一的 lifecycle hook 执行边界，不同阶段的治理逻辑无法稳定接入；
- 缺少 hook definition 与 Agent binding 的清晰分工，容易把定义、绑定、执行和运行时状态混在一起；
- 缺少固定的顺序、超时、失败和降级语义，后续 pending input、checkpoint、observability、release gate 和相邻治理能力缺少统一的 runtime lifecycle 协作边界；
- 缺少 hook invocation 的正式观测事实，系统无法证明某次 hook 是否执行、如何结束、是否改变了 request lifecycle。

本 change 的目标，是冻结首版最小 lifecycle hook 执行机制，让系统能够在固定 lifecycle stage 上同步执行 app-composed TypeScript hook code，并对 `decision`、`mutation`、超时、失败、挂起和观测事实形成稳定约束。配置只声明接入时机、顺序、超时和传给 hook code 的参数，并在启动期冻结，不承载业务处理策略。

## 变更范围（What Changes）

- 新增 `lifecycle-hook-execution` spec，冻结 hook 的触发阶段、输入前置、输出副作用、状态产物、失败降级和验收规则。
- 明确 hook code 只支持 app-composed TypeScript 后端代码，由 `agent-app` composition 在启动期显式接入并冻结，runtime 只在绑定 stage 调用对应 hook code。
- 明确 hook definition 与 Agent hook binding 的分离边界，以及 `SYSTEM` / `CUSTOM`、`BLOCKING` / `NON_BLOCKING`、`CONTINUE` / `FAIL` 的最小语义。
- 明确 runtime 如何在固定顺序中处理 hook `decision`、`pendingInputIntent` 和 `mutation`。
- 明确 stage-specific `HookBoundary` / `BoundaryMutation` 的首版最小清单，并固定其 owning surface 为 `agent-contracts/runtime`。
- 明确 `HookInvocationEvent` 的最小观测语义、可追溯性和与 timeline / audit / metrics / logging 的边界。
- 明确 hook 与 pending input、checkpoint、terminal commit、risk policy、channel projection 的接入关系。

## 核心实现策略（Current Strategy To Freeze）

冻结以下黑盒策略：

- hook 由 request lifecycle 内的权威同步边界触发，而不是由后台补采或离线任务触发；
- hook 处理逻辑由 app-composed TypeScript hook code 承载，配置只负责把 hook code 接到指定 lifecycle stage，并在启动期冻结；
- hook definition 和 Agent binding 分离，binding 只能收窄或覆盖允许的运行参数，不能改写 hook 的根属性；
- `BLOCKING` hook 按稳定顺序同步执行并顺序归约，首版不支持影响流程的并行 hook；
- runtime 只接收 `decision`、`pendingInputIntent` 和合法 `mutation`，并由 runtime 负责生成 effective boundary 与 lifecycle 后果；
- 每次 hook invocation 都形成结构化观测事实，但 hook invocation 默认不进入用户可见 stream event；
- 首版只支持 app-composed TypeScript hook code 接入路径，不开放 Python、Java、shell、Wasm、远端、脚本或热加载 hook。

## Impact

- 需要为 request accept、planning、model invoke/result、capability invoke/result、context compact、terminal event 等 lifecycle stage 建立正式 hook 接入规则。
- 需要明确配置只声明 hook code 的接入时机，并在启动期冻结；runtime 不把配置解释为业务策略 DSL。
- 需要明确 runtime 不扫描目录、不按配置路径动态 import，也不从 Agent package 目录加载 hook code。
- 需要补齐 hook 超时、异常、非法结果、decision/mutation 冲突和 pending input 挂起的固定处理顺序。
- 需要补齐 stage-specific boundary/mutation 的最小 contract 边界，避免实现阶段在 runtime、core、capability 或 observability 间分叉定义。
- 需要补齐 hook 指标、结构化日志、timeline-only lifecycle evidence 和后续 audit 接入边界。
- 需要为 release gates 和后续 hook 治理扩展提供统一 hook 基座；risk policy enforcement 是相邻治理能力，不能作为 lifecycle hook 或 hook executor 插件实现。

## 归档前基线提升计划（Baseline Promotion Plan）

- `openspec/specs/lifecycle-hook-execution/spec.md`
