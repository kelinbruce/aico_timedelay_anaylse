## 当前实现基线（Current Baseline）

agent-web 有两个依次执行的单 turn 纯投影组合点：

1. `buildSessionProjection()` 先通过 `overlaySettledTurnBlocks()` 组合 message history 与 settled process，再通过 `overlayLiveTurnBlocks()` 叠加仍保留的 live process。
2. `composeTurnProcessHistory()` 再组合 turn 的 base envelopes 与 selected run event envelopes。

两个组合点原本都只按 `eventId` 去重。调用方已提供或 envelope 已携带 `sessionId`、`rootMessageId` 和 `runId`。

1. 先按 `eventId` 收集 base envelopes。
2. 对 event envelopes 校验 session、run 和 root correlation，排除 answer facts。
3. 仅当 `eventId` 尚不存在时，把 event envelope 加入结果并标记 `history-load`。
4. 按 canonical sequence 和 `eventId` 排序。

`frontend/agent-web/tests/processHistory.test.ts` 已覆盖坐标隔离、answer fact 排除、`eventId` 去重、run event 分页及 run target 选择。当前没有覆盖 live/history 两个不同 `eventId` 表示同一 thinking step 的交接。

process-history hydration 还有两类 target 来源：

1. `useConversationTurnVisibility()` 从带 `data-process-run-id` 的可见或预加载 turn 生成 automatic targets。
2. 预览跳转和过程面板展开生成 explicit targets。

两类 target 当前只要求 `sessionId/rootMessageId/runId`，没有携带或校验 run 是否 terminal。`turnIdentityKey` 也只包含 root 与 run，因此 active→terminal 时如果 identity 不变，visibility observer 不一定因 eligibility 变化重新发布。与此同时，`ts-stream-resume-replay` 已要求 active run 通过 exact-run scoped replay 恢复可恢复流内容，event-history API 不需要成为 active run 的平行恢复 owner。

现有 `StreamEnvelope` 已把 `LLM_THINKING_DELTA` 的 `payload` 暴露给前端投影；完成态由 `payload.metadata.completed === true` 表示，稳定 step 身份由非空 `payload.stepId` 表示。本 change 不改变这些字段的 schema 或 owner。

已知 gap 有两部分：

1. `eventId` 表示 envelope 事实身份，不表示 thinking step 业务身份。同一 step 的多条 live 累计 snapshot，以及 live 与 settled/event-history 完成态，可以拥有不同 `eventId`。只修正第二个组合点无法处理 pure-live 累计副本或“settled 已完成、live 仍保留”的未刷新页面。
2. active run 仍可能被 automatic 或 explicit target 选中，导致 live stream 与 event-history API 同时为当前 run 提供过程事实，扩大交接竞态和请求数量。

## 目标设计（Proposed Design）

目标使用两道同 owner 防线，不增加新的 persistence、public contract 或 component-level 去重状态。

### 防线一：active run 不进入 event-history hydration

1. turn 的 process-history eligibility 由现有 `TurnBlock.status` 派生；只有 `COMPLETED`、`FAILED`、`CANCELED` 或 `SUPERSEDED` run 可以暴露 automatic/explicit history target。
2. `MessageList`/visibility adapter 只为 eligible turn 暴露 history target 坐标；active→terminal eligibility 必须进入观察 identity，使状态切换即使 root/run 不变也会重新建立观察并发布 target。
3. 过程面板展开入口对 active run fail closed，不创建 explicit target；run 终态后再次展开或保持可见时可按既有规则加载。
4. active run 的刷新和重连继续使用既有 exact-run scoped replay；本 change 不新增 fallback REST 查询、不改变 replay cursor 或 accepted-run recovery。
5. scheduler 的 16 automatic/16 explicit 上限、优先级、并发 4、started-load pinning、cache、取消、重试和分页保持不变。

### 防线二：同一步只投影 canonical snapshot

agent-web 在两个既有纯投影组合点复用同一稳定身份 helper：

