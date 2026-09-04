## 1. 前置依赖与核心契约

- [ ] 1.1 确认 `refine-long-term-memory-store-gateway-contract` 已完成并可作为 `memoryId`、有界字符串 `content` 和 `agent-memory` 私有解析边界的唯一前置契约，本 change 只实现当前 Gateway contract shape。
  验证：`openspec validate refine-long-term-memory-store-gateway-contract --strict`；code review 检查本 change 没有平行 memory DTO/field 分支。
  来源：proposal「影响范围」、design「背景和现状」「发布与回滚计划」。
- [x] 1.2 完成 `agent-contracts/session` 和 `agent-contracts/channel` 升级确认，冻结 `memoryId + content`、`referenced + created`、非空可选 metadata 和 channel public DTO 的唯一 shape。
  验证：2026-07-21 已完成群内确认（用户回执）；`openspec validate add-ts-response-memory-disclosure --strict`。
  来源：proposal「影响范围」、design 决策 1、6 和「待确认问题」。
- [ ] 1.3 在 `agent-contracts/session` 增加 `ResponseMemoryDisclosure` 条目、集合、message metadata 类型和 runtime schema/guard，不增加来源、版本、标题、Owner Scope 或独立 `memoryType`。
  验证：`npm run build -w @nextagent/agent-contracts`；session contract tests 覆盖合法、空集合、未知字段、非法 content 和单条 content 超出既有有界契约；不得给 disclosure 集合增加本能力专用总字节或总条目限制。
  来源：response-memory-disclosure「完成回复披露实际引用和同步新增的长期记忆」、design 决策 1。
- [ ] 1.4 在 `agent-contracts/channel` 增加同形 public disclosure DTO/schema，并用 contract test 固定 channel 不依赖 session subpath、DTO 不扩展通用 `StreamEnvelope` extension 机制。
  验证：`npm run build -w @nextagent/agent-contracts`；`npm run test:contract` 中增加 channel DTO shape 和 forbidden dependency negative assertions。
  来源：response-memory-disclosure「disclosure 在 terminal commit 和 Web 投影一致」、design 决策 6。

## 2. `agent-memory` 产生准确写入回执

- [ ] 2.1 修改 `add_memory` 成功路径，从 Store 返回记录解析规范化 `content`，在 output-schema-validated structured result 中加入仅含 `memoryId` 和 `content` 的 `memoryWriteReceipt`；失败、超时和未提交路径不得产生回执。
  验证：`npm test -w @nextagent/agent-memory -- memory-tools-provider.test.ts`，覆盖普通输入、alias/string content、Store 规范化差异、失败和超时。
  来源：memory-tools「add_memory 提供可前置剥离的内部写入回执」、design 决策 2。
- [ ] 2.2 实现两段式校验：Store 调用前校验模型输入、规范化后的可持久化 content 和预计 receipt 大小，非法或单条完整 receipt 预计超过既有 24000-byte 工具结果上限时安全失败且不调用 Store；Store 成功返回后校验 ACTIVE record、只抽取 `memoryId + content` 构造 memory-tool-private receipt，并由 `addMemoryOutputSchema` 执行 exact-field 校验，禁止来源、版本、访问次数、Owner Scope、未知字段或其他 retained record 字段进入 receipt。
  验证：`npm test -w @nextagent/agent-memory -- memory-tools-provider.test.ts`；前置非法输入和单条 receipt 超过既有结果边界时必须断言 Store 未被调用；Store 返回记录场景必须断言 receipt 等于实际持久化内容且只含 `memoryId + content`，output schema 必须拒绝带未知字段的 receipt，但不得对 Store 返回后的 schema failure 断言“Store 未调用”。
  来源：memory-tools「add_memory 提供可前置剥离的内部写入回执」、design 决策 2 的单次结果安全边界。
