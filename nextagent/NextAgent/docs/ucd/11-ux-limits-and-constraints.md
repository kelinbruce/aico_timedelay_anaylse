# UX 限制与约束参考

> 本文集中列出所有影响用户体验的数量/大小/时间限制，供 UCD 设计人员在设计界面时参考。`[已实现-主干]` 事实按最新 `origin/main`、owning stable/active spec、代码和测试核对；active change 尚待归档时会明确标注，非 UCD 设计定义。标注"可配置"的限制可通过系统配置文件调整，标注"硬编码"的限制为当前固定值。

> ℹ️ 本文是**事实参考**，非设计建议。设计人员需了解不同入口和配置层级的限制，避免把 compatibility 边界误写成 staged 产品主路径，或把某个默认值写死为不可配置上限。

---

## 1. 对话输入与附件

附件存在两条不同入口，限制不可混写。产品主路径是 **staged Web composer**；3 个/5 MiB/Markdown-only 是保留的 **compatibility direct-intake** 边界，不是主 composer 当前默认值。

### 1.1 Staged Web composer（产品主路径）

| 限制 | 数值 | 可配置 | UX 影响 | 代码位置 |
|:-----|------|:------:|---------|:--------|
| 每会话附件数 | 默认 **10 个**；系统上限 **200 个** | 是（`chat-upload-max-file-number`） | Agent package 可调整；超出系统上限时钳制为 200 | `agent-attachment-runtime/src/chat-upload-config.ts`、`upload-quota.ts` |
| 单文件大小 | 默认 **10 MiB**；系统上限 **500 MiB** | 是（`chat-upload-max-file-size`） | 配置单位为 MiB；multipart 边界与 runtime 同样不允许超过 500 MiB | `chat-upload-config.ts`、`staged-upload-runtime.ts`、`agent-channel-web/src/routes/requests.ts` |
| 默认类型 allowlist | `*.md`、`*.markdown` | 是（`chat-upload-file-type`） | 未配置或配置无效时回退到 Markdown-only；有效配置列表会**整体替换**默认值，不会自动合并 Markdown |
| 已支持扩展名映射 | PDF；DOC/DOCX；XLS/XLSX/CSV/TSV；PCAP/PCAPNG/CAP；TMF/PTMF；ZIP/TAR/RAR/GZ；MD/MARKDOWN/TXT/JSON/XML/LOG | 由 allowlist 启用 | 扩展名必须同时进入配置 allowlist 和系统 media vocabulary；A7 的 CSV/非 Markdown intake 已具备主干能力 | `attachment-media-type.ts`、`chat-upload-config.ts` |
| 文件名最大长度 | **512 字符** | 否（硬编码） | 超长或不满足安全字符/扩展名规则时拒绝，不是静默截断 | `file-content-validator.ts` |
| 默认暂存过期 | 空闲 **5 分钟**；最长 **30 分钟** | 是 | 未提交附件到期后需重新上传；最长过期不得小于空闲过期 | `chat-upload-config.ts` |
| 用户正式文件数量 | **200 个** | 否（系统上限） | 用户累计正式文件达到上限后拒绝新提交 | `upload-quota.ts` |
| 用户正式文件累计大小 | **500 MiB** | 否（系统上限） | 与“单文件最多 500 MiB”是两个独立门禁 | `upload-quota.ts` |
| 用户临时文件累计大小 | **1,024 MiB** | 否（系统上限） | 未提交/暂存文件占用达到上限后拒绝上传 | `upload-quota.ts` |
| 全局临时文件累计大小 | **2,048 MiB** | 否（系统上限） | 保护节点临时存储容量 | `upload-quota.ts` |
| 上传频率 | **500 次/用户/小时** | 否（系统上限） | 频率窗口内达到上限后拒绝继续 staged upload | `upload-quota.ts` |
| Magic bytes / 文本可读性 | 按文件扩展名检查；文本当前只检查文件头 **8 字节** | 否（硬编码） | PDF/ZIP/Office 的 magic bytes 有检查；文本文件第 8 字节之后的 NUL/非法 UTF-8 目前不会被发现，已记录为 `harden-staged-text-file-content-validation` 安全 clarify | `file-content-validator.ts` |
| 前端镜像验证 | 使用后端返回的 effective file types/count/size | 配置驱动 | Composer 提前拒绝明显无效附件，但后端仍是最终 authority | `frontend/agent-web/src/features/composer/attachmentRules.ts`、`config/runtimeConfig.ts` |