1. 从属于当前 session、run 和 root 的 envelopes 中识别累计 `LLM_THINKING_DELTA` 和其中 `completed=true` 的完成态。
2. 仅当 `stepId` 是 trim 后非空字符串时，构造稳定身份：

   ```text
   sessionId + NUL + runId + NUL + rootMessageId + NUL + normalizedStepId
   ```

   session、run 和 root 仍由函数参数及现有 root correlation 规则确定，客户端文本不能覆盖这些坐标。
3. pure-live 输入中，同一稳定身份的累计 snapshots 按既有 canonical chronological order 以最后一条为当前 snapshot；不比较长度或文本前缀。
4. turn overlay 按既有输入优先级组合 settled block 与 live envelopes。某稳定身份已经存在完成态时，保留先进入 settled block 的完成态，并移除随后叠加的同 step live partial/completed copies。
5. process-history composition 把 event history 中每个完成态稳定身份记录为 canonical thinking set；base thinking 的身份出现在该 set 时，无论它是 partial、completed 或与 event 使用相同/不同 `eventId`，都不进入最终结果。对应 event envelope 继续添加既有 `history-load` transport hint。
6. 非 thinking envelopes、不同 stable step，以及缺少稳定 step 身份的 envelopes 继续执行既有 `eventId` 去重规则。
7. 最终结果继续按 sequence 和 `eventId` 排序。

该路径保留以下现有边界：

- turn overlay 与 `composeTurnProcessHistory()` 仍是无副作用纯函数；conversation store、run cache 和 React component 不持有第二套 step 去重状态。
- final answer 继续来自 message-derived base layer；event answer facts继续被排除。
- session、run 和 root correlation 继续先于 step 身份判断，稳定身份不能跨 turn。
- 缺少 `stepId` 时不生成 fallback identity；系统不读取或比较 thinking 文本。
- capability result、工具卡片、event pagination、scheduler 执行机制和 UI disclosure lifecycle 不发生改变；仅 target eligibility 收紧。

### 组合优先级

| 输入条件 | 结果 |
|---|---|
| pure-live 中同一 stable step 有多条累计 snapshot | 保留 canonical order 中最后一条，不比较文本或长度 |
| settled completed thinking 与随后叠加的 live thinking 具有相同稳定身份 | 保留 settled completed，移除同 step live copies |
| matching persisted completed thinking 具有稳定 step 身份 | 保留 persisted completed，移除同 step 的全部 base thinking |
| persisted completed 与 base 使用相同 `eventId` 和稳定 step 身份 | persisted completed 替代 base copy |
| thinking 的稳定 step 身份不同 | 全部保留，随后按既有排序规则排列 |
| 任一 thinking 缺少非空 `stepId` | 不按 step 合并，仅适用 `eventId` 去重 |
| session、run 或 root 不匹配 | event 继续被现有坐标隔离规则排除 |

选择既有投影组合阶段处理而不是修改 live reducer，是因为 settled、live 与 event-history 输入层单独看都仍是合法事实。分别在 pure-live/settled 汇合点和 base/event-history 汇合点决定 canonical copy，可以保持输入层不可变，并由共享 helper 保证同形同策。target eligibility 则必须在 visibility/explicit target adapter 处理，因为 scheduler 不应自行推断 React turn lifecycle。

## 质量属性设计（Quality Attributes）

| 质量属性 | 设计结论 | 验证方向 |
|---|---|---|
| 安全 | 不新增输入、权限或输出字段；先执行既有 session/run/root 隔离，再建立 step 身份；不读取 thinking 文本作判断 | unit negative case 与代码审查确认不跨坐标合并、不基于文本推测 |
| 性能/容量 | 对单 turn envelopes 执行常数次线性扫描；active run 不再产生 event-history 请求；不增加 React/store 状态 | unit 测试覆盖累计替换、target eligibility 与大量重复回填，前端 build 确认无额外依赖 |
| 可靠性/恢复 | active run 继续由既有 scoped replay 恢复；组合函数保持幂等；终态切换后 history hydration 不漏触发 | replay characterization、active→terminal target transition、重复组合验证 |
| 可维护性 | 稳定身份 helper 集中在纯投影工具；eligibility 使用既有 `TurnBlock.status`，scheduler 不复制 run lifecycle | 定向代码审查确认 owner 单一且无跨模块状态 |
| 可测试性 | 纯函数与 visibility/explicit adapter 可直接表达 normal、boundary 和 conservative fallback | projection、visibility target、ChatPage explicit target tests 使用真实 contract shape |
| 审计/可追溯性 | 不修改 durable event 或日志；保留的 canonical copy 继续携带原始 persisted event identity 和 timeline reference | unit 测试断言 persisted copy 被保留 |

