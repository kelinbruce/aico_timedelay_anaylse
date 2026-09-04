## Why

Agent 开发者和运维人员当前只能逐行阅读插件开发诊断 NDJSON，无法直接看出一次请求经过的 hook 阶段、相邻事件时序和原始边界数据。同一文件包含多个会话或请求时，人工筛选还容易把不同执行轨迹混在一起，降低模型与 Tool 调用问题的复盘效率。

## 目标与非目标（Goals / Non-Goals）

**目标：**

- 允许使用者导入一份本地 UTF-8 NDJSON，并按 `sessionId` 与 `requestId` 的精确组合查看其中每条执行轨迹。
- 以有序流程展示轨迹事件的阶段、时间、相邻耗时、关键坐标和完整原始记录。
- 单行损坏或缺少轨迹坐标时保留其他合法轨迹，并向使用者报告被忽略记录及原因。
- 查看过程保持离线、只读，不上传、不持久化导入内容，也不依赖正在运行的 NextAgent 服务。

**非目标：**

- 不新增或修改 `developer-hook-trace` 实现、artifact helper、插件 manifest、插件 host API、Web API、stream event、runtime command 或 `agent-contracts`。
- 不负责生成、轮转、保留、上传或修改 developer diagnostic artifact。
- 不提供跨文件合并、实时追踪、全文检索、统计分析或轨迹编辑。
- 不把该能力并入开发工作台或浏览器产品前端。

## What Changes

- 新增可直接打开的插件诊断轨迹查看器，接受使用者选择的一份本地 NDJSON 文件。
- 新增按 `sessionId` 与 `requestId` 精确组合形成轨迹的规则，并允许在同一导入结果中的全部轨迹间切换。
- 新增事件流程视图和记录详情视图；对合法事件确定排序，对非法行和缺失坐标的记录局部降级。
- 新增阶段核心指标摘要：规划前展示输入问题，模型结果后展示首次反馈时延、模型端到端时延、provider usage 和 Tool 调用，能力调用前展示目标 Capability。
- 新增离线和只读保证；查看器不向网络、浏览器持久存储或 NextAgent 运行时发送导入内容。

## Feature 影响（Features）

### 修改的 Feature

- `F-10.2 装配插件`：为官方开发诊断插件增加 `FN-10.33` 伴随查看能力，使开发者和运维人员可离线复盘插件产物，同时保持插件装配与运行时权限边界不变。

## Function 影响（OpenSpec Capabilities）

### 新增 Function

- `FN-10.33 查看插件诊断轨迹` → `specs/plugin-diagnostic-trace-viewer/spec.md`
  - 功能边界：系统从使用者选择的一份本地 developer diagnostic artifact NDJSON 中识别全部 `(sessionId, requestId)` 执行轨迹，并以有序流程和原始记录详情呈现选定轨迹；非法记录只影响自身。
  - 系统质量属性：安全、可靠性/恢复、可维护性、可测试性、审计/可追溯性。

### 修改的 Function

无。

## 影响范围（Impact）

- 本地运行包中的官方开发诊断插件目录会增加一个可直接打开的 HTML 伴随文件；插件实现、artifact helper、manifest 和主入口保持不变。
- 本地运行包会随该插件交付查看器；未启用插件时查看器仍可独立打开并导入已有文件。
- 插件 SDK 的产物生成测试、本地运行包边界测试和独立浏览器行为测试会受影响。
