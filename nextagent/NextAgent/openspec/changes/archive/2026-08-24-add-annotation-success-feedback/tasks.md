## 1. FN-1.12 标注对话

- [x] 1.1 新增组件回归测试：回答点赞、点踩、收藏的添加与取消写入成功后，分别展示对应 i18n 成功提示；写入失败时不展示成功提示
  来源：FN-1.12 + Requirement「前端对话标注控制」+ Scenario「标注写入成功提示」「取消标注写入成功提示」「标注写入失败不展示成功提示」
  验证：先在未实现前运行 `cd frontend/agent-web && npm test -- tests/annotation-icons.test.tsx` 确认新增 6 个成功提示用例失败（18 tests: 6 failed）；实现后同命令通过（18 tests passed）
- [x] 1.2 实现 `TurnBlock` 回答标注成功提示：三个控件入口传入本次操作文案，`callAnnotationApi` 写入成功后调用一次 `message.success`
  来源：design「成功提示由操作入口决定」
  验证：`cd frontend/agent-web && npm test -- tests/annotation-icons.test.tsx`，18 个用例通过
- [x] 1.3 新增 zh-CN 与 en-US i18n 文案，不引入硬编码组件文案
  来源：design「国际化与多宿主一致」
  验证：`cd frontend/agent-web && npm run build` 通过；zh-CN/en-US 各新增 6 个 key
- [x] 1.4 前端类型与格式验证
  来源：AGENTS.md 验证门禁
  验证：`cd frontend/agent-web && npm run build && npx prettier --check src/features/chat/components/TurnBlock.tsx src/i18n/resources/zh-CN.ts src/i18n/resources/en-US.ts tests/annotation-icons.test.tsx`，全部通过
