## 设计范围

| Function | 本次目标变化 | 涉及 delta specs | 设计章节 |
|---|---|---|---|
| `FN-10.5 管理插件开发诊断产物` | 新增统一、独立、有界且不进入主日志的插件开发诊断产物能力 | `plugin-developer-diagnostic-artifacts`、`developer-hook-trace-logging`、`context-monitor-logging` | `FN-10.5 管理插件开发诊断产物` |

## 存量 Requirement 迁移方案

| 来源 spec / Requirement | 目标 Function / canonical spec | 原子 delta | 其他行为与未触及 Requirements 处理 | 白盒落点 | stable spec 与导航影响 |
|---|---|---|---|---|---|
| `developer-hook-trace-logging` / `SDK developer hook trace logging is caller-owned` | `FN-10.5` / `plugin-developer-diagnostic-artifacts` | 来源 `REMOVED` + 目标 `ADDED` | trace 内容、stage 和 observe-only Requirements 原位保留 | SDK 只提交 artifact input；物理写入转交统一 writer | 来源 spec 保留；导航增加 FN-10.5 canonical spec |
| `developer-hook-trace-logging` / `SDK can write a formal developer hook trace plugin artifact` | `FN-10.5` / `plugin-developer-diagnostic-artifacts` | 来源 `REMOVED` + 目标 `ADDED` | artifact 生成与 loader-compatible 行为保留，移除 path config 和 direct fs | 生成的 bundle 改为 v1.1 factory 并消费 host sink | 来源 spec 保留，不退役 |
| `context-monitor-logging` / `Context monitor records per-session context evolution` | `FN-10.5` / `plugin-developer-diagnostic-artifacts` | 来源 `REMOVED` + 目标 `ADDED` | context capture 时机与内容无损保留，移除物理文件布局和文件数量 | context state 仍在插件内，compaction/terminal 输出统一 records | 来源 spec 保留；不再导航到文件布局 |
| `context-monitor-logging` / `Context monitor logging is caller-owned` | `FN-10.5` / `plugin-developer-diagnostic-artifacts` | 来源 `REMOVED` + 目标 `ADDED` | observe-only 与 failureMode Requirements 原位保留 | SDK 只提交 artifact input | 来源 spec 保留，不退役 |
| `context-monitor-logging` / `SDK can write a formal context-monitor plugin artifact` | `FN-10.5` / `plugin-developer-diagnostic-artifacts` | 来源 `REMOVED` + 目标 `ADDED` | artifact 生成与 loader-compatible 行为保留，移除 path config 和 direct fs | 生成的 bundle 改为 v1.1 factory并消费 host sink | 来源 spec 保留，不退役 |

`developer-hook-trace-logging`、`context-monitor-logging` 和目标 spec 当前没有未协调 active change 同时修改上述 Requirements；归档前再次检查并行引用。

## `FN-10.5 管理插件开发诊断产物`

### 目标与规范依据

本设计实现 proposal 中的独立 developer diagnostic artifact 黑盒边界：插件只能提交记录，系统绑定身份并统一管理物理生命周期；任何 payload 或写入失败都不进入主输出面。

#### 本 Function 的目标 Requirements

canonical spec：`plugin-developer-diagnostic-artifacts`

- `ADDED`：`系统统一接收插件开发诊断记录`
- `ADDED`：`开发诊断记录使用独立的短期产物文件族`
- `ADDED`：`产物写入具有有界容量和生命周期`
- `ADDED`：`产物失败不改变受保护操作`
- `ADDED`：`本地状态只暴露有界安全证据`
- `ADDED`：`原始调测内容与主输出面隔离`
- `ADDED`：`内置调测插件提交统一记录`

设计约束是首个版本只提供 LOCAL file output；REMOTE/PaaS 不创建本地 fallback，也不在本 change 增加远端 artifact service。

### 当前实现

