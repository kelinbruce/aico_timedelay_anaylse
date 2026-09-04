## 1. 先建立目标行为回归

- [x] 1.1 `tests/agent-kernel/session-lane-scheduling.test.ts`：新增 canonical `AskUserQuestion` answer 的 durable-first characterization，断言 message append、live-only `CAPABILITY_RESULT_DELTA` 和 resumed model output 的顺序，并断言没有 `CAPABILITY_STARTED`/`CAPABILITY_COMPLETED`
  来源：Requirement `Accepted AskUserQuestion answer publishes a durable-first visible result`；Scenario `Accepted question answer is visible before resumed model output`
  验证：先运行 `npx vitest run tests/agent-kernel/session-lane-scheduling.test.ts --config vitest.config.release.ts -t "publishes the accepted AskUserQuestion answer result after the durable message"`，确认生产改动前仅新增断言失败；完成 2.1 后同一命令必须通过

- [x] 1.2 `tests/agent-kernel/session-lane-scheduling.test.ts`：新增 answer replay、durable message failure、无 stream subscriber、timeout 和 cancel 的 negative characterization，分别断言不重复 result、不先发布 live result、不阻塞 durable continuation 和不合成回答；使用唯一 answer fixture 捕获 logger/observability 输出，断言回答正文不进入 log、trace、metric 或 audit payload
  来源：Requirement `Accepted AskUserQuestion answer publishes a durable-first visible result`；Scenario `Durable result write failure does not publish an answer result`、`Replayed answer command does not duplicate the result`、`Missing live delivery preserves durable recovery`、`Timeout and cancellation do not synthesize an answer result`；design 质量属性“安全”
  验证：先运行 `npx vitest run tests/agent-kernel/session-lane-scheduling.test.ts --config vitest.config.release.ts -t "AskUserQuestion answer result"`，确认生产改动前新增 normal/negative 目标断言失败且既有 pending tests 仍通过；完成 2.1 后全部通过，捕获的所有 observability 序列化结果均不包含唯一 answer fixture

- [x] 1.3 `tests/agent-kernel/run-status-visibility.test.ts` 与 channel conversation projection tests：新增同一 runtime-accepted answer fact 的 stream payload/conversation `pendingInputAnswer` projector-output deep-equality、order、3-group、9-item、4096-code-point、24576-total-budget 和 Unicode boundary tests
  来源：Requirement `AskUserQuestion answer result exposes only a bounded safe projection`；Scenario `Valid accepted answers keep order in the safe result`、`Stream and conversation use the same safe projection`、`Over-budget accepted answer is deterministically truncated`
  验证：先运行 `npx vitest run tests/agent-kernel/run-status-visibility.test.ts packages/agent-channel-web/tests/conversation-route.test.ts --config vitest.config.release.ts -t "projects bounded AskUserQuestion answers"`，确认生产改动前新增断言失败；完成 3.1 后同一命令必须通过且两条 Web projection deep equal

- [x] 1.4 `tests/agent-kernel/run-status-visibility.test.ts`、`packages/agent-channel-web/tests/pending-input-projection.test.ts` 与 conversation projection tests：新增 malformed identity/shape、非 `QUESTION`、越界字段透传和 `USER_INPUT_RECEIVED` answer injection 的 fail-closed tests
  来源：Requirement `AskUserQuestion answer result exposes only a bounded safe projection`；Scenario `Malformed or non-question result fails closed`、`USER_INPUT_RECEIVED remains answer-free`
  验证：先运行 `npx vitest run tests/agent-kernel/run-status-visibility.test.ts packages/agent-channel-web/tests/pending-input-projection.test.ts packages/agent-channel-web/tests/conversation-route.test.ts --config vitest.config.release.ts -t "AskUserQuestion|USER_INPUT_RECEIVED"`，确认新增违规输入断言在生产改动前失败；完成 3.1 后断言两条 Web projection 都只输出安全摘要且不出现回答正文

