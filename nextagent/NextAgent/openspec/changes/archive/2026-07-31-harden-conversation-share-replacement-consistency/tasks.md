## 0. 前置依赖与迁移准入

- [x] 0.1 确认 `add-share-ops-hash-permission` 的实现与目标契约已进入当前 main，并稳定 `Shared conversation view Web API contract` 的 ops hash 等值校验最终语义；本 change 的目标 Requirement 必须合并该语义，不得恢复 legacy ops 子集校验
  来源：proposal“Function 影响”；design“存量 Requirement 迁移方案”
  验证：2026-07-29 执行 `openspec validate add-share-ops-hash-permission --strict` 通过；`git log` 确认 main 含 `2ac20661e feat(share): replace full ops array with SHA-256 hash for telecom-scale permission`；`rg -n "SHA-256|hash.*相等|allowedOps\\[0\\]" ...` 确认依赖 spec、目标 spec 与 `ConversationShareService.isOpsHashEqual` 均为 hash 等值语义

## 1. `FN-1.15 查看分享的会话`

- [x] 1.1 在 0.1 通过后，以 delta 原子定义 `FN-1.15` 的两个被触及 Requirements：来源 `conversation-share` 使用 `REMOVED`，目标 `shared-conversation-view` 使用 `ADDED`，来源未触及 Requirements 原位保留；stable Function/spec 导航只在归档阶段按 design 的基线刷新计划更新
  来源：design“存量 Requirement 迁移方案”
  验证：2026-07-29 执行 `openspec validate harden-conversation-share-replacement-consistency --strict` 通过；来源两个 `REMOVED` 与目标两个 `ADDED` 成对存在，目标 spec 唯一归属 `FN-1.15`，来源未触及 Requirements 未进入 delta

- [x] 1.2 为 `ConversationShareService` 补充 retry/edit/fork 分享完整性复现测试；修改前必须确认 retry 新分享缺少 canonical 用户问题、替换后既有分享丢失或多 run 部分缺失至少一项按当前行为失败
  来源：`FN-1.15` + `Shared conversation view Web API contract` + “查看 retry attempt 的新分享”“retry 替换后查看既有分享”“edit 替换后查看既有与新分享”“查看 fork copied run anchor 分享”“多 run 分享中任一单元不完整”
  验证：2026-07-29 执行 `npx vitest run --config vitest.config.release.ts packages/agent-session/tests/conversation-share.test.ts`；实现前 22 tests 中 5 个目标用例按预期失败，分别复现 retry 问题缺失、replacement 内容丢失、部分单元错误成功及安全隐藏错误成功

- [x] 1.3 增加分享读取安全边界测试，实际触发 `GUARD_BLOCKED`、未知隐藏原因、未选 attempt 回答、跨 scope 和 fork parent 候选数据并断言均不进入成功响应
  来源：`FN-1.15` + 系统质量属性“安全” + `Owner scope controlled exception for share viewing` + “跨 scope 读取使用冻结的创建者范围”“retry 问题补全不扩散回答范围”“fork 分享不追溯 parent session”；`Shared conversation view Web API contract` + “安全隐藏内容不因分享而暴露”
  验证：2026-07-29 同一聚焦测试实际注入 `GUARD_BLOCKED`、未知隐藏原因、未选 attempt 回答、其他 owner scope 和 parent session 候选；实现后 23/23 通过且越界消息未进入成功响应

- [x] 1.4 在 `ConversationShareService` 注入既有 `RequestRunStoreGateway`，实现真实 run 与 fork copied run anchor 的统一完整分享单元解析、替换隐藏原因允许集合、逐 run 原子失败及最终去重排序
  来源：`FN-1.15` + `Shared conversation view Web API contract` 全部新增场景；design“FN-1.15 查看分享的会话 / 修改方案”
  验证：2026-07-29 执行 `npx vitest run --config vitest.config.release.ts packages/agent-session/tests/conversation-share.test.ts`；23/23 通过，1.2、1.3 的 5 个 RED 用例转绿，replacement-hidden 消息只在分享 DTO 可见且不暴露内部 visibility metadata，既有有效期、ops 和普通分享测试保持通过

- [x] 1.5 更新 `agent-app` composition 和相关测试 fixture，为分享服务传入既有 run store，不新增 gateway method、Record 或公共 DTO
  来源：design“FN-1.15 查看分享的会话 / 修改方案”
  验证：2026-07-29 `npm run build` 退出码 0；`npx vitest run --config vitest.config.release.ts packages/agent-app/tests/composition.test.ts packages/agent-channel-web/tests/share-routes.test.ts tests/agent-kernel/session-fork-runtime.test.ts` 为 3 files / 75 tests 全通过

- [x] 1.6 验证分享 Web API 与只读页面 contract 保持兼容，包括 `200/403/404/410/503`、响应 schema、annotation 排除、既有 `CAPABILITY_RESULT` message 投影和不建立 stream/event 查询
  来源：`FN-1.15` + `Shared conversation view Web API contract` + “查看普通公开分享”“分享能力未注入”；proposal“非目标”
  验证：2026-07-29 后端 route/fork 集成组 75/75 通过；`frontend/agent-web` 的 `SharedConversationPage`、share route bypass、`shareService` 为 3 files / 19 tests 全通过，`npm run build` 退出码 0；session unit 另覆盖 `CAPABILITY_RESULT` 保留和 replacement DTO `visible=true`

## 2. Change 整体验证

- [x] 2.1 执行 OpenSpec、后端、前端和架构门禁并记录实际结果；任一 change-caused failure 未解决前不得标记完成
  来源：proposal“影响范围”；design“验证策略”
  验证：2026-07-29 `openspec validate --all --strict` 为 262/262；`npm run build` 退出码 0；`npm test` 为 117 files passed、1 skipped，1105 tests passed、2 skipped；`npm run test:contract` 为 39 files / 331 tests 全通过；`npm run lint:architecture` 无依赖违规且 41 files / 247 tests 全通过；`frontend/agent-web` 的 `npm run build` 退出码 0，聚焦分享页面测试为 3 files / 19 tests 全通过

## 归档前更新基线检查（非实施任务）

实现和验证完成后，归档流程按照 design“长期基线刷新计划”同步 stable spec、Function、Feature、architecture 和 module 导航；同时确认 `conversation-share` 的 legacy 多 Function 映射没有因本 change 产生新的不一致。
