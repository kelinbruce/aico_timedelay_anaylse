## 1. 基线与失败优先测试

- [x] 1.1 为 frontend event page contract 和 `sessionService.loadRunEvents` 写失败测试，覆盖 URI 编码、`afterSequence`、固定 `limit=1000`、AbortSignal、AVAILABLE 与 LEGACY response，以及非法 availability/cursor/envelope 的runtime validation，不修改 `agent-contracts` 或 backend schema。
  验证：在 `frontend/agent-web` 运行 `npm test -- --run tests/sessionService.test.ts`，实现前因 method/type 缺失而失败，实现后通过；`git diff -- packages/agent-contracts packages/agent-channel-web` 为空。
  来源：`Browser history hydrates process events by visible turn run`、design 决策3、proposal backend non-goal。
- [x] 1.2 为现有live `metadata.completed=true` thinking projection和completed history envelope兼容补characterization test，锁定同一entry settle、非thinking边界、final answer message-only和现有panel 150ms terminal collapse行为。
  验证：在 `frontend/agent-web` 运行 `npm test -- --run tests/processDetailsProjection.test.ts tests/TurnBlock.test.tsx`；新增断言在生产改动前通过或准确暴露缺口。
  来源：`Completed live and cold-history panels have the same inspectable detail`、design 背景、父 change projection contract。

## 2. Run process history transport 与纯逻辑

- [x] 2.1 在 frontend contracts 和 `sessionService` 实现单页 run event query及exact page parser，复用live入口的`normalizeStreamEnvelope()`校验每个event并产出相同browser shape，透传 AbortSignal，不复制 backend projector 或 raw timeline 字段。
  验证：`npm test -- --run tests/sessionService.test.ts`，断言额外 client 字段不会被发送、合法`events` response补齐与live一致的root correlation，非法availability/cursor/envelope、误用`items`、未知字段和带events/cursor的LEGACY response被拒绝；`npm run build`通过。
  来源：design 决策3、质量属性“安全”、proposal Public API 边界。
- [x] 2.2 新增 `features/chat/history/processHistory.ts` 和失败优先单元测试，实现 visible root 分组、assistant 优先 display run 选择、failed-turn fallback、distinct run 去重和 retry attempt 隔离。
  验证：`npm test -- --run tests/processHistory.test.ts`，覆盖 assistant retry 覆盖旧 run、无 assistant 失败 turn、SUMMARY 排除、空/非法 runId 和多个 root。
  来源：`Browser history hydrates process events by visible turn run`、design 决策2。
- [x] 2.3 在同一 history helper 实现完整 run 分页、严格递增 cursor、eventId 去重、canonical 排序和 AbortSignal 传播；重复或倒退 cursor 必须实际触发 FAILED 路径。
  验证：`npm test -- --run tests/processHistory.test.ts`，使用多页、duplicate eventId、repeated cursor、decreasing cursor、跨session/run coordinate和abort fixture断言结果。
  来源：`Event history pagination is complete and bounded`、design 决策3、negative verification 要求。
- [x] 2.4 实现 session-local 最多4个并发 run load 的固定队列，并用可控 promise 验证第5个请求在 slot 释放前不会启动、abort 后队列停止提交。
  验证：`npm test -- --run tests/processHistory.test.ts tests/conversationStore.process-history.test.ts`，断言单批次及older/newer重叠批次共享session级slot、observed peak concurrency不超过4，第5个请求仅在slot释放后启动且剩余任务最终执行。
  来源：`Event history pagination is complete and bounded`、design 决策3、质量属性“性能/容量”。

## 3. Conversation store hydration 与一致性

- [x] 3.1 扩展 conversation store 的 per-session/per-run discriminated state、selected run set 和 retry action；message page 提交并进入 ready 后异步启动 process hydration，event failure 不得改变 message load 成功，FAILED只保存固定safe errorCode。
  验证：`npm test -- --run tests/conversationStore.process-history.test.ts tests/conversationStore.test.ts`，断言 message 先可见、LOADING/AVAILABLE-empty/AVAILABLE-loaded/FAILED/LEGACY 状态互斥且 FAILED 可 retry、LEGACY 不请求 source、raw HTTP/parser error未进入state。
  来源：`Message history remains usable when process history is unavailable`、design 决策1/4。
