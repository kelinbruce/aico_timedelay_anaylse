## 背景和现状（Context）

仓库当前已经有两层 E2E 质量门槛基线：一层是 Alpha 最小内核回归 gate，另一层是 P0 的 product-journey、security、resilience、release-package gates。它们解决了“最小链路”和“首版增强能力”的真实边界验证问题，但还没有承接 roadmap 中 `P1/P2` 联合特性的规划与准入。

`P1` 与 `P2` 的特性有一个共同点：它们往往不是单点 API，而是跨多个 owner 的真实运行链路。例如 hook/risk policy 会影响 capability 执行前后的控制流，pending input 会穿过 runtime、gateway、channel 和恢复语义，长期记忆会跨会话影响 context assembly，task/workflow/remote gateway 又会把真实产品边界扩展到新的运行路径。仅靠每个 feature change 各自附带的 contract/integration 测试，无法解决三个治理问题：

1. 哪些 `P1/P2` 特性应该进入真实边界 E2E 门槛；
2. 哪些尚处于 candidate 或 assumption-ready，只能先登记不能阻断；
3. 新场景如何避免与 Alpha/P0 既有 gates 重复归属。

当前约束也很明确：本 change 的任务已经调整为“直接实现 `P1/P2` 门槛用例的 change”。因此设计要收敛到实现型 E2E gate：在哪些目录落用例、如何生成 case inventory、如何输出 report、如何与既有 gate 保持唯一边界，而不是继续停留在规格治理和后续入口。

## 目标和非目标（Goals / Non-Goals）

**目标：**
- 定义并实现 `P1/P2` 联合特性的唯一 E2E gate，直接交付门槛黑盒用例。
- 在现有 `tests/e2e` 结构中新增当前 `activated` 场景族对应的 case inventory、Vitest 用例、negative verification 和 report writer。
- 将场景组织为若干稳定的场景族，而不是为每个 feature 临时发明一套 testcase taxonomy。
- 明确与 Alpha/P0 既有 gates 的边界，避免重复主归属。

**非目标：**
- 不修改任何现有产品能力契约、gateway port、runtime lifecycle 或 channel API。
- 不把所有 `candidate` 特性直接升格为发布硬门槛。
- 不定义新的通用测试 DSL、通用 E2E 编排框架或 release verdict 聚合器。
- 不重写既有 Alpha/P0 gate 的用例归属或 command surface。

## 设计决策（Decisions）

### D1. 采用“当前 change 直接实现 gate”路径

唯一实现路径是由 `ts-e2e-p1-p2-scenario-gate` 在当前 change 中直接交付 gate runner、case inventory、Vitest 用例和 report writer。这个 gate 负责四个稳定事实：

- 哪些 `P1/P2` 特性族需要真实边界 E2E；
- 场景当前处于已激活、待激活还是排除状态；
- 每个场景的主要 gate owner 是谁。
- 哪些已激活 case 在本 change 中必须有真实可执行用例与 report 结果。

不选择“继续只做 planning、把实现留到后面”的方案，因为用户已经明确这个 change 的黑盒目标就是提供 E2E 用例，支撑门槛验证本身。当前实现覆盖仓库里已经具备真实产品路径的全部 `activated` 场景，同时保留未收敛的 `planned` 候选能力，不把 roadmap 愿景误写成硬约束。

### D2. 场景按稳定场景族组织，而不是按 change 名暴露

场景 registry 采用稳定场景族，而不是“一个 change 对应一个 E2E 文件”。当前仓库可真实落地的场景族收敛为：

- 扩展治理链路：hook、risk policy、skill resource access、gateway configuration 等；
- 人工介入链路：AskUser、question/confirmation/authorization/handoff pending input；
- 长期记忆链路：memory tools、extraction、aging、configuration、自学习对会话结果的影响；
- 路由与子 Agent 链路：routing evidence、targeted skill、agent tool、invoked agent context；
- 任务与工作流链路：task tools、workflow routing/execution/parallel gateway 的真实边界效果；
- 远端基础设施链路：remote gateway / remote memory adapter 对既有产品路径的保持性；
- P2 会话与前端扩展链路：session-sharing、bookmark、personalization 等在具备稳定输入后的真实产品路径。

这样做的原因是 roadmap 会继续演进，但这些场景族对应的是稳定的用户/系统黑盒问题，后续新增 change 只需要挂接到既有场景族，而不必重复定义分类方法。

### D3. 采用三态 inventory：activated、planned、excluded

