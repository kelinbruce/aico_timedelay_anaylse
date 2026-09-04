## 1. OpenSpec change 文档

- [ ] 1.1 创建 `openspec/changes/refine-memory-add-memory-guidance/` 及 proposal.md、specs/memory-tools/spec.md、specs/prompt-template-assembly/spec.md、design.md、tasks.md
  - 验证：`openspec status --change refine-memory-add-memory-guidance` 显示 `isComplete: true`
- [ ] 1.2 `openspec validate --all --strict` 通过
  - 验证：命令退出码 0，无 delta 合并键冲突或规范关键词缺失

## 2. 更新 `memory.md` 正文

- [ ] 2.1 把 `add_memory` 触发条件从 5 类收敛为 2 类（显式记忆指令、澄清后的确认信息），列出典型措辞
  - 验证：`rg -n "Trigger 1|Trigger 2|Explicit instruction|Clarifications supplied" packages/agent-context-engine/prompt-templates/builtin/SYSTEM_PROMPT/memory.md`
- [ ] 2.2 移除"任务异常触发""用户纠正历史信息""稳定偏好/约束"作为独立触发类别
  - 验证：`rg -n "Task abnormal|User correction|stable preference" packages/agent-context-engine/prompt-templates/builtin/SYSTEM_PROMPT/memory.md` 无命中
- [ ] 2.3 恢复并保留 skip list（What not to save），明确声明 skip list 横切适用于全部触发类别
  - 验证：`rg -n "What not to save|skip list|applies to all" packages/agent-context-engine/prompt-templates/builtin/SYSTEM_PROMPT/memory.md`
- [ ] 2.4 新增 turn 内核验规则：承诺记住的 turn 内必须存在 `add_memory` 调用，未产生则补发
  - 验证：`rg -n "verify.*add_memory|before finishing any turn" packages/agent-context-engine/prompt-templates/builtin/SYSTEM_PROMPT/memory.md`
- [ ] 2.5 新增"口头确认不持久化"边界声明：`add_memory` 是唯一持久化机制，"Got it""Noted""I'll remember that"不持久化
  - 验证：`rg -n "Got it|Noted|persist NOTHING|only mechanism" packages/agent-context-engine/prompt-templates/builtin/SYSTEM_PROMPT/memory.md`
- [ ] 2.6 新增"每项独立调用、不臆造可选字段"规则
  - 验证：`rg -n "Extract every item|Never create values for optional fields" packages/agent-context-engine/prompt-templates/builtin/SYSTEM_PROMPT/memory.md`
- [ ] 2.7 移除"For case (1), please directly invoke the tool. In other cases, invoke the tool after the session ends."note
  - 验证：`rg -n "after the session ends" packages/agent-context-engine/prompt-templates/builtin/SYSTEM_PROMPT/memory.md` 无命中
- [ ] 2.8 保留第 1 节 `search_memory` / `get_memory_detail` 检索策略不变
  - 验证：`git diff` 确认第 1 节无改动

## 3. 测试

- [ ] 3.1 更新或新增 `memory.md` section 内容相关 prompt template tests，断言恰好 2 类触发条件
  - 验证：`npm test -- --grep "memory"` 通过
- [ ] 3.2 断言 skip list 存在且声明横切适用
  - 验证：测试通过
- [ ] 3.3 断言 turn 内核验规则和"口头确认不持久化"边界存在
  - 验证：测试通过
- [ ] 3.4 negative case：断言正文不含"任务异常触发"作为独立类别
  - 验证：测试通过
- [ ] 3.5 既有 `memory` section 渲染顺序和 `memoryEnabled` 门控测试不回归
  - 验证：prompt template assembly tests 通过

## 4. 验证门禁

- [ ] 4.1 `npm run build` 通过
- [ ] 4.2 `npm test` 通过
- [ ] 4.3 `npm run lint:architecture` 通过
- [ ] 4.4 `openspec validate --all --strict` 通过