- [x] 1.5 `frontend/agent-web/tests/conversationAdapter.test.ts` 与 `processDetailsProjection.test.ts`：使用 conversation item `pendingInputAnswer` 新增 live/history 同形映射、raw message content 不读取、同一 `pendingInputId` 单条目计数、等待到回答的标题更新、自由输入/单选/多选/custom/多问题配对、option label、截断提示、orphan result、received-only fallback、duplicate consumption 和跨 attempt/pending input 隔离 tests，并断言不出现独立“已响应”entry
  来源：Requirement `AskUserQuestion process projection keeps one supplemental-information entry`；Scenario `Live answer enriches the existing interaction`、`Supported question shapes use one paired display`、`Truncated answer is visibly disclosed`、`Durable history reconstructs the same answer result`、`Durable answer without a matching question remains visible`、`Received event without answer result remains generic`、`Correlation never crosses attempts or pending inputs`、`Duplicate live or history results are idempotent`
  验证：在 `frontend/agent-web` 先运行 `npm test -- tests/conversationAdapter.test.ts tests/processDetailsProjection.test.ts`，确认生产改动前只有新增 AskUserQuestion 目标断言失败；完成 4.1、4.2 后全部通过

- [x] 1.6 `frontend/agent-web/tests/conversationStore.process-history.test.ts` 与 `TurnBlock.process-history.test.tsx`：新增 active→settled、matching history merge、第二次 submit 完成和展开详情保持的单条目 interaction lifecycle tests
  来源：Requirement `AskUserQuestion process projection keeps one supplemental-information entry`；Scenario `Terminal settlement preserves the complete interaction`、`Durable history reconstructs the same answer result`
  验证：在 `frontend/agent-web` 先运行 `npm test -- tests/conversationStore.process-history.test.ts tests/TurnBlock.process-history.test.tsx`，确认生产改动前新增补充信息完整性或去重断言失败；完成 4.2 后断言前一次 settled 补充信息仍为一个完整条目，且无独立 response 或通用 tool row

- [x] 1.7 `frontend/agent-web/tests/e2e/session-history-streaming.spec.cjs`：新增真实页面上的“等待补充信息”到“用户补充信息”原条目更新、回答实时显示、terminal 后展开、后续 submit、刷新/history recovery、live result 缺失和长回答截断提示旅程，并记录顶层用户消息、conversation/stream 请求数
  来源：Requirement `AskUserQuestion process projection keeps one supplemental-information entry`；Scenario `Live answer enriches the existing interaction`、`Truncated answer is visibly disclosed`、`Terminal settlement preserves the complete interaction`、`Live-only delivery loss recovers from conversation without cursor invention`
  验证：在 `frontend/agent-web` 先运行 `npm run test:e2e`，确认生产改动前新增旅程准确暴露回答缺失、独立“已响应”entry 或重复 tool row；完成 4.2 后同一 pending input 始终只有一个 process entry，顶层用户消息数量不增加，页面不冻结、不丢回答、不创建额外 run，且每次预期 reconnect 之外没有 conversation/stream 请求循环

## 2. Runtime durable-first publication

- [x] 2.1 `packages/agent-runtime/src/lifecycle/submit.ts`：在现有 pending capability result materialization 成功后，仅为 canonical `AskUserQuestion` `QUESTION/RECEIVED` 使用既有 run-state port 发布一次 live-only result，再继续原始 run
  来源：design `决策 1：Runtime 在同一个 materialization 边界完成 durable write 和 live publication`
  验证：运行 `npx vitest run tests/agent-kernel/session-lane-scheduling.test.ts --config vitest.config.release.ts -t "AskUserQuestion answer result"`；预期 normal、failure、idempotency、无 subscriber、timeout/cancel 全部通过，并通过 code review 确认未新增 publisher、event type、timeline row 或 browser ack

## 3. Web answer safe projection

