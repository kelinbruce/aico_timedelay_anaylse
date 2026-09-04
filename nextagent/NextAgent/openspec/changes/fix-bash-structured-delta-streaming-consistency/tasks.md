## 1. `FN-5.16 识别和投射结构化工具增量`

- [x] 1.1 为 Bash 流式 terminal 去重建立失败复现测试：执行期结构化、非结构化或混合 result delta 后不再 emit terminal `CAPABILITY_RESULT_DELTA`；无执行期 result delta 时 terminal 行为保持；`CAPABILITY_COMPLETED` 与 `CAPABILITY_RESULT` Message 保持。
  来源：`FN-5.16 + TOOL_STRUCTURED_DELTA Does Not Replace CAPABILITY_RESULT_DELTA + 流式结构化帧后不重复 terminal 结果增量 / 流式非结构化帧后不重复 terminal 结果增量 / 无流式 result delta 时保持 terminal 结果增量`；`FN-5.16 + Bash Streaming Structured Delta Emission`
  验证：`npx vitest run packages/agent-core/tests/tool-structured-delta-emission.test.ts`；实施前目标断言失败，实施后全部通过。

- [x] 1.2 为非 Workflow structured delta live/history identity 建立失败复现测试：同一条 `TOOL_STRUCTURED_DELTA` 的 live subscriber event 与持久化 timeline record 使用相同 `eventId`，且 flush 不产生第二次 live 通知。
  来源：`FN-5.16 + 可靠性/恢复 + Streaming TOOL_STRUCTURED_DELTA Persistence + live 与 history 使用同一 event identity / Pending Input 超时后不重复渲染结构化帧`
  验证：`npx vitest run packages/agent-runtime/tests/structured-delta-persistence.test.ts`；实施前 event identity 断言失败，实施后全部通过。并在 `frontend/agent-web` 执行 `npx vitest run tests/processHistory.test.ts`，验证相同 `eventId` 的 live/history structured presentation 只保留一份，并覆盖 Pending Input timeout 后加载历史时不重复渲染两条结构化增量。

- [x] 1.3 实现最小修正：tool-loop 维护 Bash 执行期 result delta 标志并跳过成功 terminal `CAPABILITY_RESULT_DELTA`；runtime 对同一非 Workflow structured delta 只构造一次 live event 并复用于 live 投影、accumulator 和持久化。
  来源：design §1“修改方案”
  验证：`npx vitest run packages/agent-core/tests/tool-structured-delta-emission.test.ts packages/agent-runtime/tests/structured-delta-persistence.test.ts`；全部通过。

- [x] 1.4 为 authorization-only 结构化内容建立 characterization 测试：仅包含 `authorization` 的内容 emit `TOOL_STRUCTURED_DELTA`，仍包含 `api_key`、`credential`、`password`、`secret` 或 `token` 的内容不 emit；随后把 credential indicator pattern 收窄为这五个关键字。
  来源：`FN-5.16 + Security Constraints + 仅包含 authorization 的内容保持结构化投影 / Content with credentials rejected`
  验证：`npx vitest run packages/agent-core/tests/tool-structured-delta-emission.test.ts packages/agent-core/tests/structured-delta-identification.test.ts`；实施前 authorization-only 断言失败，实施后全部通过。

## 2. `FN-10.6 前端定制`

- [x] 2.1 为 Runtime Bash 卡片内部 `SUB_TITLE` 视觉层级建立失败复现测试：大写 `SUB_TITLE` / `SUB_DETAIL` 归并到同一 `toolCallId` 后，卡片内部显示当前主题 circle icon 和 subordinate 层级，且不创建第二个顶层条目。
  来源：`FN-10.6 + Runtime Capability 内 SUB_TITLE 层级视觉呈现 + Runtime Bash 卡片呈现 SUB_TITLE 小圆圈和层级`
  验证：`cd frontend/agent-web && npx vitest run tests/ProcessPanel.piu-lifecycle.test.tsx`；实施前视觉层级断言失败，实施后全部通过。

- [x] 2.2 实现 `StructuredProcessSections` 的 `SUB_TITLE` circle icon 和 subordinate 缩进，不改变事件归并、Capability lifecycle、披露状态和独立 `SUB_TITLE` 条目行为。
  来源：design §2“修改方案”
  验证：`cd frontend/agent-web && npx vitest run tests/ProcessPanel.piu-lifecycle.test.tsx tests/processDetailsProjection.test.ts`；全部通过。

## 3. Change 整体验证

- [x] 3.1 运行后端与前端常规验证和本 change 的 OpenSpec strict 校验，确认修改不破坏 build、测试、contract 与架构边界。
  来源：proposal 影响范围 + design 验证策略
  验证：仓库根目录执行 `npm run build`、`npm test`、`npm run test:contract`、`npm run lint:architecture`，全部通过；`npx openspec validate fix-bash-structured-delta-streaming-consistency --type change --strict` 通过。由于修改前端组件，在 `frontend/agent-web` 执行 `npm run build` 和相关 focused tests，全部通过。另执行 `npx openspec validate --all --strict`：当前仓库仍有 11 个既有无关失败项，这些失败在本次修改前的 `origin/main` 上已存在，不由本 change 引入。

## 归档前更新基线检查

归档前按 design“长期基线刷新计划”合并 `openspec/specs/tool-structured-delta/spec.md`、`openspec/specs/agent-web-process-panel/spec.md`、`FN-5.16` / `FN-10.6` Function 文档、`openspec/overview.md` 和必要的 spec-to-design 导航；本阶段不修改长期基线。