每个场景在 inventory 中只有一个状态：

- `activated`：满足下列二者之一，且目标行为已能形成真实边界可观察效果，必须进入后续实现 gate：
  - 存在 active 或 ready 的 OpenSpec change 输入；
  - 对应能力已经归档进入基线 spec，语义稳定，但仍缺少唯一归属的真实边界 E2E evidence；
- `planned`：特性仍是 candidate 或 assumption-ready，已识别未来需要 E2E 的黑盒问题，但暂不阻断；
- `excluded`：owner 拆分、pure contract refinement、deferred-only、not-planned 或已被 Alpha/P0 既有 gate 主归属覆盖。

不选择“只有必测与不测两态”的方案，因为这会迫使未收敛 feature 过早进入阻断门槛，或导致未来需要 E2E 的问题被遗漏。

### D3a. 当前 `activated / planned / excluded` inventory

本 change 当前直接固化一版 inventory，作为当前实现型 E2E gate 的唯一输入。

#### Activated

这些场景已经具备可验证的 active/ready change 输入，或已归档进入基线且仍缺真实边界 E2E evidence，应作为当前实现型 gate 的当前必测对象。

| 场景族 | 代表特性 | 进入原因 |
|---|---|---|
| 扩展治理链路 | `add-ts-lifecycle-hook-execution`、`add-ts-risk-policy-enforcement`、`add-ts-skill-resource-access`、`add-ts-gateway-configuration` | 前三项已归档进入基线、后一项仍是 active change，且都直接影响真实 request/capability/gateway 主路径 |
| 人工介入链路 | `add-ts-ask-user-question-tool`、`add-ts-human-pending-input-core`、`add-ts-human-pending-input-timeout`、`add-ts-question-pending-input`、`add-ts-confirmation-pending-input`、`add-ts-authorization-pending-input`、`add-ts-human-handoff` | 已归档进入基线并具备真实 Web transport、pending input 持久化、回答恢复和 terminal 回写闭环 |
| 长期记忆链路 | `add-ts-memory-core`、`add-ts-memory-tools`、`add-ts-memory-extraction`、`add-ts-memory-aging`、`add-ts-memory-configuration`、`add-ts-task-trajectory` | 已归档进入基线，且会跨会话影响 context、tool 和用户可观察结果 |
| 路由与子 Agent 链路 | `add-ts-routing-evidence-and-fallback`、`add-ts-agent-tool`、`add-ts-targeted-skill-routing` | 已归档进入基线，且具有可观察的 routing / child-run / targeted-skill 命中黑盒结果 |
| 任务与工作流链路 | `add-ts-workflow-routing`、`add-ts-workflow-execution-engine`、`add-ts-workflow-package-composition`、`add-ts-workflow-engine-contracts`、`add-ts-workflow-gateway-nodes` | 已完成 change 已形成真实 product composition、真实 request path 和 workflow 执行结果，可作为独立黑盒入口验证 |
| P2 会话与前端扩展链路 | `conversation-share` | 已归档进入基线，且具备真实 share create / shared-view Web route、专用 share persistence 和 run snapshot 只读结果 |

#### Activated case registry

当前 activated inventory 允许以下 6 个 case 进入当前实现型 gate。每个 case 固定唯一 `caseId`、唯一主要 `ownerGate` 和唯一实现位置；不得把同一 case 同时挂到 product-journey、security、resilience、release-package 或另一个 `P1/P2` gate。

