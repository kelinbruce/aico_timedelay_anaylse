# Change: HarnessBench 候选执行固定关闭受限 sandbox

## Why

HarnessBench task 提供的本地 mock API 属于评测工作区的一部分，但当前候选配置统一启用受限 sandbox 且未声明 task 动态端口，导致 Bash/Python 在到达 task 行为前被 `network-target-not-allowed` 拒绝。该基础设施约束会把可执行任务转化为后续 stream 等待或人工输入失败，污染框架效果评测结论。

HarnessBench 候选运行本身处于受控评测环境，后续 task 执行需要固定采用可信 shell 模式。配置必须由评测组合层决定，不能随 task、prompt 或模型输出变化。

## 目标与非目标（Goals / Non-Goals）

### Goals

- HarnessBench 为每个 `execute` task 生成候选配置时显式固定 `sandbox.enabled=false`。
- Bash/Python 动态执行仍经过既有 sandbox gateway owner，只关闭受限本地校验模式。
- 通过自动化测试锁定该配置，保证后续评测任务行为一致、可重复。

### Non-Goals

- 不改变产品配置中 `sandbox.enabled` 的默认值、字段语义或公共契约。
- 不修改 `packages/**`、provider、runtime lifecycle 或 stream recovery 实现。
- 不把可信 shell 模式扩展到 HarnessBench 评测候选运行之外的部署或宿主。

## What Changes

- HarnessBench 候选配置构建器对所有 task 写入 `sandbox.enabled=false`，不再按 task mock API 动态维护 allowlist。
- 配置值仅由评测组合层固定提供，不接受 task 输入、prompt、模型输出或客户端 metadata 覆盖。
- 增加回归断言，验证未来生成的候选配置始终关闭受限 sandbox。

## Function 影响（OpenSpec Capabilities）

- **修改 Function**：`FN-10.13 HarnessBench 评测`
  - 主规格：`harnessbench-evaluation`
  - 边界变化：HarnessBench 候选 task 执行固定使用可信 shell 模式；产品 sandbox 配置契约不变。
  - 质量属性：提高评测可靠性、可重复性和失败诊断真实性，同时把放宽范围限制在受控评测候选进程。

## 影响范围（Impact）

- 影响 `tests/harnessbench/nextagent-cli.mjs` 的候选配置生成及其测试。
- 不影响产品默认配置、公共 API、持久化格式或 package 依赖边界。
- 不涉及 `packages/**` 变更，因此无需进入 package 代码评审范围。
