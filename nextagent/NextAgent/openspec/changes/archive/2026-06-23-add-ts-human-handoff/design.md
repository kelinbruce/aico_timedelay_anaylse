## 背景和现状（Context）

Human handoff 是 Agent loop 的后置增强能力，用于在当前 run 内把控制权交给人工。它不是工作流工单，也不是客服台；首版只需要两种结果：人工直接给最终回答，或者给恢复指令让原 run 继续。

This change only defines the runtime answer outcome for `PendingInputKind.HUMAN_HANDOFF`. It does not define a ticketing system, operator workbench, assignment/claim flow, queue, SLA, external review platform, or operator identity model.

核心约束来自 pending input core：handoff 必须绑定原 run 和 checkpoint，answer 经 runtime command 进入，terminal commit 仍由 runtime 拥有。

## 目标和非目标（Goals / Non-Goals）

**目标：**

- 支持 final answer 和 resume instruction 两条 handoff answer path。
- final answer 直接 terminal-commit 原 run。
- resume instruction 恢复原 run，不新建 root request。
- timeout/cancel 不合成结果。

**非目标：**

- 不实现人审工作台、分派、认领、多人协作或 SLA。
- 不新增 handoff-specific persistence field。
- 不修改 pending input core 三对象契约。
- 不定义上游何时必须 handoff。

## 设计决策（Decisions）

### D1：handoff answer 使用两项 answers

选定方案：第一项是模式选择，值为 `final_answer` 或 `resume_instruction`；第二项是非空文本内容。编码为 `[["final_answer"],["..."]]` 或 `[["resume_instruction"],["..."]]`。

理由：复用 `PendingInputAnswer.answers` 顺序语义，不新增 handoff DTO。

### D2：final answer 走 runtime terminal commit

选定方案：人工 final answer 被 runtime 作为原 run 的 terminal content 提交，产生正常 terminal visibility；不再调用模型改写。

理由：人工已经接管并给出最终内容，再调用模型会改变人工意图，也会引入新的不确定性。

### D3：resume instruction 是 continuation input，不是新 user message

选定方案：resume instruction 进入 runtime/core 的恢复上下文，用于继续原 run；它不作为新的 root user message 进入 session。

理由：handoff 是原 run 的中间控制，不是用户发起的新请求。

### D4：handoff answer authority follows pending answer boundary

选定方案：首版 handoff answer ingress 沿用 pending input 的 trusted channel/auth answer boundary。Runtime 在接受 answer 前校验 owner scope、agent scope、session id、pending input id 和 pending status；本 change 不定义 operator identity、assignment、claim、queue、workbench、SLA 或 external review platform。Handoff answer 只满足 handoff final answer/resume instruction，不满足 protected operation 的 confirmation 或 authorization。

理由：human handoff 首版是 pending input 的 type-specific outcome，不是人工工作台或授权系统。把 authority 先放在既有 pending answer boundary，可以避免在没有 operator/assignment 规格时发明新的身份面。

## 质量属性设计（Quality Attributes）

安全：projection 不暴露 hidden reasoning、operator notes 或 assignment metadata；final answer/resume instruction 通过 runtime command 和 owner scope 校验。验证入口是 stream/projection and command tests。

性能/容量：不引入工作台、队列或额外 store；复用 pending store。验证入口是 architecture review。

可靠性/恢复：handoff 绑定 checkpoint；answer 后 either terminal commit or resume，timeout/cancel 不合成结果。验证入口是 runtime integration tests。

可维护性：handoff 只定义 type-specific outcome，不扩展 core object。验证入口是 contract review。

可测试性：final answer、resume instruction、invalid、timeout、cancel 都可独立测试。

审计/可追溯性：`USER_INPUT_*` 和 terminal event refs 可供后续 audit derivation；不新增 audit sink。验证入口是 safe payload tests。

## 验证映射（Verification Map）

- final answer terminal commit：T2.1；runtime terminal integration test。
- resume instruction continuation：T2.2；runtime resume test。
- invalid answer reject：T1.2；negative test。
- timeout/cancel no synthesis：T3.1、T3.2；timeout/cancel tests。
- safe projection：T4.1；channel projection tests。
- no workbench/private lifecycle：T4.2；architecture test。

## 文档承载决策（Documentation Ownership）

- 行为契约：`openspec/specs/human-handoff/spec.md`。
- 架构设计：runtime/user-interaction architecture。
- 模块设计：`agent-runtime`、`agent-channel-web`、observability 模块文档。
- ADR：无。
- 导航：`openspec/designs/spec-to-design-map.md`。

## 风险与取舍（Risks / Trade-offs）

- [风险] handoff 膨胀成工作台。-> 首版只做 pending input type-specific outcome，不做 assignment/queue。
- [风险] final answer 被模型改写。-> final answer 直接 terminal commit。
- [风险] resume instruction 被当成新用户请求。-> 明确是 original run continuation input。

## 迁移计划（Migration Plan）

无生产迁移。

## 归档前更新基线（Baseline Promotion Plan）

- 新增 `openspec/specs/human-handoff/spec.md`。
- 更新 runtime/user-interaction architecture 和相关模块文档。
- 更新 `openspec/designs/spec-to-design-map.md`。

## 待确认问题（Open Questions）

无。