- `agent-plugin-sdk` 的 plugin API 最新版本为 `1.0`，factory host 只有 `{ externals }`；正式调测插件 bundle 导出 materialized plugin object。
- `developer-hook-trace` 在 hook 内通过 `appendFileSync` 追加 caller-selected NDJSON；`context-monitor` 通过 `writeFileSync` 创建 session-specific JSON。
- 两个插件捕获 sink failure 后返回 `PASS`，但没有统一容量、轮转、压缩、保留、close 或安全状态。
- `agent-local-file-roll` 已实现异步 line enqueue、size/daily rotation、gzip、reconciliation、retention 和 bounded close；当前 production consumer allowlist 包含 `agent-platform-gateway-local`。
- `agent-platform-gateway-local` 已为 audit 文件族持有独立 handle；`agent-app` 是唯一 composition root，并在启动期加载和冻结 plugin snapshot。
- operational hardening 明确 developer trace files 不属于 operational writer，且 operational maintenance 必须忽略它们。

### GAP 分析

| 规范目标 | 当前事实 | GAP |
|---|---|---|
| 插件只提交结构化记录且宿主绑定 pluginId | 插件直接持有文件路径与 fs 写权限 | 缺少版本化 host sink 和输入校验 |
| 单一独立文件族与统一生命周期 | 两个插件维护不同文件布局且无 rotation/retention | 缺少专用文件输出 owner 和第四个独立 handle |
| 有界异步、失败非干扰 | request hook 内同步写盘且只静默 catch | 缺少 line budget、buffer overload 结果和状态 |
| 与主输出面完全隔离 | 现有文件已物理独立，但失败状态未定义 | 缺少明确 negative boundary 与安全状态投影 |
| 内置插件保留内容语义 | 输出格式绑定物理文件 | 需要把语义记录与文件布局解耦 |

### 修改方案

唯一实施路径如下：

1. `agent-plugin-sdk` 新增 plugin API `1.1`，在 factory host 增加必需 `developerDiagnostics: DeveloperDiagnosticArtifactSink`。`1.0` host 仍只含 `externals`；loader 根据 manifest/export 的 effective API version 构造精确 host shape。新增能力不放入 `agent-contracts`，因为该 shape 只在 plugin authoring 与 host loader 边界使用。
2. `DeveloperDiagnosticArtifactSink` 是结构化、non-throwing async contract。SDK 仅在没有本地 writer 的 generic/REMOTE composition 提供 noop sink；LOCAL product composition 为每个 manifest plugin id 创建 wrapper，wrapper 删除或拒绝调用方 `pluginId` 并把可信 identity 交给 writer。插件不能获得 gateway、目录或 concrete handle。
3. `agent-platform-gateway-local` 新增 `createLocalDeveloperDiagnosticArtifactWriter(...)` public factory。该 writer 完整 owning private envelope serialization、JSON-safe validation、4 MiB budget、8 MiB async buffer、100 MiB/daily rotation、3 elapsed-day retention、status 与一个独立 `agent-local-file-roll` handle。文件族直接位于 `<paths.logDirectory>/nextagent-plugin-diagnostic.<date>.<sequence>.ndjson[.gz][.tmp]`，不创建额外子目录；独立性由专属文件名前缀、selector、handle、maintenance state 和 retention lifecycle 保证。
4. writer factory 同步返回 lazy facade；首次 `emit` 或 app start 异步初始化唯一 handle，因此 sync composition 不执行同步文件 I/O。LOCAL async product start 预热 handle；sync composition 只有在随后调用 async `start` 时预热。初始化失败更新 status，`emit` 返回 `OUTPUT_UNAVAILABLE`。
5. `agent-app` 在 LOCAL product composition 的 frozen config 后创建一个 process-scoped writer，把 per-plugin bound sink 传给 sync/async plugin loader，并把 writer 的 `start/close/status` 加入 composition scope。close 逆序、幂等、有界；失败不调用 RuntimeLogger。
6. system config 不提供 `developerDiagnostics` 或 artifact 输出开关。LOCAL product composition 固定输出；REMOTE 不创建本地 writer。目录、文件名、line budget、buffer、rotation、compression、retention 和 failure policy均 implementation-owned；runtime input 和 Agent activation 不得覆盖。
7. `developer-hook-trace` 与 `context-monitor` 正式 artifact 升级为 API `1.1` factory。移除 bundle 内 `process.getBuiltinModule("node:fs")`、path validation、`logDirectory` 和 `logFile` config。SDK direct construction helper接收 `DeveloperDiagnosticArtifactSink`，不再提供 file sink helper。
8. `developer-hook-trace` 将现有 entry 作为 `payload` 提交，artifact type 固定为 `developer-hook-trace`。`context-monitor` 继续维持 per-session latest/pending state，但把 compact/terminal snapshot 提交为两种固定 artifact type，不再写 session file。
9. 受信 local developer workbench 只消费 writer status provider；本 change 不提供 artifact content reader。产品 Web/channel/public app projection 不增加 payload 或文件路径。

