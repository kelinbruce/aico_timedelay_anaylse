## 0. 规格、契约与依赖门禁

- [x] 0.1 完成 frozen `AgentRunStatePort` additive refinement 确认：增加必选 `setCapabilityTerminalAnswer(run, context, {content})`；每个 run 至多成功一次，重复时安全失败；仅 Direct Workflow 与非 agentic ApiCall 成功 direct-terminal 路径可调用；只由正常 completed terminal 消费；final LLM source 与 Capability source 冲突 fail closed；`AgentExecutionOutcome`、content type、event、role、Gateway port、表、Web DTO 与前端字段均不修改。
  来源：proposal `需群内确认`、design `FN-9.1 执行工作流 / 修改方案`
  验证：2026-08-25 需求方明确确认该 public 方法为必选、参数仅含 `content`、调用方穷尽范围、现有 `PLAIN_TEXT` 展示保持和无其他 contract 增量。

- [x] 0.2 完成原九个 Function、十份 delta spec、proposal、design、tasks 与 roadmap 的语义审查，确认 #823 只处理 Capability 来源 direct terminal、Message-first、模型 50,000 字符有界交付与容量闭环；`FN-4.6` 只承接既有 read 分页规范归属，不产生代码或行为变化。后续经本地用户验证补充的 `FN-1.22` 友好 preview 投影由 5.5 独立审查和验收，不改写本项已完成的原始审查证据。
  来源：proposal 全部范围、design `设计范围`
  验证：2026-08-25 首轮审查遗漏了被触及混合 Requirement 的跨 Function 迁移；补充语义审查已把原 Requirement 整体 REMOVED，并由 FN-4.1、FN-4.5、FN-4.6、FN-8.1 四个 canonical specs 无损承接。#821 只在 #823 stable 后重生成并接管 limitation carrier/本地化 marker，不重做阈值和截断算法。

- [x] 0.3 原子迁移 `Runtime Request Summary Read Model`：`ts-core-contracts` REMOVED 与 `agent-task-channel` ADDED 同时存在；同一 legacy delta 完整 MODIFIED `Agent Core Uses Runtime-Owned Run State Port` 以承载 confirmed frozen handoff，其他 legacy Requirements 原位保留。
  来源：design `存量 Requirement 迁移方案`
  验证：2026-08-25 `openspec validate fix-terminal-message-first-capacity --strict` 退出码 0；在 `/private/tmp/nextagent-openspec-preflight.6wO2lu` 临时副本执行 `openspec archive fix-terminal-message-first-capacity -y` 退出码 0，归档结果为 `+5/~4/-1`；归档后 `Runtime Request Summary Read Model` 仅位于 stable `agent-task-channel` 一处，`Agent Core Uses Runtime-Owned Run State Port` 仅位于 stable `ts-core-contracts` 一处，且仍只引用既有 `RuntimeSessionPort.getRequestSummary` / `RuntimeRequestSummary`，未新增平行 port。

- [x] 0.4 更新 roadmap #823 条目及 #821 前置关系，明确 !1374 已归档、#823 同时对齐模型 50,000 字符成功截断与 Capability terminal materialization；方案二由 #748 跟踪，Workflow executor 统一由 #844 跟踪，且不引入内部过程披露配置。
  来源：proposal `依赖与后续`
  验证：2026-08-25 roadmap 已增加 normal LLM 50,000/50,001 成功边界、Runtime bypass fail-closed 和 #821 只替换 signal carrier 的依赖说明；`git diff --check` 通过。

- [x] 0.5 完成 direct model 容量契约补充确认：硬字符上限从 150,000 收窄到 50,000 个 UTF-16 code units；恰好边界原样成功，首次超限带固定标记有界交付并成功；Runtime 对绕过 producer 保护的原始超限正文继续 fail closed；不新增 LLM 外置或公共字段。
  来源：proposal `需群内确认`、design `FN-4.1 调用模型 / 修改方案`
  验证：2026-08-25 需求方明确回复“确认同意，继续”；该确认覆盖本 change 原先“LLM 50,001 请求失败”的条款，不改变 frozen `AgentRunStatePort` refinement。

