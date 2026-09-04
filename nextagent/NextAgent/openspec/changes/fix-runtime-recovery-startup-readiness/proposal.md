## Why

运维人员和平台集成方在重启存在可恢复 `RequestRun` 的实例时，会遇到启动耗时随恢复工作线性增长的问题。恢复期间实例未完成对外监听和 readiness，因此新请求被平台或客户端拒绝为不可用；当多个 `EXECUTING` run 需要恢复时，即使服务进程本身可以接收新请求，也会长时间返回 503。

该行为混淆了两个不同的可用性边界：实例是否可以安全接收新请求，以及 scheduler 是否可以 dispatch 新执行。恢复分类、claim 和重建可以继续在后台完成，但不应因此阻止 server readiness。现在需要修正该边界，避免每次重启恢复历史 run 时放大为整体服务不可用。

## 目标与非目标（Goals / Non-Goals）

**目标：**

- 实例完成必要的启动装配后即可进入 server listen 和 readiness，不等待本地 runtime recovery pass 完成。
- readiness 后到达的新请求可以被接受并持久化为 pending work。
- 在 recovery pass 完成前，新接受的请求不得进入 execution path；recovery 完成后已排队请求应自动恢复 dispatch。
- recovery pass 失败时保持降级诊断，并恢复 dispatch gating；不得因此阻塞实例对外可用。
- recovery 与 pending-input timeout processing 可以并发执行，且不得引入重复恢复或重复处理。

**非目标：**

- 不改变 recoverable run 的 durable facts、Agent Scope、Owner Scope、claim、checkpoint、terminal takeover 或 idempotency guard 语义。
- 不改变请求提交后的 public API、stream event、runtime command 或 persistence contract。
- 不声明 PaaS 多实例 shared worker registry、distributed consensus 或 non-sticky routing 能力。
- 不改变正常 shutdown 顺序、timeout 预算和 close 语义。

## What Changes

- 修改本地 runtime recovery 的启动行为契约：server readiness 不再等待 recovery pass 完成。
- 保留并明确 recovery dispatch gating：recovery pass 完成前，新接受的请求可以排队，但必须与尚未 claim/classify 的 recoverable work 隔离，不得并行进入 execution path。
- recovery pass 在后台执行；成功、失败和完成后的 dispatch 恢复必须可观察。失败输出既有 `runtime.recovery.degraded` 降级诊断，不得升级为启动失败。
- pending-input timeout processing 与 recovery pass 并发启动；两者不得因并发造成重复 terminal transition 或重复 reconciliation side effect。

## Function 影响（OpenSpec Capabilities）

### 新增 Function

无。

### 修改的 Function

- `FN-11.1 恢复运行状态` → `specs/local-runtime-recovery/spec.md`
  - 功能边界：修改启动期 recovery 与 server readiness 的关系。server readiness 可以先于 recovery pass 完成；新请求在 recovery 期间被接受但不 dispatch，recovery 完成后自动进入既有调度路径。
  - 系统质量属性：可靠性/恢复、性能/容量、可测试性。
  - 映射说明：canonical spec 为 `local-runtime-recovery`；本 change 不触及 legacy spec。

## 影响范围（Impact）

- 运维人员和平台集成方可观察到重启期间实例更早进入 readiness，新请求不再因后台恢复被 503 拒绝。
- 用户在 recovery 期间提交的新请求会排队等待，不会更早开始执行；recovery 完成后的执行顺序仍由既有 same-session lane 和 scheduler 规则决定。
- 本 change 会更新应用启动顺序实现、启动失败 stage 顺序和 lifecycle characterization tests；不新增公共 API，不修改配置和持久化 schema。
