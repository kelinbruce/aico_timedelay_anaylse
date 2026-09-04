# fix-terminal-message-first-capacity 规格语义审查

- 检查日期：2026-08-26
- 目标基线：当前 branch 已合并最新 `origin/main=c03ecc2a6` 后的 change artifacts 与代码
- 设计审查：需要；涉及 frozen contract、runtime flow、terminal persistence、capacity、recovery 与用户可见行为

## 审查结果

状态：PASS

proposal、十一份 delta specs、design、tasks、roadmap、stable merge key、当前代码与架构边界已形成唯一实施路径。frozen handoff contract 与 direct model 50,000 字符容量调整均已由需求方确认；旧混合容量 Requirement 已无损拆到四个 canonical Functions，#821 归档后 handoff 不再构成本 change 的归档前门禁。

## Findings

| ID | 严重级别 | 领域 | 位置 | 问题 | 必需动作 |
|---|---|---|---|---|---|
| B1 | RESOLVED | frozen contract | proposal `需群内确认`、design `FN-9.1 / 修改方案`、tasks 0.1 | Direct Workflow 与非 agentic ApiCall 需要把 Capability 最终结果交给 Runtime；现有 `AgentExecutionOutcome` 只表达 COMPLETED/PENDING_INPUT，stable core 同时要求 final answer 经 runtime-owned run state 发布。 | 2026-08-25 已确认增加必选 `setCapabilityTerminalAnswer(run, context, {content})`；调用方仅 Direct Workflow 与非 agentic ApiCall 成功 direct-terminal 路径；不增加 contentType/origin 或其他 contract。 |
| B2 | RESOLVED | spec completeness | `specs/ts-core-contracts/spec.md` | 初版只在 design 记录 public method，没有修改 stable frozen Requirement，无法授权 `agent-contracts` 实现。 | 已完整 MODIFIED `Agent Core Uses Runtime-Owned Run State Port`，加入精确方法、允许调用方、一次性、terminal source 冲突和非 completed 清理规则。 |
| B3 | RESOLVED | release scope | proposal `非目标/依赖与后续`、design `FN-9.1/FN-5.17`、roadmap #823 | 旧后续表述暗示 Workflow 需要新增 `context:inline|fork` 或节点级披露配置，且没有明确 ordinary structured Message/Event 过渡事实的 owner。 | 已删除披露配置承诺；#844 独立治理 Workflow executor 统一，#748 独立治理 semantic/presentation 分离，#827/#828 保持各自 owner，#823 不冻结这些后续 contract。 |
| B4 | RESOLVED | compatibility | proposal `目标与验收边界`、Workflow/ApiCall specs、design `兼容性门禁`、tasks 2.1/3.1/5.3/5.4 | internal handoff 不得改变边界内 Workflow/ApiCall 的答案、structured presentation、过程与界面；测试 fixture 也不得用语义重复的 PIU ANSWER 与 terminal Message 推导新的区域规则。 | 已把 terminal Message projection、PIU/DSL、过程状态/顺序、Workflow-as-Tool 与 model-driven ApiCall 写成 characterization 门禁；structured `ANSWER` 对 Workflow 与 ordinary Tool 同策留在答案区，过程类型留在 ProcessPanel。 |
| B5 | RESOLVED | capacity contract | `model-invocation-contract`、Agent Core output guard、Runtime terminal guard | stable direct model 成功截断上限为 150,000 字符，但不可修改的 Gateway 单 Message 上限为 50,000；#1375 原实现会让正常 50,001 字符模型正文在 Runtime 整体失败，使 stable 成功截断和 #821 的成功 limitation producer 不可达。 | 已补充确认并由 `FN-4.1 / 模型输出超限执行受控恢复与有界交付` 承接：Agent Core 在 50,000 字符有界截断后成功，Runtime 只拒绝绕过 producer 的原始超限正文；LLM 不使用 Capability 外置，#821 接管 limitation carrier/本地化标记而不重做容量阈值与截断算法。 |
| B6 | RESOLVED | dependency governance | proposal `依赖与后续`、tasks `归档前更新基线检查` | proposal 要求 #1375 归档后 #821 才重生成，旧归档检查却要求 #1375 归档前确认 #821 已重生成，形成循环依赖。 | 已从归档前门禁删除实际重生成要求；归档前只记录 post-archive handoff，#821 的 rebase 与 delta 重生成由 #821 在 #1375 stable 后执行。 |
| B7 | RESOLVED | Function ownership | `model-invocation-contract / 输出超限不得静默截断` | 被触及的 legacy Requirement 同时承载 FN-4.1、FN-4.5、FN-8.1 与 FN-4.6 行为，违反一个 Requirement 唯一归属一个 Function/spec 的规则。 | 来源 Requirement 整体 REMOVED；模型恢复、Capability 外置、terminal guard、read 分页分别由四个 canonical specs 原子承接；迁移不修改代码、public contract 或用户可观察行为。 |

