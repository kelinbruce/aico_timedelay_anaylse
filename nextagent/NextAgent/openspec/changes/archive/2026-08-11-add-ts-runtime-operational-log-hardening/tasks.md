## 1. Contract and package boundary

- [x] 1.1 在 `agent-common` 保留 structural RuntimeLogger/noop/level，并把 OperationalLogSurface 冻结为 `runtime_diagnostic | observation_derived`；删除 product I/O factory/options 和 `metric_diagnostic`，不新增通用 log DTO。
  验证：`npx.cmd vitest run tests/contract/schema-smoke.test.ts tests/architecture/runtime-logging-boundary.test.ts`；`npm run build`。

- [x] 1.2 新增 Node-only technical foundation package `agent-local-file-roll`，direct dependencies固定 `pino-roll@4.0.0`、`sonic-boom@4.2.1`；public API只允许 safe policy、append result、active identity、factory和 bounded handle（含无路径、无领域语义的 maintenance outcome listener），不依赖 common/contracts/implementation package，不包含 log/metrics/audit mode、DTO、serializer、arbitrary matcher/delete callback。更新 root references、workspace manifest/lockfile、dependency-cruiser inventory和 package-manifest policy。
  验证：`npm install`；`npm run build`；package API/dependency review；新增 `packages/agent-local-file-roll/tests/local-file-roll.test.ts`；architecture negative fixtures覆盖 unauthorized consumer、reverse dependency和domain vocabulary。

- [x] 1.3 新增 `agent-log` package 和 public app-only factory，direct dependencies固定 `pino@10.3.1` 和 `@nextagent/agent-local-file-roll`；该模块 owning Pino operational envelope、console、component adapter、operational policy/failure mapping和一个独立 roll handle，不直接依赖 pino-roll/SonicBoom/zlib。
  验证：`npm run build`；package manifest/API review；新增 `packages/agent-log/tests/runtime-logger.test.ts` 和 operational policy integration tests。

- [x] 1.4 增加 architecture negative tests：只有 `agent-app` 和显式测试可创建 `agent-log`；只有 `agent-local-file-roll` 可 import pino-roll/SonicBoom/zlib rolling lifecycle；只有 `agent-log`、`agent-observability` 和 `agent-platform-gateway-local` 可依赖 foundation；foundation不得依赖 common/contracts/implementation package或包含 domain mode/DTO；业务 package不得 import concrete logger/file transport/foundation；三个 owner必须使用独立 handle/state。
  验证：新增 `tests/architecture/runtime-logging-boundary.test.ts`；`npm run lint:architecture`。

- [x] 1.5 冻结 common physical envelope：writer-owned ISO timestamp、文本 level、surface、app-bound component、app-owned serviceVersion 和稳定 event；两类 surface 的 event 均必填，reserved fields 不可覆盖。
  验证：table-driven logger tests 覆盖 direct/projected log 必含 event、文本 level、reserved overwrite 和逐行 JSON parse。

## 2. Frozen configuration and entrypoint defaults

- [x] 2.1 基于最新 baseline 增加 operational logging 的 level、console/file、directory/name、maxFileSizeMiB、retentionDays；最终配置入口由任务 15 收敛为唯一 `observability.logging`；保持既有 config groups/scenarios 完整。
  验证：`npx.cmd vitest run tests/agent-kernel/config-assembly.test.ts tests/contract/schema-smoke.test.ts`。

- [x] 2.2 冻结 entrypoint defaults：development console=true/file=false；local package console=false/file=true；test silent；默认 info、30 MiB、fixed daily、7 days。
  验证：`npx.cmd vitest run tests/dev-watch.test.ts tests/local-runtime-package.test.ts packages/agent-app/tests/logging-composition.test.ts`。

- [x] 2.3 增加 config negative tests：非法 level/sink/path/name/threshold/retention、用户 frequency/timezone、compression/未知 count/watermark/entry-size/queue-size/backpressure field 必须作为 config validation failure安全拒绝；任务 27 仅新增唯一批准的 `maxArchiveFiles` count policy。
  验证：`npx.cmd vitest run tests/agent-kernel/config-assembly.test.ts tests/agent-kernel/redaction-policy.test.ts`。

- [x] 2.4 冻结 metrics exporter selection：LOCAL固定 `<paths.logDirectory>/nextagent-metrics.<YYYY-MM-DD>.<sequence>.ndjson[.gz]`、60s/4 MiB line/8 MiB buffer/30 MiB/daily/gzip/最多10个压缩归档/7 days，REMOTE只接受 entrypoint-injected OTLP，test可注入 in-memory；core app config拒绝 metrics mode/path/endpoint/credential/interval/rotation/compression/retention/fallback字段，runtime input不能覆盖。
  验证：`npx.cmd vitest run tests/agent-kernel/config-assembly.test.ts packages/agent-app/tests/otel-observability-adapter.test.ts tests/architecture/otel-observability-boundary.test.ts`。

- [x] 2.5 冻结 audit gateway selection：LOCAL固定 `<paths.logDirectory>/nextagent-audit.<YYYY-MM-DD>.<sequence>.ndjson[.gz]`、30 MiB/process-local daily/gzip/最多10个压缩归档/7 elapsed-day aging/duplicate-tolerant append；REMOTE只消费 entrypoint-selected audit gateway且不 fallback。core app config和 runtime input拒绝 audit path/name/rotation/compression/retention/query/dedup/fallback字段。
  验证：`npx.cmd vitest run tests/agent-kernel/config-assembly.test.ts packages/agent-app/tests/logging-composition.test.ts tests/architecture/runtime-logging-boundary.test.ts`；LOCAL/REMOTE selection table tests。

## 3. Async writer, rotation, compression, and aging

- [x] 3.1 实现 Pino-backed async writer；console/file destination 均使用 `sync=false`、独立 `maxLength=4 MiB`，支持 console-only/file-only/both/disabled 和四级 threshold；不得产生 free-form second line。
  验证：新增 `packages/agent-log/tests/runtime-logger.test.ts`，覆盖所有 sink/level 组合、async destination options、独立 buffer 和 fixed maxLength。

- [x] 3.2 实现 component-scoped RuntimeLogger adapter；同步前处理仅限 bounded level/normalization/redaction/serialization/enqueue，normalized entry 最大 16 KiB，超限只保留 minimal safe substitute；方法 non-throwing，direct diagnostic 必须带稳定 event。
  验证：runtime logger tests 断言 component binding、event required、可选独立 msg、field/depth/message/entry budget、超限替代、redaction、调用不等待 injected slow destination/drain。

- [x] 3.3 实现 buffer-overload policy：新 entry drop、saturating dropped-count bucket、每 sink overload/recovery transition 至多一次 emergency evidence；不得复制 dropped payload、等待 drain或让一个 sink关闭另一个 sink。
  验证：deterministic tiny-buffer tests 覆盖 overflow、bounded memory、healthy-sink continuation、transition dedup、recovery summary 和 forbidden payload。

- [x] 3.4 在 `agent-local-file-roll` 实现 line-oriented handle：in-process pino-roll/SonicBoom async destination、safe policy validation、由 base/naming/extension 派生 exact selector、transport-owned current-active identity、size+fixed process-local daily 任一轮转、bounded buffer和 non-blocking enqueue；不接受 arbitrary matcher/delete callback/domain mode，不启用 pino-roll count delete/symlink/user frequency/timezone config。任务 27 在 foundation maintenance 增加 exact-selector archive count policy。`agent-log` 用 operational policy创建独立 4 MiB handle。
  验证：新增 `packages/agent-local-file-roll/tests/local-file-roll.test.ts`，用小 threshold + controlled process timezone/fake clock覆盖 size-first/time-first、两种 naming、普通跨日、DST 23/25-hour calendar day、active exclusion、buffer saturation、derived selector和 non-blocking enqueue；agent-log policy integration验证 current active projection。

- [x] 3.5 实现 gzip 原子归档：closed source -> `.gz.tmp` -> atomic `.gz` -> delete source；gzip/rename/abort failure 保留 source。
  验证：扩展 `packages/agent-local-file-roll/tests/local-file-roll.test.ts`，覆盖成功和各 failure point、archive 解压逐行完整性。

- [x] 3.6 实现 startup reconciliation 与每分钟 archive scan：按 `destination.file` 排除 active，清 stale temp，重试 eligible source，保持 closed timestamp并幂等。
  验证：foundation restart fixtures 覆盖 crash-before/after-rename、source+archive coexist、old low-volume segment 和 repeated run。

- [x] 3.7 实现 startup/hourly 7-day aging：按 `closedAt + retentionDays * 24h` elapsed time 删除 expired owned archive/source，保留 active/young/audit/developer-trace/unknown/symlink/outside files；不得按 local-midnight 次数老化。
  验证：foundation fake clock/process timezone覆盖 7 天边界、>7 policy、DST、daily active 上限、downtime reconciliation和 cross-family negatives。

