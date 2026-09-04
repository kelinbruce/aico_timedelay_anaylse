## 1. `FN-7.1 输出结构化日志`

- [x] 1.1 为 Tool payload 关联、Model payload 和通用执行异常建立目标行为测试，并在实现前确认当前代码分别丢失 `stepId`、不产生日志或缺少 raw 根因
  来源：`FN-7.1` + `Runtime log helpers are safe, diagnostic, and non-fatal` + `Tool payload 保留定位内容`、`Model payload 去除 SYSTEM 后可定位`；`本地 runtime 执行异常诊断保留受控详细信息` + `Web handler 失败保留根因`
  验证：运行 `npx vitest run --config vitest.config.release.ts packages/agent-log/tests/runtime-logger.test.ts packages/agent-core/tests/run-bound-model-invocation.test.ts packages/agent-app/tests/logging-composition.test.ts`；实现前新增断言必须失败，并记录失败分别指向缺失 step、Model special event 和 raw exception。
  实施记录：2026-08-06 首次运行 46 tests 中 6 项按预期失败，分别证明 exception prompt/credentialRef 误脱敏、Model events 缺失、generic err 无 `rawExceptionData`、Tool payload 无 `stepId`。

- [x] 1.2 在 `RunBoundModelInvocation` 写入唯一 direct Model input/output/failure diagnostics，删除所有 SYSTEM message、对白名单 final result 建立输出，并保持原 Model/timeline 结果和 non-throwing 行为
  来源：`FN-7.1` + `本地模型调用诊断记录可定位输入输出` + `多条 SYSTEM message 全部移除`、`Model final output 可直接定位`；design `FN-7.1 输出结构化日志 / 修改方案`
  验证：运行 `npx vitest run --config vitest.config.release.ts packages/agent-core/tests/run-bound-model-invocation.test.ts`；预期 input 保留非 SYSTEM 顺序和内容，output 保留 content/toolCalls/finishReason/usage/safeError 且没有 reasoning，logger failure 不改变返回、抛出和 terminal event。
  实施记录：2026-08-06 目标组合验证纳入 93 tests，全部通过；另运行 agent-core 35 files/361 tests 全部通过。

- [x] 1.3 在 runtime writer 统一 local special fields、caught exception 自动派生和 trusted step 保留，并移除触达 producer 的重复 exception 展开
  来源：`FN-7.1` + `Runtime writer 使用精确字段分类和 typed marker` + `Generic runtime exception 自动形成原始诊断`、`Observation-derived log 仍保持强隔离`；`正常执行使用单一可关联的安全日志目录` + `复杂 Tool 失败可从同一日志定位`
  验证：运行 `npx vitest run --config vitest.config.release.ts packages/agent-log/tests/runtime-logger.test.ts packages/agent-app/tests/logging-composition.test.ts`；预期 direct Tool/Model/exception entries 保留可信坐标与有界原始值，真实复杂 Model input 不退化为 `entry_too_large`，observation-derived entry 不含 special fields，sink failure 不改变执行结果。
  实施记录：2026-08-06 相关 7 files/93 tests 全部通过；composition 中含 18 个 Tool descriptors 的 `modelInput` 保留，不再输出 `entry_too_large`。

- [x] 1.4 原子迁移 `runtime-execution-exception-diagnostics` 三项 Requirements 到 canonical `runtime-logging` 并同步直接引用，使旧 spec 归档后可安全退役
  来源：design `存量 Requirement 迁移方案`；`FN-7.1` 的三项来源 `REMOVED` 与目标 `ADDED/MODIFIED`
  验证：运行 `openspec validate refine-local-runtime-diagnostic-visibility --strict` 和 `rg -n "runtime-execution-exception-diagnostics" openspec/changes --glob "*.md"`；预期 change 合法，除本 change 的迁移说明和历史 archive 外没有在途行为引用。
  实施记录：2026-08-06 strict validation 通过；搜索结果仅剩本 change 的迁移说明和历史 archive，无其它 active change 行为引用。

- [x] 1.5 同步 `AGENTS.md` 日志技术约束到 canonical OpenSpec，删除模型内容全面禁止与 prompt exception 脱敏的旧治理规则
  来源：proposal `影响范围`；design `FN-7.1 输出结构化日志 / 修改方案`
  验证：运行 `rg -n "Tool 执行的 normal|modelInput|modelOutput|rawExceptionData" AGENTS.md`；预期只存在与 `runtime-logging` 一致的 local special fields、窄 credential/token 脱敏和 external 禁止扩散规则。
  实施记录：2026-08-06 搜索命中唯一目标规则，已包含五个 special fields、SYSTEM/reasoning 排除和 external 禁止扩散。

