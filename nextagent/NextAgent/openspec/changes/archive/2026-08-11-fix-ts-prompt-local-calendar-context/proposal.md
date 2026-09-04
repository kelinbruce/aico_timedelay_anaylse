## Why

非 UTC 部署在本地日期与 UTC 日期不同时，Prompt Template 当前可能同时向模型提供进程本地时区和前一天或后一天的 UTC 日期，影响“今天”“昨天”等运维任务的判断。现有测试没有覆盖正、负时区的跨日窗口。

## 规范上下文

- Prompt Template 的日历时区继续是 Node.js 进程本地时区，并在进程生命周期内保持固定。
- 未配置用户时区时，不从 locale、请求内容或浏览器环境推断时区。

## 目标与非目标（Goals / Non-Goals）

**目标：**

- 同一次 Prompt Template 渲染中的 `timezone` 与 `currentDate` 表达同一个进程本地日历事实。
- Workflow RESTful 时间参数的代码说明准确表达其既有进程本地语义。

**非目标：**

- 不新增 per-user、per-request 或 agent-scoped timezone contract。
- 不改变 Prompt Template render context 的公共 shape 或 variable resolver。
- 不改变 Workflow RESTful 时间参数的解析、格式化、输入输出或失败行为。
- 不新增 clock port、共享 calendar abstraction、配置、前端能力或日期依赖。

## What Changes

- `currentDate` 必须表示 `timezone` 所声明进程时区中的当前 `YYYY-MM-DD` 日历日期。
- 修正 Workflow RESTful 时间参数的非规范性代码说明，使其不再误称“用户时区”。

## Feature 影响（Features）

### 修改的 Feature

- `F-10.4 自定义工具与提示词`：Agent 开发者和最终用户可以依赖模型提示词中的时区与当前日期表达同一个本地日历事实。

## Function 影响（OpenSpec Capabilities）

### 新增 Function

无。

### 修改的 Function

- `FN-10.4 自定义工具和提示词` → `specs/prompt-template-assembly/spec.md`
  - 功能边界：收紧受治理 `timezone` 与 `currentDate` 变量的同一日历语义。
  - 系统质量属性：可靠性/恢复、可测试性。
  - 映射说明：`prompt-template-assembly` 是 canonical spec；不触及 legacy spec。

## 影响范围（Impact）

- 最终用户：非 UTC 时区跨日窗口内，模型获得一致的时区和日期。
- 运维：现有部署时区仍决定进程本地日历；无需新增配置。
- 公共契约：无 Web API、context contract 或 `agent-contracts` 变更。
- 代码与测试：Prompt Template render context、其直接测试及一处 Workflow 注释受到影响。
