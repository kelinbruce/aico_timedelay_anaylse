# add-ts-operational-log-hardening

规划入口：[roadmap-v2](../nextagent-ts-change-roadmap-v2.md)
所属分组：Observability 和 Audit

状态：candidate
类型：扩展候选 change
主要 owner：`agent-observability`、`agent-app`、`agent-common`
协作 owner：`agent-runtime`、`agent-channel-web`、`agent-capability`、`agent-platform-gateway-local`
依赖：`add-ts-structured-logging`、`add-ts-redaction-policy`、`add-ts-app-config-schema`、`add-ts-local-runtime-package`、`add-ts-metrics-health`

目标：
- 补齐电信级运行日志可维护性，确保问题定位所需的关键运行路径日志覆盖充足、结构稳定、可关联、可脱敏。
- 提供运行日志工程化能力：日志级别、runtime/observability 分流、按大小或日期绕接、历史日志压缩、至少 7 天保留、最大磁盘占用、启动时清理和安全降级。
- 明确日志写入失败、flush/close 失败、rotation/cleanup 失败和潜在丢失风险的可观测信号，避免静默丢失。
- 复用 structured logging、redaction policy、metrics/health 和 app composition，不让业务模块散落 ad hoc logger 或直接依赖日志 SDK。

规格输入：
- 配置必须支持至少 `error`、`warn`、`info`、`debug` 四级日志级别，并能分别控制 runtime log、observability structured log 和可选 access/transport log。
- 本地运行包默认启用文件日志和 stdout 双路输出；容器/PaaS 模式可配置为 stdout-first，由平台日志系统负责持久化，但必须显式记录当前 retention owner。
- 文件日志必须支持按大小或日期绕接；绕接后的历史日志必须可压缩；默认保留期不少于 7 天，并支持最大磁盘占用上限。
- 日志保留和清理必须 fail safe：清理失败不得阻塞 request lifecycle；不得删除未过保留期且仍需要诊断的日志；磁盘水位超限时必须输出 safe diagnostic 和 metric。
- 写入路径必须有 bounded failure behavior：日志写入、flush、rotation、compression、cleanup 失败不得导致 request terminal commit 失败，但必须记录可观测降级。
- 关键运行路径必须覆盖 app startup/shutdown、config evaluation、request accept/reject、scheduler queue/dispatch、model invocation、capability invocation、gateway/sandbox boundary、stream connect/replay/gap、recovery、terminal commit、pending input 和周期任务触发。
- 日志内容必须遵守 redaction policy，不得包含 raw prompt、raw model output、raw tool args/result、附件内容、credential、secret、provider raw error、host path 或高基数字段。
- 日志记录必须包含稳定诊断坐标，例如 tenant/subject hash 或受控 owner summary、agentId、sessionId、runId、requestId、messageId、capabilityId、event kind、reason code、status 和 duration bucket；不得引入泛化 correlation DTO 到核心契约。

实现约束：
- `agent-observability` 负责 operational log writer、rotation/compression/retention 策略和 structured log transport。
- `agent-app` 负责通过 app config 装配 log sink、默认路径、级别、rotation policy、retention policy 和 deployment mode 差异。
- `agent-common` 只保留最小 logger interface 和安全基础类型；不得引入 Pino/OpenTelemetry/具体 log rotation library 类型到核心业务包。
- 业务模块不得直接创建文件 logger、执行 rotation、压缩日志或实现 retention；需要新增覆盖点时优先通过 event/projector/wrapper 或已有 runtime diagnostic boundary。
- 压缩和清理应作为后台维护操作或 app lifecycle 操作执行，不得在 request hot path 同步执行重 IO。

非目标：
- 不把运行日志等同于审计存储；合规审计仍由 `add-ts-audit-sink` 和审计事件边界承载。
- 不定义远端日志平台、集中日志检索 UI、SIEM 集成、长期归档或合规不可篡改存储。
- 不保证进程 crash、宿主磁盘损坏或平台日志系统故障下绝对零丢失；本 change 要求 bounded loss、flush/close 语义、降级可观测和明确 retention owner。
- 不允许为了定位问题泄漏 prompt、模型输出、工具输入输出、附件内容、路径或凭据。

验收要点：
- Coverage：关键运行路径至少有一条 redaction-safe structured operational log 或 observation event，可用 run/session/request 坐标关联。
- Level：配置为 `warn` 时不会输出 `info/debug`，配置为 `debug` 时只增加受控 debug 字段且仍脱敏。
- Rotation：构造小文件阈值后产生 rotated log，当前日志继续写入，历史日志可压缩。
- Retention：超过保留期或磁盘上限的历史日志被清理，7 天内日志不被误删。
- Failure：模拟文件不可写、rotation 失败、compression 失败和 cleanup 失败，主 request lifecycle 不失败，同时输出 safe diagnostic/metric。
- Security：canary secret、raw prompt、raw model output、raw tool args/result、host path 和 credential 不出现在 runtime/observability/access log。

并行边界：
- 本 change 依赖 structured logging 和 redaction policy 的语义边界稳定后创建正式 OpenSpec change。
- 若需要修改 app config schema、logger public interface、release package layout 或 health/metric 字段，正式 change 必须定义目标 contract、默认值和验证门禁。
