## Why

在 Windows 上运行固定 HarnessBench 基线时，Agent 开发者会看到部分 task 已完成真实 NextAgent 请求并生成工作区结果，但上游 Oracle 随后因 `python3` 命令不可用而无法执行。该失败来自评测主机的 Python 命令名差异，不是 NextAgent 框架行为；它会把有效工作错误地归入低分或评分失败，降低完整评测的可比性和诊断可信度。

当前评测入口已经预检并选定一个可工作的 Python 解释器，却没有保证上游 task 子进程通过其固定命令名调用到同一解释器。08-14 全量运行中的 083、085 已出现该偏差，因此需要在下一轮计分前消除。

## 目标与非目标（Goals / Non-Goals）

**目标：**

- Windows 标准全量和定向 HarnessBench 运行在 task 执行前，为上游子进程提供可用的 `python3` 命令，并保证它调用本次运行已预检的 Python 解释器。
- 该命令只在本次评测运行范围内生效，不改变调用者机器的全局环境。
- 无法建立或验证该命令时，在第一个 task 前失败，避免生成受工具链偏差污染的评分。

**非目标：**

- 不修改固定 HarnessBench commit、task、Oracle、rubric 或评分公式。
- 不修改 `packages/**`、NextAgent 产品公共契约或产品运行时的 executable policy。
- 不改变 Linux 等已原生提供 `python3` 的主机行为。
- 不把 rubric 内容截断或已有模型/工作区副作用后的评分失败纳入自动重试。

## What Changes

- 新增 Windows HarnessBench 上游 Python 命令一致性保证：上游 task 通过 `python3` 启动 Python 时，必须进入本次运行已经预检的解释器。
- 新增 fail-closed 前置条件：评测入口无法建立该运行级命令或不能确认其解释器身份时，不得开始 task 执行。
- 限定命令别名作用域为当前评测运行；评测不得写入系统 Python 安装、用户级 `PATH` 或固定上游目录。

## Function 影响（OpenSpec Capabilities）

### 新增 Function

无。

### 修改的 Function

- `FN-10.13 HarnessBench 评测` → `specs/harnessbench-evaluation/spec.md`
  - 功能边界：Windows 评测运行增加上游 Python 命令一致性前置条件，使 Oracle 与 task hook 使用已预检解释器；失败时在 task 执行前终止。
  - 系统质量属性：可靠性/恢复、可测试性、审计/可追溯性。
  - 映射说明：canonical spec。

## 影响范围（Impact）

- Windows 评测运维不再依赖机器额外安装名为 `python3` 的启动器。
- 评测运行会在自身输出根下生成临时工具链文件，并只向 HarnessBench task 子进程覆盖 `PATH`。
- 受影响实现和验证集中在 HarnessBench runner、前置检查及无凭据回归测试；产品 package 和发布 artifact 不受影响。