- [x] 1.6 补齐真实 Tool producer 的 step 关联并从 `toolOutput` 排除 `generatedMessages` 正文
  来源：`FN-7.1` + `Tool payload 保留定位内容`；design `FN-7.1 输出结构化日志 / 修改方案`
  验证：运行 `npx vitest run --config vitest.config.release.ts packages/agent-core/tests/parallel-tool-loop.test.ts`；真实 Tool loop entry 必须含 `stepId=turn-${round + 1}`、完整 structured output、generated message count/kinds，且不得含 `generatedMessages`。
  实施记录：2026-08-06 产品 Tool loop 黑盒测试通过，`tool.payload.captured` 使用 `stepId=turn-1`，保留 structured output 与 generated message count/kinds，未输出 `generatedMessages` 正文。

- [x] 1.7 补齐 pending-input timeout scan 的 caught exception 提交
  来源：`FN-7.1` + `本地 runtime 执行异常诊断保留受控详细信息` + `Runtime maintenance failure 保留根因`
  验证：运行 `npx vitest run --config vitest.config.release.ts tests/agent-kernel/session-lane-scheduling.test.ts`；timeout scan failure entry 必须提交原始 `err`，且 retry/backoff 行为不变。
  实施记录：2026-08-06 timeout scan characterization test 通过，failure entry 提交 caught `err`，原 1 秒 backoff 与第二次查询行为保持不变。

- [x] 1.8 以目标行为测试证明 `modelInput` 仅保留非 SYSTEM `messages`，并确认当前 producer 或 writer 仍会输出 Tool descriptors、`modelId` 或模型调用选项
  来源：`FN-7.1` + `本地模型调用诊断记录可定位输入输出` + `Model input 仅保留 messages`；`Runtime writer 使用精确字段分类和 typed marker`
  验证：运行 `npx vitest run --config vitest.config.release.ts packages/agent-core/tests/run-bound-model-invocation.test.ts packages/agent-log/tests/runtime-logger.test.ts packages/agent-app/tests/logging-composition.test.ts`；实现前新增断言必须因 `modelInput` 仍含非 `messages` 字段而失败。
  实施记录：2026-08-06 首次运行 3 files/52 tests 中 4 项按预期失败；producer 暴露 `modelId`、`tools`、timeout/window/retry/sampling 选项，writer 暴露手工注入的 `tools` 和 `providerOptions`。

- [x] 1.9 收敛 Model input producer 和 runtime writer 的 `modelInput` 白名单，并保持顶层关联字段和实际 Model request 不变
  来源：`FN-7.1` + `本地模型调用诊断记录可定位输入输出` + `Model input 仅保留 messages`；design `FN-7.1 输出结构化日志 / 修改方案`
  验证：运行 tasks 1.8 的聚焦测试；预期所有 local `modelInput` 恰好只含非 SYSTEM `messages`，writer 对调用方额外传入的 Tool descriptors、`modelId` 和模型调用选项 failed closed，顶层 run/step/model 关联字段仍存在。
  实施记录：2026-08-06 聚焦组合 3 files/52 tests 全部通过；producer 和 writer 均只输出 `messages`，顶层 `stepId` 等关联字段仍由原路径保留。

- [x] 1.10 为默认 info 降噪建立黑盒测试，覆盖 HTTP 单 final record、owner check 成功/失败级别和连续 Skill source unavailable 去重，并确认当前实现失败
  来源：`FN-7.1` + `正常执行使用单一可关联的安全日志目录` + `HTTP 请求只保留 final access record`、`Owner scope 成功检查下沉 debug`、`Owner scope 失败保留 warn`、`Skill source 持续不可用只记录一次`、`Skill source 恢复后允许新的不可用诊断`
  验证：运行 `npx vitest run --config vitest.config.release.ts packages/agent-log/tests/runtime-logger.test.ts packages/agent-app/tests/logging-composition.test.ts packages/agent-session/tests/session-delete-service.test.ts packages/agent-capability/tests/local-skill-source.test.ts`；实现前新增断言必须分别因 incoming request、成功 owner check 为 info 或相同 source warn 重复而失败。
  实施记录：2026-08-06 首次运行 4 files/66 tests 中 5 项按预期失败，分别证明 Fastify incoming 仍落盘、owner check 成功和失败均为 info 且失败无 reason code、连续 source unavailable 重复 warn。

