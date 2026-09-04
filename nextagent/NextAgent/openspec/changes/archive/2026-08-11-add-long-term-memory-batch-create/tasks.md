## 1. `FN-8.5 长期记忆 search/list/detail/count/state transition`

- [x] 1.1 先为 Gateway、management service 和 Web route 编写批量新增失败测试，覆盖 1/100 正常边界、0/101 整体拒绝、三条中一条 guardrail 失败、50 条 `CONFIGURED` 容量、逐项幂等键和可信 scope 字段注入拒绝。
  来源：`FN-8.5` + Requirement `长期记忆批量新增保持逐项准入和结果可核对` + Scenarios `三条记录部分成功`、`批量大小越界时整体拒绝`、`重复条目按自己的幂等键收敛`；Requirement `Management 调用使用可信 Scope 和取消上下文` + Scenario `批量新增注入唯一可信 Scope`。
  验证：在实现前运行相关 Vitest 文件并确认新增用例因 batch contract/route 缺失而失败；实现后运行同一命令，预期全部通过并断言 negative case 无非法写入。

- [x] 1.2 在 `agent-contracts/channel` 和 `agent-contracts/gateway` 增加仅限 batch create 的 item、command/request、result 和 method，保持 Channel contract 不依赖 Gateway contract，且不加入 batch delete 或其它 API v2 扩展。
  来源：`FN-8.5` + Requirements `长期记忆批量新增保持逐项准入和结果可核对`、`长期记忆管理提供唯一 Channel 端口`；design“修改方案”第 1、4 项。
  验证：运行 `npm run test:contract -- --runInBand`（若脚本不接受参数则运行 `npm run test:contract`）及 `npm run lint:architecture`，预期 contract shape 和依赖边界通过。

- [x] 1.3 在 `agent-memory` management service 和 write coordinator 实现顺序逐项准入、幂等键映射、取消检查及聚合结果，复用现有 guardrail 和安全错误映射。
  来源：`FN-8.5` + Requirement `长期记忆批量新增保持逐项准入和结果可核对` + Scenario `三条记录部分成功`；Requirement `Management 调用使用可信 Scope 和取消上下文` + Scenario `批量准入期间取消`；design“修改方案”第 3、5 项。
  验证：运行 `npm test -w @nextagent/agent-memory -- --run`，预期批量正常、部分失败、取消和 guardrail negative tests 全部通过。

- [x] 1.4 在 local Gateway 增加逐项 transaction 的 batch create，复用 scoped save、幂等 anchor、FTS 写入和 ACTIVE+ARCHIVED 的 50 条 `CONFIGURED` 容量计数。
  来源：`FN-8.5` + Requirement `长期记忆批量新增保持逐项准入和结果可核对` + Scenarios `三条记录部分成功`、`重复条目按自己的幂等键收敛`；design“修改方案”第 4、5 项。
  验证：运行 `npm test -w @nextagent/agent-platform-gateway-local -- --run` 和相关 local Gateway contract tests，预期部分成功、归档不释放容量、幂等重试及存储失败路径通过。

- [x] 1.5 在 `agent-channel-web` 增加 strict batch schema 和 `POST /api/v1/memory/long-term-mem/batch`，只从 trusted resolver 构造 scope并委托 management port。
  来源：`FN-8.5` + Requirement `长期记忆管理提供唯一 Channel 端口` + Scenarios `Channel 通过 Management Port 调用批量新增`、`Management Port 的公开方法集合包含批量新增`；Requirement `Management Boundary 由 Composition 显式启用` + Scenarios `可用依赖启用批量新增 Route`、`缺少依赖不产生批量直连`；design“修改方案”第 2 项。
  验证：运行 `npm test -w @nextagent/agent-channel-web -- --run`，预期 route、schema、可信 scope 注入和 4xx validation tests 全部通过。

- [x] 1.6 完成三个 legacy Requirements 的原子迁移：来源 spec 使用 `REMOVED`，`memory-core` 使用目标 `ADDED`，未触及 Requirements 原位保留，并更新 change 内直接引用。
  来源：design“存量 Requirement 迁移方案”。
  验证：运行 `openspec validate add-long-term-memory-batch-create --strict`，并用 `rg` 检查迁移对和引用；预期无重复目标事实、无遗失行为且 legacy spec 未被退役。

## 2. Change 整体验证

- [x] 2.1 验证批量新增后端与既有导入/导出前端组合可构建、可测试，且未带入 B305 的 batch delete、PATCH 或 query contract 变化。
  来源：proposal“影响范围”；design“验证策略”和“修改方案”的明确不修改边界。
  验证：两个 change strict validation、全量 OpenSpec 262/262、受影响后端 TypeScript build、16 个 memory contract tests、49 个 Web route/schema tests、112 个 memory/local Gateway tests、前端 71 个定向 tests、前端 build 与 multi-host build、architecture lint、根 `npm test` 1455 个测试和 `git diff --check` 均通过。根 `npm run build` 的 4 个 `developerDiagnostics` TypeScript 错误以及全量 `test:contract` 的 3 个失败均位于本 change 未触及的主线文件，按基线问题记录。

- [x] 2.2 使用 `nextagent-skill-review` 和 `nextagent-code-review` 完成 push 前语义检视，确认 frozen contract 变更有本 active change 授权、浏览器不拥有可信 scope/安全准入、两个迁移分支互不包含对方代码。
  来源：AGENTS.md push 门禁；design“验证策略”。
  验证：两次模型语义检视结论均为 PASS，或无 P0/P1 的 PASS WITH FOLLOW-UP；P0/P1 未清零时不得 push。

## 归档前更新基线检查（非实施任务）

实现和验证完成后，归档流程按照 design 的“长期基线刷新计划”归并 `memory-core`、legacy spec、`FN-8.5`、`F-8.2`、overview、memory architecture、相关 modules 和 spec-to-design-map；不新增 ADR，不把该归并作为本次实施 task。
