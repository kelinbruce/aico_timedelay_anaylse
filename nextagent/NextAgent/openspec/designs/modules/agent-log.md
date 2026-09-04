# agent-log

## 职责

拥有 NextAgent operational log 的唯一物理 writer、Pino envelope、console sink、component-scoped `RuntimeLogger` adapter、`StructuredLogTransport` adapter、redaction/size budget、overload transition evidence，以及 operational file policy。

同时拥有 developer diagnostic artifact 物理 writer：`createDeveloperDiagnosticArtifactWriter(paths.logDirectory, options?)` 是该 writer 的唯一公开 factory，名称 deployment-neutral，不区分 LOCAL/REMOTE。该 writer 创建独立 `agent-local-file-roll` lazy physical handle（首条合法记录按需创建 active destination，无记录时无文件副作用），不与 operational writer 共享 destination、buffer、maintenance state 或 lifecycle。物理产物为 `paths.logDirectory` 下的 `nextagent-plugin-diagnostic` 前缀 NDJSON 文件族（`schemaVersion=1`），容量边界沿用 stable spec：active segment 30 MiB 轮转、`.gz.tmp→.gz` 原子提交、closed 保留 3 elapsed days、最多 10 个 committed gzip archive、单条记录 4 MiB 上限。writer 由 `agent-app` 统一 Plugin host composition 默认装配（显式 factory 优先，否则默认使用本 factory），部署专用产品入口不感知也不注入该 writer。

## 非职责

- 不写 audit record 或 metric snapshot，不读取 operational file，不创建 observation。
- 不向业务 package 暴露 Pino、SonicBoom、pino-roll 或文件生命周期类型。
- 不让调用方覆盖 timestamp、numeric level、surface、component 等 reserved envelope fields。

## 依赖

直接依赖 `pino@10.3.1` 和 `@nextagent/agent-local-file-roll`。只有 `agent-app` composition 和显式测试可以创建 concrete writer；业务 owner 只接收 structural `RuntimeLogger`。

## 核心设计落点

- `runtime_diagnostic` 允许无 event 的安全 component diagnostic；`observation_derived` 必须有 cataloged event。
- writer 绑定可信 component，拥有 ISO timestamp、numeric level、surface、message 和 reserved field normalization。
- runtime-diagnostic bound logger 在每次 write 时读取当前 execution correlation sidecar（`RuntimeLogCorrelation` + `AsyncLocalStorage`），只接受有效 `traceId`/`spanId`，忽略普通 caller 提交的 trace 字段；tracing 关闭或 sidecar 不存在时省略 trace 字段，其它行为不变。
- `error` level entry 在 `safeReasonCode`、`safeErrorCode`、`errorCode`、`recoveryCode` 均缺失或未通过低基数 validator 时注入 `safeReasonCode=UNCLASSIFIED_RUNTIME_ERROR`；该兜底只表示 producer 尚未提供更精确分类，不替代可用的 `rawExceptionData`。
- 存在稳定 `event` 的 runtime/observation entry 丢弃 caller `msg`/`message` 和 Pino message argument，不自动生成 `msg`；唯一例外是没有 operational `event` 的 Fastify native access record，其 `incoming request`、`request completed`、`request errored` 保留 native `msg`、`reqId` 及既有安全 req/res shape，且不伪造 operational `event`。
- console/file destination 均为 async、有界且相互隔离；单 sink overload 不阻塞调用方或关闭另一 sink；transport ready、archive/retention failure/recovery和 flush/close failure按状态转换输出有界、无路径 evidence。
- local operational file 使用独立 4 MiB foundation handle；current-active identity 只读投影给 Workbench，不暴露目录扫描或 archive reader。
- `createAppOperationalLogWriter()` 要求显式、有效的 `serviceVersion`，缺失或非法值在创建 writer 前产生安全启动失败，不回退到硬编码或共享占位 version；metrics 和 OTel resource 复用同一已验证 serviceVersion。

## 验证关注点

single writer、四级 threshold、sink 组合、16 KiB entry budget、forbidden content、non-throwing/non-waiting、overload/recovery bounded evidence、reserved fields、current-active projection和 app-only construction boundary。

## Public Exports

`@nextagent/agent-log`；测试 seam 只从 `@nextagent/agent-log/testing` 暴露。
