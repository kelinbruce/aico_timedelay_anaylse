## Why

电信运维人员依赖 Cron 任务在预期的本地日历时刻触发。当前进程在夏令时秋季回退后的第二个重复小时内计算下一次 Cron 命中时，可能得到早于计算起点的绝对时间，导致新建或推进后的任务被提前视为到期。现有测试也没有覆盖 DST 重叠、DST 缺口和严格未来顺序。

## 规范上下文

- 本 change 的 Cron 日历时区继续是 Node.js 进程本地时区，并在进程生命周期内保持固定。
- `nextRunAt`、到期比较和持久化时间继续使用 UTC epoch milliseconds。
- 未配置任务时区时，不从 locale、请求内容或浏览器环境推断时区。

## 目标与非目标（Goals / Non-Goals）

**目标：**

- 下一次 Cron 日历命中严格晚于计算起点。
- DST 春季缺口中的不存在本地时间不产生当日命中。
- DST 秋季重叠中的同一本地日历分钟只采用较早 offset 一次，且不得从第二个重复小时回到过去。

**非目标：**

- 不新增 per-task、per-user 或 request-scoped timezone contract。
- 不新增 Cron timezone 配置，不改变部署通过进程时区选择默认日历的方式。
- 不修改 Cron task Record、SQLite schema、Web API、前端 DTO、scheduler 或 trigger claim。
- 不引入 Temporal、Luxon、Moment、date-fns 或其他日期时间依赖。

## What Changes

- 收紧 Cron 日历匹配：下一次命中必须严格晚于输入起点。
- 固化 DST 春季缺口跳过和秋季较早 offset 单次命中行为。

## Feature 影响（Features）

### 修改的 Feature

- `F-10.9 Cron 工具`：运维人员可以依赖下一次 Cron 日历命中始终位于计算起点之后，并在 DST 切换日获得确定的单次触发语义。

## Function 影响（OpenSpec Capabilities）

### 新增 Function

无。

### 修改的 Function

- `FN-10.9 Cron 工具` → `specs/cron-tools/spec.md`
  - 功能边界：收紧五段本地时间 Cron 的下一次日历命中顺序和 DST 缺口/重叠行为。
  - 系统质量属性：可靠性/恢复、可测试性、审计/可追溯性。
  - 映射说明：`cron-tools` 是 canonical spec；不触及 legacy spec。

## 影响范围（Impact）

- 最终用户：DST 回退窗口内不会因过去的 `nextRunAt` 导致 Cron 任务提前到期。
- 运维：现有部署时区仍决定进程本地日历；无需新增配置或迁移数据。
- 公共契约：无 Web API、gateway、runtime 或 `agent-contracts` 变更。
- 代码与测试：仅 Cron 表达式求值及其直接单元测试受到主动影响；LOCAL scheduler 只做回归验证。