- [x] 3.1 在 `agent-channel-common` 增加 `projectAskUserQuestionAnswerResult(...)`，让 stream projection 与 `agent-channel-web` conversation route/response projection 共用；stream payload 合并该输出，现有 conversation capability-result item 通过可选 `pendingInputAnswer` 字段携带同一输出，并保持 `USER_INPUT_RECEIVED` answer-free
  来源：design `决策 2：建立 stream/conversation 共用的唯一 AskUserQuestion answer projector`
  验证：运行 `npx vitest run tests/agent-kernel/run-status-visibility.test.ts packages/agent-channel-web/tests/pending-input-projection.test.ts packages/agent-channel-web/tests/conversation-route.test.ts --config vitest.config.release.ts`；预期全部通过，stream/conversation deep equal，违规 identity/shape/field 不输出 answer，Unicode 与总预算裁剪结果确定

## 4. Frontend history reconstruction and single interaction projection

- [x] 4.1 `frontend/agent-web/src/state/contracts.ts`、`features/chat/utils/safeCapabilityResult.ts` 与 `conversationAdapter.ts`：为 conversation item 增加可选 `pendingInputAnswer` 输入，扩展 frontend-owned safe-result read union，把校验后的字段映射为 history envelope，并禁止从 raw message content 重建或裁剪 answer
  来源：design `决策 3：Conversation boundary 投影 durable result，frontend 只做形状映射`
  验证：在 `frontend/agent-web` 运行 `npm test -- tests/conversationAdapter.test.ts tests/processDetailsProjection.test.ts`；预期 live/history fixture 生成同形 safe result，raw message content 中的 answer injection 不被读取，malformed `pendingInputAnswer` 不泄露 answer

- [x] 4.2 `frontend/agent-web/src/features/chat/process/processDetails.ts` 与现有本地化资源：在单次 pure projection 中按同 attempt 的 `pendingInputId` 只生成一个补充信息 entry；等待时使用“等待补充信息”，收到状态或回答后原条目更新为“用户补充信息”；格式化一至三个问题及其回答、映射 option labels、保留多选顺序、显示 custom text 和截断提示、消费 matching result、生成 orphan/received-only fallback，并保持 duplicate/cross-attempt 隔离
  来源：design `决策 4：Process projection 以 pendingInputId 形成单个补充信息条目`、`决策 5：Recovery 使用 durable message，不改变 stream cursor`
  验证：在 `frontend/agent-web` 运行 `npm test -- tests/processDetailsProjection.test.ts tests/conversationStore.process-history.test.ts tests/TurnBlock.process-history.test.tsx`；预期 live、settled、history、后续 submit、全部问题形状、截断、orphan、duplicate 和跨 attempt 用例全部通过，同一 pending input 始终只有一个 process entry，且 `conversationStore` 无新增 pending join state

## 5. 端到端与质量门禁

- [x] 5.1 执行 AskUserQuestion 页面旅程和请求审计，验证实时、settled、第二次 submit、refresh/gap recovery 与长回答均只保留一个补充信息 process entry
  来源：design `验证策略（Verification Strategy）`
  验证：在 `frontend/agent-web` 运行 `npm run test:e2e`；预期 `session-history-streaming.spec.cjs` 全部通过，浏览器 console 无未处理错误，长回答期间页面可交互，网络记录不存在额外 request run 或 conversation/stream 请求循环

- [x] 5.2 执行 change、frontend 和 workspace 完整门禁，并完成 push 前模型语义 review
  来源：design `验证策略（Verification Strategy）`、`决策 6：边界与独立交付`
  验证：依次运行 `openspec validate project-ask-user-question-answer-result --strict`、`openspec validate --all --strict`；在 `frontend/agent-web` 运行 `npm run build`、`npm test -- tests/conversationAdapter.test.ts tests/processDetailsProjection.test.ts tests/conversationStore.process-history.test.ts tests/TurnBlock.process-history.test.tsx`、`npm run test:e2e`；在仓库根目录运行 `npm run build`、`npm test`、`npm run test:contract`、`npm run lint:architecture` 和 `git diff --check`。随后使用 `$nextagent-code-review` 检查 frozen core contract、owner boundaries、security、OpenSpec consistency、clean code 与浏览器证据；预期 review 为 PASS 或仅有明确 P2 follow-up，且确认没有 `agent-contracts`、event vocabulary、route、store、cursor 或 timeline persistence 变更