- [x] 1.11 在既有 access writer、session owner check 和 Local Skill discovery owner 上实施固定降噪规则，不改变 lifecycle、readiness evidence、安全拒绝或 HTTP metric owner
  来源：`FN-7.1` + `正常执行使用单一可关联的安全日志目录`；design `FN-7.1 输出结构化日志 / 修改方案`
  验证：运行 task 1.10 的聚焦测试；预期每请求一个 final access、成功 owner check 为 debug、失败为带 code 的 warn、连续 unavailable 一次 warn，Hook/lifecycle 与主流程行为不变。
  实施记录：2026-08-06 聚焦组合 4 files/66 tests 全部通过；物理日志不再接收 incoming，final access 保留；owner success/debug 与 mismatch/warn 分流；同一 discovery 实例持续 unavailable 去重且成功读取后可重新告警。

- [x] 1.12 以真实日志发现建立二次降噪黑盒测试，覆盖 final access endpoint、trace/Hook level、Tool 单摘要和 terminal 紧凑字段，并确认当前实现失败
  来源：`FN-7.1` + `正常执行使用单一可关联的安全日志目录` + `HTTP 请求只保留 final access record`、`成功纯观察 Hook 与 trace confirmation 下沉 debug`、`成功 terminal 只保留独立诊断事实`；`Runtime log helpers are safe, diagnostic, and non-fatal` + `Tool payload 保留定位内容`
  验证：运行 `npx vitest run --config vitest.config.release.ts packages/agent-log/tests/runtime-logger.test.ts packages/agent-app/tests/logging-composition.test.ts packages/agent-observability/tests/structured-log-projector.test.ts packages/agent-observability/tests/trace-projector.test.ts packages/agent-core/tests/parallel-tool-loop.test.ts tests/agent-kernel/capability-governance.test.ts`；实现前新增断言必须分别因 final 缺 method/route、成功 trace/纯观察 Hook 仍为 info、Tool 双摘要或 terminal 重复字段而失败。
  实施记录：2026-08-06 新增目标断言均按预期失败，分别证明 final 无 endpoint、成功 trace/纯观察 Hook 仍为 info、direct Tool 同时含 preview/summary、完整 terminal 仍输出 COMPLETE 和成功别名；组合运行同时暴露全局 logger binding 的既有跨文件互扰，后续按文件隔离复验。

- [x] 1.13 在既有 writer/projector/Tool owner 上实施固定字段与级别收敛，不改变 HTTP metric、Hook contract、trace export、Tool 结果或 terminal summary 完整性判定
  来源：`FN-7.1` + `正常执行使用单一可关联的安全日志目录`、`Runtime log helpers are safe, diagnostic, and non-fatal`；design `FN-7.1 输出结构化日志 / 修改方案`
  验证：运行 task 1.12 聚焦组合；预期 final access 单条且含安全 endpoint，纯观察成功 confirmation 只到 debug，failure/impact Hook 不降级，Tool local entry 只有一个 safe summary，完整 terminal 省略同义字段而 partial 标记保留。
  实施记录：2026-08-06 相关 writer/app/projector/Tool 组合 5 files/92 tests 全部通过；capability governance 中本次 Tool raw input/output 两项用例单独运行通过。Fastify final access 通过同一 native request logger 的 metadata-only binding 保留可信 method/route，未保存 raw URL 或新增 access event。

- [x] 1.14 以重新构造的异常日志建立目标行为测试，覆盖 Tool failure step 保留和常见 Model Tool 协议嵌套，并确认当前 writer 分别丢失 `stepId` 和提前截断 arguments/result
  来源：`FN-7.1` + `Runtime writer 使用精确字段分类和 typed marker` + `Tool failure diagnostic 保留可信 step`、`Model input 保留常见 Tool 协议嵌套`
  验证：运行 `npx vitest run --config vitest.config.release.ts packages/agent-log/tests/runtime-logger.test.ts packages/agent-core/tests/parallel-tool-loop.test.ts packages/agent-app/tests/logging-composition.test.ts`；实现前新增断言必须分别因 failure event 的 reserved step 被移除和 special field depth 被外层 envelope 消耗而失败。
  实施记录：2026-08-06 实现前组合 3 files/63 tests 中 3 项失败；writer 输出的 `tool.call.failed` 缺失 `stepId`，canonical `content[].toolCall.arguments` 被替换为 `value_truncated`，producer 自身的 Tool failure step 断言通过。

