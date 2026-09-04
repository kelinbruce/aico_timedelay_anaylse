## 1. 常量与方法签名

- [x] 新增 `crossPodPollIntervalMs = 2_000` 和 `crossPodMaxIdlePolls = 150` 常量
  - 验证：`grep -n crossPod packages/agent-runtime/src/lifecycle/submit.ts`
- [x] `nextSubscriberEvent` 新增可选参数 `idleTimeoutMs`（默认 `subscriberIdleTimeoutMs`）
  - 验证：tsc 类型检查通过

## 2. DB 兜底轮询

- [x] 新增 `pollCrossPodEvents` 私有方法，返回 `{ status, events }`
  - 验证：tsc 类型检查通过
- [x] `streamOwned` live 阶段调用 `pollCrossPodEvents` 兜底
  - 验证：agent-runtime 测试通过
- [x] `streamLiveTailOwned` 调用 `pollCrossPodEvents` 兜底
  - 验证：agent-runtime 测试通过

## 3. 状态同步

- [x] DB 兜底投递时同步 `subscriber.pendingInputActive`
  - 验证：代码审查确认 `USER_INPUT_REQUIRED` → true / `RECEIVED`/`TIMEOUT`/`CANCELED` → false
- [x] DB 兜底投递后调用 `rememberStreamSequence`
  - 验证：代码审查确认 terminal 和 events 路径都有调用

## 4. 验证

- [x] `npm run build` 通过
- [x] `agent-runtime` 全部 223 测试通过
- [x] `npm run lint:architecture` 308 架构测试通过