## 0. 前置与规格门禁

- [x] 0.1 对照最新 `origin/main` 修正 proposal、design、四份 canonical delta specs、roadmap 与 tasks；冻结 ordinary semantic result/terminal answer Message-owned、当前可信 structured presentation 使用有退出条件的过渡 Event snapshot、Workflow inner product Event-owned 的唯一矩阵，并删除 timeline local-only、remote 不受影响和聚合 payload 绕过 49KB 的旧结论。
  来源：proposal `目标`、`变更范围`；design 四个 Function 的 `当前实现` 与 `GAP 分析`
  验证：运行 `openspec validate persist-structured-delta-aggregation --strict`；预期 delta operation 和结构校验通过。
  执行记录（2026-08-22，`origin/main@51b92d9d9`）：四份 canonical delta operation 与同名 stable Requirement merge key 对齐；roadmap 已补四 Function、#823/#821 顺序和方案二退出条件；strict validation 与 `git diff --check` 通过。

- [x] 0.2 完成 `$nextagent-skill-review` 语义审查，确认四个 Function/spec 归属、Message/Event owner 边界、legacy fallback、唯一容量策略、local/remote gateway 事实和方案二扩展边界均无阻塞项。
  来源：proposal `Function 影响`、`影响`；design 全文
  验证：模型语义审查结论必须为 PASS；P0/P1 存在时保持实施阻塞。
  执行记录（2026-08-23）：四个 Function 与 delta operation、stable merge key、owner 矩阵、ordinary `ANSWER`/DETAIL history selection、Workflow/terminal 例外、49,000-byte gateway 边界、方案二退出条件均已对齐；strict validation 通过。当前 verdict 为 `BLOCKED`，唯一阻塞项是 0.3 的 `AgentRunStatePort.flushStructuredDeltaPersistence(...)` 删除尚未取得群内确认。
  最终复审（2026-08-23）：0.3 已取得明确确认并按确认范围完成；公共 flush 被删除且没有 replacement contract，Runtime 私有写入顺序、过渡 Event consumer 边界、legacy fallback、Workflow Event-owned 例外、terminal Message-owned/#823 前置和方案二退出条件形成唯一实施路径。`openspec validate --all --strict` 312/312 通过；审查状态 `PASS`。`需群内确认`：该公共方法删除已完成确认，无剩余项。

- [x] 0.3 完成 `agent-contracts` 群内确认：删除尚未归档的 change 已引入 main 的 `AgentRunStatePort.flushStructuredDeltaPersistence(run, context, toolCallId)`；Runtime 在 `CAPABILITY_RESULT` Message 成功写入后私有 flush 过渡 presentation snapshot；不新增 replacement port、DTO、Record、event type、table 或配置。
  来源：proposal `影响`；design `FN-1.1 查看会话消息流`
  验证：记录确认人、时间、确认范围和无异议结论；确认前不得删除公共方法或开始对应生产代码。
  执行记录（2026-08-23）：当前任务用户在核对原接口的引入原因、删除影响和项目群内确认规则后明确回复“同意，继续推进”。确认范围为删除 `AgentRunStatePort.flushStructuredDeltaPersistence(run, context, toolCallId)`，改由 Runtime 在 `CAPABILITY_RESULT` Message 成功写入后私有 flush；保留 structured-delta 聚合、timeline 持久化、`finishRun` fallback 和真实 append failure 传播，不新增 replacement port、DTO、Record、event type、table 或配置。结论：无异议，允许进入生产修改。

## 0A. FN-1.1 查看会话消息流

- [x] 0A.1 执行 owner 回归：普通 `CAPABILITY_COMPLETED` 继续只从 Message 解析结果，Context/Model 输入继续只消费 `CAPABILITY_RESULT` Message，structured Event 不产生 terminal、degradation、新的 request-level terminal fact 或 annotation。
  来源：FN-1.1；Requirement `可恢复过程事件引用唯一消息正文`
  验证：运行 process-message projection、context renderer 与 structured terminal negative 定向测试；预期普通 Message-first、presentation Event 封闭边界和三宿主共享投影均不回退。
  执行记录（2026-08-23）：channel process-message projection 与 runtime structured terminal negative 共 2 个文件、63 项通过；使用独立 Vitest include 运行 context prompt-shaping/history candidate 2 个文件、63 项通过，证明模型输入继续只从 Message history 构造且 timeline presentation 不进入 Context。

## 0B. FN-1.2 断线后从上次位置继续

