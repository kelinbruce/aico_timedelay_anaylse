# agent-common

## 职责

承载 shared branded ids、基础 value object、JSON value、时间、幂等键、身份值对象、secret reference、安全错误基线、runtime diagnostic logging contract 和跨边界基础 enum。

## 非职责

不导入 `agent-contracts`，不承载业务领域 owning contract，不定义 adapter、runtime 或 channel 行为。

## 依赖

只依赖 TypeScript/Node 基础能力。

## 核心设计落点

- 落实 `architecture/core-contracts.md` 的 foundation layer：shared branded ids、基础 value object、identity、locale、secret reference、safe error 和跨 subpath durable scalar vocabulary。
- 承载长期记忆和 task trajectory 跨边界共享的 durable scalar vocabulary，包括 `LongTermMemoryId`、`TaskTrajectoryId`、`MemoryCategory`、`LongTermMemoryState`、`TaskTrajectoryKind`、`TaskTrajectoryBuildStatus`、`TaskOutcomeStatus` 和 `OutcomeEvidenceLevel`；这些不是 Record、DTO、port 或 service。
- 承载跨业务 package 共用的 structural runtime diagnostic logging contract，包括 `RuntimeLogLevel`、`RuntimeLogger` 和 `noopRuntimeLogger`；physical envelope、I/O factory/options、Pino 和 file lifecycle 不属于 common。
- `OperationalLogSurface` 只允许 `runtime_diagnostic | observation_derived`；不定义 `metric_diagnostic` 或通用 log DTO。
- `CLIP_STREAM_RESULT_PROJECTION_KIND="CLIP_STREAM_V1"` 是跨 core/runtime/channel 持久化的闭集 projector classifier scalar。它只选择共享 raw-to-safe projector，不包含结果正文，不是 DTO/Record/port，也不得进入普通 Web allowlist；未知值由 runtime persistence policy 拒绝。
- 不承载 DO、DTO、Record、port 或 service contract；这些归对应 `agent-contracts/<subpath>` 或实现模块。
- 作为 `agent-contracts` 下方的独立 foundation package，不反向导入 `agent-contracts`。

## 替换边界

否。`agent-common` 是所有 contract 下方的 foundation package。

## 验证关注点

- 不得导入 `agent-contracts`。
- shared id 必须使用 branded type 表达。
- 安全错误和 JSON value 不得绑定 adapter 或 framework 类型。
- `CLIP_STREAM_RESULT_PROJECTION_KIND` 只能由 common 单一导出并被 core/runtime/channel 复用，消费者不得复制字符串常量或扩展未知 classifier。

## Public Exports

`@nextagent/agent-common`