- [x] 0.6 原子拆分 `model-invocation-contract / 输出超限不得静默截断`：来源整体 REMOVED；模型恢复与 50,000 字符有界交付由 FN-4.1 新 Requirement 承接，并同步更新 `Failure exits are explicit and safe` 的直接引用；Capability 外置由 FN-4.5 承接；terminal guard 由 FN-8.1 承接；read 分页由 FN-4.6 承接。不得修改生产代码、public contract、阈值、失败语义或用户可观察行为。
  来源：design `存量 Requirement 迁移方案`，涉及 FN-4.1、FN-4.5、FN-4.6、FN-8.1
  验证：2026-08-25 目标 `openspec validate fix-terminal-message-first-capacity --strict` PASS；在 `/private/tmp/nextagent-openspec-preflight.gpWPFm` 临时副本归档退出码 0，合并结果 `+6/~6/-2`；归档后四个受影响 stable specs 分别 strict PASS，旧混合标题计数为 0，五个承接 Requirements 各唯一存在；`git diff --check` 与 `$nextagent-skill-review` 补充语义复审 PASS。差异只包含 change artifacts，无生产代码、public contract 或测试修改。

## 0A. FN-4.1 调用模型

- [x] 0A.1 先把模型输出边界测试改为 50,000/50,001：恰好边界原样成功且无 `MODEL_TEXT_LIMIT_EXCEEDED`；超限时保留 surrogate-safe、Markdown-safe 前缀，追加 `[Model output truncated at the 50000-character safety limit.]`，总长不超过 50,000，停止后缀/Tool call/fallback 并以 `REQUEST_COMPLETED` 结束。
  来源：`模型输出超限执行受控恢复与有界交付 / 字符上限边界保持原样、硬字符上限保留有界内容`
  验证：2026-08-25 修改生产常量前运行三份 focused tests，Agent Core 仍按 150,000 放行，kernel 正常模型路径形成 `TERMINAL_MESSAGE_LIMIT_EXCEEDED` 与 `REQUEST_FAILED`，新契约按预期 RED；同时发现并修正 accumulated-snapshot fixture 自身已超过新 terminal 边界的陈旧前提。

- [x] 0A.2 把 Agent Core direct model 可见文本硬上限收窄为 50,000，复用既有截断、Markdown 闭合、notice 与 final delta 路径；不调用 Capability externalizer，不新增 metadata 或 contract。
  来源：design `FN-4.1 调用模型 / 修改方案`
  验证：2026-08-25 生产代码只把 `maxModelVisibleChars` 从 `150_000` 改为 `50_000`；三份 focused tests 74/74 与 `npm run build --workspace @nextagent/agent-core` 通过，既有 marker、surrogate/Markdown closure、notice 和 final projection 实现原样复用。

- [x] 0A.3 增加并区分两类白盒证据：正常 50,001 字符模型输出在 Agent Core 截断后成功提交；直接绕过 Agent Core 向 Runtime terminal boundary 提交 50,001 字符时在 Gateway 前 fail closed。
  来源：`gateway-store-provider-ownership / 正常模型超限输出提交有界成功正文、绕过模型producer保护的超限正文安全失败`
  验证：2026-08-25 四份 focused files 79/79；真实 Agent Core/model app 路径对 50,001 字符输出发布 `MODEL_TEXT_LIMIT_EXCEEDED`、stream/history 均显示 50,000 上限 marker 并 `REQUEST_COMPLETED`；Runtime unit 与 Message-field rejecting provider harness 对绕过 producer 的 50,001 字符 raw terminal content 形成 durable safe failure，provider 未收到超限 Message。

## 1. FN-4.5 压缩转储工具结果