- [x] 3.2 实现 authoritative replace、anchored、older、newer、clear 和 session switch 的 load-version/AbortSignal 隔离及 cache 复用；迟到响应、已取消响应和不再 selected 的 run 必须实际被拒绝提交。
  验证：`npm test -- --run tests/conversationStore.process-history.test.ts`，用 deferred promises 覆盖 A→B session 切换、older/newer 新增 run、anchor 替换 window、重复 load 去重、late success 和 clear 后 late response。
  来源：`History hydration is isolated by session and load version`、design 决策4、negative verification 要求。
- [x] 3.3 把当前 selected AVAILABLE run envelopes 以 `history-load` hint 合入唯一 history layer，保留 canonical eventId/sequence/run/request/root correlation，并通过现有 `buildSessionProjection`/`buildProcessEntries` 重建；capability event lifecycle与匹配`CAPABILITY_RESULT` message按run/tool correlation合并，不得生成 synthetic process event。
  验证：`npm test -- --run tests/conversationStore.process-history.test.ts tests/buildSessionProjection.test.ts tests/processDetailsProjection.test.ts`，比较同fixture的completed live和cold-history thinking/capability entries及answer source，断言无重复eventId、无跨attempt entry、tool result不重复；缺少result message时只显示safe unavailable且不把terminal status作为正文。
  来源：`Browser history hydrates process events by visible turn run`、design 决策4/5、质量属性“审计/可追溯性”。
- [x] 3.4 覆盖message API不返回`requestContextId`而event history返回canonical context的真实数据形态；同一explicit `runId`必须保留message answer和event process，不同run仍隔离。
  验证：`npm test -- --run tests/buildSessionProjection.test.ts tests/buildTurnBlocks.test.ts`，新增fixture在修复前稳定丢失completed thinking，修复后answer与thinking同处selected run且retry run隔离测试保持通过。
  来源：`Message history omits canonical request context`、design 决策4、用户cold history回归。

## 4. Process history 状态呈现

- [x] 4.1 将 `displayRunId` 和对应 process history view state 沿 shared projection/MessageList props 传入 TurnBlock/ProcessPanel；LOADING、FAILED retry、LEGACY_UNAVAILABLE 和 AVAILABLE empty 使用安全、可区分文案，状态不得伪造成 StreamEnvelope。
  验证：`npm test -- --run tests/TurnBlock.process-history.test.tsx tests/TurnBlock.test.tsx`，覆盖无 entry loading、retry callback、legacy 无 retry、available empty 无错误和 raw error 不渲染。
  来源：`Message history remains usable when process history is unavailable`、design 决策5、质量属性“安全”。
- [x] 4.2 增加中英文 process history 状态文案并验证长文案在窄 panel 中可换行、retry button 可键盘聚焦且具备 accessible name。
  验证：`npm test -- --run tests/TurnBlock.process-history.test.tsx` 和 `npm run build`；component test 分别切换 `zh-CN`/`en-US` 并通过 role 查询 retry control。
  来源：proposal 三宿主用户体验、design 决策5、agent-web 可访问性基线。

## 5. Entry disclosure 状态机

- [x] 5.1 先写 `useProcessEntryDisclosure` 失败测试，再实现 running new-entry expand、`isFinal` 转换后800ms collapse、parallel independent timers、manual override、root reset、cleanup 和 reduced-motion immediate state。
  验证：`npm test -- --run tests/useProcessEntryDisclosure.test.tsx`，使用 fake timers 和 matchMedia stub 覆盖800ms前后、两并行 entry、manual timer cancel、unmount 无 late update 及 reduced motion。
  来源：`Active process entries follow execution lifecycle`、`Manual entry expansion overrides automation for the current run`、`Reduced motion preserves state without transition motion`、design 决策6/7。