- [x] 3.8 在 `agent-local-file-roll` 实现每 handle 单一 async maintenance lane、bounded async flush/close 和 double-close safety；业务 append不等待 maintenance，shutdown timeout 后结束。agent-log、7.9/7.10 的 LocalMetricHistoryExporter和7.2的 local audit gateway分别创建独立 handle/state。
  验证：foundation concurrency、AbortSignal、slow flush timeout、double-close、no-business-await和三 handle failure-isolation tests。

## 4. Single operational writer composition

- [x] 4.1 `agent-app` 根据 frozen config 创建唯一 operational writer，并为每个 product owner 派生可信 component-scoped adapters；移除 hardcoded runtime/observability file composition。
  验证：新增 `packages/agent-app/tests/logging-composition.test.ts`，断言 single file family、single active destination 和 owner components。

- [x] 4.2 operational writer 强制区分 `surface=observation_derived` 与 `surface=runtime_diagnostic`，StructuredLogEntry 按 logical debug/info/warn/error 路由；两者的每条 physical line都要求稳定 code-owned log event，但 direct diagnostic不要求业务 event或observation。最终统一 logger API 与单一写入管道由任务 20.1 收敛。
  验证：新增/扩展 `packages/agent-observability/tests/structured-log-projector.test.ts` 与 app composition tests。

- [x] 4.3 迁移现有 product concrete/direct operational bypass：删除 `agent-common/createRuntimeLogger` 产品使用、sandbox `logFile/defaultSandboxLogger`、`agent-channel-task` direct console warning 和其它 `nextagent-runtime.log`/`nextagent-observability.log` 构造；保留文档化 CLI/developer-trace exclusions。
  验证：architecture source negatives + `tests/agent-kernel/logging.test.ts`；显式断言 task callback abandonment 使用 component logger。

- [x] 4.4 删除 generic runtime-log-to-observation bridge、`createRuntimeObservationLogger` 和对应 tests；direct RuntimeLogger call 不得创建 observation，projectors 不得读取 operational file。
  验证：`npx.cmd vitest run tests/agent-kernel/trace-log-linking.test.ts packages/agent-app/tests/logging-composition.test.ts tests/architecture/runtime-logging-boundary.test.ts`。

- [x] 4.5 更新 local package config/evidence，证明 async writer、operational logical base/numbered segment、size+daily/gzip/7-day policy、console/file defaults、write-only audit gateway独立 NDJSON/rotation/gzip/fixed 7-day aging/no-SQLite、LOCAL 60s metrics NDJSON history family 和 audit/metric-log absence。
  验证：迁移 `tests/local-runtime-package.test.ts`、`tests/agent-kernel/risk-policy-enforcement.test.ts`、`tests/e2e/p1-p2-scenario-gate/extension-governance.test.ts` 的 legacy path assertions；运行这些 suites和 `tests/e2e/release-package/release-package-gate.test.ts`。

- [x] 4.6 冻结并实现 observability infrastructure lifecycle order：config freeze 后 operational destinations -> deployment audit gateway -> MeterProvider/reader/exporter -> projectors/business producers；shutdown 先 stop producer并 bounded drain projector host，再独立 bounded close audit gateway、metrics forceFlush/shutdown + `LocalMetricHistoryExporter` file-lifecycle close，最后输出 shutdown completed 并 flush/close operational writer。任一 finalizer failure不得跳过后续 finalizer。
  验证：新增/扩展 `packages/agent-app/tests/app-lifecycle-composition.test.ts` 和 `packages/agent-app/tests/metrics-exporter-composition.test.ts`，用 ordered spies/failing finalizers覆盖 startup order、projector drain、audit close failure、producer close failure、metrics timeout/degraded diagnostic、operational close last、double-close和 timeout continuation。

- [x] 4.7 迁移 Agent Dev Workbench log-evidence consumer：`agent-log` 暴露由 `destination.file` 支撑的只读 current-active identity，`agent-app` 注入 current-active provider；Workbench 只异步读取查询时提供的 active segment并从 parsed `surface` 映射现有 evidence source，删除 filename heuristic、目录扫描和最高 sequence 猜测。closed source、gzip archive、metrics/audit/developer-trace/legacy/symlink/unknown file一律不读取。
  验证：扩展 `packages/agent-dev-workbench/tests/sqlite-read-port.test.ts` 与 browser smoke/contract tests，覆盖双 surface、active byte/result/time/deadline bounds、partial/parse failure、active rotation race、archive-only无证据、other-domain exclusion、stable-ref filter和 query 不阻塞代表性 request；断言无目录扫描与 gzip 解压路径。

## 5. Timeline-derived trajectory coverage

- [x] 5.1 为现有 TimelineObservationMapper 增加 characterization tests，再从 `audit/` 迁移到 `runtime/` 或 `trajectory/` acquisition path 并更新 exports。
  验证：新增 `packages/agent-observability/tests/timeline-observation-mapper.test.ts`，先锁定现有 request/policy/hook 行为。

- [x] 5.2 补齐 request accepted/terminal、model started/completed/failed canonical mapping，并保持 credential/quota/security/general operation 分类。
  验证：mapper table tests + runtime trajectory integration，逐 fact exact-once。

- [x] 5.3 补齐 capability started/completed/denied/security/policy-blocked canonical mapping；`tool.call.result_invalid` 抛出前必须产生 existing safe failure timeline fact。
  验证：`npx.cmd vitest run tests/agent-kernel/tool-loop.test.ts tests/agent-kernel/capability-governance.test.ts packages/agent-observability/tests/timeline-observation-mapper.test.ts`。

- [x] 5.4 补齐 policy/hook、context compaction/degradation、pending-input 和 background-task canonical mapping；接通 existing hook/attachment trajectory families，并把各 observation operation/outcome收敛为 cataloged具体 log event，不新增平行 coarse taxonomy。
  验证：mapper/projector table tests 覆盖 positive/skip/level；`PLANNING_STARTED` 必须 skip。

- [x] 5.5 实现 content-free first-visible info milestone，以 `runId + stepId` once，并在 request terminal 清理全部 run-scoped timing/dedup state。
  验证：live delta 内容 negative、multiple-delta once、terminal cleanup/reused-id tests。

- [x] 5.6 删除 model observation wrapper、wrapper-only context、generic internal observer；保持原始 model service 由 core 使用。
  验证：`npx.cmd vitest run packages/agent-core/tests/model-fallback-orchestration.test.ts packages/agent-app/tests/runtime-trajectory-observability.test.ts`；model exact-count。

- [x] 5.7 收敛 runtime `submit.ts` direct logs：删除 canonical model/request terminal duplicate，保留 queue/dispatch/commit-private/recovery/async-side-effect component diagnostics并规范 level/safety。
  验证：`npx.cmd vitest run tests/agent-kernel/runtime-foundation.test.ts tests/agent-kernel/session-lane-scheduling.test.ts tests/agent-kernel/terminal-consistency.test.ts tests/agent-kernel/logging.test.ts`。

- [x] 5.8 收敛 `tool-loop.ts` direct logs：删除 capability/policy canonical duplicate和不安全 args/result/error；保留真正 owner-private diagnostic。
  验证：`npx.cmd vitest run tests/agent-kernel/tool-loop.test.ts tests/agent-kernel/risk-policy-sandbox.test.ts tests/agent-kernel/redaction-policy.test.ts`。

## 6. Narrow adapters and cataloged runtime milestones

- [x] 6.1 Fastify server boundary 使用 component RuntimeLogger：`onResponse` completed、`onError` failed + request-local marker，`setErrorHandler` 只做 response mapping；每 HTTP request exact-one server access record，业务侧不产生第二个 HTTP lifecycle outcome。
  验证：channel/app integration 覆盖 success、normal 4xx、validation、throw、mapping 和 forged headers；`npx.cmd vitest run packages/agent-channel-web/tests packages/agent-app/tests/logging-composition.test.ts`。

- [x] 6.2 stream owner 使用 component RuntimeLogger 输出 cataloged debug/warn/error milestones，只信任 server id 和 lookup 后坐标。
  验证：`npx.cmd vitest run tests/agent-kernel/web-stream-transports.test.ts tests/agent-kernel/logging.test.ts`。

- [x] 6.3 pre-acceptance rejection 使用 runtime 内持有可信 lookup/scope 的窄 typed observer，不使用 default Agent、不伪造 run。
  验证：`npx.cmd vitest run tests/agent-kernel/runtime-foundation.test.ts tests/agent-kernel/owner-scope.test.ts tests/agent-kernel/logging.test.ts`。

- [x] 6.4 只包装 ContextEnginePort.assemble，成功 info、失败 error；不包装 render、compaction 或 degradation timeline fact。
  验证：`npx.cmd vitest run packages/agent-context-engine/tests packages/agent-app/tests/runtime-trajectory-observability.test.ts tests/agent-kernel/redaction-policy.test.ts`。

- [x] 6.5 只包装 AppSandboxGatewayPort.execute/executeWithStdoutChunks，透明传递 result/error/AbortSignal/chunks；success info，denied warn，failed error；不包装 stores/readiness/capability-covered calls。
  验证：`npx.cmd vitest run tests/agent-kernel/local-gateway-contract.test.ts tests/agent-kernel/risk-policy-sandbox.test.ts tests/agent-kernel/redaction-policy.test.ts`。

