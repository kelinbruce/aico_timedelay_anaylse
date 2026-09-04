## MODIFIED Requirements

### Requirement: App composition schema 暴露稳定的首发分组基线

app composition 配置 schema SHALL 为首个版本暴露以下稳定分组：

- `deployment`
- `paths`
- `identity`
- `channel`
- `hostedAgent`
- `modelProfiles`
- `nextAgent.system.capability-providers`
- `gateway`
- `observability`
- `rag`

每个分组 MUST 在配置边界下拥有一个稳定的 owning contract。后续变更 MAY 扩展某个分组或其窄化的 owning-boundary 投影，但 MUST NOT 通过引入与之竞争的 app 级配置事实来源绕过该基线。

`observability` 分组 SHALL 在 `observability.logging` 暴露唯一的 operational logging 对象。它 MUST NOT 暴露平行的 `observability.runtimeLogging` 对象。

Metrics exporter 选择 SHALL NOT 在本 change 中引入第二个用户可控的 app 级 mode 字段。受信 composition SHALL 从 `deployment.mode` 推导所需 profile：LOCAL 使用固定的滚动历史文件族 `<paths.logDirectory>/nextagent-metrics.<YYYY-MM-DD>.<sequence>.ndjson[.gz]`；REMOTE 需要由远程部署入口注入的 OTLP metric exporter；测试可以注入内存 exporter。LOCAL metrics 的基础名、扩展名、60 秒间隔、4 MiB 行预算、8 MiB 缓冲、30 MiB/进程本地日界轮转、gzip、至多 10 个已提交 gzip archives 和 7 个自然天 retention 均为实现自有。核心 app config MUST 拒绝未知的用户提供的 metrics 文件、exporter、endpoint、credential、间隔、轮转、时区、压缩、retention 或回退字段。标准 OTel endpoint/header/compression 环境变量仍由远程部署包拥有并在注入前安全校验。

`observability.logging` 在内置配置与用户应用配置合并后 SHALL 具备以下形状：

- `diagnosticDetail`：可选 `normal | debug`；缺省即 `normal`。该字段只控制哪些已经安全且经策略批准的诊断字段保持可见。它 MUST NOT 禁用或放松 redaction、safe error 映射、字段过滤或输出预算。
- `level`：可选 `error | warn | info | debug`；缺省即 `info`。
- `console.enabled`：合并后活跃配置中的必填 boolean。
- `file.enabled`：合并后活跃配置中的必填 boolean。
- `file.directory`：可选的安全 path 投影；缺省即冻结的 `paths.logDirectory`；解析后的目录 MUST 保持在受信 runtime path 边界之内。
- `file.name`：可选的安全逻辑基础名，以 `.jsonl` 结尾；缺省即 `nextagent-operational.log.jsonl`；pino-roll 由它派生带编号的物理 segments，且它 MUST NOT 命名或冲突于 audit 文件。
- `file.rotation.maxFileSizeMiB`：可选整数，取值范围 `1` 到 `30`；缺省即 `30`；实现额外在进程本地午夜应用一个不可配置的固定每日安全轮转。尺寸与午夜是相互独立的轮转触发条件。
- `file.retentionDays`：可选整数，大于等于 7；缺省即 `7`。
- `file.maxArchiveFiles`：可选整数，取值范围 `1` 到 `10`；缺省即 `10`。它只限制 operational 文件族中已提交的 gzip archives；metrics、audit 和开发者诊断 owner 各自独立使用固定值 `10`。

Gzip 归档、固定的 Node.js 进程本地每日安全轮转、时区选择、16 KiB 条目预算和每个目的地的 4 MiB 异步缓冲均为实现自有，在本版本中不可配置。用户提供的压缩、频率/时间轮转、时区、除 `maxArchiveFiles` 之外的按数量删除、存储水位、条目大小、队列大小或 backpressure 策略字段 MUST 被拒绝而不是被静默忽略。

受信入口配置来源 SHALL 提供以下默认值：

- development（`dev:watch` / `dev:fullstack`）：`console.enabled=true`、`file.enabled=false`；
- local runtime package（`backend-only` / `with-frontend`）：`console.enabled=false`、`file.enabled=true`；
- test composition：静默，除非测试显式请求或注入 sink。

下游包 MUST 只消费冻结的 `observability.logging` 投影。废弃的 `observability.runtimeLogging` 对象和 `observability.logging.redaction` 字段 MUST 作为未知配置被拒绝，而不是被当作别名接受。请求体、client metadata、模型输出、capability 输入和其他 runtime 用户输入 MUST NOT 覆盖诊断细节、sink 选择、阈值、path 或 retention。

Audit 文件/服务选择 SHALL 保持为 deployment 拥有并位于 `observability.logging` 之外。LOCAL SHALL 使用 `paths.logDirectory` 下 gateway 自有的固定 audit 文件族，带 30 MiB/进程本地日界轮转、gzip、至多 10 个已提交 gzip archives 和 7 个自然天 retention；核心应用配置和 runtime 输入 MUST NOT 暴露或接受 audit 文件名、path、尺寸/每日轮转、压缩、retention、查询、去重或回退控制。REMOTE audit 服务配置属于远程 gateway 边界，MUST NOT 导致核心 app 回退到本地文件或 SQLite。

