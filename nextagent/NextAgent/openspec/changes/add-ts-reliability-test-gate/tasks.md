<!--
Task 编写规则：
- 每个 checkbox 只能对应一个可独立验收的交付结果
- 每个实现类 task 必须包含"验证"和"来源"
- 涉及 forbidden behavior、边界约束、权限、依赖规则或失败路径时，必须添加 negative verification task
-->

## 1. Recovery gate — 阻断新请求

- [ ] 1.1 TC-R-001: Recovery gate 完成前阻断新请求（正路径）
  验证：`vitest run TC-R-001-004.test.ts` — recovery 期间 submit → 503 recovering; recovery 完成后 → 200
  来源：reliability-test-behavior-contracts / Recovery gate 阻断正路径

- [ ] 1.2 TC-R-001B: Recovery 期间请求返回明确 recovering 状态（边界）
  验证：`vitest run TC-R-001-004.test.ts` — 503 + status=recovering + message 字段
  来源：reliability-test-behavior-contracts / Recovery 明确状态边界

- [ ] 1.3 TC-R-001E: Recovery 未完成前所有入口均拒绝请求（异常）
  验证：`vitest run TC-R-001-004.test.ts` — submit→503, cancel→503, retry→503; recovery 完成后无新增 run
  来源：reliability-test-behavior-contracts / Recovery 全入口拒绝异常

- [ ] 1.4 Negative verification: Recovery 期间 submit 不创建新 RequestRun
  验证：`vitest run TC-R-001-004.test.ts` — 503 响应 body 不含 requestId 属性
  来源：reliability-test-behavior-contracts / forbidden: recovery 期间不创建新 run

## 2. Terminal CAS — 唯一终态

- [ ] 2.1 TC-R-002: Terminal commit CAS 写入成功（正路径）
  验证：`vitest run TC-R-001-004.test.ts` — EXECUTING→COMPLETED CAS 成功, conversation 含 ASSISTANT
  来源：reliability-test-behavior-contracts / CAS 写入成功正路径

- [ ] 2.2 TC-R-002B: CAS 重复提交同一终态幂等（边界）
  验证：`vitest run TC-R-001-004.test.ts` — 旧 attempt 状态不变仍为 COMPLETED
  来源：reliability-test-behavior-contracts / CAS 幂等边界

- [ ] 2.3 TC-R-002E: 不可从终态转换到另一终态（异常）
  验证：`vitest run TC-R-001-004.test.ts` — ⚠️ cancel COMPLETED → 409 + REQUEST_CANCEL_ALREADY_TERMINAL（非 CONFLICT）
  来源：reliability-test-behavior-contracts / CAS 终态不可覆盖异常

- [ ] 2.4 Negative verification: Cancel COMPLETED 不改变终态
  验证：`vitest run TC-R-001-004.test.ts` — conversation 中 COMPLETED 状态未被覆盖为 CANCELLED
  来源：reliability-test-behavior-contracts / forbidden: 终态不可覆盖

## 3. Recovery 恢复遗留 run

- [ ] 3.1 TC-R-003: Recovery 正确恢复遗留 run 各状态（正路径）
  验证：`vitest run TC-R-001-004.test.ts` — ⚠️ 需要真实 kill/restart 环境; EXECUTING→COMPLETED/FAILED, QUEUED→可调度
  来源：reliability-test-behavior-contracts / Recovery 恢复正路径

- [ ] 3.2 TC-R-003B: Recovery 恢复后 Agent 行为与重启前一致（边界）
  验证：`vitest run TC-R-001-004.test.ts` — ⚠️ 需要真实 kill/restart 环境; 历史消息完整, 新请求追加
  来源：reliability-test-behavior-contracts / Recovery 行为一致边界

## 4. Idempotency guard

- [ ] 4.1 TC-R-004: Idempotency guard replay policy 返回已有结果（正路径）
  验证：`vitest run TC-R-001-004.test.ts` — 相同 key 返回已有 requestId, conversation 仅 1 条记录
  来源：reliability-test-behavior-contracts / Idempotency replay 正路径

- [ ] 4.2 TC-R-004 不同 key 创建新 run（边界）
  验证：`vitest run TC-R-001-004.test.ts` — 不同 key → 新 requestId, conversation 含 2 条记录
  来源：reliability-test-behavior-contracts / Idempotency 不同 key 边界

## 5. CAS 失败降级路径

- [ ] 5.1 TC-R-005: CAS 失败降级路径（正路径）
  验证：`vitest run TC-R-005-011.test.ts` — ⚠️ 需要可施加 write lock 的环境; CAS 失败后有降级标记
  来源：reliability-test-behavior-contracts / CAS 失败降级正路径

- [ ] 5.2 TC-R-005 CAS 失败日志记录可追溯（正路径）
  验证：`vitest run TC-R-005-011.test.ts` — ⚠️ 需要可施加 write lock 的环境; 日志含 CAS_COMMIT_FAILED
  来源：reliability-test-behavior-contracts / CAS 失败可追溯

- [ ] 5.3 TC-R-005 CAS 重试后终态写入成功（正路径）
  验证：`vitest run TC-R-005-011.test.ts` — ⚠️ 需要可施加 write lock 的环境; 解除 lock 后 CAS 成功
  来源：reliability-test-behavior-contracts / CAS 重试成功

## 6. Cancel CAS 唯一终态

