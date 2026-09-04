## Why

业务开发调测者查看 Agent 执行过程时，`Skill`、`Agent` 和普通 Tool 生命周期下的 `ApiCall` 只显示 wrapper 类型，无法确认实际调用了哪个技能、子智能体或 API。把结果级别配置为 `SUMMARY` 或 `DETAIL` 也不能解决该问题，因为没有安全结果投影的运行时 Capability 必须继续收窄为 `STATUS_ONLY`。

这使开发者难以判断编排是否选择了正确执行对象，也难以在 live 与刷新后的历史中复核同一次调用。系统需要在不开放调用参数和结果正文的前提下，提供一个最小、稳定的技术身份。

本 change 将**技术目标名称**定义为模型工具调用中已有、用于精确选择受治理执行对象的技术标识；它不是本地化业务名称，也不表达结果披露权限。

## 目标与非目标（Goals / Non-Goals）

**目标：**

- 业务开发调测者可以在 `Skill`、`Agent` 和普通 Tool 生命周期下的 `ApiCall` 过程标题中看到实际技术目标名称。
- 技术目标名称在执行中、完成后以及刷新历史后保持一致。
- 名称缺失、格式非法或关联无法证明时，过程条目继续使用现有 wrapper 标题安全降级，不影响其他过程内容和最终答案。
- `STATUS_ONLY`、`SUMMARY`、`DETAIL` 继续只控制成功结果披露；技术目标名称不提高结果安全上限。

**非目标：**

- 不新增中文或英文业务名称、业务动作翻译或集成方名称配置。
- 不显示 Bash 命令、Python 脚本名、Agent prompt、Skill args、ApiCall 请求参数或其他调用参数。
- 不为当前没有普通 Capability 过程卡片的直接 ApiCall 路径新增卡片。
- 不为缺少安全结果投影的运行时 Capability 开放结果正文。
- 不修改 `Bash`、`Read` 或其他运行时 Capability 的生产默认结果显示级别。

## What Changes

- `Skill`、`Agent` 和普通 Tool 生命周期下的 `ApiCall` 在已有调用关联可以证明且目标技术标识合法时，公共过程事件增加一个可选技术目标名称。
- Agent Web 将 wrapper 类型、技术目标名称和既有状态组合为一个过程标题，并在同一调用的后续结果与完成状态中保留该名称。
- 无法安全形成名称时，系统省略该字段并保持现有 wrapper 标题；不得从结果正文或其他参数恢复名称。
- 现有 `Bash`、`Read` `DETAIL` 配置继续显示平台已有的有界安全详情，本 change 不改变其内容、截断或默认级别。

## Feature 影响（Features）

### 新增 Feature

无。

### 修改的 Feature

- `F-2.4 查看请求状态`：业务开发调测者可以识别 wrapper 实际执行的技术目标，同时保持结果披露和安全降级边界不变。

### 移除的 Feature

无。

## Function 影响（OpenSpec Capabilities）

### 新增 Function

无。

### 修改的 Function

- `FN-2.4 查看请求状态` → `specs/ts-run-status-visibility/spec.md`
  - 功能边界：Capability 生命周期过程标题增加可选、受限的技术目标名称，并定义缺失、非法和关联失败时的降级行为。
  - 系统质量属性：安全、可靠性/恢复、可维护性、可测试性。
  - 映射说明：canonical spec。

## 影响范围（Impact）

- 公共 Web stream payload 增加一个可选字段；旧客户端可以忽略，新客户端面对旧服务或旧历史时继续使用现有降级标题。
- live、SSE、WebSocket、刷新后的 run-event history 以及 Agent Web 三种宿主使用同一名称投影规则。
- Agent Web 过程标题和相关自动化测试受到影响；卡片结构、折叠、状态、结果正文和最终答案不受影响。
- Gateway、Runtime 持久化、Message schema、数据库和部署默认配置不受影响。
