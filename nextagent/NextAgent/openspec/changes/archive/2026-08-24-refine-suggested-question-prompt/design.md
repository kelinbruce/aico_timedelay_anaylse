# Design

## Context

推荐问题生成由 `agent-session` 的 `SuggestedQuestionService` 实现。`SUGGESTED_QUESTION_SYSTEM_PROMPT` 固化任务定位、选择规则和输出格式；`CAPABILITY_DESCRIPTION_SYSTEM_RULE` 仅在 `capabilityDescription` 非空时追加为下一条编号规则。user message 继续只组装用户问题、最终回答、可选产品能力范围和可选 Skill 上下文，动态上下文解析和输出清洗不变。

## `FN-1.20 查看推荐问题`

### 目标与规范依据

本 change 只修改 system prompt 的推荐策略和口吻约束，目标是让模型预测用户得到当前回答后的自然追问，而不是生成助手引导式问题。规范依据为 `Prompt Variable Resolution` 的用户追问预测、上下文不足、用户口吻、能力范围附加规则和输出格式约束。

### 修改方案

- 将 `SUGGESTED_QUESTION_SYSTEM_PROMPT` 替换为用户追问预测任务定义：
  - 选择规则 1-6 覆盖自然下一步、确认/原因/条件、上下文不足、单一意图与用户口吻、事实边界、自然问句与助手口吻禁止。
  - 输出规则保持三条纯文本问题，并明确禁止代码块。
- 将 `CAPABILITY_DESCRIPTION_SYSTEM_RULE` 替换为编号 7 的能力范围与追问偏好规则。
- 不修改 `renderRecommendationContext()`、模型请求参数、解析逻辑、缓存或触发路径。
- 本次不新增“追问偏好”输入源；附加规则中的条件不改变当前 user message 的实际字段，也不会生成空偏好标签。
- 产品能力范围为空时仍不追加 `CAPABILITY_DESCRIPTION_SYSTEM_RULE`。

### 验证方案

更新既有 `suggested-question-service` characterization tests，从模型请求中提取 system prompt，并断言：

- 基础 prompt 包含用户追问预测、用户视角、上下文不足时预测追问、用户口吻和助手口吻禁止。
- 产品能力范围非空时追加编号 7 的能力范围与追问偏好规则。
- 产品能力范围为空或 Provider 未注入时省略该附加规则。
- 现有职责分离、动态上下文填槽和转义行为保持不变。

## Architecture Boundary

- Prompt 仍由 `agent-session` 的推荐问题服务持有，不向 `agent-app`、Web channel 或前端复制。
- 不新增配置项、跨 package contract、持久化字段或目录。
- 不改变 owner scope、agent scope、可信数据源和 capability description provider 的边界。

## 长期基线刷新计划

- 归档前更新 `openspec/specs/question-recommendation/spec.md` 的 `Prompt Variable Resolution` requirement。
- 归档前更新 `openspec/designs/functions/D1-会话与流式交互/D1.4-智能输入辅助/FN-1.20-查看推荐问题.md` 中推荐 prompt 行为说明。
- Function、Feature、overview、architecture、modules、ADR、spec-to-design-map 无需更新。

## 风险与取舍

- Prompt 语义变化可能影响模型输出质量，但输出数量和格式不变，前端无需适配；通过 characterization test 固化关键约束。
- 附加规则提及“追问偏好”而当前没有数据源。为避免 speculative implementation，本次只保留用户指定的 prompt 文本，不新增偏好解析、传递或存储能力。
