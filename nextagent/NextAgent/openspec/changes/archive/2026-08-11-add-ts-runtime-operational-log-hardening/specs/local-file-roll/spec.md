## ADDED Requirements

### Requirement: 本地滚动文件使用一个窄化的 Node-only 技术基础

workspace SHALL 提供 `@nextagent/agent-local-file-roll` 作为一个 Node-only 的技术基础包。它 SHALL 只暴露一个窄化的 rolling-line factory，以及创建独立自有 handle 所需的 policy、append-result、active-identity 和有界生命周期类型。它 SHALL 拥有对 `pino-roll@4.0.0` 和 `sonic-boom@4.2.1` 的直接依赖，以及对 Node 文件系统和 zlib API 的私有使用。

该包 MUST NOT 依赖 `agent-common`、`agent-contracts` 或任何产品实现包。它 MUST NOT 定义或导入 RuntimeLogger、Pino operational 信封、MetricSample、NextAgentMetricSnapshot、AuditEventRecord、部署配置、readiness 状态或 owner 特定的失败词汇。其公开 policy MUST NOT 接受 `log | metrics | audit` 模式、任意文件 matcher、任意删除回调或业务序列化器。MUST NOT 引入泛化的 `agent-utils` 或语义化的 `agent-file-output` 包作为替代边界。

生产依赖策略 SHALL 只允许 `agent-log`、`agent-observability` 和 `agent-platform-gateway-local` 导入 `agent-local-file-roll`。测试 MAY 在仓库 test-only 依赖策略下使用其公开导出；除非具体的测试接缝需要，本 change MUST NOT 添加 testing entrypoint。其他任何业务、channel、runtime、model、capability、gateway-remote、app 或 contract 包都不得直接使用它。

#### Scenario: 包依赖图保持基础边界

- **WHEN** 检查 workspace 清单、导出和源码导入
- **THEN** pino-roll、SonicBoom 和滚动文件 zlib 生命周期代码 MUST 只被 agent-local-file-roll 拥有
- **AND** 只有三个获批的生产消费方可以依赖其公开导出
- **AND** 该包 MUST NOT 依赖 common、contracts 或产品实现包
- **AND** 实现包之间禁止互相依赖的既有禁令 MUST 对其他每一对包保持有效

#### Scenario: 消费方尝试把输出语义传入机制

- **WHEN** 调用方提供业务模式、序列化器、任意 matcher 或删除回调
- **THEN** 公开 contract 或运行时策略校验 MUST 拒绝它
- **AND** 该机制 MUST NOT 基于 operational、metrics 或 audit 词汇分支

### Requirement: 每个输出 owner 创建独立的滚动文件 handle

`agent-log` SHALL 为 operational 和 plugin diagnostic 文件族创建各自独立自有的 local-file-roll handles。`LocalMetricHistoryExporter` 和 `FileAuditEventStoreGateway` SHALL 各自从其受信冻结的文件族策略创建另一个独立自有的 handle。四个 handle MAY 共享 factory 和机制代码，但 MUST NOT 共享目标位置、活跃文件身份、缓冲、timer、维护 lane、可变状态、close 状态或 policy 对象。一个 handle 的失败、过载、维护或 close MUST NOT 停止、flush、修改或老化另一个 handle。

每个输出 owner SHALL 继续负责行序列化和 schema、策略取值、追加/导出/日志结果解释、readiness 和 degraded/recovered 映射。基础包 SHALL 只报告有界的机制结果，MUST NOT 自己写 operational 诊断、metrics 或 audit 证据。

#### Scenario: 三个本地输出文件族并发运行

- **WHEN** operational、metrics 和 audit 输出在同一个 LOCAL 进程中启用
- **THEN** 恰好四个独立 handle MUST 拥有四个活跃目标位置和四个互斥的派生 selectors
- **AND** 关闭或降级一个 handle MUST 保持另外两个可用
- **AND** 任何 handle 都不得发现、压缩、老化或删除另一个 handle 拥有的文件