- [x] 6.6 补齐 app/config/server/recovery/startup/listen/shutdown 与 gateway binding cataloged milestones；不输出 host/port/path/config value。
  验证：新增 `packages/agent-app/tests/app-lifecycle-composition.test.ts` + config/logging tests，逐 event level/fields/exact-count。

- [x] 6.7 补齐 task callback、terminal-private、background-private 和 logging maintenance milestones；operational owner消费 foundation generic maintenance outcome并对 ready、archive/retention failed/recovered、flush/close failed作有界安全映射；direct component diagnostic 必须使用稳定 event 且不得重复 cataloged outcome。
  验证：task-channel、terminal、background、archive tests逐 milestone覆盖；增加 missing-event drop negative case。

- [x] 6.8 关闭 successful health probe 的 LOG projection；health/metric truth 保持，只有状态 transition 或 probe subsystem failure 可走 component logger。
  验证：health tests 断言 repeated success 无 operational log，transition/failure bounded once。

- [x] 6.9 增加 isolated black-box request trajectory test：default info 包含 request/model/capability bookends，并保留 context success、first-visible、policy allow、hook success、sandbox success 等关键 child-stage milestone；metric、process lifecycle 不进入 per-request trajectory，failure仍可见。
  验证：从 console capture/operational file 按 cataloged events筛选，不断言私有 logger call count。

## 7. Audit and metrics separation

- [x] 7.1 收敛 gateway audit public contract：`AuditEventRecord`、`AuditEventStoreGateway` 只由 `agent-contracts/gateway` 定义；port 改为单一 `appendAuditEvent(record): Promise<void>`；新增 top-level `GatewayBindings.audit`，删除 `AuditEventRecordQuery`、`listAuditEvents(...)` 和 `SqliteGatewayStoreBindings.audit`，不新增平行 `agent-gateway` package/contract或 test-only product query。
  验证：`npm run test:contract`；`tests/architecture/runtime-logging-boundary.test.ts` 与 gateway provider ownership tests断言 canonical export、top-level binding、write-only shape、no Sqlite member/query/reverse dependency。

- [x] 7.2 在 `agent-platform-gateway-local` 实现 `FileAuditEventStoreGateway`，直接依赖 `@nextagent/agent-local-file-roll`：私有 `schemaVersion=1` envelope每次 append一条完整 AuditEventRecord；gateway owning audit policy/append result/duplicate semantics并创建独立 base/date/30 MiB/process-local daily/最多10个压缩归档/7 elapsed-day handle，不直接依赖 pino-roll/SonicBoom/zlib，也不复用 log/metrics handle/state。stable scoped auditId retry允许 duplicate完整行，不建设跨重启 index。
  验证：新增 `packages/agent-platform-gateway-local/tests/file-audit-event-store.test.ts`，覆盖完整 line/schema、policy传递、duplicate retry、no partial line、mechanism failure mapping、独立 handle/cross-family isolation和 bounded close；轮转/gzip/reconciliation/aging算法由 foundation contract tests统一覆盖。

- [x] 7.3 删除 `SqliteAuditStore`、`audit_events` table/index/core methods和 schema ownership，禁止 migrate/dual-write/fallback；删除 `LoggingAuditEventWriter`/legacy `nextagent-audit.log` mirror。app 提供 AuditEventWriter adapter显式完成 `AuditEvent -> AuditEventRecord` 映射后调用 selected `GatewayBindings.audit`；产品/contract tests从 `listAuditEvents` 迁移到 injected capture gateway或 test-owned audit file parser；REMOTE missing/service gateway只 degraded且不 fallback local/SQLite/log。
  验证：`npx.cmd vitest run tests/agent-kernel/audit-sink.test.ts packages/agent-app/tests/logging-composition.test.ts packages/agent-platform-gateway-local/tests/file-audit-event-store.test.ts packages/agent-platform-gateway-local/tests/sqlite-provider-schema-ownership.test.ts packages/agent-dev-workbench/tests/sqlite-read-port.test.ts`；risk-policy/sandbox/tool/hook/web tests改用 capture/file evidence并断言 no `audit_events`、no query、DO-to-Record、no mirror/fallback。

- [x] 7.4 删除 `createLocalMetricsLogSink`、`metric_diagnostic` surface/product path和 late-sink raw sample replay；product metrics 只接到 OTel Meter adapter，`agent-observability` direct dependencies 固定 `@opentelemetry/sdk-metrics@2.9.0`、`@opentelemetry/resources@2.9.0`，并 owning resource/MeterProvider/reader lifecycle。
  验证：`npx.cmd vitest run packages/agent-observability/tests/metrics-registry.test.ts packages/agent-observability/tests/otel-metrics-sink.test.ts packages/agent-app/tests/otel-observability-adapter.test.ts packages/agent-app/tests/logging-composition.test.ts`；断言 operational console/file/archive无 metric payload且 production 无 local-log/late-replay sink。

- [x] 7.5 实现单一 immutable `MetricDescriptor` inventory，统一 owning name/kind/unit/allowed labels/value source/acquisition source和 OTel instrument creation；删除平行 `metricPolicies`。duration/TTFT/chunk-latency unit=`s`、token unit=`{token}`、其它 counter unit=`1`；所有 seconds histogram使用 `[0.005,0.01,0.025,0.05,0.1,0.25,0.5,1,2.5,5,10,30,60,120,300]` explicit boundaries。
  验证：descriptor completeness table test逐一覆盖现有 inventory、label rejection、unit/kind/source、instrument exact-once creation和 frozen bucket aggregation；SDK dependency upgrade不得改变 bucket output。

- [x] 7.6 将 production MetricsRegistry 收敛为 streaming-only：descriptor validation 后直接 record OTel instrument，不保留 `MetricSample[]`/snapshot/history；`InMemoryMetricsRegistry.snapshot()` 只允许 test 显式注入。迁移依赖 product snapshot 的测试，不为了测试断言保留生产 raw history。
  验证：扩展 `packages/agent-observability/tests/metrics-registry.test.ts`，覆盖长期 record 无 raw-history growth、无 late replay和 test fixture snapshot；迁移所有 `app.metricsRegistry.snapshot()` 测试为显式 test registry/exporter injection，并增加 product composition bounded-memory assertion。

- [x] 7.7 把 `MetricsProjector.emittedDedupKeys` 替换为 deterministic 16,384-key FIFO recent-fact set：preferred/fallback competing observation在窗口内去重，容量满先逐出最老 key；不持久化、不宣称 durable exactly-once。
  验证：扩展 `packages/agent-observability/tests/metrics-registry.test.ts`，覆盖 duplicate suppression、16,384/16,385 eviction、FIFO order、preferred/fallback window和 process-lifetime memory cap。

- [x] 7.8 实现 shared OTel SDK composition：`agent-app` 在 frozen config、operational writer和deployment audit gateway start 后创建 MeterProvider/`PeriodicExportingMetricReader`，policy为60s interval、10s timeout、cumulative temporality、descriptor-owned explicit-bucket histogram、200/instrument cardinality limit；trusted REMOTE option只接受 infrastructure `PushMetricExporter`，test composition注入 in-memory exporter，request/model/capability 路径只 record、不 await collect/export。
  验证：新增 `packages/agent-app/tests/metrics-exporter-composition.test.ts`，用 fake clock/exporter覆盖 LOCAL/REMOTE/test selection、REMOTE missing exporter degraded、周期、聚合、cardinality、single reader、startup/lifecycle order、forceFlush/shutdown timeout 和 no-business-await；`tests/architecture/otel-observability-boundary.test.ts` 断言 exporter type不进入agent-contracts/business packages。

- [x] 7.9 在 `agent-observability` 实现 `LocalMetricHistoryExporter` 和 `NextAgentMetricSnapshotV1` normalization，直接依赖 `@nextagent/agent-local-file-roll`：每次成功 collection 先在内存生成一条 UTF-8 bytes（含换行）不超过 4 MiB 的 deterministic JSON line，再 non-blocking enqueue 到 exporter独立 8 MiB handle；exporter owning metrics policy/single-flight/export result，不直接依赖 pino-roll/SonicBoom/zlib，也不复用 `agent-log` handle/state；超限/饱和/失败不得写 partial line或影响业务结果。
  验证：新增 `packages/agent-observability/tests/local-metric-history-exporter.test.ts`，覆盖 counter/histogram cumulative shape、descriptor unit/buckets、point time/reset、deterministic NDJSON、multiple exports、4 MiB/8 MiB边界、serialize/enqueue/write failure、single-flight、prior-line preservation、policy传递和独立 handle ownership。