已处理问题：

- 旧方案给 `AgentExecutionOutcome.COMPLETED` 增加正文，违反 frozen core control outcome 和 final-answer handoff 约束；已删除并改为 runtime-owned run-state handoff。
- 旧方案假设 terminal Message 可无界保存完整 60KB 正文；已按真实 Gateway “单个解析后 `message.content.length > 50,000` 拒绝”改为 Capability workspace 全文 + Message preview/ref。
- 旧方案要求 live/history/Task/Cron 返回物化前全文；已统一为 committed terminal Message projection，避免 live/history 分叉和公共全文读取扩张。

## 需群内确认

已确认，无未决项：

```ts
interface AgentRunStatePort {
  readonly setCapabilityTerminalAnswer: (
    run: RequestRun,
    context: RequestContext,
    answer: { readonly content: string },
  ) => Promise<void>;
}
```

确认语义：

- 方法为必选；production Runtime 与所有 test stub 同步实现，不为不存在的外部 production adapter 放宽契约。
- 同一 run 至多一次成功调用；重复调用 fail closed，不覆盖、不拼接。
- 生产调用点穷尽为 Direct Workflow 与非 agentic ApiCall 成功 direct-terminal 路径；其他 Capability、普通 Model Loop和 Workflow-as-Tool 禁止调用。
- 调用方穷尽属于受信任 Agent producer contract：Runtime 强制 run/context、一次性、completed-only 和 source-conflict 不变量，architecture negative test 锁住仓内调用点；不增加可伪造的 `origin` 字段或伪鉴权。
- 中间 LLM delta 不冲突；final LLM source 与 Capability source 同时存在时 fail closed，不设静默优先级。
- 只写 run-local execution output；只在正常 completed terminal source selection 消费，其他终态与 pending/discard 清理且不消费。
- 50,000 字符及以下结果保持现有 `PLAIN_TEXT` terminal Assistant Message 展示，不新增来源标签、卡片、content type 或前端分支。
- 不修改 `AgentExecutionOutcome`、event type、Message role、Gateway port/Record、数据库表、Web API、stream DTO 或前端公共字段。

补充确认语义：

- direct model 硬字符上限从 150,000 收窄为 50,000 个 UTF-16 code units；恰好边界原样成功且无超限信号，首次超限带固定标记有界交付并 `REQUEST_COMPLETED`。
- Runtime 50,000 字符 guard 保持 fail-closed，只覆盖绕过 Agent Core producer 保护的原始正文。
- LLM 不调用 Capability externalizer、不创建 workspace ref/replacement metadata；Issue #821 后续把 `MODEL_TEXT_LIMIT_EXCEEDED` 从 notice 迁移到 completion limitation 并接管本地化标记呈现，但不重做容量阈值与截断算法。

## 约束对齐

