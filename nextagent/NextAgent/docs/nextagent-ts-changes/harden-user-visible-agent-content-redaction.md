# harden-user-visible-agent-content-redaction

规划入口：[UCD 能力差距交付里程碑](../roadmap/ucd-capability-delivery.md)
所属分组：UCD-P3

状态：clarify
类型：security policy refinement candidate
主要 owner：待安全架构确认
协作 owner：`agent-channel-common`、`agent-channel-web`、`agent-runtime`、`agent-session`、`agent-web`
认领人：不可认领
依赖：已归档的 `add-ts-safety-guardrails`、`refine-stream-guard-blocked-event`；thinking/history continuity 作为后续 surface 依赖

当前状态：
- REMOTE 部署可通过 governed guardrail gateway 执行 input/output whole-round guard。
- output guard 通过 terminal `OUTPUT_GUARD_BLOCKED` 清除本轮已投影内容、显示安全拒答，并把 blocked assistant 内容排除出 model-visible history。
- 该基线不等于字段级 `[REDACTED]`：它没有自动定义 thinking、capability safe result、history、share/export 的统一字段脱敏策略。

目标：
- 明确 UCD A6/B17/B18 在既有 whole-round guard 之上的剩余安全需求，并为所有纳入范围的用户可见 surface 建立唯一、可验证的安全结果和配置边界。

进入 `ready` 前必须确认：
- 产品语义采用 whole-round block、字段级 redaction、safe-result whitelist，还是按明确内容类别组合；每类只能有一个 authoritative policy。
- 纳入首版的 surface：streaming thinking、streaming answer、terminal answer、capability safe result、degradation/failure、history、share/export。
- authoritative raw fact 是否持久化，safe projection 在写前还是读前生成，live/history/share 如何复用同一结果。
- scanner unavailable、timeout、incremental chunk boundary、累计文本重扫和性能预算的 fail-closed 行为。
- LOCAL/REMOTE 是否同形，以及关闭 guardrail 后字段级安全策略是否仍生效。
- 策略配置由启动期系统配置、Agent 配置还是动态管理员控制面拥有；scope、默认值、请求内冻结时机、变更生效时机和审计要求是什么。只有确认需要运行期动态修改时，才引入管理 API/UI。

实现约束：
- 不能预设 `agent-channel-web` 是扫描 owner；正式 design 必须从内容事实 owner、stream owner 和 persistence owner 推导唯一位置。
- frontend 只呈现安全结果，不得用 CSS/DOM 隐藏代替服务端边界。
- raw prompt、raw model/tool output、命中片段和 policy internals不得进入日志、trace、audit detail、metric、SafeError 或 diagnostic。
- 若修改 `StreamEventType`、message visibility、share DTO 或 gateway record，必须拆出 contract refinement 并群内确认。

非目标：
- 不宣称替代 DLP/合规平台，不扫描用户本地文件系统。
- 不重建已工作的 guardrail gateway、RobotRouter adapter 或 `OUTPUT_GUARD_BLOCKED` lifecycle。

转为 `ready` 后的验收出口：
- security tests 覆盖所有纳入 surface 的 pass、match、scanner unavailable/timeout 和 replay/share 路径。
- equivalence tests 证明同一用户可见内容在 live/history/share 采用同一安全结果。
- negative tests 证明 raw 命中内容不进入客户端、model-visible history 或观测面。

并行边界：
- clarify 状态不可实施。
- thinking/history 依赖只决定 surface 可用性，不替代 owner、policy 和 fail-closed 决策。
