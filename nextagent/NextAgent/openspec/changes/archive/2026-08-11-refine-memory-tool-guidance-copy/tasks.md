## 1. FN-8.2 检索和写入记忆

- [x] 1.1 把 `packages/agent-memory/src/memory-tools.ts` 中 `searchMemoryToolDefinition` 的 `description` 替换为新固化文案（结构化"何时检索 + 参数引导"两段式，单 string 字面量，不用 `+` 拼接）。验证：单元测试断言新文案字面量。
- [x] 1.2 把 `getMemoryDetailToolDefinition` 的 `description` 替换为新固化文案（含"Pass up to 20 longTermMemoryIds"和完整结构化字段语义，单 string 字面量）。验证：单元测试断言新文案字面量。
- [x] 1.3 把 `addMemoryToolDefinition` 的 `description` 替换为新固化文案（"引用 memory 策略段 + 按 category 列出内容字段格式"，单 string 字面量）。验证：单元测试断言新文案字面量。
- [x] 1.4 同步更新 `packages/agent-memory` 中断言三个 `description` 字面量的单元/契约测试，使其与新固化文案一致。

## 2. FN-10.4 自定义工具和提示词

- [x] 2.1 把 `packages/agent-context-engine/prompt-templates/builtin/SYSTEM_PROMPT/memory.md` 替换为新策略正文：按 `search_memory` / `get_memory_detail` / `add_memory` 三个工具组织，包含首屏用户特征加载（fire-once-per-session）、按需召回、五类存记忆触发条件、不存什么清单、以及最小调用提示（单次 ID 上限、按 category 字段格式）。
- [x] 2.2 确认 `prompt-template-assembly` 相关测试仍断言 `memory` section 在 `memoryEnabled=true` 时渲染、`memoryEnabled=false` 时过滤、内容来自 `memory.md`；如有断言旧正文具体句子的测试，同步更新。

## 3. 共享验证

- [x] 3.1 运行 `openspec validate refine-memory-tool-guidance-copy --strict` 与 `openspec validate --all --strict`。
- [x] 3.2 运行 `packages/agent-memory` 与 `packages/agent-context-engine` 受影响单元测试。
- [x] 3.3 运行 `npm run lint:architecture`。
- [x] 3.4 对改动执行 push 前 `$nextagent-code-review` 模型语义检视。

## 4. 归档

- [ ] 4.1 归档本 change：合并 `memory-tools` spec 三个 Requirement 的新默认文案与新 semantic guidance、合并 `prompt-template-assembly` spec `System prompt memory guidance section` 的新正文边界；同步 `openspec/designs/architecture/memory.md`（如需）与 spec-to-design-map。
