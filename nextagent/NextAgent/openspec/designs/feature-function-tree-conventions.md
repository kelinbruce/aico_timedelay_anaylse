# 特性与功能树编写规范

> 定位：本规范约束 `openspec/designs/features/` 与 `openspec/designs/functions/` 下特性树和功能树的切分粒度、文件组织、内容结构和语言风格。所有域的编写须遵循本规范。

## 1. 核心概念

| | 特性（Feature） | 功能（Function） |
|---|---|---|
| 本质 | 用户价值聚合 | 系统黑盒能力单元 |
| 一句话标准 | actor 能单独感知并评价的一个价值承诺 | 系统提供什么能力，以及该能力的前置条件、输入、处理过程、输出和结果 |
| 回答的问题 | “actor 能获得什么价值” | “系统能做什么” |
| 关系 | 一个 Feature 由一个或多个 Functions 形成 | 一个 Function 承载多个用例路径，并可被一个或多个 Features 复用 |

## 2. 粒度标准

### 2.1 特性粒度

- ✅ **价值完整**：一个特性表达一个可独立说明的价值，不依赖另一个特性才有意义。
- ✅ **有功能支撑**：特性至少关联一个 Function；允许多个 Features 复用同一 Function，不要求为了形成专属关系复制 Function。
- ❌ **不按技术通道/接口拆**：SSE/WebSocket 不拆成两个特性，那是功能层。
- ❌ **不把两个不同价值合成一个**：用户会分别感知、分别评价的，应拆开。

### 2.2 功能粒度

- ✅ **系统能力单元**：Function 的主角是系统；按黑盒输入、目标和主要契约边界识别能力，不按用户交互步骤识别。
- ✅ **多种结果不拆**：同一能力的成功、失败、权限不足、超时和降级结果属于同一 Function 的不同 Requirement/Scenario，**不按结果拆**。
- ✅ **能力边界不同才拆**：黑盒输入、目标或主要契约边界显著不同时，拆为不同 Functions；仅内部 owner、调用链或存储机制不同不构成拆分理由。
- ✅ **通道差异归行为契约**：SSE/WebSocket 等技术通道在黑盒契约等价时不拆成独立 Function，通道等价性由 spec 定义。
- ❌ **测试点/不变式不作为独立功能**：一致性校验、不变式保证等归入相关 Function 的行为契约，不独立成功能。
- ❌ **不按参数变体拆**：同一行为的不同参数值（如边界值）是同一功能的用例，不拆。

### 2.3 太粗/太细判断信号

| 信号 | 含义 |
|---|---|
| 特性描述用"与"连接两个价值 | 特性偏粗，考虑拆 |
| Function 的黑盒输入、目标或主要契约边界互不相关 | Function 偏粗，考虑拆分 |
| 一个 Function 的 Scenarios 无法归入同一系统能力 | Function 偏粗 |
| 两个 Functions 只有私有实现路径不同，黑盒契约相同 | Function 偏细，合并 |
| Function 只是同一行为的参数变体 | 偏细，合并 |

## 3. 切分维度

- **主维度：系统黑盒能力边界**。按前置条件、输入、目标行为、输出和结果识别 Function；内部模块或存储差异归 design。
- **通道差异归行为契约**。SSE/WebSocket 等通道不产生独立 Function；等价性、差异和适用条件由 stable spec 定义。
- **用例路径归 Scenario**。Scenario 是 Requirement 的确定验收路径，可以对应用例路径，但不等同于完整用例或 Function。
- **测试点归 Requirement/Scenario**。不变式、一致性保证和失败/降级结果不独立成 Function。

## 4. 目录结构

```
openspec/designs/
  features/
    index.md                          # 特性树根，承载完整目录树
    D{域号}-{能力域名}/
      D{域号}.{子域号}-{子域名}/
        F-{域号}.{序号}-{特性名}.md   # 叶子文件，一个特性一个文件
  functions/
    index.md                          # 功能树根，承载完整目录树
    D{域号}-{能力域名}/
      D{域号}.{子域号}-{子域名}/
        FN-{域号}.{序号}-{功能名}.md  # 叶子文件，一个功能一个文件
```

