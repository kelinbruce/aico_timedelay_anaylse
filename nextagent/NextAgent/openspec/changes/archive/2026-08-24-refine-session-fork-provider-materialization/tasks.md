## 0. 跨 Function 前置门禁

- [x] 0.1 完成本change的agent-contracts升级确认与roadmap准入：确认`prepareFork`/`forkSession`新DTO、九个最终public members、独立`sourceMessageId`/`sourceRequestId`字段、prepare有界ref清单、既有stage/abort按attempt+source ref调整、success-only result + rejected AgentError、四个旧低层operations移除、promotion resolver保留以及Runtime optional signal。未决项阻止contract或代码实施。
  来源：proposal影响范围 + design契约与Runtime调用链
  验证：roadmap与详细change记录存在唯一入口并逐项记录结论；人工review确认breaking变化已获批准。

- [x] 0.2 更新architecture negative tests：public `SessionForkStoreGateway`只含九个目标members；Runtime不得调用prefix/composite/selector或按LOCAL/REMOTE分支，只能按prepare清单调用既有resolver、stage、fork和失败abort；LOCAL provider application与raw SQLite persistence分层；仓内不得新增REMOTE WorkingMemory服务端实现或vendor transport adapter。
  来源：FN-1.11 + FN-8.1 design修改方案
  验证：运行npx vitest run tests/architecture/session-fork-boundaries.test.ts；实施前目标断言失败，完成后通过。

## 1. FN-1.11 从消息派生子会话

- [x] 1.1 保持七条legacy Requirement原子迁移：ts-core-contracts来源REMOVED、session-fork-from-message六条ADDED/五条MODIFIED、未触及fork Requirements原位保留，并保留最终metadata.forkInherited=true语义。
  来源：design存量Requirement迁移方案
  验证：运行OpenSpec strict validation；逐项核对exact Requirement titles与迁移表。

- [x] 1.2 先扩充characterization tests，锁定现有message/request anchors、标题、完整prefix、summary/replacement/tool pairing、active context、fork source/notice、process snapshots、recursive fork、source delete、inherited retry/edit及带attachmentIds历史可派生但后续附件authority需重新校验的行为。
  来源：FN-1.11全部MODIFIED Requirements行为保持部分 + design当前实现
  验证：运行npx vitest run tests/agent-kernel/session-fork-runtime.test.ts tests/agent-kernel/session-fork-gateway.test.ts tests/agent-kernel/session-fork-session-service.test.ts；新增characterization实施前后均通过。

- [x] 1.3 先更新contract schema tests：断言Runtime commands/results owner与窄shape、optional signal、`PrepareForkRequest`/`ForkSessionRequest`独立optional non-null `sourceMessageId`/`sourceRequestId`且恰好一个、bounded `PrepareForkResult`、attempt/ref stage binding、success-only `ForkSessionResult`、九个精确gateway members、128字符key边界、Promise rejection与canonical error catalog；断言旧prefix/idempotency-preload/composite/batch-status types和methods不再public，既有promotion resolver与stage/abort/read/cleanup继续public。
  来源：会话派生Runtime facade保持可信窄入口、会话派生gateway公开准备与原子创建入口、会话派生失败使用唯一安全错误契约
  验证：运行npm run test:contract；实际触发unknown field、双anchor、无anchor、null anchor、非法key、REMOTE非法envelope/tuple/diagnostic fields和timeout precedence。

- [x] 1.4 在现有agent-test-kit中定义唯一可发布的session-fork provider conformance runner。共享runner覆盖message/request anchors、完整prefix与active context、规范化tool-result discovery/stage/commit、scope隔离、取消和幂等重放；LOCAL provider验收补充100轮prefix、durable refs、unsupported execution-bound content、process snapshots、预算、并发幂等等实现细节。driver在provider外使用同一test-only ref→bytes fixture模拟NextAgent resolver，LOCAL与REMOTE不得读取该fixture内部存储。
  来源：LOCAL与REMOTE会话派生保持契约一致、会话派生跨provider边界使用有界协调材料、Fork Failure Is Atomic And Safe
  验证：构建并测试agent-test-kit，运行tests/contract/session-fork-provider-conformance.test.ts与LOCAL fork characterization tests；外部REMOTE接入时复用同一runner并按实施指导补齐provider验收证据。