### 1.2 Compatibility direct-intake（保留路径）

| 限制 | 数值 | 可配置 | UX 影响 | 代码位置 |
|:-----|------|:------:|---------|:--------|
| 每次请求最大附件数 | **3 个** | 否（硬编码） | 超出返回 `ATTACHMENT_COUNT_EXCEEDED` | `agent-attachment-runtime/src/index.ts` |
| 单个附件最大大小 | **5 MiB** | 否（硬编码） | 超出返回 `ATTACHMENT_TOO_LARGE` | `agent-attachment-runtime/src/index.ts` |
| 支持类型 | **仅 Markdown**（.md/.markdown） | 否（硬编码） | 该兼容边界不能用来推导 staged composer 的格式支持 | `agent-attachment-runtime/src/index.ts` |

### 1.3 模型可见性边界

附件原始内容**不会直接拼入模型 prompt**。可用附件由 runtime 物化后，context assembly 仅向模型披露安全元数据和逻辑 Read path，使模型按需通过受控能力读取；物理 materialized path 与 `storageRef` 对模型不可见。附件不可用时只提供 metadata-only 降级，不伪造可读路径。

> `[已实现-主干]` 因此 A7 不再是“CSV/非 Markdown 附件未实现”缺口。若产品要改变默认 allowlist、增加格式专用预览，或移除 compatibility path，应作为新的、边界明确的 change 评审。

### 1.4 其他对话输入限制

| 限制 | 数值 | 可配置 | UX 影响 | 代码位置 |
|:-----|------|:------:|---------|:--------|
| ~~置顶问题~~ | — | — | pin 端点已从代码移除（返回 404），本行已过时 | — |
| ~~高频问题最大数量~~ | — | — | `pinLimit` 配置键已从 schema 移除，本行已过时 | — |
| 高频问题频率阈值 | **8 次** | 是（YAML `highFrequencyQuestion.frequencyThreshold`） | 出现 8 次以上的问题才进入高频问题列表 | `agent-app/src/config/validation.ts` |

---

## 2. 工具执行

模型调用工具时受到的并行/串行/轮数/超时限制。

### 2.1 并行工具调用

| 限制 | 数值 | 可配置 | UX 影响 | 代码位置 |
|------|------|--------|---------|---------|
| 每轮最大有副作用工具数 | **5 个** | 是（`DefaultAgentDependencies.maxToolCallsPerRound`） | 每轮最多并行执行 5 个有副作用的工具，超出后向模型发送纠正消息（最多 3 次恢复），最终抛出 `TOOL_CALL_LIMIT_EXCEEDED` | `agent-core/src/tools/tool-loop.ts:51` |
| 每轮最大只读工具数 | **20 个** | 是（`DefaultAgentDependencies.maxReadOnlyToolCallsPerRound`） | 每轮最多并行执行 20 个只读工具（Read/Grep/Glob），超出后同上降级处理 | `agent-core/src/tools/tool-loop.ts:52` |
| 只读工具白名单 | Read, Grep, Glob | 否（硬编码） | 只有这三个工具被认定为只读，享受更高的并行限额 | `agent-core/src/tools/tool-loop.ts:67` |
| 超限恢复次数 | **3 次** | 否（硬编码） | 超出工具调用限制后，最多尝试 3 次让模型重新发送合规数量的工具调用 | `agent-core/src/tools/tool-loop.ts:53` |
| ToolSearch + Skill 同批次 | **强制串行** | 否（硬编码） | ToolSearch 和 Skill 在同一批次中强制 SERIAL 模式，不并行执行 | `agent-core/src/tools/tool-loop.ts` |
| AskUserQuestion 中断 | **中断后续工具** | 否（硬编码） | 批次中遇到 AskUserQuestion 会中断后续工具执行，等待用户应答 | `agent-core/src/tools/tool-loop.ts` |
| 结果写入顺序 | **按模型声明顺序** | 否（硬编码） | 并行工具的结果按模型声明的 tool_use 顺序（非完成顺序）写入对话上下文 | `agent-core/src/tools/tool-loop.ts` |

