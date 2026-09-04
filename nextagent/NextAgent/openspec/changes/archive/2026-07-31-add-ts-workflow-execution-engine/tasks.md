## 1. Engine Skeleton

- [x] 1.1 实现 `WorkflowExecutionService.execute()`
  验证：`npm run build`

## 2. 最小调度

- [x] 2.1 顺序节点调度
  验证：`npm run test`

- [x] 2.2 gateway control semantics 调度：消费 gateway handler 提供的条件分支结果
  验证：`npm run test`

- [x] 2.3 gateway control semantics 调度：消费 gateway handler 提供的单进程并发与终止聚合结果
  验证：`npm run test`

## 3. 生命周期

- [x] 3.1 timeout / retry
  验证：`npm run test`

- [x] 3.2 interrupt / cancel
  验证：`npm run test`

- [x] 3.3 `WorkflowExecutionEvent`
  验证：`npm run test:contract`

- [x] 3.4 节点安全可见 delta：engine 消费 node handler 的流式中间态并通过 observer 上浮
  验证：`npm run test`

## 4. 收尾

- [x] 4.1 运行验证
  验证：`npm run build && npm run test && npm run test:contract`

- [x] 4.2 Code review：确认 `start/end/parallel/exclusive` 的具体节点语义不在本 change 定义，而由 `add-ts-workflow-gateway-nodes` 承接
  验证：code review

- [x] 4.3 workflow route runtime bridge：`agent-core` 将 workflow observer event 投影到既有 runtime stream path，保证与 model loop 用户体验一致
  验证：`npm run test`
