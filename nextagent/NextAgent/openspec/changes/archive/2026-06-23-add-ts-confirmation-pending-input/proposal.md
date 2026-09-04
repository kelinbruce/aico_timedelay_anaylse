## 背景与问题（Why）

系统在执行电信网络诊断或变更建议时，需要在继续某些普通控制路径前向用户请求二态确认。confirmation 与 question 共用 runtime-owned pending input 外壳，但它的语义必须更窄：只能 approve/reject，不能由模型自报已确认，timeout 也不能被解释为同意。

本 change 只定义 `PendingInputKind.CONFIRMATION` 的进入 pending 后处理，不决定哪些上游策略会请求 confirmation。

## 变更范围（What Changes）

- 定义 `CONFIRMATION` pending input 的请求和 answer 语义。
- answer 只支持 `[["approve"]]` 或 `[["reject"]]`。
- confirmation 只处理 pending input core 已接受的 trusted `CONFIRMATION` pending intent；producer boundary 由 pending core 或后续明确 producer change 定义，client/model output 不能直接批准。
- approve 恢复原 run 的受控 continuation；reject 产生 safe non-approval outcome。
- timeout 等价 non-approval，不自动 approve。
- 不支持 custom，不支持多选，不新增 confirmation-specific 持久化字段。

## 架构约束下的修改说明

- 需要修改：只修改 `CONFIRMATION` kind 的 runtime answer validation、approve/reject outcome、timeout non-approval 和 safe projection tests。
- 修改后的变化：confirmation 的 wire value 固定为 `[["approve"]]` / `[["reject"]]`；reject 和 timeout 都是明确的 non-approval，不会继续 confirmed path。
- 影响：普通低风险控制流可以请求用户二态确认，但涉及受限副作用、权限或风险策略的场景必须使用 `AUTHORIZATION`，不能借 confirmation 绕过授权边界。
- 边界：不新增 confirmation-specific fields；不支持 custom/multi-select；不让 model output、client payload 或 capability 私有状态直接标记 approved。

## Capability 影响（Capabilities）

### 新增 Capability

- `confirmation-pending-input`：type-specific behavior for `PendingInputKind.CONFIRMATION`。

### 修改的 Capability

无。

## 影响范围（Impact）

- 依赖：`refine-ts-pending-input-contracts`、`add-ts-human-pending-input-core`、`add-ts-human-pending-input-timeout`；本 change 只消费 `refine` 定义的 `multiple` / `custom` question 约束和 answer shape 来拒绝 custom/multi 语义，不新增 confirmation-specific 字段。
- 影响 package：`agent-runtime` type-specific validation/outcome、channel projection tests、pending-core integration tests。
- 非目标：不定义 authorization；不执行 side-effect permission；不新增 audit sink；不让 model/capability 私有 confirmation lifecycle。

## 归档前更新基线（Baseline Promotion Plan）

- `openspec/specs/confirmation-pending-input/spec.md`：新增 confirmation 行为契约。
- runtime boundary/user-interaction architecture 文档：补充 approve/reject/timeout flow。
- `agent-runtime`、`agent-channel-web`、governance/hook 模块文档：补充职责。
- `openspec/designs/spec-to-design-map.md`：补充导航。