### 2.2 工具调用轮数与超时

| 限制 | 数值 | 可配置 | UX 影响 | 代码位置 |
|------|------|--------|---------|---------|
| 最大工具调用轮数 | **50 轮** | 是（`runtimeSettings.maxToolIterations`） | Agent 在单次请求中最多执行 50 轮工具调用循环，超出后抛出 `TOOL_ROUND_LIMIT_EXCEEDED`，用户看到降级通知 | `agent-core/src/tools/tool-loop.ts:50` |
| 默认工具能力超时 | **2 分钟**（120,000 ms） | 是（lifecycle hook `timeoutMs`） | 单个工具调用默认 2 分钟超时 | `agent-core/src/tools/tool-loop.ts:60` |
| 工具循环收敛上限 | **50 轮** | 是（`runtimeSettings.maxToolIterations`） | `maxTurns` 是唯一收敛上限，达到后停止 Tool 执行并执行一次 `toolChoice=NONE` 无工具收尾 turn，发布 `TOOL_ROUND_LIMIT_EXCEEDED`；重复失败不再单独终止 run（见 `tool-loop` spec） | `agent-core/src/tools/tool-loop.ts` |
| 工具生成消息最大数量 | **10 条** | 否（硬编码） | 单个工具调用最多生成 10 条 generated messages | `agent-core/src/tools/tool-loop.ts:2044` |
| 工具结果 metadata 最大大小 | **4,096 字符** | 否（硬编码） | 工具返回的 metadata 序列化后不能超过 4,096 字符 | `agent-core/src/tools/tool-loop.ts:2054` |

### 2.3 Bash 工具特殊限制

| 限制 | 数值 | 可配置 | UX 影响 | 代码位置 |
|------|------|--------|---------|---------|
| Bash stdout 截断 | **100 KB** | 否（硬编码） | Bash 命令 stdout 超过 100 KB 静默截断 | `agent-capability/src/builtins/bash/bash-tool.ts:147` |
| Bash stderr 截断 | **100 KB** | 否（硬编码） | Bash 命令 stderr 超过 100 KB 静默截断 | `agent-capability/src/builtins/bash/bash-tool.ts:148` |
| Bash 超时上限 | **10 分钟**（600,000 ms） | 否（schema maximum） | 用户可设置的 Bash 超时上限为 10 分钟 | `agent-capability/src/builtins/bash/bash-schemas.ts:17` |

---

## 3. 内容呈现与截断

模型输出、工具结果在界面上呈现时的截断限制。

### 3.1 模型输出限制

| 限制 | 数值 | 可配置 | UX 影响 | 代码位置 |
|------|------|--------|---------|---------|
| 模型单次输出最大字符数 | **16,384 字符** | 否（硬编码） | 模型单次输出超过 16,384 字符会触发 `MODEL_TEXT_LIMIT_EXCEEDED`，用户看到降级通知 | `agent-core/src/model/output-guard.ts:3` |
| 模型最大输出 tokens | **2,048 tokens** | 是（YAML `modelProfiles.modelOptions.maxOutputTokens`） | 模型单次输出的最大 token 数 | `agent-app/config/default-system.yaml:45` |
| 模型调用超时 | **5 分钟**（300,000 ms） | 是（YAML `modelProfiles.timeoutMs`） | 模型调用超时时间 | `agent-app/config/default-system.yaml:42` |

