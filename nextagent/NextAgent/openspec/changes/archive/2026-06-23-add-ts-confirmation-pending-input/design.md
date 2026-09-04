## 背景和现状（Context）

confirmation 是普通二态确认，不等同于授权。它用于让系统在继续某个低风险受控路径前得到用户明确选择。当前 pending input core 提供生命周期，timeout change 提供 no-auto-approve。这个 change 只收窄 `CONFIRMATION` 的 answer vocabulary 和 confirmed continuation 语义。

## 目标和非目标（Goals / Non-Goals）

**目标：**

- answer 只接受 approve/reject。
- reject 和 timeout 都不继续 approved path。
- 保持 confirmation 来自 trusted system path，不接受客户端或模型自报确认。

**非目标：**

- 不定义受限操作授权，authorization 由独立 change 处理。
- 不新增 confirmation-specific fields。
- 不支持 custom/multi-select。
- 不实现 policy trigger。

## 设计决策（Decisions）

### D1：confirmation 使用固定 answer vocabulary

选定方案：`[["approve"]]` 和 `[["reject"]]` 是唯一合法 answer。UI label 可以本地化，但 wire value 固定。

理由：固定 vocabulary 便于 runtime validation、恢复和审计推导。

### D2：reject 也是 received answer，但不是 approval

选定方案：用户点击 reject 后，pending input status 变为 `RECEIVED`，responseAnswers 保存 reject；原 run 进入 safe non-approval outcome 或跳过普通 confirmed step。

理由：用户已经作出回答，应和 timeout 区分；但不允许 approved path 继续。

### D3：confirmation 不承载授权 scope

选定方案：confirmation 只表达普通确认。涉及敏感读取、外部副作用调用、网络/设备/客户状态变更、受限副作用、permission scope 或 risk policy 的场景使用 `AUTHORIZATION` 或后续 explicit guard/risk change。

理由：避免 confirmation 被误用成安全授权。

## 质量属性设计（Quality Attributes）

安全：timeout/reject 不 approve；client/model 不能自报 confirmation authority。验证入口是 runtime negative tests。

性能/容量：固定二态 validation，不增加复杂查询。验证入口是 unit tests。

可靠性/恢复：answer 仍走 CAS resolve 和 checkpoint resume；涉及受限副作用的恢复必须使用 authorization。验证入口是 core pending integration tests。

可维护性：confirmation 只定义 type-specific vocabulary，不扩展 core object。验证入口是 contract review。

可测试性：approve、reject、invalid、timeout 四类测试独立。

审计/可追溯性：使用 `USER_INPUT_RECEIVED`/`TIMEOUT` safe refs；不新增 audit sink。验证入口是 projection tests。

## 验证映射（Verification Map）

- approve：T1.1；runtime validation/resume test。
- reject：T1.2；runtime non-approval test。
- invalid answer：T1.3；negative test。
- timeout non-approval：T2.1；timeout test。
- no custom/multi：T1.4；negative test。

## 文档承载决策（Documentation Ownership）

- 行为契约：`openspec/specs/confirmation-pending-input/spec.md`。
- 架构设计：pending input/user interaction architecture 或 runtime boundary 文档。
- 模块设计：`agent-runtime`、`agent-channel-web`、governance/hook 模块文档。
- ADR：无。
- 导航：`openspec/designs/spec-to-design-map.md`。

## 风险与取舍（Risks / Trade-offs）

- [风险] confirmation 被误用成 authorization。-> design 明确 side-effect/risk 使用 authorization change。
- [风险] timeout 被当成默认同意。-> spec 明确 timeout non-approval。

## 迁移计划（Migration Plan）

无生产迁移。

## 归档前更新基线（Baseline Promotion Plan）

- 新增 `openspec/specs/confirmation-pending-input/spec.md`。
- 更新 runtime/user-interaction architecture 和相关模块文档。
- 更新 `openspec/designs/spec-to-design-map.md`。

## 待确认问题（Open Questions）

无。