| caseId | scenarioFamily | 主要 ownerGate | 来源能力 | 当前实现位置 |
|---|---|---|---|---|
| `e2e-P1P2-01` | `extension-governance` | `ts-e2e-p1-p2-scenario-gate` | `add-ts-lifecycle-hook-execution`、`add-ts-risk-policy-enforcement`、`add-ts-skill-resource-access`、`add-ts-gateway-configuration` | `tests/e2e/p1-p2-scenario-gate/extension-governance.test.ts` |
| `e2e-P1P2-02` | `long-term-memory` | `ts-e2e-p1-p2-scenario-gate` | `add-ts-memory-core`、`add-ts-memory-tools`、`add-ts-memory-extraction`、`add-ts-memory-aging`、`add-ts-memory-configuration`、`add-ts-task-trajectory` | `tests/e2e/p1-p2-scenario-gate/long-term-memory.test.ts` |
| `e2e-P1P2-03` | `routing-child-agent` | `ts-e2e-p1-p2-scenario-gate` | `add-ts-routing-evidence-and-fallback`、`add-ts-agent-tool` | `tests/e2e/p1-p2-scenario-gate/routing-child-agent.test.ts` |
| `e2e-P1P2-04` | `human-pending-input` | `ts-e2e-p1-p2-scenario-gate` | `add-ts-ask-user-question-tool`、`add-ts-human-pending-input-core`、`add-ts-human-pending-input-timeout`、`add-ts-question-pending-input`、`add-ts-confirmation-pending-input`、`add-ts-authorization-pending-input`、`add-ts-human-handoff` | `tests/e2e/p1-p2-scenario-gate/human-pending-input.test.ts` |
| `e2e-P1P2-05` | `workflow-routing` | `ts-e2e-p1-p2-scenario-gate` | `add-ts-workflow-routing`、`add-ts-workflow-execution-engine`、`add-ts-workflow-package-composition`、`add-ts-workflow-engine-contracts`、`add-ts-workflow-gateway-nodes` | `tests/e2e/p1-p2-scenario-gate/workflow-routing.test.ts` |
| `e2e-P1P2-06` | `conversation-share` | `ts-e2e-p1-p2-scenario-gate` | `conversation-share` | `tests/e2e/p1-p2-scenario-gate/conversation-share.test.ts` |

采用“当前 change 自己实现唯一 gate”而不是拆成多个后续 change 的原因是：用户已经把这个 change 的黑盒目标收敛为“直接提供 E2E 用例”。当前实现覆盖全部已激活 case，仍然保持唯一 owner，并把尚未形成真实产品入口的能力留在 planned backlog。

#### Planned

这些场景已经收敛为“继续由当前 `ts-e2e-p1-p2-scenario-gate` 承接的后续扩面 backlog”，但当前仍缺少稳定产品路径、完整 owner 收敛或已激活实现，因此只保留在 backlog，不进入当前 gate runner。这里的“同步到现有 gate 扩面”只表示未来 E2E 主归属仍在当前 gate，不表示它们现在可以绕过 feature change 直接进入 activated case。

| 场景族 | 代表特性 | 激活条件 |
|---|---|---|
| 路由与子 Agent 链路 | `add-ts-invoked-agent-context-inheritance` | 对应 change 进入 `active` 或归档入基线；真实请求能观测 inherited-context 生效；child run / routing evidence 能通过真实 runtime、gateway 和 stream 投影暴露稳定黑盒结果 |
| 任务与工作流链路 | `add-ts-workflow-parallel-gateway`、`add-ts-workflow-yaml-parsing` | workflow 并行和解析扩展不只是 contract，而是要以真实 product composition 启动并跑出可观察节点结果；对应 change 进入稳定实现后再纳入 gate |
| 远端基础设施链路 | 远端 memory adapter / infrastructure adapter 候选能力 | 后续扩面仍归当前 gate，但必须先新开并落地对应 feature change；仓库中出现对应 `active` 或 `ready` change，且真实远端依赖被接入 product composition；测试可观测远端持久化/读取/降级结果，而不是只验证设计占位、driver stub 或 roadmap 愿景 |
| P2 会话与前端扩展链路 | `agent-web-session-bookmark`、`agent-web-user-personalization` | 后续扩面仍归当前 gate，但必须先各自补 feature change；assumption-ready / candidate 条目先固化默认假设，再形成稳定 API、权限和持久化 contract；真实用户闭环可观测书签或个性化结果，而不是前端静态占位或仅 schema 存在 |

#### Planned backlog ownership note

- `agent-web-session-bookmark`：归属当前 gate 的后续扩面，但仓内当前没有对应长期 spec、active change 或真实后端 route/store/product path；因此必须先开 feature change，把 API、权限、持久化 owner 和产品闭环立起来，再回挂本 gate。
- `agent-web-user-personalization`：归属当前 gate 的后续扩面，但仓内当前只有 memory 中 `PERSONALIZATION` 语义，没有稳定 personalization capability spec 或真实后端闭环；因此也必须先开 feature change，再由当前 gate 承接黑盒 E2E。
- 远端 memory / infrastructure adapter：归属当前 gate 的后续扩面，但当前还只是候选方向；必须先有对应 active/ready feature change 和真实 product composition 接入，才允许提升为 activated case。

#### Excluded

这些场景不应进入本 gate 的主要归属。