### 3.2 工具结果截断

| 限制 | 数值 | 可配置 | UX 影响 | 代码位置 |
|------|------|--------|---------|---------|
| 能力结果消息最大字符数 | **256,000 字符** | 否（硬编码） | 单个工具返回的结构化结果序列化后不能超过 256,000 字符，超出抛出 `CAPABILITY_RESULT_LIMIT_EXCEEDED` | `agent-core/src/model/output-guard.ts:4` |
| 终端消息累计最大字符数 | **150,000 字符** | 否（硬编码） | 单次请求的累计终端输出最多 150,000 字符，超出触发 `TERMINAL_MESSAGE_LIMIT_EXCEEDED` | `agent-runtime/src/terminal/failure-normalizer.ts:5` |
| 流投影结果文本预览最大字符 | **4,000 字符** | 否（硬编码） | 流中工具结果文本预览最多 4,000 字符，超出截断 | `agent-channel-common/src/projections/stream-envelope.ts:41` |
| 流投影结果列表最大项数 | **50 项** | 否（硬编码） | 流中文件列表/Cron 任务列表等最多显示 50 项，超出截断并显示 "Result was truncated" | `agent-channel-common/src/projections/stream-envelope.ts:42` |
| 工作流答案预览最大数量 | **10 个** | 否（硬编码） | 工作流结果中最多展示 10 个答案预览 | `agent-channel-common/src/projections/stream-envelope.ts:771` |

### 3.3 上下文引擎内容处理

| 限制 | 数值 | 可配置 | UX 影响 | 代码位置 |
|------|------|--------|---------|---------|
| 大内容内联阈值 | **50 KB**（50,000 字节） | 否（硬编码） | 工具结果超过 50 KB 时触发外部化/截断 | `agent-context-engine/src/large-content/thresholds.ts:4` |
| 大内容聚合阈值 | **16 KB**（16,384 字节） | 否（硬编码） | 聚合工具结果的最大内联预算 | `agent-context-engine/src/large-content/thresholds.ts:5` |
| 大内容预览最大字符 | **2,048 字符** | 否（硬编码） | 外部化后保留的预览文本最大长度 | `agent-context-engine/src/large-content/thresholds.ts:6` |
| Read 工具不外部化 | Read 工具 | 否（硬编码） | Read 工具的结果永远不会被外部化/截断（它自己管理分页） | `agent-context-engine/src/large-content/externalizer.ts:20` |
| 可压缩工具名白名单 | bash, read, grep, glob, write, python | 否（硬编码） | 只有这些工具的结果可被微型压缩 | `agent-context-engine/src/micro-compact/config.ts:25-32` |

---

## 4. 定时任务（Cron）

用户通过对话创建定时任务时受到的限制。

