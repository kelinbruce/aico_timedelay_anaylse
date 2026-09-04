## 1. `FN-1.18 输入联想`

- [x] 1.1 原子迁移 `联想面板触发规则`：从 legacy `question-association-ui` 使用 `REMOVED` 迁出，并在 canonical `question-association-api` 使用 `ADDED` 承载完整目标行为；保留单次粘贴不查询、输入框失焦后迟到结果不打开面板的既有边界，其他 UI Requirements 原位保留，完成后 Function 归属和迁移对可被 strict validation 识别。
  来源：`FN-1.18 输入联想` + design“存量 Requirement 迁移方案” + proposal“Function 影响”
  验证：在仓库根目录运行 `openspec validate suppress-question-association-during-history-recall --strict`，预期 change 校验通过且无 Requirement operation、Function 映射或迁移完整性错误。
  验证结果：2026-08-12 完成独立检视修正后重新运行 `openspec validate --all --strict`，254 项通过、0 失败；来源 `REMOVED` 与目标 `ADDED` 合并键唯一，目标 Requirement 明确保留粘贴和失焦边界。

- [x] 1.2 在 `MessageInputAssociation.test.tsx` 建立目标行为回归测试：覆盖 `ArrowUp` / `ArrowDown` 回填期间零查询、进入历史时取消 debounce 等待和在途请求且迟到结果不显示、编辑回填文本后恢复查询，并锁定单次粘贴和输入框失焦后的既有边界；实施前运行并确认原实现至少在“历史回填零查询”上失败。
  来源：`FN-1.18 输入联想` + `联想面板触发规则` + Scenario“上下键回看已提交消息不触发联想”“进入历史回看取消待处理查询”“编辑回看的文本后恢复联想”
  验证：在 `frontend/agent-web` 运行 `npx vitest run src/features/composer/components/MessageInputAssociation.test.tsx`；实施前预期新增回归测试失败并显示历史回填仍调用联想 API，实施后预期全部通过。
  复现结果：2026-08-12 实施前运行，20 项中 2 项失败；历史回填实际调用一次 `GET ...keyword=latest%20question`，进入历史后在途请求的 `AbortSignal.aborted` 仍为 `false`；“编辑回填文本后恢复查询”通过。
  验证结果：2026-08-12 补齐 `ArrowDown`、debounce 等待期和失焦迟到结果覆盖后，与 Composer 既有测试合并运行；`MessageInputAssociation.test.tsx` 23 项、`composer-panel.component.test.tsx` 32 项，共 55 项全部通过。

- [x] 1.3 修改共享 `MessageInput` 的联想调度：复用 `historyIndex` guard，历史回填和草稿恢复前同步关闭面板并取消 timer/controller，真实编辑继续沿用既有 300ms debounce；完成后不改变面板键盘优先级、service 或公共 contract。
  来源：`FN-1.18 输入联想` + `联想面板触发规则` 全部 Scenarios + design“FN-1.18 输入联想 / 修改方案”
  验证：在 `frontend/agent-web` 运行 `npx vitest run src/features/composer/components/MessageInputAssociation.test.tsx tests/composer-panel.component.test.tsx`，预期目标行为和既有历史导航、面板优先级测试全部通过。
  验证结果：2026-08-12 复审补强后重新运行，`MessageInputAssociation.test.tsx` 23 项、`composer-panel.component.test.tsx` 32 项全部通过。

- [x] 1.4 在现有浏览器测试目录补充共享 Chat workspace 旅程：拦截 `GET /api/v1/question-association`，实际按上下键回看后请求数保持为零，编辑回填文本并等待 debounce 后请求恢复。
  来源：`FN-1.18 输入联想` + `联想面板触发规则` + Scenario“上下键回看已提交消息不触发联想”“编辑回看的文本后恢复联想” + design“验证策略”
  验证：在 `frontend/agent-web` 运行 `npm run test:e2e -- tests/e2e/question-association-history-recall.spec.cjs`，预期浏览器旅程通过。
  验证结果：2026-08-12 已运行，Chromium 旅程 1 项通过；历史回填后的请求数组为空，编辑后仅出现 `latest question edited` 查询并显示结果面板。

- [x] 1.5 验证 `FN-1.18` 前端实现与三种宿主构建：共享组件类型检查通过，local、immersive、collaborative artifact 均无宿主专属分支或构建回归。
  来源：design“FN-1.18 输入联想 / 修改方案”与“验证策略”
  验证：在 `frontend/agent-web` 运行 `npm run build` 和 `npm run build:vite:modes`，预期命令退出码均为 0。
  验证结果：2026-08-12 两个命令退出码均为 0；`build:vite:modes` 完成 multi-host page、local、immersive、collaborative 相关 artifact 构建，保留既有 antd `use client` 与 chunk-size 警告。

## 2. Change 整体验证

- [x] 2.1 对 active change 和实现 diff 执行严格规格验证、`$nextagent-skill-review` 与 `$nextagent-code-review` 语义审查；完成后 legacy 迁移、Feature/Function 影响、唯一实现路径和测试证据一致，且没有触及 `agent-contracts` 或后端契约。
  来源：proposal“目标与非目标”“影响范围” + design“验证策略”“长期基线刷新计划”
  验证：在仓库根目录运行 `openspec validate --all --strict`，预期全部通过；按 `.agents/skills/nextagent-skill-review/SKILL.md` 检查 proposal、specs、design、tasks 与实现证据，预期结论为 PASS。
  验证结果：2026-08-12 修正独立复审发现的规格边界和测试缺口后，`openspec validate --all --strict` 为 254 项通过、0 失败；`$nextagent-skill-review` 结论 PASS，`$nextagent-code-review` 结论 PASS，无 P0/P1/P2/P3。Frozen core contract、后端 API、`agent-contracts`、owner scope、agent scope 和持久化均未触及；共享 `MessageInput` 保持三宿主一致，相关 Vitest 55 项、Chromium 1 项、TypeScript build 和多宿主 Vite build 均通过；`git diff --check` 无错误。

## 归档前更新基线检查（非实施任务）

实现和验证完成后，归档流程按照 design 的“长期基线刷新计划”归并 `question-association-api`、`question-association-ui`、`FN-1.18 输入联想` 和 `F-1.9 智能问题推荐`；检查同一触发规则没有被多个 stable specs 重复定义，且 `question-association-ui` 的未触及 Requirements 和现有导航仍然保留。
