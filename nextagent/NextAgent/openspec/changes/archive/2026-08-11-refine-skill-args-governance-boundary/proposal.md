## Why

Agent 开发者在电信告警、网络路径、运营商识别和任务预算等场景中，会让模型通过 `Skill.args` 传递带有治理含义词汇的业务字段。字段名本身不能证明模型正在控制框架执行；对 `mode`、`path`、`providerId`、`timeoutMs`、`childBudget` 或 `providerOverride` 等名称建立全局黑名单，会把合法 task data 误判为执行治理控制并导致 Skill 无法加载。

框架已经从可信 runtime context、policy 和受治理 metadata 获取实际 timeout、budget 与 provider selection。`Skill.args` 不应成为这些控制的来源，因此不需要通过猜测业务字段名来维护安全边界。

## 目标与非目标（Goals / Non-Goals）

**目标：**

- `Skill.args` 中的全部字段名都作为普通业务 task data 通过全局字段名检查，包括 `mode`、`path`、`directory`、`provider`、`providerId`、`timeout`、`budget`、`timeoutMs`、`timeout_ms`、`childBudget`、`child_budget` 和 `providerOverride`。
- 框架执行治理只使用可信 runtime context、policy 和受治理 metadata，不读取或解释 `Skill.args` 中的同名字段。
- 模型可见的 Skill Tool 描述明确说明 `args` 只承载 task data，不能改变框架执行治理。

**非目标：**

- 不为各 Skill 增加 `argsSchema`，也不定义 per-Skill 语义校验。
- 不改变 `Skill.args` 的 JSON object、可序列化、字节数和嵌套深度边界。
- 不改变 Skill 解析、disclosure、source loading、resource projection、执行模式或实际执行治理策略。

## What Changes

- 移除 `Skill.args` 的全局递归字段名黑名单；任何字段都不得仅因名称被框架拒绝。
- 移除字段名黑名单专用的失败原因、修正提示和模型指导。
- 修改 Skill Tool 的 model-facing 描述，说明所有 `args` 字段都是 task data，且不会覆盖可信执行治理。

## Function 影响（OpenSpec Capabilities）

### 新增 Function

无。

### 修改的 Function

- `FN-5.9 调用技能` → `specs/skill-tool/spec.md`
  - 功能边界：模型通过 `Skill.args` 提交 task data 时，系统不按字段名拒绝输入，也不从这些字段派生执行治理。
  - 系统质量属性：安全、可维护性、可测试性。
  - 映射说明：canonical spec；不触及 legacy spec。

## 影响范围（Impact）

- Agent 开发者和电信业务 Skill 可以直接使用与框架治理词汇同名的业务字段。
- 受影响实现和验证集中在 Skill Tool 描述、input validation 与 `agent-capability` 单元测试；公共 `agent-contracts` 不变。
