## 背景与问题（Why）

当前 `Cron` Tool 创建任务时只接受标准五段式 cron。用户提出“10 分钟后复查告警”“1 小时 10 分钟后重新采集小区 KPI”等相对时间时，模型必须先获得当前时分秒，再进行单位换算、日期进位和时区计算。system prompt 只提供日期，而 Bash/Python 属于可能不可用的 sandbox 能力，导致普通延迟任务错误地依赖动态执行环境和模型算术。

电信运维中的短时复核、观察窗口和维护提醒需要可靠、可恢复、可审计的一次性调度。模型应原样表达用户给出的偏移单位，由 Cron capability 使用可信时钟冻结到期时间；任务创建不应要求模型读取宿主时间或把“1 小时 10 分钟”换算成 70 分钟。

## 变更范围（What Changes）

- 为 `Cron(action=create)` 增加结构化 `delay`，支持非负整数 `days`、`hours`、`minutes`；各字段允许自然大值，由系统统一换算，总延迟必须为 1 分钟至 365 天。
- `delay` 与 `cron` 恰好选择一种；delay task 固定为 one-shot，`recurring` 必须省略或为 `false`。
- delay 采用 elapsed-duration 语义：1 day 固定为 24 hours，不表示日历“明天同一时间”；不支持秒、月、年、工作日或维护窗口语义。
- 系统使用 app-owned trusted clock，在创建操作中单次读取基准时间，计算 `createdAt + delay` 后向上取整到分钟，冻结 durable `nextRunAt`，保证任务不早于请求偏移量执行且量化误差小于 1 分钟。
- 复用既有 Cron durable gateway、LOCAL/REMOTE scheduler、trigger claim、one-shot completion、任务上限和标准 request lifecycle；不依赖 system prompt、Bash 或 Python。
- create safe result 回显结构化 delay 和可读摘要；list 保持现有 durable 字段投影，不为还原原始输入扩大 gateway record。
- **BREAKING**：无。现有标准 cron create/list/delete 行为保持兼容。
- 本 change 只解决模型可调用 `Cron` Tool 的相对时间表达。REST 管理 API 面向可自行提供标准 cron 的机机调用，增加同形 public DTO 会触发独立 `agent-contracts/channel` refinement，因此不在本 change 扩大其 contract。

## Capability 影响（Capabilities）

### 新增 Capability

### 修改的 Capability

- `cron-tools`：在已完成但尚未归档的 `add-ts-cron-tools` 之上新增结构化相对延迟 one-shot 创建、可信时间计算、分钟量化和输入冲突约束；归档必须等待前序 change 先形成 stable baseline。

## 影响范围（Impact）

- `agent-capability`：Cron Tool schema、描述、Tool-facing `CronTaskPort` schedule union、gateway adapter 和 test-only in-memory fixture。
- `agent-app`：把现有 app-owned monotonic clock 注入 Cron capability adapter，不新增第二时间 owner。
- `agent-channel-common`：create safe projection 增加有界、结构化 delay allowlist；list 不变。
- `agent-contracts/gateway`、SQLite、REMOTE Cron protocol：不修改，继续持久化 canonical cron、`recurring=false` 和冻结 `nextRunAt`。
- `agent-contracts/channel` 与 Cron management REST API：不修改。
- 测试：正常组合偏移、自然大字段、零值/负数/小数/超上限、cron 冲突、recurring 冲突、跨日、分钟向上取整、重启恢复、one-shot trigger、无 sandbox 产品路径和 safe projection。

## 归档前更新基线（Baseline Promotion Plan）

行为契约：
- `openspec/specs/cron-tools/spec.md`：在前序 `add-ts-cron-tools` 归档后合并结构化 delay、互斥输入、分钟量化、one-shot 和 sandbox-independent 行为。

长期背景：
- `openspec/overview.md`：记录短周期电信运维任务由系统计算相对调度、不依赖模型当前时间或 sandbox。

设计视图：
- `openspec/designs/architecture/cron-task-execution.md`：补充 Tool delay → trusted clock → frozen `nextRunAt` → durable trigger 流程与时间 ownership。
- `openspec/designs/modules/agent-capability.md`：补充 Cron schedule union 和 adapter 责任。
- `openspec/designs/modules/agent-app.md`：补充 app clock 注入关系。
- `openspec/designs/adr/cron-scheduling-boundary.md`：记录“模型表达偏移、系统计算到期”和不扩展标准 cron 语法的长期取舍。
- `openspec/designs/spec-to-design-map.md`：增加行为、设计和验证导航。

验证入口：
- Cron Tool/schema、gateway adapter fake-clock、Web projection focused tests。
- LOCAL durable gateway/scheduler 与模型 Tool Calling product-path tests。
- `npm run build`、`npm test`、`npm run test:contract`、`npm run lint:architecture`、`openspec validate --all --strict`。
