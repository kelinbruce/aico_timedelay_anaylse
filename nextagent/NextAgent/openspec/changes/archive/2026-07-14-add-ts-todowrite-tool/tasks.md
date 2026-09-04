## 1. Tool framework and descriptor

- [x] 1.1 扩展 `ToolDependencyName`、`ToolDependencies` 和 `BuiltinToolCatalog` 允许的 dependency 名单，新增受控 `todoState` dependency。
  验证：`npm test -- --run tests/architecture/builtin-tool-framework.test.ts packages/agent-capability/tests/tool-catalog.test.ts`
  来源：`builtin-tool-framework` / Requirement "Tool dependencies are optional and controlled"；`design.md` D2
- [x] 1.2 定义 `TodoWrite` input/output JSON schema，覆盖 `todos[0..100]`、`content[1..500]`、`activeForm[1..500]` 和 `status` enum。
  验证：`npm test -- --run packages/agent-capability/tests/todo-write-schemas.test.ts`
  来源：`todo-write-tool` / Requirement "TodoWrite input is a bounded full-list schema"
- [x] 1.3 定义并注册 `todoWriteToolDefinition`，descriptor 使用 canonical `TodoWrite`、bundled provider、`requiredDependencies:["todoState"]` 和 `replayPolicy:"IDEMPOTENT"`，description 明确新增 item 需要提交完整有序列表。
  验证：`npm test -- --run packages/agent-capability/tests/todo-write-descriptor.test.ts tests/agent-kernel/capability-governance.test.ts`
  来源：`todo-write-tool` / Requirement "TodoWrite exposes a scoped todo-list Tool"、"TodoWrite input is a bounded full-list schema"；`design.md` D1、D5
- [x] 1.4 增加 negative descriptor/config 测试：缺少 `todoState` 时 `TodoWrite` descriptor 为 `UNAVAILABLE`，provider adapter 和 context rendering 不改写 `TodoWrite` 名称。
  验证：`npm test -- --run packages/agent-capability/tests/tool-catalog.test.ts tests/contract/context-assembly-contracts.test.ts`
  来源：`todo-write-tool` / Scenario "Descriptor is exposed as a bundled Tool"；`builtin-tool-framework` / Scenario "Required dependency must be available"

## 2. Todo state adapter and execution

- [x] 2.1 实现 gateway-owned persisted todo state store、runtime-owned stateless `TodoStatePort` adapter，并在 `agent-app` composition 中注入 `toolDependencies.todoState`。
  验证：`npm test -- --run packages/agent-runtime/tests/todo-state-port.test.ts packages/agent-platform-gateway-local/tests/sqlite-gateway-stores.test.ts packages/agent-app/tests/composition.test.ts`
  来源：`design.md` D2、D3；proposal Impact
- [x] 2.2 实现 `TodoWrite` execute path：读取 trusted context，归一化空列表和全部完成列表，调用 `todoState.replaceTodos(...)`，返回 `{ oldTodos, newTodos }`。
  验证：`npm test -- --run packages/agent-capability/tests/todo-write-tool.test.ts`
  来源：`todo-write-tool` / Requirement "TodoWrite replaces the current list atomically"；`design.md` D4
- [x] 2.3 覆盖全量替换、空数组清空、全部完成清空、顺序保留和旧列表返回。
  验证：`npm test -- --run packages/agent-capability/tests/todo-write-tool.test.ts packages/agent-runtime/tests/todo-state-port.test.ts`
  来源：`todo-write-tool` / Scenarios "New list replaces existing list"、"Empty input clears the list"、"All completed input clears stored projection"
- [x] 2.4 增加 scope isolation negative tests：跨 session、跨 agent 的 todo 不互相覆盖，输入中出现 `sessionId`、`agentId`、`runId`、`owner` 或 `scope` 字段时以 `INVALID_INPUT` 拒绝。
  验证：`npm test -- --run packages/agent-capability/tests/todo-write-tool.test.ts packages/agent-runtime/tests/todo-state-port.test.ts`
  来源：`todo-write-tool` / Requirement "TodoWrite state is isolated by trusted execution scope"
- [x] 2.5 增加 session 内多次 TodoWrite revision 与多实例无状态测试：每次成功调用追加 revision，current projection 指向最新 revision，第二个 gateway 实例可读取同一 SQLite backend 的 current 和 history。
  验证：`npm test -- --run packages/agent-platform-gateway-local/tests/sqlite-gateway-stores.test.ts`
  来源：`todo-write-tool` / Scenarios "Multiple writes in one session append ordered revisions"、"Stateless app instances share persisted current state"
- [x] 2.6 增加 invocation-scoped idempotency：同一 owner/agent/session/request/run/context/tool-call 坐标重复调用返回首次 revision 结果，不追加重复 revision，不再次修改 current projection。
  验证：`npm test -- --run packages/agent-platform-gateway-local/tests/sqlite-gateway-stores.test.ts packages/agent-runtime/tests/todo-state-port.test.ts`
  来源：`todo-write-tool` / Scenario "Repeated invocation is idempotent"；`design.md` D3、D5

## 3. Safety, recovery, and architecture

- [x] 3.1 增加 safe result 和 failure mapping tests：invalid input、missing context、missing dependency、aborted 和 unexpected failure 返回 safe result，不泄露 hidden context 或其他 scope todo。
  验证：`npm test -- --run packages/agent-capability/tests/todo-write-tool.test.ts packages/agent-capability/tests/builtin-tool-executor.test.ts`
  来源：`todo-write-tool` / Requirement "TodoWrite returns safe structured results"
