## 1. FN-4.3 装配上下文 — spec delta

- [x] 1.1 编写 `specs/context-engine/spec.md` delta，包含 `## Function` 元数据块、`## MODIFIED Requirements` 两个 Requirement 块（`Context Engine protects minimum safe current-request context`、`Large-content thresholds referenced from context-engine are fixed`）、`## Function 变更汇总` -> 验证: MODIFIED Requirement 名称与 `openspec/specs/context-engine/spec.md` baseline 精确匹配（case-sensitive）；每个块含 `需求类别` 和至少一个 Scenario
- [x] 1.2 确认 delta body 与代码注释一致：`default-proportional-budget-policy.ts` L20/L87 `60% cap REMOVED`、L84-95 全部 selected、`assemble-context.ts` L231 `SOLE compression trigger` -> 验证: 逐句对照 delta MODIFIED body 与代码注释/测试断言

## 2. FN-4.3 装配上下文 — change 文档

- [x] 2.1 编写 `proposal.md`，包含 `## Why`、`## 目标与非目标`、`## What Changes`、`## Feature 影响`、`## Function 影响（OpenSpec Capabilities）`、`## 影响范围` -> 验证: 符合 `openspec/config.yaml` rules.proposal（L194-213）
- [x] 2.2 编写 `design.md`，包含 `## 设计范围`、`## FN-4.3` 段（目标与规范依据 → 当前实现 → GAP 分析 → 修改方案）、`## 长期基线刷新计划` -> 验证: 符合 `openspec/config.yaml` rules.design（L273-313）
- [x] 2.3 编写 `tasks.md`，按 Function 分组，每 task 带 `-> 验证:` -> 验证: 符合 `openspec/config.yaml` rules.tasks（L314-335）

## 3. 验证

- [x] 3.1 运行 `openspec validate --all --strict` -> 验证: exit code 0（245 passed, 0 failed）
- [x] 3.2 确认代码无需改动 -> 验证: `git status` 只显示 `openspec/changes/refine-ts-context-engine-budget-cap-removal/` 新文件，无 packages/ 改动