- [x] 1.5 更新agent-contracts gateway/runtime exports：新增gateway-owned `ForkAttemptId` branded scalar、`PrepareForkRequest`/`PrepareForkResult`/`ForkRequiredContentRef`/`StageForkPromotionResult`/`ForkSessionRequest`/`ForkSessionResult`及strict schemas，`SessionForkStoreGateway`收敛为九个methods并为其增加optional `AbortSignal`；按design调整`StageForkPromotionRequest`的attempt+sourceRef binding，把`ForkPromotionStatus`/`ForkPromotedContentRecord`与四个旧methods的对应types转为provider-private，保留promotion resolver、fork source、single process status、committed promotion read与cleanup types。
  来源：会话派生gateway公开准备与原子创建入口 + design契约与Runtime调用链
  验证：运行npm run build、npm run test:contract和architecture test；旧exports不能引用，新schema negative cases被拒绝。

- [x] 1.6 在agent-platform-gateway-local现有package层级内实现provider-private LocalSessionForkApplication：`prepareFork`校验message/request anchor、成功幂等预查、完整canonical prefix、terminal run、ref discovery与预算；`forkSession`重新校验attempt/staged refs并组装title/source snapshot、child IDs、safe projection、forkInherited、process snapshots和注入式active-context selection；复用现有SQLite private primitives，不复制selector算法。
  来源：Fork From Durable Visible Assistant Message、Child Session Inherits Prefix And Model-Visible Context、Fork Idempotency、会话派生来源元数据保持窄化
  验证：运行session-fork-gateway定向anchor/prefix/title/context/projection/idempotency/source tests和LOCAL conformance fixtures。

- [x] 1.7 实现ref准备与promotion：`prepareFork`只为规范化`tool-results/<refId>`返回resolver所需可信坐标并限制ref count；Runtime按清单调用既有`ForkPromotionContentResolverPort`，跟踪总bytes并调用`stageForkPromotion`；stage以attempt+sourceMessageId+sourceRefId持久化不可见content；`forkSession`只接受matching staged refs并重写为promotedContentId。Working Memory provider已持有且child-accessible的durable attachment/artifact/blob/promoted refs按规范保留或内部重映射；source workspace/host path/unknown execution-bound refs fail closed。
  来源：Child Session Inherits Prefix And Model-Visible Context之durable/execution-bound scenarios + design ref分类与投影
  验证：运行session-fork runtime/gateway ref定向测试；实际断言空ref不stage、单/多tool-result成功、stage response-loss同内容重试返回同promotedContentId、不同内容冲突、resolver missing/undefined、ref count/bytes超限、清单外或缺失stage、sourceRef binding mismatch、unsupported path/unknown ref失败；提交前不可见、成功后committed read可用且copied message不含source ref/BlobRef。

- [x] 1.8 完成LOCAL最终事务、promotion abort/cleanup、并发幂等与cancellation：原子提交session/messages/context/source/snapshots/status/matching promotion commit/success anchor；每个慢阶段和事务开始前检查signal，事务开始后以一致性优先；失败attempt不占成功anchor且best-effort abort只处理STAGED，并发loser返回replayed=true时收敛自身residue；提交后response loss用同key返回replayed=true且后续abort不修改COMMITTED。
  来源：Fork Idempotency、Fork Failure Is Atomic And Safe、Fork atomically materializes child-owned process history
  验证：运行session-fork-gateway atomic/replay/concurrent/cancel/response/failure定向测试；每个写阶段故障均无部分facts。

- [x] 1.9 将Runtime/Web创建路径改为有界协调：Runtime只取得trusted Agent Scope、require source session，调用selected `prepareFork`，按清单调用既有resolver与stage，最后调用`forkSession`；删除prefix/materialization/selector dependencies和deployment分支，保留resolver并把provider给出的bytes预算用于解析；失败时best-effort abort。Web route传播request abort signal；route/request/success保持，失败message固定为`Session fork failed.`。
  来源：会话派生Runtime facade保持可信窄入口、Fork Failure Is Atomic And Safe
  验证：运行session-fork-runtime、channel-web routes及frontend fork tests；断言Runtime不读取prefix、只解析prepare清单、空清单直接fork、多ref按顺序stage、resolver/stage失败触发安全abort；页面按钮条件不增加ref/attachment预判，失败显示既有generic提示且不导航。

