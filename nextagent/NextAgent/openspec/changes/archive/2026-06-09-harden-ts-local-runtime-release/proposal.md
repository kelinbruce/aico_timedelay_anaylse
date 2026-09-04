## 背景与问题（Why）

本地 release 目标如果没有单独的 qualification contract，就会退化成不稳定的人工判断：

- 能启动就算可发布；
- 大部分检查通过就算可发布；
- 手工 smoke 大致正常就算可发布；
- 已知问题只写备注，没有明确 blocker / degradation / out-of-scope 边界。

本 change 的目标，是把“当前 candidate 是否达到最低发布资格”收敛成一条最小、固定、可重复执行的资格判定流程。

## 变更范围（What Changes）

- 新增 `local-runtime-release` spec，冻结本地 release 的最小 qualification contract。
- 明确 release qualification 的核心检测流程：
  - 单一可执行 qualification 入口与固定检查命令清单
  - 输入与 `PackageCandidateEvidence` 校验
  - 四类硬门槛 gate
  - candidate 启动与最小 health proof
  - 最小 in-scope smoke
  - capacity baseline
  - verdict 聚合
- 明确 release 结果只允许是：
  - `QUALIFIED`
  - `QUALIFIED_WITH_DECLARED_DEGRADATIONS`
  - `BLOCKED`
- 明确 `scope-excluded`、`declared-degradation`、`blocking-defect` 三类边界。
- 明确 release diagnostics 只通过唯一 `ReleaseQualificationResult` 保留最小 evidence refs，而不扩展成并列的发布治理平台。

## 黑盒目标（Blackbox Goal）

给定一个 candidate 与 release scope，系统通过固定检查入口执行并聚合必需检查，输出一个单一、稳定、可追溯的 release qualification verdict。

## 核心实现策略（Current Strategy To Freeze）

冻结以下黑盒策略：

- release qualification 只消费完整且已校验的 `PackageCandidateEvidence` 与上游权威结果，不重定义子系统真相；
- `agent-app` 必须提供可执行的 `release:qualify` 入口，按固定命令清单调用各类检查、读取 machine-readable 结果并计算最终 verdict；
- contract 与 architecture 检查必须直接通过标准命令 `npm run test:contract` 与 `npm run lint:architecture` 接入，不得重做检查规则；
- 尚未实现的 security、resilience、capacity 等检查必须由 roadmap 中对应 change 交付固定标准命令与 machine-readable 结果；命令缺失或无有效结果时显式 `MISSING` 并阻断 release；
- configuration release input 只通过 `PackageCandidateEvidence.configValidationEvidenceRef` 指向实际 candidate startup 产生的唯一 `ConfigValidationEvidence`；release input builder 解引用该 evidence，qualification 不接受替代配置 evidence shape；
- contract / architecture / security / resilience gate、health/readiness、smoke 和 capacity baseline 的内部检查规则由各自 owner 提供；本 change 负责调用固定标准命令、读取结果并聚合 verdict；
- qualification flow 采用固定阶段顺序；四类硬门槛在同一阶段全部执行并聚合，任一非 `PASSED` 时阻断后续阶段；
- smoke 只证明最小 in-scope 主链路；
- baseline 只做“存在且不明显不可用”的保守判定；
- diagnostics 只保留最小安全证据引用。

## 影响范围（Impact）

- 需要新增本地 release qualification 的最小规格。
- 需要明确它与 health、gate、smoke、capacity baseline 的职责边界。
- 不实现 security、resilience、health、smoke 或 benchmark 的内部检查规则；只调用各 owner 交付的固定标准命令。
- 需要补齐对 `QUALIFIED`、`QUALIFIED_WITH_DECLARED_DEGRADATIONS`、`BLOCKED` 三类结果的验证。

## 归档前基线提升计划（Baseline Promotion Plan）

- `openspec/specs/local-runtime-release/spec.md`
