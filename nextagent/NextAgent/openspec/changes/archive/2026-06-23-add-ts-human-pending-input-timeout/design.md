## 背景和现状（Context）

`add-ts-human-pending-input-core` 建立 pending input 的创建、投影、answer、取消和恢复。timeout 是同一 child lifecycle 的 terminal branch：用户没有在限定时间内回答时，runtime 必须结束等待，而不是让 lane 永久阻塞。

当前核心契约已经有 `timeoutAt?` 字段，但缺少 default、最大值、due discovery、late answer 和 no-auto-approve 规则。`refine-ts-pending-input-contracts` 提供 `listDuePendingInputs`，避免 timeout 依赖 process-local timer。

## 目标和非目标（Goals / Non-Goals）

**目标：**

- 默认 timeout 为 30 分钟，最大 24 小时。
- 支持更短 explicit `timeoutAt`。
- 明确 runtime 在 pending acceptance 时拥有 accepted `timeoutAt` 的最终计算和校验权。
- 支持 runtime/recovery 从 durable facts 发现 due pending。
- timeout 后拒绝 late answer。
- 所有 timeout 都不自动 approve。

**非目标：**

- 不定义进入 pending 的触发条件。
- 不新增 timeout behavior 字段。
- 不新增可配置 timeout policy，也不支持 per-agent、per-kind、per-tenant、client-provided、gateway-derived 或 model-provided timeout 配置。
- 不引入外部调度系统。
- 不定义完整 audit sink。
- 不改变 lane release 策略。

## 设计决策（Decisions）

### D1：timeoutAt 是事实，timeout behavior 是 runtime 规则

选定方案：pending input 持久化 runtime 接受后的 `timeoutAt`，但不持久化 timeout behavior。timeout rule 由本 change 定义；runtime 在 pending acceptance 时根据该 rule 计算和校验 accepted `timeoutAt`，并在 timeout/recovery processing 中决定是否把 due pending 推进到 `TIMED_OUT`。producer 提供的 explicit `timeoutAt` 只是请求，不是 authority；gateway、channel、client 和 model 都不能定义或覆盖 timeout policy。

理由：timeout behavior 属于 runtime lifecycle policy，不是 client request 或 gateway record 的事实字段。

### D2：default 30 分钟，最大 24 小时

选定方案：缺省 `timeoutAt = createdAt + 30 minutes`；explicit `timeoutAt` 必须晚于创建时间且不超过 24 小时。`createdAt` 和 timeout scan 的 `now` 必须来自 runtime pending lifecycle clock；测试可以注入该 clock。首版不引入 DB clock、gateway clock、client clock、producer clock 或配置系统作为 timeout policy source。

理由：30 分钟适合交互等待，24 小时防止永久占用 lane 和过度存储膨胀。

### D3：timeout discovery 使用 durable due query

选定方案：runtime timeout/recovery loop 调用 `listDuePendingInputs({ now, limit })`。每条 due record 再用 CAS resolve，避免与 answer/cancel 并发冲突。

拒绝方案：只依赖 process-local timer。拒绝原因是进程重启或多实例切换后会丢失等待中的 timeout。

### D4：所有 timeout 都不是 approve

选定方案：confirmation timeout 等价 reject/non-approval；authorization timeout 等价 deny/no execution；question/handoff timeout 不合成回答。

黑盒效果：用户没有明确点击 approve/authorize 时，系统不会执行受保护操作，也不会把沉默解释为同意。

## 质量属性设计（Quality Attributes）

安全：timeout 永不自动 approve，避免沉默授权；producer/client/model/gateway 不能扩大或覆盖 runtime 接受的 timeout rule。验证入口是 confirmation/authorization negative tests 和 runtime timeout ownership tests。

性能/容量：due query 必须 bounded limit；runtime 可分批处理。验证入口是 gateway/runtime timeout tests。

可靠性/恢复：timeout 基于 runtime 接受的 durable `timeoutAt` fact 和 CAS，支持重启后扫描，容忍并发 answer/cancel。验证入口是 recovery tests。

可维护性：timeout 只在 runtime 处理，gateway 不做决策，type-specific change 只定义 kind outcome。验证入口是 architecture review。

可测试性：default、max、due、late answer、no auto approve 都可独立测试。

审计/可追溯性：`USER_INPUT_TIMEOUT` 提供 safe trace point；完整 audit sink 由 observability change 消费。验证入口是 stream payload tests。

## 验证映射（Verification Map）

- runtime timeout ownership、runtime clock 和 default/max timeout：T1.1；runtime validation tests。
- durable due discovery：T2.1；gateway/runtime tests。
- CAS timeout resolution：T2.2；concurrency tests。
- late answer rejection：T3.1；runtime negative tests。
- no auto approve：T3.2；confirmation/authorization timeout tests。
- safe stream payload：T4.1；projection tests。

## 文档承载决策（Documentation Ownership）

- 行为契约：`openspec/specs/human-pending-input-timeout/spec.md`。
- 架构设计：`openspec/designs/architecture/runtime-boundaries.md`。
- 模块设计：`openspec/designs/modules/agent-runtime.md`、gateway 模块、channel projection 模块文档。
- ADR：无。
- 导航：`openspec/designs/spec-to-design-map.md`。

## 风险与取舍（Risks / Trade-offs）

- [风险] timeout 扫描过大。-> due query 必须带 limit，runtime 分批处理。
- [风险] answer 与 timeout 并发。-> CAS 以 `expectedStatus=PENDING` 为唯一状态转换边界。
- [风险] producer-provided `timeoutAt` 被误当成 policy authority。-> runtime 在 pending acceptance 时最终计算/校验 accepted `timeoutAt`；producer/client/model/gateway 都不能覆盖 timeout rule。
- [取舍] 不支持自动 approve。-> 明确安全优先，避免沉默同意。

## 迁移计划（Migration Plan）

无生产迁移。实现时缺少 `timeoutAt` 的新建 pending 必须补 default；已有测试 fixture 可按缺省 false/30min 更新。

## 归档前更新基线（Baseline Promotion Plan）

- 新增 `openspec/specs/human-pending-input-timeout/spec.md`。
- 更新 runtime boundary、agent-runtime、gateway 和 channel projection 设计文档。
- 更新 `openspec/designs/spec-to-design-map.md`。

## 待确认问题（Open Questions）

无。