| 场景或特性 | 排除原因 | 主归属 |
|---|---|---|
| `add-ts-request-edit-resubmit` | 已由 P0 `product-journey` gate 覆盖 edit-resubmit 主路径，不再重复进入 P1/P2 gate | `ts-e2e-product-journey-gate` |
| secret / redaction / internal-record leakage / cross-scope cancel-retry safety | 本质属于安全边界 | `ts-security-test-gate` |
| replay / reconnect / restart / idempotency recovery | 本质属于恢复与恢复保护边界 | `ts-e2e-resilience-gate` 或 `ts-reliability-test-gate` |
| `add-ts-workflow-parallel-gateway` 当前本地实现细节 | 当前只允许作为 planned 场景输入，未形成独立 activated gate owner 前不得直接进入必测清单 | 待后续实现 change 激活 |
| 纯 owner 拆分、纯 contract refinement、not-planned 条目 | 不形成独立黑盒场景或当前明确不进入实现 | 无 |

### D4. 既有 Alpha/P0 gate 保持主归属，本 change 只承接增量

Alpha 和 P0 gates 已经拥有稳定职责：最小内核、产品主旅程、安全、恢复、候选包。`ts-e2e-p1-p2-scenario-gate` 不重写这些职责，而是只实现 P1/P2 增量黑盒问题。若某个特性主要验证目标本质仍是安全边界或恢复边界，应继续让 security/resilience gate 做主归属，本 change 只保留引用或排除说明。

### D5. Evidence 结构统一，但 release verdict 不在本 change 内定义

当前 gate 必须统一产出 machine-readable evidence，字段至少包含：

- `caseId`
- `scenarioFamily`
- `maturityStage`
- `ownerGate`
- `result`
- `failurePhase`
- `evidenceRefs`

本 change 不定义聚合后的 release verdict 逻辑，只定义当前 gate 输出必须可被 release qualification 消费。这样可以复用现有 `e2e-quality-gates` 与 release hardening 设计，而不新造一层编排。

### D6. 复用现有 E2E gate 落地骨架

当前 change 的实现方式对齐现有 `alpha-kernel-gate`、`product-journey` 和 `release-package`：

- 在 `tests/e2e/p1-p2-scenario-gate/` 下维护 `case-inventory.ts`、按场景拆分的 `.test.ts`、`negative-gate.test.ts` 和 `write-report.test.ts`；
- 在 `scripts/run-p1-p2-scenario-gate.mjs` 提供唯一 runner，负责清理 report 目录、串行运行 gate 用例并写出 machine-readable report；
- 在 `package.json` 增加唯一标准命令 `npm run test:e2e:p1-p2-scenario-gate`；
- 复用现有 `tests/e2e/e2e-helpers.ts`、`tests/e2e/case-inventory-base.ts` 和 release vitest 配置，不新增通用 DSL。

当前 activated 的 6 个 case 都已经满足真实 product process、真实 transport、真实 gateway/persistence 和真实 runtime/capability orchestration 的黑盒准入条件，并且统一输出 machine-readable `ReleaseCheckResult`。因此它们适合作为源码态版本打包前的 release E2E 门槛，并由 `npm run test:e2e:release` 汇总执行，让 `pack:release` 在正式打包前自动验证这些 P1/P2 联合场景。

### D5a. Activated gate evidence contract

每个 activated case 的 evidence 记录使用一套固定最小 shape，不允许各 gate 再发明平行字段。

| 字段 | 约束 |
|---|---|
| `caseId` | 只能是本 change registry 中登记的稳定 case id，例如 `e2e-P1P2-01` |
| `scenarioFamily` | 只能是 `extension-governance`、`long-term-memory`、`routing-child-agent`、`human-pending-input`、`workflow-routing`、`conversation-share` 之一 |
| `maturityStage` | 只能记录当前输入来源：`active-change`、`ready-change` 或 `baselined-capability` |
| `ownerGate` | 必须等于 registry 中声明的唯一 gate id |
| `result` | `passed`、`failed`、`timeout`、`skipped` 四值之一；activated case 的 `timeout`、`skipped` 或缺失都视为 gate failed |
| `failurePhase` | 只能是 `product-startup`、`transport`、`runtime-orchestration`、`capability-execution`、`gateway-persistence`、`evidence-scan` 或 `none` |
| `evidenceRefs` | 只允许安全 opaque ref 或 package-relative safe ref；不得内联敏感正文、原始 payload 或绝对路径 |

为避免和 security/resilience/release-package gate 重叠，`failurePhase` 只用于标记 P1/P2 gate 自己观察到的失败边界，不重定义上游 gate 的 verdict contract。