- [x] 1.1 先增加 direct terminal materialization 红测：50,000 字符 inline，50,001 字符写入 `tool-results` 并产生 preview/ref；ASCII、中文/emoji、workspace write failure 与已冻结 replacement 均覆盖。
  来源：`Capability-result large content is externalized to the execution workspace as a readable file` 全部 Scenarios
  验证：2026-08-25 修改生产代码前分别运行 `npx vitest run --config vitest.config.release.ts packages/agent-app/tests/large-content-externalizer.test.ts`（8/8）与 `packages/agent-context-engine/tests/large-content-thresholds.test.ts`（2/2），ASCII、中文和 emoji 的 50,000/50,001 UTF-16 code-unit 边界、workspace write failure 与 replacement 基线均通过；运行 `packages/agent-runtime/tests/terminal-message-first-capacity.test.ts` 时新增 direct-consumer 用例按预期失败于 `externalize` 调用次数 0，其他 10 项通过。

- [x] 1.2 让 Runtime terminal path 复用既有 `LargeContentExternalizerPort`：只对 run-local Capability terminal handoff 构造非持久化 materialization draft，使用真实 terminal MessageId 和可信 run context，保留 replacement evidence。
  来源：design `FN-4.5 / 修改方案`
  验证：2026-08-25 `packages/agent-runtime/tests/terminal-message-first-capacity.test.ts` 11/11、`packages/agent-app/tests/large-content-externalizer.test.ts` 8/8，`npx tsc -p packages/agent-runtime/tsconfig.json --noEmit` 退出码 0；实现仅向 terminal composite 注入既有 `LargeContentExternalizerPort`，以真实 terminal MessageId 构造非持久化 `CAPABILITY_RESULT` draft，未增加 port、BlobStore、文件路径或额外 Message write。

## 2. FN-9.1 执行工作流

- [x] 2.1 先增加 Direct Workflow characterization 与 contract 红测：冻结 inline success 的答案正文/content type/单一答案、inner process/product/状态/顺序，以及 Workflow-as-Tool 的 matching outer Tool use/result、父模型后续调用、WAITING、失败、取消和超时；新目标路径通过必选 run-state handoff 提交 Capability terminal answer且不产生 final `LLM_CONTENT_DELTA`。
  来源：`Direct Workflow 通过 Capability 结果交付终态回答` 全部 Scenarios
  验证：2026-08-25 修改生产代码前分别运行 release config：`agent-routing-core.test.ts` 78/79，仅新增 handoff 断言按预期失败于收到 `[]`；`workflow-tool-port.test.ts` 13/13、`workflow-event-context-boundary.test.ts` 1/1。既有 Direct inner Event、WAITING/failure 与 Workflow-as-Tool 行为均由同组 characterization 保持。

- [x] 2.2 实现最窄必选 `AgentRunStatePort.setCapabilityTerminalAnswer(run, context, {content})` contract，并让 Direct Workflow 调用该 handoff、按既有 completed outcome 返回、删除其 final LLM delta。
  来源：design `FN-9.1 / 修改方案`、proposal `需群内确认`、`ts-core-contracts / Agent Core Uses Runtime-Owned Run State Port`
  验证：2026-08-25 三份 Workflow 定向测试 3 files / 93 tests、`tests/contract/core-contracts.test.ts` 33/33、`npm run build --workspace @nextagent/agent-core` 全部通过；contract test 以恰好 `{ content }` 调用必选三参数方法，Direct Workflow success 恰好提交一次并无 final LLM delta，未增加 contentType/origin/MessageId/ref/metadata 参数。

- [x] 2.3 增加 Direct Workflow 50,001 字符端到端回归：terminal Message preview/ref、workspace 全文、Event body-free、run completed，inner product 规则不变。
  来源：`Direct Workflow 通过 Capability 结果交付终态回答 / Direct Workflow大结果复用Capability保护`
  验证：2026-08-25 kernel capacity 使用真实 externalizer/workspace resolver 验证 Direct Workflow 超限结果、replacement ref 与全文回读，Event body-free、live/history/summary committed preview 一致；与 Workflow context boundary 合计通过（capacity 文件当前 5 项，context boundary 1 项）。

