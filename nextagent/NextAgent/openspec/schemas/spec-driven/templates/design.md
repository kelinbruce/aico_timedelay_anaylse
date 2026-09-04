## 设计范围

<!--
这是 design 的第一个正文 section，不在其前面放置无标题元数据，也不创建专门的目录章节。
本节只提供紧凑的范围导航：每个受影响 Function 只列一次，概括本次目标变化，列出涉及的 delta specs，
并指向下文该 Function 的独立设计章节。不要在首章展开全部目标 Requirement 明细；
目标 Requirement 清单由各 Function 的“目标与规范依据”承载。
-->

| Function | 本次目标变化 | 涉及 delta specs | 设计章节 |
|---|---|---|---|
| `FN-x.y <canonical name>` | <从 actor/系统黑盒结果概括，不写实现方案> | `<capability-a>`、`<capability-b>` | `FN-x.y <canonical name>` |

<!--
只要本 change 触及 canonical spec 之外的 legacy Requirement，就在本节之后、首个 Function 章节之前增加：

## 存量 Requirement 迁移方案

| 来源 spec / Requirement | 目标 Function / canonical spec | 原子 delta | 其他行为与未触及 Requirements 处理 | 白盒落点 | stable spec 与导航影响 |
|---|---|---|---|---|---|
| `<source>` / `<Requirement>` | `FN-x.y` / `<target>` | 来源 `REMOVED` + 目标 `ADDED/MODIFIED` | <其他 Function 行为的目标，及来源中完全未触及 Requirements 原位保留情况> | <design 章节或无> | <保留来源 spec，或满足门禁后退役并清理导航> |

该章节必须覆盖所有跨 spec 迁移，并确认来源/目标没有未协调的并行 active change。
没有 legacy Requirement 迁移时不得创建该章节。
-->

<!--
以下 Function 章节按 proposal 的 Function 影响逐个创建。每个 Function 都使用相同的四段结构；
不要把多个 Functions 的现状或方案先混成一个总章节。
-->

## `FN-x.y <canonical name>`

### 目标与规范依据

<!--
先用一小段引用 proposal 的该 Function 黑盒目标，说明本设计要满足的结果；不复制 Requirement 正文，
不创建第二套目标值。随后使用“#### 本 Function 的目标 Requirements”，先声明唯一 canonical spec，再按
`ADDED/MODIFIED` operation 列出本 change 最终写入该 canonical spec 的全部目标 Requirements。
来源 specs、`REMOVED` Requirements 和拆分过程只在“存量 Requirement 迁移方案”中说明，不在此处重复。
下方 operation 示例只保留本 Function 实际存在的条目，没有 `ADDED` 或 `MODIFIED` 时删除对应示例行。
只有 Scenario 会直接影响白盒方案时才补充 Scenario 引用。
最后说明影响实现路径或验收的设计约束。
-->

#### 本 Function 的目标 Requirements

canonical spec：`<capability>`

- `ADDED`：`<Requirement 名称>`
- `MODIFIED`：`<Requirement 名称>`

### 当前实现

<!--
只记录该 Function 当前对应的代码事实：已有对象、port、调用链、测试、约束和已知债务。
当前代码行为与 stable spec 不一致时，明确指出差异及其证据。
不复述 proposal 的背景、目标或非目标，不混入目标态决策。
-->

### GAP 分析

<!--
把“规范目标—当前事实—待闭合差距”逐项对应起来。只记录会改变实现或验收的 GAP；
不要把修改方案、未来能力或泛化重构写进本节。
-->

| 规范目标 | 当前事实 | GAP |
|---|---|---|
| <Requirement 或明确目标> | <代码、contract、测试事实> | <需要闭合的唯一差距> |

### 修改方案

<!--
给出闭合本 Function GAP 的唯一、最小、可实施路径，并说明：
- 必须保留的现有实现路径和明确不修改的技术边界；
- 主要 owner、入口、调用或写入边界；
- 内部状态、数据、调度、事务和模块协作（适用时）；
- 输入、输出和失败/降级路径；
- 选择理由和必要的直接取舍；
- 验证关注点。

公共契约 schema 只引用 spec，不在 design 中重新定义。新增或修改私有数据结构时，定义受影响字段的
type、required/optional、nullability、default、allowed values/range、unit/encoding、字段间约束、
trusted source、owner、内部校验、私有存储 shape、内部状态表示和跨层映射。