- [x] 3.2 增加 observability/redaction 测试：日志、审计、trace 和 metric 只包含 capability id、safe reason、item count、status summary、duration bucket，不包含完整 `content` 或 `activeForm`，且 TodoWrite 不通过 Tool metadata 定义观测 projector。
  验证：`npm test -- --run packages/agent-observability/tests/todo-write-observability.test.ts tests/agent-kernel/capability-governance.test.ts`；`npm test -- --run packages/agent-platform-gateway-local/tests/sqlite-gateway-stores.test.ts`
  来源：`todo-write-tool` / Requirement "TodoWrite observability is low-cardinality and non-sensitive"；`builtin-tool-framework` / Scenario "Tool metadata does not own observability projection"
- [x] 3.3 增加 architecture tests：`TodoWrite` 不导入 runtime/channel/app 私有实现，不新增 public Tool-specific invocation 协议，不在 Agent/core 中创建特判分支。
  验证：`npm run lint:architecture`；`npm test -- --run tests/architecture/builtin-tool-framework.test.ts`
  来源：`design.md` D1、D2；`builtin-tool-framework` / Scenario "TodoWrite uses scoped todo state dependency"
- [x] 3.4 更新 recovery replay policy 验证：`TodoWrite` descriptor 暴露 `IDEMPOTENT`，recovery replay 只有在 stable invocation key 可重建时才允许，并由 gateway 幂等锚点防止重复 side effect。
  验证：`npm test -- --run packages/agent-capability/tests/todo-write-descriptor.test.ts tests/agent-kernel/runtime-recovery-guard.test.ts`
  来源：`design.md` D5；`todo-write-tool` / Scenario "Repeated invocation is idempotent"
- [x] 3.5 增加 architecture tests：`defineTool`/`TodoWrite` 不承载 capability-specific observability projection owner，TodoWrite diagnostics 由 runtime/gateway/observability owner 派生。
  验证：`npm test -- --run tests/architecture/builtin-tool-framework.test.ts`
  来源：`builtin-tool-framework` / Scenario "Tool metadata does not own observability projection"
- [x] 3.6 增加 current todo context projection：TodoWrite 成功后写入 request context `flowVariables.todoWriteState` 并复用 `CAPABILITY_AFTER_RETURN` checkpoint；后续模型 render 从 checkpoint-backed context 注入未完成 todo，压缩或历史裁剪后仍可恢复。
  验证：`npm test -- --run packages/agent-core/tests/agent-routing-core.test.ts`
  来源：`todo-write-tool` / Requirement "TodoWrite state is restored into model context"
- [x] 3.7 增加 terminal guard：模型准备成功退出但 current todo 仍有未完成项时触发一次 bounded follow-up turn；guard 不创建 pending input、不无限循环。
  验证：`npm test -- --run tests/agent-kernel/config-assembly.test.ts tests/agent-kernel/main-path.test.ts`
  来源：`todo-write-tool` / Requirement "TodoWrite unfinished state gates terminal completion"

## 4. Validation

- [x] 4.1 运行 OpenSpec 严格校验。
  验证：`openspec validate add-ts-todowrite-tool --strict`
  来源：OpenSpec artifact completion
- [x] 4.2 运行相关 TS 验证门禁。
  验证：`npm run build`、`npm test`、`npm run test:contract`、`npm run lint:architecture`
  来源：`design.md` Verification Map
  备注：已通过 `npm run build`、`npx tsc -b`、`npm test`、`npm run test:contract`、`npm run lint:architecture` 和 `openspec validate add-ts-todowrite-tool --strict`。

## 归档前更新基线检查（非实施任务）

实现完成并验证通过后，在归档前按 proposal/design 的 Baseline Promotion Plan 提炼长期事实：

- 同步 `openspec/specs/todo-write-tool/spec.md`。
- 更新 `openspec/specs/builtin-tool-framework/spec.md` 的受控 dependency 名单。
- 更新 `openspec/designs/modules/agent-capability.md`、`openspec/designs/modules/agent-runtime.md`、`openspec/designs/modules/agent-app.md`。
- 更新 `openspec/designs/spec-to-design-map.md`。
- 检查长期文档没有重复定义同一 schema、dependency owner、scope key 或 state ownership。
## 5. Planning Tool Calling mode

- [x] 5.1 Add `nextAgent.system.planning-tool-calling-mode` to the app config schema and normalized `DefaultSystemConfig`, defaulting to `todo-write`.
  Verification: focused config assembly test confirms default `todo-write` and explicit `task-tools` values.
  Source: `builtin-tool-framework` / Requirement "Planning Tool Calling mode exposes exactly one planning tool family".
- [x] 5.2 Apply the mode in the builtin Tool catalog so `todo-write` mode exposes `TodoWrite` and suppresses `Task*`, while `task-tools` mode suppresses `TodoWrite` and allows `Task*`.
  Verification: `agent-capability` ToolCatalog unit test with synthetic `TodoWrite` and `TaskCreate`.
  Source: `builtin-tool-framework` / Scenario "TodoWrite mode suppresses Task-series tools" and "Task-series mode suppresses TodoWrite".
- [x] 5.3 Verify model Tool projection honors the mode in the product app composition path.
  Verification: `tests/agent-kernel/config-assembly.test.ts` captures model tools and confirms explicit `task-tools` mode does not include `TodoWrite`.
  Source: `builtin-tool-framework` / Scenario "App composition forwards the planning tool mode".
