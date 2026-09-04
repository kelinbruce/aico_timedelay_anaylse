## 设计范围

| Function | 本次目标变化 | 涉及 delta specs | 设计章节 |
|---|---|---|---|
| `FN-10.4 自定义工具和提示词` | builtin 任务指导增加规则、来源证据与产出结果之间的语义验收闭环 | `prompt-template-assembly` | `FN-10.4 自定义工具和提示词` |

## `FN-10.4 自定义工具和提示词`

### 目标与规范依据

本设计在既有有界产物推进和格式验证指导之后，补充任务完成前的语义正确性与完整性核对。实现必须只改变 builtin Prompt Template 内容及其确定性验收，不建立新的运行时执行边界。

实施存在一个顺序前提：`improve-harnessbench-complex-task-execution` 已修改同一 builtin `task_approach` 内容资源，本 change 必须以该 change 的目标态为基线实施，不得与其并行改写同一文件。该前置 change 归档或等价落地后，才执行本 change 的 package 实施任务。

#### 本 Function 的目标 Requirements

canonical spec：`prompt-template-assembly`

- `ADDED`：`内置系统提示提供语义验收闭环指导`

### 当前实现

- builtin `SYSTEM_PROMPT` 已通过 `task_approach` section 提供最小结构检查、尽早创建全部必需产物、分段 Tool call 和结束前文件存在性及格式验证指导。
- `PromptTemplateAssembler` 已把该 section 确定性装配到 builtin system prompt；Agent package 对同名 section 的 source priority 和覆盖路径已经存在。
- 现有 prompt assembly 测试已断言有界产物指导存在，并排除 task id、oracle、rubric、grader 反馈和固定答案等评测特化内容。
- 当前指导没有要求模型把全部显式规则逐项关联到来源证据和产出结果，也没有区分“格式有效”与“语义正确”。

### GAP 分析

| 规范目标 | 当前事实 | GAP |
|---|---|---|
| 规则驱动任务在完成前逐项核对与所请求结果相关的规则、来源证据和产出结果 | 当前只识别产物及可本地检查的验收条件 | 缺少规则覆盖与证据支持的完成条件 |
| 分类、聚合、交叉引用和审计结果从来源证据重新核对 | 当前只明确文件存在性和 JSON、CSV 等格式验证 | 缺少关键分类、数量和引用关系的一致性复核 |
| 证据不足或规则冲突时保留限制说明且不编造事实 | 当前任务指导没有定义该语义失败边界 | 缺少安全、可核查的降级指导 |
| 新指导保持通用并保留 Agent package 覆盖 | 既有测试覆盖评测无关性和 source priority | 缺少新增语义验收文案的 positive 与 negative 回归 |

### 修改方案

唯一实现路径是扩展现有 builtin `SYSTEM_PROMPT` 的 `task_approach` 内容资源，并复用既有 Prompt Template assembly 测试：

1. 在既有“产物存在与格式验证”指导之后增加规则驱动任务的语义完成条件：完成前逐项关联与所请求结果相关的全部显式规则、支持判断的来源证据和对应产出结果，并核对覆盖完整性。
2. 增加来源证据复核指导：当结果包含分类、聚合、交叉引用或审计结论时，从来源重新核对适用的关键分类、数量和引用关系；发现差异先修正，再宣称完成。
3. 增加语义降级指导：来源证据不足或显式规则冲突时，在结果中保留可核查的限制说明，不补写无证据支持的事实。
4. 明确文件存在、语法可解析和格式验证通过只能证明结构有效，不能单独替代语义验收。
5. 扩展现有 builtin prompt assembly 回归，断言上述四类指导进入装配结果；沿用既有 benchmark 特化词 negative assertions 和 Agent section override 测试，不新增模型效果测试作为确定性门禁。

该路径不新增 prompt section、变量、schema、配置、内部状态、服务、Tool、模型调用或公共 contract；不修改 template selection、section priority、Agent package 覆盖、Tool loop、runtime lifecycle 和 provider adapter。`agent-context-engine` 继续是 prompt shaping 的唯一 owner，其他 package 无需配套源码变更。

#### 备选方案（Alternatives Considered）

- 自动语义验证器：需要为不同任务引入输出 schema、领域规则或任务专用校验逻辑，无法在当前通用 Function 内保持单一、稳定的输入输出契约，且会形成新的执行边界，因此不选。
- 第二次模型审查：会增加固定模型调用成本、延迟和新的失败路径，仍不能提供确定性正确性保证，因此不选。
- 仅继续加强格式校验：不能发现漏行、错分类、错误引用或汇总与明细不一致，无法闭合本 change 的问题，因此不选。

#### 质量属性影响

| 质量属性 | 规范依据 | 本 Function 内实现机制 | 验证关注点 |
|---|---|---|---|
| 可靠性/恢复 | `内置系统提示提供语义验收闭环指导` | 在现有任务指导中加入规则—证据—结果核对，以及证据不足或规则冲突时的明确降级指导 | 装配结果同时包含正常核对、差异修正和限制说明指导，且不把格式通过视为语义完成 |
| 可测试性 | proposal 的 Function 影响；无新增独立黑盒质量目标 | 复用确定性 Prompt Template assembly 测试，不以随机模型评分作为实现门禁 | positive 文案、negative 边界和 Agent override 非回归均可重复验证 |

## 验证策略（Verification Strategy）

- unit 层验证 builtin system prompt 的最终装配结果包含规则—证据—结果关联、来源复核、差异修正、限制说明和“格式不等于语义正确”指导。
- unit 层以 negative assertions 验证新增内容不包含 task id、oracle、rubric、grader 反馈或固定答案，并验证 Agent package 对 `task_approach` 的既有覆盖结果不变。
- contract 和 architecture 层确认没有新增或修改公共 contract、跨 package 依赖、runtime lifecycle 或 Tool 执行边界。
- OpenSpec strict gate 验证 Function、canonical spec、Requirement 和设计追踪一致。
- 后续定向非计分回归或完整评测只用于衡量真实模型效果，不作为本 change 实施正确性的确定性替代证据。

## 长期基线刷新计划（Baseline Promotion Plan）

- `openspec/specs/prompt-template-assembly/spec.md`：增加 builtin 语义验收闭环指导。
- `openspec/designs/functions/D10-二次开发与平台集成/D10.1-扩展与插件/FN-10.4-自定义工具和提示词.md`：更新描述、处理过程与结果。
- Feature：无。
- `openspec/overview.md`：无。
- `openspec/designs/architecture/prompt-template-assembly.md`：补充 builtin 任务指导的语义验收内容边界。
- `openspec/designs/modules/agent-context-engine.md`：补充 prompt shaping 子模块对该 builtin 内容资源的职责边界。
- ADR：无。
- `openspec/designs/spec-to-design-map.md`：验证入口不变，无内容更新。

## 风险与取舍（Risks / Trade-offs）

- 通用语义核对会增加部分复杂任务的模型推理和 Tool 使用，但触发范围限定为正确性依赖显式规则和本地证据的任务；简单问答和探索性请求不需要执行该闭环。
- Prompt 指导不能保证模型一定得出正确结论；确定性门禁只保证产品提供并正确装配该策略，真实效果必须通过后续评测观察。
- 与前置 change 同时修改同一内容资源会产生实现冲突；通过顺序实施并以其目标态为基线规避，不在本 change 中复制或回退既有有界产物指导。

## 待确认问题（Open Questions）

无。