## 验证策略（Verification Strategy）

- unit 层覆盖 pure-live 同 step 累计 snapshot 替换、settled completed 替代仍保留的 live copy、persisted completed 替代 base copies、相同 `eventId` 替代、重复回填幂等和不同 step 保留。
- negative unit 层覆盖缺少 `stepId`、相同文本但不同 step、相同 step 但不同 session/run/root，证明实现不猜测身份且不突破 turn 隔离。
- visibility/ChatPage unit 层覆盖 active automatic/explicit target 被排除、terminal turn 被纳入、active→terminal 重新发布，以及既有历史轮次和预览目标不回归。
- 既有 active-run replay unit/E2E characterization 必须证明 current run 不依赖 event-history API 恢复可恢复流内容。
- 既有 process-history tests 继续验证 answer owner、坐标过滤、分页和 event 顺序，防止本次最小修改破坏其他组合行为。
- agent-web TypeScript/Vite build 验证类型、bundle 和三种 host 对共享组合路径的消费保持一致。
- OpenSpec strict validation 和语义审查验证 change 未新增 API、contract、后端 owner 或第二套前端状态。

## 风险与取舍（Risks / Trade-offs）

- 旧数据或异常 provider envelope 缺少 `stepId` 时，系统仍可能显示两份文字相同的 thinking。该结果是有意的保守降级：错误合并两个真实 step 会造成不可恢复的信息丢失，比保留可见重复风险更高。
- `stepId` 只在当前 session、run 和 root 内稳定；实现若遗漏任一坐标会产生跨 turn 合并风险。通过集中 identity helper 和负向测试约束全部坐标。
- active→terminal eligibility 若未进入 visibility identity，可能导致 run 终态后不加载；必须由 transition test 锁定。
- active-run replay 是关闭当前 run event-history target 的前置稳定契约；若 characterization 不通过，实施必须暂停并先修正设计，不能引入第二条隐式恢复路径。

## 待确认问题（Open Questions）

无。

## 长期基线刷新计划

本节将旧模板的“归档前更新基线”归一为可审计的归档门禁；以下均为**归档前待执行**，不表示 stable baseline 已刷新。

- **Function：**以 `FN-5.2-调用能力` 为唯一用户可见行为 owner；若本 change 增加的行为不能被该 Function 的既有边界完整表达，先在同一能力域新增一个单一职责 Function，再更新 `openspec/designs/functions/index.md`，不得把实现细节直接写入 Function。
- **Stable spec：**将 delta Requirement 合并至 `openspec/specs/ts-stream-history-consistency/spec.md`，逐条核对 Requirement 标题、MUST/SHALL 语义、场景、迁移和 metadata；不得以 `--skip-specs` 绕过同名 Requirement 重叠。
- **长期设计：**先执行本 design/proposal 已列出的“归档前更新基线”设计 owner；再在 `openspec/designs/spec-to-design-map.md` 为上述 stable spec 写入该 Function、实际承载的 architecture/module/ADR 与验证入口。若现有 map 无该 spec 行，先创建该行，而非把 change-local design 当作长期设计。
- **归档判定：**Function、stable spec、长期设计和 map 四端均完成 diff 审阅且 `openspec validate --all --strict` 通过后，才允许归档；任一端无法唯一归属时保留 active 并标记阻塞。
