## 1. `FN-4.1 调用模型`：恢复决策与预算

- [x] 1.1 新增 agent-core 私有 output recovery helper，固定 `8x`、`32000 tokens`、最多 3 次续写的边界，并按 usage、context budget evidence 与 context window 计算严格有界的提升预算。
  验证：`npx vitest run packages/agent-core/tests/model-output-recovery.test.ts --config vitest.config.ts` 覆盖 `2048 -> 16384`、未显式配置、剩余窗口不足和不得降低原预算。
  来源：spec requirement“输出超限不得静默截断”；design D1、D2。

- [x] 1.2 在 helper 中构造唯一的 request-local continuation messages 和累计可见文本，保证 assistant 段与隐藏续写指令顺序稳定且不依赖 provider-specific DTO。
  验证：同一聚焦测试断言第二、第三次 continuation request 的 `ModelMessage[]` 精确顺序、角色和文本段。
  来源：spec 的 request-local continuation 约束；design D3。

## 2. `FN-4.1 调用模型`：Agent loop 集成

- [x] 2.1 在 `DefaultAgent` 中识别 text-only `finishReason="length"`，先执行一次同请求预算提升，并确保重试快照替换首次截断候选而不是重复拼接。
  验证：聚焦测试断言两次请求除 `maxOutputTokens` 外保持一致、无 partial terminal commit，最终 `LLM_CONTENT_DELTA` 为完整重试结果。
  来源：spec 的首次预算提升场景；design D2。

- [x] 2.2 集成最多 3 次续写和最终文本拼接，恢复成功后复用既有 terminal path，恢复消息不得写入 session history。
  验证：聚焦测试覆盖第 1 次和第 3 次续写成功，断言单一 terminal assistant message、隐藏指令不在 durable messages 中。
  来源：spec 的三次续写场景；design D3。

- [x] 2.3 对恢复耗尽和任一不安全 Tool call 组合 fail closed，发布稳定 degradation reason code 且 capability invocation count 保持为 0。
  验证：聚焦 negative tests 实际触发第 3 次续写后仍为 `length`、`length + toolCalls`、continuation 返回 Tool call，并断言 safe failure 与零 Tool side effect。
  来源：spec 的恢复耗尽和 Tool call 禁止场景；design D3、D4。

- [x] 2.4 保持 recovery chain 的聚合 visible-output fallback guard、timeout 与 cancellation 传播，取消后不得再发起调用或提交 late output。
  验证：聚焦 characterization tests 使用 `AbortController` 和 retryable safe error，断言调用次数、fallback route 未错误切换及 terminal outcome。
  来源：spec 的取消场景；design D5。

- [x] 2.5 将 direct model 可见文本硬上限调整为 `150000` 个 UTF-16 code unit，每次恢复快照和拼接结果继续在投影前执行容量保护。
  验证：`npx vitest run packages/agent-core/tests/model-output-recovery.test.ts packages/agent-core/tests/budget-degradation-notice.test.ts --config vitest.config.ts` 覆盖恰好等于上限时原样成功且不发布 `MODEL_TEXT_LIMIT_EXCEEDED`。
  来源：spec 的硬字符上限场景；design D6。

- [x] 2.6 超过 direct model 可见文本硬上限时停止当前模型输出，保留不拆分 surrogate pair、带固定截断标记且总长不超过 `150000` 个 UTF-16 code unit 的 provider-neutral 前缀，并通过唯一 terminal commit 完成请求；不得执行未完整 Tool call、fallback 或泄漏超限后缀。
  验证：`npx vitest run packages/agent-core/tests/model-output-recovery.test.ts packages/agent-core/tests/budget-degradation-notice.test.ts --config vitest.config.ts` 与 `npx vitest run tests/agent-kernel/output-guard.test.ts --config vitest.config.release.ts` 覆盖 stream delta 超限、final-only 超限、Markdown 结构闭合、Tool call 不执行、恰好上限不降级、超限后缀不进入 stream/history 和 `REQUEST_COMPLETED`。
  来源：spec Scenario“硬字符上限保留有界内容”“硬字符上限边界不触发降级”；design D6。

## 3. 规格和语义审查

- [x] 3.1 对 change artifacts 执行 `nextagent-skill-review`，修复所有 BLOCKER/HIGH/MEDIUM 问题并取得 PASS。
  验证：审查 `openspec/changes/recover-ts-model-output-token-limit/`，记录 change id、日期、约束对齐、完整性和最终 PASS。
  来源：AGENTS.md OpenSpec authoring gate；design 验证映射。

- [x] 3.2 确认实现未修改 `agent-contracts`、provider stream-normalizer、thinking/reasoning 行为、默认 model profile 或 Web stream schema。
  验证：`git diff --name-only origin/main...HEAD` 与语义 code review 检查点；无法仅靠测试证明范围，因此必须人工核对 diff 中不存在上述路径和行为。
  来源：proposal 非目标；design Goals / Non-Goals、D1。

## 4. 验证与提交

- [x] 4.1 运行 backend 产品代码全量门禁，确认 minimal kernel、contract 和架构无回归。
  验证：`npm run build`、`npm test`、`npm run test:contract`、`npm run lint:architecture` 全部通过。
  来源：AGENTS.md 验证门禁；design 质量属性与验证映射。

- [x] 4.2 运行 OpenSpec 严格校验和 diff 卫生检查。
  验证：`npx -y @fission-ai/openspec@1.6.0 validate recover-ts-model-output-token-limit --strict` 与 `git diff --check` 通过；额外运行 `validate --all --strict` 时本 change 通过，但报告与本次修改无关的既有 `fix-agent-web-live-run-identity-recovery` failure，不把该全局结果误记为全部通过。
  来源：proposal 验证入口；design 文档承载与验证映射。

- [x] 4.3 按 `nextagent-code-review` 对本次待提交修改执行 push 前语义检视，P0/P1 为零且结论达到 PASS 后才允许推送。
  验证：2026-08-01 检视覆盖 frozen contracts、architecture、minimal kernel、security、OpenSpec consistency、Clean Code 与验证证据；未发现 P0/P1/P2，结论 PASS。
  来源：AGENTS.md Push 门禁。

## 归档前更新基线检查（非实施任务）

实现完成并验证通过后，在归档前依据 proposal/design 更新：

- `openspec/specs/model-invocation-contract/spec.md`
- `openspec/specs/ts-minimal-agent-kernel/spec.md`（移除与 canonical contract 竞争的 legacy 输出超限定义）
- `openspec/overview.md`
- `openspec/designs/modules/agent-core.md`
- `openspec/designs/functions/D4-模型与上下文/D4.1-模型调用与降级/FN-4.1-调用模型.md`
- `openspec/designs/spec-to-design-map.md`

归档审查同时确认 `openspec/designs/architecture/model-provider-boundary.md` 不需要新增规范事实，且长期文档没有重复定义恢复状态机或 owner。