- [x] 7.10 LOCAL entrypoint 默认注入 history exporter；exporter-owned metrics family固定 base/dateFormat/process-local daily/30 MiB/gzip/最多10个压缩归档/7-elapsed-day policy。local package evidence证明无需 Prometheus即可通过多次 `forceFlush` 在同一 active file形成趋势，跨本地日历日/size生成 sequence archive并自动老化；不得每分钟建文件。
  验证：`npx.cmd vitest run tests/local-runtime-package.test.ts packages/agent-app/tests/otel-observability-adapter.test.ts packages/agent-observability/tests/local-metric-history-exporter.test.ts`；controlled timezone/fake clock覆盖 size-first/time-first、普通跨日、DST、atomic gzip/reconciliation和elapsed retention。

- [x] 7.11 REMOTE/PaaS entrypoint 使用 fixed `@opentelemetry/exporter-metrics-otlp-proto@0.220.0` 注入 official OTLP HTTP/protobuf metric exporter；按标准 precedence读取 signal-specific/general endpoint和可选 headers/compression，缺 endpoint 时 metrics degraded且不使用localhost default；resource只允许 service name/version/deployment mode。core app不 import concrete exporter，REMOTE 不创建/fallback local metrics file；为 remote deployment package 增加 test script。
  验证：新增 `packages/agent-remote-deployment/tests/otel-metrics-composition.test.ts`，用 fake OTLP endpoint/adapter覆盖 signal/general precedence、missing endpoint、bounded failure、safe evidence、resource allowlist和no-local-file；`tests/architecture/otel-observability-boundary.test.ts` 断言 concrete OTLP dependency只在 remote deployment/infrastructure boundary且raw config不进入core。

- [x] 7.12 增加 metrics file/OTLP security and failure tests：snapshot line 只含 descriptor 允许的 resource/labels/aggregates，不含 raw samples、exemplars或 owner/correlation/content/path/credential canary；LOCAL serialize/enqueue/write/rotation/gzip/retention failure只 degraded并保留已有完整 evidence，REMOTE failure只 degraded且不 fallback。`metrics.export.degraded/recovered` 只按状态转换记录，不逐 sample/snapshot/retry。
  验证：`npx.cmd vitest run packages/agent-observability/tests/local-metric-history-exporter.test.ts packages/agent-remote-deployment/tests/otel-metrics-composition.test.ts packages/agent-app/tests/logging-composition.test.ts tests/agent-kernel/redaction-policy.test.ts tests/architecture/otel-observability-boundary.test.ts`；operational console/file/archive断言无 metric payload且 lifecycle diagnostic bounded。

## 8. Failure isolation, performance, and security

- [x] 8.1 注入 file/console/emergency reporter init/write failure，断言 app ready 和业务结果不变；健康 sink继续，async emergency stderr 每状态转换至多一次且调用者不等待，reporter failure静默，logging不得触发 shutdown。
  验证：agent-log/app composition failure tests + `tests/e2e/resilience/resilience-gate.test.ts`。

- [x] 8.2 分别向 `agent-log` operational lifecycle、`LocalMetricHistoryExporter` lifecycle 与 local file audit gateway 注入 write/rotation/gzip/rename/reconciliation/retention/flush/close failure；断言 request/terminal/stream/model/capability/gateway results不变，source/archive按保守规则保留且一个 owner failure不关闭另一个。
  验证：agent-log/metrics exporter/file audit gateway/app failure tests + resilience gate。

- [x] 8.3 增加 non-blocking/capacity characterization：slow destination、blocked drain、operational full 4 MiB buffer/oversize 16 KiB entry、metrics full 8 MiB buffer/oversize 4 MiB line、slow audit append、production registry无 raw sample history、dedup 16,384 cap、slow gzip/retention/Workbench active-read rotation race 时业务 log call、audit observation accept、metric record和代表性 request不等待 sink/reader；内存有界，业务路径禁止同步 append/flush/decompress filesystem path，Workbench 不得包含 archive decompression path。
  验证：deterministic fake destination/timer/archive/active-reader tests + long-running bounded-memory assertion + architecture forbidden API checks。

- [x] 8.4 增加 forbidden-content tests，覆盖 stable-event direct diagnostic、missing-event drop、observation-derived entry和versioned audit line；operational console/active/closed/archive、audit active/closed/archive、emergency stderr均不得出现敏感 canary。
  验证：`npx.cmd vitest run tests/agent-kernel/redaction-policy.test.ts tests/agent-kernel/logging.test.ts packages/agent-log/tests packages/agent-platform-gateway-local/tests/file-audit-event-store.test.ts`。

- [x] 8.5 增加 file ownership negative tests：`agent-log`、`LocalMetricHistoryExporter` 与 file audit gateway共享 foundation factory/算法但不共享 handle/state/policy；unsafe name/path traversal/symlink/unknown/developer trace/outside files不得被压缩或老化；derived exact selectors互斥且每个 handle只能删除自己证明归属且已到期的 closed source/archive。禁止 arbitrary matcher/delete callback和 foundation domain mode。
  验证：`packages/agent-local-file-roll/tests/local-file-roll.test.ts` + 三 owner policy integration + runtime logging architecture tests。

## 9. Final verification

- [x] 9.1 运行 change 与全量 OpenSpec strict validation并做 cross-spec review，确认 stable-event direct logs、top-level write-only `agent-contracts/gateway` audit contract、LOCAL audit file/no-SQLite/duplicate-tolerant/fixed 7-day aging、streaming production metrics/descriptor/bounded dedup、LOCAL 60s metrics history、REMOTE OTLP、Workbench active-only evidence、shared foundation + 三个 consumer/四个独立 handles、startup/shutdown order、async failure和 process-local size+daily/elapsed retention一致。
  验证：`openspec validate add-ts-runtime-operational-log-hardening --strict`；`openspec validate --all --strict`。

- [x] 9.2 运行专项 black-box suite并记录 single operational writer、component envelope、stable-event direct log与missing-event drop、timeline exact-count、foundation process-local daily+size/gzip/reconciliation/elapsed retention、安全 selector和 bounded handle、三个 owner独立 policy/handle、LOCAL audit NDJSON/no-SQLite/no-query/duplicate、audit/metric operational-log absence、bounded product metric memory、descriptor/buckets、LOCAL metrics multi-interval trend、REMOTE OTLP、Workbench active-only/rotation-race evidence、lifecycle order、async no-wait、cross-owner isolation和failure证据。
  验证：`npx.cmd vitest run packages/agent-local-file-roll/tests packages/agent-log/tests packages/agent-platform-gateway-local/tests/file-audit-event-store.test.ts packages/agent-platform-gateway-local/tests/sqlite-provider-schema-ownership.test.ts packages/agent-app/tests/logging-composition.test.ts packages/agent-app/tests/app-lifecycle-composition.test.ts packages/agent-app/tests/runtime-trajectory-observability.test.ts packages/agent-app/tests/metrics-exporter-composition.test.ts packages/agent-observability/tests/timeline-observation-mapper.test.ts packages/agent-observability/tests/structured-log-projector.test.ts packages/agent-observability/tests/metrics-registry.test.ts packages/agent-observability/tests/local-metric-history-exporter.test.ts packages/agent-app/tests/otel-observability-adapter.test.ts packages/agent-remote-deployment/tests/otel-metrics-composition.test.ts packages/agent-dev-workbench/tests/sqlite-read-port.test.ts tests/agent-kernel/audit-sink.test.ts tests/agent-kernel/logging.test.ts tests/local-runtime-package.test.ts tests/agent-kernel/risk-policy-enforcement.test.ts tests/e2e/p1-p2-scenario-gate/extension-governance.test.ts`。

- [x] 9.3 运行常规质量门禁。
  验证：`npm run build`；`npm test`；`npm run test:contract`；`npm run lint:architecture`。

- [x] 9.4 实施完成且进入归档准备后执行 baseline promotion；active implementation 阶段不提前修改长期 baseline。归档前必须实际更新 `ts-backend-architecture.md` technical-foundation分类/allowlist、`local-runtime-packaging.md` 三 handle模型、`observability-boundaries.md` 语义分离、新增 `modules/agent-local-file-roll.md`、更新三个 consumer module designs、新增 `adr/local-file-roll-foundation-boundary.md` 和更新 spec-to-design-map。
  验证：逐文件 baseline diff review；proposal/design promotion plan 与 local-file-roll/ts-minimal-agent-kernel delta specs一致；缺任一架构设计文档或 dependency-firewall说明不得归档。

- [x] 9.5 完成新增基础设施依赖治理核对：`agent-local-file-roll` 直接声明 `pino-roll@4.0.0`、`sonic-boom@4.2.1` 并私有使用 zlib；`agent-log` 直接声明 `pino@10.3.1` 和 foundation workspace dependency；`agent-observability` 直接声明 foundation、`@opentelemetry/sdk-metrics@2.9.0`、`@opentelemetry/resources@2.9.0`；`agent-platform-gateway-local` 只为 audit file mechanism声明 foundation；remote deployment直接声明 `@opentelemetry/exporter-metrics-otlp-proto@0.220.0`。root/workspace manifests 与 lockfile一致，并同步 `docs/NextAgent 开源组件清单.md` 的版本、使用 package 和用途。
  验证：manifest/lockfile/component-inventory diff review；`npm install` 无漂移；`npm run build`；`npm run lint:architecture`。

