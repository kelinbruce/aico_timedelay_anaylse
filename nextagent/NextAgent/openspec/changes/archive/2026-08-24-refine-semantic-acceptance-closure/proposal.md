## Why

使用 builtin `SYSTEM_PROMPT` 的 Agent 在执行规则驱动的数据分析、交叉校验和审计任务时，即使已创建全部要求的工作区产物并通过 JSON、CSV 等格式检查，仍可能遗漏部分输入证据、错误应用分类规则，或让汇总数量与明细结果不一致。对用户和运维人员而言，这类结果表面完整但语义不正确，现有“产物存在且格式有效”的完成条件不足以支持可靠交付。

本 change 将“语义验收闭环”定义为：在宣称任务完成前，把与所请求结果相关的用户显式规则逐项关联到本地来源证据和产出结果，并复核规则覆盖、证据支持以及结果间一致性。该能力是既有有界产物执行指导的后续收口，当前需要先明确唯一、可验证且不扩张 runtime 边界的 package 方案。

## 目标与非目标（Goals / Non-Goals）

**目标：**

- 使用 builtin `SYSTEM_PROMPT` 的 Agent 对规则驱动的 workspace task 接收明确的语义验收指导：逐项核对显式规则、来源证据与对应结果，不以文件存在或格式通过替代语义正确性判断。
- 对分类、聚合、交叉引用和审计结果，指导模型从来源证据重新核对关键分类、数量与引用关系，并在不一致时修正结果后再宣称完成。
- 当来源证据不足或显式规则相互冲突时，指导模型保留可核查的限制说明，不编造缺失事实。
- 保持指导与特定评测无关，并可通过确定性 Prompt Template assembly 测试验收。

**非目标：**

- 不新增自动语义验证器、第二次模型调用、强制 Tool 调用、隐藏答案或领域专用规则引擎。
- 不修改 Agent loop、request lifecycle、重试、超时、terminal commit、模型输出恢复或 Tool 执行语义。
- 不修改 Prompt Template schema、选择优先级、Agent package 覆盖语义、公共 API 或 `agent-contracts`。
- 不改变既有有界产物推进、格式验证和工作区产物创建职责，不在本 change 中处理多轮收敛或输出长度问题。
- 不承诺确定的评测分数提升；随机模型效果由后续定向回归或完整评测确认。

## What Changes

- 修改 builtin `SYSTEM_PROMPT` 的任务指导：对正确性依赖显式规则和本地证据的 workspace task，要求模型在完成前逐项建立与所请求结果相关的规则、来源证据与产出结果之间的对应关系，并核对覆盖完整性。
- 增加对分类、聚合、交叉引用和审计结果的语义一致性指导：关键数量、分类和引用关系必须从来源证据重新核对；发现差异时必须先修正或明确限制，不能仅凭格式检查通过宣称完成。
- 增加确定性回归，验证语义验收指导被装配、保持评测无关，并保留 Agent package 的既有覆盖语义。

## Function 影响（OpenSpec Capabilities）

### 新增 Function

无。

### 修改的 Function

- `FN-10.4 自定义工具和提示词` → `specs/prompt-template-assembly/spec.md`
  - 功能边界：修改 builtin `SYSTEM_PROMPT` 的任务完成指导，使规则驱动的 workspace task 在宣称完成前执行规则、证据与结果的语义验收闭环；不改变模板 schema、选择规则或 Agent 自定义覆盖语义。
  - 系统质量属性：可靠性/恢复、可测试性。
  - 映射说明：`prompt-template-assembly` 为 canonical spec；本 change 仅修改该 spec。

## 影响范围（Impact）

- 使用 builtin `SYSTEM_PROMPT` 的 Agent 模型输入会增加通用的语义验收指导；简单问答、探索性请求和 Agent package 自定义 `task_approach` 不受影响。
- `agent-context-engine` 的 builtin Prompt Template 内容资源与确定性 assembly 测试受到影响。
- HarnessBench task、oracle、rubric、grader、评分公式和失败诊断不受影响。
- 公共 API、配置、运行时 contract、模型 provider、Tool 和其他 package 源码不受影响。