- 特性树和功能树共享能力域、子域编号和命名，仅用于分类导航；Feature 与 Function 的关系必须由叶子文档显式声明。
- 叶子文件 = 一个特性或一个功能，独立成文件。
- `index.md` 承载目录树导航，标注每个叶子节点的状态。

## 5. 编号方案

| 对象 | 编号格式 | 示例 |
|---|---|---|
| 能力域 | D{域号} | D1 会话与流式交互 |
| 子域 | D{域号}.{子域号} | D1.1 流式交互与恢复 |
| 特性 | F-{域号}.{域内连续序号} | F-1.1、F-1.2、F-1.3 |
| 功能 | FN-{域号}.{域内连续序号} | FN-1.1、FN-1.2、FN-1.3 |

- 特性和功能的序号在**域内连续**，不按子域重置。
- Feature 与 Function 通过叶子文档建立双向导航：Feature 文件列“组成 Functions”，Function 文件列“覆盖特性”。不得按 `F-*` 与 `FN-*` 编号推断一一对应关系。

## 6. 文件内容结构

### 6.1 特性文件

```
# F-x.y 特性名称
> 面包屑导航（能力域 · 子域 · 返回特性树）

| 项 | 值 |
|---|---|
| 状态 | 稳定 / 稳定基线+在建补齐 / 在建 / 规划 |
| 组成 Functions | 链接到一个或多个 Function 文件 |
| spec 导航 | 通过组成 Functions 导航到 stable specs |

## 用户价值
（说明哪个 actor 在什么问题下获得什么价值，以及达到什么程度）

## 主要用例
- （actor 使用组成 Function 达成目标的主要路径；不复制 spec Scenario）

## 黑盒边界
- （该 Feature 包含和排除的用户可依赖边界）

## 适用质量属性
- （质量属性名称及其 stable spec 导航，不复制 Requirement）
```

### 6.2 功能文件

```
# FN-x.y 功能名称
> 面包屑导航（能力域 · 子域 · 返回功能树）

| 项 | 值 |
|---|---|
| 当前状态 | 稳定 / 稳定基线+在建补齐 / 在建 / 规划 |
| 覆盖特性 | 链接到一个或多个 Feature 文件 |
| 主规格 | 新 Function 链接到唯一 stable spec；legacy Function 标明与其黑盒边界匹配度最高的主规格 |
| 遗留规格 | 仅在尚有未迁移 Requirements 时保留实际既有导航；没有时省略 |
| 接口 | 适用时列 HTTP API、public contract 或规范事件；没有接口时省略 |

## 描述
（从系统视角说明该 Function 提供什么黑盒能力）

## 前置条件
- （调用该 Function 前必须满足的黑盒条件）

## 输入
| 参数 | 必填 | 说明 |
|---|---|---|
| ... | ... | ... |

## 输出
（返回内容、格式、示例）

## 处理过程
1. （只描述契约可见的校验、状态判定、状态转换、可见性变化和产出）

## 结果
- 正常：...
- 异常1：...
- 异常2：...

## 规格
| 规格项 | 规格值 | 权威来源 |
|---|---|---|
| ... | ... | stable spec 的精确 Requirement |
```

Function 不得描述 owner、内部模块协作、调度、持久化路径、事务、锁、CAS、私有调用路径或私有状态表示；这些事实归 design。
OpenSpec capability 等同 Function。新 Function 必须且只能对应一个 `openspec/specs/<capability>/spec.md`。
按当前模板新建或作为 canonical target 主动修改的 spec，必须在 Requirements 之前声明唯一所属 Function；
其中的 Requirements 继承该 spec 级归属，不逐条重复。归档后的 stable spec 必须保留同一 Function 元数据。
未被 change 触及且尚未完成 canonical 收敛的 legacy stable spec 不要求批量回填。
legacy Function 以前置条件、输入、目标行为、输出和失败语义选择主规格；尚未触及的 Requirements
可以继续留在遗留规格，但不得扩张多对多映射。