- [x] 1.10 发布外部REMOTE WorkingMemory增量对接资产：实施指导只说明新增`prepareFork`/`forkSession`、修改`stageForkPromotion`/`abortForkPromotions`和保留members的optional signal；provider-neutral conformance runner可由外部AgentMemory release candidate直接复用。本仓不实现REMOTE服务端fork逻辑、HTTP endpoint或vendor transport adapter。
  来源：LOCAL与REMOTE会话派生保持契约一致 + design外部REMOTE WorkingMemory增量对接边界
  验证：本仓LOCAL运行suite通过，实施指导包含外部AgentMemory release candidate的相同runner与完整验收清单；architecture test确认仓内未新增REMOTE业务实现。外部候选结果属于AgentMemory仓接入门禁，不属于本仓实现任务。

- [x] 1.11 保留创建后窄读取与维护：fork source、single process status、has-user-after-anchor、历史committed promotion content与cleanup调用方继续工作；cleanup job传播signal，不修改committed content。
  来源：会话派生gateway公开准备与原子创建入口、Fork Failure Is Atomic And Safe
  验证：运行session preparation、context assembly、event history和promotion cleanup job定向tests。

## 2. FN-8.1 持久化运行数据

- [x] 2.1 在当前`WorkingMemoryGatewayBindings` composition中把LOCAL `sessionForks`绑定到完整application service；public `SessionForkStoreGateway`继续作为LOCAL与外部REMOTE的唯一共同contract，不新增专用contract或optional/no-op路径。本仓composition不创建REMOTE WorkingMemory业务实现。
  来源：Working Memory preserves request and session transaction boundaries + design FN-8.1修改方案
  验证：运行gateway composition与architecture tests；LOCAL装配完整application service，外部REMOTE只通过注入的contract test double验证binding选择且仓内没有业务实现。

- [x] 2.2 保持application/raw persistence分层：application service拥有anchor、prefix、ref discovery、fork时required ref重新推导与staged-set校验、projection、selection、snapshot和预算；SqliteGatewayCore只做row mapping、query、promotion row lifecycle、sequence/ordinal、scoped uniqueness、幂等和事务。
  来源：design FN-8.1修改方案
  验证：architecture negative test实际禁止Runtime或raw core越界；code review核对private plan不从package exports暴露。

- [x] 2.3 将旧public prefix/idempotency/composite/process-status primitives转为provider-private复用并保持最终SQLite事务invariants；扩展既有fork promotion persistence记录`sourceRefId`与content digest并允许STAGED行在最终事务绑定child坐标，不新增parallel preparation表。
  来源：design LOCAL provider application transaction + proposal非目标
  验证：运行session-fork-gateway及migration/schema tests；existing DB可打开且历史fork/committed promotion可读。

## 3. 跨 Function 集成与整体验证

- [x] 3.1 完成composition、test doubles和所有call sites迁移，删除本change产生的unused helpers/imports/types；不保留旧fork fallback。
  来源：design跨Function端到端流程
  验证：rg确认旧public operations仅在provider-private实现或迁移说明中出现；npm run build通过。

- [x] 3.2 运行后端全量门禁与OpenSpec校验，并把与本change无关的main基线失败作为独立证据记录，不得用其掩盖目标change失败。
  来源：AGENTS.md验证门禁
  验证：npm run build、npm test、npm run test:contract、npm run lint:architecture、openspec validate --all --strict均实际运行；目标change strict、定向contract/architecture/characterization必须通过，任何全量失败必须能定位到未被本change修改的既有文件并记录在review与PR验证说明中。

- [x] 3.3 运行frontend受影响验证：fork按钮展示/权限/busy/selection行为保持；generic失败提示覆盖resolver/stage/unsupported ref失败；三宿主不产生平行业务语义。
  来源：proposal Web不变边界 + design验证策略
  验证：在frontend/agent-web运行npm run build和fork相关tests；按影响决定是否追加build:vite:modes。

- [x] 3.4 在实施完成后运行nextagent-code-review，覆盖frozen contract、owner边界、security、atomicity、cancellation、LOCAL/REMOTE一致性、Web行为和验证证据；P0/P1清零后才可push。
  来源：AGENTS.md push门禁
  验证：review结论PASS或PASS WITH FOLLOW-UP，且无P0/P1。