private writer record 在 `agent-platform-gateway-local` 内定义：

| 字段 | 类型与约束 | trusted source | 私有映射 |
|---|---|---|---|
| `schemaVersion` | literal `1`，required | writer | physical line |
| `recordedAt` | ISO-8601 string，required | writer clock | physical line |
| `pluginId` | safe id，required | validated manifest binding | physical line |
| `artifactType` | safe id，required，1..128 chars | validated plugin input | physical line |
| runtime coordinates | bounded optional strings | validated hook/capability context | physical line；缺失省略 |
| `payload` | finite JSON-compatible value，required | plugin input | physical line；整体预算校验 |

writer 私有 lifecycle：

| 当前状态 | 触发 | 下一状态 | emit 结果 |
|---|---|---|---|
| `UNINITIALIZED` | 首次合法 emit | `AVAILABLE` 或 `DEGRADED` | 初始化与 enqueue 成功为 `ACCEPTED`，否则 `DROPPED/OUTPUT_UNAVAILABLE` |
| `AVAILABLE` | invalid/oversize/overflow | `DEGRADED` | 对应 stable drop reason |
| `AVAILABLE` | destination failure | `DEGRADED` | `DROPPED/OUTPUT_UNAVAILABLE` |
| `DEGRADED` | 后续 enqueue 成功 | `AVAILABLE` | `ACCEPTED`，累计 droppedCount 不清零 |
| 任意非 closed | close | `CLOSED` | 后续 emit 为 `DROPPED/OUTPUT_UNAVAILABLE` |

`CLOSED` 是私有状态，不进入公共 status vocabulary；公共查询投影为 `DEGRADED`。

不选择截获 `console`/stdout：插件与宿主同进程，global monkey patch 会在并发请求间错误归因，也无法提供安全隔离。受支持 plugin API、内置 artifact 和 architecture tests 禁止 direct console/file output；对恶意受信插件的强制隔离属于后续进程 sandbox change。

#### 质量属性影响

| 质量属性 | 规范依据 | 本 Function 内实现机制 | 验证关注点 |
|---|---|---|---|
| 安全 | `本地状态只暴露有界安全证据`、`原始调测内容与主输出面隔离` | manifest-bound identity、专属文件 selector、无主日志镜像、无 content reader | 路径/identity override、payload/public projection negative tests |
| 性能/容量 | `产物写入具有有界容量和生命周期` | 4 MiB line、8 MiB buffer、100 MiB/daily rotation、3-day retention | exact boundary、overflow、gzip/reconciliation/retention |
| 可靠性/恢复 | `产物失败不改变受保护操作` | non-throwing async enqueue、stable drop result、lazy recovery、bounded close | destination failure、maintenance failure、close timeout |
| 可维护性 | `开发诊断记录使用独立的短期产物文件族` | 一个 writer、一个 schema owner、一个 file family、两个插件共享 sink | 无平行 writer/helper/direct fs |
| 可测试性 | `系统统一接收插件开发诊断记录` | public sink result、status provider、test-only writer dependencies | unit/contract/e2e 可重复故障注入 |

## 验证策略（Verification Strategy）

