## 设计范围

| Function | 本次目标变化 | 涉及 delta specs | 设计章节 |
|---|---|---|---|
| `FN-4.1 调用模型` | 内置默认模型 profile 的显式单次逻辑调用超时调整为 300 秒 | `model-invocation-contract` | `FN-4.1 调用模型` |

## `FN-4.1 调用模型`

### 目标与规范依据

内置默认系统配置必须为复杂、多轮任务提供 300 秒的单次逻辑模型调用窗口，同时继续允许部署方显式覆盖，并保持底层字段缺失 fallback 不变。

#### 本 Function 的目标 Requirements

canonical spec：`model-invocation-contract`

- `MODIFIED`：`Agent App system config 使用 canonical model/provider 配置`

### 当前实现

内置 `default-system.yaml` 的默认模型子 profile 显式配置 `timeoutMs: 120000`。配置解析保留并冻结该值，模型目录将其解析为 `defaultTimeoutMs`，模型调用边界再结合调用级覆盖和剩余 execution budget 得出 effective timeout。现有配置测试和主路径测试固定断言 120 秒。

### GAP 分析

| 规范目标 | 当前事实 | GAP |
|---|---|---|
| 内置默认模型 profile 显式使用 `300000 ms` | 配置、测试和用户说明仍为 `120000 ms` | 默认配置及其可观察投影未达到目标值 |

### 修改方案

唯一实现路径是在内置默认系统配置中把默认模型子 profile 的 `timeoutMs` 修改为 `300000`，并同步解析配置及 App 主路径的契约断言。配置 schema、目录解析、调用级覆盖和模型边界均复用现有路径，不新增配置字段、私有状态或超时计算分支。

用户显式配置继续作为可信启动配置进入同一解析路径；本 change 不修改 `ModelProfile.timeoutMs` 缺失时的 `30000 ms` fallback，不修改 execution budget 对 effective timeout 的上限约束，也不改变超时后的安全失败语义。

用户配置说明同步展示 300 秒。历史评测报告保留当时观测值，不做追溯修改。

#### 质量属性影响

| 质量属性 | 规范依据 | 本 Function 内实现机制 | 验证关注点 |
|---|---|---|---|
| 可靠性/恢复 | 无新增黑盒质量目标；由本次功能性 Requirement 派生 | 扩大内置 profile 的等待窗口，减少慢模型的误超时 | 默认值生效且显式覆盖、底层 fallback 不变 |
| 可测试性 | 无新增黑盒质量目标；由本次功能性 Requirement 派生 | 使用配置解析和产品主路径断言固定默认值 | 配置源、解析结果和发布产物保持一致 |

## 验证策略（Verification Strategy）

配置 unit tests 验证 YAML 解析及冻结后的 profile 值；contract/agent-kernel tests 验证产品 App 暴露并消费相同的 300 秒值；发布构建验证默认配置被原样打包。OpenSpec 严格校验确保 delta 与稳定 Requirement 精确合并。显式用户覆盖和字段缺失 fallback 由既有模型配置测试继续覆盖。

## 长期基线刷新计划（Baseline Promotion Plan）

- `openspec/specs/model-invocation-contract/spec.md`：归档时将内置默认 profile 的显式超时更新为 `300000 ms`。
- `openspec/designs/functions/D4-模型与上下文/D4.1-模型调用与降级/FN-4.1-调用模型.md`：更新内置默认 profile 规格，保留字段缺失 fallback 的现有规格。
- Feature：无。
- `openspec/overview.md`：无。
- `openspec/designs/architecture/model-provider-boundary.md`：无，超时解析架构不变。
- `openspec/designs/modules/agent-app.md`：无，配置 owner 和装配路径不变。
- ADR：无。
- `openspec/designs/spec-to-design-map.md`：无，导航关系不变。

## 风险与取舍（Risks / Trade-offs）

默认等待时间增加后，真实无响应的上游模型可能需要更久才返回超时失败。请求总 execution budget 和取消信号继续限制实际等待时间；部署方也可以针对已知快速模型显式配置更短超时。

## 待确认问题（Open Questions）

无。
