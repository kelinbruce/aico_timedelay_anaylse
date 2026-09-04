# add-piu-history-flag Tasks

## 1. `FN-10.6 前端定制`

- [x] 1.1 为答案区结构化 PIU payload 新增 `isHistory` 行为测试：`content.data` 为数组时为 `true`，非数组为 `false`；spread-data 形态也携带该字段，且 content/data 中的同名字段必须被可信 host field 覆盖；同一内容在 trusted `isHistory` 变化时必须重新 emit。
  来源：`FN-10.6 前端定制` + `PIU Message Rendering` + `PIU distinguishes history replay from live answer`、`host fields override same-named content keys`
  验证：在 `frontend/agent-web` 运行 `npm test -- src/features/chat/components/structured/AnswerSegments.test.tsx`；2026-08-26 执行结果：1 个测试文件、50 个测试全部通过。

- [x] 1.2 实现 `buildAnswerSegments -> AnswerSegments -> PiuMessage -> piu.emit` 的 `isHistory` 透传，并保持 PIU 加载、uuid 聚合和 expand panel 行为不变；同一内容且同一 `isHistory` 仍不重复 emit。
  来源：`FN-10.6 前端定制` + `PIU Message Rendering` + `PIU normal rendering with whole content payload`、`PIU in spread-data allowlist emits flattened data`
  验证：在 `frontend/agent-web` 运行 `npm test -- src/features/chat/components/structured/AnswerSegments.test.tsx tests/answerContent.test.ts src/features/chat/presentation/answerContentExpandPanel.test.ts` 和 `npm run build`；2026-08-26 执行结果：84 个测试全部通过，TypeScript 编译通过。

- [x] 1.3 修复 spread-data payload 对数组 `data` 的误展开，并补充数组输入测试，确保 payload 只包含宿主字段。
  来源：`FN-10.6 前端定制` + `PIU Message Rendering` + `spread-data payload degrades to host fields when data is absent`
  验证：在 `frontend/agent-web` 运行 `npm test -- src/features/chat/components/structured/AnswerSegments.test.tsx`；2026-08-26 执行结果：1 个测试文件、50 个测试全部通过。

- [x] 1.4 补充 `TurnBlock -> AnswerSegments -> PiuMessage -> piu.emit` 的数组/对象 `data` 透传集成测试。
  来源：`FN-10.6 前端定制` + `PIU Message Rendering` + `PIU distinguishes history replay from live answer`
  验证：在 `frontend/agent-web` 运行 `npm test -- tests/TurnBlock.piuHistory.test.tsx`；2026-08-26 执行结果：3 个测试全部通过。

- [x] 1.5 将 `PiuMessage` 的本地不可预览与等待宿主渲染提示改为 i18n，并补充 zh-CN/en-US 文案测试。
  来源：`FN-10.6 前端定制` + `PIU Message Rendering` + `PIU unavailable fallback`
  验证：在 `frontend/agent-web` 运行 `npm test -- src/features/chat/components/structured/AnswerSegments.test.tsx`；2026-08-26 执行结果：1 个测试文件、50 个测试全部通过。

## 3. Change 整体验证

- [x] 3.1 验证 OpenSpec delta、前端组件行为和类型边界一致。
  来源：proposal 影响范围 + design 验证策略
  验证：在仓库根目录运行 `openspec validate --all --strict`；在 `frontend/agent-web` 运行 `npm test -- src/features/chat/components/structured/AnswerSegments.test.tsx tests/TurnBlock.piuHistory.test.tsx tests/answerContent.test.ts src/features/chat/presentation/answerContentExpandPanel.test.ts` 和 `npm run build`；2026-08-26 执行结果：OpenSpec 263 项全部通过，4 个测试文件共 87 个测试全部通过，TypeScript 编译通过。

## 归档前更新基线检查（非实施任务）

按照 design 的“长期基线刷新计划”，归档时更新 `agent-web-structured-message-rendering` stable spec、`FN-10.6` Function 规格表和 `agent-web` module 设计中关于结构化 `PiuMessage` emit payload 与本地化 fallback 的描述。