| 限制 | 数值 | 可配置 | UX 影响 | 代码位置 |
|------|------|--------|---------|---------|
| Cron 表达式格式 | **标准 5-field cron**（M H DoM Mon DoW） | 否（硬编码） | 只支持标准 5 字段 cron 表达式，不支持 L/W/?/名称别名 | `agent-capability/src/builtins/cron/cron-expression.ts:1-8` |
| Cron 表达式最大长度 | **256 字符** | 否（硬编码） | 用户输入的 cron 表达式不能超过 256 字符 | `agent-capability/src/builtins/cron/cron-schemas.ts:3` |
| Cron prompt 最大长度 | **10,000 字符** | 否（硬编码） | 定时任务触发的 prompt 不能超过 10,000 字符 | `agent-capability/src/builtins/cron/cron-schemas.ts:4` |
| Cron Dashboard prompt 表单长度 | **1,000 字符** | 否（前端硬编码） | Dashboard 手动创建/修改表单比后端 10,000 字符门禁更窄；通过 API/Tool 测试后端边界时不能用此表单代替 | `frontend/agent-web/src/pages/CronTaskDashboardPage.tsx` |
| 每 scope ACTIVE Cron task 容量 | **50 个** | 否（持久化不变量） | 第 51 个 ACTIVE task 创建失败；COMPLETED/DELETED 不占额度。Tool 返回 `CRON_TASK_LIMIT_REACHED`，management API 返回 HTTP 409 | `fix-cron-active-task-capacity-enforcement` active change、Cron gateway 实现 |
| Cron 字段范围 | 分钟 0-59, 小时 0-23, 日 1-31, 月 1-12, 周 0-6 | 否（硬编码） | cron 表达式各字段的取值范围 | `agent-capability/src/builtins/cron/cron-expression.ts:20-26` |
| Cron 下次运行计算上限 | **1 年内**（366×24×60 次迭代） | 否（硬编码） | 如果 cron 表达式在一年内没有匹配日期，则拒绝创建 | `agent-capability/src/builtins/cron/cron-expression.ts:105` |
| Cron 任务列表投影截断 | **50 项** | 否（硬编码） | 流投影中 Cron 任务列表最多显示 50 项，超出截断 | `agent-channel-common/src/projections/stream-envelope.ts:42` |
| Cron 内联文本最大长度 | **256 字符** | 否（硬编码） | 流投影中 Cron 任务的 id/humanSchedule/cron 等内联文本字段最大 256 字符 | `agent-channel-common/src/projections/stream-envelope.ts:43` |
| Cron 调度器轮询间隔 | **1 秒**（1,000 ms） | 是（`LocalCronTaskSchedulerOptions.cadenceMs`） | 调度器每秒检查一次到期任务 | `agent-platform-gateway-local/src/scheduled/local-cron-task-scheduler.ts:46` |
| Cron 调度器批量大小 | **100 个** | 是（`LocalCronTaskSchedulerOptions.batchSize`） | 每次轮询最多处理 100 个触发 | `agent-platform-gateway-local/src/scheduled/local-cron-task-scheduler.ts:47` |

---

## 5. 会话管理

用户管理会话（标题、fork、派生）时受到的限制。

| 限制 | 数值 | 可配置 | UX 影响 | 代码位置 |
|------|------|--------|---------|---------|
| 会话标题最大长度 | **100 字符** | 否（schema maxLength） | 用户设置的会话标题不能超过 100 字符 | `agent-channel-web/src/schemas/session-dto.ts:23` |
| Fork 最大复制消息数 | **500 条** | 是（`forkResourceLimits.maxCopiedMessages`） | Fork 会话时最多复制 500 条消息 | `agent-runtime/src/lifecycle/submit.ts:4588` |
| Fork 最大复制内容 | **2 MB**（2,000,000 字节） | 是（`forkResourceLimits.maxCopiedContentBytes`） | Fork 时复制的消息内容总量不能超过 2 MB | `agent-runtime/src/lifecycle/submit.ts:4589` |
| Fork 最大提升引用数 | **8 个** | 是（`forkResourceLimits.maxPromotionRefs`） | Fork 提升时最多 8 个外部引用 | `agent-runtime/src/lifecycle/submit.ts:4590` |
| Fork 最大提升内容 | **2 MB**（2,000,000 字节） | 是（`forkResourceLimits.maxPromotedBytes`） | Fork 提升的内容总量不能超过 2 MB | `agent-runtime/src/lifecycle/submit.ts:4591` |
| Fork 锚点解析限制 | **100 个** | 否（硬编码） | Fork 会话时最多解析 100 个锚点消息 | `agent-runtime/src/lifecycle/submit.ts:114` |

---

## 6. 上下文窗口与压缩

长对话中上下文窗口管理和自动压缩的限制。

