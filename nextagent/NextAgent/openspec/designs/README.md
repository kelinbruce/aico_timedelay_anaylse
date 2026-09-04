# OpenSpec Stable Designs

本目录承载归档后的稳定设计事实。active change 阶段的设计先写在
`openspec/changes/<change>/design.md`，归档时再把仍然成立的长期事实提炼到这里。

稳定设计按审查问题组织：

- `spec-to-design-map.md`：stable specs 到 architecture、modules、ADR 和验证入口的导航。
- `architecture/`：架构和跨模块设计，包括系统范围、数据 ownership、安全、可观测、部署、质量属性、核心契约、跨模块状态机和接口语义。
- `modules/`：模块设计，包括代码模块职责、非职责、依赖、消费或暴露的 contract、核心设计落点和验证入口。
- `adr/`：长期有效且需要保留取舍理由的技术决策。
- `features/`：用户价值视图，描述 actor 目标、主要用例、组成 Functions、适用质量属性和当前状态。
- `functions/`：系统黑盒能力视图，描述 Function 的输入、契约前置条件、黑盒行为轮廓、输出、结果、规格导航和当前状态。
- `feature-function-tree-conventions.md`：Feature/Function 的粒度、1:N 组成、显式导航、新 Function-spec 1:1 与 legacy 兼容规则。

目录原则：

- 稳定设计目录只使用 `architecture/`、`modules/`、`adr/`、`features/`、`functions/` 五类子目录。
- Feature 由一个或多个 Functions 形成；Feature 文档不得定义 Requirement 或白盒实现。
- Function 是系统提供的一个黑盒能力单元，主角是系统。Function 的“黑盒行为轮廓”允许描述契约可见的校验、状态判定、状态转换、可见性变化和产出，
  不得描述 owner、内部模块协作、调度、持久化路径、事务、锁、CAS 或私有状态表示。
- OpenSpec capability 等同 Function；新 Function 必须且只能导航到一个 `openspec/specs/<capability>/spec.md`。
  既有多 spec Function 或未映射 spec 属于 legacy baseline，保持现状；修改既有文档不得增加新的多对多映射。
- stable spec 是 Function 行为、系统质量属性和目标规格的唯一规范来源。Feature 和 Function 文档只承载分类、边界、状态、摘要与权威规格导航；发生冲突时以 stable spec 为准。
- 领域对象、状态机、生命周期、不变量、API/SPI/event/schema 调用语义和核心契约属于跨模块设计时，归入 `architecture/`，不得新增平行的 `domain/` 或 `contracts/` 目录。
- 单个 package 的职责、非职责、依赖、替换边界、contract 消费关系和验证关注点归入 `modules/<module>.md`；模块文档只能引用或摘要核心设计，不重复定义跨模块状态机、接口字段或持久化语义。
- 长期关键技术决策和取舍理由归入 `adr/`；ADR 不替代 architecture 或 module 主承载。
- 新增稳定设计目录必须先通过 OpenSpec change 说明新的读者问题、主承载职责、与现有五类目录的边界以及验证方式。

规范性事实只能有一个主承载文档；其他文档只能引用、导航或摘要，不能重复定义状态机、
API schema、data owner 或接口语义。