白盒实现依赖私有状态和转换，而且段落无法闭合私有状态表示、存储、调度、重复或并发控制语义时，
增加最小状态转换表或其他精确表示。条件组合、优先级、排序、计算、grammar 或映射无法由自然语言
唯一表达时，增加最小 decision table、pseudocode、公式、BNF/ABNF、mapping table 或 schema。
不得为无状态行为发明状态，也不得创建空章节或 N/A 表格。

若本 Function 存在实际质量属性设计影响，在“修改方案”末尾增加：

#### 质量属性影响

| 质量属性 | 规范依据 | 本 Function 内实现机制 | 验证关注点 |
|---|---|---|---|
| <只列适用的 canonical 质量属性> | <所属 Function 的系统质量属性 Requirement；只有功能性 Requirement 依据时明确“无新增黑盒质量目标”> | <只写本 Function 局部机制> | <局部测试或审查关注点> |

无实际影响时不创建该小节。不得机械填写六类质量属性，也不得在此复制跨 Function 共享机制。
-->

<!--
复制上面的 Function 章节以覆盖 proposal 中的全部受影响 Functions。

多个 Functions 共享同一启动、调用、状态或失败流程时，在全部 Function 章节之后增加：

## 跨 Function 协作与端到端流程

该章节只描述一次共享集成关系，并反向引用各 Function 的修改方案；不得复制各 Function 已拥有的方案。
没有跨 Function 流程时删除该章节。
-->

<!--
存在会影响实现或验收的实质备选方案时，在相关 Function 的“修改方案”内部增加
“#### 备选方案（Alternatives Considered）”，分别说明适用条件、主要优缺点和未选择理由。
简单取舍直接写入修改方案；没有实质备选方案时不创建该小节。
-->

<!--
只有至少两个 Functions 共享同一质量机制、同一端到端验证，或质量结果只能由跨 Function 组合形成时，
才在全部 Function 章节和可选的“跨 Function 协作与端到端流程”之后增加：

## 跨 Function 质量属性设计（Cross-Function Quality Attributes）

| 质量属性 | 影响 Functions 与规范依据 | 共享或端到端机制 | 端到端验证 |
|---|---|---|---|
| <只列实际适用的 canonical 质量属性> | <Functions + 各自唯一所属 spec 的 Requirements> | <不重复 Function 局部方案的组合关系> | <integration/e2e/architecture/observability 等> |

没有跨 Function 质量影响时不创建该章节。单 Function change 的质量设计只写在该 Function 的“质量属性影响”中。
不得机械列出全部质量属性，也不得在 change 级重新定义黑盒目标或阈值。
-->

## 验证策略（Verification Strategy）

<!--
说明哪些 spec 行为、Function 修改方案、跨 Function 边界和 negative case 分别由何种验证层级覆盖。
验证层级包括 unit、contract、integration、e2e、characterization、architecture 或人工审查。
行为验证必须断言契约、边界条件或系统黑盒可观察结果，不得断言私有实现细节。
这里只定义验证层级和策略；精确 Requirement/Scenario 来源、测试文件和命令由 tasks 承载。
-->

## 长期基线刷新计划（Baseline Promotion Plan）

<!--
按实际影响列出具体目标；没有影响写“无”。本节是归档输入，不是实施 task，不重复目标行为或设计正文。

- openspec/specs/<capability>/spec.md：<新增/修改/无>
- openspec/designs/functions/<path>/FN-x.y-<name>.md：<新增/修改/无>
- openspec/designs/features/<path>/F-x.y-<name>.md：<新增/修改/无>
- openspec/overview.md：<更新内容/无>
- openspec/designs/architecture/<topic>.md：<更新内容/无>
- openspec/designs/modules/<module>.md：<更新内容/无>
- openspec/designs/adr/<id>.md：<新增或更新/无>
- openspec/designs/spec-to-design-map.md：<导航变化/无>
-->

## 风险与取舍（Risks / Trade-offs）

<!-- 只记录决策后仍存在的风险、影响和缓解方式；不重复修改方案中的选择理由。 -->

<!--
涉及部署顺序、兼容窗口、数据迁移、回滚状态或发布风险时，在本节之后增加
“## 迁移与回滚（Migration / Rollback）”，明确迁移前提、执行顺序、兼容边界、
回滚触发条件、回滚动作、回滚后的系统状态和验证方式；否则不创建该章节。
-->

## 待确认问题（Open Questions）

<!--
没有则写“无”。影响行为、契约、owner、安全、持久化或验收的问题必须标记为阻塞项，
不得用 SHOULD、MAY、TODO 或模糊措辞伪装成已收敛设计。
-->