## 10. Root-cause diagnosis hardening

- [x] 10.1 冻结 operational root-cause evidence 的公共安全边界：每条 entry 增加 app-owned `serviceVersion`；公共 writer 接收独立 caught value，runtime-owned diagnostic 可输出统一净化有界的 `rawExceptionData.message` / cause message，并投影 allowlisted type、opaque fingerprint和 NextAgent-owned `package#file:line:column` frame；禁止 raw stack/host path/provider frame/credential，投影失败 non-throwing且不回退原始异常。
  验证：`packages/agent-log/tests/runtime-logger.test.ts` 覆盖 reserved version、TypeError/cause、owned/unowned/unparseable frames、fingerprint稳定性、frame上限以及 path/message/secret canary 排除。

- [x] 10.2 保持 model/capability canonical failure 与 direct diagnostic 的事实责任分离：canonical terminal 是唯一 lifecycle outcome，direct diagnostic不创建 timeline/observation、不被 projector 解析，也不伪造结果型 exception。
  验证：agent-core model/tool black-box tests + app logging composition，断言 unexpected throw 同时得到 exact-one canonical terminal和exact-one关联诊断，已知 SafeError 仍只有 canonical outcome。

- [x] 10.3 从根因定位角度审计 cataloged error path，删除 `error.message/errorName/String(error)`、`NATRACE` console 平行投影和同 sink递归 logging-failed 补偿；保留 serviceVersion、稳定 event/failureStage、safe reason、可信关联和安全异常指纹。
  验证：相关 package tests + source/architecture review；注入 nested Error/cause、trace exporter/projector failure和 logger throw，确认业务结果/重抛语义不变、endpoint/credential/raw error不输出、同 sink不重试且 default info trajectory 不引入无关 process/metric 噪声。

- [x] 10.4 完成专项安全与根因定位黑盒验收，并重新运行 OpenSpec、build、存量测试、contract和architecture门禁；完成 push 前模型语义检视，修复所有 P0/P1和无 follow-up 的 P2。
  验证：`openspec validate --all --strict`；`npm run build`；`npm test`；`npm run test:contract`；`npm run lint:architecture`；`$nextagent-code-review`。

- [x] 10.5 移除 Skill discovery 的 parser diagnostic message 日志/readiness 泄漏，只保留 stable reason-code list/count；把 local runtime ready/self-check 建模为单一 CLI output boundary，self-check 只输出 allowlisted code/evidence ref并捕获 raw exception，禁止 agent-app 产品源码 `console.*`。
  验证：builtin/local Skill source canary tests + local runtime package self-check black-box test + runtime logging architecture negative test；重新运行 `openspec validate --all --strict`、build、存量测试、contract、architecture和 push 前 `$nextagent-code-review`。

## 11. Operator-facing schema normalization

- [x] 11.1 冻结并实现 operational physical schema：文本 level、writer timestamp、surface/component/serviceVersion、单一 stable event；删除 persisted operation/outcome，msg只允许作为公共writer净化后的独立可选人类可读字段，observation occurrence time使用独立 occurredAt。
  验证：agent-log逐行JSON测试断言文本level、reserved overwrite与msg独立净化；全仓 operational black-box输出不含numeric level/operation/outcome或fields内嵌msg/message。

- [x] 11.2 收敛 StructuredLogProjector：把内部 boundary/operation/outcome映射为具体dot-separated event；扁平输出agentId/agentVersion/sessionId/requestId/runId/timelineEventId/capabilityInvocationId，删除ownerScope/correlation/requestContextId/stepId/processState/safeSummary并保持默认 info trajectory 可定位。
  验证：structured projector/table tests、runtime trajectory integration、redaction和Workbench active evidence tests覆盖字段白名单、事件具体性、occurredAt与writer timestamp差异。

- [x] 11.3 修改 RuntimeLogger error/warn入口，统一采用 Pino 风格 `fields,msg?`，捕获异常放入标准 `err` 字段；公共writer统一分类AgentError、ordinary Error和non-Error throw，caller提供event/failureStage/trusted refs及真正独立的safeReasonCode。
  验证：agent-common contract、agent-log error matrix tests覆盖domain/internal/plain/non-error/no-caught、cause、fingerprint、owned frames、独立safe reason、non-throwing和raw value排除。

- [x] 11.4 迁移本change触达的所有产品RuntimeLogger调用：移除未净化或fields内嵌的free-form message、日志专用`instanceof Error`/AgentError category判断、`exception` field、requestContextId和stepId；为无event调用增加窄stable event，安全动态msg通过独立参数传入，不改变业务错误映射、重试、取消或HTTP response判断。
  验证：root `npm run build` 必须先执行 `tsc -b` 覆盖后端 project references，再执行 Web build；architecture test锁定该标准门禁；source negatives只禁止RuntimeLogger旁路/旧签名/exception field和重复helper，不误伤业务语义Error判断。

- [x] 11.5 完成schema兼容性、安全、黑盒和全量回归；确认无废弃或平行message sanitizer/renderer、旧StructuredLogEvent coarse taxonomy、第二套error classifier或无用fields。
  验证：专项Vitest、`openspec validate --all --strict`、`npm run build`、`npm test`、`npm run test:contract`、`npm run lint:architecture`、push前`$nextagent-code-review`。

## 12. Human-readable message and centralized sanitization

- [x] 12.1 修订 RuntimeLogger contract：debug/info/warn/error均支持`fields, msg?`，warn/error通过标准 `fields.err` 传递捕获对象；msg必须与fields分离，fields内嵌msg/message不可覆盖公共writer。
  验证：agent-common contract tests + root `tsc -b` 覆盖所有结构化mock与调用方。

- [x] 12.2 在`agent-log`集中实现字段、msg和`err`净化：msg单行化、UTF-8 1 KiB限长、secret/path masking；异常集中投影allowlisted type、stable exceptionCode、fingerprint/owned frames；任何净化失败只省略可选证据而保留stable event。
  验证：agent-log matrix覆盖四level、两类warn/error overload、动态变量、reserved覆盖、secret/path/control/newline、oversize/invalid msg、Node error code、throwing accessor和non-throwing。

- [x] 12.3 移除本change触达范围内的logging-only caller try/catch、Error code/message/name分类和重复message sanitizer；保留业务/跨surface数据最小化与observation sanitizer。为高价值operator diagnostic增加只在提供安全动态上下文时存在的msg，且动态变量同步存在于fields。
  验证：context budget、app listen和Skill discovery tests；architecture source negative禁止caught放fields、fields内msg/message、logging-only Error分类/净化helper，不禁止业务错误映射或跨surface sanitizer。

- [x] 12.4 完成black-box安全与可维护性验收：event在有/无/非法msg时保持稳定可检索，msg不得成为唯一变量载体；除 canonical `toolInput` / `toolOutput` 外，operational console/file/Workbench evidence不得出现credential、raw error、parser原文、prompt/model/tool result；normal/debug Tool runtime direct diagnostic 的两字段保留 prompt/path/command/content 和非秘密 credential/token 诊断字段，credential 与认证类 token 窄匹配脱敏且不得误伤正常字段；entry预算与业务non-blocking/non-fatal语义不变。
  验证：agent-log、logging composition、Skill canary、redaction、Workbench active evidence和runtime logging architecture专项测试。
  实际结果：`npx vitest run --config vitest.config.release.ts packages/agent-log/tests/runtime-logger.test.ts` 33/33 passed；`npx vitest run --config vitest.config.release.ts packages/agent-app/tests/logging-composition.test.ts` 7/7 passed；`npm run lint:architecture` 42 files、254/254 tests passed。

- [x] 12.5 运行全量OpenSpec/build/test/contract/architecture门禁，完成push前模型语义检视并确认与最新main无冲突后提交推送。
  验证：`openspec validate --all --strict`；`npm run build`；`npm test`；`npm run test:contract`；`npm run lint:architecture`；`$nextagent-code-review`；remote push evidence。

## 13. Actual-output operational quality hardening

- [x] 13.1 把 HTTP 访问事实收敛为 Fastify server boundary 唯一的 `server.access.completed/failed` record，删除 `http.request.*`；使用 `serverRequestId`、validated `routeTemplate`、statusFamily和duration，不把 transport id伪装成业务requestId，也不启用绕过公共writer的raw Fastify logger。
  验证：app black-box覆盖success、404、validation/error、forged header、exact-one和source negative。

- [x] 13.2 在`agent-log`实现key-aware semantic allowlist：仅保真非负整数usage token counts和安全routeTemplate；相邻token/credential/path/query仍脱敏。micro-compact改用decisionBranch，调用方不增加第二套sanitizer。
  验证：agent-log physical JSON black-box同时断言approved fields保真和敏感canary拒绝；context integration断言无`path`误脱敏字段。

- [x] 13.3 修正运维级别和具体事件：policy allow、context success、hook success、sandbox success和 first-visible 为 info；budget/micro-compact success、task trajectory enqueue/build/skip为debug；drop/partial scan为warn；failure为error；task trajectory使用五个具体event且details不重复reasonCode。
  验证：projector、context、memory和capability composition table tests覆盖level/event/field exact shape。