- [ ] 2.3 把 canonical `add_memory` descriptor 从 `NON_IDEMPOTENT` 改为 `IDEMPOTENT`，继续使用原始 `runId + toolCallId` 派生的 invocation key；不得增加内容级去重或新的 Gateway 契约。增加故障恢复 characterization：首次 Store 写入已提交但 invocation 结果不确定时，同 key 恢复返回首次记录且只产生一条记忆；不同 `toolCallId` 即使内容相同也使用不同 key 并保持独立。reply disclosure 不参与 replay 判断。本 task 不修改 `search_memory`、`get_memory_detail` 的 replay policy/读取副作用，也不调整通用 runtime replay guard、候选筛选或 risk-policy 执行职责。
  验证：`npx vitest run --config vitest.config.release.ts packages/agent-memory/tests/memory-tools-provider.test.ts packages/agent-capability/tests/idempotency-contract.test.ts tests/agent-kernel/tool-loop.test.ts`；`npm run test:contract -- tests/contract/memory-core-contracts.test.ts`。断言同 key 返回同一 `memoryId`、版本和计数不变且 list total 为 1，并覆盖不同 key 不被折叠；code review 检查其他 memory tool descriptor、通用 replay/risk-policy 路径和 checkpoint contract 不在本 change diff 中。
  来源：memory-tools「add_memory 提供可前置剥离的内部写入回执」、response-memory-disclosure「disclosure 与 terminal commit 和 Web 投影一致」、design 决策 2、4。

## 3. `agent-core` 收集并隔离 request disclosure

- [ ] 3.1 在 tool loop 增加精确匹配 canonical `BUNDLED memory-tools/add_memory` 的前置回执消费和 sanitized result helper，保证 hook、capability result message、live delta、日志、metric、trace 和下一次 model request 都看不到 `memoryWriteReceipt` 或新增内容副本。
  验证：`npm test -w @nextagent/agent-core -- agent-routing-core.test.ts agent-routing-core-security.test.ts tool-structured-delta-emission.test.ts`；增加非可信 capability 伪造同名字段的实际失败断言。
  来源：response-memory-disclosure「记忆披露不改变模型上下文和 memory tool 可见结果」、memory-tools delta、design 决策 2。
- [ ] 3.2 在 `AFTER_CAPABILITY_RESULT` hook 后从 canonical `BUNDLED memory-tools/get_memory_detail` 的有效 L2 结果采集 `pendingReferenced`，排除 `search_memory`、同名非可信 capability、失败详情、被 hook 移除或改变的原始详情。
  验证：`npm test -w @nextagent/agent-core -- agent-routing-core.test.ts agent-routing-core-security.test.ts`，覆盖 L1 候选、L2 成功、hook 改写、失败和同一 memory 重复读取。
  来源：response-memory-disclosure「引用判定以进入后续模型循环的 L2 详情为准」、design 决策 3。
- [ ] 3.3 在 model request 完成组装并即将提交前把 pending 候选提升为 `referenced`，按 `memoryId` 保留首次顺序和最后快照；没有发生后续模型调用时不得计入引用。
  验证：`npm test -w @nextagent/agent-core -- agent-routing-core.test.ts parallel-tool-loop.test.ts`，断言实际 model request 内容、未调用模型、重复详情和最终完成回复四类路径。
  来源：response-memory-disclosure「引用判定以进入后续模型循环的 L2 详情为准」、design 决策 1、3。
- [ ] 3.4 在一次 `Agent.execute` 内复用 `RequestLocalCapabilityState`，并把 `referenced`、`pendingReferenced` 和 `created` 的 JSON-compatible snapshot 同步到保留的 `flowVariables.responseMemoryDisclosureDraft`，只供同一次连续执行的 terminal assembly 读取。不得为 disclosure 新增 `saveCheckpoint` 调用，不得让 checkpoint draft 参与 replay 决策；retry/edit/resubmit/successor 新 context 均不得复制前序 draft。
  验证：`npm test -w @nextagent/agent-core -- agent-routing-core.test.ts parallel-tool-loop.test.ts agent-routing-core-security.test.ts` 和 `npm test -w @nextagent/agent-runtime -- retry-input-text-recovery.test.ts response-memory-disclosure-terminal.test.ts`，覆盖 receipt、detail candidate、candidate promotion 三次内存状态更新，source assertion 证明没有 disclosure 专用 `saveCheckpoint`，并覆盖 result message 写入失败及 retry/edit/resubmit/successor 隔离。
  来源：response-memory-disclosure「disclosure 在 terminal commit 和 Web 投影一致」、design 决策 4。
