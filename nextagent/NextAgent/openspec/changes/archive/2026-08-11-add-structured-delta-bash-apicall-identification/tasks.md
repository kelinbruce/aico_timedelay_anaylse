## 1. 共享结构识别模块

- [x] 1.1 创建 `packages/agent-core/src/tools/structured-delta-identification.ts`，导出 `isStructuredEvent`（复用 `TOOL_EVENT_TYPES`/`TOOL_MESSAGE_TYPES`）、`unwrapStructuredEnvelope`（信封解包纯函数）、`identifyStructuredDelta`（统一形状检测：先试直接再试信封）、`tryEmitStructuredDelta`（候选→识别→安全检查→emit）、`emitStructuredDeltaData`（已识别数据→安全检查→emit）、`StructuredDeltaData` 接口。
  验证：TypeScript 编译通过，纯函数无副作用。
  满足：Requirement "Structured Event Shape Validation"。

- [x] 1.2 单元测试 `packages/agent-core/tests/structured-delta-identification.test.ts` 覆盖：`identifyStructuredDelta` 直接/信封/非结构/fallback；`tryEmitStructuredDelta` emit/fallback/sensitive。
  验证：`vitest run packages/agent-core/tests/structured-delta-identification.test.ts` 全通过。
  满足：Requirement "Structured Event Shape Validation"。

## 2. Bash 结构识别扩展（直接 + 信封）

- [x] 2.1 重构 `extractClipcStructuredEvent` 为：预检 + `JSON.parse(stdout)` → `identifyStructuredDelta(candidate)`。去掉硬编码子串检测。
  验证：tool-structured-delta-emission.test.ts Bash 信封场景不回归。
  满足：Requirement "Bash Structured Delta Identification"。

- [x] 2.2 测试：Bash stdout 为直接三元组 JSON 时 emit `TOOL_STRUCTURED_DELTA`。
  验证：tool-structured-delta-emission.test.ts 断言 event 被 emit。
  满足：Requirement "Bash Structured Delta Identification" direct shape。

- [x] 2.3 测试：Bash 信封形状不回归，fallback 场景（非 JSON、非零 exitCode、truncated、status!=ok、malformed raw）不触发。
  验证：tool-structured-delta-emission.test.ts 全通过。
  满足：Requirement "Bash Structured Delta Identification" fallback。

## 3. ApiCall 编排层接入（非流式 + 流式）

- [x] 3.1 在 `default-agent.ts` 的 ApiCall `capabilityInvocation.invoke()` 调用后，对 `apiResult.structuredPayload` 调 `tryEmitStructuredDelta` 做非流式终态检测。
  验证：TypeScript 编译通过。
  满足：Requirement "ApiCall Structured Delta Identification" non-streaming。

- [x] 3.2 在 `default-agent.ts` 传 `runtimeContext.emitResultDelta` 回调，对每个 `chunk.data` 做 `JSON.parse` → `tryEmitStructuredDelta` 流式逐块检测。
  验证：TypeScript 编译通过。
  满足：Requirement "ApiCall Structured Delta Identification" streaming。

## 4. tool-loop.ts 瘦身与清理

- [x] 4.1 从 `tool-loop.ts` 移除重复定义：`clipStructuredEventTypes`/`clipStructuredMessageTypes`（改用 common 常量）、`isClipStructuredEvent`（被 `isStructuredEvent` 替代）、`unwrapStructuredEnvelope`/`identifyStructuredDelta`（移到模块）、`tryEmitApiCallStreamStructuredDelta`（编排层接管）、`apiCallCapabilityId`（不走 tool-loop）、`hasSensitiveStructuredContent` import（不再直接使用）。
  验证：TypeScript 编译通过，无 dead code。
  满足：Clean Code 原则。

- [x] 4.2 重构 `tryEmitToolStructuredDelta`：CLIP/Bash 候选提取后调 `emitStructuredDeltaData` 共享 emit，消除重复 emit 逻辑。
  验证：tool-structured-delta-emission.test.ts CLIP/Bash 场景不回归。
  满足：KISS/Clean Code。

## 5. 白名单边界与安全

- [x] 5.1 测试：白名单外工具（Read/Write/Skill 等）不 emit `TOOL_STRUCTURED_DELTA`。已有 CLIP non-CLIP-provider 测试覆盖。
  验证：tool-structured-delta-emission.test.ts 断言无 event。
  满足：Requirement "Non-CLIP results never emit TOOL_STRUCTURED_DELTA"。

- [x] 5.2 测试：Bash 和 ApiCall 的敏感内容不 emit。Bash 覆盖在 emission 测试，ApiCall 覆盖在模块单元测试。
  验证：两个测试文件均断言 sensitive 不 emit。
  满足：Requirement "Security Constraints"。

- [x] 5.3 确认无需修改 `runTimelineEventPersistencePolicy`：无 `workflowEventType`，自动 LIVE_ONLY。
  验证：代码审查确认 policy 不变。
  满足：Design "Non-Goals"。

## 6. 验证和审查

- [x] 6.1 运行 `npm run build`、`npm test`、`npm run lint:architecture`。全量门禁通过（contract 4 failed 为 main 既有，与本 change 无关）。
  验证：build ✓、test 1266 passed ✓、lint:architecture 255 passed ✓。
  满足：AGENTS.md 验证门禁。

- [x] 6.2 通过 openspec strict 验证。
  验证：`openspec validate add-structured-delta-bash-apicall-identification --strict` 通过。
  满足：AGENTS.md OpenSpec 验证。

- [x] 6.3 运行 `$nextagent-code-review` 检视提交范围，确认架构边界、安全、Clean Code 无 P0/P1 问题。
  验证：检视结论 PASS。
  满足：AGENTS.md Push 门禁。

## 归档前更新基线检查（非实施任务）

实现完成并验证通过后，按 proposal/design 的归档前更新基线处理：
- `openspec/specs/tool-structured-delta/spec.md`：将 "Non-CLIP results never emit" 约束更新为白名单（Bash + ApiCall）；新增 "Bash Structured Delta Identification"、"ApiCall Structured Delta Identification" requirement；更新 "CLIP Provider Identification" 标注 legacy；更新 "Structured Event Shape Validation" 加入信封形状。
- 不改 `structured-delta-safety.ts`、持久化策略、前端。