- [x] 13.4 category-question source unavailable按agent+locale状态转换限频并输出recovered；runtime package从manifest version+candidateId派生bounded serviceVersion，并同时绑定operational/metrics。
  验证：session transition tests、local/remote package candidate identity tests、app writer/metrics resource tests。

- [x] 13.5 运行实际输出黑盒、OpenSpec、build、全部存量test、contract和architecture门禁；执行push前模型语义检视，修复P0/P1和无follow-up P2，合并最新main后提交推送。
  验证：`openspec validate --all --strict`；专项Vitest；`npm run build`；`npm test`；`npm run test:contract`；`npm run lint:architecture`；`$nextagent-code-review`；main merge/push evidence。

## 14. Pino-compatible logger acquisition and single composition

- [x] 14.1 修订 proposal/design/runtime-logging delta：冻结 `agent-common/getLogger({component, source?})` lazy facade、Pino-compatible `fields,msg?` API、标准 `err` 字段、`agent-app` 单 active provider 装配和不暴露 raw child options 的安全边界。
  验证：`openspec validate add-ts-runtime-operational-log-hardening --strict`。

- [x] 14.2 在 `agent-common` 实现无 I/O lazy facade、provider binding handle、稳定 code-owned bindings 校验和 non-throwing/no-provider 行为；在 `agent-log` 用 Pino root child 实现 provider，保留唯一集中安全投影并优先使用 Pino 的 level/bindings/redaction/serializer 能力。
  验证：agent-common contract tests、agent-log physical JSON/security/error matrix tests。

- [x] 14.3 `agent-app` 只在启动时创建 writer 并绑定 provider 一次，close 后按 owner token 解绑；删除 `loggerFor/componentLogger` 装配循环和生产代码中的 logging-only constructor/options/dependency threading。
  验证：app composition/lifecycle tests，architecture source negative 断言新增类获取 logger 无需修改 composition root。

- [x] 14.4 全量迁移 product RuntimeLogger 调用为 `getLogger` 与 Pino-compatible `logger.error({err,...fields}, msg?)`，删除旧 caught overload、caller error 分类/净化和第二套 product logger 实现；保留 observation writer、CLI output 等已规格化的独立边界。
  验证：root `tsc -b`、专项 package tests、source negative、无旧签名/冗余字段/废弃装配检索。

- [x] 14.5 完成黑盒、安全、契约、架构和全部存量回归；执行 push 前模型语义检视，修复阻断项，合并最新 main、解决冲突、提交并推送。
  验证：`openspec validate --all --strict`、`npm run build`、`npm test`、`npm run test:contract`、`npm run lint:architecture`、`$nextagent-code-review`、merge/push evidence。

## 15. Unified observability logging configuration

- [x] 15.1 修订 proposal/design/app-config/runtime-logging/redaction-policy delta，冻结唯一 `observability.logging` 对象；`diagnosticDetail` 只控制已安全批准的诊断细节，安全脱敏始终开启；旧 `observability.runtimeLogging` 与 `observability.logging.redaction` 必须拒绝且不保留别名或第二套 projection。
  验证：`openspec validate add-ts-runtime-operational-log-hardening --strict`；`openspec validate --all --strict`。

- [x] 15.2 统一 `agent-app` 配置 type/schema/default/frozen projection/consumer：删除 `RuntimeLoggingConfig` 和 `runtimeLoggingProfile` vocabulary，operational writer 与 observation detail 均只读取 `observability.logging`。
  验证：root `tsc -b`；config、logging composition、structured projector 专项测试。

- [x] 15.3 增加统一配置正负验收并更新当前开发文档：默认/覆盖/profile 均落在 `observability.logging`；旧两个 key、未知安全开关和既有非法 sink/file policy 均 fail closed；不得形成兼容 parser、废弃字段或第二套实现。
  验证：`packages/agent-app/tests/runtime-logging-config.test.ts`、`tests/agent-kernel/config-assembly.test.ts`、全仓旧键检索与文档 review。

- [x] 15.4 运行 OpenSpec、build、全部存量 test、contract、architecture 门禁；执行 push 前模型语义检视，修复阻断项，合并最新 main、确认无冲突后提交并推送。
  验证：`openspec validate --all --strict`；`npm run build`；`npm test`；`npm run test:contract`；`npm run lint:architecture`；`$nextagent-code-review`；main merge/push evidence。

## 16. Conventional logger local naming

- [x] 16.1 将 `agent-app` 中由 `getLogger(...)` 或 operational writer 获取的局部 logger 统一命名为 `logger`，不重复类型或运行时语义，不改变 component/source、字段或日志行为。
  验证：全仓产品源码检索无 `const runtimeLogger = ...getLogger(...)`；`npm run build`；相关 app composition tests。

## 17. Module-scoped logger reuse

- [x] 17.1 将静态 code-owned bindings 的 `getLogger(...)` 统一提升为 module-scoped `const logger`，同一文件只获取一次并由函数复用；保留 OTel bootstrap 在全局 provider 绑定前通过当前 operational writer 获取 logger 的实例相关例外，不增加 logger 注入或第二套实现。
  验证：全仓生产源码检索无 function-scoped facade `getLogger(...)`；`npm run build`；相关 app composition/observability tests；全部存量 test、contract、architecture 与 OpenSpec strict 门禁。

## 18. Non-duplicative failure reason semantics

- [x] 18.1 从 RuntimeLogger caller contract、生产调用和物理输出中删除 `fallbackReasonCode`，并删除通用 `UNEXPECTED_FAILURE`；writer 仅在 denylist 和 negative test 中识别旧字段以确保误传时丢弃。普通未知异常只依赖 event、failureStage、INTERNAL category与安全 exception evidence，只有独立于 event/failureStage 的稳定领域子原因或 writer-owned 窄错误码映射才输出 `safeReasonCode`。
  验证：logger 黑盒覆盖 ordinary Error/non-Error throw 无通用 reason、AgentError code与独立 safeReasonCode保留、legacy fallback字段不落盘；全仓生产源码与当前 change 文档无旧 vocabulary；全部 build/test/contract/architecture/OpenSpec strict 门禁。

## 19. Fastify-native controlled logging lifecycle

- [x] 19.1 用 app-owned Pino-compatible `loggerInstance` adapter 和 Fastify `LogController` 替换手写 `onResponse` access 输出：`requestCompleted` 唯一生成 `server.access.completed/failed` 和 HTTP metric，`onError` 只保留 request-local caught；Fastify stream/serializer/write-head/error-handler/service-unavailable failure 使用稳定 framework event并把 Error交给公共writer。adapter不得暴露 raw Pino或输出 raw req/res/header/URL/message/router dump/client request id；无event info/debug noise省略，无event warn/error/fatal仅形成有界 framework degraded/failed投影。
  验证：app black-box覆盖success、404、validation/error、response-hook failure、forged request-id、exact-one access/metric；Fastify adapter tests覆盖child serverRequestId、native warn/error安全投影和raw message/req/res排除；architecture negative确认`logger:false`与旧手写`onResponse` owner删除；运行OpenSpec、build、全部存量test、contract和architecture门禁并完成push前语义检视。

## 20. Unified surface-bound RuntimeLogger

- [x] 20.1 删除产品 `StructuredLogTransport`、`operationalStructuredLogTransport`、独立 silent transport和生产 composition transport injection；`agent-log` 用同一个 Pino-style RuntimeLogger factory/write path 创建可信 `runtime_diagnostic` 与 `observation_derived` logger，普通 facade不能选择 surface。StructuredLogProjector 直接按 StructuredLogEntry logical level调用 observation-bound RuntimeLogger；test-only capture logger只存在于 test composition。清理无用解构并增加双 surface同 writer/同净化/不可覆盖/无旁路的黑盒与架构验收。
  验证：agent-log、structured projector、app trajectory/logging composition专项测试；全仓无 `StructuredLogTransport|operationalStructuredLogTransport|structuredLogTransport` 产品 vocabulary；`openspec validate --all --strict`；`npm run build`；`npm test`；`npm run test:contract`；`npm run lint:architecture`；push前 `$nextagent-code-review`。

## 21. Fastify native final access log

- [x] 21.1 删除自定义 `server.access.completed/failed` 投影和已无产品用途的 `routeTemplate` writer allowlist；关闭 incoming request line，但让 `LogController.requestCompleted` 委托 Fastify 原生 final access 输出，保留 `serverRequestId`、`res.statusCode`、`responseTime`和固定 `request completed|request errored` message。Fastify adapter 仅投影 approved access fields 并通过同一 agent-log writer 脱敏/限额/异步输出；不暴露 raw req/reply/header/URL/free-form message/client request id，不生成 `http.request.*` / `server.access.*` event，HTTP metric 仍 exact-one。
  验证：app black-box 覆盖 success、404、validation、response-hook failure、forged request-id、exact-one access/metric 和 raw-field negative；agent-log 黑盒确认只有 trusted server-access logger 可输出 eventless native access，普通 RuntimeLogger 继续拒绝 missing event；`openspec validate --all --strict`、build、全部存量 test、contract、architecture 和 push 前语义检视。

