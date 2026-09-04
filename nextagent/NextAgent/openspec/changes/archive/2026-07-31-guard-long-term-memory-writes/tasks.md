<!--
Task 只安排 specs/design 已定义的工作，不建立新行为或新设计。
- 每个 checkbox 只对应一个可独立验收结果；可被部分完成时必须拆分。
- 新增或修改可观察行为时先编写失败测试，再实现并验证通过。
- 勾选 task 前记录实际命令和结果；验证未通过时不得勾选。
-->

## 1. Guardrail 知识校验契约

- [x] 1.1 完成 frozen `GuardrailGatewayPort` 变更的群内确认，确认新增 `checkKnowledge`、`GuardrailCheckKnowledgeInput` 和 `GuardrailCheckKnowledgeResult`，且不修改 `LongTermMemoryStoreGateway`、Web DTO、stream event 或 persistence Record。
  来源：proposal“需群内确认”；design“1. 新增 provider-neutral 的知识校验 contract”
  验证：在 change 或 PR 中记录可追溯的群内确认结论；code review 必须确认结论覆盖上述三个 public contract 标识符及不变范围。
  验证记录（2026-07-27）：用户明确回复“已群内确认”；确认范围覆盖上述三个新增 guardrail public contract，且现有长期记忆 ports、Web DTO、stream event 和 persistence Record 保持不变。

- [x] 1.2 为 RobotRouter 知识校验补充先失败的 contract tests，覆盖 1..5 个分片、2000 code point 边界、原序传输、`isPrivacy` 可选映射、仅 JSON Header、精确 string item 归一化、boolean item 拒绝、item 数量不一致、HTTP 400、超时、取消、非法响应和 `detail` 不泄漏；在生产实现前运行并确认新增用例因 `checkKnowledge` 尚不存在而失败。
  来源：Requirement “GuardrailGatewayPort validates knowledge content through RobotRouter”；Scenarios “Up to five knowledge fragments pass in one request”“Privacy option remains caller-selectable”“A blocked fragment blocks the knowledge check”“An inconsistent success response fails closed”“Knowledge check input exceeds its bounded contract”
  验证：运行 `npm run test:contract -- tests/contract/guardrail-gateway-contracts.test.ts`；实现前预期新增知识校验用例失败，既有 question/answer/nl2py 用例继续通过。
  验证记录（2026-07-27）：运行上述命令，15 个用例中既有 5 个通过，新增 10 个均以 `checkKnowledge is not a function` 失败，符合生产实现前的预期失败。

- [x] 1.3 在 `agent-contracts` 与现有 RobotRouter REMOTE guardrail provider 中实现 `checkKnowledge`：沿用现有 `checkXxx(input, signal?)`、独立 Input/Result、camelCase-to-snake_case mapping、`RobotRouterFetch`、provider binding、JSON Header 和 5 秒 timeout 形态，并增加知识校验专属 runtime validation、cancellation 与稳定 SafeError 映射；不得修改三个现有 guardrail 方法，完成后所有知识校验 contract tests 通过，public result 与可观察诊断不包含 provider `detail`、响应体、endpoint、credential 或被检文本。
  来源：Requirement “GuardrailGatewayPort validates knowledge content through RobotRouter”；Scenarios “Up to five knowledge fragments pass in one request”“Privacy option remains caller-selectable”“A blocked fragment blocks the knowledge check”“An inconsistent success response fails closed”“Knowledge check input exceeds its bounded contract”；design“1. 新增 provider-neutral 的知识校验 contract”
  验证：运行 `npm run test:contract -- tests/contract/guardrail-gateway-contracts.test.ts`，预期全部通过；运行 `npm run build`，预期 TypeScript contract 与 adapter 实现编译通过。
  验证记录（2026-07-27）：contract 命令 15/15 通过；`npm run build` 退出码 0，TypeScript build 与 workbench Vite build 均完成。

## 2. 长期记忆写入准入

- [x] 2.1 调整长期记忆写入准入单元测试，使其从 `agent-memory` 包内模块验证精确拼接、Unicode code point 连续分片、2000/2001/6049 边界、每批最多五片、跨批原序、全量重构、`labels` 排除、`isPrivacy=true`、串行遇阻停止、无 binding 兼容、取消和 store exactly-once/not-called；增加负例断言 `LongTermMemoryWriteCoordinator` 与 factory 不从 `@nextagent/agent-memory` public index 导出，且 `agent-app`/channel 不 import 或持有该类型。
  来源：Requirement “Text-bearing long-term memory writes pass knowledge security admission”；相关全部 Scenarios；design“2. `agent-memory` 新增包内统一的写入准入实现”“3. 完整文本分片与批次算法”
  验证：运行 `npx vitest run --config vitest.config.release.ts packages/agent-memory/tests/long-term-memory-write-admission.test.ts` 和 `npm run lint:architecture`，预期包内行为与 public-export/跨包依赖负例全部通过。
  验证记录（2026-07-27）：准入/tool/extraction/management/composition 定向测试 110/110 通过；architecture 38 files/232 tests 通过，public index、app composition 与 channel 均无 coordinator export/import/字段。