- [x] 0B.1 先补 history 选择失败测试：同一 run/tool 同时存在 Message-derived structured envelope 与 eligible persisted structured Event 时只保留 Event presentation；ordinary non-Workflow `ANSWER` 继续保留 Message-derived projection；只有 Message 的 legacy Tool 继续恢复；不同 `toolCallId` 或不同 run 不得误抑制。
  来源：FN-1.2；Requirement `结构化过程正文使用单一 Message 恢复`；Scenarios `持久化结构化呈现优先于Message兼容投影`、`ordinary ANSWER继续使用Message-derived projection`、`不同Tool调用不得互相抑制兼容投影`
  验证：在 `frontend/agent-web` 运行 `npm test -- processHistory.test.ts`；预期当前实现的同 run/tool 用例先失败并观察到两份 structured presentation。
  执行记录（2026-08-23）：新增 5 个黑盒场景；修复前目标用例实际同时返回 `persisted-structured` 与 `message-derived-structured`；ordinary `ANSWER`、legacy-only、不同 Tool 与不同 run 用例保持既有边界。

- [x] 0B.2 在既有 `composeTurnProcessHistory` 合并边界实现 run-scoped `toolCallId` 选择：matching persisted structured Event 存在时排除 Message-derived compatibility envelope；没有 matching Event 时保持 legacy fallback；不得按正文相等、前缀或相似度去重。
  来源：design `FN-1.2 断线后从上次位置继续 / 修改方案`
  验证：运行 0B.1 测试；预期新数据唯一呈现、legacy 与跨 Tool/run 用例全部通过。
  执行记录（2026-08-23）：只识别 `timelineEventRef=null`、`history-load`、非空 `messageId`、`role=CAPABILITY_RESULT` 的 Message-derived compatibility envelope，并且只以通过 existing history eligibility filter 的 Event 建立抑制集合；focused Vitest 30/30 与 `frontend/agent-web npm run build` 通过。

## 1. FN-5.16 识别和投射结构化工具增量

- [x] 1.1 先补跨 run 隔离失败测试：两个不同 run 交错发出相同 `toolCallId` 的 PIU，显式 flush、`finishRun` fallback 和 `beginRun` clear 任一 run 都不得读取或删除另一 run；持久化的 tenant、subject、agent、session、request、run 和 content 必须匹配来源。
  来源：FN-5.16；Requirement `结构化增量按run与Tool调用隔离聚合`；Scenarios `并发run使用相同toolCallId仍独立flush`、`一个run终止不清除另一个run`
  验证：运行 `npx vitest run packages/agent-runtime/tests/structured-delta-persistence-accumulator.test.ts packages/agent-runtime/tests/structured-delta-persistence.test.ts --maxWorkers=1`；预期修复前新增用例失败且能观察到串组，修复后通过。
  执行记录（2026-08-22）：修复前 5 个新增用例失败，分别观察到 run B 非 pending、run A 聚合混入 run B、run A cleanup 清除 run B；其余 31 个用例通过。

- [x] 1.2 将 accumulator 私有状态改为 `Map<runId, Map<toolCallId, Group>>`，将私有 flush 改为 `flush(runId, toolCallId)`，并使 `flushAll`、`clearRun`、`hasPending` 只访问指定 run。
  来源：design `run-scoped 私有状态`
  验证：运行 1.1 的测试命令；预期同 ID 并发 run 的全部 unit/port 用例通过。
  执行记录（2026-08-22，Node v22.22.2）：2 个测试文件、36 个测试全部通过；gateway contract 和 record 均未修改。

- [x] 1.2A 先补 Message-first 顺序失败测试并收回公共 flush：`CAPABILITY_RESULT` Message 写入失败时不得持久化过渡 snapshot；写入成功后 Runtime 才私有 flush 同一 `(runId, toolCallId)`；删除 `AgentRunStatePort.flushStructuredDeltaPersistence(...)` 及 Core 显式调用，不新增 replacement contract。
  来源：FN-5.16；Requirement `结构化增量显式flush与run终止兜底flush`；FN-1.1 Requirement `可恢复过程事件引用唯一消息正文`
  验证：先运行 runtime/core 定向用例观察当前顺序失败；完成 0.3 群内确认后实施最小修改，预期 Message failure 无 orphan Event、成功路径 Message sequence 先于 Event，TypeScript 编译证明所有调用方已收敛。
  执行记录（2026-08-23，RED）：runtime focused Vitest 22 项中目标用例 1 项失败；实际 write order 只有 `message`，证明 Runtime 尚未在 Message 成功后私有 flush。其余 21 项通过；生产修改等待 0.3。
  执行记录（2026-08-23，GREEN）：删除 `AgentRunStatePort` 公共方法与 Core 四处显式调用，Runtime 仅在非 suppressed 的 `CAPABILITY_RESULT` Message 成功追加且存在非空 `toolCallId` 后私有 flush。runtime persistence/payload 2 个文件 37/37、Core structured/default-agent 3 个文件 53/53、release-config Tool Loop 22/22 通过；全仓 `npm run typecheck` 通过。Message store rejection 用例确认 timeline `appendEvent` 为 0；成功用例确认顺序为 `message → timeline`。仓内产品与测试代码对公共方法的引用已清零，仅剩 Runtime 私有实现和调用。

