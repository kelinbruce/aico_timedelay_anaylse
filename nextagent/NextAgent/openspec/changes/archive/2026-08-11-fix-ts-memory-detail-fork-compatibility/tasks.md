## 1. 跨 Function 共享测试基线（`FN-8.2` + `FN-1.11`）

- [x] 1.1 在 agent-kernel integration 中锁定真实 canonical 路径：调用 `get_memory_detail` 读取来源 run 位于源消息前缀内的记忆，把实际 Capability Result 写入源会话后执行 fork；确认本地 canonical `toolOutput` 保留来源，模型后续请求、durable/copied Capability Result 均不含来源，且成功创建子会话并保留完整业务 `content`。
  来源：`FN-8.2 检索和写入记忆` + `memory-tools / get_memory_detail L2 retrieval / 正常读取完整业务详情、详情结果排除内部来源`；`FN-1.11 从消息派生子会话` + `session-fork-from-message / Fork From Durable Visible Assistant Message / 用户从已持久化 assistant 回复派生新会话`；`design.md / FN-8.2 检索和写入记忆 / 修改方案`
  验证：`npx vitest run --config vitest.config.release.ts tests/agent-kernel/memory-runtime-integration.test.ts tests/agent-kernel/session-fork-runtime.test.ts`；目标实现前预期本地来源保留或 fork 兼容断言至少一项失败，目标实现后预期全部通过。

- [x] 1.2 为既有 fork fail-closed 行为建立通过的 characterization：历史形态或人为构造的 Capability Result 若仍包含源前缀 run ID，必须在 composite write 前以 `SESSION_FORK_SOURCE_RUN_REF` 失败，且不得创建子会话或残留 staged promotion。
  来源：`FN-1.11 从消息派生子会话` + `session-fork-from-message / Forked Session Is Isolated From Source Session / Unsafe source-bound refs fail atomically`；`design.md / FN-8.2 检索和写入记忆 / 修改方案`；`proposal.md / 非目标`
  验证：`npx vitest run --config vitest.config.release.ts tests/agent-kernel/session-fork-runtime.test.ts`；实现前后均预期 negative case 通过，错误码保持 `SESSION_FORK_SOURCE_RUN_REF` 且 child session 不存在。

## 2. `FN-8.2 检索和写入记忆`

- [x] 2.1 在 `packages/agent-memory/tests/memory-tools-provider.test.ts` 增加目标行为测试：含内部 `source` 的 owned record 仍返回完整 category-specific `content`，`get_memory_detail` output schema 和实际成功 `entry` 均不含 `sourceTrace` 或原始 `source`，closed schema 拒绝人为加入的 `sourceTrace`；原始 Capability result 的 `metadata.sourceTrace` 按 `longTermMemoryId` 保留来源，且 memory tool 不恢复专用 `MEMORY_TOOL_RESULT_TOO_LARGE` 失败。
  来源：`FN-8.2 检索和写入记忆` + `get_memory_detail L2 retrieval` + `正常读取完整业务详情`、`详情结果排除内部来源`、`诊断来源受公共结果容量约束`、`未声明顶层字段被拒绝`
  验证：`npx vitest run --config vitest.config.release.ts packages/agent-memory/tests/memory-tools-provider.test.ts packages/agent-capability/tests/result-contract.test.ts`；实施前预期 metadata provenance 或 metadata 容量断言失败，实施后预期原始结果保留来源、统一结果 envelope 计入 metadata 容量且全部测试通过。

- [x] 2.2 在 `packages/agent-memory/src/memory-tools.ts` 原子分离 `get_memory_detail` 的业务结果与本地诊断：从 `detailEntrySchema` 和 `projectDetailEntry` 删除 `sourceTrace`，使用 `parseMemorySource` 把成功 record 的来源写入顶层 `metadata.sourceTrace[]`，每项按 `longTermMemoryId` 关联；复用统一 Capability result envelope 容量，不新增 memory-specific 结果预算或失败码。不得修改 `LongTermMemoryRecord`、Gateway、memory extraction/fusion、aging 或 runtime fork guard。
  来源：`FN-8.2 检索和写入记忆` + `get_memory_detail L2 retrieval` + `详情结果排除内部来源`、`未声明顶层字段被拒绝`；`design.md / FN-8.2 检索和写入记忆 / 修改方案`
  验证：`npx vitest run --config vitest.config.release.ts packages/agent-memory/tests/memory-tools-provider.test.ts packages/agent-capability/tests/result-contract.test.ts`；预期完整 suites 通过，业务 `entry` 无来源、原始 result metadata 有关联来源、closed schema 生效，metadata 计入统一结果容量且没有专用超限失败码。

- [x] 2.3 在 `packages/agent-core/tests/capability-result-projection.test.ts` 先增加回归，再在 `modelVisibleCapabilityMetadata` 增加 exact top-level `sourceTrace` 过滤：模型可见 payload 不含 `metadata.sourceTrace` 或既有 `toolDiagnostics`，保留其他安全 metadata，不递归修改 `structuredPayload`，不按 Tool 名称分支。
  来源：`FN-5.2 调用能力` + `capability-catalog / Capability 内部来源诊断保持模型不可见`；`design.md / FN-5.2 调用能力 / 修改方案`
  验证：`npx vitest run --config vitest.config.release.ts packages/agent-core/tests/capability-result-projection.test.ts`；实现前预期 `sourceTrace` 过滤断言失败，实现后预期 suite 通过。

