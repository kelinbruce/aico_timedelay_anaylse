<!--
本文件是 ts-reliability-test-gate change 的行为规格 delta。
-->

## ADDED Requirements

### Requirement: reliability-test-behavior-contracts

NextAgent TS 后端 MUST 在可靠性维度满足本行为契约，覆盖 Recovery gate 阻断、Terminal CAS 唯一终态、Cancel 终态不可覆盖、Idempotency guard replay policy 等约束。

#### Scenario: Recovery gate 完成前阻断新请求（正路径）
- **WHEN** 进程重启后 Recovery gate 未完成期间，POST submit 提交新请求
- **THEN** 返回 503 + status=recovering（不静默丢弃），Recovery 完成后请求正常执行
- ⚠️ 真实API: Recovery 依赖真实进程 kill/restart，测试环境可能不支持

#### Scenario: Recovery 期间请求返回明确 recovering 状态（边界）
- **WHEN** Recovery gate 未完成期间提交请求
- **THEN** 返回 503 + status=recovering + message 字段（不返回 200 空响应）
- ⚠️ 真实API: Recovery 依赖真实进程重启

#### Scenario: Recovery 未完成前所有入口均拒绝请求（异常）
- **WHEN** Recovery 期间 submit/cancel/retry 入口均被调用
- **THEN** submit → 503（不创建新 RequestRun），cancel → 503，retry → 503（不创建新 attempt），recovery 完成后无新增 run
- ⚠️ 真实API: Recovery 依赖真实进程重启

#### Scenario: Terminal commit CAS 写入成功（正路径）
- **WHEN** 正常请求 EXECUTING → COMPLETED 转换
- **THEN** CAS precondition 满足，conversation 包含 ASSISTANT 消息

#### Scenario: CAS 重复提交同一终态幂等（边界）
- **WHEN** 对已 COMPLETED 的 requestId 重复 CAS 写入 COMPLETED
- **THEN** 旧 attempt 状态不变（仍为 COMPLETED），幂等生效

#### Scenario: 不可从终态转换到另一终态（异常）
- **WHEN** 对已 COMPLETED 的 RequestRun 发起 Cancel
- **THEN** 返回 409，⚠️ 真实API: error.code=REQUEST_CANCEL_ALREADY_TERMINAL（非 spec 假设的 CONFLICT）；状态不变仍为 COMPLETED
- ⚠️ 真实API: cancelRun 对 COMPLETED run 返回 409 + REQUEST_CANCEL_ALREADY_TERMINAL

#### Scenario: Recovery 正确恢复遗留 run 各状态（正路径）
- **WHEN** 进程重启后 Recovery 发现 EXECUTING 和 QUEUED 状态的遗留 run
- **THEN** EXECUTING run 恢复为 COMPLETED 或 FAILED，QUEUED run 恢复为可调度状态
- ⚠️ 真实API: Recovery 依赖真实进程重启

#### Scenario: Recovery 恢复后 Agent 行为与重启前一致（边界）
- **WHEN** Recovery 完成后查询历史 conversation 和提交新请求
- **THEN** 历史消息数量完整（与重启前一致），新请求正常追加消息
- ⚠️ 真实API: Recovery 依赖真实进程重启

#### Scenario: Idempotency guard replay policy 返回已有结果（正路径）
- **WHEN** POST submit 使用相同 idempotencyKey
- **THEN** 返回已有 requestId（不创建新 request），conversation 仅 1 条 request 记录

#### Scenario: Idempotency 不同 key 创建新 run（边界）
- **WHEN** POST submit 使用不同 idempotencyKey
- **THEN** 创建新 run，requestId 不同，conversation 含 2 条 request 记录

#### Scenario: Terminal commit CAS 失败降级路径（正路径）
- **WHEN** CAS 写入失败（SQLite write lock 等条件）
- **THEN** RequestRun 不变终态且有降级标记，CAS 重试后终态写入成功
- ⚠️ 真实API: 需要可施加/解除 write lock 的环境，当前测试环境可能不支持

#### Scenario: CAS 失败日志记录可追溯（正路径）
- **WHEN** CAS 写入失败
- **THEN** 日志中有 CAS_COMMIT_FAILED 记录，可追溯
- ⚠️ 真实API: 需要可施加 write lock 的环境

#### Scenario: Cancel EXECUTING run → CANCELLED（CAS 成功，正路径）
- **WHEN** POST cancel 对 EXECUTING 状态的 RequestRun
- **THEN** Cancel CAS 成功，EXECUTING → CANCELLED

#### Scenario: Cancel COMPLETED run → 409（CAS 拒绝，边界）
- **WHEN** POST cancel 对 COMPLETED 状态的 RequestRun
- **THEN** 返回 409，⚠️ 真实API: error.code=REQUEST_CANCEL_ALREADY_TERMINAL（非 CONFLICT）

#### Scenario: COMPLETED run 状态不变终态唯一不可覆盖（正路径）
- **WHEN** Cancel 尝试覆盖 COMPLETED → CANCELLED
- **THEN** COMPLETED 状态不变，终态唯一不可覆盖

#### Scenario: IDEMPOTENT capability recovery replay 不产生副作用（正路径）
- **WHEN** Recovery replay 发现 IDEMPOTENT capability 已有 invocation
- **THEN** 使用 stable idempotencyKey replay，不产生第二次 irreversible side effect
- ⚠️ 真实API: Recovery 日志为 NO_REPLAY_LOG stub

#### Scenario: Recovery replay 后 IDEMPOTENT capability 不产生额外副作用（边界）
- **WHEN** Recovery replay 执行
- **THEN** conversation 中 IDEMPOTENT tool result 内容与首次执行一致
- ⚠️ 真实API: Recovery 日志为 stub

#### Scenario: idempotencyKey 不出现在日志审计 stream 中（正路径）
- **WHEN** POST submit 使用特定 idempotencyKey
- **THEN** 日志中不包含 idempotencyKey 原始值（仅 hashed/truncated correlation id）
- ⚠️ 真实API: Recovery 日志为 stub，audit stream 通过 conversation 间接验证

#### Scenario: Recovery 发现已有 persisted result 不重复调用（正路径）
- **WHEN** Recovery 发现 IDEMPOTENT capability 已有 persisted result
- **THEN** recovery skip 重复调用，直接返回已持久化的 capability result
- ⚠️ 真实API: Recovery 日志为 NO_RECOVERY_LOG stub

#### Scenario: 非幂等 tool recovery 不重放（正路径）
- **WHEN** Recovery 发现 NON_IDEMPOTENT capability invocation
- **THEN** recovery 不重放，outcome 为 safe terminal 或 RECOVERY_FAILED
- ⚠️ 真实API: Recovery 日志为 stub

#### Scenario: Multi-tool recovery 逐个独立 reconcile（正路径）
- **WHEN** Recovery 发现多 tool invocation 请求
- **THEN** 各 tool 逐个独立 reconcile，不整体 batch 或等待全部 tool 完成；一个 tool reconcile 失败不阻塞其他 tool 的正常恢复
- ⚠️ 真实API: Recovery 日志为 stub