## 6. 修复 durable/live AskUserQuestion 关联坐标

- [x] 6.1 将 frontend AskUserQuestion interaction semantic key 从 `root + requestContextId + pendingInputId` 调整为 `root + runId + pendingInputId`，保留不同 run 与不同 pending input 的隔离
  来源：Requirement `AskUserQuestion process projection keeps one supplemental-information entry`；Scenario `Durable answer without request context joins the matching live interaction`
  验证：在 `frontend/agent-web` 运行 `npm test -- tests/processDetailsProjection.test.ts tests/conversationAdapter.test.ts tests/conversationStore.process-history.test.ts tests/TurnBlock.process-history.test.tsx`；真实 conversation fixture 不携带 `requestContextId/rootMessageId` 时同一 interaction 仍只有一个 entry，不同 `runId` 仍形成独立 entry

- [x] 6.2 修正 conversation、store 与 Playwright fixtures，使用后端真实 durable capability-result 坐标，不再人为补齐 live-only `requestContextId`
  来源：design `Frontend live、settled 与 history 投影`；Requirement `AskUserQuestion process projection keeps one supplemental-information entry`
  验证：同 6.1；生产修改前新增回归稳定失败为 3 个 entry，生产修改后 67 个相关 unit/component tests 全部通过，raw durable answer 未被读取；另以 `PLAYWRIGHT_BASE_URL=http://127.0.0.1:5173 npx playwright test tests/e2e/session-history-streaming.spec.cjs --config=playwright.config.cjs --grep "keeps one AskUserQuestion"` 验证真实页面的 live answer、settle、后续 submit 与 refresh 旅程，结果 1 passed

## 7. AskUserQuestion 问题数兜底与逐题回答

- [x] 7.1 `tests/agent-kernel/capability-governance.test.ts` 与 DefaultAgent integration tests：先锁定 model-facing descriptor 的 `questions.maxItems=3` 和明确“最多 3 题”描述，再建立 4 项、20 项、21 项问题数 characterization；断言 4/20 仅通过兼容分支创建一个 pending input，21 在 assistant tool-use 持久化前进入要求最多 3 题的 count correction，同批其他 tool 不执行，纠正成功后继续原 run，连续 3 次失败后 safe terminal，且非 count `INVALID_INPUT` 不进入该 recovery
  来源：Requirement `AskUserQuestion tool creates runtime-owned question pending input`；Scenario `Tool accepts bounded model count drift without changing the model contract`、`Over-limit question batch is corrected before persistence`、`Corrected question batch continues the original run`、`Repeated count overflow fails after the bounded correction budget`、`Non-count validation failures are not retried by count recovery`、`Tool descriptor exposes visible text and question-count budgets to the model`
  验证：先运行目标 tests，确认现有实现对 4 项直接失败且已写 assistant tool use；实现 8.1 后全部通过，并断言 model/provider schema 不暴露 20、4/20 的非 count 约束仍完整校验、rejected batch 无 message、其他 tool side effect、pending input 或 `USER_INPUT_REQUIRED`，只有非终态 count degradation，correction/log/safe error 不含问题正文、20 题兜底值和其他 raw tool arguments

- [x] 7.2 `packages/agent-channel-common` projector tests：把 accepted answer group boundary 从 3 扩到 20，覆盖 20 group 保序、21 group 截断、每组 item、单 string、Unicode 和 24576 总预算
  来源：Requirement `AskUserQuestion answer result exposes only a bounded safe projection`；Scenario `Over-budget accepted answer is deterministically truncated`
  验证：运行 `npx vitest run tests/agent-kernel/run-status-visibility.test.ts packages/agent-channel-web/tests/conversation-route.test.ts --config vitest.config.release.ts -t "AskUserQuestion"`；stream/conversation 输出 deep equal，20 group 不因 group 数截断，21 group 标记截断

