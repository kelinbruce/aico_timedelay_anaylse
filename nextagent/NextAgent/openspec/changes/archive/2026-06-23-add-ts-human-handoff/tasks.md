## 0. Scope lock

- [x] 0.1 本 change 只实现 `HUMAN_HANDOFF` kind 的 two-path runtime outcome：`final_answer` terminal commit、`resume_instruction` continuation、invalid answer rejection、timeout/cancel no-synthesis 和 safe projection。
  验证：diff review 确认没有 handoff workbench、assignment queue、operator private state、external review platform、standalone handoff API、new root request 或 handoff-specific persistence field
  来源：proposal 架构约束
- [x] 0.2 实施顺序固定为 two-entry answer validation -> final answer terminal commit -> resume instruction continuation -> timeout/cancel effects -> projection/boundary tests。
  验证：model 不重新生成人工 final answer；resume instruction 不作为新 root user message
  来源：`Human handoff accepts final answer or resume instruction`

## 1. Handoff answer validation

- [x] 1.1 实现 handoff answer schema：必须是两个 answer entries，第一项为 `final_answer` 或 `resume_instruction`，第二项为一个非空文本。
  验证：runtime handoff validation tests
  来源：`Human handoff accepts final answer or resume instruction`
- [x] 1.2 增加 invalid answer negative tests：缺项、多项、未知 mode、空内容、多值、custom/multi-select 均拒绝且不 resolve。
  验证：runtime negative tests
  来源：`Invalid handoff answer is rejected`

## 2. Outcomes

- [x] 2.1 实现 final answer path：resolve 为 `RECEIVED` 后 runtime terminal-commit 原 run，不调用模型生成最终回答。
  验证：runtime terminal integration test；mock model not called assertion
  来源：`Human final answer completes original run`
- [x] 2.2 实现 resume instruction path：resolve 为 `RECEIVED` 后从 checkpoint 恢复原 run，并把 instruction 作为 continuation input。
  验证：runtime resume integration test
  来源：`Human resume instruction continues original run`

## 3. Timeout and cancel

- [x] 3.1 handoff timeout resolve 为 `TIMED_OUT`，不合成 final answer 或 resume instruction。
  验证：handoff timeout test
  来源：`Handoff timeout`
- [x] 3.2 owning run cancel 时 handoff resolve 为 `CANCELED`，late handoff answer 返回 conflict。
  验证：handoff cancel test
  来源：`Handoff cancel`

## 4. Projection and boundaries

- [x] 4.1 channel projection 对 handoff 只暴露 pending id、kind、status 和 safe summary，不暴露 hidden/operator/assignment/private state。
  验证：stream projection tests
  来源：`Handoff stream projection`
- [x] 4.2 增加 architecture check，确认没有新增 handoff workbench、assignment queue 或私有 lifecycle owner。
  验证：`npm run lint:architecture`
  来源：proposal 非目标、design D1-D3
- [x] 4.2a 增加 handoff answer authority boundary tests/review check：handoff answer ingress 首版沿用 pending answer 的 trusted channel/auth boundary；runtime 校验 owner/agent/session/pending id/status；不新增 operator identity、assignment、claim、queue、workbench、SLA 或 external review platform；handoff answer 不满足 protected operation confirmation/authorization。
  验证：architecture/source review check；runtime command negative tests
  来源：`Human handoff answer uses pending answer authority`
- [x] 4.3 运行完整验证。
  验证：`openspec validate add-ts-human-handoff --strict`、`npm run build`、`npm test`、`npm run lint:architecture`
  来源：本 change 全部 requirements

## 归档前更新基线检查（非实施任务）

实现完成并验证通过后，按 proposal/design 的 Baseline Promotion Plan 更新长期基线。
