# add-ts-isolated-branch-execution

规划入口：[roadmap-v2](../nextagent-ts-change-roadmap-v2.md)
所属分组：InvokedAgent Execution

状态：not-planned
类型：合并记录
主要 owner：`agent-runtime`
依赖：`add-ts-agent-tool`

目标：
- 子 Agent 隔离执行分支已合并入 `add-ts-agent-tool`：首版通过 `submit()` 创建独立 child session/run，子 Agent 使用 fresh context，不继承父 conversation history、timeline、attachments 或 active context。

处理结果：
- 不再单独实施本 change。
- Parent-child 追溯通过 `SessionRecord`/`UserSession`/`RequestRun` optional parent linkage 承载。
- Child run lifecycle、timeline、terminal commit 和 cancellation 继续由 runtime 拥有；Agent tool 不直接创建 session/run 或写 timeline。
- Artifact/attachment 继承、父上下文可见性和结果引用的扩展行为不在本记录中实施；如需继承上下文，进入 `add-ts-invoked-agent-context-inheritance`。

并行边界：
- 本记录不得与 `add-ts-agent-tool` 竞争 child session/run lifecycle ownership。