- [x] 1.3 先补有界聚合失败测试：第 257 个事件触发前一批提交、第 65 个 group 触发最早 group 提交、group 累计源 payload 达到 49,000 UTF-8 bytes 时分批、单个超大事件不进入驻留 accumulator，且分批不重复通知 live subscriber。
  来源：FN-5.16；系统质量属性 性能/容量；Requirement `结构化增量聚合状态有界` 全部 Scenarios
  验证：运行 accumulator 与 runtime port 定向测试；预期修复前至少 group/item/byte 无界断言失败，修复后通过。
  执行记录（2026-08-22）：修复前新增 4 个 accumulator 容量用例全部失败；分别证明 `accept` 无到界批次、group/item/byte 无界和单个超大事件被驻留。

- [x] 1.4 实现 accumulator 固定 group/event/byte 预算与到界返回批次；runtime 在 `emitEvent` 内等待这些批次通过既有 direct write 路径提交，复用正常聚合结果构造，不新增后台队列、配置或 store。
  来源：design `有界聚合与到界分批提交`、`聚合规则`
  验证：运行 1.3 的测试命令；预期驻留状态始终不超过 64 groups/run、256 events/group、49,000 source bytes/group。
  执行记录（2026-08-22，Node v22.22.2）：accumulator 22 个测试通过；runtime port 额外验证第 257 个事件触发 256 条既有批次写入、257 次 live delivery 无重复。

- [x] 1.5 先补结构保真与投影失败测试：PIU 超限后仍为对象且 `data` 为完整项数组，中文/emoji STREAM_DSL 仍为 `{type:"dsl",content:string}`，其他对象/数组不变成字符串，history projector 保留 `truncated=true`。
  来源：FN-5.16；Requirements `PIU累积uuid合并持久化`、`STREAM_DSL按content.type聚合持久化`、`其他结构化增量按接收顺序持久化`、`Stream Envelope Projection`
  验证：运行 `npx vitest run packages/agent-runtime/tests/structured-delta-payload-truncation.test.ts packages/agent-channel-common/tests/stream-envelope.test.ts --maxWorkers=1`（若投影用例位于既有其他文件则替换为该文件）；预期修复前 shape/marker 断言失败，修复后通过。
  执行记录（2026-08-22）：投影用例落在既有 `process-message-projection.test.ts`；修复前 PIU、STREAM_DSL、object shape 和 `truncated` 投影断言均失败，另复现超大 shell 仍触发 remote-size rejection。

- [x] 1.6 实现按 `toolMessageType` 的结构保真归一化与 channel `truncated` 投影；最终字符串截断必须使用 UTF-8 安全 helper，对象和数组只保留完整前缀项，不得 JSON 化为字符串。
  来源：design `结构保真的单记录归一化`、`截断投影与失败边界`
  验证：运行 1.5 的测试命令；预期 PIU、STREAM_DSL、TEXT、object、array 和多字节用例全部通过。
  执行记录（2026-08-22，Node v22.22.2）：结构化 runtime/channel 定向集合 4 个文件、97 个测试通过；覆盖超大 PIU 可选字段清理后固定身份字段保留，并验证只有可信布尔 `true` 才投影截断标记；根级 `npm run typecheck` 通过。