主规格 delta 的“Function 变更汇总”是归档时刷新长期 Function 文档的非规范性字段补丁。汇总必须按上述
Function 实际字段组织，只列发生变化的字段；同一字段只出现一次，并把全部相关 ADDED/MODIFIED Requirements
合并为该字段的目标态，不再按 Requirement 或“变更 1/变更 2”重复总结行为。普通字段写明变更类型、目标内容
和依据 Requirements；规格字段按规格项保留原规格值、目标规格值和依据 Requirements。`主规格`与
`遗留规格`分别作为实际 Function 字段表达，不创建“规格导航”等替代字段。每个改变长期 Function 内容的
Requirement 至少被一个字段引用，每个字段也必须有 Requirement 依据；汇总不得建立第二套规范。

### 6.3 legacy Requirement 收敛

legacy 收敛以 Requirement 为粒度，执行“触及即迁移；不因迁移顺带处理未触及内容”：

1. Requirement 的输入、目标行为、输出、失败语义、规范归属或完整目标态正文发生实质变化时视为“触及”；
   格式、链接、错别字和不改变语义的翻译不视为触及。
2. 被触及 Requirement 不在 Function 的主规格时，必须在同一 change 使用来源 `REMOVED` 与目标
   `ADDED/MODIFIED` 原子迁移，不得只复制。
3. 混合 Requirement 必须无损拆分：当前 Function 黑盒行为迁入其主规格，其他 Function 黑盒行为
   迁入对应主规格，白盒内容归 design；来源 Requirement 整体移除，不得把剩余片段重新写回来源 spec。
   来源 spec 中完全未触及的其他 Requirements 原位保留。
4. 没有合适现有 spec 时，可以为已有 Function 创建新的主规格，但必须同步迁入本次触及 Requirements，
   不得创建空壳或重复 spec；这属于 legacy 收敛，不代表新增 Function。
5. 来源 stable spec 只有在归档后没有任何 Requirement、全部行为已有目标承载、没有并行 active change 引用，
   且 Function、Feature、spec-to-design-map 与相关导航在同一 change 清理完成时才允许退役。
6. 整个 Function 的退役仍需专门 change，不得以 stable spec 退役代替。

## 7. 语言风格

- **通俗严谨书面语**：Feature 使用 actor 视角，Function 使用系统视角；两者都不用口语。
- **去掉代码层术语**：不出现 StreamEnvelope、RuntimeSessionPort、projection service、canonical timeline、adapter、framing 等实现概念。
- **保留必要概念**：SSE、WebSocket、会话、请求、游标、历史消息等测试同学能理解的术语可保留。
- **名称通俗化**：特性和功能的文件名、标题用严谨书面语，不堆技术词。如"过程透明的流式交互体验"→"实时查看处理过程"，"断点续传补充"→"断线后从上次位置继续"。
- **处理过程只写契约可见过程**：可以写“系统校验前置条件→判定契约状态→产生可见结果”，不得写 owner、模块调用、数据库、调度或事务路径。

## 8. 规格摘要

Function 的“规格”是从 stable spec 提炼的关键黑盒能力摘要，供用户、Agent 开发者、运维人员、平台集成方、
开发人员和测试人员快速确认能力边界。stable spec 仍是唯一规范来源；规格表不得建立第二套义务，摘要与
stable spec 冲突时必须修正摘要并以 stable spec 为准。

每个 Function 都必须包含非空 `## 规格` 章节。该章节是 Function 的“能力铭牌”，不是 Requirement 目录、
开发者 API 参考或设计摘要；通常只保留 1–4 个相互独立的关键项，不为凑数量增加内容。超过 4 项不是形式错误，
但必须逐项确认其省略会直接改变使用者对能力范围、兼容性或黑盒验收结论的判断。

规格值不限于数值，可以是：

- 数量、大小、频率、时延、超时、并发、容量、保留期和重试次数；
- 默认值、取值范围、枚举和精确成员清单；
- 支持的模式、阶段、类型、来源或兼容范围；
- 足以影响调用方兼容性或黑盒验收结论的简短排序、回退、失败或安全规则。