- [ ] 3.5 把 `responseMemoryDisclosureDraft` 定义为 core/runtime 保留 flow variable；core 是唯一写入 owner，只维护当前 attempt 的 `referenced`、`pendingReferenced` 和 `created`，terminal assembly 时 runtime 只读校验并仅为具备披露资格的最终完成终态提交。runtime 不从 memory tool、Store、模型上下文、capability delta、checkpoint 或前序 attempt 推导当前 attempt 语义。`BEFORE_PLANNING` hook projection 必须剥离该键，hook merge 必须保留可信值并丢弃同名伪造，不增加通用 typed extension；不得增加累计 disclosure 预算或由 footer 大小触发的 memory tool 拒绝。
  验证：`npm test -w @nextagent/agent-core -- agent-routing-core-security.test.ts agent-routing-core.test.ts parallel-tool-loop.test.ts` 和 `npm test -w @nextagent/agent-runtime -- response-memory-disclosure-terminal.test.ts`，实际断言 core 唯一写入、runtime 只读、hook 无法观察/覆盖/删除 draft、checkpoint/replay guard 不消费 draft、多个单次合法 memory tool 调用不会被累计 disclosure 大小拒绝，且 fixed-code diagnostic 不含 memoryId/content。
  来源：response-memory-disclosure「记忆披露不改变模型上下文和 memory tool 可见结果」「累计披露大小不得改变记忆工具执行」、design 决策 4。

## 4. `agent-runtime` 原子提交终态事实

- [ ] 4.1 扩展既有 terminal assembly，从当前连续执行的合法 draft 生成最终 disclosure：先执行既有 terminal output guard 得到最终规范化 `terminalStatus`；只有最终 COMPLETED、执行未从 durable facts 重建且 referenced/created 非空时写入。所有通过既有 `reconstructRecoveryContext` 生成 context 的 recovery/resume 路径都必须设置 runtime 私有重建标记；fresh submit、retry、edit、resubmit 和 supersede successor 新建的 context 默认为未重建，且不得接受客户端或 flow variable 覆盖。FAILED、CANCELED、SUPERSEDED、空 draft、非法 draft 和重建执行均省略整个 `memoryDisclosure`。
  验证：新增 `packages/agent-runtime/tests/response-memory-disclosure-terminal.test.ts`，覆盖四种终态、空 draft、写入成功后失败/取消/被替代、`MODEL_FINAL_CONTENT_EMPTY`、`TERMINAL_MESSAGE_LIMIT_EXCEEDED`、durable recovery/pending resume 重建执行省略，以及 `terminalMessageId` 不变；恢复省略记录固定 `RESPONSE_MEMORY_DISCLOSURE_RECOVERY_OMITTED` 且不含 memoryId/content。
  来源：response-memory-disclosure「同步新增判定以已提交的 add_memory 写入为准」、design 决策 5。
- [ ] 4.2 在具备披露资格的完成终态现有 terminal composite write 中把同一个 disclosure 对象写入 assistant message metadata 和 terminal event inline payload；非法 draft 只丢弃披露并记录无内容 fixed-code diagnostic，不阻止终态提交。runtime 只用私有执行重建标记控制省略，不读取 checkpoint draft、memory Store 或 capability result 推导披露。
  验证：`npm test -w @nextagent/agent-runtime -- response-memory-disclosure-terminal.test.ts`，覆盖 message/event 深度相等、事务失败原子性、恢复执行完全省略、非法 payload negative case，以及 capability replay 结果不改变 runtime 省略判断。
  来源：response-memory-disclosure「disclosure 在 terminal commit 和 Web 投影一致」、design 决策 4、5。

