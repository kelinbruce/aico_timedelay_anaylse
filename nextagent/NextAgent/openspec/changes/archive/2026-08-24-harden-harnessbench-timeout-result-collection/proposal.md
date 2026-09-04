## Why

运行长耗时 HarnessBench task 的 Agent 开发者当前可能看到模型已经完成多轮调用并产生工作区修改，但评测最终缺少 upstream-result，报告只能把该 task 记为 `harness_process/UNKNOWN`。原因是 generic CLI adapter 的进程预算与 NextAgent terminal 等待预算同为 `600 s`，没有为 runtime 收尾、oracle、rubric 和结果落盘保留时间；当外层进程先达到预算时，评测无法形成可评分且可诊断的终态事实。

全量评测已经出现 11 个此类结果收集失败，导致真实执行证据未进入评分与报告。首次分层到 `900/780 s` 后，08-14 完整评测仍有 7 个复杂 task 达到 task timeout，其中 5 个已形成正向 upstream score 或高过程分，说明结果收集竞争已解决，但复杂 task 的执行窗口仍不足。需要把分层预算收敛到能够覆盖这批已观测任务的下一档确定上界。

## 目标与非目标（Goals / Non-Goals）

**目标：**

- 全量与定向 HarnessBench 运行采用 generic CLI 子进程 `1200 s`、NextAgent terminal 等待 `1080 s` 的确定分层预算，为 CLI runtime cleanup 和 workspace export 保留 `120 s`。
- Python task 进程正常产出 upstream-result 后，即使其 stdout 缺少或包含不可解析的摘要，本地评测运行器仍从该结果文件恢复唯一 task 结论。
- Python task 进程未产出有效 upstream-result 时，报告以闭集原因码区分进程启动失败、非零退出、摘要无效、结果缺失和结果 JSON 无效，不再把已知失败统一降级为 `UNKNOWN`。
- 自动化测试可重复验证预算关系、结果文件恢复和失败分类。

**非目标：**

- 不改变单次模型调用的 `540,000 ms` 预算、模型输出 token 上限、评分公式或 grader/oracle 语义。
- 不根据 task 类型动态分配预算，不增加无限等待或额外基础设施重试。
- 不修改固定 HarnessBench 上游源码或其 Git 基线。
- 不把 NextAgent CLI sidecar 当作 HarnessBench upstream-result；缺少 oracle、rubric 或评分的 CLI 终态不得伪装为 scored 结果。

## What Changes

- 标准全量 profile 的 generic CLI 子进程预算从原始 `600 s` 修改为 `1200 s`，NextAgent 已接受请求的 terminal 等待预算修改为 `1080 s`，系统 MUST 保留恰好 `120 s` 的 CLI runtime cleanup 和 workspace export 余量。
- Python task 进程退出后，系统 MUST 优先读取该 task 的 upstream-result；当结果存在且有效时，stdout 摘要缺失或无效 MUST NOT 使该 task 丢失。
- 当 Python task 进程未形成可恢复的 upstream-result 时，系统 MUST 输出安全、结构化的 harness-process 失败阶段和闭集原因码。
- 预算、结果恢复和失败分类 MUST 由无真实模型凭据的自动化测试覆盖。

## Function 影响（OpenSpec Capabilities）

### 新增 Function

无。

### 修改的 Function

- `FN-10.13 HarnessBench 评测` → `specs/harnessbench-evaluation/spec.md`
  - 功能边界：修改 execute task 的分层执行预算、upstream-result 恢复优先级和已知 harness-process 失败分类；不改变评分、模型或产品默认配置。
  - 系统质量属性：可靠性/恢复、可测试性、审计/可追溯性。
  - 映射说明：canonical spec；无 legacy spec 迁移。

## 影响范围（Impact）

- Agent 开发者运行全量或定向评测时，长耗时 task 的真实执行结果不再因 stdout 摘要解析失败或内外层同时超时而丢失。
- 相对原始 `600 s` 基线，全量评测单 task 最长外层等待增加 `600 s`；相对 08-14 使用的 `900 s` 配置增加 `300 s`，仍有 `1200 s` 确定上界。
- 受影响实现和验证位于 `tests/harnessbench/**`；不新增产品公共 API、公共 contract、依赖、持久化事实或源码目录层级。
