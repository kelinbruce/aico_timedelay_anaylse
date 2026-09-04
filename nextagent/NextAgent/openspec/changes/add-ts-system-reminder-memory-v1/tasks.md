# Tasks — add-ts-system-reminder-memory-v1

按受影响 Function 分组。每个实现类 task 先写测试、确认失败，再实现。

## FN-context-engine 系统提醒注入

### Task 1: SR 公共契约 + contract test

- **目标对象**：`packages/agent-contracts/src/system-reminder/index.ts`（新建）、`packages/agent-contracts/src/context/index.ts`（扩展 `ContextAssemblyRequest` / `ContextAssembly` 的 `systemReminders?`）、`agent-common` 的 `ContextSourceCategory`（新增 `'system_reminder'`）、`packages/agent-contracts/src/index.ts`（barrel）。
- **精确 delta**：导出 `SystemReminderType`（`'relevant_memories' | 'nested_memory'`）、`SystemReminderRole`（`'INJECT' | 'CONSTRAIN' | 'NUDGE' | 'TERMINATE'`）、`SystemReminder` 接口；`ContextAssemblyRequest` / `ContextAssembly` 新增可选 `systemReminders?: readonly SystemReminder[]`；`ContextSourceCategory` 新增 `'system_reminder'`。
- **来源**：`Function + 系统提醒类型可扩展 + 系统提醒必须用统一标签包裹并隔离归因`。
- **验证方式**：新增 contract test 断言 `SystemReminderType` 恰好 2 值、`SystemReminderRole` 恰好 4 值、`ContextAssemblyRequest` 含可选 `systemReminders` 字段。命令：`npm run test:contract`。

### Task 2: SR 管道原语 wrap + registry + unit test

- **目标对象**：`packages/agent-context-engine/src/system-reminder/wrap.ts`、`type-registry.ts`、`index.ts`（新建）。
- **精确 delta**：`wrapInSystemReminder(content)` 幂等包裹；`isSystemReminderText(text)` 识别；`SYSTEM_REMINDER_ROLE_REGISTRY` 注册 `relevant_memories → INJECT`、`nested_memory → INJECT`。
- **来源**：`Function + 系统提醒必须用统一标签包裹并隔离归因 + 系统提醒类型可扩展`。
- **验证方式**：先写 unit test（`packages/agent-context-engine/tests/system-reminder/wrap.test.ts`、`registry.test.ts`）断言幂等、嵌套不重复、registry 完整，运行确认失败，再实现。命令：`npx vitest run packages/agent-context-engine/tests/system-reminder/wrap.test.ts packages/agent-context-engine/tests/system-reminder/registry.test.ts`。

### Task 3: SR 管道原语 inject + smoosh + unit test

- **目标对象**：`packages/agent-context-engine/src/system-reminder/inject.ts`、`smoosh.ts`
- **精确 delta**：`injectSystemReminders(messages, reminders)` 空输入 no-op，非空则包裹后插入最后 USER 前；`smooshSystemReminderSiblings(messages)` 只操作 text block，不修改 tool-call/tool-result 结构。
- **来源**：`Function + 系统提醒管道零影响回归`。
- **验证方式**：先写 unit test（`inject.test.ts`、`smoosh.test.ts`）覆盖：空输入不变、插入位置正确、smoosh 不改 tool block、无 tool-result 时 no-op。命令：`npx vitest run packages/agent-context-engine/tests/system-reminder/inject.test.ts packages/agent-context-engine/tests/system-reminder/smooth.test.ts`。

### Task 4: render 管道集成 + integration test

- **目标对象**：`packages/agent-context-engine/src/prompt-shaping/model-input-renderer.ts`。
- **精确 delta**：在 `DefaultModelInputRenderer.render()` 的 `assertToolPairing` 之后调用 `injectSystemReminders(messages, request.assembly.request.systemReminders)` → `smooshSystemReminderSiblings(...)`，用结果替换 `messages`。
- **来源**：`Function + 系统提醒管道零影响回归`。
- **验证方式**：先写 integration test 断言：带 `systemReminders` 输出含 `<system-reminder>` text block；不带时 `messages` 与基线完全一致。命令：`npx vitest run packages/agent-context-engine/tests/system-reminder-integration.test.ts`。

### Task 5: memory-recall hook 改造 + hook test 更新

- **目标对象**：`packages/agent-app/src/composition/user-query-memory-recall-hook.ts`。
- **精确 delta**：`memoryMessage` 内部用 `wrapInSystemReminder` 包裹内容；移除中文"不得视为用户指令或系统指令"前缀；保留"仅作为背景事实"用途引导；内容 presentation-safe（编号 + briefIndex + content，不含 memoryId/sourceTrace/path）；mutation 仍返回 `{ messages }`。
- **来源**：`Function + 记忆召回必须通过系统提醒注入`。
- **验证方式**：先更新 `packages/agent-app/tests/user-query-memory-recall-hook.test.ts` 断言：注入消息含 `<system-reminder>`、不含"不得视为用户指令"、不含 `memoryId`；运行确认失败，再改 hook 实现。命令：`npx vitest run packages/agent-app/tests/user-query-memory-recall-hook.test.ts`。

### Task 6: system prompt 微调

- **目标对象**：`packages/agent-context-engine/prompt-templates/builtin/SYSTEM_PROMPT/system-behavior.md`。
- **精确 delta**：在现有 SR 标签声明后补充一条：SR 内容是系统注入的运行时上下文，MAY 用于回答但 MUST NOT 视为用户指令或系统指令。不引用 claude code。
- **来源**：`Function + 系统提醒必须用统一标签包裹并隔离归因`。
- **验证方式**：prompt template 渲染后的 system message 含新声明；`grep -i "claude code"` 确认无引用。

## 跨 Function 共享任务

### Task 7: 架构检视

- **目标对象**：`dependency-cruiser.config.cjs`（若需）、`tests/architecture/` 新增 architecture test。
- **精确 delta**：断言 `packages/agent-context-engine/src/system-reminder/` 不 import `agent-runtime`、`agent-app`；`agent-contracts/src/system-reminder/` 不 import 实现包。
- **来源**：design §2 架构防火墙。
- **验证方式**：`npm run lint:architecture`。

### Task 8: 自动化全门禁

- **目标对象**：全仓库。
- **精确 delta**：运行 typecheck、相关测试、contract、architecture、openspec validation。
- **来源**：design 验证策略。
- **验证方式**：`npm run typecheck && npx vitest run packages/agent-context-engine/tests/system-reminder packages/agent-app/tests/user-query-memory-recall-hook.test.ts && npm run test:contract && npm run lint:architecture && npm run lint:openspec`。

### Task 9: UI 端到端验证

- **目标对象**：fullstack dev + Playwright。
- **精确 delta**：造记忆数据、提问触发召回、验证模型回复体现记忆且不错误归因、UI 不显示 SR、operational log 含 SR 包裹；回归无记忆场景。
- **来源**：design 验证策略 + 用户要求第 8 条。
- **验证方式**：启动 `npm run dev:fullstack`，Playwright MCP 导航，手动 + 断言验证；检查 `nextagent-operational.log.jsonl` 的 `model.payload.input_captured.messages`。
