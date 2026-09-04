## 1. Spec

- [x] 1.1 新增 `lifecycle-hook-execution` spec，冻结 hook 触发机制、输入前置、输出副作用、状态产物和失败降级规则。
  来源：spec requirement "Lifecycle hooks execute only at runtime-owned lifecycle stages"，spec requirement "Hook failure handling is explicit and bounded by failure mode"
- [x] 1.2 明确首版 lifecycle stage 覆盖面，以及 hook code registration / hook definition / Agent binding / runtime execution 四者的责任边界。
  来源：spec requirement "Hook definitions and Agent bindings remain separate and bounded"，spec requirement "Hook code execution is app-composed and bounded"；design 当前冻结的核心实现策略
- [x] 1.2a 明确 risk policy enforcement 不是 lifecycle hook，不得注册为 hook definition、Agent hook binding 或 hook executor plugin。
  来源：spec requirement "Lifecycle hooks execute only at runtime-owned lifecycle stages"；design 非目标与流程接入
- [x] 1.3 明确 `SYSTEM` / `CUSTOM`、`BLOCKING` / `NON_BLOCKING`、`CONTINUE` / `FAIL`、`NO_OPINION` / `APPROVE` / `REJECT` / `PEND` 的固定语义。
  来源：spec requirement "Blocking hooks use a stable synchronous execution order"，spec requirement "Runtime is the only authority that interprets decisions and applies mutations"；design 当前冻结的核心实现策略
- [x] 1.4 明确 `HookInvocationEvent`、timeline-only `HOOK_DECISION_APPLIED` 和 `pendingInputIntent` 的可追溯性与安全限制。
  来源：spec requirement "Every hook invocation produces a structured observability fact"，spec requirement "Lifecycle-changing hook outcomes create timeline-only evidence without default client projection"；design 状态/产物契约
- [x] 1.5 明确 stage-specific `HookBoundary` / `BoundaryMutation` 最小清单、owning surface 和 unsupported mutation 的非法结果语义。
  来源：spec requirement "Stage-specific boundaries and mutations are minimal runtime contracts"；design Stage Boundary / Mutation 最小清单

## 2. Design

- [x] 2.1 写清 lifecycle hook 只由 runtime-owned lifecycle stage 同步触发，不由后台 job、补采或独立调度触发。
  来源：spec requirement "Lifecycle hooks execute only at runtime-owned lifecycle stages" scenario "Request acceptance stage invokes bound hooks in-band"；design 触发机制
- [x] 2.1b 写清配置只声明 TypeScript hook code 接入时机、顺序、超时和参数，并在启动期冻结；hook 处理逻辑由 app-composed TypeScript hook code 执行，runtime 不把 config 解释成业务策略 DSL。
  来源：spec requirement "Hook code execution is app-composed and bounded" scenario "Configuration does not execute as code"
- [x] 2.1a 写清 lifecycle hook 与 risk policy 的相邻边界：risk policy 可复用 runtime、pending input、timeline 和 observability 边界，但不得通过 lifecycle hook executor 执行。
  来源：design 流程接入
- [x] 2.2 写清 hook 固定执行顺序、超时和失败模式处理，以及 `decision` / `mutation` 的归约顺序。
  来源：spec requirement "Blocking hooks use a stable synchronous execution order" scenario "Blocking hooks execute in deterministic order"，spec requirement "Hook failure handling is explicit and bounded by failure mode"；design 核心判断逻辑
- [x] 2.3 写清 runtime 如何校验 stage-specific mutation、如何生成 effective boundary，以及何时停止后续 hook 或主流程。
  来源：spec requirement "Runtime is the only authority that interprets decisions and applies mutations" scenario "Reject wins over mutation"，scenario "Later blocking hook sees the effective boundary produced by prior mutation"；design 输出与副作用
- [x] 2.4 写清 `PEND` 与 pending input、恢复边界、checkpoint、observability 和 audit 的接入关系。
  来源：spec requirement "Runtime is the only authority that interprets decisions and applies mutations" scenario "Pending input is created only from a valid pending intent"，spec requirement "Lifecycle hooks execute only at runtime-owned lifecycle stages" scenario "Recovery resumes hook execution only at a recoverable lifecycle stage"；design 状态/产物契约
- [x] 2.5 写清唯一实施路径：`agent-runtime` 拥有 executor 与 decision/mutation 消费，`agent-app` 负责启动期显式注册 TypeScript hook code、definition / binding composition 和冻结快照，`agent-core` 只提供 stage facts，`agent-observability` 只消费观测事实，channel 与 risk policy 不接入 hook executor。
  来源：design 唯一实施路径

## 2A. High-Risk Rollout Split

- [x] 2A.1 明确 Phase A：先在 runtime 当前直接拥有的 `BEFORE_REQUEST_ACCEPT`、`BEFORE_MODEL_INVOKE`、`BEFORE_TERMINAL_EVENT` 落真实 executor，替换 noop placeholder。
  来源：design 分批落地策略