| 约束来源 | 结果 | 备注 |
|---|---|---|
| architecture | PASS | Runtime 继续拥有 lifecycle/terminal/timeline；Core 只通过 runtime-owned run state handoff；Context externalizer 与 Gateway owner 不变；调用方穷尽以 trusted producer contract 与 architecture negative test 治理。 |
| core contracts | PASS | 已撤销 outcome-body 方案；必选 handoff 符合“final answer 经 runtime-owned run state 发布”，精确 shape 已确认。 |
| roadmap owner boundaries | PASS | #823 以 Runtime 为主要 owner，Core/Context/Workflow/Channel/Task/Cron 只做必要接入。 |
| roadmap change rules | PASS | !1374 已归档；#823 独立关闭 Gateway Message 超限；#821 继续等待 #823 stable。 |
| current code | PASS | 已核对 Direct Workflow final delta、两条非 agentic ApiCall、run output accumulator、terminal commit、large-content externalizer 与 Message readers。 |
| engineering principles | PASS | 复用 existing externalizer，不新增 terminal truncator/BlobStore/Message role/Event；唯一方案满足 first principles、KISS、SOLID。 |

## OpenSpec 完整性

| 必需项 | 结果 | 备注 |
|---|---|---|
| Function-spec 映射 | PASS | 十个 modified Functions；FN-4.1、FN-4.5、FN-4.6、FN-8.1 各自由 canonical spec 承接容量行为；`ts-core-contracts` 同时承载一个 legacy Requirement 原子迁移来源和一个已确认 frozen core Requirement refinement，不创建新 Function。 |
| Delta/stable operation | PASS | `输出超限不得静默截断` 与 `Runtime Request Summary Read Model` 均形成来源 REMOVED 和全部目标 ADDED/MODIFIED 的原子迁移；其余 MODIFIED 标题均在同名 stable spec 恰好匹配一次。 |
| Function 变更汇总 | PASS | 十个主规格均按实际 Function 字段汇总并双向引用 Requirements。 |
| Function 规格 | PASS | 每个目标 Function delta 只提炼一个或两个决定验收的规格；归档计划清理 FN-4.5 过期 64 KiB 建议值。 |
| Requirement 元数据 | PASS | ADDED/MODIFIED 均声明需求类别；容量 Requirement 声明质量属性与适用范围。 |
| 质量属性分层 | PASS | LLM 50,000-char 有界交付归 FN-4.1；Capability 50,000-char 外置归 FN-4.5；read 有界分页归 FN-4.6；terminal Message/Event guard 归 FN-8.1；共享物理边界只在 design 汇总。 |
| 触发机制 | PASS | Direct Workflow、非 agentic ApiCall、LLM、Workflow-as-Tool 四条入口边界明确。 |
| 输入和前置条件 | PASS | Capability source、字符边界、可信 association、terminal status 条件闭合。 |
| 输出和副作用 | PASS | workspace file、Message preview/ref、body-free Event、live/history/read models 明确。 |
| 核心决策逻辑 | PASS | source selection、hook 后物化、一次 handoff、failure 与 no-fallback 唯一。 |
| 存量代码基线 | PASS | design 逐 Function 记录当前对象、调用链、GAP 与保留行为。 |
| 增量实施路径 | PASS | 只扩展 run-state handoff并复用现有 externalizer/readers。 |
| 唯一实施路径 | PASS | outcome-body、双存、terminal truncator、BlobStore、fake Tool Message 均已排除。 |
| flow 集成 | PASS | Direct、Tool、Model、terminal 与 reader 端到端链路闭合。 |
| 失败和降级 | PASS | 重复 handoff、terminal source 冲突、workspace failure、Message/Event 超限与 composite failure均显式。 |
| 验收示例 | PASS | 50,000/50,001、inline/externalized、invalid association、commit failure、Workflow/API/LLM 均有 task/test 来源。 |

## 语言严谨性