本 change 中 `rag` 分组 SHALL 只暴露 `rag.indexes`。该字段是冻结的 app-composition 默认逻辑索引列表，仅在 Tool 输入省略 `indexes` 时被内置 `rag` Tool 使用。它 MUST 包含 1-5 个唯一的 provider 中立逻辑索引名。每个名字 MUST 非空、不超过 128 个字符，并只使用 startup 校验接受的安全逻辑索引字符集。若省略，startup 校验 SHALL 推导 `rag.indexes=["local"]`。该配置 MUST NOT 包含 provider 私有索引绑定、endpoint、credential、workspace 路径、SQLite 路径、原始 FTS 表达式或检索参数。

#### Scenario: 禁用或非活跃的配置分支保持非权威

- **WHEN** 某个配置条目被禁用或属于非活跃的部署分支
- **THEN** 它 MAY 留在源配置中
- **AND** 它 MUST NOT 成为当前进程活跃已校验 runtime config 的一部分

#### Scenario: observability 诊断细节默认为 normal 模式

- **WHEN** startup 校验的配置来源集合省略了 `observability.logging.diagnosticDetail`
- **THEN** 冻结的 runtime 配置 MUST 表现得如同 `observability.logging.diagnosticDetail=normal`
- **AND** startup MUST NOT 从环境、logger sink 行为或 runtime 失败推断出 debug 模式

#### Scenario: 遗留 logging 配置被拒绝

- **WHEN** startup 收到 `observability.runtimeLogging` 或 `observability.logging.redaction`
- **THEN** startup 校验 MUST 在 ready 状态之前拒绝该配置
- **AND** 它 MUST NOT 将任一遗留 key 合并、转换或优先于 `observability.logging`

#### Scenario: development 入口只启用 console 不启用文件

- **WHEN** 受信 development 入口组合其内置 runtime logging 默认值
- **THEN** 冻结配置 MUST 设置 `console.enabled=true` 且 `file.enabled=false`
- **AND** 除非用户应用配置显式启用文件 logging，产品代码 MUST NOT 创建 operational 文件

#### Scenario: local package 启用 operational 文件

- **WHEN** backend-only 或 with-frontend 的 local runtime package 使用其内置配置
- **THEN** 冻结配置 MUST 设置 `console.enabled=false` 且 `file.enabled=true`
- **AND** 除非受信用户应用配置为可配置字段提供有效覆盖，它 MUST 使用 `nextagent-operational.log.jsonl`、`maxFileSizeMiB=30`、固定的进程本地午夜每日安全轮转、`retentionDays=7` 和 `maxArchiveFiles=10`

#### Scenario: 非法 runtime logging 配置 fail closed

- **WHEN** startup 收到未知 level、非 boolean 的 sink 开关、不安全的 directory/name、`maxFileSizeMiB` 超出 `1..30`、`retentionDays < 7`、`maxArchiveFiles` 超出 `1..10` 或非整数、压缩选项、用户频率/时间轮转/时区选项、存储水位选项、条目/队列大小或 backpressure 选项
- **THEN** startup 校验 MUST 在 ready 状态之前拒绝活跃输入
- **AND** 诊断 MUST NOT 暴露原始 path、credential、token、prompt、模型输出或 stack trace

#### Scenario: runtime 输入无法改变 logging 策略

- **WHEN** 请求体、client metadata、模型输出或 capability 输入包含 logging sink、path、阈值或 retention 覆盖
- **THEN** 这些值 MUST NOT 改变冻结的 runtime logging 策略

#### Scenario: 部署模式选择 metrics exporter 边界

- **WHEN** 受信 startup 冻结 `deployment.mode=LOCAL`
- **THEN** app composition MUST 选择固定的本地滚动 metrics 历史 exporter
- **AND** 请求/配置扩展 MUST NOT 将 metrics 重定向到 OTLP 或其他文件
- **AND** 请求/配置扩展 MUST NOT 覆盖其间隔、行/缓冲预算、轮转、压缩或 retention
- **WHEN** 受信 startup 冻结 `deployment.mode=REMOTE`
- **THEN** 远程入口 MUST 注入一个 OTLP metric exporter
- **AND** 核心 app composition MUST NOT 回退到本地 metrics 文件

#### Scenario: 部署模式选择 audit gateway 边界

- **WHEN** 受信 startup 冻结 `deployment.mode=LOCAL`
- **THEN** gateway composition MUST 选择固定的本地文件 AuditEventStoreGateway
- **AND** 请求/配置扩展 MUST NOT 将 audit 重定向到 SQLite、operational logging、metrics 或其他文件
- **AND** 请求/配置扩展 MUST NOT 覆盖其固定的 30 MiB/每日轮转、至多 10 个 archive 数量、gzip、7 个自然天 retention 或去重语义
- **WHEN** 受信 startup 冻结 `deployment.mode=REMOTE`
- **THEN** 核心 app MUST 只在可用时消费由入口提供的远程 audit gateway
- **AND** 它 MUST NOT 回退到本地 audit 文件、SQLite 或 RuntimeLogger

#### Scenario: RAG 默认逻辑索引被冻结

- **WHEN** startup 校验带有 `rag.indexes=["local", "remote-netops"]` 的配置来源集合
- **THEN** 冻结的 runtime 配置 MUST 将这些值暴露为当前进程的 RAG 默认逻辑索引
- **AND** 下游 RAG Tool composition MAY 仅在 Tool 输入省略 `indexes` 时使用它们
- **AND** runtime 请求、模型输出和 Tool 输入 MUST NOT 改变冻结的默认列表

#### Scenario: RAG 默认逻辑索引 fail closed

- **WHEN** startup 校验带有空、重复、超限或不安全 `rag.indexes` 的配置来源集合
- **THEN** startup 校验 MUST 在 ready 状态之前安全地拒绝输入
- **AND** 系统 MUST NOT 将非法值重新解释为 provider 私有索引绑定或宿主路径
