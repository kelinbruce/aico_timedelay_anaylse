## Why

Agent 开发者当前启用 `developer-hook-trace` 或 `context-monitor` 后，插件会自行选择目录和文件并同步写入原始调测内容。运维人员无法对这些文件应用统一的容量上限、轮转、压缩、保留和关闭策略；写入失败也缺少独立、可查询的降级状态。由于这些内容可能包含用户问题、模型输入输出、Tool 参数和上下文，将其并入主运行日志又会破坏主日志的安全边界。

现在需要把这类输出统一定义为 **developer diagnostic artifact**：它是由显式启用的开发调测插件产生、可能包含敏感原始内容、只供受信本地开发者和运维人员使用的短期诊断产物；它不是 operational log、audit、metric、timeline 或业务持久化事实。

## 目标与非目标（Goals / Non-Goals）

**目标：**

- 所有受支持插件调测输出进入一个独立的 developer diagnostic artifact 文件族，并具有统一的有界写入、轮转、压缩、保留和关闭行为。
- 插件只能提交结构化诊断记录，不能选择宿主文件路径、文件名或生命周期策略。
- developer diagnostic artifact 的内容和写入失败都不进入主运行日志、audit、metrics、timeline、stream 或 Web 公共响应。
- artifact 写入不可用、记录非法、记录超限或队列过载时，插件受保护操作继续执行，并通过受信本地开发诊断状态提供有界失败证据。
- 现有 `developer-hook-trace` 与 `context-monitor` 使用同一 artifact 边界，同时保留各自已有的调测语义和默认不激活行为。

**非目标：**

- 不把 developer diagnostic artifact 定义为安全日志、审计证据、完整请求重放来源或长期合规存档。
- 不新增远端上传、对象存储、查询 API、浏览器下载、目录浏览或主日志镜像。
- 不使插件成为文件生命周期 owner，也不扩大插件对 gateway、宿主路径、credential、Agent Scope 或 Owner Scope 的权限。
- 不为不可信第三方插件提供进程隔离；插件仍是受信本地启动期扩展。

## What Changes

- 新增统一 developer diagnostic artifact 行为：受信宿主为已加载插件绑定身份，接收结构化 JSON 记录，并在独立文件族中执行有界异步写入、每日或大小轮转、gzip 和 elapsed-day 保留。
- **BREAKING**：正式插件 artifact 不再通过 activation config 接受 `logDirectory` 或 `logFile`，也不再直接创建、追加或覆盖宿主文件；插件改为消费宿主提供的 developer diagnostic artifact 能力。
- 修改 `developer-hook-trace` 的可观察输出：每次受支持 stage 仍产生一条包含原始 boundary 和可信运行坐标的诊断记录，但物理文件及其生命周期由系统统一管理。
- 修改 `context-monitor` 的可观察输出：压缩快照与终态快照改为统一 artifact records，不再承诺 `compact-*.json`、`last-*.json` 文件布局或每 session 文件数量。
- 新增本地开发诊断状态：只暴露 availability、bounded dropped count 和稳定 failure code，不暴露 artifact payload、宿主路径或原始异常。

## Feature 影响（Features）

### 新增 Feature

- `F-10.5 管理插件开发诊断产物`：Agent 开发者和本地运维人员可在显式启用调测插件时获得独立、有界且不会污染主日志的短期诊断产物；由 `FN-10.5` 提供。

### 修改的 Feature

无。

### 移除的 Feature

无。

## Function 影响（OpenSpec Capabilities）

### 新增 Function

- `FN-10.5 管理插件开发诊断产物` → `specs/plugin-developer-diagnostic-artifacts/spec.md`
  - 功能边界：系统接受已加载插件提交的结构化开发诊断记录，绑定可信插件身份与可用运行坐标，输出独立、有界、短期保留的本地产物及有界降级状态。
  - 系统质量属性：安全、性能/容量、可靠性/恢复、可维护性、可测试性。

### 修改的 Function

无。

### 触及的 legacy specs

- `developer-hook-trace-logging`：迁出 caller-owned file sink 与物理 NDJSON 文件责任，保留 developer hook trace 的记录内容和 observe-only 行为。
- `context-monitor-logging`：迁出 caller-owned file sink、每 session 文件布局和文件数量责任，保留 context evolution 的记录时机和内容语义。

## 影响范围（Impact）

- Agent 开发者需要使用更新后的插件 artifact；旧的 `logDirectory`、`logFile` activation 配置不再合法。
- 本地运维需要为 `paths.logDirectory` 设置仅受信主体可访问的文件权限，并按独立文件名前缀和短保留期处理潜在敏感内容。
- 插件公共 authoring contract、系统配置校验、本地 gateway 文件输出、应用启动与关闭装配、local runtime packaging、developer workbench 状态投影及相关测试会受到影响。
- operational、audit 和 metrics 文件族的内容、配置、查询与生命周期保持不变。
