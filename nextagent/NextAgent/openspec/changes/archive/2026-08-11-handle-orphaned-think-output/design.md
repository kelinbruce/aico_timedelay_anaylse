## 设计范围

| Function | 本次目标变化 | 涉及 delta specs | 设计章节 |
|---|---|---|---|
| `FN-1.20 查看推荐问题` | 防止缺失开启标签的推理内容进入推荐结果 | `question-recommendation` | `FN-1.20 查看推荐问题` |

## `FN-1.20 查看推荐问题`

### 目标与规范依据

问题推荐结果必须把孤立 `</think>` 视为缺失开启标签的异常推理边界，只解析最后一个孤立闭合标签之后的内容；既有正常标签和普通问题输出行为保持不变。

#### 本 Function 的目标 Requirements

canonical spec：`question-recommendation`

- `MODIFIED`：`Recommendation Output Cleaning`

### 当前实现

`agent-session` 的 `parseQuestions()` 在分段解析前调用私有 `cleanModelOutput()`。该函数依次删除完整思考块、未闭合 `<think>` 及其后内容、孤立闭合标签、Markdown 围栏，之后由 parser 清理叙述性文本、标题和序号。

当前孤立闭合标签处理只删除 `</think>` 字面量。当供应方省略 `<think>` 时，闭合标签之前的裸露推理仍会进入候选段。现有 focused tests 只覆盖闭合标签位于输出开头的情况，没有覆盖其前方存在推理内容的异常响应。

### GAP 分析

| 规范目标 | 当前事实 | GAP |
|---|---|---|
| 只解析最后一个孤立闭合标签之后的内容 | 当前只删除闭合标签字面量 | 裸露推理可能被解析和展示 |
| 大小写不敏感且多个孤立标签采用最后边界 | 当前正则大小写不敏感，但不执行边界截取 | 缺少边界语义及对应测试 |
| 标签之后无有效问题时返回空列表 | 裸露推理可能成为非空候选 | 缺少安全空结果验证 |

### 修改方案

保持 `parseQuestions()` 和清洗步骤顺序不变，仅替换 `cleanModelOutput()` 中孤立闭合标签的处理：在完整标签对和未闭合开启标签已清除后，对当前字符串执行大小写归一化查找最后一个 `</think>`；存在时从该标签结束位置截取后缀，不存在时保持原字符串。

`agent-session` 继续拥有推荐生成和输出解析语义；不修改 model adapter、API projection、前端、缓存或 runtime lifecycle。该方案不新增状态、数据结构或跨 package contract。使用最后一个闭合标签作为唯一边界，可避免异常响应中多个孤立标签之间的推理残片进入结果。

Focused behavior tests 通过 `parseQuestions()` 的公共结果验证正常、边界和安全空结果，不断言私有 helper 的内部实现。

#### 质量属性影响

| 质量属性 | 规范依据 | 本 Function 内实现机制 | 验证关注点 |
|---|---|---|---|
| 安全 | 无新增黑盒质量目标；由 `Recommendation Output Cleaning` 功能性 Requirement 约束 | 孤立闭合标签之前的不可区分内容默认丢弃 | 裸露推理不进入返回数组 |
| 可靠性/恢复 | 无新增黑盒质量目标；由 `Recommendation Output Cleaning` 功能性 Requirement 约束 | 对截断或标签异常响应产生确定结果 | 多标签、大小写和空后缀行为稳定 |
| 可测试性 | 无新增黑盒质量目标；由 `Recommendation Output Cleaning` 功能性 Requirement 约束 | 复用公共 parser 作为验证边界 | 测试只断言可观察问题列表 |

## 验证策略（Verification Strategy）

- unit/characterization 层通过公共 `parseQuestions()` 验证完整标签、未闭合开启标签、缺失开启标签、多个孤立闭合标签、大小写混合标签和无标签输出。
- negative case 验证孤立闭合标签之前的裸露推理不会出现在问题数组，且标签之后无有效内容时返回空数组。
- TypeScript build 验证源码能够生成有效 `dist` 产物；OpenSpec strict validation 验证 delta 与 canonical Requirement 一致。
- 人工语义审查确认没有改变 API、模型调用、runtime lifecycle 或 package ownership。

## 长期基线刷新计划（Baseline Promotion Plan）

- `openspec/specs/question-recommendation/spec.md`：归档时更新 `Recommendation Output Cleaning`。
- `openspec/designs/functions/D1-会话与流式交互/D1.4-智能输入辅助/FN-1.20-查看推荐问题.md`：归档时更新处理过程和结果摘要。
- Feature：无。
- `openspec/overview.md`：无。
- architecture：无。
- `openspec/designs/modules/agent-session.md`：归档时补充异常思考标签的安全清洗边界。
- ADR：无。
- `openspec/designs/spec-to-design-map.md`：无导航变化。

## 风险与取舍（Risks / Trade-offs）

- 如果供应方在最终答案之后错误追加孤立 `</think>`，最后边界策略会丢弃此前答案并返回空列表。由于标签之前的文本无法可靠区分推理与答案，选择安全丢弃，避免推理泄露。
- 该修复不解决模型长时间生成推理造成的时延；模型选择和推理参数属于独立问题。

## 待确认问题（Open Questions）

无。