- unit tests 验证 SDK record mapping、manifest-bound identity、JSON validation、budget、drop reason、status saturation和插件 observe-only 结果。
- gateway-local integration tests 验证独立文件族、完整 NDJSON、轮转、gzip、startup reconciliation、retention、overflow与 bounded close。
- app/plugin integration tests 验证 API 1.1 host injection、1.0 host shape 不漂移、LOCAL writer 固定装配、REMOTE 无本地 fallback 和 lifecycle ownership。
- product-path e2e 验证两个内置插件通过正式 artifact 产生统一 records且请求继续完成。
- architecture negative tests 禁止内置插件 direct fs/console、禁止 operational/audit/metrics/workbench content reader 触达 developer artifact family、禁止新增 local-file-roll consumer。
- 人工语义检视确认 raw payload 只存在 developer artifact、没有 agent-contracts 扩张、没有第二套 logger 或 gateway generic records。

## 长期基线刷新计划（Baseline Promotion Plan）

- `openspec/specs/plugin-developer-diagnostic-artifacts/spec.md`：新增并保留 FN-10.5 元数据。
- `openspec/specs/developer-hook-trace-logging/spec.md`：移除已迁出的 caller-owned/file artifact Requirements，保留插件定义、observe-only 和 packaging activation。
- `openspec/specs/context-monitor-logging/spec.md`：移除已迁出的 file layout/caller-owned/file artifact Requirements，保留插件定义、observe-only 和 packaging activation。
- `openspec/designs/functions/D10-二次开发与平台集成/D10.1-扩展与插件/FN-10.5-管理插件开发诊断产物.md`：新增。
- `openspec/designs/features/D10-二次开发与平台集成/D10.1-扩展与插件/F-10.5-管理插件开发诊断产物.md`：新增。
- `openspec/overview.md`：补充 developer diagnostic artifact 与主输出面隔离的系统背景。
- `openspec/designs/architecture/agent-plugin-composition.md`、`observability-boundaries.md`、`local-runtime-packaging.md`、`ts-backend-architecture.md`：更新 API 1.1 host service、独立输出面、第四 handle 与 dependency allowlist事实。
- `openspec/designs/modules/agent-plugin-sdk.md`、`agent-app.md`、`agent-platform-gateway-local.md`、`agent-local-file-roll.md`：更新各模块职责和验证入口。
- `openspec/designs/adr/local-file-roll-foundation-boundary.md`：把第四个独立 family/handle 纳入既有机制复用决策；不新增平行 ADR。
- `openspec/designs/spec-to-design-map.md`：新增 canonical spec、Function、Feature、architecture/modules/ADR 和测试导航。

## 风险与取舍（Risks / Trade-offs）

- raw payload 可能包含自然语言中的未知秘密，通用结构化 redaction 无法保证识别；通过受信本地部署、`paths.logDirectory` 权限、专属文件 selector、无读取 API 和 3-day retention 降低暴露窗口。
- 单一文件族使插件间共享同一物理访问级别；当前所有调测插件均属于同一受信本地诊断域。按插件拆分目录会复制 handle、maintenance 和配额，不在首版引入。
- API 1.1 使正式调测插件 artifact 必须重新生成；保留 API 1.0 加载只服务未使用新 sink 的普通插件，不保留旧调测插件 direct-file fallback。
- writer failure 不进入主日志会降低常规运维可见性；由 local workbench status 提供唯一安全可见面，避免自递归和 payload 泄漏。

## 迁移与回滚（Migration / Rollback）

发布前必须先完成 operational hardening 的 writer/file-roll基线验证，再发布 API 1.1 host、gateway-local writer 和重新生成的两个内置 artifact。新 runtime 不接受旧调测 artifact 的 path config；运维需替换 artifact 后再启用。旧文件不由新 writer接管、压缩或删除，避免 ownership selector 越界；运维按原有权限自行处理。

若出现数据完整性、路径 ownership 或请求非干扰回归，回滚整个 change 并禁用 developer diagnostic artifacts；不得回退为把 payload 写入主日志。回滚验证必须确认主输出面无 payload、请求主路径正常、旧文件未被新 maintenance 修改。

## 待确认问题（Open Questions）

无。