- [x] 7.3 `frontend/agent-web` QuestionInput component tests：先建立单问题、4 问题、20 问题的单题渲染、进度、逐题有效性、前后导航、焦点迁移、草稿修改、最终一次提交、submit failure 保留和 pending id reset tests
  来源：Requirement `Multi-question pending input uses one-question-at-a-time navigation`
  验证：生产改动前 4/20 问题 fixture 因一次渲染全部问题而失败；完成 9.1 后全部通过，并断言翻页不调用 `onSubmit`

- [x] 7.4 `frontend/agent-web/tests/e2e/session-history-streaming.spec.cjs`：增加真实 4 问题页面旅程与请求审计，覆盖逐题填写、返回修改、最终一次 answer request、完成后的单条目展示、刷新/history recovery；追加 20 问题可达性和无冻结检查
  来源：Requirement `Multi-question pending input uses one-question-at-a-time navigation`；Requirement `AskUserQuestion process projection keeps one supplemental-information entry`
  验证：在 `frontend/agent-web` 运行目标 Playwright spec；answer request 仅 1 次，翻页期间 conversation/stream/request 计数不变，完成后全部问题—回答仍在同一个 process entry

## 8. Agent/core count boundary and bounded correction

- [x] 8.1 保持 canonical AskUserQuestion descriptor 的 `questions.maxItems=3` 和 model-facing “最多 3 题”描述；在 `executeToolCallsInOrder(...)` 内于 `appendAssistantToolUseMessage(...)` 前增加 count preflight，并让 producer 对 4–20 题使用只放宽 `questions.maxItems` 的 request-local descriptor validation view；超过 20 题时，`DefaultAgent` 使用独立 counter 复用既有 request-local correction 和 3 次 recovery budget，要求模型收敛到最多 3 题
  来源：design `决策 7：模型仍限制 3 题，系统以 20 题作为兼容兜底`
  验证：运行 7.1 tests，并通过 code review 确认 model-facing descriptor 未放宽、compatibility view 不写回 catalog/context/provider、除顶层 count 外没有复制或放宽 schema、未新增 agent-contracts/registry/state machine、未静默截断或持久化不配对 tool use

## 9. Web projection and one-question frontend

- [x] 9.1 把共用 AskUserQuestion answer projector 与 frontend `safeCapabilityResult` read guard 的 group boundary 调整为 20；在现有 `QuestionInput` 增加 current index、进度和上一步/下一步，复用既有 `answers[][]` 与最终 answer submit
  来源：design `决策 2：建立 stream/conversation 共用的唯一 AskUserQuestion answer projector`、`决策 8：多问题使用前端逐题视图，最终仍原子提交`
  验证：运行 7.2、7.3 tests；确认 local/immersive/collaborative 共用组件，无新 route/store/subscription，单问题行为不回归

## 10. 扩展范围的最终验证

- [x] 10.1 执行 model-facing 3 题 contract、4/20/21 问题 fallback characterization、answer projector、frontend component、真实页面旅程和请求审计
  来源：design `验证策略（Verification Strategy）`
  验证：7.1–7.4 的命令全部通过；浏览器 console 无未处理错误，20 问题流程可操作，翻页无额外网络请求或页面冻结

- [x] 10.2 重新执行 change、frontend 与 workspace 门禁，并完成 push 前 `$nextagent-code-review`
  来源：design `决策 6：边界与独立交付`、`决策 7`、`决策 8`
  验证：运行 `openspec validate project-ask-user-question-answer-result --strict`、`openspec validate --all --strict`；frontend targeted tests、`npm run build`、目标 Playwright；root `npm run build`、`npm test`、`npm run test:contract`、`npm run lint:architecture`、`git diff --check`。review 必须覆盖 model-facing 3 题契约与内部 20 题兜底的隔离、tool-use/result pairing、count recovery 有界性、三宿主一致性、安全投影容量和无 contract/route/store 扩张

## 归档前更新基线检查（非实施任务）

实现和验证完成后，归档流程按照 proposal 的“归档前更新基线”归并 stable specs、`stream-projection` 和 proposal 列出的 module design，并更新 `spec-to-design-map`。长期文档不得重复定义 `pendingInputAnswer` schema、pending lifecycle owner、count correction owner 或 live/history recovery owner。