- [x] 2.2 将 `LongTermMemoryWriteCoordinator` 与 factory 收敛为 `agent-memory` 包内实现，仅拥有内容准入和写入排序；从 public index 删除导出，不在 `agent-app` composition contract 中出现，并将 guardrail blocked、unavailable、invalid-request 与 canceled 映射为规格定义的 memory SafeError。不得新增 `agent-contracts` memory port 或修改三个现有长期记忆 port。
  来源：Requirement “Text-bearing long-term memory writes pass knowledge security admission”；相关全部 Scenarios；design“2. `agent-memory` 新增包内统一的写入准入实现”“3. 完整文本分片与批次算法”
  验证：运行上述定向准入测试和 `npm run build`，预期包内实现、既有 port 调用签名和 public exports 编译通过，signal 只进入 guardrail。
  验证记录（2026-07-27）：`npm run typecheck` 通过；包内 coordinator 继续复用原 request/write-options，extraction 使用同模块的 narrowed save coordinator，三个现有长期记忆 port 方法签名未改变。

## 3. 三条写入入口统一接线

- [x] 3.1 为 `add_memory` 补充先失败的行为测试，断言 legal 时写入一次，blocked/unavailable/canceled 时返回规定的结构化失败且零写入，并用 canary 断言 capability/model-visible result 和测试可见诊断不泄漏正文、分片或 provider `detail`；在接入写入准入前运行并确认新增用例失败。
  来源：Requirement “add_memory reports knowledge admission failures safely”；Scenarios “add_memory is blocked without a write”“add_memory exposes retryable guardrail unavailability”
  验证：运行 `npx vitest run --config vitest.config.release.ts packages/agent-memory/tests/memory-tools-provider.test.ts`；实现前预期新增知识准入用例失败，既有 memory tool 用例继续通过。
  验证记录（2026-07-27）：定向运行 24 个用例，既有 20 个通过；新增 legal 用例因 `checkKnowledge` 调用数为 0 失败，blocked/unavailable/canceled 三个用例均因仍返回 `SUCCEEDED` 失败，证明 tool port 尚未接入写入准入。

- [x] 3.2 在不修改 `LongTermMemoryToolPort` 方法签名的前提下，让 `createLongTermMemoryToolPort` 的 options 接收可选 `GuardrailGatewayPort`，并在 `agent-memory` 包内创建和调用写入准入实现；删除 app-composed coordinator 参数，沿用已有 signal 控制 guardrail 并保留 search/detail 的既有 owner 与 terminal ownership。
  来源：Requirement “add_memory reports knowledge admission failures safely”；相关 Scenarios；design“4. 三条写入路径共享包内实现”“5. 调用方失败投影”
  验证：运行 `npx vitest run --config vitest.config.release.ts packages/agent-memory/tests/memory-tools-provider.test.ts`，预期全部通过。
  验证记录（2026-07-27）：定向测试集 110/110 通过；tool options 只接收 guardrail，legal、blocked、unavailable、canceled、零写入和 canary 不泄漏行为保持通过。

- [x] 3.3 为自动提取的新 candidate 和 source evidence fusion 写入补充先失败的行为测试，断言本地校验先行、blocked 映射 `CANDIDATE_UNSAFE` 后继续后续 candidate、unavailable 分别聚合为 `PARTIAL`/`FAILED`、取消保留既有结果，且所有失败路径零写入并不泄漏正文或 provider `detail`。
  来源：Requirement “Extraction writes obey long-term memory knowledge admission”；Scenarios “Unsafe extraction candidate is rejected before persistence”“Guardrail outage makes extraction partial”“Guardrail outage prevents every extraction write”
  验证：运行 `npx vitest run --config vitest.config.release.ts packages/agent-memory/tests/memory-extraction.test.ts`；实现前预期新增知识准入用例失败，既有 extraction 用例继续通过。
  验证记录（2026-07-27）：定向运行 46 个用例时，新增 4 个知识准入用例失败、既有 42 个用例通过；失败分别证明 raw extraction 写入尚未处理 blocked、unavailable 与 fusion 准入。随后补充 canceled 保留既有结果用例。

- [x] 3.4 让 extraction scheduler/cycle options 接收可选 `GuardrailGatewayPort`，并在 `agent-memory` 包内让新 candidate 与 source evidence fusion 写入复用统一准入实现；不得接收 app-composed coordinator。沿用已有 deadline signal 控制 guardrail，并保留 list/get/mutate、cycle 聚合和 RequestRun terminal state 的既有 owner。
  来源：Requirement “Extraction writes obey long-term memory knowledge admission”；相关全部 Scenarios；design“4. 三条写入路径共享包内实现”“5. 调用方失败投影”
  验证：运行 `npx vitest run --config vitest.config.release.ts packages/agent-memory/tests/memory-extraction.test.ts`，预期全部通过。
  验证记录（2026-07-27）：定向测试集 110/110 通过；extraction options 只接收 guardrail，新 candidate 与 fusion 在 cycle 内使用包内 save coordinator，聚合与取消语义保持通过。