- [x] 1.15 在 runtime writer 统一放行同类 Tool failure event 的可信 step，并从 special field 根值独立计算 6 层预算，不改变 generic/observation policy
  来源：task 1.14；design `FN-7.1 输出结构化日志 / 修改方案`
  验证：运行 task 1.14 的聚焦组合；预期 Tool 失败 entry 保留 owner 提交的 `stepId`，canonical Model Tool call arguments/result 在预算内保持原值，真正超深值仍有 marker，observation-derived entry 仍拒绝 special field。
  实施记录：2026-08-06 聚焦组合 3 files/63 tests 全部通过；三类 Tool failure event 统一保留可信 step，五个 special field 从各自根值独立计算深度，真实 app composition failure entry 保留 `turn-1`。

- [x] 1.16 为 Model terminal summary 建立失败测试，覆盖 completed、safe failure final、throw-before-result、delta-first feedback、final-only feedback、empty feedback 和 usage 缺失
  来源：`FN-7.1` + `正常执行使用单一可关联的安全日志目录` + `Model 完成摘要同时给出 usage 和时延`、`仅在 final result 首次形成反馈`、`Model 没有反馈或 usage 不可用`、`Model 失败摘要保留实际可得事实`
  验证：运行 `npx vitest run --config vitest.config.release.ts packages/agent-core/tests/run-bound-model-invocation.test.ts packages/agent-core/tests/timeline-safe-payload-schemas.test.ts packages/agent-observability/tests/timeline-observation-mapper.test.ts packages/agent-observability/tests/structured-log-projector.test.ts packages/agent-observability/tests/observation-timing-redaction.test.ts packages/agent-app/tests/logging-composition.test.ts`；实现前新增断言必须因 terminal entry 缺失 run-bound timing 或 failed usage 而失败。
  实施记录：2026-08-06 实现前 5 files/59 tests 中 8 项按预期失败，分别证明 completed/failed terminal payload、safe schema、mapper、redaction 和 structured projector 尚未形成自包含 timing。

- [x] 1.17 在 `RunBoundModelInvocation` 以 monotonic clock 计量统一 timing，并把已有 usage 与 timing 写入既有 completed/failed safe timeline payload
  来源：task 1.16；design `FN-7.1 输出结构化日志 / 修改方案`
  验证：运行 task 1.16 的聚焦测试；实际 Model terminal producer 必须始终写入 `durationMs`，只在存在反馈时写入 `firstContentLatencyMs`，只在 normalized final result 已提供时写入 usage，且 direct `model.payload.output_captured` 不复制 timing。
  实施记录：2026-08-06 run-bound owner 在 started event 后使用 monotonic clock；delta-first、final-only、empty、safe failure 和 thrown failure 用例通过，direct output 不包含 timing。

- [x] 1.18 通过既有 timeline mapper、observation sanitizer 和 structured log projector 投影 Model terminal timing，不改变 first-visible milestone 或 public contract
  来源：task 1.16；`FN-7.1` + `正常执行使用单一可关联的安全日志目录`；`FN-6.7` + `Redaction is enforced by the shared observation boundary`
  验证：运行 task 1.16 的聚焦测试；completed/failed structured entry 必须在同一顶层保留有效 usage、`durationMs`、`firstContentLatencyMs`，非法或越界的首次反馈时延必须 failed closed。
  实施记录：2026-08-06 聚焦组合最终 6 files/66 tests 全部通过；真实 app composition 的每条 Model completed entry 同时包含已有 usage 和两个 timing 字段，未新增 event 或 `agent-contracts` 字段。

## 2. `FN-6.7 脱敏`

- [x] 2.1 先增加 narrow credential/token 的正反向测试，覆盖真实 credential 清除、prompt/path/command/business content 保留及 `credentialRef`、`credentialStatus`、usage/tokenCount/tokenLength/tokenization 不误伤，并确认当前 exception sanitizer 失败
  来源：`FN-6.7` + `Redaction is enforced by the shared observation boundary` + `Local runtime diagnostic 使用独立受控策略`；`FN-7.1` + `Runtime writer 使用精确字段分类和 typed marker` + `Safe diagnostic names 不被 token 子串误伤`
  验证：运行 `npx vitest run --config vitest.config.release.ts packages/agent-common/tests/agent-error.test.ts packages/agent-log/tests/runtime-logger.test.ts`；实现前新增断言必须因 prompt/credentialRef 误脱敏或 root cause 不完整而失败。
  实施记录：2026-08-06 首次运行确认 prompt、credentialRef、credentialStatus 被旧规则误脱敏，新增正反向断言失败符合预期。