- [x] 2A.2 明确 Phase B：`BEFORE_CAPABILITY_INVOKE`、`AFTER_CAPABILITY_RESULT`、`AFTER_MODEL_RESULT`、context compact 等 core 邻接 stage 通过 runtime-owned executor 接入，`agent-core` 只组装 boundary facts。
  来源：design 分批落地策略；design core 邻接边界的 owner 规则
- [x] 2A.3 明确 `PEND` 路径的完成标准必须包括“回答后按 checkpoint + nextLifecycleStage 恢复执行”，不能只完成 pending input 创建。
  来源：design pending input 恢复闭环；spec scenario "Answered pending input resumes from the saved recoverable stage"

## 3. Validation

- [x] 3.1 覆盖正常路径：`SYSTEM` hook 与 `CUSTOM` hook 按稳定顺序执行，`APPROVE` 或 `NO_OPINION` 下主流程继续。
  来源：spec requirement "Blocking hooks use a stable synchronous execution order" scenario "Blocking hooks execute in deterministic order"
- [x] 3.2 覆盖边界路径：`BEFORE_TERMINAL_EVENT` 的合法 mutation 被 runtime 应用，且更新后的 effective boundary 被后续 hook 或主流程消费。
  来源：spec requirement "Blocking hooks use a stable synchronous execution order" scenario "Later blocking hook sees the effective boundary produced by prior mutation"
- [x] 3.3 覆盖拒绝路径：`REJECT` 停止后续 `BLOCKING` hook 与主流程，并留下 `HookInvocationEvent` 与 lifecycle evidence。
  来源：spec requirement "Runtime is the only authority that interprets decisions and applies mutations" scenario "Reject wins over mutation"
- [x] 3.4 覆盖挂起路径：`PEND` 触发 pending input 创建，且 pending input 可追溯到对应 hook invocation。
  来源：spec requirement "Runtime is the only authority that interprets decisions and applies mutations" scenario "Pending input is created only from a valid pending intent"
- [x] 3.5 覆盖失败路径：hook timeout、throw、unavailable、invalid result 分别按 `CONTINUE` / `FAIL` 语义处理。
  来源：spec requirement "Hook failure handling is explicit and bounded by failure mode"
- [x] 3.6 覆盖降级路径：`NON_BLOCKING` hook 返回控制结果时被忽略并留下诊断，observability 下游失败不改写主流程真相。
  来源：spec requirement "Non-blocking hooks are observational only" scenario "Non-blocking decision is ignored"，scenario "Non-blocking mutation is ignored"
- [x] 3.7 覆盖契约边界路径：stage-specific boundary / mutation 只从 `agent-contracts/runtime` 导出，不新增 `agent-contracts/hook`；`none` stage 或错误 stage 返回 mutation 时按非法 hook result 处理。
  来源：spec requirement "Stage-specific boundaries and mutations are minimal runtime contracts"
- [x] 3.8 覆盖代码接入路径：缺失 hook code registration 按 unavailable/failureMode 处理；binding config 只透传给 TypeScript hook code，不被 runtime 当作脚本、表达式、远端调用、模型指令或策略 DSL 执行；启动后 request 执行使用冻结快照，不重载 hook 配置；runtime 不扫描目录、不按配置路径动态 import、不从 Agent package 目录加载 hook code。
  来源：spec requirement "Hook definitions and Agent bindings remain separate and bounded" scenario "Missing hook code registration is not silently skipped"，scenario "Hook configuration is frozen after startup"，scenario "Hook registration is frozen after startup composition"，spec requirement "Hook code execution is app-composed and bounded" scenario "Configuration does not execute as code"，scenario "Non-TypeScript hook implementations are outside the first-release loader path"

## 3A. High-Risk Validation Split

- [x] 3A.1 覆盖 Phase A：runtime-owned 直接边界中的 executor 顺序、timeout、failureMode、terminal `REJECT` / mutation 归约与 `HOOK_DECISION_APPLIED`。
  来源：design Phase A；spec requirement "Blocking hooks use a stable synchronous execution order"；spec requirement "Lifecycle-changing hook outcomes create timeline-only evidence without default client projection"
- [x] 3A.2 覆盖 Phase B：`BEFORE_CAPABILITY_INVOKE` 等 core 邻接 stage 只提供 boundary facts，不拥有 decision/mutation interpretation；runtime 仍是唯一 owner。
  来源：design core 邻接边界的 owner 规则；spec requirement "Runtime is the only authority that interprets decisions and applies mutations"
- [x] 3A.3 覆盖完整 `PEND` 闭环：创建 pending input、写入 `USER_INPUT_REQUIRED` / `HOOK_DECISION_APPLIED`、回答后写入 `USER_INPUT_RECEIVED`、并从保存的 recoverable stage 恢复执行。
  来源：design pending input 恢复闭环；spec scenario "Answered pending input resumes from the saved recoverable stage"