## 22. Fastify access 可定位性与原生 Pino 复用修复

- [x] 22.1 删除 `agent-app` 手写 Fastify logger facade，直接把 `agent-log` 同一 Pino root 的受控 child 作为 `loggerInstance`；`LogController.requestCompleted` 继续委托 Fastify 基类，并让唯一 final access record 保留安全 `req.method/req.url`（validated route template，unmatched 固定值）、`serverRequestId`、`res.statusCode`、`responseTime`与固定 message。公共 Pino hook 必须拒绝 raw URL/query/header/free-form Fastify noise，普通 RuntimeLogger missing-event 规则不变。
  验证：先用 app/agent-log 黑盒复现现状缺少 method/route 且 facade 非同一 Pino 实例，再覆盖 success、参数路由、404、validation、response-hook failure、query/credential/client-id negative、exact-one access/metric；architecture assertion确认 app 不再实现 logger methods；运行定向测试、OpenSpec strict、build、test、contract和architecture门禁。push 前模型语义检视仍按仓库强制门禁单独执行。

## 23. Fastify 原生 access logging 收敛

- [x] 23.1 删除 custom `LogController` 和 app-owned final access 拼装，直接使用 Fastify 默认 `incoming request` + `request completed|request errored` access pair；`agent-log` 只通过同一 Pino child 的安全 serializers/hook 保留原生 `reqId`、method、validated route template、statusCode与responseTime并拒绝 raw URL/query/header/client request id。HTTP metric迁移为独立 `onResponse` observer且exact-one。
  验证：app黑盒断言每请求原生pair、共享原生`reqId`、success/参数路由/404/validation/response-hook failure和metric exact-one；agent-log黑盒断言真实Pino child、安全serializer及普通missing-event不变；architecture assertion禁止app custom LogController/access字段拼装；运行定向测试、OpenSpec strict、build和常规测试。

## 24. OpenTelemetry 标准 HTTP server metrics

- [x] 24.1 删除 Fastify 手工 `onResponse` HTTP metric observer、`web_request_total`、`web_request_duration_seconds`及 observation fallback；在已有同一个 MeterProvider 上注册官方 `@opentelemetry/instrumentation-http`，启用 stable HTTP semantic conventions且只测 incoming/server，使用 `http.server.request.duration` histogram 的 count 表达请求量。补齐 exact-one、legacy-absence、同 provider/exporter、unmatched/raw URL/query/header/client-id negative 和 server-before-provider bounded shutdown 验证。
  验证：OpenSpec strict；agent-observability SDK/exporter tests；agent-app HTTP black-box；全仓 legacy metric/source negative；`npm run build`、相关 tests、contract与architecture门禁。

## 25. Exception termination ownership and bounded cause chain

- [x] 25.1 刷新 proposal/design/runtime-logging/structured-logging/ts-minimal-agent-kernel/event catalog，冻结“传播不打印、消费或终止才打印”、owner-scoped execution roots、expected-vs-unexpected、独立 cleanup/terminal failure、cause 保留和禁止 logged-marker/fingerprint/ALS 去重。
  验证：`$nextagent-skill-review` 语义检视；`openspec validate add-ts-runtime-operational-log-hardening --strict`；`openspec validate --all --strict`。

- [x] 25.2 在 `agent-common` 统一 `AgentError` 的标准 `cause` 语义，在 `agent-log` 实现最多 4 个 Error 节点、整链最多 5 个 NextAgent-owned frames、64 KiB 总检查预算、cycle/depth/budget truncation与 non-Error cause 安全终止；SafeError/public DTO不得携带原始链。
  验证：AgentError constructor/wrapping tests；agent-log physical JSON matrix覆盖 nested cause、message 2 KiB bounding、4/5 边界、cycle、throwing getter、non-Error cause、稳定 fingerprint、`exceptionChainTruncated`和 raw stack/path/provider/secret negative。

- [x] 25.3 建立 `agent-runtime` accepted-request execution termination boundary，以 `request.execution.exception_captured` / `REQUEST_EXECUTION` exact-one记录未知执行异常；删除 model/tool/context adapter 的中间层 `*.exception_captured` log-and-rethrow，保留 canonical safe failure fact和原异常/cause传播。把 pre-dispatch、execution、terminal commit failure scopes拆开，terminal commit failure不得误记为 scheduler dispatch failure。`packages/agent-runtime/src/lifecycle/submit.ts` 的 `runtime.submit.orphan_session` 明确保留为独立 pre-acceptance degradation：只在内部session已创建但RequestRun尚未durable accept时输出，不传`err`；accept成功后清除orphan candidate，后续失败不再误报。
  验证：runtime/core/model/observability characterization + black-box；同一 nested exception只出现一条 `request.execution.exception_captured`，canonical request/model/capability failure各自exact-one，三个 failureStage 注入互不串类；orphan测试分别覆盖accept前失败保留warn、accept后checkpoint/event/enqueue失败无orphan、warn无exception fields且原异常继续传播。

- [x] 25.4 建立 Web/Task/WS/SSE transport-root、deployment app lifecycle、background callback 和 process fatal 顶层处理：non-INTERNAL AgentError与Fastify/TypeBox schema validation保留既有safe mapping且无专用异常行，INTERNAL/unknown 使用 catalog 冻结的 event/failureStage safe 500或关闭该 transport attempt且exact-one；composition/gateway/workflow/capability/listen helper与 remote gateway call adapter只 cleanup/safe-normalize/传播。`agent-app` composition/startup wrapper必须用 `APP_START_FAILED` + original cause + validated `safeDetails.failureStage`传递阶段，并从package root提供唯一`classifyAppStartupFailure`及AppStartupFailureStage technical API；deployment必须复用该classifier、不得复制allowlist/private import，并以`APP_STARTUP`兜底。app已创建时deployment使用当前operational logger，composition未返回app时只用bounded emergency reporter；shutdown finalizer记录后继续即消费该异常，`close()`不得重抛同一对象；fatal handler使用冻结 fatal event/stage bounded report/flush/non-zero exit且不恢复。
  验证：channel/app/deployment/background tests覆盖 domain 4xx、schema validation 4xx、INTERNAL/unknown 500、全部AppStartupFailureStage、code/category/stage非法或缺失metadata fallback、LOCAL/REMOTE classifier复用且无duplicate allowlist/private import、nested listen exact-one、pre-app emergency与post-app operational startup reporting、多个finalizer failure均继续且close不重抛已记录异常、callback continue、uncaught exception、unhandled rejection、fatal re-entry/writer unavailable；Fastify access outcome不重复同一 exception chain。

- [x] 25.5 增加 representative architecture negative fixture 与本 change 触达路径的 targeted source assertion，禁止 catch 同时 `logger.error|warn({err...})` 后传播、无 cause 的异常替换、`alreadyLogged|handled` 异常标记/全局 Error set/fingerprint或 ALS 日志去重、reusable `agent-app` process handler；仅允许明确 consume/degrade/terminal/fatal、独立 cleanup operation和不含caught的独立derived fact，不建设全仓 catch 正则扫描器。targeted assertion必须明确覆盖 `packages/agent-runtime/src/todos/gateway-todo-state.ts` 的 `todo.runtime.replace.failed` 与 `packages/agent-platform-gateway-local/src/db/sqlite-gateway-core.ts` 的 `todo.gateway.replace.failed` 均不存在。
  验证：negative fixtures 必须实际触发失败；本 change 触达路径逐项检索并断言两个Todo failure event/source call删除；人工语义 review确认规则不误伤业务 type narrowing、canonical fact emission、orphan derived degradation、cleanup或 SafeError mapping，也不把固定代码规则扫描当作语义检视。

- [x] 25.6 完成定向与全量验证，使用 `$nextagent-code-review` 覆盖 Frozen core contract、Architecture boundary、Minimal kernel non-regression、Security、OpenSpec consistency 和 Clean Code；P0/P1 清零后方可 push。
  验证：`openspec validate --all --strict`；`npm run build`；`npm test`；`npm run test:contract`；`npm run lint:architecture`；`$nextagent-code-review`。
  实际结果：OpenSpec 279/279 valid；build/typecheck/runtime/workbench build passed；`npm test` 131 files、1238/1238 tests passed；contract 40 files、339/339 tests passed；architecture 42 files、254/254 tests passed；`$nextagent-code-review` PASS，P0/P1/P2 均为 0。

## 26. Tool raw input/output operational policy

- [x] 26.1 修订 proposal、design、runtime-logging 与 ts-minimal-agent-kernel delta、`AGENTS.md` 与 coding standards，冻结 normal/debug 本地 runtime direct diagnostic 均提供 canonical `toolInput` / `toolOutput`：两字段保留 prompt/path/command/content，仅对 credential 与认证类 token 做窄匹配脱敏并保护正常 credential/token 诊断字段；集中 writer 继续 owning 容量/可靠性边界，且两字段不得扩散到 observation、audit、metric、trace、stream、timeline、SafeError 或 public DTO。
  验证：`$nextagent-skill-review` 语义检视；`openspec validate add-ts-runtime-operational-log-hardening --strict`。
  实际结果：`$nextagent-skill-review` PASS；`openspec validate add-ts-runtime-operational-log-hardening --strict` valid。