| 限制 | 数值 | 可配置 | UX 影响 | 代码位置 |
|------|------|--------|---------|---------|
| 默认模型上下文窗口 | **128,000 tokens** | 是（YAML `modelProfiles.contextWindowTokens`） | 默认模型上下文窗口大小 | `agent-app/config/default-system.yaml:49` |
| 自动压缩触发阈值 | **剩余 13,000 tokens** 时触发 | 否（硬编码） | 当输入 tokens 达到可用窗口减去 13,000 时（约 92%）触发摘要压缩，用户看到压缩通知 | `agent-context-engine/src/assembly/assemble-context.ts:222` |
| 预发送检查比率 | **88.5%** | 是（`preSendCheckRatio`） | 当估算输入占可用窗口的 88.5% 时触发预发送检查 | `agent-context-engine/src/budget/default-proportional-budget-policy.ts:61` |
| 微型压缩触发阈值 | **累计 10 个**可压缩工具结果 | 否（硬编码） | 累计 10 个可压缩工具结果时触发微型压缩 | `agent-context-engine/src/micro-compact/config.ts:42` |
| 微型压缩保留最近项数 | **5 个** | 否（硬编码） | 微型压缩始终保留最近 5 个工具结果不被压缩 | `agent-context-engine/src/micro-compact/config.ts:44` |

---

## 7. Pending Input

Agent 暂停等待用户输入时的超时限制。

| 限制 | 数值 | 可配置 | UX 影响 | 代码位置 |
|------|------|--------|---------|---------|
| Pending input 默认超时 | **30 分钟**（1,800,000 ms） | 否（硬编码） | 用户等待回答的默认超时为 30 分钟，超时后请求失败 | `agent-runtime/src/lifecycle/agent-run-state-port.ts:48` |
| Pending input 最大超时 | **24 小时**（86,400,000 ms） | 否（硬编码） | 即使显式设置，pending input 超时也不能超过 24 小时 | `agent-runtime/src/lifecycle/agent-run-state-port.ts:49` |
| AskUserQuestion 可见文本最大长度 | **500 字符** | 否（硬编码） | 向用户提问的文本不能超过 500 字符 | `agent-core/src/tools/tool-loop.ts:1269` |

---

## 8. 传输层

SSE/WebSocket 流传输的限制。

| 限制 | 数值 | 可配置 | UX 影响 | 代码位置 |
|------|------|--------|---------|---------|
| SSE 背压超时 | **15 秒**（15,000 ms） | 是（`SseStreamOptions.streamBackpressureTimeoutMs`） | 当客户端消费速度跟不上时，15 秒后 SSE 流断开，用户看到断线重连指示 | `agent-channel-common/src/projections/stream-envelope.ts:75` |
| WebSocket 背压超时 | **15 秒**（15,000 ms） | 否（硬编码） | WebSocket 流的背压超时也是 15 秒 | `agent-channel-task/src/websocket.ts:15` |
| 重放批量事件上限 | **1,000 个** | 否（硬编码） | 流恢复时最多重放 1,000 个事件 | `agent-runtime/src/lifecycle/submit.ts:181` |
| 时间线读取超时 | **5 秒**（5,000 ms） | 否（硬编码） | 读取时间线事件的超时 | `agent-runtime/src/lifecycle/submit.ts:182` |

---

## 9. Run 执行限制

单次 run（一次用户请求到 Agent 回复完成）的限制。

| 限制 | 数值 | 可配置 | UX 影响 | 代码位置 |
|------|------|--------|---------|---------|
| 默认请求超时 | **30 分钟**（1,800,000 ms） | 是（`runtimeSettings.requestTimeoutMs`） | 单次 run 最长执行 30 分钟，超时后请求被 abort | `agent-runtime/src/lifecycle/submit.ts:113` |

---

## 10. 后台任务与并发

多会话后台 run 和并发的限制。

