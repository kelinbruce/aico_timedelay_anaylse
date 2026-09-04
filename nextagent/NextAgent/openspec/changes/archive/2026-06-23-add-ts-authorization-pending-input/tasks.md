## 0. Scope lock

- [x] 0.1 本 change 只实现 `AUTHORIZATION` kind 的 runtime-owned one-operation authorization boundary：checkpoint/continuation binding、approve/deny validation、deny/timeout no-execution、approve one-time consumption 和 safe projection。
  验证：diff review 确认没有 generic risk/policy port、capability guard implementation、audit sink、operation scope client field、authorization-specific pending object field 或 concrete risk level vocabulary
  来源：proposal 架构约束
- [x] 0.2 实施顺序固定为 checkpoint-bound operation capture -> safe pending request -> approve/deny answer validation -> one-time resume/no-execution outcome -> reuse negative tests -> boundary tests。
  验证：protected operation 只能从 accepted run + checkpoint + pending fact 派生，不能来自 client answer、model output 或 capability args
  来源：`Authorization scope is runtime-owned`

## 1. Authorization request boundary

- [x] 1.1 在 runtime 的 `AUTHORIZATION` pending intent 处理路径中，创建 pending 前保存绑定受保护操作的 checkpoint/continuation，pending request 只包含 safe summary。
  验证：runtime authorization creation test
  来源：`Authorization scope is runtime-owned`
- [x] 1.1a 增加 authorization kind selection boundary tests/review check：`AUTHORIZATION` intent 只能由 trusted Agent/core lifecycle hook 或 capability guard 在 protected operation 开始前产生，并基于 resolved capability descriptor 和 explicit risk/governance policy；runtime 不从 model/client/channel/gateway/capability args 推断 authorization。
  验证：architecture/source review check；protected operation guard tests
  来源：`Authorization kind is selected by trusted guard`
- [x] 1.2 增加 negative test，断言 client answer 中的 operation id、permission scope、policy decision、identity 或 capability args 被拒绝或忽略。
  验证：security negative test
  来源：`Client cannot set authorization scope`

## 2. Answer handling

- [x] 2.1 实现 `[["approve"]]`：resolve 为 `RECEIVED`，只恢复 checkpoint 中绑定的一次操作。
  验证：authorization approve integration test
  来源：`Authorization approve permits only the bound operation`
- [x] 2.2 实现 `[["deny"]]`：resolve 为 `RECEIVED`，不执行受保护操作，并产生 safe denied outcome。
  验证：authorization deny integration test
  来源：`Authorization deny blocks the operation`
- [x] 2.3 增加 invalid answer negative tests：未知值、多值、多 question、custom text 均拒绝且不执行操作。
  验证：runtime negative tests
  来源：`Invalid authorization answer is rejected`
- [x] 2.4 增加 approve reuse negative test，断言同一 authorization 不能复用到后续 operation、run、session 或 agent。
  验证：reuse/replay negative test
  来源：`Authorization approve permits only the bound operation`
- [x] 2.4a 增加 approve consumed-once tests：authorization approve 在 checkpointed protected operation resume/execute 后必须视为 consumed，retry/replay/recovery 不得将同一 approval 用于第二个 protected operation。
  验证：reuse/replay/recovery negative tests
  来源：`Authorization approve permits only the bound operation`

## 3. Timeout

- [x] 3.1 authorization timeout resolve 为 `TIMED_OUT`，不执行受保护操作，不合成 approval。
  验证：authorization timeout test
  来源：`Authorization timeout blocks operation`

## 4. Boundary validation

- [x] 4.1 增加 architecture tests/review check，确认 authorization 不新增 pending object scope 字段，不新增 generic risk/policy port，后续 risk policy/capability guard 只能通过 runtime pending lifecycle 消费授权结果。
  验证：`npm run lint:architecture`；source review check
  来源：design D1
- [x] 4.2 运行完整验证。
  验证：`openspec validate add-ts-authorization-pending-input --strict`、`npm run build`、`npm test`、`npm run lint:architecture`
  来源：本 change 全部 requirements

## 归档前更新基线检查（非实施任务）

实现完成并验证通过后，按 proposal/design 的 Baseline Promotion Plan 更新长期基线。