| 检查项 | 结果 | 备注 |
|---|---|---|
| Feature/Function/Capability 术语 | PASS | OpenSpec Function 与 runtime Capability 未混用。 |
| canonical terminology | PASS | Capability terminal answer、committed projection、terminal Message/Event 与 replacement 术语一致。 |
| BCP 14 规范关键词 | PASS | 规范词只在 spec 中；MODIFIED 英文标题保留 stable merge key。 |
| 语义闭合 | PASS | 主体、条件、结果、失败和证据完整。 |
| 量词与可测量边界 | PASS | 50,000 characters、2,048 preview characters、49,000 UTF-8 bytes、每 run 至多一次均可测。 |
| 形式化表示适配性 | PASS | 仅 public internal contract 使用最小 typed shape；无伪状态机。 |
| scenario-to-test 来源 | PASS | tasks 先红测再实现，覆盖黑盒边界与 architecture negative cases。 |
| 黑盒/白盒边界 | PASS | specs 定义可观察结果；owner、调用顺序、run-local state 和 merge 只在 design。 |
| 端到端追踪 | PASS | Function → Requirement → Scenario → task/test 可定位；Feature 仅在价值/保证变化处刷新。 |

## Roadmap 规则覆盖

| 检查项 | 结果 | 备注 |
|---|---|---|
| 输入模板字段 | PASS | active 状态、依赖、目标、集成条件与风险已更新。 |
| 创建前覆盖检查 | PASS | frozen contract、main ownership、依赖、并行边界和后续范围已明确。 |
| 生成后一致性确认 | PASS | artifacts、stable operations、code baseline 与 unique path 一致。 |
| release scope / not-planned / candidate | PASS | #823 只做当前生产故障；#748 方案二、#827 前端失败治理、#828 timeline 可靠性与 #844 Workflow executor 统一均独立跟踪；不规划 Workflow 内部过程披露配置。 |
| 并行边界 | PASS | #821 等 #823 stable；#748 方案二和 #844 Workflow executor 统一不修改本次主流程。 |
| 第一性原理/KISS/SOLID | PASS | 全文只保存于 existing workspace authority；Message 是 presentation owner；terminal 不复制机制。 |
| 基于存量代码的增量设计 | PASS | 保留 existing engine、externalizer、composite write、association readers。 |
| 唯一可实施路径 | PASS | frozen contract 已确认，可直接按 tasks TDD。 |

## 需求和设计清晰度

当前 artifacts 已足够让独立实现者得到同一结果：仅 Direct Workflow 与非 agentic ApiCall 的成功 direct terminal 走必选 run-state handoff与统一 externalizer；LLM 与 Workflow-as-Tool 保持原路径；inline 结果保持既有 `PLAIN_TEXT` 展示，所有读取面显示 committed Message projection。

## 实施后语义复审

状态：PASS

P0/P1：0。实现保持了已确认的唯一公共契约增量，三处受信任 producer 调用点与设计穷尽集合一致；Capability terminal 正文只存在于 run-local state，materialization 在 terminal Hook 后、composite commit 前完成，持久化 Event 保持 body-free，所有读取面继续以 committed terminal Message 为正文 authority。

2026-08-25 direct model 容量补充实现再次按 `$nextagent-skill-review` 与 `$nextagent-code-review` 审查，P0/P1/P2=0，结论 PASS。生产 diff 只把既有 `maxModelVisibleChars` 从 150,000 收窄为 50,000；截断、surrogate/Markdown closure、notice、final delta 与 Runtime 50,000 fail-closed 均复用现有 owner。新增测试通过真实 Agent Core + Message-limited provider 证明正常 50,001 字符模型回答成功，并把 raw Runtime bypass 失败明确标为纵深防御；没有用私有常量镜像目标阈值。

实施复审中发现并解决两项边界问题：

