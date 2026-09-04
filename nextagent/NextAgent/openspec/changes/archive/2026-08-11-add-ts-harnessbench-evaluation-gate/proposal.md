## Why

NextAgent 开发者和质量负责人目前只能通过仓库内的契约、架构和产品旅程门禁判断已定义行为是否回归，无法使用公开的 HarnessBench 任务集量化 Agent 在文件操作、工具使用和多步骤任务中的完成质量。缺少统一评测入口还会导致不同人员自行选择任务、模型和计分口径，所得分数不可比较，也无法追溯本次得分对应的 NextAgent 版本、HarnessBench 版本和模型。

HarnessBench 已提供任务、结果 oracle、过程评分和安全评分。现在需要把它作为独立的外部能力评测接入 NextAgent，使维护者能够在不改变被测产品代码和公共契约的前提下执行真实模型评测，并获得可复核的分数与覆盖证据。

## 术语

- **全量评测清单**：固定 HarnessBench commit 中的全部 task id，以及每个 task 的执行或不支持结论；任一 task 缺失或重复都会使本次全量评测无效。
- **框架效果得分（`frameworkEffectScore`）**：全量评测清单中每个 task 的归一综合分之和除以 task 总数；框架不支持或执行失败的 task 以 `0` 分计入，不能通过排除任务提高得分。

## 规范上下文

| 上下文 | 目标约束 |
|---|---|
| 被测对象 | 当前工作树构建出的 NextAgent local runtime，不使用为单个任务编写的替代实现 |
| HarnessBench 基线 | 由评测配置固定到可解析的 Git commit；同一报告只对应一个 commit |
| 模型模式 | 框架效果评测只接受真实模型；确定性或 mock 模型运行不产生 `frameworkEffectScore` |
| 评测范围 | 框架效果评测固定覆盖该 HarnessBench commit 的全部 task；当前默认 commit 共 106 个 task |

## 目标与非目标（Goals / Non-Goals）

**目标：**

- 提供一个可重复执行的 HarnessBench 全量评测入口，一次运行覆盖固定 commit 的全部 task，并通过真实 NextAgent 产品边界验证框架能力。
- 支持接入真实模型，并验证获得非零分的 task 确实产生模型调用用量；全量运行缺少有效真实模型前置条件时不得发布框架效果得分。
- 在首个计分 task 前分别验证候选模型和 HarnessBench grader；grader 配置、鉴权或返回结构无效时不得开始全量计分运行。
- 采用 HarnessBench 的结果、过程和安全评分形成逐任务综合分，再以全部 task 为固定分母汇总框架效果得分。
- 生成机器可读报告和便于人工审阅的摘要，明确关联 NextAgent 版本、HarnessBench commit、模型标识、评分覆盖、任务清单、逐任务结果、失败阶段、安全原因码和安全证据引用。
- 提供不计分的定向回归 profile，用较小任务集合复现 grader、terminal、sandbox 和评测基础设施问题，且不得从定向运行发布框架效果得分。
- 保持被测 `packages/**` 生产代码和公共契约不变，使评测能力可以独立添加、移除或升级。

**非目标：**

- 不把 HarnessBench 变成 release qualification 的默认阻断门禁，也不为首版规定产品发布阈值。
- 不承诺 NextAgent 能成功完成 HarnessBench 的全部任务类型；浏览器、图像理解、办公应用或当前没有真实产品能力支撑的 task 必须明确记为不支持并以 `0` 分进入框架效果得分。
- 不新增或修改 NextAgent Web API、stream event、runtime command、runtime `Capability` contract、模型契约或持久化契约。
- 不使用 mock 模型、固定答案或直接伪造工作区结果作为计分证据；确定性替身只允许验证评测器自身，所得结果不得形成框架效果得分。
- 不复制或改写 HarnessBench 的 task、oracle 和评分规则作为 NextAgent 自有规范。

## What Changes

- 新增 HarnessBench 全量评测入口，接受固定的上游 commit、真实模型配置和运行预算，并在执行前确认全量评测清单与上游 task catalog 恰好一致。
- 新增真实产品边界执行约束：全部受支持 task 通过当前 NextAgent local runtime 完成，任务工作区作为输入和结果边界；不支持 task 保留明确结论并计零分；不修改被测生产代码或公共契约。
- 新增统一计分行为：保留 HarnessBench 的结果、过程和安全分量，计算逐 task 综合分和框架效果得分；不支持、Agent/模型错误、超时或评分失败均以 `0` 分计入全量分母。
- 新增安全且可追溯的评测报告。报告公开汇总与必要诊断，不包含 credential、认证 token、完整 prompt、完整模型输出或主机绝对路径。
- 新增运行失败语义：上游版本不一致、全量 task catalog 不完整、真实模型前置条件无效、全量 task 未全部形成终态结论或报告不完整时，评测失败且不发布框架效果得分。
- 新增评分完整性与恢复语义：grader 前置条件无效时 fail closed；评分覆盖退化时只发布诊断分数；仅对没有模型请求和工作区结果证据的纯评测基础设施失败执行一次有界重试。

## Feature 影响（Features）

### 新增 Feature

- `F-10.13 HarnessBench 能力评测`：开发者和质量负责人能够从一个测试入口运行固定 HarnessBench 全量任务，并用真实模型获得 NextAgent 框架效果得分；由 `FN-10.13 HarnessBench 评测` 组成。

## Function 影响（OpenSpec Capabilities）

### 新增 Function

- `FN-10.13 HarnessBench 评测` → `specs/harnessbench-evaluation/spec.md`
  - 功能边界：接收固定 HarnessBench 基线和真实模型运行条件，覆盖该基线全部 task，并输出逐任务结论、框架效果得分及可追溯报告。
  - 系统质量属性：安全、可靠性/恢复、可测试性、审计/可追溯性。

### 修改的 Function

无。

## 影响范围（Impact）

- 开发者和质量负责人新增一条按需评测命令及其本地环境准备流程；现有 build、unit、contract、architecture 和 release E2E 命令不变。
- 评测环境需要 Node.js、Python、Git、HarnessBench 依赖、可用的候选模型与 grader 安全引用，以及满足所选任务的本地工具条件。
- 评测运行会产生本地工作区、上游缓存、模型费用和评测报告；这些运行产物不进入版本控制。
- 实施范围集中在新的 HarnessBench 测试目录及其测试，不改变 `packages/**`、公共 API、产品默认 Agent 或发布资格汇总契约。