- [x] 3.5 为长期记忆 management 的 save/manualSave 补充先失败的行为测试，断言两条文本写入都通过 writer，blocked/unavailable/canceled 时沿既有 SafeError/Web 映射返回且零写入，而 read/delete/mutate/publish/copy 不触发知识校验。
  来源：Requirement “Text-bearing long-term memory writes pass knowledge security admission”；Scenarios “A later fragment is blocked”“Guardrail dependency fails closed”“Guardrail binding is absent”“Metadata-only mutation does not invoke knowledge admission”；design“4. 三条写入路径共享包内实现”“5. 调用方失败投影”
  验证：运行 `npx vitest run --config vitest.config.release.ts packages/agent-memory/tests/long-term-memory-management.test.ts` 和 `npm run test:contract -- tests/contract/long-term-memory-management-contract.test.ts`；实现前预期新增知识准入用例失败，既有 management contract 用例继续通过。
  验证记录（2026-07-27）：实现前 management 9 个用例中新增 4 个失败、既有 5 个通过，证明 save/manualSave 尚未使用写入准入；接入后 9/9 通过，management contract 3/3 通过。

- [x] 3.6 在不修改 `LongTermMemoryManagementPort` 方法签名的前提下，让 `createLongTermMemoryManagementService` dependencies 接收可选 `GuardrailGatewayPort`，并在 `agent-memory` 包内让 save/manualSave 使用统一准入实现；`agent-app` 只向 tool、extraction 和 management factories 注入 selected store/guardrail，删除所有 coordinator composition 字段与跨文件传递。沿用 management 已有 signal 控制 guardrail，无 binding 时保留现有写入行为，非文本操作继续使用原 gateways。
  来源：Requirement “Text-bearing long-term memory writes pass knowledge security admission”；Scenarios “Guardrail binding is absent”“Metadata-only mutation does not invoke knowledge admission”；design“4. 三条写入路径共享包内实现”
  验证：运行 `npx vitest run --config vitest.config.release.ts packages/agent-memory/tests/long-term-memory-management.test.ts packages/agent-app/tests/composition.test.ts` 和 `npm run test:contract -- tests/contract/long-term-memory-management-contract.test.ts`，预期全部通过；运行 `npm run lint:architecture`，预期 package 边界与唯一 composition wiring 检查通过。
  验证记录（2026-07-27）：定向测试集 110/110、guardrail/management contract 18/18、architecture 232/232 通过；app 仅注入 selected guardrail，management service 在包内创建 coordinator，非文本操作保持原 gateway。

## 4. 回归与安全门禁

- [x] 4.1 增加架构与安全负例，实际触发并断言 RobotRouter 只能由 REMOTE guardrail adapter 调用、persistence gateway 不依赖 guardrail、`LongTermMemoryWriteCoordinator` 不从 `agent-memory` public index 导出且不被 `agent-app`/channel import、Web/tool/config 不能覆盖 memory 的 `isPrivacy=true`，以及正文、label-only canary、provider `detail` 和 raw response 不进入未授权请求或可观察信号。
  来源：Requirement “GuardrailGatewayPort validates knowledge content through RobotRouter”；Requirement “Text-bearing long-term memory writes pass knowledge security admission”；Requirement “Extraction writes obey long-term memory knowledge admission”；Requirement “add_memory reports knowledge admission failures safely”；design“4. 三条写入路径共享包内实现”“质量属性设计”
  验证：运行 `npm run lint:architecture` 和长期记忆准入、tool、extraction、management 定向测试，预期所有 forbidden-dependency、public-export、现有 port 签名、固定 privacy、label 排除和 canary 不泄漏断言通过。
  验证记录（2026-07-27）：`npm run lint:architecture` 通过 38 files/232 tests；定向 110 tests 继续覆盖固定 privacy、label/正文/detail/raw-response 不泄漏与失败零写入。

- [x] 4.2 执行完整后端与 OpenSpec 回归门禁，确认既有 guardrail question/answer/nl2py、长期记忆 lifecycle、request terminal commit 和 SQLite/REMOTE persistence contract 无回归。
  来源：design“验证策略”
  验证：依次运行 `npm run build`、`npm test`、`npm run test:contract`、`npm run lint:architecture`、`openspec validate --all --strict`；预期全部以退出码 0 完成。
  验证记录（2026-07-27）：`npm run build` 退出码 0；`npm test` 109 files/988 tests 通过；`npm run test:contract` 35 files/311 tests 通过；`npm run lint:architecture` 38 files/232 tests 通过且 dependency-cruiser 无 violation；`openspec validate --all --strict` 242/242 通过。

## 归档前更新基线检查（非实施任务）

实现和验证完成后，归档流程按照 proposal“归档前更新基线”归并长期事实，并检查长期文档没有重复定义同一行为、schema、owner 或接口语义。
