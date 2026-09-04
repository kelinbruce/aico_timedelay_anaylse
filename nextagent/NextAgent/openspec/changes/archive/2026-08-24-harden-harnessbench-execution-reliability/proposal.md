## Why

运行 HarnessBench 全量评测的 Agent 开发者当前会遇到两类与任务能力无关的执行中断：真实模型在长上下文调用超过评测候选的模型调用预算后以 `MODEL_TIMEOUT` 终止；需要本机 mock HTTP endpoint 的任务在未安装公网 tunnel 工具时会在模型请求前失败。首次全量运行中，这两类问题分别影响 37 个 task 和 3 个 task，使可执行任务无法形成真实的能力结论，并掩盖模型与框架在任务上的实际表现。

这些任务的评测进程与 terminal 等待预算允许更长的模型调用，且 Agent 与 mock endpoint 位于同一可信本机边界，因此需要扩大候选模型调用预算，并为本机评测明确提供本地可达的 mock endpoint URL。

## 目标与非目标（Goals / Non-Goals）

**目标：**

- 全量与定向 HarnessBench 运行中的单次候选模型调用具有 `300,000 ms` 的确定预算，同时 generic CLI adapter task 进程和已接受请求的 terminal 等待继续分别受 `600 s` 预算约束。
- 运行器为同机执行的 HarnessBench mock endpoint 提供本地 URL，使依赖该 endpoint 的 execute task 不要求安装公网 tunnel 工具。
- 自动化测试能够重复验证上述两项运行配置，避免后续回退到短模型预算或公网 tunnel 前置条件。

**非目标：**

- 不改变模型输出 token 上限，不处理达到 `maxOutputTokens` 后的输出截断。
- 不改变 session memory、terminal、stream、报告诊断、评分公式、grader 或 oracle 环境。
- 不启用当前清单中标记为 `unsupported` 的浏览器或公网访问任务。
- 不改变 NextAgent 产品默认模型配置；本 change 只修改隔离的 HarnessBench candidate 配置。

## What Changes

- 全量与定向 HarnessBench 运行生成的隔离 candidate MUST 将单次模型调用预算设为 `300,000 ms`；generic CLI adapter task 进程和已接受请求的 terminal 等待预算仍分别为 `600 s`。
- 标准 HarnessBench 运行 MUST 为 task hook 提供值为 `{local_url}` 的 `HARNESSBENCH_PUBLIC_URL_TEMPLATE`；hook 据此向同机 Agent 暴露本地 mock endpoint，且不启动公网 tunnel。
- 运行器 MUST 以固定评测值覆盖调用者进程中的同名 URL template，避免外部环境把标准本机评测重定向到非本机地址。

## Function 影响（OpenSpec Capabilities）

### 新增 Function

无。

### 修改的 Function

- `FN-10.13 HarnessBench 评测` → `specs/harnessbench-evaluation/spec.md`
  - 功能边界：修改 execute task 通过真实 NextAgent 产品边界运行时的模型调用预算和本机 mock endpoint 可达性保证；不改变 task catalog、评分或产品默认配置。
  - 系统质量属性：可靠性/恢复、可测试性。
  - 映射说明：canonical spec；无 legacy spec 迁移。

## 影响范围（Impact）

- Agent 开发者运行全量或定向评测时，无需安装 `cloudflared` 即可执行依赖本机 mock endpoint 的 task。
- 单次长上下文模型调用可使用更大的时间窗口；adapter task 进程和已接受请求的 terminal 等待仍各有 `600 s` 上界。
- 受影响实现与验证位于 `tests/harnessbench/**`；不新增产品公共 API、公共 contract、依赖或持久化事实。
