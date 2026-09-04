## 1. Runtime Config 消费

- [x] 1.1 `executePath` 消费 `runtime.timeout` 作为流程级超时
  验证：`npm test` + 新增 timeout 测试
- [x] 1.2 `parseRetryPolicy` 优先级链：`retry`->`retryPolicy`->`defaultRetry`->`{maxRetries:0}`
  验证：`npm test` + 重试优先级测试
- [x] 1.3 节点 `timeout` 优先于 `timeoutMs`
  验证：`npm test` + timeout 优先级测试

## 2. ControlPolicy

- [x] 2.1 `resolveControlPolicy` 解析 `runtime.controlPolicy`
  验证：`npm test`
- [x] 2.2 `cancel`/`STOP` 执行（终止流程）
  验证：`npm test`
- [x] 2.3 `ROLLBACK_*` 回滚执行延期标记
  验证：design.md 延期说明

## 3. DependsOn

- [x] 3.1 节点执行前校验 `dependsOn` 已完成
  验证：`npm test` + 依赖未满足测试
- [x] 3.2 抛 `WORKFLOW_DEPENDENCY_NOT_SATISFIED` SafeError
  验证：`npm test`

## 4. OnError 废弃

- [x] 4.1 `executeNode` catch 路径移除 `resolveOnErrorAction` 调用
  验证：`npm test`
- [x] 4.2 节点异常转移统一走 `exception`
  验证：`npm test`

## 5. 收尾

- [x] 5.1 `npm run build && npm test && npm run test:contract && npm run lint:architecture`
  验证：全部通过
- [x] 5.2 Code review
  验证：`$nextagent-code-review` PASS
