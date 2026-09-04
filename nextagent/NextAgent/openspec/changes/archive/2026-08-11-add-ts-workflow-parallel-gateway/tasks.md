## 1. Owner 拆分与边界

- [x] 1.1 将 `parallel-gateway` 行为 ownership 从 `add-ts-workflow-gateway-nodes` 拆分到本 change，持有独立的 spec / design / tasks
  验证：`openspec validate --all --strict`
  来源：spec requirement `Parallel Gateway Ownership`

- [x] 1.2 确认本地工作流执行路径现提供 `parallel-gateway` 并发执行
  验证：code review checkpoint：`engine/index.ts` 中的 `executeConcurrentForkJoin`
  来源：spec requirement `Concurrent Fork/Join Execution`

## 2. 并发 Fork/Join 实现

- [x] 2.1 实现并发 fork/join：所有命中分支通过 `Promise.allSettled` 同时启动，输出按声明顺序合并
  验证：`npm test`（workflow-execution-engine："executes parallel branches concurrently rather than sequentially"）
  来源：spec requirement `Concurrent Fork/Join Execution`

- [x] 2.2 实现 `inputs.join_node`：允许显式 join 节点覆盖；未指定时默认解析为各分支公共 end_node，无公共 end_node 则 `JOIN_UNRESOLVED`
  验证：`npm test`（workflow-execution-engine："uses explicit join_node from parallel gateway inputs"、"resolves default join node to common end_node"）
  来源：spec requirement `Parallel Gateway Join Configuration`

- [x] 2.3 实现 `join_on_failure: "break"`：首个分支失败时 abort 其余分支（非默认）
  验证：`npm test`（workflow-execution-engine："aborts remaining branches on failure when join_on_failure is break"）
  来源：spec requirement `Parallel Gateway Join Configuration`

- [x] 2.4 实现 `join_on_failure: "wait"`（默认）：等待所有分支，至少一个分支正常到达 join 则 COMPLETED，全部分支失败才 FAILED
  验证：`npm test`（workflow-execution-engine："succeeds with partial branch completion under wait"、"fails when all branches fail under wait"、"applies default wait strategy when unspecified"）
  来源：spec requirement `Parallel Gateway Join Configuration`

- [x] 2.5 实现 `inputs.join_timeout`：超时后 abort 所有分支；未指定时默认 600 秒
  验证：`npm test`（workflow-execution-engine："aborts all branches when join_timeout expires"、"applies default 600s join_timeout when unspecified"）
  来源：spec requirement `Parallel Gateway Join Configuration`

- [x] 2.6 维持安全失败，reason code 为 `WORKFLOW_PARALLEL_GATEWAY_NO_MATCH` 和 `WORKFLOW_PARALLEL_GATEWAY_JOIN_UNRESOLVED`
  验证：`npm test`（已有 parallel gateway 测试）
  来源：spec requirement `Parallel Gateway Safe Failure`

## 3. 边界约束

- [x] 3.1 确认未引入高级恢复语义（branchId、snapshot/recovery、跨实例 barrier）
  验证：code review checkpoint
  来源：spec requirement `Deferred Advanced Parallel Semantics`

- [x] 3.2 在 spec 中文档化跨分支 `dependsOn` 约束：并发分支 MUST NOT 声明跨分支依赖
  验证：spec review；workflow-execution-engine 中的负面测试
  来源：spec requirement `Parallel Gateway Boundary`

## 4. 验证

- [x] 4.1 `npm run build`
  验证：TypeScript 编译通过
  来源：所有 tasks

- [ ] 4.2 `npm test`（workflow-execution-engine）
  验证：全部测试通过，含 parallel gateway 测试（含新增 wait 容错成功/全失败/默认值/end_node 解析用例）
  来源：所有 tasks

## 基线提升清单（非实现类 tasks）

- 同步 `openspec/specs/workflow-parallel-gateway/spec.md`
- 按需更新 `openspec/designs/architecture/workflow-contracts.md`
- 按需更新 `openspec/designs/modules/agent-workflow.md`
- 按需更新 `openspec/designs/spec-to-design-map.md`