### D5b. Forbidden evidence negative verification

每个 activated gate 在实现时都必须包含至少一条负向验证，证明 evidence 输出不会泄漏以下内容：

- raw credential、provider secret 或 auth token；
- prompt、完整模型输出、附件正文或完整附件内容摘要；
- 未脱敏绝对路径、workspace 私有路径、临时构建目录；
- raw backend exception、stack trace、adapter-private DTO 或 driver-private row shape。

负向验证必须通过可追踪 canary 或结构断言落地，而不是只写“注意脱敏”。允许输出安全 reason code、hash、opaque evidence ref 和 case-local failure summary。

## 质量属性设计（Quality Attributes）

| 质量属性 | 设计结论 | 验证入口 |
|---|---|---|
| 安全 | 实现型 gate 只允许真实边界场景进入 inventory，evidence 禁止暴露 raw credential、prompt、附件内容、secret、未脱敏路径和 adapter-private DTO | spec scenario + report schema test |
| 性能/容量 | 本 change 不承诺新的性能数值；当前实现只覆盖仓库里已经具备真实入口的 6 个 activated 场景，避免一次性把所有 P1/P2 候选特性变成重型阻断门槛 | design review + task inventory review |
| 可靠性/恢复 | 通过唯一归属规则避免同一恢复/安全场景被多 gate 冲突维护；待激活场景不影响当前门槛 verdict | inventory consistency review |
| 可维护性 | 使用稳定场景族和三态 inventory，避免按 change 名散落 testcase taxonomy | OpenSpec review + change consistency check |
| 可测试性 | 当前 gate 直接交付 case inventory、Vitest 用例、negative verification 和 report writer，但不新增测试框架 | tasks 中的 gate execution validation |
| 审计/可追溯性 | 每个场景必须带 case id、阶段、owner gate 和 evidence ref，便于后续 release qualification 回溯 | spec evidence requirement + inventory lint/review |

## 验证映射（Verification Map）

| 约束 | Task | 验证入口 |
|---|---|---|
| 只接收真实边界场景 | 1.1 | `openspec validate add-ts-e2e-p2-test --strict` + spec review |
| Active/ready/planned/excluded 准入分层 | 1.2、2.1 | case inventory review |
| 与 Alpha/P0 gates 保持唯一主要归属 | 1.3、2.3 | e2e gate ownership review |
| evidence 结构安全且可消费 | 2.1、2.2 | report schema review |
| 不把 candidate 愿景误写成阻断门槛 | 2.4 | consistency review |

## 文档承载决策（Documentation Ownership）

- 行为契约：`openspec/specs/ts-e2e-p1-p2-scenario-gate/spec.md`
- 架构和跨模块设计：`openspec/designs/architecture/e2e-quality-gates.md`
- 模块设计：无。该 change 不新增某个运行时代码模块的职责设计。
- ADR：无。当前不存在需要独立长期保留取舍历史的架构分叉。
- 导航：`openspec/designs/spec-to-design-map.md`

## 风险与取舍（Risks / Trade-offs）

- [风险] `P1/P2` feature 范围过大，实现型 gate 容易失控。 -> 当前只实现仓库里已具备真实产品入口的 6 个 activated 场景，其余保留在 planned backlog。
- [风险] 与既有 Alpha/P0/security/resilience gates 重叠。 -> 要求每个场景只有一个主要 owner gate，并在 inventory 中显式标注排除原因。
- [风险] 新 gate 为了赶进度复制出一套通用 E2E 框架。 -> 强制复用现有 `tests/e2e` 目录结构和 runner 模式，只允许最小 helper 增量。

## 迁移计划（Migration Plan）

无。该 change 不改产品运行路径，也不引入发布迁移步骤；它只新增当前 gate 的测试代码、runner 和 report 输出。

## 归档前更新基线（Baseline Promotion Plan）

- `openspec/specs/ts-e2e-p1-p2-scenario-gate/spec.md`：保留 `P1/P2` 场景准入、唯一归属和 evidence 规则。
- `openspec/overview.md`：补充 `P1/P2` 联合特性进入发布门槛前需要场景分层治理的长期背景。
- `openspec/designs/architecture/e2e-quality-gates.md`：提炼稳定场景族、三态 inventory 和与 Alpha/P0 gate 的边界。
- `openspec/designs/spec-to-design-map.md`：增加 `ts-e2e-p1-p2-scenario-gate` 到 `e2e-quality-gates` 的导航。

## 待确认问题（Open Questions）

无。