### Requirement: 本地文件滚动提供安全的有界生命周期机制

factory SHALL 在创建 handle 之前校验受信目录、安全的基础名、扩展名、`sequence | date-sequence` 命名形状、正的尺寸阈值、有界异步缓冲、经过时长 retention 和可选的正 archive 数量上限。它 SHALL 从这些已校验的值派生精确的自有文件 selector。它 MUST NOT 跟随 symlink，也不得操作外部、未知或非普通文件。

每个 handle SHALL 提供非阻塞的有界行入队、尺寸或固定进程本地日界轮转、transport 拥有的活跃身份、`.gz.tmp -> 原子 .gz -> 删除已关闭源文件` 压缩、原始关闭/轮转时间戳保留、startup 对账、周期性 archive 工作、经过时长 retention 和有界的幂等 close。Gzip、重命名或被中断的压缩 MUST 保留至少一个可恢复的源文件或已提交 archive。retention 失败 MUST 保留证据以供重试。维护 MUST 排除当前活跃目标位置，并 MUST 在该 handle 的单一串行 lane 中运行。

当 handle 策略提供 `maxArchiveFiles` 时，startup 和周期性 archive 维护 SHALL 只统计由该 handle 精确 archive selector 匹配到的已提交普通 `.gz` 文件。压缩完成后，维护 SHALL 按 `mtime` 删除最旧的 archive，以文件名作为确定性的平局裁决，直到数量回到配置上限之内。数量清理和经过时长 retention SHALL 是相互独立的删除条件。临时 archives、已关闭源文件、活跃文件、symlink、未知文件和其他文件族 MUST NOT 计入上限，也 MUST NOT 因此被删除。删除失败 MUST 保留该 archive 以供重试，MAY 暂时让文件族超出上限而不影响业务工作。

#### Scenario: 自有的已提交 archives 超过配置上限

- **WHEN** 一个配置了 `maxArchiveFiles=10` 的 handle 拥有十一个仍在经过时长 retention 内的已提交 gzip archives
- **THEN** 维护 MUST 只删除最旧的自有 archive
- **AND** 成功维护后 MUST 恰好留下十个已提交的自有 archives
- **AND** 源文件和临时文件 MUST 只继续受其既有压缩/对账规则管辖，而不受数量计算管辖
- **AND** 活跃、symlink、未知和跨文件族的文件 MUST 保持不变

#### Scenario: 已关闭文件被安全归档和老化

- **WHEN** 一个精确自有的非活跃源文件因尺寸或进程本地日界被关闭
- **THEN** 其 handle MUST 创建临时 gzip、原子提交它，然后才删除源文件
- **AND** 该 archive MUST 保留用于经过时长 retention 的原始 closedAt
- **AND** startup 对账或周期性维护 MUST 只在其 owner 策略过期后删除它

#### Scenario: 遇到不安全或有歧义的文件

- **WHEN** 维护遇到活跃、年轻、symlink、外部、未知、跨文件族或时间戳有歧义的文件
- **THEN** 它 MUST 保留该文件
- **AND** 它 MUST NOT 扩大其 selector 或阻塞业务路径

### Requirement: Operational 活跃身份保持为 owner 控制的投影

一个 local-file-roll handle MAY 向其直接 owner 暴露其当前由 transport 拥有的活跃身份。只有 `agent-log` MAY 通过受信 app composition 把该身份投影给 Agent Dev Workbench。基础包 MUST NOT 暴露目录扫描、archive 读取、gzip 解压或最高 sequence 猜测 API。

#### Scenario: Workbench 请求 operational 证据

- **WHEN** agent-log 从自己的 handle 投影当前活跃身份
- **THEN** app MAY 把该有界 provider 注入 workbench
- **AND** metrics 和 audit handles MUST 对 workbench 保持不可发现
- **AND** workbench MUST NOT 直接导入 agent-local-file-roll