| 限制 | 数值 | 可配置 | UX 影响 | 代码位置 |
|------|------|--------|---------|---------|
| 最大并发运行数 | **无限**（默认） | 是（`scheduler.maxConcurrent`） | 默认不限制并发运行数；配置后限制为指定正整数 | `agent-runtime/src/lifecycle/submit.ts:2495-2497` |
| 最大待处理队列深度 | **无限**（默认） | 是（`scheduler.maxPendingQueueDepth`） | 默认不限制排队深度；配置后超出会被拒绝 | `agent-runtime/src/lifecycle/submit.ts:1534-1538` |
| 恢复扫描批量大小 | **100 个** | 否（硬编码） | 每次恢复扫描最多处理 100 个可恢复 run | `agent-runtime/src/lifecycle/submit.ts:1427` |

---

## 11. 系统配置限制

系统级配置项的数量限制。

| 限制 | 数值 | 可配置 | UX 影响 | 代码位置 |
|------|------|--------|---------|---------|
| RAG 索引最大数量 | **5 个** | 否（schema maxItems） | 最多配置 5 个 RAG 索引 | `agent-app/src/config/validation.ts:235` |
| 插件系统最大条目 | **8 个** | 否（schema maxItems） | 最多配置 8 个插件 | `agent-app/src/config/validation.ts:60` |
| 插件路径最大长度 | **256 字符** | 否（schema maxLength） | 插件路径不能超过 256 字符 | `agent-app/src/config/validation.ts:54` |
| 模型配置最少数量 | **1 个** | 否（schema minItems） | 至少需要配置 1 个模型 profile | `agent-app/src/config/validation.ts:203` |
| Local Auth cookie TTL 范围 | **1 分钟 - 24 小时** | 是（YAML `auth.localAuth.cookieTtlMs`） | 登录 cookie 的有效期限范围 | `agent-app/src/config/validation.ts:180` |

---

## 12. 内存系统

Agent 记忆系统相关的限制。

| 限制 | 数值 | 可配置 | UX 影响 | 代码位置 |
|------|------|--------|---------|---------|
| 内存搜索默认返回数 | **20 条** | 是（YAML `memory.search.default-limit`） | 内存搜索默认返回 20 条结果 | `agent-app/config/default-system.yaml:109` |
| 内存搜索最低置信度 | **0.3** | 是（YAML `memory.search.min-confidence`） | 置信度低于 0.3 的内存结果不返回 | `agent-app/config/default-system.yaml:110` |
| 内存提取最大候选 | **50 个** | 是 | 每次提取最多处理 50 个候选 | `agent-app/config/default-system.yaml:118` |
| 内存提取超时 | **1 分钟**（60,000 ms） | 是 | 内存提取操作超时 | `agent-app/config/default-system.yaml:119` |
| 内存老化衰减过期天数 | **30 天** | 是（YAML `memory.aging.decayStaleDays`） | 30 天未访问的内存开始衰减 | `agent-app/config/default-system.yaml:124` |
| 内存老化归档保留天数 | **90 天** | 是（YAML `memory.aging.archiveRetentionDays`） | 归档内存保留 90 天 | `agent-app/config/default-system.yaml:125` |
| 内存老化批处理限制 | **1,000 条** | 是 | 老化处理每批最多 1,000 条 | `agent-app/config/default-system.yaml:127` |

---

## 13. 历史过程加载与缓存

长会话的 Event history 使用有界调度与 run 级缓存，避免快速滚动或预览跳转造成请求风暴。

| 限制 | 数值 | UX 影响 |
|---|---:|---|
| 单次 Event 查询上限 | **1,000 条** | 超过一页时同一 run 串行加载后续页 |
| 自动目标队列 | **最多 16 个** | 快速滚动时丢弃失去价值的旧自动目标 |
| 显式目标队列 | **最多 16 个** | 预览点击和用户显式展开优先于自动预加载 |
| Event 请求全局并发 | **最多 4 个** | 防止长会话滚动触发并发风暴 |
| 视口预加载范围 | **1 个视口** | 只预取邻近内容，不加载整场会话的全部 process history |
| 预加载稳定时间 | **120ms** | 滚动未稳定时不启动预加载 |
| loading affordance 延迟 | **300ms** | 短请求不闪现“加载历史信息” |
| completed entry 自动折叠 | **800ms** | 用户有时间看到完成结果，再收起单条过程 |
| terminal panel 自动折叠 | **150ms** | 最终答案开始呈现时及时收起外层过程面板 |
| 未固定 run cache | **最多 64 个 run** | 超出后按 whole-run LRU 淘汰 |
| 未固定 envelope cache | **最多 2,000 条** | 单个 run 不截断；按 whole-run 淘汰直到回到预算内 |

