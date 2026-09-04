## 1. Spec Alignment

- [x] 1.1 移除”canonical model error”主契约表述。
  来源：design 相邻 Change 关系
- [x] 1.2 改为明确 provider/model failure 到标准 error code/category/retryable 语义和 `SafeError` 的映射规则。
  来源：spec requirement “Provider and model failures map into standard safe error semantics”；design 黑盒目标
- [x] 1.3 显式引用 `ErrorNormalizer.normalize(error)` 的跨边界要求。
  来源：spec requirement “Unknown failures are normalized before crossing boundaries”；design 关键约束

## 2. Design

- [x] 2.1 写清 provider failure、stream failure、normalization failure 的统一收口。
  来源：spec requirement "Sync, stream, and normalization failures share one safe failure boundary"；design 核心实现策略

- [x] 2.2 写清哪些细节不得进入 `SafeError`。
  来源：spec requirement "Safe error output never exposes sensitive provider detail"；design 关键约束

- [x] 2.3 写清 fallback 和 observability 只能消费安全错误。
  来源：spec requirement "Fallback and observability consume safe errors instead of raw exceptions"；design 关键约束

## 3. Validation

- [x] 3.1 覆盖 provider timeout / unavailable 的安全错误样例。
  来源：spec requirement scenario "Provider call fails"
- [x] 3.2 覆盖 malformed stream / normalization failure 的安全错误样例。
  来源：spec requirement scenario "Stream normalization fails"
- [x] 3.3 覆盖 raw provider detail 不越界的安全样例。
  来源：spec requirement scenario "Provider returns a detailed error body"；spec requirement scenario "Adapter throws an unexpected exception"

验证：2026-06-05 运行 `npm test`、`npm run build`、`npm run test:contract`；`packages/agent-model/tests/openrouter-provider.test.ts` 覆盖 timeout、unavailable、malformed stream、unknown exception、SafeError-like message 重脱敏和 raw provider detail 不越界。
