## FN-6.5 请求用户确认或授权

### 1. Deadline-driven runtime scheduling

- [x] 1.1 Replace the one-second polling regressions with fake-clock tests proving startup reconciliation computes a future deadline, healthy idle time performs no repeated query, and the fact is processed when that deadline arrives without another submit or client connection.
  来源：FN-6.5 + Requirements `Runtime resolves pending input timeout`、`Timeout processing remains idle and bounded`、`Timeout processing recovers safely from interruption`，Scenarios `Due timeout is processed without external traffic`、`Healthy idle runtime does not poll`、`Startup processes already-due facts before readiness`。
  验证：`npx vitest run --config vitest.config.release.ts tests/agent-kernel/session-lane-scheduling.test.ts`。
  完成证据：runtime suite 46/46通过；fake clock在deadline前推进1秒时query count保持不变，到deadline后自动收敛。

- [x] 1.2 Add an explicit runtime-internal pending-create notification to every timed producer path and implement one earliest-deadline timer with earlier-deadline replacement、single-flight reconciliation、100-record keyset pages and failure-only capped backoff.
  来源：FN-6.5 + Requirements `Runtime resolves pending input timeout`、`Timeout processing remains idle and bounded`、`Timeout processing recovers safely from interruption`，Scenarios `Earlier accepted deadline is not delayed`、`Candidate processing is bounded and non-overlapping`、`One candidate failure does not stop later candidates`。
  验证：同一 runtime suite断言新建更早 deadline抢占、later deadline不延后、failure retry和close后零查询。
  完成证据：scheduler启动后再创建pending的真实时钟case通过且只发生startup/deadline两次query；suite覆盖single-flight、101条分页、1秒故障退避、startup失败不被立即重试覆盖和close边界，30秒上限由命名常量与最终语义审查确认。

- [x] 1.3 Remove the submit-triggered due scan and fixed one-second cadence while preserving startup recovery、partial `TIMED_OUT` convergence、late-answer CAS and runtime-before-gateway close order.
  来源：design `一个 runtime timer`、`Unresolved fact reconciliation`。
  验证：runtime和 app lifecycle targeted suites。
  完成证据：runtime 46/46、app lifecycle 16/16通过；production source不再包含cadence常量或submit-triggered timeout scan。

### 2. Timeout terminal and persistence cleanup

- [x] 2.1 Add a failing terminal-hook regression, then make only `PENDING_INPUT_TIMEOUT` terminal context set the existing skip-hook flag so timeout cannot create a replacement pending input.
  来源：Scenario `Timeout terminalization does not request input again`。
  验证：`npx vitest run --config vitest.config.release.ts tests/agent-kernel/session-lane-scheduling.test.ts`。
  完成证据：配置`BEFORE_AGENT_TERMINAL -> PEND`的回归通过；timeout后hook invocation为0、active pending不存在、run为`FAILED/COMMITTED`。

- [x] 2.2 Extend local gateway composite-delete coverage with a terminal pending input and delete `pending_inputs` in the same transaction before RequestRuns.
  来源：Scenario `Session deletion removes timeout facts`。
  验证：`npx vitest run --config vitest.config.release.ts tests/agent-kernel/local-gateway-contract.test.ts`。
  完成证据：delete cascade回归断言pending record物理删除且unresolved query为空；local gateway 59/59通过。

## 整体验证

- [x] 3.1 Run session activity、frontend Composer and real pending-input product-path regressions, proving the existing projections consume canonical timeout without acquiring local timeout authority.
  验证：相关 agent-session、frontend route-state/RespondInput 和 `human-pending-input.test.ts` suites。
  完成证据：agent-session activity 29/29、frontend activity/route-state 154/154、真实 pending-input product path 1/1通过；frontend无本次生产代码修改。

- [x] 3.2 Run affected package builds、root contract/architecture gates、both strict change validations and `openspec validate --all --strict`.
  完成证据：三个受影响 package build、root build、root tests 1024/1024、contract 324/324、architecture 243/243、frontend build与multi-host Vite build、全库 OpenSpec strict 253/253通过。

- [x] 3.3 Perform `$nextagent-code-review` over the final diff and resolve every P0/P1 before push.
  完成证据：最终语义审查发现并修复 startup reconciliation失败后退避被start覆盖成立即重试的问题；新增回归通过，复审无剩余P0/P1，结论 PASS。