- [x] 5.2 将 hook 接入 `ProcessPanel`，保留 panel-level 150ms/anchor compensation；completed/history panel 用户展开时展开全部且不重新 auto-collapse，normal motion 使用200ms、reduced motion 使用0ms inline transition。
  验证：`npm test -- --run tests/useProcessEntryDisclosure.test.tsx tests/TurnBlock.process-history.test.tsx tests/TurnBlock.test.tsx`，105个测试通过，覆盖 live thinking 完整文本、800ms settle、parallel tool/thinking、terminal panel、manual reopen、history reopen、viewport anchor 和 reduced-motion 0ms styles。
  来源：`Completed live and cold-history panels have the same inspectable detail`、design 决策6/7。
- [x] 5.3 清理本次提取后 ProcessPanel 中重复的 entry timer/frame/set 逻辑和未使用 state，不重构 icon、markdown、expand-panel 或 timeline action 等无关呈现。
  验证：`npm run build`和上述105个定向测试通过；`rg`确认旧entry timer/frame/set引用已清零，且每个删除项均由新hook取代，无额外UI重构。
  来源：proposal 外科手术式范围、design 风险“ProcessPanel复杂度”、实现质量门禁。
- [x] 5.4 为累计thinking delta期间的panel measurement稳定性写失败优先component test，并让同一panel content挂载周期只创建一个`ResizeObserver`；entry正文增长、800ms entry collapse、150ms terminal panel collapse和manual reopen语义保持不变。
  验证：`npm test -- --run tests/TurnBlock.process-history.test.tsx`在实现前准确失败，报告同一累计entry更新期间observer创建4次；最小修复后9/9通过并断言只创建1次、detail保持展开且显示最新累计文本。`npm test -- --run tests/useProcessEntryDisclosure.test.tsx tests/TurnBlock.process-history.test.tsx tests/TurnBlock.test.tsx`为107/107通过，entry/panel时序无回归。
  来源：`Accumulated thinking updates preserve one layout lifecycle`、design决策6、用户窄视口流式卡顿闪烁回归。
- [x] 5.5 同步父change的真实producer顺序，覆盖`partial thinking -> answer delta -> completed thinking`，确保同一entry完成、只触发一次disclosure终态转换且不出现重复thinking卡片。
  验证：`npm test -- --run tests/processDetailsProjection.test.ts tests/TurnBlock.process-history.test.tsx tests/useProcessEntryDisclosure.test.tsx`，projection只产生一个稳定key的final thinking entry，entry disclosure无反复展开折叠。
  来源：`Thinking streams and then settles`、父change completed thinking projection contract、用户live闪烁回归。
- [x] 5.6 覆盖live thinking超过500个envelope后触发frontend容量压缩的真实输入；连续thinking段使用root、attempt和段序号组成稳定view key，不因compacted `eventId`持续变化而重挂载详情或重启entry展开动画。
  验证：`npm test -- --run tests/TurnBlock.process-history.test.tsx`在修复前10项中仅新增用例失败，直接报告501→502个delta时详情DOM节点被替换；最小修复后10/10通过。`npm test -- --run tests/TurnBlock.process-history.test.tsx tests/processDetailsProjection.test.ts`为47/47通过，连续段稳定、不同thinking段仍使用不同key。
  来源：`Accumulated thinking updates preserve one layout lifecycle`、design决策6、用户live thinking持续闪烁回归。

## 6. 三宿主一致性

- [x] 6.1 增加 architecture/source negative test，禁止 local、immersive、collaborative 入口或 PIU adapter 直接调用 run event URI、保存 process cache 或实现 entry collapse timer。
  验证：在 `frontend/agent-web` 运行 `npm test -- --run tests/process-history-host-ownership.test.ts`，4个测试通过；三个内联forbidden fixture分别实际触发run event URI、process cache与entry timer守卫，全部正常宿主源码通过，`npm run build`通过。
  来源：`Process history behavior is identical across all host modes`、design 决策8、negative verification 要求。