## 3. FN-5.17 技能驱动 API 调用

- [x] 3.1 先扩展两条非 agentic ApiCall characterization：分别冻结 pre-round/post-tool-call、全 structured/mixed/no-stream 的答案正文、`PLAIN_TEXT` terminal content type、PIU/DSL、Capability Result Message、completion Event、checkpoint、过程状态与顺序；同时冻结普通 model-driven ApiCall 的 matching Tool protocol 和后续模型调用。新增目标断言成功 direct path 通过 Capability terminal handoff且没有 final LLM delta。
  来源：`Orchestration Layer Invokes API Tool And Returns Terminal Response` 全部 Scenarios
  验证：2026-08-25 生产修改前分别运行 release config：pre-round 文件 5 项全部按新 handoff/no-final-delta 断言失败，同时原有 structured/PIU 与 completion 断言先通过；post-tool-call 文件 53/54，仅新增 handoff 断言失败。覆盖全 structured、mixed、无 stream 与 model-driven/output-window 既有路径。

- [x] 3.2 收敛 pre-round 与 post-tool-call 两条非 agentic ApiCall success path 到同一 Capability terminal handoff，移除两条路径对模型专用 `assertTerminalContentReady()` 的调用，不修改普通 model-driven ApiCall。
  来源：design `FN-5.17 / 修改方案`
  验证：2026-08-25 pre-round 5/5、post-tool-call 54/54、`npm run build --workspace @nextagent/agent-core` 通过；两条 direct success path 均调用同一 handoff 且无 final LLM delta，模型专用 `assertTerminalContentReady()` 仅从这两处移除，ordinary model-driven 测试组保持通过。

- [x] 3.3 增加 50,001 字符 ApiCall terminal integration：普通 Capability Result Message 与 terminal Assistant Message 均不超过 50,000 字符，完整原文可读取，请求成功终态。
  来源：`Orchestration Layer Invokes API Tool And Returns Terminal Response / 超长API结果安全终态化`
  验证：2026-08-25 kernel capacity 的 `APICALL` case 先写真实 `CAPABILITY_RESULT` Message 再提交同源 terminal answer；两条 Message 均 `content.length <= 50_000`、各自 replacement ref 可读，terminal Event 无正文且 run completed；agent-core pre/post producer 测试分别 5/5、54/54。

## 4. FN-8.1 持久化运行数据

- [x] 4.1 先扩展 terminal composite 红测：run-local Capability terminal answer 至多设置一次；中间 LLM delta 不冲突，final LLM source 与 Capability source 同时存在时 fail closed；失败、取消、supersede、pending/discard 清理且不消费；hook 后物化；Message metadata 保留 replacement；直接绕过 Agent Core 的原始 50,001 字符 terminal answer 继续 fail closed。
  来源：`终态复合提交使用唯一Message正文`、`终态timeline Event在复合提交前保持有界`
  验证：2026-08-25 producer 修改后、Runtime source-selection 修改前，unit 红测唯一失败于 50,001 LLM 仍为 `COMPLETED`，kernel 红测失败于 Capability source 未生成 `REQUEST_COMPLETED`；新增白盒同时锁住重复设置、双向 source conflict、中间 delta、discard 与 replacement metadata。

- [x] 4.2 实现 Runtime source selection、hook-after materialization 与 terminal metadata merge；保持四类 terminal、幂等 composite、49,000-byte Event shell 和无 fallback。
  来源：design `FN-8.1 / 修改方案`
  验证：2026-08-25 Runtime 四份 focused files 44/44、kernel Hook-before-materialization 回读通过、`npm run build --workspace @nextagent/agent-runtime` 与 `git diff --check` 通过；completed-only source selection、pending discard、cancel/failure/supersede 不消费和 composite failure 无 live fallback 均由对应路径覆盖。

