## Why

NextAgent 开发者和质量负责人在复核 HarnessBench 全量结果时，当前报告会把部分多轮任务已经产生的明确失败证据折叠为 `harness_process/UNKNOWN`。同一运行也无法区分“模型输出曾达到候选上限”与普通 terminal 失败，导致维护者只能重新解析原始 transcript，既增加定位成本，也容易把可恢复观测误当成任务根因。

本次全量评测还暴露出一组需要持续复测的失败类型：多轮会话失败、HarnessBench 本地辅助服务失败和模型输出达到上限。现有定向 profile 分散覆盖其中部分场景，不能用一个固定入口验证这些诊断能力是否回归，因此需要先补齐 TestHarness 自身的证据保真和恢复回归边界，再把确认属于产品能力的问题交回对应产品 change。

## 目标与非目标（Goals / Non-Goals）

**目标：**

- 多轮 task 的报告能够从全部 adapter 轮次保留最后一个明确安全失败阶段与原因码，并记录任一轮是否已观测到工作区结果；失败 terminal 没有公开安全原因码时使用闭集 fallback，避免退化为 `UNKNOWN`。
- 报告能够以独立布尔观测事实说明模型输出是否曾达到候选配置上限；该事实不得改写上游 terminal 状态、失败原因或计分结论。
- 提供一个版本控制内的非计分恢复回归 profile，固定覆盖本轮已确认的多轮诊断、本地辅助服务和输出上限代表任务。
- JSON 与 Markdown 报告保持一致且只暴露安全枚举、计数、布尔值和相对证据引用。

**非目标：**

- 不修复产品侧会话记忆、`AskUserQuestion` 参数兼容、模型规划或任务完成能力。
- 不提高候选模型输出上限、模型超时或 task 超时，也不把达到上限等同于失败。
- 不改变 HarnessBench task、oracle、评分规则、固定分母、task terminal 状态或自动重试资格。
- 不修改 `packages/**`、公共产品契约、默认 Agent、默认模型或发布门禁。

## What Changes

- 修改 HarnessBench 安全诊断输出：逐 task 汇聚全部 adapter 轮次的安全证据，使用最后一个明确失败证据形成失败阶段和原因码，并以“任一轮已观测”为准汇总工作区结果。
- 收敛 terminal fallback：公开 stream reason 继续优先；缺少公开原因码的 `failed` terminal 使用 `TERMINAL_FAILED`，timeout 与 cancel 保留既有闭集映射。
- 新增模型输出上限观测：逐 task 和汇总报告记录是否有模型轮次达到候选配置的输出 token 上限，但不由该观测推导失败原因或改变终态。
- 新增固定的非计分恢复回归 profile，覆盖 `007-session-memory`、`078-local-api-cursor-retry-ledger`、`081-local-html-dom-form-extract`、`088-api-contract-mock-client-compat` 和 `091-financial-close-reconciliation`。
- 修改人工可读摘要，使安全失败阶段、原因码和输出上限观测可直接审阅，并与机器报告保持一致。

## Feature 影响（Features）

### 新增 Feature

无。

### 修改的 Feature

- `F-10.13 HarnessBench 能力评测`：开发者和质量负责人可以直接从报告复核多轮失败的安全诊断与模型输出上限观测，并通过固定恢复 profile 重跑代表任务；正式计分语义保持不变。

### 移除的 Feature

无。

## Function 影响（OpenSpec Capabilities）

### 新增 Function

无。

### 修改的 Function

- `FN-10.13 HarnessBench 评测` → `specs/harnessbench-evaluation/spec.md`
  - 功能边界：从 HarnessBench terminal 与多轮 adapter 结果生成保真的安全失败诊断和独立输出上限观测，并提供覆盖剩余代表失败类型的固定非计分恢复回归入口。
  - 系统质量属性：可诊断性、审计/可追溯性、可靠性/恢复、可测试性。
  - 映射说明：canonical spec `harnessbench-evaluation`；本 change 仅触及该 spec。

## 影响范围（Impact）

- 开发者与质量负责人会在新生成的 JSON 和 Markdown 报告中看到新增的输出上限观测，以及从多轮结果恢复出的更具体安全失败诊断。
- 自动消费私有 HarnessBench 报告的本仓测试需要适配报告 schema 版本和新增字段；产品公共 API 与外部系统不受影响。
- 定向回归会增加一个按需命令；它保持 `nonScoring`，不进入默认测试或发布阻断门禁。
- 实施和验证范围集中在 `tests/harnessbench/**` 与本 active change 文档。