| ID | 严重级别 | 状态 | 问题 | 处理 |
|---|---|---|---|---|
| I1 | P1 | RESOLVED | Lifecycle Hook 返回 `PEND` 时原实现未清理 run-local Capability terminal answer，违反 non-completed/discard 清理约束。 | 在进入 pending 分支前调用 `runState.discardRun(run)`，并以 architecture negative assertion 锁定。 |
| I2 | P1 | RESOLVED | 私有 `capabilityTerminalAnswer` marker 一度加入 exported `TerminalCommitOptions`，扩大了未确认的 `@nextagent/agent-runtime` public surface。 | marker 收回到 Runtime 私有 options 与 terminal outcome 私有 options；公开 interface 无该字段，并由 architecture assertion 锁定。 |
| I3 | P1 | RETRACTED | Direct Workflow fixture 同时构造高度重复的 structured `ANSWER` 与 terminal Message，曾被误判为 Workflow `ANSWER` 应进入 ProcessPanel。 | 2026-08-26 用户验证确认 `TOOL_STRUCTURED_DELTA + ANSWER` 的既有语义就是答案区；已撤销 Workflow correlation 分流，修正 fixture，并以 TEXT/PIU/DSL、live/history 和 ProcessPanel 负例锁定。 |

复审确认：

- `AgentExecutionOutcome`、Message role、Event type、Gateway port/Record、Web API 和 stream DTO 均无变化；前端保持既有 `toolEventType` 区域分类，不新增公共投影字段或产品交互。
- 正常 50,001 字符 LLM 输出在 Agent Core 形成不超过 50,000 字符的带标记正文并成功提交；只有绕过 producer 保护的原始超限 terminal content 在 Runtime fail closed。Direct Workflow 与两条非 agentic ApiCall success direct-terminal producer 仍是 Capability terminal answer 的唯一调用方。
- existing `LargeContentExternalizerPort` 缺失或返回仍超限内容时，统一 terminal 50,000-character guard 继续 fail closed；没有新增截断器、BlobStore 或 live-only fallback。
- terminal Message association 使用真实 run/context/MessageId；workspace replacement evidence 随 committed Assistant Message metadata 保存；Event 只保存关联和有界 lifecycle facts。
- `npm run lint:code` 的 14 errors / 17 warnings 全部位于本 change 未修改的既有文件，记录为 baseline debt，不在 #823 中顺手修复。

## 已运行校验