- [x] 2.4 验证完整 L2 内容、读取副作用和内部追溯事实无回退：真实 Gateway record 的 retained `source` 保持存在，archived memory 仍能在详情读取时恢复，访问相关副作用和下一轮模型消费保持既有行为；授权 management detail 仍按相同 Owner/Agent Scope 和 `longTermMemoryId` 返回 retained `source`；本地 canonical `toolOutput` 包含 `metadata.sourceTrace`，而模型后续请求、durable Capability Result、public result projection 和 fork copy 均不含该来源。
  来源：`FN-8.2 检索和写入记忆` + `get_memory_detail L2 retrieval`；`FN-5.2 调用能力` + `Capability 内部来源诊断保持模型不可见`；`design.md / 验证策略`
  验证：`npx vitest run --config vitest.config.release.ts tests/agent-kernel/memory-runtime-integration.test.ts packages/agent-memory/tests/long-term-memory-management.test.ts`；预期 revival、完整 `content`、模型第二轮消费、retained source、授权管理查询和本地一步式来源断言通过，所有模型/持久化/public/fork surfaces 均无来源。

## 3. Change 整体验证

- [x] 3.1 验证本 change 与并行 memory/logging changes 的语义边界：回复记忆披露继续只消费 `longTermMemoryId`、`category` 和 `content`；Capability failure 统一化不把 `sourceTrace` 放回模型 payload；canonical `toolOutput` special-field 脱敏/容量规则保持不变；无 `agent-contracts`、Gateway、数据库、runtime Tool 特例、递归业务 payload 清洗或新诊断容器。
  来源：`proposal.md / 目标与非目标`；`design.md / FN-8.2 检索和写入记忆 / 修改方案`、`风险与取舍`
  验证：`rg -n "sourceTrace|parseMemorySource|projectDetailEntry|get_memory_detail|modelVisibleCapabilityMetadata" packages tests frontend/agent-web --glob "*.ts" --glob "*.tsx"` 并执行 code review；预期 memory owner 只在 result metadata 构造来源，core 只按 exact key 过滤，runtime 无 Tool 名称放行，前端无来源消费。

- [x] 3.2 运行 backend build 和常规测试，确认实现可编译且没有未记录的运行时回归。
  来源：`proposal.md / 影响范围`；`design.md / 验证策略`
  验证：`npm run build`、`npm test` 和受影响测试；验收要求 build 退出码为 0、受影响测试全部通过，且全量测试相对同提交 `origin/main` 不新增失败。
  当前结果：`npm run build` 退出码为 0；`npm test` 为 1810 项通过、1 项失败，唯一失败为 `per-call-skill-trust.test.ts` 的既有 Skill metadata 断言漂移，已在未应用本 change 的 `origin/main` 同提交上复现。受影响的 6 个测试文件共 150 项全部通过，因此本 change 未新增常规测试回归。

- [x] 3.3 运行 contract 和 architecture 门禁，确认未改变 frozen contract 或 package owner 边界。
  来源：`proposal.md / 影响范围`；`design.md / 验证策略`
  验证：`npm run test:contract`、`npm run lint:architecture`；验收要求 architecture 退出码为 0，且 contract 相对同提交 `origin/main` 不新增失败。
  当前结果：`npm run lint:architecture` 退出码为 0，46 个文件、290 项测试全部通过；`npm run test:contract` 为 356 项通过、2 项失败，失败分别为默认 `local-api-call` gateway 和 workflow `requestHeaders` 的既有断言漂移，均已在未应用本 change 的 `origin/main` 同提交上复现。本 change 未修改 frozen contract、gateway 配置或 workflow 路径。

- [x] 3.4 严格校验本 change，确认增量 spec 和实施任务保持一致。
  来源：`proposal.md / 影响范围`；`design.md / 验证策略`
  验证：`openspec validate fix-ts-memory-detail-fork-compatibility --strict`；预期退出码为 0。

- [x] 3.5 运行跨 change 的 OpenSpec 完整门禁，确认仓库所有 stable spec 与 active change 均通过严格校验。
  来源：`proposal.md / 影响范围`；`design.md / 验证策略`
  验证：`openspec validate --all --strict`；预期退出码为 0。push 前另按仓库门禁执行 `$nextagent-code-review`，结论必须为 `PASS` 或不存在 P0/P1 的 `PASS WITH FOLLOW-UP`。
  当前结果：288 项通过、0 项失败；本 change 与仓库其他 stable spec、active change 均通过严格校验。push 前另按仓库门禁执行 `$nextagent-code-review`。

## 归档前更新基线检查（非实施任务）

实现和完整验证完成后，归档流程按照 `design.md` 的“长期基线刷新计划”归并 `memory-tools` stable spec、`FN-8.2`、overview、core contracts 和 `agent-memory` module 的长期事实；不得把历史消息迁移、临时合并冲突或实施步骤写入长期基线。
