## 背景与问题（Why）

NextAgent 需要支持用户或上游系统显式指定由某个 Skill 处理请求，例如电信告警诊断、配置核查或网络变更风险分析。但显式指定 Skill 不能成为绕过 Agent Scope、Owner Scope、capability governance、availability、权限和执行预算的后门。

本 change 在 `add-ts-agent-routing-core` 之后定义 user-directed Skill routing 的受控路径：`targetSkill` 只是 routing constraint，必须经过 Agent routing policy 和 capability governance 后才能进入 Skill 执行。

本 change 依赖 `refine-ts-routing-constraints-contract` 提供 request-carried `RoutingConstraints.targetSkill` contract，并依赖 `add-ts-routing-constraint-validation` 提供 schema/governance boundary。没有该 contract 字段时，本 change 不应进入实现。

## 变更范围（What Changes）

- 定义显式 Skill 指定的触发、输入、前置条件、判断顺序、输出和失败降级。
- 定义 `targetSkill` 如何进入 Agent routing policy，而不是由 channel/runtime 直接执行。
- 定义 Skill kind、当前 Agent binding、Owner Scope 授权/可见性、availability、forbidden constraint、deadline/cancel 和执行预算的最小校验要求。
- 定义 accepted、rejected、clarification、fallback-to-model 和 safe error 的输出语义。
- 不定义 Skill manifest 解析、Skill tool inline/fork 细节或 SkillHub/local provider discovery；这些由已有/后续 capability changes 承载。

## Capability 影响（Capabilities）

### 新增 Capability
- `targeted-skill-routing`: 支持用户显式指定 Skill，并通过 Agent routing policy 和 capability governance 后执行。

### 修改的 Capability
- `agent-routing-core`: 在不新增 public decision kind 的前提下，将通过治理的 preferred Skill 映射为 Agent-owned deterministic flow 内部分支。
- `routing-constraint-validation`: 复用其 typed constraint 校验结果。
- `skill-tool`: 显式用户指定 Skill 属于 Agent routing path，不是模型调用 `Skill` tool 的替代入口。

## 影响范围（Impact）

- `agent-core`: routing policy 处理 `targetSkill`，并将通过校验的 Skill 转为 deterministic flow 内部的 governed capability invocation。
- `agent-capability`: 提供 request-scope Skill resolve、availability 和 authorization facts。
- `agent-channel-web`: 只接收/转发 typed constraint，不直接调用 Skill。
- `agent-runtime`: 只保存 accepted request facts、timeline/terminal；不拥有 Skill routing。
- 验证：targeted Skill routing contract tests、negative governance tests、channel/runtime non-bypass architecture tests。

## 归档前更新基线（Baseline Promotion Plan）

行为契约：
- `openspec/specs/targeted-skill-routing/spec.md`：新增显式 Skill routing 行为契约。

长期背景：
- `openspec/overview.md`：无。

设计视图：
- `openspec/designs/architecture/ts-backend-architecture.md`：同步 directed Skill routing 接入 Agent routing flow。
- `openspec/designs/modules/agent-core.md`：同步 preferred Skill routing owner。
- `openspec/designs/modules/agent-capability.md`：同步 Skill resolve/governance 消费关系。
- `openspec/designs/spec-to-design-map.md`：增加导航。

验证入口：
- `npm test -- --run packages/agent-core/tests/targeted-skill-routing.test.ts`
- `npm test -- --run packages/agent-capability/tests/*skill*`
- `npm run lint:architecture`
- `openspec validate add-ts-targeted-skill-routing --strict`