- [x] 1.7 补 terminal 负向集成测试：结构化增量截断不得发布 `DEGRADATION_NOTICE`、不得创建 request-level completion annotation、不得自行改变 request terminal status；timeline append rejection 必须继续 reject。
  来源：FN-5.16；Requirement `Stream Envelope Projection` Scenario `截断不推导请求完成限制`；Requirement `结构化增量显式flush与run终止兜底flush` Scenario `timeline append失败不被吞掉`
  验证：运行相关 runtime terminal/structured-delta 集成测试；预期截断路径成功且无额外终态事实，拒绝型 gateway 路径显式失败。
  执行记录（2026-08-22）：port 集成用例断言截断只写 `TOOL_STRUCTURED_DELTA`、无 request-level completion annotation 且 run status 不变；独立 rejection 用例确认 `TIMELINE_STORE_UNAVAILABLE` 继续 reject。

- [x] 1.8 先补超长 Workflow completed product 失败测试：`NODE_OUTPUT_DELTA` fragment 保持原始 live 行为；超过 49,000 UTF-8 bytes 的 `NODE_COMPLETED` product 必须进入拒绝 50,000-byte record 的 gateway，持久化 record 保留 Workflow identity 与 `truncated=true`，settled `onTimelineAppend` 与 durable record 同形，且不得额外发布完整 `LIVE_ONLY` completed product。
  来源：FN-5.16；Requirement `Streaming TOOL_STRUCTURED_DELTA Persistence`；Scenario `超长Workflow completed product形成可恢复的有界历史`
  验证：运行 `npx vitest run packages/agent-runtime/tests/structured-delta-persistence.test.ts --maxWorkers=1`；预期修复前新增用例失败并证明 append 被跳过，修复后通过。
  执行记录（2026-08-22）：修复前 21 个用例中新增 2 个用例失败；分别观察到超长 Workflow completed product 的 `appendEvent` 调用次数为 0，以及配置为拒绝写入的 gateway 未被调用、`emitEvent` 错误地 resolve。

- [x] 1.9 在 Workflow `NODE_COMPLETED` direct append 构造完成可信 runtime payload 后复用 `truncateTimelineInlinePayload`；容量内 product 原样写入，超限 product 有界写入并由既有 canonical append 发布；扩充最小 shell 以保留 Workflow product identity，不修改 fragment、accumulator、gateway contract 或真实 append failure 语义。
  来源：design `Workflow completed product 的 settled 一致性`
  验证：运行 1.8 的测试命令及 payload normalization 定向测试；预期 gateway record 始终不超过 49,000 bytes，live/cold settled product 同形，append rejection 继续 reject。
  执行记录（2026-08-22，Node v22.22.2）：structured-delta persistence 与 payload normalization 2 个文件、35 个测试通过；超长 Workflow completed product 传入 gateway 的 payload 不超过 49,000 bytes，保留 Workflow identity 与 `truncated=true`，`onTimelineAppend` 使用同一 payload，未发布额外 `LIVE_ONLY` completed product，真实 `TIMELINE_STORE_UNAVAILABLE` 继续 reject。

## 2. FN-8.1 持久化运行数据

- [x] 2.1 先补 gateway 前硬上限失败测试：ASCII、中文/emoji、恰好 49,000-byte 边界、超大 optional shell、显式 flush、聚合到界批次、`accumulated=true` direct write 和 `finishRun` fallback 的最终 `inlinePayload` 均不得超过 49,000 UTF-8 bytes。
  来源：FN-8.1；系统质量属性 性能/容量；Requirement `结构化增量记录在统一timeline gateway前有界`；Scenarios `显式flush在gateway前满足容量上限`、`run终止兜底flush使用相同容量规则`
  验证：运行 `npx vitest run packages/agent-runtime/tests/structured-delta-payload-truncation.test.ts --maxWorkers=1`；预期修复前超大 shell 或 shape 边界失败，修复后全部通过。
  执行记录（2026-08-22，Node v22.22.2）：该文件 14 个测试通过；其中 48,800-byte PIU 源事件在 accumulator 内保留，`finishRun` 合并后超限并按同一 helper 有界写入，证明 fallback 路径真实被覆盖。

- [x] 2.2 在唯一 record builder/normalizer 中执行最终 `JSON.stringify` UTF-8 byte assertion，确保所有结构化 direct/fallback 路径在 `appendEvent` 前同策；不得修改 gateway contract、record 或 adapter。
  来源：design FN-8.1 `修改方案`
  验证：运行 2.1 的测试命令与 `npm run test:contract`；预期所有捕获到的 gateway record 满足硬上限，contract 无差异。
  执行记录（2026-08-22，Node v22.22.2）：normalizer 对最终 `JSON.stringify` 结果按 UTF-8 bytes 做统一 fit check；全部 contract 测试在允许 loopback 且串行执行时 50 个文件、388 个测试通过，未修改 gateway contract、record 或 adapter。默认并行脚本曾出现一个临时目录清理竞态，单文件 22 个测试与串行全量均通过。

