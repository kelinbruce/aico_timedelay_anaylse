## 设计范围

| Function | 本次目标变化 | 涉及 delta specs | 设计章节 |
|---|---|---|---|
| `FN-10.4 自定义工具和提示词` | builtin task guidance 增加复杂 workspace task 的有界产物推进与验证策略 | `prompt-template-assembly` | `FN-10.4 自定义工具和提示词` |

## `FN-10.4 自定义工具和提示词`

### 目标与规范依据

产品 builtin `SYSTEM_PROMPT` 需要让复杂任务更早形成可恢复的工作区产物，并降低大体量单次 Tool call 被输出预算截断的风险，同时保持 Agent package 覆盖语义。

#### 本 Function 的目标 Requirements

canonical spec：`prompt-template-assembly`

- `ADDED`：`内置系统提示提供有界产物执行指导`

### 当前实现

- `packages/agent-context-engine/prompt-templates/builtin/SYSTEM_PROMPT/task-approach.md` 只定义探索型请求、用户确认与 KISS 指导，未定义复杂 workspace task 的产物推进顺序、单次写入边界和完成前验证。
- `SYSTEM_PROMPT/template.yaml` 已把该文件装配为 builder-owned `task_approach` section；无需增加 section、schema 或变量。
- Agent package prompt 已能按现有 source priority 覆盖同名 section，现有装配测试覆盖该优先级。

### GAP 分析

| 规范目标 | 当前事实 | GAP |
|---|---|---|
| builtin 模型输入包含最小结构检查、尽早落最小产物、分段补全和结束前验证指导 | `task-approach.md` 没有这些规则 | 缺少产品级通用执行指导 |
| 指导保持 benchmark 无关且不改变自定义覆盖 | 当前文件通用，覆盖机制已存在 | 缺少新增文案的 negative assertion 与非回归断言 |

### 修改方案

唯一实现路径是直接扩展现有 `task-approach.md`，不新增 prompt section、配置项或 runtime service：

1. 对明确要求 workspace 文件或多个交付物的任务，只执行确定产物结构所需的最小检查，再识别全部必需产物与可本地验证的验收条件。
2. 结构确定后，尽早为每个必需产物创建最小有效版本；不得为了完善分析而把全部写入推迟到最后一轮。
3. 大体量内容使用多个 Tool call 增量补全；一次 `Write`/`Edit` 只处理一个产物或一个连贯 section，避免一个超大调用承载全部结果。
4. 结束前检查必需文件存在，并用可用 Tool 验证明确的 JSON、CSV 或其他本地格式；失败则继续修正，不宣称完成。
5. 增加 builtin prompt assembly 测试，直接断言目标文案存在、benchmark 特化词和 task id 模式不存在；保留既有 agent section override 测试。

该修改点属于 `packages/agent-context-engine` 的内容资源和测试，不触碰 `agent-contracts`、模型 adapter、Tool loop 或不完整 Tool call 校验。P1 的 16384 output budget 与本策略互补：预算提供容量，prompt 提供更早、更小的写入形状。

#### 质量属性影响

| 质量属性 | 规范依据 | 本 Function 内实现机制 | 验证关注点 |
|---|---|---|---|
| 性能/容量 | `内置系统提示提供有界产物执行指导` | 最小结构检查后尽早落产物、限制单次写入范围并分段补全 | builtin 装配结果包含全部指导且不引入 benchmark 特化 |
| 可测试性 | `内置系统提示提供有界产物执行指导` | 复用确定性的 Prompt Template assembly 测试 | 文案存在、禁止内容缺失、Agent override 非回归 |

## 验证策略（Verification Strategy）

- `agent-context-engine` prompt assembly 单元测试验证 builtin 文案、禁止 benchmark 特化内容和 Agent override 非回归。
- contract、architecture 与 OpenSpec strict gates 验证公共契约和 owner 边界未变化。
- 后续定向 non-scoring 或全量评测衡量实际轮次、token 与分数变化；随机模型效果不作为确定性实现门禁。

## 长期基线刷新计划（Baseline Promotion Plan）

- `openspec/specs/prompt-template-assembly/spec.md`：增加 builtin 有界产物执行指导。
- `openspec/designs/functions/D10-二次开发与平台集成/D10.1-扩展与插件/FN-10.4-自定义工具和提示词.md`：更新处理过程与结果。
- Feature、overview：无。
- `openspec/designs/architecture/prompt-template-assembly.md`：更新 builtin task guidance 内容边界。
- `openspec/designs/modules/agent-context-engine.md`：如现有文档承载 builtin prompt 内容边界则更新；否则无。
- ADR：无。
- `openspec/designs/spec-to-design-map.md`：验证入口不变，无内容更新。

## 风险与取舍（Risks / Trade-offs）

- 通用 prompt 会影响全部使用 builtin `task_approach` 的 Agent；规则限制在明确要求 workspace 产物的复杂任务，不改变简单问答或 exploratory request 的既有语义。
- 分段写入可能增加 Tool call 数，但能更早形成可恢复结果并缩小截断损失；实际净收益由后续评测确认。
- 模型可能不完全遵循指导；确定性门禁只保证产品正确装配策略，不虚构随机模型行为保证。

## 待确认问题（Open Questions）

无。