- `npx openspec validate fix-terminal-message-first-capacity --strict`：PASS（补齐 frozen core delta 后复跑）。
- `git diff --check`：PASS。
- 2026-08-25 收窄复审：完整重读 proposal、design、tasks、十份 delta specs 与 roadmap；确认 #748/#827/#828/#844 均为非目标，目标 strict 与 `git diff --check` 再次 PASS。
- 2026-08-25 模型容量补充复审：`model-invocation-contract` 的 50,000/50,001 边界、Capability 外置负向边界、Runtime bypass fail-closed 与 #821 signal-only 依赖形成单一实施路径；四份 focused files 79/79，Agent Core build 与目标 strict validation 通过。
- 2026-08-25 兼容性补充复审：Workflow/ApiCall 规格只描述目标态可观察结果；该阶段 characterization、Channel/frontend 回归与前端 zero diff 均有 task。2026-08-26 对 I3 复核后确认原 fixture 推导错误，最终规格恢复 `ANSWER` 在答案区、过程类型在 ProcessPanel；无新增 public contract 或群内确认项。
- 2026-08-25 OpenSpec 治理补充复审：解除 #821 归档循环；把 `输出超限不得静默截断` 整体 REMOVED，并由 FN-4.1、FN-4.5、FN-4.6、FN-8.1 四个 canonical specs 无损承接；同步更新 `Failure exits are explicit and safe` 的直接引用。目标 strict PASS；临时归档结果 `+6/~6/-2`，归档后四个受影响 stable specs strict PASS、旧标题为 0、五个承接 Requirement 各唯一存在；无生产代码或 public contract diff，因此无需新增群内确认。
- `npx openspec validate --all --strict`：目标 change PASS；合并最新 main 后仓库总计 247 PASS / 11 FAIL，失败项均为本 branch 未触达的既有 spec/change，因此记录为 baseline debt，不冒充全仓 PASS，也不阻塞本 change 的目标严格校验。
- 定向行为验证：Workflow、ApiCall、Runtime terminal、kernel capacity、projection/history、Task/Cron、frontend 回归与 core contract 均通过；关键容量组为 17/17，frontend 相关 3 files / 90 tests。
- 后端全量验证：合并最新 main 后以 Node 22.22.2 运行 `npm run build` PASS；`npm test` 在允许本机 socket/browser 的环境中 174 files PASS、1 skipped，2283 tests PASS、2 skipped；`npm run test:contract` 50 files、388/388；`npm run lint:architecture` 54 files、324/324，dependency-cruiser 0 violations。沙箱内 socket/browser `EPERM` 与一次未触达 local-file-roll 时序抖动均已隔离复跑，最终完整 suite 干净通过。
- `npm run lint:code`：未通过，14 errors / 17 warnings 均来自未修改既有文件；没有 change-owned lint finding。
- 最终门禁使用非登录 shell 中可用的 Node 22.22.2：`npm run build`、`npm test`、`npm run test:contract` 与 `npm run lint:architecture` 全部通过。最初把 `npm test` 与 contract suite 并行执行时，contract cleanup 出现一次临时目录 `ENOTEMPTY`；顺序独立重跑后 388/388 通过，判定为验证进程间环境竞争而非行为失败。
- 最新主线复核：2026-08-26 刷新并合并 `origin/main=82fd52844`；terminal Message-first 生产代码与 main 的 RAG DETAIL 安全投影可组合，冲突测试保留 main 的有界 `safeResult`；中文资源采用 main 已合入的 !1405 回退结果并保留本 change 两条 preview 文案。`agent-contracts/runtime` 仍只有已确认的必选 handoff 增量；`FN-1.22` 友好 preview 未纳入 Workflow executor 重构/披露配置、ordinary PIU Answer 收编、timeline retry 或前端错误码治理。
- 2026-08-26 `FN-1.22` 友好 preview 增量复审：`$nextagent-skill-review` 与 `$nextagent-code-review` 均 PASS，P0/P1/P2=0。实现仅识别完整 canonical `PERSISTED_PREVIEW`（含 ApiCall JSON envelope），以共享 TurnBlock 本地化投影隐藏模型回读协议；普通或不完整正文 fail open 为原文。未修改 Message、replacement evidence、public contract、Channel、Gateway、Runtime/persistence、组件结构、样式或 workspace 读取。frontend 4 files / 241 tests、frontend build、Runtime/terminal capacity 19/19、目标 strict、全仓 strict 259/259 与 `git diff --check` 均 PASS；MiniMax 历史实例冷刷新显示友好说明并保留过程节点，技术协议文本为 0。
- 2026-08-26 PIU history 主线复核：刷新并合并 `origin/main=c03ecc2a6`。main 新增的 `isHistory` 同时适用于 ordinary 与 Workflow structured PIU ANSWER；本 change 保持该答案区语义，Workflow correlation 不再把 PIU 移入 ProcessPanel。TEXT 完成产物与相同 terminal Message 正文仍复用既有精确去重，PIU/DSL 不按不同数据形态猜测重复。Node 22.22.0 focused frontend、Agent Core、root build、frontend build、全仓 OpenSpec strict 与 `git diff --check` 继续作为门禁。
- 2026-08-26 Workflow ANSWER 纠正验证：在 `origin/main=41071dee8` 上，TDD RED 为 6 个目标失败，最小恢复后 7 个相关 frontend files、371/371 tests PASS，frontend TypeScript build、三宿主 Vite build、目标 strict 与 `git diff --check` PASS。frontend 全量并发 suite 仍有 8 files / 18 tests 的 main 基线失败和 mock server socket `EPERM`；其中相邻失败文件单独复跑仍失败，且 fixture 只含 thinking 或未触达的收藏/投诉/侧栏行为，未把它们冒充本 change 回归。

## 建议下一步

远端部署复测仍由 Issue #823 生产闭环；push 前仍须重新运行 `$nextagent-code-review`。
