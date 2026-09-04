## 1. 更新内置 Tool 描述

- [x] 1.1 按 `design.md` 第 2 节文案更新 `packages/agent-capability/src/builtins/bash/bash-tool.ts` 的 `bashToolDefinition.description`。
  验证：`npm run build`；`npm test` 中 bash-capability 相关测试通过
- [x] 1.2 按 `design.md` 更新 `packages/agent-capability/src/builtins/read/read-tool.ts` 的 `readToolDefinition.description`。
  验证：`npm run build`；read-capability 相关测试通过
- [x] 1.3 按 `design.md` 更新 `packages/agent-capability/src/builtins/edit/edit-tool.ts` 的 `editToolDefinition.description`。
  验证：`npm run build`；edit-capability 相关测试通过
- [x] 1.4 按 `design.md` 更新 `packages/agent-capability/src/builtins/glob/glob-tool.ts` 的 `globToolDefinition.description`。
  验证：`npm run build`；glob-capability 相关测试通过
- [x] 1.5 按 `design.md` 更新 `packages/agent-capability/src/builtins/grep/grep-tool.ts` 的 `grepToolDefinition.description`。
  验证：`npm run build`；grep-capability 相关测试通过
- [x] 1.6 按 `design.md` 更新 `packages/agent-capability/src/builtins/write/write-tool.ts` 的 `writeToolDefinition.description`。
  验证：`npm run build`；write-capability 相关测试通过
- [x] 1.7 按 `design.md` 更新 `packages/agent-capability/src/builtins/agent/agent-tool.ts` 的 `agentToolDefinition.description`。
  验证：`npm run build`；agent-tool 相关测试通过
- [x] 1.8 按 `design.md` 更新 `packages/agent-capability/src/builtins/python/python-tool.ts` 的 `pythonToolDefinition.description`。
  验证：`npm run build`；python-capability 相关测试通过
- [x] 1.9 按 `design.md` 更新 `packages/agent-capability/src/builtins/rag/rag-tool.ts` 的 `ragToolDefinition.description`。
  验证：`npm run build`；rag 相关测试通过

## 2. 补齐 schema 字段 description 与 default

- [x] 2.1 在 `packages/agent-capability/src/builtins/agent/agent-schemas.ts` 为 `agentId` 和 `prompt` 补充 `description`（见 `design.md` 第 3.1 节表格）。
  验证：`npm run build`；schema 不改变 shape
- [x] 2.2 在 `packages/agent-capability/src/builtins/rag/rag-schemas.ts` 为 `query`、`indexes`、`topK` 补充 `description`，并为 `topK` 补充 `"default": 5`（见 `design.md` 第 3.1/3.2 节）。
  验证：`npm run build`；schema 不改变字段名/类型/约束
- [x] 2.3 在 `packages/agent-capability/src/builtins/grep/grep-schemas.ts` 为 `output_mode` 补充 `"default": "files_with_matches"`（见 `design.md` 第 3.2 节）。
  验证：`npm run build`；schema 不改变字段名/类型/约束
- [x] 2.4 在 `packages/agent-capability/src/builtins/skill/skill-tool.ts` 的 `skillToolDefinition.inputSchema` 为 `name` 和 `args` 补充 `description`。
  验证：`npm run build`；schema 不改变 shape

## 3. 验证和收尾

- [x] 3.1 运行 `openspec validate --all --strict` 确认 change 格式合法。
  验证：命令退出码 0
- [x] 3.2 运行 `npm run build`、`npm test`、`npm run test:contract`、`npm run lint:architecture` 确认无回归。
  验证：全部通过
- [x] 3.3 确认本 change 未改变任何 Tool 的执行语义、依赖或 replay policy；schema 变更仅限新增字段 `description` 和 `default`，未改变字段名/类型/`required`/`maxLength`/`maxItems`/`minimum`/`maximum`。
  验证：code review 检查点：diff 只包含 description 字符串、schema 字段 description 新增和 schema default 新增

## 归档前更新基线检查（非实施任务）

实现完成并验证通过后，在归档前根据 proposal/design 的"归档前更新基线"处理：

- 同步 `openspec/specs/builtin-tool-framework/spec.md` 新增的"内置 Tool 描述遵循统一模型可见模板"requirement。
- 提炼模型可见描述模板的设计约束到 `openspec/designs/architecture/capability-spi.md`。
- 更新 `openspec/designs/spec-to-design-map.md` 导航。