- [x] 4.3 增加 rejecting provider 白盒集成：按解析后的单个 `message.content.length > 50_000` 拒绝；Direct Workflow/ApiCall 通过外置成功，正常超长 LLM 通过 Agent Core 有界交付成功，绕过 producer 的超限 terminal 正文失败，真实 composite failure 不发布 terminal。
  来源：proposal `目标与验收边界`、design `跨 Function 质量属性设计`
  验证：2026-08-25 terminal capacity 与 output guard 两份 kernel files 联合证明：Direct Workflow/ApiCall 在拒绝型 provider 下 committed；正常 LLM 超限先由 Agent Core 有界化并完成；模拟 adapter 绕过 producer 时 Runtime 提交 safe failure Message；显式 composite reject 仍不持久化或发布伪 terminal。四份 focused files 合计 79/79。

## 5. FN-1.2 断线恢复与一致性

- [x] 5.1 把现有 60KB“live/history 完整正文”测试改为同一 committed preview/ref projection，并保留 inline answer、invalid association、Workflow product 独立和 composite failure 负例。
  来源：`终态回答通过唯一Message关联恢复` 全部 Scenarios
  验证：2026-08-25 release config 下四份投影/history 文件 4 files / 82 tests 全部通过；terminal fixture 使用 committed preview/ref，inline answer、invalid association、Workflow product 与 composite failure 既有负例保持通过。另同步三条已由现行 RAG SUMMARY、Bash DETAIL 与 Cron descending 规则证明陈旧的测试期望，未修改对应生产逻辑。

- [x] 5.2 确认 live terminal publisher 使用 committed materialized content，history resolver 不读取 workspace 文件或 Event body。
  来源：design `FN-1.2 / 修改方案`
  验证：5.1 与 kernel capacity 断言 live/cold/request summary 精确等于 committed Message preview；`tests/architecture/workspace.test.ts` 28/28，通过 source negative gate 锁住 terminal projector 只读 associated Message、无 browser hidden Message/workspace GET contract，并穷尽三个 producer call site。

- [x] 5.3 增加 Workflow/ApiCall 用户可见兼容性回归：对 50,000 字符以内 Direct Workflow 与非 agentic ApiCall，live 与 settled history 保持与修改前相同的 terminal Message projection、structured answer segments、ProcessPanel 条目、状态与相对顺序；Workflow-as-Tool 和 model-driven ApiCall 不产生 direct terminal answer。
  来源：`Direct Workflow 通过 Capability 结果交付终态回答 / 边界内Direct Workflow保持既有界面行为`、`Orchestration Layer Invokes API Tool And Returns Terminal Response / 边界内非agentic ApiCall保持既有界面行为`
  验证：后端 producer 组 Direct Workflow 93/93、ApiCall pre/post 5/5 与 54/54，channel 投影 82/82；前端三份 ProcessPanel/AnswerSegments/requestStore 测试 3 files / 90 tests 全部通过。该阶段前端为 zero diff；5.4 继续冻结 structured `ANSWER` 的既有答案区语义。

- [x] 5.4 恢复 structured `ANSWER` 的统一答案区语义：Workflow correlation 不得把 `ANSWER` 移入 ProcessPanel；`TITLE/DETAIL/SUB_TITLE/SUB_DETAIL` 等过程类型保持现有过程区投影；ordinary structured `ANSWER` 不变。修正曾同时构造高度重复 PIU ANSWER 与 terminal Message 的 fixture，并增加 TEXT/PIU/DSL、live/cold history 与完整多节点回归。
  来源：`Direct Workflow 通过 Capability 结果交付终态回答 / Workflow节点ANSWER产物留在答案区`、`终态回答通过唯一Message关联恢复 / Workflow structured presentation与terminal answer保持独立`
  验证：TDD RED 精确复现 6 个失败断言：Workflow TEXT/DSL/PIU ANSWER 均未进入答案投影、Workflow PIU 被错误加入 ProcessPanel、SSE/history 整页答案区均缺少 ANSWER。GREEN 后 7 个相关文件、371/371 tests PASS；frontend TypeScript build、三宿主 Vite build、目标 OpenSpec strict 与 `git diff --check` PASS。生产代码只恢复既有 answer/process 分类和相同 Workflow TEXT terminal 精确去重；public contract、Channel、Runtime、Gateway 与 persistence zero diff。

