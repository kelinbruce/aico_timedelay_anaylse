## 背景与问题（Why）

NextAgent 内置 Tool 的模型可见 `description` 普遍只有一句话，缺少模型选择工具和正确使用工具所需的路由提示、输出格式、失败语义和字段语义。业界同类工具的描述通常包含 "When to use / When NOT to use / Key behaviors" 结构化指引，NextAgent 当前缺少这一层。

当前问题举例：

- `Agent` 工具只有 "Delegate an isolated task to another governed Agent capability."，模型不知道子 Agent 无父上下文、结果对用户不可见、何时该用 Read/Grep 代替。
- `Bash` 工具未说明 `description` 字段用途、输出截断、非零退出码的 degraded 语义，也未指引用 Grep/Glob/Read 代替 `grep`/`find`/`cat`。
- `Write` 未说明覆盖已存在文件需要先完整 Read（硬性失败 `WRITE_REQUIRES_FULL_READ`）。
- `Read` 未说明输出是纯文本（无行号前缀）、截断与 `nextOffset` 语义。
- `Agent`、`Rag`、`Skill` 的 schema 核心字段缺少 `description`。

`AskUserQuestion` 是 NextAgent 内部描述质量的范本，本 change 把其他内置 Tool 对齐到同等质量。

## 变更范围（What Changes）

- 定义统一的内置 Tool 描述模板：一句话总结 + When to use + When NOT to use + Key behaviors。
- 按 模板重写 `Bash`、`Read`、`Edit`、`Glob`、`Grep`、`Write`、`Agent`、`Python`、`Rag` 的模型可见 `description`。
- `AskUserQuestion` 和 `Skill` 描述已达标，不改描述；`Skill` 补 schema 字段 `description`。
- 补齐 `Agent`、`Rag`、`Skill` 的 schema 字段 `description`。
- 不改变任何 Tool 的 input/output schema shape、执行语义、依赖、provider identity 或 replay policy。
- 不新增 Tool、不新增字段、不改变字段名。

## 影响范围（Impact）

- `agent-capability`：`packages/agent-capability/src/builtins/` 下各 Tool 的 `description` 字符串和部分 schema 字段 `description`。
- `agent-context-engine`：无代码变更；context rendering 已保真渲染 descriptor description，无需适配。
- `agent-model`：无代码变更；provider adapter 已保真传递 tool description。
- 测试：现有测试不直接断言描述字符串；如有间接断言则同步更新。
- 运行时：无 runtime 行为变更。

## 归档前更新基线（Baseline Promotion Plan）

行为契约：
- `openspec/specs/builtin-tool-framework/spec.md`：新增"内置 Tool 描述遵循统一模型可见模板"requirement。

长期背景：
- `openspec/overview.md`：无。

设计视图：
- `openspec/designs/architecture/capability-spi.md`：归档前提炼模型可见描述模板的设计约束。
- `openspec/designs/spec-to-design-map.md`：归档前增加导航。

验证入口：
- `openspec validate --all --strict`
- `npm run build`
- `npm test`
- `npm run lint:architecture`
