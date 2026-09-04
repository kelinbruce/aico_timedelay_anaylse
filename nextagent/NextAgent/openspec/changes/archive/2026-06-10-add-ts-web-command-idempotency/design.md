## 背景和现状（Context）

Runtime 侧已经把 `idempotencyKey` 作为 request lifecycle command 的必备前置条件：submit/retry/edit 创建新的 RequestRun acceptance anchor，cancel 更新目标 run terminal commit metadata。这个模型的前提是进入 Runtime 前 key 已经稳定、非空且代表同一个用户动作。

当前剩余风险在 Web command 边界：如果 public DTO key 来源没有规格化，Channel 或 mock 可能在缺 key 时生成新 key，导致一次用户动作的网络重试无法命中同一个 Runtime anchor。

## 目标和非目标（Goals / Non-Goals）

**目标：**

- 固定 public Web lifecycle command 的 `idempotencyKey` 来源、校验和透传规则。
- 保证同一用户动作的网络重试使用同一个 key。
- 明确 Channel 不拥有 Runtime idempotency 事实，不新增 command outcome store。
- 明确 Runtime 不从 metadata、模型输出或 capability input/result 推断 key。

**非目标：**

- 不改变 Runtime lane、scheduler、retry、edit、cancel、terminal commit 或 RequestRun state machine。
- 不新增 `RuntimeControlCommandOutcomeRecord`、independent command outcome store 或全局 idempotency service。
- 不定义跨浏览器 tab 的长期 command registry。
- 不把 idempotency key 写入 gateway `*Record`。
- 不让 auth cookie、session id、request id、run id 或 stream cursor 替代 idempotency key。

## 设计决策（Decisions）

### D1. 用户发起的 Web lifecycle command 由前端生成 stable key

产品路径前端必须在用户动作开始时生成一个 stable `idempotencyKey`。该动作包括 submit、convenience submit、retry latest、edit 和 cancel。前端在同一个动作的 pending/retry 网络路径中复用同一个 key，直到该动作得到 accepted、terminal-safe failure、validation failure 或用户明确发起新的动作。

该 key 不是身份、权限或 owner scope。它只用于把同一个 command semantic 绑定到同一个 Runtime/Gateway anchor。trusted identity 仍只能来自 Channel/Auth boundary。

### D2. Public DTO 必填，Channel 校验后透传 Runtime

`agent-channel-web` 的 public command schema 必须要求 non-blank `idempotencyKey`。Channel 负责：

1. schema validation；
2. 去除 public action alias，例如 `CANCEL_LATEST -> CANCEL`；
3. 将 key brand/canonicalize 为 Runtime command 字段；
4. 调用 Runtime command boundary。

Channel 不得在 public submit、convenience submit、retry、edit 或 cancel 缺 key时用 `Date.now()`、`crypto.randomUUID()`、session id、request id、run id 或任何其它 fallback 补 key。缺失或空白 key 必须在 Channel schema validation 或 Runtime command validation 阶段 safe fail，且不得产生 run、queue、terminal commit、timeline、history 或 active context side effect。

### D3. 只保留 channel-owned internal key 例外

`POST /api/v1/sessions` 创建空 session 是 Channel 发起的 server-side command，没有用户提交 RequestRun；Channel 必须为该 command 生成 server-side idempotency key。

`POST /api/v1/requests` convenience submit 如果需要先创建 child session，该 child session create key 必须从 submit DTO 的 `idempotencyKey` 派生，使重复 convenience submit 返回同一个 session/run outcome，不泄漏额外空 session。Channel 不得为 convenience submit 的 RequestRun acceptance 生成另一个随机 key。

### D4. Runtime 和 Gateway 继续只处理 canonical anchor

Runtime command boundary 只消费已经存在的 canonical key，并按 command semantic 做幂等或 safe conflict 判断。Runtime 不从 client metadata、模型输出、capability input/result、stream event、timeline payload 或 gateway row 中推断/补齐 key。

Gateway 继续使用业务锚点事实表和 write options 承载幂等：RequestRun acceptance、terminal commit、session create、message append、timeline append 和 checkpoint save。`idempotencyKey` 不进入 gateway `*Record`，也不因为 command response 派生出独立 outcome record。

## 风险与取舍（Risks / Trade-offs）

- [Channel 生成随机 fallback 导致重试不幂等] -> public lifecycle command 缺 key必须失败，只允许 empty session create 使用 Channel server-side key。
- [把 command response 当事实持久化] -> response 是 derived outcome；事实仍是 RequestRun acceptance 或 terminal commit。
- [Runtime 反推 key 来源] -> Runtime 只校验 canonical key，不读取 metadata/model/capability。
- [过度设计] -> 不增加全局 command registry、独立 outcome store 或跨 tab replay ledger。

## 待确认问题（Open Questions）

无。首版规则固定：public Web lifecycle command DTO 必须携带 stable key，Channel validation 后透传 Runtime。