- [x] 5.5 对 Capability 来源超长 terminal answer 增加最小友好投影：保留 Message 中 canonical `PERSISTED_PREVIEW` 和 replacement evidence，`agent-web` 在 live/history 答案区使用同一规则显示本地化部分内容说明、原始字符数、有界 preview 和继续提问提示；隐藏 reason/ref/内部路径/Read 指令，不新增公共字段、组件、样式、全文交互或 workspace 读取。普通正文与不完整协议形态不得误投影。
  来源：`agent-web-assistant-markdown-rendering / 外置终态结果以用户语言展示部分内容`
  验证：TDD RED 分别以 parser 3 个缺失行为和 TurnBlock live/history 2 个技术协议泄漏断言复现；GREEN 后 frontend `answerContent`、`processDetailsProjection`、`TurnBlock`、`i18n` 4 files / 241 tests 与 TypeScript build 全部通过。既有 MiniMax 组合会话 `session-ad1d5eb3-54b6-44b8-b74a-943b7c26b43d` 在更新构建后冷刷新：友好说明和继续提问提示各 1，过程节点产物仍为 1，`<persisted-content>`、replacement reason 与 Read 指令均为 0。持久化 Message/ref 未改写，页面不读取 workspace。

## 6. FN-10.10 任务通道

- [x] 6.1 完成 Requirement 原子迁移并把 request summary 测试从“完整 60KB”改为 committed preview/ref；safeError 与 cross-scope fail closed 保持。
  来源：`Runtime Request Summary Read Model` 全部 Scenarios、design `存量 Requirement 迁移方案`
  验证：release config 下 request summary/task channel 2 files / 90 tests，contract config 下 core contracts 33/33 全部通过；preview/ref、safeError、invalid association 与 cross-scope fail closed 保持。

## 7. FN-10.9 Cron 工具

- [x] 7.1 把 Cron 结果测试从“完整 60KB”改为 committed preview/ref；association missing/invalid、gateway throw 与 cross-scope 行为保持。
  来源：`Cron task execution record API surface` 全部 Scenarios
  验证：release config 下 Cron composition/Web route 2 files / 22 tests 全部通过；committed preview/ref、association missing/invalid、gateway throw 与 cross-scope 行为保持。

## 8. 共享门禁与完成

- [x] 8.1 运行全部定向测试、后端 build/test/contract/architecture 与 OpenSpec strict；将 main 基线噪声、环境失败和 change-caused failure 分开记录。
  来源：proposal 全部影响、design `验证策略`
  验证：2026-08-25 合入最新 `origin/main=039cc362a` 后，在 Node 22.22.2 下最终重跑：四份容量 focused files 79/79；`npm run build` PASS；`npm test` 174 files PASS / 1 skipped、2283 tests PASS / 2 skipped；`npm run test:contract` 50 files、388/388；`npm run lint:architecture` 54 files、324/324 且 0 dependency violations；目标 change strict PASS；`git diff --check` PASS。`openspec validate --all --strict` 为 247 PASS / 11 FAIL，11 项均为未触达 baseline。沙箱内 socket/browser `EPERM` 与一次未触达 local-file-roll 时序抖动均已分别复跑，最终完整 suite 干净通过。

