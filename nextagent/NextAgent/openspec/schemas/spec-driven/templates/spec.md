<!--
本文件是 active change 的 Function 规范 delta，路径为 specs/<capability>/spec.md。
OpenSpec capability 等同 NextAgent Function；归档后，仍然成立的行为契约会同步到 openspec/specs/<capability>/spec.md。

只保留实际使用的 delta operation：
- ## ADDED Requirements：新增 capability 或 requirement。
- ## MODIFIED Requirements：完整重述改变后的既有 requirement，标题与基线精确匹配。
- ## REMOVED Requirements：包含 Reason 和 Migration。
- ## RENAMED Requirements：仅改名，使用 FROM:/TO:。
Operation 必须与同名 target stable spec 的 Requirement 标题精确、区分大小写匹配：stable 已存在时，
ADDED 名称不得已存在，MODIFIED/REMOVED 名称必须恰好存在一次，RENAMED FROM 必须恰好存在一次且 TO 不得冲突；
stable 不存在时只允许 ADDED。跨 spec 迁移的目标名称不存在时使用 ADDED，已存在时使用 MODIFIED。
当前 change 未触及的 stable 重复名称不要求顺带清理；被触及名称匹配多次时必须先消除歧义。
Requirement 跨 spec 迁移必须使用来源 REMOVED + 目标 ADDED/MODIFIED 原子对，不得只复制。
普通 REMOVED 不隐式移除 Function；如果移除后 Function 将不再包含任何 Requirement，当前工作流必须阻塞归档。
清空的 legacy stable spec 仅在全部行为已有目标承载、没有并行 active change 引用，且 Function、Feature、
spec-to-design-map 与相关导航在同一 change 清理完成时允许退役。

主规格 delta 在全部 Requirement operations 之前声明所属 Function、Function 变更类型和 spec 角色，并在
全部 Requirement operations 之后增加“Function 变更汇总”。遗留来源 spec 只承载迁出所需的 REMOVED，
不创建无法唯一对应 Function 的元数据或汇总。
-->

## Function

- **所属 Function**：`FN-x.y <名称>`
- **Function 变更类型**：`ADDED` / `MODIFIED`
- **spec 角色**：主规格

## ADDED Requirements

### Requirement: <!-- 精确的 Requirement 名称 -->

<!--
用中文描述 Function 的系统黑盒契约。Requirement 名称是跨 artifact 的默认引用入口。

语言规则：
- 新建 Requirement 标题默认使用中文。
- MODIFIED Requirement 标题必须与 stable spec 的 canonical 名称精确一致；即使标题是英文，也不得借正文中文化
  静默翻译。确需改名时使用 RENAMED delta，并同步所有跨 artifact 引用。
- 跨 spec 迁移既有 Requirement 时，目标 ADDED Requirement 允许保留来源 canonical 标题，以保持迁移追踪；
  迁移来源、拆分过程和导航影响只能写入 design，不得写入目标 Requirement。
- Requirement 正文、元数据说明、Scenario 标题和 WHEN/THEN/AND 语句默认使用中文。
- BCP 14 关键词以及代码标识符、类型、字段、枚举值、API、package、artifact、命令和路径保留英文。

元数据规则：
- 每个 ADDED Requirement 和完整重述的 MODIFIED Requirement 必须保留“需求类别”。
- 主规格顶部的“所属 Function”是该 spec 全部 ADDED/MODIFIED Requirements 的唯一规范归属；
  Requirement 不重复声明“所属 Function”。归档后 stable spec 必须在 Requirements 之前保留同一 Function 元数据。
- 新建 spec 的全部 Requirements 必须属于该 spec 唯一对应的 Function。
- 系统质量属性 Requirement 必须保留“质量属性”和“适用范围”；多个独立质量义务必须拆分，
  只有不可分割的单一义务才允许列出多个 canonical 质量属性。
- “适用范围”不建立额外的 Function 与 spec 映射。
  系统级或跨 Function Requirement 必须归属于 proposal 指定的唯一 Function，该 Function 的契约可见触发和可观察结果
  必须被 Requirement 的 Scenarios 用于判定合规。
- REMOVED 和 RENAMED 保持 OpenSpec 原生格式，不增加上述元数据。