- [x] 26.2 在 `agent-log` 集中实现 Tool payload 有界保真与窄 credential/auth-token 脱敏，在 `agent-core` 的 normal/debug Tool direct diagnostic 接入实际输入和有效输出；删除 raw-payload logging flag 和 caller 侧 Tool payload sanitizer，不改变 canonical capability outcome。
  验证：agent-log physical JSON 黑盒覆盖 credential/auth-token 脱敏、prompt/path/content 保真、正常 token/credential 诊断字段不误伤以及容量截断；agent-core Tool loop 黑盒覆盖成功、失败和结果校验路径的 `toolInput` / `toolOutput`，app composition 断言 normal detail 的 info physical log 可见完整 payload，并断言 canonical timeline 行为不变。
  实际结果：agent-log 33/33 passed；capability-governance 相关输入、输出和失败结果 3/3 passed；app composition 7/7 passed，并以 `diagnosticDetail=normal`、writer `level=info` 的物理 JSON 断言 `tool.payload.captured` 同时包含 `toolInput` / `toolOutput`。输入与输出中的 `sk-` credential 被脱敏，普通内容保真；rebase 最新 `origin/main` 后完整 `npm test` 132 files、1249/1249 tests passed。

- [x] 26.3 完成定向 build/test、contract、architecture 与全量 OpenSpec strict 验证；使用 `$nextagent-code-review` 复核 normal 日志中的安全例外只存在于本地 runtime direct diagnostic、credential/auth-token 脱敏不会误伤正常诊断字段，P0/P1 清零。
  验证：`npm run build`；定向 Vitest；`npm run test:contract`；`npm run lint:architecture`；`openspec validate --all --strict`；`$nextagent-code-review`。
  实际结果：rebase 最新 `origin/main` 后 build/typecheck/runtime/workbench build passed；`npm test` 132 files、1249/1249 tests passed；contract 41 files、342/342 tests passed；architecture 42 files、254/254 tests passed；OpenSpec 279/279 valid；`git diff --check` passed；`$nextagent-skill-review` 与 `$nextagent-code-review` 均 PASS，P0/P1/P2 为 0。

## 27. Bounded operational archive count

- [x] 27.1 修订 proposal、design、app-config-schema、local-file-roll、runtime-logging 和 local-runtime-package delta，冻结 `observability.logging.file.maxArchiveFiles`：`1..10`、默认 10、只配置 operational committed gzip archive；metrics、audit、plugin diagnostic 由各自 owner 固定为 10。四个文件族都与 elapsed retention 独立生效，超限时按 `mtime`/文件名最旧优先。
  验证：`openspec validate add-ts-runtime-operational-log-hardening --strict`。

- [x] 27.2 先增加配置与 foundation 黑盒测试：默认/覆盖/非法 `maxArchiveFiles`，policy 传递，11 个未过期 owned archive 只删除最旧一个，时间相同按文件名确定性淘汰，source/temp 不计数且仍只服从既有 reconciliation，active/symlink/unknown/cross-family 不计数且不删除，删除失败保留并可重试。
  验证：`npx vitest run --config vitest.config.release.ts packages/agent-app/tests/runtime-logging-config.test.ts packages/agent-local-file-roll/tests/local-file-roll.test.ts packages/agent-log/tests/runtime-logger.test.ts`。
  实际结果：连同 composition、kernel 与 local-runtime-package 相关测试共 6 files、130/130 tests passed。

- [x] 27.3 在 frozen config、四个 owner policy、`LocalFileRollPolicy` 和 maintenance lane 中实现单一路径传递与 oldest-first archive count cleanup；不启用 pino-roll `limit`，不新增第二个 scanner，各 owner 使用独立 handle/state。
  验证：root `npm run build`；定向测试证明 count cleanup 在 startup/每分钟 archive maintenance 生效且时间 retention 不回归。
  实际结果：root `npm run build` passed；foundation 黑盒测试覆盖 startup/manual maintenance 共用路径、时间与数量策略独立生效及失败重试。

- [x] 27.4 完成 OpenSpec、build、相关测试、contract 与 architecture 验证，复核 diff 只包含本 change 定义的 managed log size/count policy 及其证据；如需 push，另行执行强制 `$nextagent-code-review`。
  验证：`openspec validate --all --strict`；`npm run build`；相关 Vitest；`npm run test:contract`；`npm run lint:architecture`；`git diff --check`。
  实际结果：rebase 最新 `origin/main` 后，本 change strict validation passed；全量 OpenSpec 282/282 passed；build passed；完整 `npm test` 146 files、1703/1703 tests passed（其中定向四 owner/foundation 测试 5 files、77/77 passed）；contract 44 files、357/357 passed；architecture 46 files、290/290 passed；`git diff --check` passed；`$nextagent-skill-review` 与 `$nextagent-code-review` 语义检视均 PASS，P0/P1/P2 为 0。

## 28. Unified managed log size-or-midnight rotation

- [x] 28.1 修订 proposal、design、相关 file-family specs 与 local-runtime-package delta，冻结 operational、plugin diagnostic、metrics、audit 的 size threshold 均为 30 MiB，并明确大小阈值与进程本地每日零点是独立 OR 触发条件；四个文件族均最多保留 10 个 committed gzip archive。
  验证：`openspec validate add-ts-runtime-operational-log-hardening --strict`。

- [x] 28.2 增加四个 owner policy 黑盒测试，证明 operational 配置只能取 `maxFileSizeMiB=1..30`、`maxArchiveFiles=1..10` 且默认 30/10；plugin diagnostic、metrics、audit 固定传入 30/10；既有 daily frequency 仍由 foundation 固定为 process-local midnight。
  验证：`npx vitest run --config vitest.config.release.ts packages/agent-app/tests/runtime-logging-config.test.ts packages/agent-log/tests/developer-diagnostic-artifact-writer.test.ts packages/agent-observability/tests/local-metric-history-exporter.test.ts packages/agent-platform-gateway-local/tests/file-audit-event-store.test.ts packages/agent-local-file-roll/tests/local-file-roll.test.ts`。
  实际结果：测试先以 5 个 policy mismatch 证明旧值不满足目标态；实现后 5 files、77/77 tests passed，覆盖 operational 默认/上限与三个固定 owner policy，并复用 foundation 的 daily rotation 测试。

- [x] 28.3 将四个 owner 的 policy 收敛到 30 MiB/最多10个压缩归档，完成 change strict、build、相关测试与 diff 检查；全量门禁继续归 27.4 统一记录。
  验证：`openspec validate add-ts-runtime-operational-log-hardening --strict`；`npm run build`；相关 Vitest；`git diff --check`。
  实际结果：四个文件族均已传入 30 MiB/10；root build passed；定向 5 files、77/77 tests passed；change strict validation 与 `git diff --check` passed。

## 归档前更新基线检查（非实施任务）

- 同步 runtime-logging、local-file-roll、ts-minimal-agent-kernel、app-config-schema、structured-logging、local-runtime-package、agent-runtime-metrics、otel-observability-adapter、audit-sink、plugin-developer-diagnostic-artifacts、gateway-store-provider-ownership、dev-agent-workbench；dev-agent-workbench baseline 必须在 `add-ts-dev-agent-workbench` 先归档后合并本 delta。
- 同步 `openspec/designs/modules/agent-app.md`，删除 `observability.logging.redaction`、`rawToolInputLogging` 和 debug-only Tool payload 装配旧说明。
- 更新 `openspec/designs/architecture/ts-backend-architecture.md`，明确 Node-only technical foundation 分类、依赖方向、三个 production consumer allowlist和其余 implementation dependency firewall不变。
- 更新 `openspec/designs/architecture/local-runtime-packaging.md`、`observability-boundaries.md`、`configuration-boundary.md`，明确共享机制代码、四个独立 handle和输出语义分离。
- 新增 `openspec/designs/modules/agent-local-file-roll.md` 与 `openspec/designs/adr/local-file-roll-foundation-boundary.md`；新增/更新 agent-log、agent-common、agent-app、agent-runtime、agent-core、agent-channel-web、agent-channel-task、agent-observability、agent-contracts、agent-platform-gateway-local、agent-platform-gateway-remote module designs，并把异常终止 owner/cause 传播规则同步到长期架构。
- 更新 spec-to-design-map、architecture package inventory、dependency-cruiser/manifest-policy说明、change consistency evidence 和 `docs/NextAgent 开源组件清单.md`。
- 确认没有把 PaaS audit client、Prometheus endpoint、外部 OTLP Collector deployment/operations、developer trace、storage watermark 或 audit 长期合规归档误并入本 change；LOCAL audit fixed 7-day aging和 REMOTE OTLP exporter composition属于本 change。
