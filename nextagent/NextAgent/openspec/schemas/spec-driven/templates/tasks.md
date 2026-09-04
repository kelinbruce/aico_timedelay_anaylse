<!--
Task 只安排 specs/design 已定义的工作，不建立新行为或新设计。
- 每个 checkbox 只对应一个可独立验收结果；可被部分完成时必须拆分。
- 描述必须命名目标对象、精确 delta 和完成后的可观察结果。
- 每个 task 必须填写来源和可重复验证，不使用 task type 分类或新的引用编号体系。
- 功能行为任务引用 `Function + Requirement + Scenario`；系统质量属性任务引用
  `Function + 系统质量属性 + Requirement + Scenario`；白盒 design/architecture 约束任务引用精确 design 章节；
  其他非行为任务引用精确 design 章节或 proposal scope。
- 可观察行为任务必须包含相关可执行测试命令；其他任务允许使用 build、lint、schema/architecture check，
  或“无法自动化的原因 + 精确 code review 检查点”。
- 新增或修改可观察行为时，必须先编写表达目标行为的测试。若变更前系统不满足目标行为，
  实施前必须运行测试并确认失败。缺陷修复必须先复现失败；
  行为保持型重构或 characterization 必须先建立通过的基线，修改后必须继续通过，不得人为制造失败。
- 禁止行为、边界、权限、依赖规则或失败路径必须有实际触发并断言失败的验证任务。
- 勾选 task 前执行验证并记录实际命令和结果；验证未通过时不得勾选，不得只写“测试通过”。
- 以受影响 Function 为主要分组，每个 Function 使用独立任务组；组内按目标行为测试、实现和该 Function 验证排序。
  Function 分组可以按实施依赖排序。契约确认、跨 Function composition/迁移、整体验证和归档前检查等共享工作
  单独分组，并在来源中列出所有相关 Functions 或精确 design/proposal 章节；共享任务不在多个 Function 下重复。
- Requirement 跨 spec 迁移放入目标 Function 分组；一个 checkbox 必须同时覆盖来源 REMOVED、目标
  ADDED/MODIFIED、被触及 Requirement 的全部黑盒行为承载、来源中完全未触及 Requirements 原位保留和直接引用更新，
  不得让两端处于可部分完成状态。
- 来源 stable spec 退役和跨 Function 导航清理可放入共享分组，但必须与 Requirement 迁移在同一 change 完成，
  并验证来源已清空、无并行 active change 引用且所有长期导航已更新。
-->

## 0. <!-- 跨 Function 前置门禁；没有则删除 -->

- [ ] 0.1 <!-- <共享目标对象>：<精确 delta>；完成后 <可独立验收结果> -->
  来源：<!-- 相关 Functions，或精确 design/proposal 章节 -->
  验证：<!-- 可执行命令 + 预期结果，或“无法自动化的原因 + 精确 code review 检查点” -->

## 1. `FN-x.y <canonical name>`

- [ ] 1.1 <!-- 先建立该 Function 的目标行为测试或 characterization -->
  来源：<!-- 功能行为：Function + Requirement + Scenario；系统质量属性：Function + 系统质量属性 + Requirement + Scenario；白盒：精确 design 章节 -->
  验证：<!-- 可执行命令 + 预期结果，或“无法自动化的原因 + 精确 code review 检查点” -->

- [ ] 1.2 <!-- 实现该 Function 的最小 delta，并给出可观察结果 -->
  来源：<!-- 功能行为：Function + Requirement + Scenario；系统质量属性：Function + 系统质量属性 + Requirement + Scenario；白盒：精确 design 章节 -->
  验证：<!-- 可执行命令 + 预期结果，或“无法自动化的原因 + 精确 code review 检查点” -->

<!-- 复制本 Function 分组以覆盖 proposal 中的全部受影响 Functions，并按实施依赖调整分组顺序。 -->

## 2. 跨 Function 集成与迁移

- [ ] 2.1 <!-- 仅承载无法归入单一 Function 的 composition、迁移或清理结果 -->
  来源：<!-- 所有相关 Functions + 精确 design 章节 -->
  验证：<!-- 可执行命令 + 预期结果，或“无法自动化的原因 + 精确 code review 检查点” -->

## 3. Change 整体验证

- [ ] 3.1 <!-- 全量门禁与完成条件 -->
  来源：<!-- proposal 影响范围 + design 验证策略 -->
  验证：<!-- 完整命令集合 + 预期结果 -->

## 归档前更新基线检查（非实施任务）

<!--
本节不使用 checkbox。实现和验证完成后，归档流程按照 design 的“长期基线刷新计划”归并长期事实，
并检查长期文档没有重复定义同一行为、schema、owner 或接口语义。
-->
