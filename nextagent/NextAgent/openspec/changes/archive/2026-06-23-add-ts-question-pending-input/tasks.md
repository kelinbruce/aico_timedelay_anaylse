## 0. Scope lock

- [x] 0.1 本 change 只实现 `QUESTION` kind 的 request/answer validation、resume continuation、timeout outcome 和 safe projection；它消费 `refine-ts-pending-input-contracts` 的 `multiple/custom` question shape，不新增 producer tool。
  验证：diff review 确认本 change 的实施 diff 没有新增 AskUserQuestion tool、form/questionnaire engine、capability handler wait loop、new root request 或 answer schema 字段
  来源：proposal 架构约束
- [x] 0.2 实施顺序固定为 accepted question shape validation -> text/single/multi/custom answer validation -> resolve/resume integration -> timeout no-synthesis -> projection/boundary tests。
  验证：runtime 从 accepted pending request 读取题型权限；client answer 不能携带 `multiple`、`custom` 或 schema
  来源：`Question pending input supports text, single select, multi-select, and custom answers`

## 1. Question producer boundary

- [x] 1.1 在 runtime-owned pending creation/intent validation 中支持 `QUESTION` request shape：text、single-select、multi-select、custom 选项题都必须来自 accepted pending request。
  验证：runtime pending intent/request validation tests
  来源：`Question pending input supports text, single select, multi-select, and custom answers`
- [x] 1.2 增加 architecture/source review check，确认本 change 不新增 AskUserQuestion tool、不让 capability handler 等待用户回答；后续 producer 只能提交 runtime-owned `PendingInputIntent`。
  验证：architecture test 或 review check；检查本 change 的实施 diff 未在 `packages/agent-capability` 新增 AskUserQuestion/ask-user-question producer tool
  来源：design D4、proposal 架构约束

## 2. Question answer validation

- [x] 2.1 实现文本题 answer validation：options 为空时 answer entry 必须是一个非空字符串。
  验证：runtime question validation test
  来源：`Text question answer`
- [x] 2.2 实现普通单选 validation：answer entry 必须是一个匹配 option value 的字符串。
  验证：runtime question validation test
  来源：`Single-select answer`
- [x] 2.3 实现多选 validation：`multiple=true` 时 answer entry 可以包含多个唯一 option values。
  验证：runtime question multi-select validation test
  来源：`Multi-select answer`
- [x] 2.4 实现 custom 选项题 validation：`custom=true` 时允许至多一个非 option value 的非空文本，且该权限只读自 pending request。
  验证：runtime question custom validation test
  来源：`Custom option answer`
- [x] 2.5 增加 negative tests：未启用 multiple 时多值拒绝、重复值拒绝、未启用 custom 时非 option 拒绝、空值拒绝，且不 resolve。
  验证：runtime negative tests
  来源：`Question answer validation rejects invalid shape`

## 3. Resume and timeout

- [x] 3.1 valid question answer resolve 为 `RECEIVED` 后恢复原 run，并把答案作为 continuation input 而不是新 root request。
  验证：runtime resume integration test
  来源：`Accepted question answer continues execution`
- [x] 3.2 question timeout 不合成答案，原 run 进入 safe timeout outcome。
  验证：question timeout integration test
  来源：`Question timeout does not synthesize answer`

## 4. Projection and validation

- [x] 4.1 channel projection 只展示 safe question request fields，不暴露 raw model output、hidden reasoning 或 answer schema。
  验证：stream projection tests
  来源：`Question request projection`
- [x] 4.2 运行完整验证。
  验证：`openspec validate add-ts-question-pending-input --strict`、`npm run build`、`npm test`、`npm run lint:architecture`
  来源：本 change 全部 requirements

## 归档前更新基线检查（非实施任务）

实现完成并验证通过后，按 proposal/design 的 Baseline Promotion Plan 更新长期基线。