## 5. Web channel 的 live 与 conversation 同源投影

- [ ] 5.1 在 `agent-channel-common` 和 `agent-channel-web` 只校验并投影 `REQUEST_COMPLETED` terminal event 的合法 `memoryDisclosure`；FAILED、CANCELED、SUPERSEDED 即使异常携带字段也必须省略，SSE 与 WebSocket 输出相同 public DTO；channel 不扫描 capability delta，也不调用 memory API。
  验证：`npm test -w @nextagent/agent-channel-web -- terminal-projection.test.ts tool-structured-delta-projection.test.ts`；增加 SSE/WebSocket 同形输出、三类非完成终态省略、非法 schema 隐藏和禁止从 capability result 推断的 negative cases。
  来源：response-memory-disclosure「disclosure 在 terminal commit 和 Web 投影一致」、design 决策 6。
- [ ] 5.2 扩展 conversation projection，只在同一持久化 assistant message 的受信 `metadata.eventType=REQUEST_COMPLETED` 且 `metadata.status=COMPLETED` 时，把合法 `memoryDisclosure` 映射为历史 terminal envelope；其他终态或字段缺失时省略，不查询 timeline 或新增 `terminalMessageId` 关联。
  验证：`npm test -w @nextagent/agent-channel-web -- conversation-preview-route.test.ts terminal-projection.test.ts`，覆盖完成终态合法、字段缺失、非法 metadata、三类非完成终态省略、无 timeline join，以及与 live DTO 深度相等。
  来源：response-memory-disclosure「disclosure 在 terminal commit 和 Web 投影一致」、design 决策 6。
- [ ] 5.3 在 `agent-channel-web` 的 conversation share 服务端投影中，从每条 shared message metadata 无条件剥离 `memoryDisclosure`，不修改 canonical message 或 owner conversation；不得把隔离责任留给分享页组件，也不新增 share Gateway/Record/DTO 字段。
  验证：`npm test -w @nextagent/agent-channel-web -- share-routes.test.ts conversation-preview-route.test.ts`，覆盖 COMPLETED 合法 disclosure 和三类非完成消息异常携带字段，断言 owner conversation 只投影完成终态 disclosure、shared response 始终不含该字段、其他 share-safe metadata 与正文保持不变。
  来源：conversation-share「会话分享不得公开长期记忆披露」、design 决策 6 和「安全」。

## 6. 浏览器回复底部展示

- [ ] 6.1 在 `frontend/agent-web` 增加唯一 disclosure runtime parser 和 turn projection，live/historical terminal envelope 走同一路径；字段缺失或 payload 非法时只隐藏记忆区域并记录无内容 fixed-code diagnostic。
  验证：在 `frontend/agent-web` 运行 `npm test -- tests/buildTurnBlocks.test.ts tests/streamValidation.test.ts tests/conversationStore.test.ts`，覆盖 live、history、field-absent、invalid、FAILED/CANCELED/SUPERSEDED 无 footer，以及 retry/edit/resubmit/successor 隔离；前端测试必须断言没有扫描或拼接前序 attempt。
  来源：response-memory-disclosure「disclosure 在 terminal commit 和 Web 投影一致」、design 决策 6。
- [ ] 6.2 实现共享 `MemoryDisclosureFooter` 并接入 assistant reply 底部，只显示非空“引用了 N 条记忆”“新增了 N 条记忆”分组；按 category 固定中文字段标签展开全部非空值和数组元素，不显示 memoryId 或原始 JSON，也不增加正文标记、顶部过程、来源、版本、标题、链接、操作或“暂不可用”。
  验证：在 `frontend/agent-web` 运行 `npm test -- tests/TurnBlock.test.tsx tests/TurnBlock.failed.test.tsx tests/TurnBlock.canceled.test.tsx`，覆盖四类 content、0/1/多条、双组、单组、FAILED/CANCELED/SUPERSEDED 不展示和全量展开。
  来源：response-memory-disclosure「完成回复披露实际引用和同步新增的长期记忆」、design 决策 6。
