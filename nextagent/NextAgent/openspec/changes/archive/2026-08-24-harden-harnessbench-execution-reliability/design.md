## 设计范围

| Function | 本次目标变化 | 涉及 delta specs | 设计章节 |
|---|---|---|---|
| FN-10.13 HarnessBench 评测 | 增大隔离 candidate 的单模型调用预算，并固定同机 mock endpoint 暴露方式 | `harnessbench-evaluation` | 本文件 |

## FN-10.13 HarnessBench 评测

### 目标与规范依据

- ADDED: 候选模型调用与任务执行采用分层预算
- ADDED: 本机 mock endpoint 不依赖公网 tunnel

### 当前事实与 GAP

首次全量运行的 41 个非成功 execute task 中，原始结果可归类为 37 个 `MODEL_TIMEOUT`、1 个 `STREAM_WAIT_FAILED`，另有 3 个 task 未形成上游结果。短模型调用预算和公网 tunnel 前置条件会在任务能力得到验证前中断评测。

已有提交已把 candidate 模型调用预算从 `120,000 ms` 调整为 `300,000 ms`，并向 HarnessBench task hook 传入 `HARNESSBENCH_PUBLIC_URL_TEMPLATE={local_url}`；但提交时没有对应 OpenSpec change，也没有自动化测试锁定这两个行为。定向验证中，先前以 `MODEL_TIMEOUT` 结束的 task `098-three-source-decision-record-synthesis` 已在 `335.963 s` 内完成并取得合法评分，证明该 task 在预算调整后恢复；该证据不单独证明某一次模型调用耗时超过 `120,000 ms`。task `078-local-api-cursor-retry-ledger` 已能够启动本机 mock endpoint 并执行模型请求，但该次定向运行未形成最终上游结果，因此不作为完整计分通过证据。

### 唯一实现方案

1. `tests/harnessbench/nextagent-cli.mjs` 继续作为隔离 candidate 配置 owner。将配置对象构造抽成无副作用函数，模型 profile 固定 `timeoutMs: 300000`，写盘函数只负责 candidate 文件落地。
2. `tests/harnessbench/run.mjs` 继续作为评测 task 环境 owner。将最终 task 环境构造抽成无副作用函数，按“调用者环境、固定评测环境”的顺序合并并固定返回 `HARNESSBENCH_PUBLIC_URL_TEMPLATE: '{local_url}'`；`tests/harnessbench/harness-runner.mjs` 只附加当前 run 的 harness config 路径。
3. 在既有 `tests/harnessbench/tests/` 目录增加配置边界回归测试，分别验证分层预算和外部 URL template 覆盖。测试不启动真实 provider，也不修改产品默认配置。

不增加通用配置项：这些数值和 URL template 是当前固定 HarnessBench profile 的评测不变量，不是产品配置能力。也不在本 change 中处理 output token 截断、session memory、报告诊断或 oracle 环境问题。

### 新目录架构评审

本 change 只新增 OpenSpec 工作流生成的标准目录 `openspec/changes/harden-harnessbench-execution-reliability/` 及其 `specs/harnessbench-evaluation/` delta 目录。owner 为 OpenSpec 变更治理；职责分别是承载该 active change 的 proposal、spec、design、tasks 和 `FN-10.13` 的增量契约；生命周期从 active change 创建持续到完成归档，归档后增量契约进入 stable spec、change 目录进入 `archive/`。这两个目录不进入 TypeScript build、产品 package 或运行时加载路径，不改变打包产物。评审结论：PASS。

### 安全与可靠性边界

- `{local_url}` 只由同机 HarnessBench hook 展开为 loopback mock endpoint，不扩大 Agent 的公网访问能力。
- 候选模型调用预算小于 adapter task 进程预算和已接受请求 terminal 等待预算，仍保留取消与 `timed_out` 终态。
- 两个纯构造函数分别拥有隔离 candidate 配置和最终 task 环境，只服务评测实现与测试，不进入产品 package public exports。

### 并行 change 协调

并行 change `refine-harnessbench-scoring-denominator` 修改同一 canonical spec 中既有的五个 Requirement；本 change 只新增两个名称唯一的 Requirement，不修改相同 Requirement block。归档时需要先合并两组不重叠 delta，再同步 `FN-10.13` 的处理过程和规格表。

## 验证策略（Verification Strategy）

| 层 | 验证方法 |
|---|---|
| regression | 构造 candidate 配置并断言单模型调用预算为 `300,000 ms` |
| negative case | 在调用者环境设置外部 URL template，断言 task 环境仍固定为 `{local_url}` |
| existing integration | 运行 HarnessBench 全量测试目录，确保 workspace bridge、真实本地 runtime 测试和评分测试不回退 |
| OpenSpec | 分别严格校验两个 active change，并运行全量严格校验 |

## 长期基线刷新计划（Baseline Promotion Plan）

- 向 `openspec/specs/harnessbench-evaluation/spec.md` 合并两个 ADDED Requirements。
- 在 `FN-10.13 HarnessBench 评测` 的处理过程增加分层预算和同机 endpoint 行为。
- 在该 Function 的规格表增加执行预算与本机 mock endpoint 暴露方式；同时与 `refine-harnessbench-scoring-denominator` 的规格修改合并。

## 风险与取舍（Risks / Trade-offs）

- 更长的单模型调用可能拉长失败反馈时间，但 `600 s` task 总预算仍提供确定上界。
- 本机 URL 只适用于 Agent 与 mock endpoint 同机的标准评测拓扑；远程 Agent 拓扑不属于本 change。
- 已推送提交中对失败数量的概括无法通过源码文档修改来改写；本 change 以原始结果重新核对后的 `37 + 1 + 3` 分类作为受控证据，避免继续传播错误数字。
