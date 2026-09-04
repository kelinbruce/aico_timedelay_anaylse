## 1. Contract and Boundary

- [x] 1.1 定义 public Web lifecycle command idempotency contract，覆盖 submit、convenience submit、retry latest、edit 和 cancel。
  验证：OpenSpec strict validate；spec review 确认 key source 不落到 Runtime/lane/cancel/retry change。
  来源：Requirement: Public Web lifecycle commands require stable idempotency key。
- [x] 1.2 明确 Channel-owned internal key 例外：empty session create 必须由 Channel 生成；convenience submit child session create key 必须从 submit key 派生。
  验证：contract tests 覆盖 `POST /api/v1/sessions` 和 `POST /api/v1/requests` 的不同 key 语义。
  来源：Requirement: Channel internal session creation key is controlled exception。

## 2. Implementation

- [x] 2.1 收敛 `agent-channel-web` request DTO/schema/route：submit、convenience submit、cancel、retry 和 edit 缺失或空白 `idempotencyKey` 必须 schema validation failed；Channel 不得随机 fallback。
  验证：channel route tests 覆盖缺失/空白 key、合法 key透传 Runtime、cancel action alias normalization。
  来源：Requirement: Channel validates and forwards canonical command key。
- [x] 2.2 收敛前端 command 发起路径：每个用户动作开始时生成 stable key，同一动作的 pending/network retry 路径复用同一个 key。
  验证：frontend request store/service tests 覆盖 submit、cancel、retry、edit 的 key 生成和复用。
  来源：Requirement: Frontend generates stable key per user action。
- [x] 2.3 收敛 mock-server：去掉 cancel/retry/edit/submit 缺 key fallback，尤其禁止 `Date.now()` 或每次随机 key fallback。
  验证：mock-server route tests 或 integration smoke 覆盖缺 key失败。
  来源：Requirement: Channel validates and forwards canonical command key。

## 3. Negative Cases

- [x] 3.1 增加 negative tests，断言 Runtime 不从 client metadata、模型输出、capability input/result、stream event 或 gateway record 回填 `idempotencyKey`。
  验证：runtime/channel boundary tests 和 architecture review。
  来源：Requirement: Runtime does not infer command idempotency key。
- [x] 3.2 增加 tests，断言 same key + same command semantic 返回首次或等价 outcome；same key + different command semantic 返回 safe conflict。
  验证：runtime command tests 复用 RequestRun acceptance / terminal commit anchor，不新增 command outcome store。
  来源：Requirement: Command response is derived from RequestRun facts。

## 4. Validation

- [x] 4.1 运行 `openspec validate --all --strict`。
- [x] 4.2 运行相关 channel/runtime/frontend/mock tests。
- [x] 4.3 运行 architecture boundary validation，确认未新增 `RuntimeControlCommandOutcomeRecord`、独立 command outcome store 或 gateway `*Record.idempotencyKey` 字段。