- [x] 8.2 运行 `$nextagent-skill-review` 和 `$nextagent-code-review`；覆盖 frozen contract 确认、两类结果生产者、LLM 50,000 字符有界交付、Message-first、terminal 原子性、50,000-char Message、49,000-byte Event、scope、Workflow/ApiCall 同策、原始用户可见兼容性、当时的前端生产代码零变更与 KISS。后续友好 preview 投影的独立增量审查由 8.4 负责。
  来源：proposal `需群内确认`、design 全部章节、AGENTS push gate
  验证：2026-08-25 对 `origin/main...working tree` 完整分支范围重新执行两份模型语义检视，结论 PASS、P0/P1/P2=0。补充治理复审进一步解除 #821 归档循环并完成四 Function 原子迁移，仍未修改 frozen contract、Gateway/Web/stream shape、前端生产代码或持久化 owner。完整结论与门禁证据已更新到 `review.md`。

- [x] 8.3 在最新 main 上复核 #821 前置，以及 #748 方案二、#827 前端失败治理、#828 timeline 可靠性和 #844 Workflow executor 统一均保持非目标，提交单一职责 commit；push 前重跑模型语义检视。
  来源：proposal `依赖与后续`
  验证：2026-08-25 已自动合并最新 `origin/main=039cc362a`，`git merge-base --is-ancestor origin/main HEAD` PASS；补充修订以单一职责 commit `b8a21ba3a fix(model): lower terminal output guard from 150000 to 50000` 提交。push 前 `$nextagent-skill-review` 与 `$nextagent-code-review` 均 PASS、P0/P1/P2=0；分支相对 main 的 frontend production zero diff，#821 仍在本 change 归档后重生成，#748/#827/#828/#844 owner 边界不变。

- [x] 8.4 对 5.5 的新增 `FN-1.22` delta 和前端实现重跑 `$nextagent-skill-review`、`$nextagent-code-review`、相关 frontend 测试/build、`openspec validate fix-terminal-message-first-capacity --strict`、`openspec validate --all --strict` 与 `git diff --check`；证明 public contract/Channel/persistence zero diff，live/history 友好投影一致，且 #748/#821/#844/#846 范围未被提前吸收。
  来源：proposal `目标与验收边界`、design `FN-1.22 展示会话消息正文`
  验证：两份语义复审均 PASS，P0/P1/P2=0；实现只修改共享答案投影、两种 locale 和黑盒测试，`agent-contracts`、Channel、Gateway、Runtime/persistence 与三宿主入口均 zero diff。目标 strict 与全仓 strict（259/259）、frontend 241/241、frontend build、Runtime/terminal capacity 19/19 和 `git diff --check` 全部通过。#748 ordinary PIU、#821 completion limitation、#844 Workflow variables/executor 与 #846 BlobStore 全文读取均保持后续 owner。

## 归档前更新基线检查（非实施任务）

按 design `长期基线刷新计划` 同步十份 stable specs、十个 Functions、必要 Features、overview、architecture/modules、两个 ADR 与 spec-to-design-map。必须确认两个 legacy Requirements 的来源 REMOVED 与全部 canonical target 原子落入 stable、`Runtime Request Summary Read Model` 迁移后唯一、legacy `large-content-readback` stable spec 已显式补齐 `FN-4.6` 主规格元数据、`AgentRunStatePort` 确认范围未扩大且 `AgentExecutionOutcome` 无 diff、FN-4.1 模型硬上限为 50,000、FN-4.5 过期 64 KiB 建议值已移除、FN-4.6 read 分页行为无变化、FN-1.22 只同步 terminal preview 的本地展示语义。归档前只记录 post-archive handoff：本 change 归档成功后由 #821 执行 rebase 和 delta 重生成；#821 实际重生成不是本 change 的完成或归档门禁。远端部署复测仍是 Issue #823 的生产闭环；本地 rejecting provider 与白盒测试不得冒充 remote E2E。
