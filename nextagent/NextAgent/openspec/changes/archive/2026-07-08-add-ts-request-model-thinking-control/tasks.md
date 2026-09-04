## 1. 对外请求与 runtime carry

- [x] 1.1 为 submit Web API 增加受限 `modelOptions.thinking.depth="OFF"` schema，并把该字段规范化为 runtime-owned `requestModelOptions`
  验证：`vitest run packages/agent-channel-web/tests/routing-constraints-schema.test.ts packages/agent-channel-web/tests/request-model-options-schema.test.ts`
  来源：`ts-minimal-agent-kernel` / `Web Submit Stream And History`；design 决策 1、2
- [x] 1.2 在 `agent-contracts/runtime` 与 `agent-runtime` 中增加 `RequestModelOptions` carry，并覆盖 submit accepted context、idempotency semantic 与 root USER message metadata 持久化
  验证：`vitest run packages/agent-runtime/tests/request-model-options-carry.test.ts`
  来源：`ts-core-contracts` / `Runtime owns request-carried ModelOptions contract`；design 决策 2、3
- [x] 1.3 增加 negative verification，确认 submit body 中未授权 model override 字段与非 `OFF` thinking depth 在 channel/runtime 边界 fail closed
  验证：`vitest run packages/agent-channel-web/tests/request-model-options-schema.test.ts`
  来源：`ts-core-contracts` / `RequestModelOptions fields are minimal and safe`；`ts-minimal-agent-kernel` / `Web Submit Stream And History`

## 2. 生效链路与恢复一致性

- [x] 2.1 在 `agent-core` 的 model request flatten path 中把 `requestModelOptions` 叠加到当前 effective `rendered.modelOptions`，仅影响当前请求
  验证：`vitest run packages/agent-core/tests/model-request-builder.test.ts`
  来源：design 决策 4；proposal scope “只作用当前请求”
- [x] 2.2 让 retry/recovery 从持久化请求事实恢复 `requestModelOptions`，并补 characterization tests 防止关闭 think 在重试或恢复时回退默认值
  验证：`vitest run packages/agent-runtime/tests/request-model-options-retry-recovery.test.ts`
  来源：`ts-core-contracts` / `Runtime owns request-carried ModelOptions contract`；design 决策 3
- [x] 2.3 在 OpenRouter adapter 中把 `thinking.depth="OFF"` 映射为 provider-native reasoning disable，并补 outbound request 断言
  验证：`vitest run packages/agent-model/tests/openrouter-provider.test.ts`
  来源：`model-provider-adapter` / `Provider adapter consumes reviewed invocation inputs`；design 决策 5

## 3. 验证和收尾

- [x] 3.1 运行本 change 相关测试与 OpenSpec 校验，确认 schema、runtime carry、retry/recovery、provider mapping 全部通过
  验证：`vitest run packages/agent-channel-web/tests/request-model-options-schema.test.ts packages/agent-runtime/tests/request-model-options-carry.test.ts packages/agent-runtime/tests/request-model-options-retry-recovery.test.ts packages/agent-core/tests/model-request-builder.test.ts packages/agent-model/tests/openrouter-provider.test.ts && openspec validate add-ts-request-model-thinking-control --strict`
  来源：design / Verification Map T1-T6
- [x] 3.2 清理实现产生的重复 helper、临时测试夹具和未使用字段，并确认 change 文档与代码收敛到同一接口形状
  验证：`npm run lint:architecture`；code review 检查点：不存在平行 `enableThinking` 顶层字段，不存在 provider-specific 外露 API
  来源：proposal scope；design 决策 1、2、5

## 归档前更新基线检查（非实施任务）

- 归档前将本 change 的稳定行为同步到 `openspec/specs/ts-minimal-agent-kernel/spec.md`、`openspec/specs/ts-core-contracts/spec.md`、`openspec/specs/model-provider-adapter/spec.md`。
- 归档前按 design 提炼长期设计到 `openspec/designs/modules/agent-channel-web.md`、`openspec/designs/modules/agent-model.md`，并更新 `openspec/designs/spec-to-design-map.md`。