- [x] 2.2 统一 Tool、Model 和 exception special field 的精确 credential/token matcher，保留 generic observation 强裁剪且不新增配置
  来源：`FN-6.7` + `Redaction is enforced by the shared observation boundary` + `Local runtime diagnostic 使用独立受控策略`、`debug mode still hands off sanitized observations only`；design `FN-6.7 脱敏 / 修改方案`
  验证：运行 `npx vitest run --config vitest.config.release.ts packages/agent-common/tests/agent-error.test.ts packages/agent-log/tests/runtime-logger.test.ts`；预期 local 正反向矩阵通过，observation/debug 负向用例继续拒绝 prompt/output/stack/path/special fields。
  实施记录：2026-08-06 相关目标组合验证全部通过，credential/token 清除与正常 token 统计字段保留同时成立。

- [x] 2.3 为 inline credential assignment 增加命令语法保持测试，并确认当前 matcher 会吞掉闭合引号或后续参数分隔符
  来源：`FN-6.7` + `Redaction is enforced by the shared observation boundary` + `Inline credential 脱敏保留命令语法`
  验证：运行 `npx vitest run --config vitest.config.release.ts packages/agent-log/tests/runtime-logger.test.ts`；实现前断言必须因输出缺失闭合引号或 `&` 分隔符而失败。
  实施记录：2026-08-06 实现前 agent-log 37 tests 中目标用例失败，`appsecret=dummy-secret&mode=check"` 被错误收敛为 `appsecret=<redacted:credential>`，闭合引号和后续参数均丢失。

- [x] 2.4 收窄 local special field 的 inline credential value 边界，保留命令引号和参数分隔符且继续清除 credential
  来源：task 2.3；design `FN-6.7 脱敏 / 修改方案`
  验证：运行 task 2.3 的聚焦测试；预期 credential 原值不可见，闭合引号、`&` 和后续普通参数完整保留，generic observation policy 不变。
  实施记录：2026-08-06 agent-log 37 tests 及跨 package 聚焦组合全部通过；credential value 不可见，输出保留 `&mode=check"`，observation special-field 隔离测试保持通过。

- [x] 2.5 为 observation-derived `firstContentLatencyMs` 增加正反向边界测试，并保持 local special fields 与 external surface 隔离
  来源：`FN-6.7` + `Redaction is enforced by the shared observation boundary`；task 1.18
  验证：运行 `npx vitest run --config vitest.config.release.ts packages/agent-observability/tests/observation-timing-redaction.test.ts packages/agent-observability/tests/structured-log-projector.test.ts`；合法 Model terminal timing 保留，负数、非有限值、晚于总时延或非 Model terminal timing 被拒绝或省略。
  实施记录：2026-08-06 redaction/projector 2 files/29 tests 全部通过；合法 Model terminal timing 保留，负数、Infinity、晚于总时延和非 terminal 使用均被拒绝。

## 3. 跨 Function 集成与验证

- [x] 3.1 通过 app composition 复现 Model→Tool→failure 与 Web handler unknown exception，证明同一 operational destination 可定位且客户端/observation surface 保持安全
  来源：`FN-7.1` + `正常执行使用单一可关联的安全日志目录` + `复杂 Tool 失败可从同一日志定位`、`对外轨迹保持安全`；`FN-6.7` + `Redaction is enforced by the shared observation boundary`；design `跨 Function 协作与端到端流程`
  验证：运行 `npx vitest run --config vitest.config.release.ts packages/agent-app/tests/logging-composition.test.ts packages/agent-channel-web/tests/multipart-request-routes.test.ts`；预期 local entries 有 raw 根因和 run/step/invocation 坐标，对外 response/observation 不含原始字段。
  实施记录：2026-08-06 composition、Web 与相关 writer 测试纳入 7 files/93 tests，全部通过；服务端 SafeError 测试继续只返回安全消息。

- [x] 3.2 完成 change 与仓库门禁，确保 contracts、架构、minimal kernel 和现有 Tool/Model/terminal 路径无回归
  来源：proposal `影响范围`；design `验证策略`
  验证：运行 `npm run build`、`npm test`、`npm run test:contract`、`npm run lint:architecture`、`openspec validate --all --strict`；预期全部退出码为 0。
  实施记录：2026-08-06 全部门禁退出码为 0：build/typecheck/web build 通过，常规 144 files/1621 tests、contract 44 files/357 tests、architecture 45 files/280 tests、OpenSpec 278 items 全部通过。Architecture 首轮发现既有裸字符串扫描误伤注释，已收敛为精确 package import regex 后复验通过。

