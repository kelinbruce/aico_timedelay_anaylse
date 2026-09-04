## 背景与问题（Why）

`add-ts-session-lane-scheduling`、`add-ts-request-cancel` 和 `add-ts-request-retry` 已经明确 Runtime command boundary 必须收到非空 canonical `idempotencyKey`，且 retry/edit 通过新的 RequestRun acceptance anchor 幂等，cancel 通过目标 run 的 terminal commit metadata 幂等。

当前缺口是 public Web command 边界没有独立定义 key 来源、校验和传递规则。如果 Channel 或 mock 在缺失 key 时用 `Date.now()`、每次随机 fallback 或从 metadata/model/capability 中补 key，同一个用户动作的网络重试会变成多个 command，Runtime 的锚点幂等也会被削弱。

本 change 只处理 Web command idempotency contract：前端为用户发起的 lifecycle command 生成 stable key，public DTO 携带该 key，Web channel 校验并传给 Runtime。Runtime 继续只消费 canonical key，不拥有 public DTO key 来源。

## 变更范围（What Changes）

- 新增 Web command idempotency 行为契约：submit、convenience submit、retry latest、edit 和 cancel 等会创建、推进或终止 RequestRun lifecycle 的 public Web command DTO 必须携带 non-blank `idempotencyKey`。
- 明确 key source：产品路径前端必须在用户动作开始时生成 stable `idempotencyKey`，并在该动作的网络重试中复用同一个 key。
- 明确 Channel 职责：`agent-channel-web` 只做 schema validation、canonical normalization、action alias normalization 和 Runtime command 调用；不得在 public submit/cancel/retry/edit 缺 key 时生成随机 fallback。
- 明确受控例外：Web channel 必须为 channel-owned internal empty session create 生成 server-side key；convenience submit 创建 child session 时只能从 submit `idempotencyKey` 派生 server-side session-create key。
- 明确 Runtime/Gateway 边界：Runtime 不从 client metadata、模型输出、capability input/result、stream event 或 gateway record 中推断 key；`idempotencyKey` 仍是 command/write option，不进入 gateway `*Record`。
- 明确失败边界：缺失、空白、非法类型或同 key 不同 command semantic 必须 safe fail，不得产生 run、queue、terminal commit、timeline、history 或 active context side effect。

BREAKING：public Web lifecycle command DTO 缺失 `idempotencyKey` 必须失败；当前产品代码已基本按该方向实现，mock fallback 需要收敛。

## 与当前基线和相邻 change 的边界

- 和 `add-ts-session-lane-scheduling` 的边界是：lane/scheduler/Runtime 定义 canonical key 的 acceptance、queue、terminal anchor 语义；本 change 定义 public Web DTO key source 和 Channel validation/forwarding。
- 和 `add-ts-request-cancel` 的边界是：cancel change 定义 Runtime cancel idempotency、terminal commit anchor 和 action canonicalization；本 change 定义 public cancel DTO 必须携带 key，Channel 缺 key不得生成 fallback。
- 和 `add-ts-request-retry` 的边界是：retry change 定义 Runtime retry creates new RequestRun and acceptance anchor；本 change 定义 public retry DTO key 的生成、复用和 Channel 透传。
- 和 `agent-channel-web-auth-local` 的边界是：auth 只建立 trusted identity/owner scope，不生成 command idempotency key，也不把 identity cookie 当 idempotency anchor。
- 和 gateway 的边界是：gateway 只保存锚点事实表和 write options，不新增独立 command outcome store，不新增 `RuntimeControlCommandOutcomeRecord`。

## Capability 影响（Capabilities）

### 新增 Capability
- `ts-web-command-idempotency`: 定义 public Web lifecycle command 的 idempotency key 来源、schema validation、Channel 透传和 Runtime/Gateway 边界。

### 修改的 Capability
- 无。

## 影响范围（Impact）

- 代码：影响 `frontend/agent-web` command 发起路径、`agent-channel-web` DTO/schema/route、mock-server request routes 和对应 tests。
- API：固化 submit/cancel/retry/edit public Web command body 的 `idempotencyKey` 必填语义；`POST /api/v1/sessions` 的 empty session create 仍由 Channel 生成 server-side key。
- Runtime：不新增 Runtime command、state machine、command outcome record 或 key generation。
- Gateway：不新增 `RuntimeControlCommandOutcomeRecord` 或独立 idempotency store；继续使用 RequestRun/session/message/timeline/checkpoint 等锚点事实。
- 测试：覆盖 public DTO 缺 key失败、前端 stable key 复用、Channel 不 fallback、Runtime 不从 metadata/model/capability 回填 key。

## KISS 边界

首版只固定一条规则：用户发起的 Web lifecycle command 必须自带 stable key，Channel 校验后透传 Runtime。不要新增 command outcome store、全局 idempotency 服务、跨 tab command registry 或复杂 replay ledger。

## 归档前基线提升计划（Baseline Promotion Plan）

- `openspec/specs/ts-web-command-idempotency/spec.md`：提升 public Web command key source、Channel validation 和 Runtime/Gateway 边界。
- `openspec/designs/modules/agent-channel-web.md`：补充 Channel 只做 command DTO validation/projection，不拥有 Runtime idempotency facts。
- `openspec/designs/modules/agent-runtime.md`：补充 Runtime 只消费 canonical key，不定义 public DTO key 来源。
