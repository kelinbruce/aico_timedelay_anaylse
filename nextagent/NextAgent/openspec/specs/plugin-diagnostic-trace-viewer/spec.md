# plugin-diagnostic-trace-viewer Specification

## Purpose

定义插件诊断轨迹离线查看器能力：使用者选择一份本地 developer diagnostic artifact NDJSON 文件后，查看器按 `(sessionId, requestId)` 精确组合识别全部执行轨迹，以确定顺序呈现事件流程、阶段核心指标和原始记录详情。查看器作为单个本地 HTML 文件离线运行，不依赖 NextAgent 服务、不发起网络请求、不写入持久存储，非法记录只降级自身。
## Requirements
### Requirement: 查看器按会话和请求区分执行轨迹

当使用者选择一份本地 UTF-8 NDJSON 文件时，查看器 MUST 独立解析每个非空行。一个解析结果只有在顶层 `sessionId` 和顶层 `requestId` 均为非空字符串时才是轨迹事件；查看器 MUST 使用二者的精确有序组合 `(sessionId, requestId)` 作为唯一轨迹标识，MUST NOT 使用 `runId`、`hookInvocationId`、`payload` 内同名字段或字符串拼接后的模糊匹配替代该组合。查看器 MUST 列出文件中全部不同轨迹，并允许使用者选择其中任一轨迹；初始选择 MUST 是文件中首次出现的合法轨迹。

**需求类别**：功能性需求

#### Scenario: 一份文件包含多条执行轨迹

- **WHEN** 使用者导入的文件包含两个不同 `sessionId` 与 `requestId` 组合的合法记录
- **THEN** 查看器 MUST 显示两条可选择的轨迹
- **AND** 每条轨迹 MUST 只包含与其 `sessionId` 和 `requestId` 均精确相等的记录

#### Scenario: 相同文本拼接不能合并不同组合

- **WHEN** 文件分别包含 `("ab", "c")` 与 `("a", "bc")` 两组坐标
- **THEN** 查看器 MUST 将二者显示为两条不同轨迹

### Requirement: 查看器以确定顺序呈现轨迹事件

查看器 MUST 为选定轨迹显示一个事件节点序列。具有有效 `recordedAt` 时间的事件 MUST 按时间升序排列；时间相同时 MUST 按原始文件行号升序排列。缺少有效 `recordedAt` 的事件 MUST 排在全部有效时间事件之后，并按原始文件行号升序排列。每个节点 MUST 显示原始文件行号、`recordedAt` 或“时间未知”、`payload.stage` 或 `stage` 或 `UNKNOWN_STAGE`、相对前一个具有有效时间事件的非负毫秒差值，以及当前记录中存在的 `runId`、`payload.stepId`、`payload.modelId`、`payload.toolCallId`、`payload.capabilityId` 和 `payload.capabilityInvocationId`。查看器 MUST 允许使用者展开每个节点并查看该行解析所得的完整 JSON 对象。

**需求类别**：功能性需求

#### Scenario: 乱序记录按时间与行号稳定排序

- **WHEN** 选定轨迹包含乱序时间、相同时间和无效时间的事件
- **THEN** 查看器 MUST 先按有效时间升序显示事件，并以行号打破相同时间的并列
- **AND** 查看器 MUST 最后按行号显示无效时间事件

#### Scenario: 展开节点查看原始记录

- **WHEN** 使用者展开一个轨迹事件节点
- **THEN** 查看器 MUST 显示该输入行解析所得的全部 JSON 字段和值
- **AND** 记录中的字符串 MUST 作为文本显示，MUST NOT 作为 HTML 执行

### Requirement: 查看器按事件阶段展示核心指标

查看器 MUST 根据事件节点的最终显示 stage 选择核心指标，且 MUST 使用下列唯一映射：`BEFORE_PLANNING` 映射到 `payload.boundary.flowVariables.input_question`；`AFTER_MODEL_RESULT` 按 `firstContentLatencyMs`、`modelE2ELatencyMs`、`usage`、`toolCalls` 的固定顺序映射到 `payload.boundary` 的四个同名字段；`BEFORE_CAPABILITY_INVOKE` 映射到 `payload.boundary.capabilityId`。当映射值存在时，查看器 MUST 在节点主体中显示指标名称和完整值；`firstContentLatencyMs` 与 `modelE2ELatencyMs` 的数值 MUST 追加 ` ms` 单位，object 或 array 值 MUST 以 JSON 文本显示。任一映射路径不存在时，查看器 MUST 在对应指标中显示“不可用”，且一个字段缺失 MUST NOT 隐藏同一 stage 的其他指标。其他 stage MUST NOT 显示阶段核心指标区域。全部指标内容 MUST 作为文本呈现，MUST NOT 作为 HTML 执行。

**需求类别**：功能性需求

#### Scenario: 规划前展示输入问题

- **WHEN** `BEFORE_PLANNING` 事件的 `payload.boundary.flowVariables.input_question` 为 `执行ls -l命令`
- **THEN** 该事件节点 MUST 显示指标名称 `input_question` 和值 `执行ls -l命令`

#### Scenario: 模型结果后展示时延、usage 和 Tool 调用

