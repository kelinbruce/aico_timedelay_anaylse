## 1. Prompt 触发规则

- [x] 1.1 在 builtin system prompt 中增加 `AskUserQuestion` 触发规则、负向边界和不向用户暴露内部工具名的要求。
  验证：`npm run test:contract` 中 prompt/context assembly 相关断言；必要时补充 targeted Vitest 用例
  来源：`User-facing agents trigger AskUserQuestion for blocking ordinary user input`

## 2. Agent 能力边界

- [x] 2.1 在 `network-explorer` built-in Agent 配置中显式禁用 `AskUserQuestion`。
  验证：invoked Agent discovery/config 测试断言 `network-explorer` 不暴露 `AskUserQuestion`
  来源：`Invoked read-only network explorer does not directly create user questions`
- [x] 2.2 保持 `default-agent` 能看到 canonical built-in `AskUserQuestion`。
  验证：config assembly 测试断言 `default-agent` model input 仍包含 `AskUserQuestion`
  来源：`default-agent keeps user-question capability`

## 3. 验证和收尾

- [x] 3.1 确认本 change 没有修改 runtime producer routing，且没有新增自然语言自动路由或 `network-explorer` runtime special case。
  验证：code review 检查 `packages/agent-core/src/tools/tool-loop.ts` 未发生本 change 相关修改，architecture tests 通过
  来源：`design.md` 的 runtime 非目标和配置级边界决策
- [x] 3.2 运行 OpenSpec 和相关测试门禁，确认实现与规格一致。
  验证：`openspec validate --all --strict`、`npm run build`、targeted Vitest、`npm run test:contract`、`npm run lint:architecture`
  来源：proposal/design 验证入口

## 归档前更新基线检查（非实施任务）

实现完成并验证通过后，在归档前根据 proposal/design 的“归档前更新基线”处理：

- 同步 `openspec/specs/ask-user-question-trigger-policy/spec.md`。
- 提炼 user-facing Agent 与 invoked read-only Agent 的用户交互能力边界到长期 architecture/module 设计文档。
- 更新 `openspec/designs/spec-to-design-map.md` 导航。
