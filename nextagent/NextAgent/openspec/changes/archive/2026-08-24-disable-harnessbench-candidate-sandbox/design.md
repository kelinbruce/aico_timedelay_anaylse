## 设计范围

| Function | 本次目标变化 | 涉及 delta specs | 设计章节 |
|---|---|---|---|
| `FN-10.13 HarnessBench 评测` | 全部候选 task 执行固定采用可信 shell 模式，且不改变产品默认 sandbox 行为 | `harnessbench-evaluation` | `FN-10.13 HarnessBench 评测` |

## `FN-10.13 HarnessBench 评测`

### 目标与规范依据

HarnessBench 候选运行必须在评测组合边界固定关闭受限 sandbox，使 task 提供的本地 mock API 不被评测基础设施提前拒绝，同时保持动态执行仍由产品 sandbox gateway 承载。该选择只适用于 HarnessBench 候选配置，不改变产品配置契约。

#### 本 Function 的目标 Requirements

canonical spec：`harnessbench-evaluation`

- `ADDED`：`候选任务固定使用可信 shell 模式`

### 当前实现

`tests/harnessbench/nextagent-cli.mjs` 中的 `buildHarnessCandidateConfig` 是每个 HarnessBench 候选进程的配置 owner。该函数当前为所有 task 生成 `sandbox: { enabled: true, deniedExecutables: [] }`，且不配置 task 动态 mock API allowlist。

task 工作区和 task 指令随后通过公开 NextAgent local runtime 路径执行。受限 sandbox 会在 Bash/Python 访问未声明的 task 本地端口时拒绝请求，使失败发生在 task 目标行为之前。现有配置测试只覆盖模型 profile 与运行预算，没有锁定 sandbox 模式。

### GAP 分析

| 规范目标 | 当前事实 | GAP |
|---|---|---|
| 全部 `execute` task 和 attempt 固定 `sandbox.enabled=false` | 候选配置固定 `sandbox.enabled=true` | 配置值与目标相反 |
| task 内容不能改变执行模式 | 配置由评测组合层固定生成，当前没有 task override 路径 | 保留现有 owner 和单向配置路径即可 |
| 动态执行继续经过 sandbox gateway，产品默认值不变 | HarnessBench 仅生成候选配置，没有修改产品 schema 或 gateway | 实施必须限定为 HarnessBench 配置与测试，不触及 `packages/**` |
| 未来变更可重复验证 | 测试没有 sandbox 模式断言 | 增加候选配置的黑盒断言 |

### 修改方案

唯一实现路径是在 `buildHarnessCandidateConfig` 返回的 HarnessBench 候选配置中把字面量 `sandbox.enabled` 从 `true` 改为 `false`，保留现有 `deniedExecutables` shape 和其余配置不变。`buildHarnessCandidateConfig` 继续作为该评测配置的唯一 owner；不新增环境变量、命令行参数、task 分支、动态端口解析或 allowlist 组装。

候选进程仍使用现有 NextAgent composition、公开会话与 stream 路径。`sandbox.enabled=false` 只选择产品已经定义的 trusted shell mode，不绕过 sandbox gateway，也不修改 provider、request lifecycle、stream terminal 或产品默认配置。测试从配置构建函数的公开结果断言固定值，避免绑定内部文本布局。

#### 质量属性影响

| 质量属性 | 规范依据 | 本 Function 内实现机制 | 验证关注点 |
|---|---|---|---|
| 安全 | 无新增黑盒质量目标；依据功能性 Requirement `候选任务固定使用可信 shell 模式` 的范围约束 | 放宽仅存在于受控 HarnessBench 候选配置；不新增外部配置入口，不改产品默认值和 gateway owner | 检查变更范围不包含 `packages/**`，候选配置之外无 `sandbox.enabled` 默认值变化 |
| 可靠性/恢复 | 无新增黑盒质量目标；依据功能性 Requirement `候选任务固定使用可信 shell 模式` | 对全部 task 和 attempt 使用同一字面量配置，避免动态 allowlist 漏配形成基础设施失败 | 单元测试断言每次构建结果固定为 `false` |
| 可测试性 | 无新增黑盒质量目标；依据功能性 Requirement `候选任务固定使用可信 shell 模式` | 直接验证候选配置的契约可观察结果 | 聚焦测试和 HarnessBench 测试集均通过 |

#### 备选方案（Alternatives Considered）

按 task mock API 动态生成 `allowedApis` 可以保留受限模式，但需要解析动态端口、维护 Bash/Python 同形策略，并会让评测结果依赖 task 结构。用户已明确要求后续任务使用 `sandbox.enabled=false`；固定 trusted shell mode 更符合该评测环境的单一配置边界，因此不采用动态 allowlist。

## 验证策略（Verification Strategy）

- unit 层验证候选配置的契约可观察结果为 `sandbox.enabled=false`，并保留既有模型预算断言。
- HarnessBench 测试集验证候选配置变化没有破坏运行器、报告和失败分类行为。
- OpenSpec strict validation 验证 Function/spec 归属、delta operation 和文档结构。
- diff 范围检查验证没有 `packages/**` 变更，且没有产品默认配置或公共契约变更。
- 本 change 不以真实模型重跑 078 作为合入前置条件；真实回归属于后续评测运行证据，不替代确定性配置测试。

## 长期基线刷新计划（Baseline Promotion Plan）

- `openspec/specs/harnessbench-evaluation/spec.md`：归档时新增 `候选任务固定使用可信 shell 模式`。
- `openspec/designs/functions/D10-二次开发与平台集成/D10.3-测试与扩展/FN-10.13-HarnessBench评测.md`：归档时刷新处理过程和规格表。
- Feature：无；用户价值边界和 Function 组成不变。
- `openspec/overview.md`：无。
- architecture：无；产品架构和 sandbox gateway owner 不变。
- modules：无；不修改产品模块设计。
- ADR：无；该选择是 HarnessBench 评测配置，不形成产品级长期技术决策。
- `openspec/designs/spec-to-design-map.md`：无；`harnessbench-evaluation` 到 `FN-10.13` 的映射不变。

## 风险与取舍（Risks / Trade-offs）

- trusted shell mode 放宽候选进程对评测主机资源的访问。缓解方式是将该值硬编码在 HarnessBench 受控评测配置中，不提供 task override，并继续由现有 sandbox gateway 承载动态执行。
- 关闭受限 sandbox 后，评测不再覆盖受限网络策略本身。该策略不属于 HarnessBench 框架效果任务的目标；产品 sandbox contract 和专项测试保持不变。

## 待确认问题（Open Questions）

无。