- [ ] 6.3 验证 local、immersive、collaborative 三种宿主复用同一 chat workspace、parser 和 footer，不形成宿主专属记忆语义。
  验证：在 `frontend/agent-web` 运行 `npm run build`、`npm run build:vite:modes` 和现有多宿主 component/route tests；dependency review 检查没有 host-specific disclosure branch。
  来源：AGENTS 架构边界、proposal「影响范围」、design「可维护性」。
- [ ] 6.4 增加浏览器用户旅程，验证 owner live 完成后立即显示披露、刷新后 owner conversation 内容一致、FAILED/CANCELED/SUPERSEDED 不显示 footer、异步学习完成不会修改已提交 footer，并验证同一完成回复进入 conversation share 后不显示或接收记忆披露。
  验证：在 `frontend/agent-web` 运行对应新增 Playwright spec；测试断言条目内容和计数在 owner live/refresh 后完全一致，三类非完成终态均无记忆区域，shared conversation response/页面均不包含披露数据。
  来源：response-memory-disclosure「disclosure 在 terminal commit 和 Web 投影一致」、conversation-share「会话分享不得公开长期记忆披露」、design「可靠性和恢复」「审计和可追溯性」。

## 7. 架构和完整验证

- [ ] 7.1 增加 architecture negative tests，阻止 `agent-memory` 依赖 core/runtime/session、channel 依赖 memory Gateway、frontend 调用 memory API、非 memory capability 使用 `memoryWriteReceipt`，并确认没有新 Gateway/表/配置、disclosure 专用 checkpoint、checkpoint contract 变化或通用 capability effect contract；服务端 share 投影测试固定披露隔离，但不把业务字段过滤误建模为新的跨包 architecture contract。
  验证：`npm run lint:architecture`；每项 forbidden path 必须由测试实际触发并断言失败。
  来源：proposal「影响范围」、design 决策 1、2、5、6 和「可维护性」。
- [ ] 7.2 运行 change 和全仓 OpenSpec strict validation，确认 proposal、design、spec、tasks、roadmap 状态和前置依赖一致。
  验证：`openspec validate add-ts-response-memory-disclosure --strict`；`openspec validate --all --strict`。
  来源：OpenSpec 治理和本 change 全部规格。
- [ ] 7.3 运行受影响后端完整门禁并修复本 change 引入的失败。
  验证：仓库根目录执行 `npm run build`、`npm test`、`npm run test:contract`、`npm run lint:architecture`，记录每条命令实际结果。
  来源：AGENTS 验证门禁、design「验证映射」。
- [ ] 7.4 运行受影响前端完整门禁并修复本 change 引入的失败。
  验证：`frontend/agent-web` 执行 `npm run build`、相关 `npm test -- ...`、`npm run build:vite:modes` 和新增 Playwright 旅程，记录每条命令实际结果。
  来源：AGENTS 验证门禁、design「验证映射」。
- [ ] 7.5 使用 `$nextagent-code-review` 检视 Frozen core contract（包括 checkpoint contract 不变）、Architecture boundary、Minimal kernel、Security、OpenSpec consistency、Clean Code、backend/frontend 验证证据；P0/P1 修复后复检。
  验证：模型语义 review 最终结论必须为 PASS 或无 P0/P1 的 PASS WITH FOLLOW-UP，并记录 P2 follow-up。
  来源：AGENTS Push 门禁、design「安全」「可维护性」。

## 归档前更新基线检查（非实施任务）

实现和完整验证通过后，归档前按 proposal/design 的 Baseline Promotion Plan 提炼 stable `response-memory-disclosure`、`memory-tools`、overview、architecture、module 和 spec-to-design-map 文档；不新增 ADR。归档流程需要确认长期文档没有重复定义 disclosure 数据结构、引用状态转换、terminal commit 或 channel DTO 语义，也没有把 disclosure 提升为 checkpoint recovery fact。