- [x] 6.2 扩展 Playwright fixture 和 journey，在 local、immersive、collaborative 分别验证 cold history thinking、live entry folding、terminal panel collapse 及 manual reopen 内容一致。
  验证：使用本机Chrome执行`PLAYWRIGHT_SMOKE_PORT=5190 PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" npm run test:e2e:smoke`，4/4通过；三种mode均验证cold history默认折叠、live active展开、800ms entry折叠、150ms terminal panel折叠和manual reopen原文，并断言每个host只发起一次display-run event request。
  来源：`Process history behavior is identical across all host modes`、proposal 三宿主范围、design 决策8。

## 7. 验证和收尾

- [x] 7.1 运行完整 frontend unit/component suite、TypeScript build 和三 mode Vite build，记录精确通过数量；任何 change-caused failure 必须修复。
  验证：在`frontend/agent-web`运行`npm test -- --reporter=dot`，1255/1261 tests通过，其余6项为已登记仓库基线且无change-caused failure；`npm run build`和`npm run build:vite:modes`通过。
  来源：proposal 测试影响、design 验证映射、AGENTS.md frontend gate。
- [x] 7.2 运行父能力与边界 non-regression，证明 frontend change 没有修改 backend contracts、event persistence、fork、context、share 或 prefix cache。
  验证：父thinking/runtime focused suite为69/69通过；`npm run test:contract`为315/315通过；release focused suite为63/65通过，其余2项为已登记父路径基线；`npm run lint:architecture`的dependency与manifest gate通过，architecture suite为224/225通过，其余1项为已登记仓库基线；`git diff -- packages/agent-contracts packages/agent-runtime packages/agent-channel-web packages/agent-context-engine packages/agent-model`为空。
  来源：proposal 非目标、design 验证映射“不修改backend contract/context/share/prefix cache”。
- [x] 7.3 对齐 proposal/design/specs/tasks 与最终实现，删除 placeholder、debug log、unused helper、重复 state 和 test-only production path；严格验证全部 OpenSpec。
  验证：本change没有 placeholder、debug log、unused helper、重复 state 或 test-only production path；OpenSpec strict validation 和 `git diff --check` 通过。
  来源：OpenSpec 一致性、实现质量门禁、design 唯一实现路径。
- [x] 7.4 验证 frontend ownership、三宿主一致性、安全、clean code、OpenSpec consistency 和测试证据。
  验证：需求、唯一实现路径、frontend owner、三个spec与tasks可追踪性均满足验收；无未解决P0/P1或`agent-contracts`确认项。
  来源：AGENTS.md push 门禁、proposal/design 评审要求。
- [x] 7.5 验证部署兼容边界：backend run event endpoint 先于或与 frontend 同时上线，无schema/data migration，升级前fork保持明确legacy unavailable语义。
  验证：frontend 不在缺少event endpoint的环境单独启用history hydration；frontend回滚不删除已持久化events，也不影响message history、live process或model context。
  来源：proposal API依赖、design 迁移计划。

## 长期基线同步结果

本change的稳定事实按 proposal/design 的 Baseline Promotion Plan 同步到长期基线：

- 合并 `ts-stream-history-consistency`、`agent-web-process-panel` 和 `agent-web-multi-host-modes` 行为 delta。
- 更新 `openspec/overview.md` 中的 message/event 完整历史背景。
- 更新 `openspec/designs/architecture/conversation-ui-state.md` 的 window-driven hydration 与失败状态流程。
- 更新 `openspec/designs/modules/agent-web.md` 的 service/store/projection/ProcessPanel owner 边界。
- 不新增 ADR。
- 更新 `openspec/designs/spec-to-design-map.md` 导航和验证入口。
- 检查长期文档没有重复定义 API schema、event 语义、store state 或 entry disclosure 状态机。