- [x] 2.3 增加 50,000-byte 拒绝型 gateway fixture，验证 Issue #820 的大 PIU/IR 场景不再因可预防容量超限失败，同时验证已合规 record 的真实 append rejection 原样传播。
  来源：FN-8.1；Requirement `结构化增量记录在统一timeline gateway前有界`；Scenarios `50,000-byte拒绝型gateway不会收到超限record`、`真实timeline存储失败继续传播`
  验证：运行 structured-delta persistence integration/contract tests；预期容量场景成功，显式 storage failure 场景 reject。
  执行记录（2026-08-22）：50,000-byte rejection fixture 接受原 Issue 形态的大 PIU/IR 与超大 optional shell，传入 record 均不超过 49,000 bytes；独立 storage failure fixture 仍显式 reject。

## 3. 跨 Function 共享验证

- [x] 3.1 运行全部 structured-delta runtime、channel 与 frontend history 投影测试，并覆盖非结构化事件、Message/Event presentation 选择、legacy fallback、Workflow fragment/completed product、subscriber 防重复、正常显式 flush、run 终止 fallback、同 ID 跨 run、容量边界与 append rejection。
  来源：design `跨 Function 协作与端到端流程`、`验证策略`
  验证：运行受影响 Vitest 文件；预期全部通过且无 snapshot/fixture 未更新。
  执行记录（2026-08-22，最终 rebase `origin/main@21bdf8470`，Node v22.22.2）：structured-delta accumulator、runtime persistence、payload normalization 与 channel projection 加既有 non-structured inline degradation/thinking persistence 共 6 个文件、103 个测试通过；`npm run lint:architecture` 的 54 个文件、321 个测试通过。
  执行记录（2026-08-22，Workflow completed product 补齐）：Workflow projector、persistence policy、Runtime 聚合/截断、Channel 投影和 terminal 负例共 10 个文件、276 个测试通过；新增用例覆盖 50,000-byte 拒绝 gateway、settled canonical append、Workflow identity 和 append rejection。
  执行记录（2026-08-23，Message-first flush 收敛）：Runtime accumulator/persistence/payload、persistence policy、非结构化 inline/thinking、Channel projector 与 Core Workflow/structured 11 个文件、320/320 通过；额外 Core structured/default-agent 3 个文件、53/53 与 release-config Tool Loop 22/22 通过。frontend process-history 与 scheduler 2 个文件、58/58 通过，frontend TypeScript build 通过；首次运行因隔离 worktree 缺前端 `node_modules` 未启动测试，链接主 checkout 同 commit-compatible 依赖后原命令通过。

## 4. 整体验证与归档门禁

- [x] 4.1 使用 Node 22.x 运行根目录 `npm run typecheck`、`npm run build`、`npm test`、`npm run test:contract`、`npm run lint:architecture`，并在 `frontend/agent-web` 运行 `npm run build` 与相关测试。
  来源：全部 Functions；design `验证策略`
  验证：全部命令通过；基线或环境失败必须给出可重复证据且本项保持未勾选。
  执行记录（2026-08-22，最终 rebase `origin/main@21bdf8470`，Node v22.22.2）：`npm run typecheck` 与 `npm run build` 通过；允许 loopback/browser 的标准 `npm test` 通过（171 files passed、1 skipped；2234 tests passed、2 skipped）；标准 `npm run test:contract` 通过（50 files、388 tests）；`npm run lint:architecture` 通过（54 files、321 tests）。
  执行记录（2026-08-22，Workflow completed product 补齐，Node v22.22.2）：`npm run build`（含 typecheck/runtime/workbench build）通过；允许 loopback/browser 的 `npm test` 通过（171 files passed、1 skipped；2236 tests passed、2 skipped）；`npm run test:contract` 通过（50 files、388 tests）；`npm run lint:architecture` 通过（54 files、321 tests）。沙箱内首次运行仅因本机监听与浏览器权限失败，授权环境重跑全绿。
  执行记录（2026-08-23，公共 flush 收敛后，Node v22.22.2）：根目录 `npm run build`（含 typecheck/runtime/workbench）通过；允许 loopback/browser 的 `npm test` 为 171 files passed、1 skipped，2238 tests passed、2 skipped；`TMPDIR=/private/tmp npm run test:contract` 为 50 files、388 tests 全部通过；`npm run lint:architecture` 为 54 files、321 tests 全部通过。macOS 默认临时根下曾在未触达的 Workflow fixture `finally` 清理阶段稳定出现 `ENOTEMPTY .../workspaces`，业务断言 387/388 通过；改用 `/private/tmp` 后同文件 22/22 与完整契约 388/388 可重复通过，未修改无关测试。`frontend/agent-web` build 与 `processHistory`/scheduler 2 files、58 tests 通过。