用户手动展开的 run、当前 live run 和显式导航目标可被固定，不参与普通 LRU 淘汰。离开可视区不会取消已发出的只读请求；会话清理或 store dispose 才终止旧会话请求。

---

## 流可见事件类型

`[已实现-主干]` channel contract 定义 23 种 `StreamEventType`：

`REQUEST_ACCEPTED`、`LLM_THINKING_DELTA`、`LLM_CONTENT_DELTA`、`CAPABILITY_STARTED`、`CAPABILITY_RESULT_DELTA`、`CAPABILITY_COMPLETED`、`TOOL_STRUCTURED_DELTA`、`DEGRADATION_NOTICE`、`REQUEST_COMPLETED`、`REQUEST_FAILED`、`REQUEST_CANCELED`、`REQUEST_SUPERSEDED`、`USER_INPUT_REQUIRED`、`USER_INPUT_RECEIVED`、`USER_INPUT_TIMEOUT`、`USER_INPUT_CANCELED`、`ATTACHMENT_ACCEPTED`、`ATTACHMENT_REJECTED`、`CONTEXT_COMPACTED`、`BACKGROUND_TASK_STARTED`、`BACKGROUND_TASK_COMPLETED`、`BACKGROUND_TASK_FAILED`、`OUTPUT_GUARD_BLOCKED`。

其中前 22 种来自 shared canonical timeline projection；`OUTPUT_GUARD_BLOCKED` 是 guard-forward relay 可注入的唯一受控 terminal 例外，不替代 runtime canonical terminal fact。frontend 目前还接受 `HOOK_DEGRADED` 作为兼容词汇，但它不属于 channel contract，新的后端路径不得把它当作稳定事件。其他 timeline event 保持 timeline-only 或按投影规则安全失败，transport 不得自行发明新的 public event name。来源：`agent-contracts/src/channel/index.ts`、`agent-channel-common/src/projections/stream-envelope.ts`、`frontend/agent-web/src/state/contracts.ts`。

---

## 设计参考要点

UCD 设计人员在设计界面时应注意以下要点：

1. **附件上传**：staged Web composer 必须消费 runtime bootstrap 返回的 effective 类型、数量和大小配置并提前提示；当前默认是 10 个、每个 10 MiB、Markdown-only，但配置可改变。3 个、5 MiB、Markdown-only 只适用于 compatibility direct-intake，不得硬编码成产品主路径提示。
2. **并行工具**：过程面板中并行能力卡片最多 5 个有副作用或 20 个只读。设计"并行 N/M"徽标时 M 的上限应考虑此限制。
3. **Cron 任务列表**：列表最多展示 50 项，超出会截断。UI 应提示"仅显示前 50 项"。
4. **会话标题**：输入框 maxlength 应设为 100。
5. **置顶问题**：输入框 maxlength 应设为 2,000。
6. **Pending input 超时**：设计 pending input 卡片时应考虑 30 分钟默认超时，UI 可显示倒计时或"将在 N 分钟后超时"提示。
7. **工具结果截断**：能力卡片结果预览最多 4,000 字符，列表最多 50 项。设计"查看完整结果"交互时应考虑此截断。
8. **Bash 输出**：stdout/stderr 各最多 100 KB，超时上限 10 分钟。
9. **Fork 限制**：最多复制 500 条消息或 2 MB 内容，超出时 UI 应提示用户。
10. **上下文压缩**：约 92% 窗口占用时自动触发，UI 应提前提示"上下文即将压缩"而非压缩后才发现。
