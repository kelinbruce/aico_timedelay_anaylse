## 0. 契约前置门禁

- [x] 0.1 完成三个 canonical specs 的原子 delta：删除 retry/edit 旧禁用 Requirements、更新目标 eligibility/provenance Requirements，并保持其他 Requirements 原位不变
  来源：`FN-1.11`、`FN-2.3`、`FN-2.1`；design“存量 Requirement 迁移方案”
  验证：已运行 `openspec validate fix-agent-web-fork-inherited-action-eligibility --strict`（通过）；已按仓内 `nextagent-skill-review` 完成语义审查（PASS，无 P0/P1，且无 `agent-contracts` 群内确认项）

## 1. `FN-1.11 从消息派生子会话`

- [x] 1.1 建立并保持 `forkInherited` provenance characterization：conversation metadata 仍投影到继承 TurnBlock，普通 child 消息不被标记
  来源：`FN-1.11` + `Copied message 携带继承 provenance 标记` + “继承标记随 conversation 读取透出”“标记不决定操作资格”
  验证：已在 `frontend/agent-web` 运行 `npm test -- src/features/chat/view-model/buildSessionProjection.forkInherited.test.ts`（1/1 通过）

## 2. `FN-2.3 重试请求`

- [x] 2.1 先把组件 fixture 设为真实 `forkInherited: true`，新增最新继承轮次 retry 可点击并触发回调的失败测试，确认修改前为 RED
  来源：`FN-2.3` + `Agent Web 对可操作的最新轮次暴露 retry 入口` + “最新继承轮次可发起 retry”
  验证：修改实现前已运行目标测试；retry 断言因 `aria-disabled="true"` 失败，确认 RED

- [x] 2.2 移除 Composer 与 TurnBlock 对 provenance 的 retry 禁用分支，只保留 retry 次数上限和既有界面 guard；删除不可达的 fork retry 禁用文案
  来源：`FN-2.3` + `Agent Web 对可操作的最新轮次暴露 retry 入口` + “最新继承轮次可发起 retry”“provenance 不绕过既有界面限制”；design“FN-2.3 重试请求 / 修改方案”
  验证：已运行聚焦测试集；继承轮次 retry 回调与 retry 上限用例全部通过（3 个相关测试文件、9/9 通过）

## 3. `FN-2.1 提交请求`

- [x] 3.1 新增最新继承轮次 edit 可进入编辑并提交既有请求的失败测试，确认修改前为 RED
  来源：`FN-2.1` + `Agent Web SHALL expose edit only for the current latest turn` + “最新继承轮次可进入 edit”
  验证：修改实现前已运行目标测试；edit 断言因 `aria-disabled="true"` 失败，Composer eligibility 因返回 `false` 失败，确认 RED

- [x] 3.2 移除 Composer 与 TurnBlock 对 provenance 的 edit 禁用分支，复用既有 edit mode、提交和失败协调；删除不可达的 fork edit 禁用文案
  来源：`FN-2.1` + `Agent Web SHALL expose edit only for the current latest turn` + “最新继承轮次可进入 edit”“后端拒绝继承轮次 edit”；design“FN-2.1 提交请求 / 修改方案”
  验证：已运行聚焦测试集；继承轮次 edit 回调与 Composer eligibility 用例全部通过（3 个相关测试文件、9/9 通过），既有 edit 协调由复合 E2E 覆盖

## 4. 跨 Function 集成与迁移

- [x] 4.1 更新真实 fork retry/edit 浏览器旅程：conversation 响应携带 `metadata.forkInherited: true`，TurnBlock 和 Composer 均可发起已有 retry/edit 请求，递归 fork 与分享路径不回归
  来源：design“跨 Function 协作与端到端流程”“验证策略”；`FN-1.11`、`FN-2.3`、`FN-2.1`
  验证：在 `frontend/agent-web` 定向运行 `tests/e2e/session-edit-retry.spec.cjs`（2/2 通过），其中复合旅程覆盖继承标记、retry、edit、递归 fork、reload 与 share；全量 `npm run test:e2e:smoke` 中该旅程通过，整套结果 24/25，唯一失败为未触达的 Cron 页面既有 `Filter` 严格定位冲突

## 5. Change 整体验证

- [x] 5.1 完成 Agent Web 与仓库门禁，确认本 change 不引入 Gateway、Runtime、API 或架构依赖变化
  来源：proposal“影响范围”；design“验证策略”
  验证：Node 22 下 Agent Web build、相关单测 9/9、定向 E2E 2/2、根 build、架构门禁 254/254、本 change strict validation 和 `git diff --check` 均通过。全量门禁的非本 change 基线为：Agent Web Vitest 8 项附件/权限/路由既有失败；Playwright smoke 1 项 Cron 严格定位失败；contract 4 项长期记忆参考文件/时间线断言失败；全量 OpenSpec 1 个 workflow active change 无法解析。语义审查结论为 PASS WITH FOLLOW-UP，无 P0/P1，且 diff 不触达 Gateway、Runtime、API、schema、公共 contract 或多宿主入口。

## 归档前更新基线检查（非实施任务）

实现和验证完成后，归档流程按照 design 的“长期基线刷新计划”合并三个 stable specs，并检查 Function、Feature 和 Agent Web 模块说明没有继续保留 `forkInherited` 禁用 retry/edit 的相反事实。
