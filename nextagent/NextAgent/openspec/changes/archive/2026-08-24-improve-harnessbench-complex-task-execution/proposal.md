## Why

NextAgent 在执行复杂 workspace task 时，可观察到部分任务经过 13 次以上模型请求并消耗大量 token 后，仍未及时形成全部要求的工作区产物；其中大体量单次 Tool call 还可能在模型输出上限处被截断，使已完成的分析无法转化为有效结果。当前 builtin task guidance 未明确要求在完成必要的最小检查后尽早形成最小产物、分段写入和逐项验证。P1 已扩大模型输出预算，本 change 进一步从产品 prompt 边界闭合复杂任务执行效率问题。

## 目标与非目标（Goals / Non-Goals）

**目标：**

- 使用 builtin `SYSTEM_PROMPT` 的 Agent 接收明确的复杂任务执行策略：先完成确定产物结构所需的最小检查，再识别全部必需产物与可本地检查的验收条件，并尽早形成每个产物的最小有效版本。
- 大体量产物使用有界 Tool call 增量补全并执行针对性验证，避免引导模型把全部产物集中到一个超大 Tool call。
- 多步骤任务的策略要求每个模型轮次以推进工作区结果或验证结果为目标，减少只叙述计划而不产生结果的轮次。
- 新执行策略不改变 Tool、公共契约或 task 输入，并可通过确定性测试验证装配结果。

**非目标：**

- 不修改 HarnessBench task、oracle、rubric、评分公式、固定 catalog 或失败诊断 owner。
- 不放宽不完整 Tool call 的运行时校验，不伪造 workspace 产物，不新增产品 Tool 或公共契约。
- 不以本 change 承诺新的 `frameworkEffectScore` 数值；实际收益由后续定向非计分回归或完整评测确认。
- 不新增 HarnessBench 专用 prompt，不把 task id、oracle、rubric、grader 反馈或固定答案写入产品 prompt。

## What Changes

- 修改 builtin `SYSTEM_PROMPT` 的 `task_approach` 指导：对多产物和复杂 workspace task 要求先完成确定结构所需的最小检查，再识别必需输出、尽早创建最小有效文件，使用多个有界 Tool call 增量写入，并在结束前检查文件存在性和明确的本地格式要求。
- 增加确定性回归，验证执行策略装配、benchmark 无关性和 Agent package 覆盖语义。

## Function 影响（OpenSpec Capabilities）

### 新增 Function

无。

### 修改的 Function

- `FN-10.4 自定义工具和提示词` → `specs/prompt-template-assembly/spec.md`
  - 功能边界：修改 builtin `SYSTEM_PROMPT` 的复杂任务执行指导，不改变模板 schema、选择规则或 Agent 自定义覆盖语义。
  - 系统质量属性：性能/容量、可测试性。
  - 映射说明：`prompt-template-assembly` 为 canonical spec；本 change 仅修改该 spec。

## 影响范围（Impact）

- 使用 builtin `SYSTEM_PROMPT` 的 Agent 模型输入会包含与具体 task 无关的复杂 workspace 执行策略；Agent package 对 `task_approach` 的既有覆盖能力保持不变。
- `packages/agent-context-engine` 的 builtin prompt resource 与 prompt assembly 测试受到影响。
- HarnessBench task catalog、oracle、grader、失败诊断与评分公式不受影响。
- 公共 API、运行时 contract、模型 provider 和 Tool 实现不受影响。
