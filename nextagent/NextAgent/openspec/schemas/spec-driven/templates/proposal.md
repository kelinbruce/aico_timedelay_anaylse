## Why

<!--
从最终用户、Agent 开发者、运维人员、平台集成方或受影响外部系统的黑盒视角说明：
- 谁遇到了什么问题；
- 问题产生了什么可观察影响；
- 为什么需要现在处理。

不要用 package、owner、port、DTO、私有调用链、SDK API、文件路径或实现步骤代替问题描述。
不要提前展开实现方案。
标题必须保持为 `## Why`，供 OpenSpec CLI 识别。
-->

<!--
仅在下列条件成立时，于目标或范围首次使用前增加对应内容；条件不成立时不得创建章节：
- 术语：change 新增或改变 canonical term 时，定义名称、含义和受控 alias。
- 规范上下文：release、profile、host、版本、默认值、scope、trust source 或权威基线会影响解释时，
  用简短列表或表格冻结具体值和唯一来源。
-->

## 目标与非目标（Goals / Non-Goals）

**目标：**
<!--
用自然语言或简短列表说明完成后 actor 可依赖或系统黑盒可验证的结果。
目标描述结果，不指定由哪个 package、port、SDK 或私有流程实现。
-->

**非目标：**
<!-- 明确系统或 Function 层排除、deferred 和重要不变边界。若排除范围是当前禁止契约，在 specs 中定义对应 MUST NOT 行为。 -->

## What Changes

<!--
本章是变更范围。标题必须保持为 `## What Changes`，供 OpenSpec CLI 识别。
只写本 change 主动授权的行为、契约和边界变化。
按新增、修改、移除说明；每项写明主体、目标结果和范围；破坏性变更标记 BREAKING。
优先描述 actor 可观察的输入、输出、失败、兼容或质量保证变化。
公共契约发生破坏性变化时，只说明调用方可观察边界；字段级 schema 由 specs 定义，实现机制由 design 定义。
仅因变更而被动波及的代码、API、依赖、配置、测试、系统或运维面写入“影响范围”，不在本节重复。
系统或 Function 层明确排除、deferred 和重要不变边界写入“非目标”，不在本节重复。
不得用 package owner、内部 service/port、私有数据结构、SDK 调用方式或实施顺序代替黑盒变化。
不得只写“增强”“优化”“完善”“适配”或“支持某能力”。
-->

## Feature 影响（Features）

<!--
本章是条件式章节。只有用户价值、黑盒边界、Function 组成或用户可依赖质量保证发生变化时才保留；
没有 Feature 变化时删除本章。只描述用户价值和 Function 组成变化，不写 Requirement 或白盒实现。
-->

### 新增 Feature
- `F-x.y <canonical name>`：<新增的用户价值、主要 actor/用例和组成 Functions>

### 修改的 Feature
- `F-x.y <canonical name>`：<变化的用户价值、黑盒边界、Function 组成或用户可依赖质量保证>

### 移除的 Feature
- `F-x.y <canonical name>`：<移除的用户价值与受影响 Functions>

## Function 影响（OpenSpec Capabilities）

<!--
本章必填。OpenSpec capability 等同 NextAgent Function；NextAgent runtime Capability 仍专指 Tool、Skill 和 Agent，不得混用。
新 Function 必须且只能对应一个 specs/<kebab-case>/spec.md；先检查 openspec/specs/ 和现有 Function，避免创建平行能力。
修改 legacy Function 时，以输入、目标行为、输出和失败语义选择 canonical spec，并列出本 change 实际触及的
legacy specs；Proposal 只描述 Function 黑盒边界和 spec 影响，Requirement 迁移明细写入 design。
移除个别 Requirements 仍属于修改 Function。当前工作流不得退役整个 Function；如果归档后 Function 将不再
包含任何 Requirement，必须阻塞归档并先提交专门的 Function 退役 change。
清空的 legacy stable spec 可在满足原子迁移、无并行引用和导航清理门禁时退役；这不等同于 Function 退役。
系统级或跨 Function 的系统质量属性只列在其唯一规范归属 Function 下；“适用范围”不建立额外的 Function 与 spec 映射。
-->

### 新增 Function

<!-- 每个条目声明唯一 spec；无新增时写“无”。 -->
- `FN-x.y <canonical name>` → `specs/<kebab-case>/spec.md`
  - 功能边界：<该系统黑盒能力新增的输入、结果或契约边界>
  - 系统质量属性：<安全 / 性能/容量 / 可靠性/恢复 / 可维护性 / 可测试性 / 审计/可追溯性；无则写“无”>

### 修改的 Function

<!--
只改白盒实现时写“无”。legacy Function 若已有多个 specs，先列 canonical spec，再列本 change 实际触及的
legacy specs；不得增加新的 spec 或 Function 映射。若为已有 Function 创建 canonical spec，标注“legacy 收敛”，
且该 spec 必须在本 change 中同步承载被触及 Requirements。
移除个别 Requirements 时，在“功能边界”中明确保留的 Function 边界和被移除的契约。
-->
- `FN-x.y <canonical name>` → `specs/<existing-kebab-case>/spec.md`
  - 功能边界：<发生变化的系统黑盒边界>
  - 系统质量属性：<涉及的 canonical 质量属性；无则写“无”>
  - 映射说明：<canonical spec | 本次触及的 legacy spec | legacy 收敛新建 canonical spec>

## 影响范围（Impact）

<!--
优先写由“变更范围”被动波及的 actor、外部系统、公共 API、配置和运维面；
必要时再列受影响代码、依赖和测试。
本节不得建立新行为，不重复变更范围或非目标。
-->