- **WHEN** `AFTER_MODEL_RESULT` 事件的 `payload.boundary` 包含 `firstContentLatencyMs=120`、`modelE2ELatencyMs=450`、一个 usage 对象和一个 Tool 调用对象
- **THEN** 该事件节点 MUST 按固定顺序显示 `firstContentLatencyMs`、`modelE2ELatencyMs`、`usage`、`toolCalls`
- **AND** 两个时延值 MUST 分别显示为 `120 ms`、`450 ms`
- **AND** usage 与 Tool 调用 MUST 分别显示完整 JSON 文本

#### Scenario: 能力调用前展示目标 Capability

- **WHEN** `BEFORE_CAPABILITY_INVOKE` 事件的 `payload.boundary.capabilityId` 为 `Bash`
- **THEN** 该事件节点 MUST 显示指标名称 `capabilityId` 和值 `Bash`

#### Scenario: 核心指标路径缺失

- **WHEN** 上述三个 stage 中任一事件缺少一个或多个映射路径
- **THEN** 该事件节点 MUST 为每个缺失字段显示对应指标名称和值“不可用”
- **AND** 同一 stage 中其他存在的指标 MUST 继续显示完整值

### Requirement: 单行错误只降级当前记录

空白行 MUST 被忽略且不计为错误。这里的 JSON object 指既非 `null` 也非 array 的 JSON 对象。对于 JSON 语法无效、解析结果不是 JSON object、顶层 `sessionId` 不是非空字符串或顶层 `requestId` 不是非空字符串的任一非空行，查看器 MUST 忽略该行并报告其原始文件行号和稳定原因 `INVALID_JSON`、`NOT_OBJECT`、`MISSING_SESSION_ID` 或 `MISSING_REQUEST_ID` 中恰好一个；原因选择 MUST 按前述检查顺序采用首个匹配项。一个非法行 MUST NOT 阻止其他合法行形成轨迹。若文件不包含合法轨迹事件，查看器 MUST 显示无可用轨迹状态和全部已识别问题的数量。

**需求类别**：系统质量属性

- **质量属性**：可靠性/恢复
- **适用范围**：该 Function

#### Scenario: 合法记录与损坏记录混合导入

- **WHEN** 文件同时包含合法轨迹事件、JSON 语法无效行和缺少 `requestId` 的 object 行
- **THEN** 查看器 MUST 呈现合法轨迹
- **AND** 查看器 MUST 分别报告两个非法行的行号及 `INVALID_JSON`、`MISSING_REQUEST_ID`

#### Scenario: 文件没有合法轨迹事件

- **WHEN** 文件中的全部非空行均不符合轨迹事件条件
- **THEN** 查看器 MUST 显示无可用轨迹状态
- **AND** 查看器 MUST 显示已识别问题的总数

### Requirement: 查看过程保持本地只读边界

查看器 MUST 能够作为单个本地 HTML 文件直接打开并完成导入与呈现，MUST NOT 依赖正在运行的 NextAgent 服务、外部脚本、外部样式或外部字体。查看器 MUST 只在当前页面内存中处理使用者选择的文件；它 MUST NOT 发起网络请求，MUST NOT 把导入内容写入浏览器持久存储，且 MUST NOT 修改所选文件。重新加载或关闭页面后，先前导入内容 MUST 不再可见。

**需求类别**：系统质量属性

- **质量属性**：安全
- **适用范围**：该 Function

#### Scenario: 离线打开查看器

- **WHEN** 使用者在没有 NextAgent 服务和网络连接的环境中直接打开查看器并选择合法 NDJSON
- **THEN** 查看器 MUST 完成轨迹列表和事件流程呈现

#### Scenario: 导入内容不离开页面内存

- **WHEN** 使用者导入包含原始调测内容的 NDJSON
- **THEN** 查看器 MUST NOT 因导入、切换轨迹或展开节点而发起网络请求
- **AND** 查看器 MUST NOT 将导入内容写入浏览器持久存储

### Requirement: 查看器作为本地运行包的插件伴随文件交付

本地运行包包含官方 `developer-hook-trace` 插件时，其插件目录 MUST 在 `plugin.json` 和 `index.js` 的同级位置包含 `trace-viewer.html`。该 HTML MUST 可独立打开；`developer-hook-trace` 实现、artifact helper、`plugin.json` 的字段和 `main` 指向 MUST 保持不变，插件 loader MUST NOT 读取或执行 `trace-viewer.html`。

**需求类别**：功能性需求

#### Scenario: 打包官方调测插件及伴随查看器

- **WHEN** 开发者生成包含 `developer-hook-trace` 插件的本地运行包
- **THEN** 运行包的目标插件目录 MUST 包含 `plugin.json`、`index.js` 和 `trace-viewer.html`
- **AND** `plugin.json` MUST 继续以 `index.js` 为唯一插件主入口

#### Scenario: 装载带查看器的插件

- **WHEN** NextAgent 装载同级存在 `trace-viewer.html` 的官方调测插件产物
- **THEN** 插件 loader MUST 只按既有 manifest 和 `index.js` 装载插件
- **AND** 查看器文件 MUST NOT 获得插件 host API 或运行时权限

