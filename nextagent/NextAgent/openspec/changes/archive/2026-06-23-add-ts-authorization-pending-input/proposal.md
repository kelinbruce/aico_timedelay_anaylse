## 背景与问题（Why）

某些电信网络操作会读取敏感信息、触发外部系统调用或产生受限副作用。系统必须在执行这类受限操作前得到用户明确授权，并保证该授权只对当前 run 内的单次目标操作有效。authorization 与 confirmation 不同：它绑定受保护操作，deny/timeout 必须阻止操作执行。

本 change 只定义 `PendingInputKind.AUTHORIZATION` 在进入 pending 后的处理，不定义完整 risk policy 或 capability audit sink。

## 变更范围（What Changes）

- 定义 authorization pending input 的 answer vocabulary：`[["approve"]]` 或 `[["deny"]]`。
- 授权绑定当前 run、当前 pending input 和 checkpoint 中的单次受保护操作。
- approve 只允许该一次操作继续；不得复用到后续操作。
- deny/timeout 阻止受保护操作执行。
- client answer 不携带 operation scope、权限、identity 或 policy decision。
- 不支持 custom，不支持多选，不新增 authorization-specific pending object field。

## 架构约束下的修改说明

- 需要修改：只修改 `AUTHORIZATION` kind 的 runtime answer validation、checkpoint/continuation 绑定、approve/deny/timeout outcome 和 boundary tests。
- 修改后的变化：授权 scope 固定在 runtime-owned checkpoint/continuation 中；client 只能回答 approve/deny，不能指定 operation id、permission scope、policy decision、identity 或 capability args。
- 影响：后续 risk policy、hook 或 capability guard 可以消费这条 runtime authorization boundary；当前 change 不新增 generic policy engine、risk port、capability audit sink 或具体风险等级。
- 边界：authorization 不扩展 pending object 字段；approve 只消费一次且只恢复 checkpoint 中绑定的操作；deny/timeout 必须阻止执行。

## Capability 影响（Capabilities）

### 新增 Capability

- `authorization-pending-input`：type-specific behavior for `PendingInputKind.AUTHORIZATION`。

### 修改的 Capability

- `risk-policy-enforcement` 和受保护 capability invocation 可在后续 change 消费本 change 的 runtime authorization boundary；本 change 不定义 policy trigger，也不新增 capability guard implementation。

## 影响范围（Impact）

- 依赖：`refine-ts-pending-input-contracts`、`add-ts-human-pending-input-core`、`add-ts-human-pending-input-timeout`；本 change 只消费 `refine` 定义的 `multiple` / `custom` question 约束和 answer shape 来拒绝 custom/multi 语义，不新增 authorization-specific pending object 字段。
- 后续协作：`add-ts-lifecycle-hook-execution`、`add-ts-risk-policy-enforcement`、`add-ts-capability-invocation-audit` 可以消费该 boundary，但不是本 change 的实施内容。
- 影响 package：`agent-runtime` authorization continuation、safe projection/tests；capability invocation guard integration 只在对应后续 change 中实施。
- 非目标：不实现完整 policy engine；不新增 audit sink；不定义具体工具风险等级；不让 confirmation 替代 authorization。

## 归档前更新基线（Baseline Promotion Plan）

- `openspec/specs/authorization-pending-input/spec.md`：新增 authorization 行为契约。
- runtime/user-interaction architecture：补充 run-bound one-operation authorization flow。
- `agent-runtime` 模块文档：补充授权 pending outcome；`agent-capability`、governance/risk policy、observability 模块文档只在后续消费 change 中补充职责和消费关系。
- `openspec/designs/spec-to-design-map.md`：补充导航。