legacy 收敛规则：
- Requirement 的输入、目标行为、输出、失败语义、规范归属或完整目标态正文发生实质变化时视为“触及”；
  格式、链接、错别字和不改变语义的翻译不视为触及。
- 被触及 Requirement 不在所属 Function 的 canonical spec 时，来源使用 REMOVED，目标使用 ADDED 或 MODIFIED；
  两端必须在同一 change 完成，不得只复制，不得顺带迁移未触及 Requirements。
- 混合 Requirement 的其他 Function 黑盒行为迁往对应 canonical spec，白盒内容归 design；来源 Requirement
  整体 REMOVED，不得把剩余片段重新 ADDED 回来源。来源 spec 中完全未触及的其他 Requirements 原位保留。
- 没有合适 spec 时，允许为已有 Function 创建新的非空 canonical spec，并在同一 change 迁入本次触及内容。

规范关键词：
- 新增强制义务使用 MUST/MUST NOT；只有允许偏离的义务才能使用 SHOULD/SHOULD NOT，
  只有允许选择的行为才能使用 MAY/OPTIONAL。
- 完整重述既有 requirement 时允许保留原有 SHALL/SHALL NOT，不得仅为统一词形扩大 change。
- SHOULD/SHOULD NOT 必须定义允许偏离的客观条件、偏离后的行为和验证方式。
- MAY/OPTIONAL 必须定义选择主体、选择条件、默认结果、选择和不选择或字段缺失时的合规行为及互操作边界；
  不得用于表示 deferred scope、未解决决策或不确定条件。
- 在 Requirement 正文中，小写 must/should/may 或中文“应该”“应当”“可以”不具有规范关键词语义。

Requirement 与 scenarios 共同明确会影响合规判断的责任主体、适用条件、前置状态、输入、行为、结果、
副作用、失败和可观察证据；无关要素不要求机械填写。

推荐句式：
- `<主体> MUST <行为或不变量>。`
- `当 <确定条件> 时，<主体> MUST <行为>；<可观察结果>。`
- `<主体> MUST NOT <行为>；收到违规输入时，<主体> MUST <拒绝或安全结果>。`
- `仅当 <确定条件> 时，<选择主体> MAY <行为>；未选择时，<主体> MUST <默认结果>。`

语言闭合：
- 明确条件不成立、多个条件同时成立、无规则匹配和 exception 覆盖时的结果。
- 使用“全部”“任一”“至少一个”“至多一个”“恰好一个”等明确量词，并说明规范性列表是否穷尽。
- 时间或容量要求定义数值、单位、测量起止和边界；允许测量误差时必须定义容差。
- 不使用“等”“必要时”“正常情况下”“合理处理”“相同机制”“适当”“尽快”或“等价实现”替代契约。

公共 API、公共 contract、规范事件、授权查询投影、合规测试可观察的行为，以及契约可见状态和转换属于 spec。
公共 contract schema 只定义受影响对象和字段的 type、required/optional、nullability、default、allowed values/range、
unit/encoding、字段间约束、未知字段处理行为和契约边界可观察的校验结果。
package、owner、scheduler、数据库、事务、锁、CAS、私有调用路径和私有状态表示不得写入 spec。
如果行为实际依赖有限状态，scenario 必须明确契约可见的前置状态、触发、结果状态和可观察结果。
当 scenarios 无法闭合 initial/terminal state、guard、非法转换、重复或并发语义时，spec 必须使用最小状态转换表或其他精确表示；不得为无状态行为发明状态。
-->

<!--
先在此处写规范性行为正文，并确保首个正文段落包含适用的 MUST、MUST NOT、SHALL 或 SHALL NOT。
OpenSpec CLI 使用首个正文段落校验规范关键词；Requirement 元数据必须位于规范性行为正文之后、首个 Scenario 之前。
-->

**需求类别**：<!-- 功能性需求 | 系统质量属性 -->

<!-- 仅当需求类别为“系统质量属性”时保留以下两行；功能性需求必须删除。 -->
**质量属性**：<!-- 安全 | 性能/容量 | 可靠性/恢复 | 可维护性 | 可测试性 | 审计/可追溯性 -->
**适用范围**：<!-- 该 Function | 系统 | 明确列出的 FN-* Functions -->

