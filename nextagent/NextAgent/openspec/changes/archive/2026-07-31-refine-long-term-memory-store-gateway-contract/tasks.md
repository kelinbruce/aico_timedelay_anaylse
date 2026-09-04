## 1. 权威契约与 public types

- [x] 1.1 将修正后的 YAML 固化为严格可解析的 12-operation 事实，并增加自动 parity fixture，断言 operationId、request required fields、response required fields 和枚举。来源：proposal「变更范围」、design 1-3。证据：`long-term-memory-api-parity.test.ts` 通过；下载文件与仓内 reference 的 SHA256 均为 `338178B6D607A91E5B6096AAFD54DE0B7BEBF6D18992E6A32A59792B8782540C`。
- [x] 1.2 在 `agent-common` 增加 `MemoryType`、`KnowledgeSourceType`、`SharingState` durable scalar vocabulary。来源：design 2。证据：`npm run build -w @nextagent/agent-common` 通过。
- [x] 1.3 重写 `agent-contracts/gateway` 长期记忆 Record/Request/Query/Result，使字段和 required/optional 与 YAML 对齐，仅保留 `subjectId`、write options 和 SafeError 映射。来源：memory-core「V2 Gateway contract parity」、design 2-4。证据：contract tests 通过；`npm run build -w @nextagent/agent-contracts` 通过。
- [x] 1.4 增加 `LongTermMemorySharingGateway` 和 required `LongTermMemoryGatewayBindings.sharing`，删除 count/batch/legacy field alias/custom mutation union。来源：memory-sharing「Sharing Gateway operations」、design 1/8。证据：architecture source negative assertions 与 gateway composition contract tests 通过。

## 2. LOCAL Store 与 Retriever

- [x] 2.1 为 `long_term_memory` 增加 memory instance/source type/sharing state/source memory id 列、复合主键、迁移和索引，并集中更新 row/FTS mapper。来源：design 5。证据：fresh DB、pre-change schema migration、same-id cross-instance isolation/FTS tests 通过。
- [x] 2.2 按 YAML 实现 save/manual/get/list/delete 的字段校验、默认值、scope、分页、物理删除和 write options 语义。来源：memory-core「Store operations」。证据：`tests/contract/memory-core-contracts.test.ts` Store 正向与 runtime negative tests 通过。
- [x] 2.3 将 mutate 改为 flat PATCH，严格校验四个互斥组合并实现 CAS result。来源：memory-core「Flat memory mutation」。证据：四组合正向及 zero/multiple/orphan/invalid/CAS negative tests 通过。
- [x] 2.4 按 YAML 实现 search/detail 返回结构、offset=0、filter 和 telemetry。来源：memory-core「Retriever operations」。证据：search page/score/relevance、recall/access side-effect tests 通过。
- [x] 2.5 从 LOCAL core/wrapper 删除 count/batch public implementation 和仅由其使用的 dead code。来源：proposal「不在范围内」、design 1。证据：build 通过；architecture source negative assertion 通过。

## 3. LOCAL Sharing

- [x] 3.1 实现 publish 幂等创建/复用 SHARED record 和 unpublish 物理删除，禁止普通 Store 修改 SHARED。来源：memory-sharing「Publish and unpublish」。证据：重复 publish、非 owner、ordinary mutation/delete negative tests 通过。
- [x] 3.2 实现跨 subject shared list，只按 tenant+agent+instance 返回 SHARED summary，并映射 `ownerSubjectId`。来源：memory-sharing「Shared pool listing」。证据：same-tenant cross-owner visibility 与 cross-tenant/agent exclusion tests 通过。
- [x] 3.3 实现 1..100 条 copy 单事务 FORK 创建和输入顺序结果，任一非法 id 全批回滚。来源：memory-sharing「Copy shared memories」。证据：成功 ordering、limit、non-shared/cross-scope/rollback negative tests 通过。

## 4. Callers 与 composition

- [x] 4.1 更新 LOCAL/REMOTE/app bindings 和 disabled adapter 为 required `{ store, retriever, sharing }`，disabled 的 12 个 method 都显式返回 `LTM_DISABLED`。来源：design 8。证据：composition/disabled tests 通过。
- [x] 4.2 在 `agent-memory` 建立 private content/source stringify/parse helper，并迁移 memory tools 和 extraction，保持既有算法判断。来源：memory-extraction「Dreaming cross-session extraction and knowledge fusion」、design「算法与软件职责」。证据：memory tools/extraction tests 通过，包含 malformed retained content/source rejection。
- [x] 4.3 迁移 aging 到 YAML list/get/flat mutate/delete shape；ARCHIVED retention 使用分页 list+get，不恢复 `maxArchivedAt`。来源：memory-aging「LongTermMemoryState lifecycle transitions」、design 6。证据：memory aging tests 通过，包含多页 retention scan；三组 algorithm targeted tests 共 76/76 通过。

## 5. 完整验证与提交

- [x] 5.1 运行 change strict validation，确保 proposal/design/spec/tasks 一致且没有 count/batch/union 残留目标。来源：OpenSpec governance。证据：change strict 通过；`openspec validate --all --strict` 为 194/194 通过。
- [x] 5.2 运行 targeted tests、`npm run build`、`npm test`、`npm run test:contract`、`npm run lint:architecture`，记录每条命令实际结果；修复本变更引入的失败。来源：AGENTS 验证门禁。证据：build 通过；unit 87 files/606 tests 通过（另 2 files/2 tests skipped）；contract 30/268 通过；architecture 31/187 通过；algorithm targeted 3 files/76 tests 通过；`git diff --check` 通过。
- [x] 5.3 使用 `$nextagent-code-review` 对提交范围执行 Frozen core contract、Architecture boundary、Minimal kernel、Security、OpenSpec consistency、Clean Code 语义检视；P0/P1 必须修复并复检。来源：AGENTS Push 门禁。证据：实例隔离、runtime schema 和 mutation options 三项 P1 已修复并复检，最终结论 `PASS`，无 P0/P1/P2 遗留。
- [x] 5.4 只暂存本 change 文件，整理此前错误方向的提交历史为职责清晰的 spec 与 implementation commits，并 push 当前分支。来源：用户提交要求。证据：分支历史已整理为 `docs(openspec)` 与 `feat(memory)` 两个提交；仅暂存本 change 文件；`git push --force-with-lease origin codex/extend-long-term-memory-gateway-v2-contracts` 成功，GitCode MR !513 已更新。

## 归档前更新基线检查（非实施任务）

归档前更新 proposal/design 指定的 stable specs、architecture、module docs 和 spec-to-design-map；该工作由 archive/design-sync 流程执行，不在本实施 change 中提前修改长期基线。