- [ ] 6.1 TC-R-006: Cancel EXECUTING run → CANCELLED（CAS 成功，正路径）
  验证：`vitest run TC-R-005-011.test.ts` — cancel EXECUTING → CANCELLED CAS 成功
  来源：reliability-test-behavior-contracts / Cancel CAS 成功正路径

- [ ] 6.2 TC-R-006: Cancel COMPLETED run → 409（CAS 拒绝，边界）
  验证：`vitest run TC-R-005-011.test.ts` — ⚠️ cancel COMPLETED → 409 + REQUEST_CANCEL_ALREADY_TERMINAL（非 CONFLICT）
  来源：reliability-test-behavior-contracts / Cancel CAS 拒绝边界

- [ ] 6.3 TC-R-006: COMPLETED run 状态不变终态唯一不可覆盖（正路径）
  验证：`vitest run TC-R-005-011.test.ts` — conversation 中 COMPLETED 状态未被覆盖
  来源：reliability-test-behavior-contracts / 终态唯一不可覆盖

- [ ] 6.4 Negative verification: Cancel COMPLETED 不改变任何状态
  验证：`vitest run TC-R-005-011.test.ts` — 409 响应后 conversation 状态不变
  来源：reliability-test-behavior-contracts / forbidden: Cancel 不改变终态

## 7. IDEMPOTENT capability replay

- [ ] 7.1 TC-R-015: IDEMPOTENT capability recovery replay 不产生副作用（正路径）
  验证：`vitest run TC-R-015-019.test.ts` — ⚠️ Recovery 日志为 stub; recovery replay 使用 stable key
  来源：reliability-test-behavior-contracts / IDEMPOTENT replay 正路径

- [ ] 7.2 TC-R-015 Recovery replay 后不产生额外副作用（边界）
  验证：`vitest run TC-R-015-019.test.ts` — ⚠️ Recovery 日志为 stub; conversation 内容与首次一致
  来源：reliability-test-behavior-contracts / IDEMPOTENT replay 边界

- [ ] 7.3 TC-R-016: idempotencyKey 不出现在日志审计 stream 中（正路径）
  验证：`vitest run TC-R-015-019.test.ts` — ⚠️ audit 通过 conversation 间接验证; 日志搜索无原始 key
  来源：reliability-test-behavior-contracts / idempotencyKey 脱敏正路径

- [ ] 7.4 TC-R-016 correlation 值为 hashed/truncated/redacted 格式（边界）
  验证：`vitest run TC-R-015-019.test.ts` — conversation 中 correlation 值为 hashed/truncated 格式
  来源：reliability-test-behavior-contracts / idempotencyKey 脱敏边界

- [ ] 7.5 Negative verification: idempotencyKey 原始值不出现在任何日志/审计中
  验证：`vitest run TC-R-015-019.test.ts` — 日志搜索和 conversation 中不含原始 key 值
  来源：reliability-test-behavior-contracts / forbidden: idempotencyKey 原始值不泄漏

## 8. Recovery persisted result / 非幂等 / Multi-tool

- [ ] 8.1 TC-R-017: Recovery 发现已有 persisted result 不重复调用（正路径）
  验证：`vitest run TC-R-015-019.test.ts` — ⚠️ Recovery 日志为 stub; recovery skip 重复调用
  来源：reliability-test-behavior-contracts / persisted result 不重复正路径

- [ ] 8.2 TC-R-018: 非幂等 tool recovery 不重放（正路径）
  验证：`vitest run TC-R-015-019.test.ts` — ⚠️ Recovery 日志为 stub; NON_IDEMPOTENT 不被重放
  来源：reliability-test-behavior-contracts / 非幂等不重放正路径

- [ ] 8.3 TC-R-019: Multi-tool recovery 逐个独立 reconcile（正路径）
  验证：`vitest run TC-R-015-019.test.ts` — ⚠️ Recovery 日志为 stub; 各 tool 逐个 reconcile
  来源：reliability-test-behavior-contracts / Multi-tool reconcile 正路径

- [ ] 8.4 Negative verification: 非幂等 tool recovery 不产生重放副作用
  验证：`vitest run TC-R-015-019.test.ts` — recovery outcome 为 safe terminal 或 RECOVERY_FAILED, 无重放
  来源：reliability-test-behavior-contracts / forbidden: 非幂等不重放

## 9. 验证和收尾

- [ ] 9.1 运行 Vitest 全量测试（3 .test.ts 文件）
  验证：`vitest run` — 40 用例（TC-R-001-004 19 tests + TC-R-005-011 6 tests + TC-R-015-019 15 tests）
  来源：design / Vitest 执行架构

- [ ] 9.2 标注已知问题：Recovery 依赖真实重启、CAS 需要真实 write lock 环境、Recovery 日志为 stub
  验证：检查 TC-R-001/003/005/015~019 的 ⚠️ 标注完整性
  来源：design / 已知问题标注策略

- [ ] 9.3 标注真实 API 差异：REQUEST_CANCEL_ALREADY_TERMINAL vs CONFLICT
  验证：检查 TC-R-002E/006 的 ⚠️ 标注完整性
  来源：design / 真实 API 差异标注策略

## 归档前更新基线检查（非实施任务）

- 同步 openspec/specs/reliability-test-behavior-contracts/spec.md：新增 Recovery gate、CAS 唯一终态、Idempotency guard 行为契约
- 检查长期文档没有重复定义同一状态机、API schema、数据 owner 或接口语义
