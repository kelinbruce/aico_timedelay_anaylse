## 0. Scope lock

- [x] 0.1 本 change 只实现 `CONFIRMATION` kind 的 exact approve/reject validation、approve continuation、reject non-approval、timeout non-approval 和 safe projection。
  验证：diff review 确认没有 authorization semantics、side-effect permission、risk policy、audit sink、custom/multi-select 或 confirmation-specific persistence fields
  来源：proposal 架构约束
- [x] 0.2 实施顺序固定为 request guard -> `[["approve"]]` / `[["reject"]]` answer validation -> approve/reject outcome -> timeout non-approval -> projection/boundary tests。
  验证：reject/timeout 都不能继续 approved path；model output、client payload 和 capability private state 不能标记 approved
  来源：`Confirmation pending input accepts only approve or reject`

## 1. Validation and outcome

- [x] 1.1 实现 confirmation approve validation：仅 `[["approve"]]` 合法，并走 core pending resolve/resume。
  验证：runtime confirmation approve test
  来源：`Confirmation approve`
- [x] 1.2 实现 confirmation reject validation：`[["reject"]]` resolve 为 `RECEIVED`，但普通 confirmed continuation 不按 approved path 继续。
  验证：runtime confirmation reject test
  来源：`Confirmation reject`
- [x] 1.3 增加 invalid answer negative tests：空 answer、未知值、多值、多 question、custom text 均拒绝且不 resolve。
  验证：runtime negative tests
  来源：`Invalid confirmation answer is rejected`
- [x] 1.4 增加 request validation，拒绝 confirmation custom/multi-select 语义。
  验证：runtime request validation negative test
  来源：`Confirmation has no custom or multi-select semantics`

## 2. Timeout and projection

- [x] 2.1 confirmation timeout 进入 non-approval outcome，不继续 confirmed path。
  验证：confirmation timeout integration test
  来源：`Confirmation timeout`
- [x] 2.2 channel projection 只显示 safe confirmation request 和 safe terminal pending summary。
  验证：stream projection tests
  来源：`Confirmation pending input accepts only approve or reject`

## 3. Boundary validation

- [x] 3.1 增加 architecture/review check，确认 model output、client payload 和 capability 私有状态不能直接标记 confirmation approved。
  验证：architecture test 或 code review 检查点
  来源：design D1、D2
- [x] 3.1a 增加 confirmation/authorization boundary tests/review check：涉及敏感读取、外部副作用调用、网络/设备/客户状态变更、受限副作用、permission scope 或 risk policy 的 continuation 不得用 `CONFIRMATION` approve 放行，必须使用 `AUTHORIZATION` 或后续 explicit guard/risk change。
  验证：runtime/architecture negative tests 或 source review check；确认 confirmation approve 不能满足 protected operation authorization
  来源：`Confirmation is not authorization`
- [x] 3.2 运行完整验证。
  验证：`openspec validate add-ts-confirmation-pending-input --strict`、`npm run build`、`npm test`、`npm run lint:architecture`
  来源：本 change 全部 requirements

## 归档前更新基线检查（非实施任务）

实现完成并验证通过后，按 proposal/design 的 Baseline Promotion Plan 更新长期基线。