#### Scenario: <!-- 场景名称 -->
- **WHEN** <!-- 明确触发、输入和必要前置条件 -->
- **THEN** <!-- 明确责任主体、行为和可观察结果 -->

<!--
Change 整体的 scenarios 必须覆盖实际存在的 normal、boundary 和 failure/degradation path；
不为不存在的路径创建占位 scenario 或 N/A。Scenario 是 Requirement 的确定验收路径，
允许对应用例路径，但不等同于完整用例。Rationale、Note 和 Example 不得引入新义务。
-->

## Function 变更汇总

<!--
本节是 Requirements 对长期 Function 文档影响的非规范性投影，放在全部 ADDED/MODIFIED/REMOVED/RENAMED
sections 之后。Requirements 是行为权威；本节不得新增行为、阈值、失败语义或实现决策，归档时也不得合并到
stable spec。

按长期 Function 文档的实际字段组织，不按 Requirement 或“变更 1/变更 2”重复总结行为。只为实际变化的字段
创建 section，同一字段只出现一次，并把相关 Requirements 的影响合并为该字段的目标态。可用字段为名称、描述、
前置条件、输入、输出、处理过程、结果、规格、接口、覆盖特性、主规格、遗留规格；不得创建“规格导航”“量化指标”等
平行 Function 字段。普通字段固定使用：
- 变更类型：新增、修改或移除。
- 目标内容：用系统黑盒语言直接给出归档后该 Function 字段的合并目标态，不逐条复述 Requirement。
- 依据 Requirements：列出支持该字段变化的本 spec ADDED/MODIFIED Requirements；不得只写 delta operation 或模糊范围。

“处理过程”只能概括契约可见的校验、状态判定或转换、可见性变化和产出。规格按规格项分别写明：
- 规格项。
- 变更类型：新增、修改或移除。
- 原规格值；新增时写“不适用（新增）”。
- 目标规格值：可直接进入 Function `## 规格` 表的简短、确定数值、默认值、枚举、精确清单、支持范围或规则。
- 依据 Requirements。

规格只提炼省略后会导致 Function 能力范围、兼容性或黑盒验收产生实质歧义的关键事实，通常只保留 1–4 个
相互独立的关键项，不要求把每个 Requirement 改写成规格行。方法签名、字段级 schema、可修改字段清单、
内部类型、owner、模块协作、调用路径、装配字段和诊断投影不得作为规格项。精确集合必须列出决定兼容性或
验收结论的成员，不得只写数量。数值规格必须在目标规格值中保留单位、适用对象和必要的计数或测量边界。
每个规格项必须由“依据 Requirements”中的
Requirement 定义；明确标为不变的既有规格必须给出当前 Function 或 stable Requirement 依据。不得补写
没有权威依据的候选值、建议评审值、当前实现值、observability metric 或白盒设计。

“主规格”和“遗留规格”只表示承载 Function 行为契约的 spec 导航，不得替代 Function 的规格摘要。

每个改变长期 Function 内容的 ADDED/MODIFIED Requirement 必须至少被一个字段引用；每个字段也必须能反向追溯
到至少一个 Requirement。Requirement 可以被多个字段引用，但同一字段必须给出一次合并后的目标内容。名称仅在
proposal 已声明 Function 重命名时更新；覆盖特性仅在 proposal 声明 Feature delta 时更新；当前状态由归档后的
stable/active 基线推导，不在本节声明。
-->

### 描述

- **变更类型**：修改
- **目标内容**：<!-- 全部相关 Requirements 对“描述”字段的合并目标态 -->
- **依据 Requirements**：`<!-- Requirement 名称 -->`

### 规格

- **规格项**：<!-- 面向黑盒使用者的稳定能力要点名称 -->
- **变更类型**：<!-- 新增 / 修改 / 移除 -->
- **原规格值**：<!-- 已有规格值；新增时写“不适用（新增）” -->
- **目标规格值**：<!-- 简短且确定的数值、默认值、枚举、精确清单、支持范围或规则 -->
- **依据 Requirements**：`<!-- Requirement 名称 -->`

### 主规格

- **变更类型**：修改
- **目标内容**：`<!-- canonical spec 名称 -->`
- **依据 Requirements**：`<!-- Requirement 名称 -->`
