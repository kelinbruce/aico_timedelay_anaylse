## 背景和现状（Context）

authorization 是对受保护操作的明确许可。它与 confirmation 的区别在于绑定了单次操作；后续 hook/risk policy/capability guard consumption change 若需要 authorization pending，必须通过 pending input core 已冻结的 producer boundary 提交 validated `AUTHORIZATION` intent。当前核心契约禁止把 origin、step id、audit linkage、timeout behavior 或 answer schema 写入 pending 对象，因此操作绑定必须通过 runtime checkpoint/continuation 保存，而不是扩展客户端 pending payload。

Risk policy trigger 与 capability guard wiring 由后续消费 change 定义；capability invocation audit / audit sink 基线只消费审计投影边界，不定义授权触发或执行许可。因此本 change 只定义 authorization pending 已进入 runtime-owned pending 后的 boundary 和 type-specific outcome。

## 目标和非目标（Goals / Non-Goals）

**目标：**

- 定义 approve/deny answer vocabulary。
- 绑定当前 run 中的一次受保护操作。
- deny/timeout 阻止操作执行。
- 客户端不能设置 authorization scope。

**非目标：**

- 不定义 risk policy 的触发规则。
- 不定义 capability audit sink。
- 不新增 operation scope 字段到 pending request/answer/record。
- 不支持 custom/multi-select。

## 设计决策（Decisions）

### D1：operation binding 存在于 runtime checkpoint/continuation

选定方案：runtime 在创建 authorization pending 前保存 checkpoint，该 checkpoint/continuation 包含即将执行的受保护操作上下文。Authorization intent 必须由 trusted Agent/core lifecycle hook 或 capability guard 在受保护操作开始前产生，并基于 resolved capability descriptor 和 explicit risk/governance policy；runtime 不从 model text、client payload、channel metadata、gateway record 或 capability arguments 推断授权语义。pending request 只显示 safe summary；answer 只表达 approve/deny。

理由：客户端不可信，不能让 answer payload 指定授权范围；同时不扩展核心 pending object。

### D2：authorization 只消费一次

选定方案：approve 只恢复 checkpoint 中绑定的一次操作。执行或恢复该受保护操作后，该 approval 必须视为 consumed；retry、replay 或 recovery 不得把同一 approval 用于第二个受保护操作。执行后该 authorization 不能被后续工具调用、其他 run 或同 run 其他 operation 复用。

理由：授权是针对具体风险和上下文的用户决定，不是会话级 blanket permission。

### D3：timeout/deny 都是 no-execution

选定方案：deny 和 timeout 都阻止受保护操作执行；timeout 不自动 approve。

黑盒效果：用户没有明确授权时，系统不会执行敏感或受限操作。

## 质量属性设计（Quality Attributes）

安全：authorization scope 不来自客户端；deny/timeout 不执行；approve 不可复用。验证入口是 runtime negative tests；capability guard negative tests 属于后续 guard integration change。

性能/容量：authorization 不引入额外 store；复用 checkpoint 和 pending store。验证入口是 integration tests。

可靠性/恢复：approve 后从 checkpoint 执行绑定操作；重启后仍能识别 pending 与 checkpoint。验证入口是 recovery tests。

可维护性：risk policy 决策、capability guard、runtime pending lifecycle 分离；本 change 不新增 generic risk/policy port。验证入口是 architecture tests。

可测试性：approve、deny、timeout、invalid answer、replay/reuse 都可测试。

审计/可追溯性：本 change 提供 safe pending refs 和 capability/run coordinates；已有 observability/audit 基线只能消费这些 safe refs，不得改变 authorization lifecycle outcome。验证入口是 audit derivation review。

## 验证映射（Verification Map）

- approve only bound operation：T2.1；runtime integration test。
- deny blocks operation：T2.2；negative test。
- invalid answer blocks operation：T2.3；negative test。
- timeout denial：T3.1；timeout test。
- client cannot set scope：T1.2、T4.1；security negative test。
- no reuse：T2.4；replay/reuse negative test。

## 文档承载决策（Documentation Ownership）

- 行为契约：`openspec/specs/authorization-pending-input/spec.md`。
- 架构设计：runtime/user-interaction boundary 文档；risk/capability guard 交互设计由后续消费 change 补充。
- 模块设计：`agent-runtime`，以及后续消费 change 中的 `agent-capability`、governance/risk policy、observability 模块文档。
- ADR：无。
- 导航：`openspec/designs/spec-to-design-map.md`。

## 风险与取舍（Risks / Trade-offs）

- [风险] operation binding 需要恢复。-> 绑定在 checkpoint/continuation 中，而不是 process-local memory。
- [风险] approve 被复用。-> pending id/run/checkpoint/op continuation 一次性消费，测试覆盖 reuse negative case。
- [取舍] 不新增 scope 字段。-> 遵守 core contract，降低泄漏和伪造风险。

## 迁移计划（Migration Plan）

无生产迁移。

## 归档前更新基线（Baseline Promotion Plan）

- 新增 `openspec/specs/authorization-pending-input/spec.md`。
- 更新 runtime/user-interaction architecture；risk policy/capability guard 相关模块文档由后续消费 change 更新。
- 更新 `openspec/designs/spec-to-design-map.md`。

## 待确认问题（Open Questions）

无。
