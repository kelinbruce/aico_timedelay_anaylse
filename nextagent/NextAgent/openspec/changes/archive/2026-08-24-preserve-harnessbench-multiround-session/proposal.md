## Why

NextAgent 开发者使用 HarnessBench 多轮任务验证会话连续性时，同一个上游 session 的每一轮当前都会得到一个全新的候选运行目录和 NextAgent session。第二轮因此无法访问第一轮已经持久化的会话事实，`007-session-memory` 会把 TestHarness 生命周期重置表现为产品会话记忆失败，使评测结论失真并阻塞业务问题定位。

## 目标与非目标（Goals / Non-Goals）

**目标：**

- 同一个 HarnessBench session 的后续轮次复用首次创建的候选数据根和 NextAgent session。
- 不同 HarnessBench session 继续使用互不共享的候选数据根和 NextAgent session。
- 首轮初始化未完成或持久化映射非法时安全重建，不使用部分状态继续执行。
- 多轮复用仍通过公开 session、request 和 stream 产品边界执行。

**非目标：**

- 不修改产品 session、memory、context、runtime persistence 或公共 API。
- 不跨 task、跨评测 run 复用状态。
- 不提高模型输出上限、模型超时或 task 超时。
- 不为 HarnessBench task 注入答案、memory 或产品侧兼容逻辑。

## What Changes

- 修改 HarnessBench 候选执行生命周期：首次轮次初始化候选并创建 NextAgent session，后续同 session 轮次复用其持久化数据和 session identity。
- 新增私有、版本化的 session 映射状态；映射缺失时按首轮初始化，映射非法时拒绝复用并安全失败。
- 保持每轮独立启动和停止 local runtime，使运行进程有界，同时保留候选根中的持久化事实。
- 增加多轮集成回归，验证同 session 复用、不同 session 隔离和非法映射失败。

## Feature 影响（Features）

### 新增 Feature

无。

### 修改的 Feature

- `F-10.13 HarnessBench 能力评测`：多轮 HarnessBench task 能验证真实 NextAgent 会话连续性，不再因 TestHarness 每轮重置产生伪失败。

### 移除的 Feature

无。

## Function 影响（OpenSpec Capabilities）

### 新增 Function

无。

### 修改的 Function

- `FN-10.13 HarnessBench 评测` → `specs/harnessbench-evaluation/spec.md`
  - 功能边界：同一 HarnessBench session 的多轮请求复用同一候选持久化边界和 NextAgent session，不同 session 保持隔离。
  - 系统质量属性：可靠性/恢复、可测试性。
  - 映射说明：canonical spec `harnessbench-evaluation`；本 change 仅触及该 spec。

## 影响范围（Impact）

- 多轮 task 的第二轮开始能够观察第一轮通过真实产品路径持久化的会话事实。
- 单轮 task、不同 task、全量计分公式、报告 schema、grader 和上游 HarnessBench 不受影响。
- 实施范围集中在 `tests/harnessbench/**` 与本 active change。