只收录满足以下条件的关键规格：省略该事实后，Function 的能力范围会变得不清楚，独立开发者可能实现出
用户可感知的不同行为，或测试人员无法唯一判断实现是否合格。规格表不复制完整 Requirement、Scenario、输入输出、
处理过程或失败流程；这些内容继续由 Function 其他字段和 stable spec 承载。

以下内容不进入 Function 规格表：方法签名、字段级 schema、可修改字段清单、内部类型、owner、模块协作、
调用路径、装配字段、诊断投影，以及只用于解释实现的中间状态。它们应留在 stable spec 的完整契约、开发者文档
或 design/architecture 中。只有整个精确集合本身定义 Function 对外能力范围时才列清单，例如 Hook Function
列出支持的 Hook 点；某个 Hook 点内部允许修改哪些字段则不属于关键规格。

| 列 | 说明 |
|---|---|
| 规格项 | 面向黑盒使用者的稳定能力要点名称 |
| 规格值 | 简短且确定的数值、默认值、枚举、精确清单、支持范围或规则 |
| 权威来源 | stable spec 的精确 Requirement 名称 |

- 规范性集合必须列出决定兼容性或验收结论的成员，不得只写成员数量。例如 Hook Function 必须列出具体 Hook 点，而不能只写“9 个”。
- 数值规格必须保留单位、适用对象和必要的计数或测量边界；缺少这些定义的数值不得进入规格表。
- 规格表只记录 stable Requirement 已经定义的事实，不得出现“建议评审值”“当前实现值”或仅有代码与测试证据的事实。
- observability metric 是运行时采集数据，不等同于 Function 规格；只有 metric inventory、允许标签等本身构成该 Function 的用户可依赖契约时，才作为规格值摘要。
- `主规格`和`遗留规格`是行为契约导航字段，不得用来替代 `## 规格`，也不得创建“规格导航”等平行字段。
- 该格式按触达范围增量收敛：新建 Function 和本次实际刷新“规格”字段的 Function 必须整体使用三列表格；
  未触达该字段的存量 Function 不要求在无关 change 中批量改写，但后续首次触达时不得保留旧状态列、候选值或实现值。

## 9. 状态定义

| 状态 | 含义 | 事实源 |
|---|---|---|
| 稳定 | 已归档稳定行为契约，可在产品路径上依赖 | `openspec/specs/` 归档 spec |
| 稳定基线+在建补齐 | 已有最小稳定基线，active change 正在扩展 | 两者均有 |
| 在建 | 已有 active change 但未归档，契约/实现可能调整 | `openspec/changes/` 非 archive 目录 |
| 规划 | roadmap 提及但无归档 spec 也无 active change | `openspec/overview.md` 范围外说明 |

## 10. 交叉链接

- Feature 文件“组成 Functions”列：链接到对应 Function 文件。
- Function 文件“覆盖特性”列：链接到对应 Feature 文件。
- 新 Function 的“主规格”列：链接到唯一 stable spec；legacy Function 标明主规格，并仅在尚有
  未迁移 Requirements 时保留“遗留规格”导航，不增加新的多对多映射。
- 面包屑导航：叶子文件顶部标注能力域·子域·返回树。
- `index.md` 目录树：每个叶子节点可点击跳转到对应文件。

## 11. 编写流程

1. 确定能力域的子域划分（按价值/能力子域）。
2. 在每个子域下切分 Feature（按 actor 价值）。
3. 按系统黑盒输入、目标和主要契约边界识别 Functions；允许多个 Features 复用同一 Function。
4. 校验：Feature 是否由至少一个 Function 形成、Function 是否是系统能力而非用例/测试点/私有实现、每个新 Function 是否唯一映射一个 spec、legacy Function 是否标明主规格。
5. 为每个特性和功能创建叶子文件。
6. 更新 `index.md` 目录树。
7. 校验 Feature 与 Function 的显式双向链接一致；不得按编号推断一一对应关系。