- [x] 3.3 复验补充的真实 Tool/error 产品路径和 strict OpenSpec
  来源：tasks 1.6、1.7
  验证：运行对应聚焦测试与 `openspec validate refine-local-runtime-diagnostic-visibility --strict`，确认任务记录与代码事实一致。
  实施记录：2026-08-06 聚焦组合 2 files/66 tests 通过，strict OpenSpec validation 退出码为 0。

- [x] 3.4 复验 `modelInput` 白名单收敛后的仓库门禁
  来源：`FN-7.1` + `本地模型调用诊断记录可定位输入输出`；proposal `影响范围`
  验证：运行 `npm run build`、`npm test`、`npm run test:contract`、`npm run lint:architecture`、`openspec validate --all --strict`；预期全部退出码为 0。
  实施记录：2026-08-06 全部门禁退出码为 0：build/typecheck/web build 通过，常规 144 files/1635 tests、contract 44 files/357 tests、architecture 45 files/281 tests、OpenSpec 280 items 全部通过。

- [x] 3.5 复验默认 info 降噪后的仓库门禁
  来源：`FN-7.1` + `正常执行使用单一可关联的安全日志目录`；proposal `影响范围`
  验证：运行 `npm run build`、`npm test`、`npm run test:contract`、`npm run lint:architecture`、`openspec validate --all --strict`；预期全部退出码为 0。
  实施记录：2026-08-06 全部门禁退出码为 0：build/typecheck/web build 通过，常规 144 files/1631 tests、contract 44 files/357 tests、architecture 45 files/281 tests、OpenSpec 279 items 全部通过。

- [x] 3.6 复验二次打印范围收敛后的仓库门禁
  来源：tasks 1.12、1.13；proposal `影响范围`
  验证：运行 `npm run build`、`npm test`、`npm run test:contract`、`npm run lint:architecture`、`openspec validate --all --strict`；预期全部退出码为 0。
  实施记录：2026-08-06 全部门禁退出码为 0：build/typecheck/runtime/web build 通过，常规 144 files/1633 tests、contract 44 files/357 tests、architecture 45 files/281 tests、OpenSpec 279 items 全部通过。

- [x] 3.7 复验异常场景日志补强后的聚焦测试、语义检视与仓库门禁
  来源：tasks 1.14、1.15、2.3、2.4；proposal `影响范围`
  验证：运行聚焦测试、`npm run build`、`npm test`、`npm run test:contract`、`npm run lint:architecture`、`openspec validate --all --strict`；预期全部退出码为 0，且检视结论无 P0/P1。
  实施记录：2026-08-06 聚焦 3 files/63 tests、build/typecheck/runtime/web build、常规 147 files/1707 tests、contract 44 files/357 tests、architecture 46 files/290 tests、OpenSpec 283 items 全部通过。OpenSpec 与最终 diff 语义检视结论均为 PASS，无 P0/P1；实现未修改错误分类、runtime lifecycle、public contract 或 external surface。

- [x] 3.8 复验 Model terminal summary 刷新后的聚焦测试、语义检视与仓库门禁
  来源：tasks 1.16、1.17、1.18、2.5；proposal `影响范围`
  验证：运行聚焦测试、`npm run build`、`npm test`、`npm run test:contract`、`npm run lint:architecture`、`openspec validate --all --strict`；预期全部退出码为 0，且检视结论无 P0/P1。
  实施记录：2026-08-06 聚焦 6 files/66 tests、build/typecheck/runtime/web build、常规 148 files/1713 tests、contract 44 files/357 tests、architecture 46 files/290 tests、OpenSpec 283 items 全部通过。OpenSpec skill review 与最终 NextAgent code review 结论均为 PASS，无 P0/P1；frozen/public contract、runtime lifecycle、first-visible milestone 和 external raw-content boundary 均未改变。

## 归档前更新基线检查（非实施任务）

归档时按 design 的“长期基线刷新计划”同步 stable specs、Functions、Features、overview、architecture、modules 和 spec-to-design-map；确认 `runtime-execution-exception-diagnostics` 已清空且没有并行 active change 引用后退役，不创建 ADR。