- [x] 4.2 运行 `openspec validate --all --strict`、`git diff --check`、`$nextagent-skill-review` 与 `$nextagent-code-review`；P0/P1 阻塞 push 与归档。
  来源：全部 Functions；design `验证策略`
  验证：命令通过，两个模型语义审查结论均为 PASS 或无阻塞 follow-up。
  执行记录（2026-08-22，最终 rebase `origin/main@21bdf8470`）：`openspec validate --all --strict` 317 项通过，`git diff --check` 通过；`$nextagent-skill-review` 对修订后的两个 Function、canonical delta operation 与 roadmap 准入结论为 PASS，`需群内确认` 为 `None`。`$nextagent-code-review` 修复了 PIU 固定身份字段丢失和非布尔截断标记投影两项 P1 后，代码范围无剩余 P0/P1，整体 verdict 为 PASS。
  执行记录（2026-08-22，Workflow completed product 补齐）：`openspec validate --all --strict` 312 项通过，`git diff --check` 通过；语义审查确认 FN-5.16/FN-8.1 owner、黑盒验收与唯一 Runtime 实施路径一致，未新增 `agent-contracts` 或群确认项；代码检视确认无 P0/P1，Frozen core contract、Runtime timeline ownership、Owner/Agent Scope、真实 append failure 与 minimal kernel 均未放宽，verdict 为 PASS。
  执行记录（2026-08-23，公共 flush 收敛后）：`openspec validate --all --strict` 312/312、`git diff --check`、NetAgent external dependency interface guard 9/9 通过。`$nextagent-skill-review` 为 `PASS`，公共方法删除的确认已闭环；`$nextagent-code-review` 对 `origin/main` 到当前完整范围及未提交差异检查 Frozen core contract、Runtime/Frontend owner、Message-first 顺序、跨 run/Owner Scope、bounded timeline、Context 非消费、真实 append failure、minimal kernel、安全与 Clean Code，未发现 P0/P1/P2/P3，OpenSpec authoring gate 为 `PASS`，总体 verdict 为 `PASS`。

- [x] 4.3 通过 `$openspec-archive-design-sync` 同步四个 stable specs、FN-1.1、FN-1.2、FN-5.16、FN-8.1、Accepted ADR、相关 architecture/modules、overview 与 spec-to-design-map，确认 active change 与 main 一致后再归档。
  来源：design `长期基线刷新计划`
  验证：先对照 design `并行 active change 协调` 重基已先归档的 delta，再取得归档前同步审查 PASS；`openspec validate --all --strict` 通过，所有实现与验证任务均已据实勾选。
  执行记录（2026-08-23，最终归档）：四份 delta 已同步到 stable specs；FN-1.1、FN-1.2、FN-5.16、FN-8.1、Accepted Message-first ADR、conversation process history、runtime boundaries、stream projection、agent-runtime/agent-web modules、overview、spec-to-design-map 与 roadmap 已按最终实现刷新。归档目录为 `openspec/changes/archive/2026-08-22-persist-structured-delta-aggregation`（CLI 使用 UTC 日期）；未新增 Feature、Function、replacement public contract、event type、store/table 或配置，方案二只保留 carrier 退出条件，#823 仍为后续独立前置。
  归档后验证（2026-08-23，Node v22.22.2）：`openspec validate --all --strict` 311/311、`git diff --check`、structured-delta/runtime/channel 4 files 101/101、architecture 54 files 321/321、根 build、根 tests 171 files passed + 1 skipped（2238 passed + 2 skipped）、contract 50 files 388/388、frontend build 与 process-history 2 files 58/58 全部通过。最终 `$nextagent-skill-review` 与 `$nextagent-code-review` 复核 stable merge、Function 1:1、Message semantic owner、过渡 Event 退出条件、Workflow/terminal 例外、Owner/Agent Scope 和无 public contract 扩张，结论均为 `PASS`，无 P0/P1/P2/P3 或剩余群确认项。
