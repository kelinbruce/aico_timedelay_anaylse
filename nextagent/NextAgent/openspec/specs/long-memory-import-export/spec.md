# long-memory-import-export Specification

## Purpose

定义长期记忆管理界面的固定 JSON 模板导入、写入前预览与容量反馈、单批幂等提交、失败恢复，以及当前个人记忆筛选结果的本地化安全 CSV 导出。

## Function

- **所属 Function**：`FN-8.14 导入和导出长期记忆`
- **Function 变更类型**：`ADDED`
- **spec 角色**：主规格
## Requirements
### Requirement: 记忆导入必须使用固定 JSON 模板

长期记忆管理界面的导入 MUST 仅接受 UTF-8 `.json` 文件，并 MUST 拒绝 `.xlsx`、`.xls`、`.csv` 和其它扩展名。文件顶层 MUST 接受记忆数组，或只包含可选 `_instructions` 和必填 `memories` 的模板对象；模板对象的 `_instructions` MUST NOT 产生记忆或 batch 字段，实际记录 MUST 只取自 `memories` 数组。文件作者 MAY 为每个记忆元素提供 `memoryType`、`labels`、`confidence`；未提供时仍为合法输入，并按下述默认值投影。每个记忆元素 MUST 包含两个必需字符串字段 `briefIndex` 和 `content`。`memoryType`、`labels`、`confidence` 被省略、为 JSON `null` 或为空白字符串时 MUST 分别默认投影为 `USER_CHARACTERISTICS`、空标签数组和 `1`；显式空标签数组 MUST 保持为空。每条导入记录 MUST 固定投影为 `knowledgeSourceType = CONFIGURED` 和 `state = ACTIVE`。

页面 MUST 提供“下载导入模板”操作，并下载文件名 `nextagent-memory-import-template.json` 的 UTF-8 JSON 文件。模板顶层 MUST 是包含 `_instructions` 和 `memories` 的对象。`_instructions` MUST 在其它字段说明之前以 `memoryTypeDescriptions` 分别解释 `FACTUAL`、`CONCEPTUAL`、`PROCEDURAL`、`USER_CHARACTERISTICS`：其语义分别为安全的环境、配置、约束、版本、SLA 或拓扑事实，业务或电信领域概念、定义、别名或关系，可复用流程知识，以及具有明确适配目的的低敏感度工作流、语言、术语或偏好特征；其后 MUST 说明必填字段、可选字段、空值默认、标签与置信度边界、单次和总量限制以及“只编辑 `memories`”的操作提示。`memories` MUST 恰好包含四条电信运维示例，并 MUST 为每种 `memoryType` 各提供一条。模板说明和示例 MUST 跟随用户点击下载时的当前界面语言输出中文或英文；JSON 字段名与枚举值 MUST 保持 API contract 的英文标识。模板下载 MUST NOT 调用长期记忆 API，也 MUST NOT 包含 scope、记忆标识或其它服务端字段。

**需求类别**：功能性需求

#### Scenario: 下载固定导入模板
- **WHEN** 用户点击“下载导入模板”
- **THEN** 浏览器下载 `nextagent-memory-import-template.json`
- **AND** 文件顶层对象包含用户说明 `_instructions` 和可直接导入的 `memories`
- **AND** `_instructions.memoryTypeDescriptions` 在其它使用说明之前解释四种记忆类型
- **AND** `memories` 中四个示例元素使用 `briefIndex`/`content`，并依次覆盖 `FACTUAL`、`CONCEPTUAL`、`PROCEDURAL`、`USER_CHARACTERISTICS`
- **AND** 模板展示 `memoryType`、`labels`、`confidence` 的可配置格式

#### Scenario: 模板跟随当前界面语言
- **WHEN** 用户在中文界面下载导入模板
- **THEN** 四类解释、字段提示和四条例子使用中文
- **WHEN** 用户切换到英文界面后下载导入模板
- **THEN** 四类解释、字段提示和四条例子使用英文
- **AND** 两种模板使用相同的 JSON 字段名、枚举值、校验边界和默认值

#### Scenario: 拒绝非 JSON 文件
- **WHEN** 用户选择 `.xlsx`、`.xls`、`.csv` 或其它非 `.json` 文件
- **THEN** 页面显示仅支持 JSON 的文件格式错误
- **AND** 不调用批量新增 API

### Requirement: 批量导入必须在不可信 JSON 边界完成前置校验

页面 MUST 只接受不超过 5 MiB 且包含 1 至 50 条记忆的 JSON 文件，并 MUST 使用 fatal UTF-8 解码。页面 MUST 在发送任何写请求前完成 JSON 语法、顶层纯数组或模板对象、元素 allowlist 和全部字段校验；每个元素 MUST 包含 `briefIndex`、`content`，且只可额外包含 `memoryType`、`labels`、`confidence`。`briefIndex` MUST 为去除首尾空白后非空且不超过 2048 个 Unicode code point 的字符串，`content` MUST 为去除首尾空白后非空且不超过 4000 个 Unicode code point 的字符串。非空 `memoryType` MUST 是现有 `MemoryType` 枚举值；非空 `labels` MUST 是不超过 10 项的数组且每项是去除首尾空白后非空、不超过 256 个 Unicode code point 的字符串；非空 `confidence` MUST 是 0 至 1（含边界）的有限数值。任一元素不合法时 MUST 拒绝整个文件并显示首个错误元素的序号，且 MUST NOT 发出部分写请求。

导入文件 MUST NOT 指定 `memoryId`、owner scope、Agent Scope、`memoryInstance`、知识来源、状态、版本、访问统计、服务端时间、共享状态或其它字段。

**需求类别**：功能性需求

#### Scenario: 文件条目数或字段越界时拒绝
- **WHEN** 用户选择大于 5 MiB、空数组、超过 50 条、包含非法 JSON、空白 `briefIndex`、空白 `content` 或任一字段类型、枚举、数量、长度、数值越界的文件
- **THEN** 页面显示文件或对应元素的校验错误
- **AND** 不调用 `POST /api/v1/memory/long-term-mem/batch`

#### Scenario: 文件不能增加权威字段
- **WHEN** 任一导入元素除了五个 allowlist 字段外还包含 `memoryId`、`tenantId`、`agentId`、`knowledgeSourceType`、`state` 或其它字段
- **THEN** 页面拒绝整个文件
- **AND** 不调用批量新增 API

### Requirement: 上传后必须预览、删除并确认导入

合法 JSON 解析完成后，页面 MUST 打开待导入预览，显示文件名、当前待导入数量以及每项摘要、正文、解析后的记忆类型、标签和置信度，且在用户点击确认前 MUST NOT 调用批量新增 API。用户 MUST 能删除任一待导入项；删除只修改浏览器 transient view state，不修改源文件或服务端记忆。待导入列表为空时确认操作 MUST 禁用，并 MUST 在当前预览中提供重新选择 JSON 文件的操作；合法新文件 MUST 替换空预览且无需用户先取消，重复选择同名文件 MUST 正常触发解析。用户取消预览时 MUST 清除待导入状态且不产生写请求。

每个预览项 MUST 将摘要、记忆类型、标签和置信度排列在同一个紧凑标题行。摘要和正文的字号 MUST 为 14 CSS px。记忆类型 MUST 复用记忆列表的类型 chip 颜色，且 MUST 完整显示类型名称；标签 MUST 在单个 chip 内直接显示按当前语言连接的标签列表，不显示“标签：”或 `Labels:` 前缀；置信度 MUST 只显示整数百分比，不显示进度条或“置信度”文字。记忆类型、标签和置信度的字号 MUST 为 12 CSS px。视口宽度允许时，确认导入弹框 MUST 使用 880 CSS px 的目标宽度；视口不足时 MUST 收缩到可用宽度。标题行 MUST 优先为摘要保留显示空间；标签超出其可用宽度时 MUST 以省略号隐藏。摘要和标签因可用宽度不足而省略时 MUST 通过元素 `title` 保留完整文本。正文 MUST 位于标题行下方，最多显示两行，完整正文 MUST 保留在元素 `title`。每条预览右上角 MUST 提供小型删除按钮，且 MUST NOT 在卡片内容右侧保留大型文字删除按钮。

页面 MUST 在预览期间读取当前可信 Owner Scope、Agent Scope 和默认记忆实例中 `knowledgeSourceType = CONFIGURED` 的 ACTIVE 与 ARCHIVED 总数，并将两者之和作为已有个人设定记忆数 `X`。`LEARNED` 等非 `CONFIGURED` 记忆 MUST NOT 计入 `X`。页面 MUST 显示“个人导入记忆限制50条，已有 X 条，可导入 Y 条。”，其中 `Y = max(0, 50 - X)`。该提示 MUST NOT 包含待导入数量、超额数量、删除待导入项或现有记忆的引导，也 MUST NOT 承诺相同文件跨批次去重。容量读取是客户端反馈；读取失败时页面 MUST 显示安全错误，但 MUST NOT 因客户端容量反馈缺失而替代服务端最终裁决或永久禁用确认。服务端 50 条容量门禁和安全准入仍为最终权威判断。

**需求类别**：功能性需求

#### Scenario: 上传后只显示预览
- **WHEN** 用户选择包含五条合法记录的 JSON 文件
- **THEN** 页面显示这五条记录的摘要、正文、记忆类型、标签与置信度
- **AND** 页面在用户确认前不调用批量新增 API

#### Scenario: 预览项使用紧凑详情样式
- **WHEN** 待导入记录包含摘要、记忆类型、标签和置信度
- **THEN** 页面在同一个标题行展示这四项信息
- **AND** 记忆类型使用与记忆列表一致的有色 chip 并完整显示类型名称
- **AND** 标签 chip 不显示字段名前缀，置信度只显示百分比
- **AND** 摘要和正文使用 14 CSS px 字号
- **AND** 记忆类型、标签和置信度使用 12 CSS px 字号
- **AND** 正文在下一行最多显示两行
- **AND** 被省略的摘要、标签和正文可通过元素 `title` 查看完整文本

#### Scenario: 中文界面统一显示个性化配置
- **WHEN** 中文记忆管理界面呈现 `USER_CHARACTERISTICS` 类型
- **THEN** 筛选项、记忆卡片、详情、编辑和导入预览统一显示“个性化配置”
- **AND** 中文 CSV 导出同样显示“个性化配置”
- **AND** API 枚举值仍保持 `USER_CHARACTERISTICS`

#### Scenario: 删除入口位于卡片右上角
- **WHEN** 页面显示待导入记录
- **THEN** 每条记录右上角显示小型删除按钮
- **AND** 卡片内容右侧不显示大型文字删除按钮

#### Scenario: 显示个人可导入数量
- **GIVEN** ACTIVE 的 `CONFIGURED` 总数为 34、ARCHIVED 的 `CONFIGURED` 总数为 4，并存在任意数量的 `LEARNED` 记忆
- **WHEN** 页面完成容量读取
- **THEN** 列表上方显示“个人导入记忆限制50条，已有 38 条，可导入12条。”
- **AND** 提示不包含待导入数量或删除引导

#### Scenario: 已有数量达到或超过限制
- **GIVEN** 已有个人记忆数不小于 50
- **WHEN** 页面完成容量读取
- **THEN** 页面显示可导入 0 条
- **AND** 可导入数不得显示为负数

#### Scenario: 容量反馈读取失败
- **WHEN** 页面无法读取 ACTIVE 或 ARCHIVED 状态的 `CONFIGURED` 总数
- **THEN** 页面显示本地化的容量读取失败反馈
- **AND** 页面不把该客户端失败表述为服务端拒绝
- **AND** 用户确认后仍由服务端容量和安全准入作最终裁决

#### Scenario: 多标签不挤占摘要空间
- **GIVEN** 待导入记录包含多个长标签
- **WHEN** 页面以足够容纳目标宽度的视口打开确认导入弹框
- **THEN** 弹框目标宽度为 880 CSS px
- **AND** 摘要获得的标题行可用宽度大于标签 chip 的最大可用宽度
- **AND** 标签保持单行并在超出可用宽度时显示省略号
- **AND** 标签 chip 的 `title` 保留完整标签文本

#### Scenario: 删除待导入项
- **GIVEN** 预览中包含五条记录
- **WHEN** 用户删除 `age/28`
- **THEN** 预览只保留其余四条
- **AND** 确认导入时请求只包含其余四条

#### Scenario: 清空预览后重新选择文件
- **GIVEN** 用户删除了当前预览中的全部待导入记录
- **WHEN** 用户在当前预览中点击“重新选择文件”并选择合法 JSON 文件
- **THEN** 页面使用新文件内容替换空预览
- **AND** 用户无需先取消预览
- **AND** 即使新文件与先前文件同名也会重新解析
- **AND** 页面在用户确认前不调用批量新增 API

### Requirement: 确认导入必须调用批量新增接口

用户点击确认后，页面 MUST 只调用一次 `POST /api/v1/memory/long-term-mem/batch`，请求包含当前预览中按原文件顺序保留的 1 至 50 个条目。每次文件成功解析并成为新的待导入预览时，页面 MUST 创建新的随机导入批次标识；每条请求 MUST 使用 JSON 契约版本、该批次标识和原文件元素序号生成幂等键。删除前序元素 MUST NOT 改变其余元素在当前批次中的幂等键。重新选择字节完全相同或同名的文件 MUST 建立新批次并使用不同幂等键，因此该主动操作 MAY 再次新增记录。导入期间 MUST 禁用模板下载、文件选择、导出、确认、删除及现有写操作。

若该 batch 发生网络中断、HTTP 5xx 或成功响应结构错误而无法确认写入结果，页面 MUST 保留未改变的待导入集合、当前批次标识和结果未知状态。用户对该未改变集合执行精确重试时，页面 MUST 提交与首次请求相同的幂等键，因为服务端可能已为这些键创建记忆；用户删除任一待导入项后，剩余条目仍 MUST 使用当前批次及各自原文件序号。若服务端明确返回 HTTP 4xx，页面 MUST 保留待导入集合但 MUST NOT 标记结果未知或声称记录可能已写入；HTTP 404 MUST 提示当前后端未提供批量导入接口，要求同步并重启后端后再试。无论是否精确重试，服务端容量、幂等和安全准入始终是最终权威。

服务端 MUST 继续对每条记录执行 runtime schema validation、内容安全护栏、当前可信 Owner Scope 与 Agent Scope 注入、ACTIVE 与 ARCHIVED 合计 50 条个人设定记忆容量限制和持久化幂等。页面 MUST NOT 把客户端容量反馈或字段校验视为服务端准入结果。

**需求类别**：功能性需求

#### Scenario: 确认后提交当前预览
- **GIVEN** JSON 原有五条合法记录且用户删除了第二条
- **WHEN** 用户点击确认导入
- **THEN** 页面调用一次批量新增 API 并提交四条记录
- **AND** 四条记录保持原文件顺序
- **AND** 幂等键使用当前批次标识和原文件元素序号 `0`、`2`、`3`、`4`

#### Scenario: 重新选择相同文件建立新批次
- **GIVEN** 一个文件已完成一次明确成功的导入
- **WHEN** 用户再次选择字节完全相同的文件并确认导入
- **THEN** 页面为第二次选择使用新的批次标识
- **AND** 第二次请求的条目幂等键与第一次不同
- **AND** 页面不承诺相同文件中的记录不会重复新增

#### Scenario: 结果未知时原样重试
- **GIVEN** 当前批次请求因网络中断而结果未知
- **WHEN** 用户未修改预览并点击重试
- **THEN** 页面复用当前批次标识和原文件元素序号
- **AND** 重试请求中的条目及幂等键与结果未知的请求一致

#### Scenario: 服务端容量和安全限制仍然生效
- **WHEN** 文件条目通过浏览器校验但被服务端容量限制或内容安全护栏拒绝
- **THEN** 页面按批量响应统计该条目为失败
- **AND** 页面不得绕过、重写或隐藏服务端准入结果

#### Scenario: 后端未同步批量接口
- **WHEN** 批量新增请求明确返回 HTTP 404
- **THEN** 页面保留当前待导入列表并提示后端未同步批量导入接口
- **AND** 页面不显示“记录可能已写入”或结果未知重试状态

### Requirement: 导入结果必须准确报告部分成功和中断进度

页面 MUST 使用单次 batch 响应的 `successCount` 与 `failCount` 分别显示成功处理数和失败数；页面 MUST NOT 将 `successCount` 表述为新增记忆数，因为该计数同时包含首次创建和当前批次内的幂等命中。成功和部分成功提示 MUST NOT 承诺相同文件跨批次不会重复新增。存在成功处理条目时 MUST 刷新“我的记忆”列表及活动数量。若请求发生网络中断、HTTP 5xx 或响应结构错误，页面 MUST 把当前待导入集合显示为结果未知；MUST NOT 自动重试，也 MUST NOT 把结果未知条目计为失败。明确的 HTTP 4xx MUST 作为未提交成功的请求错误展示，并 MUST NOT 进入结果未知状态。用户对结果未知且保留的相同集合执行精确重试时 MUST 复用当前批次的幂等键，以安全确认或恢复该请求。

**需求类别**：功能性需求

#### Scenario: 单批部分成功
- **GIVEN** 确认请求包含 40 条记录
- **WHEN** 批量接口返回 `successCount = 35` 和 `failCount = 5`
- **THEN** 页面显示成功处理 35 条、失败 5 条
- **AND** 页面不显示相同文件不会重复新增的承诺
- **AND** 页面刷新个人记忆列表和容量状态

#### Scenario: 整批请求结果未知
- **GIVEN** 确认请求包含 20 条记录
- **WHEN** 批量请求发生网络错误
- **THEN** 页面显示当前 20 条结果未知
- **AND** 页面不得把这些条目计为失败或自动重试

#### Scenario: 导入期间防止重复操作
- **WHEN** 导入 batch 尚未完成
- **THEN** 导入和导出按钮均处于禁用状态
- **AND** 用户不能开始第二个文件操作

### Requirement: 筛选导出必须安全读取当前个人记忆结果

“导出我的记忆” MUST 在“我的记忆”中固定 `state = ACTIVE`，“导出归档的记忆” MUST 在“已归档”中固定 `state = ARCHIVED`；两个操作 MUST 使用当前可信 Owner Scope、Agent Scope 和默认记忆实例。请求 MUST 携带当前合法的搜索词 `queryText`、记忆类型 `memoryType`、记忆来源 `knowledgeSourceType` 和更新方式 `isPinned`，但 MUST 不携带当前页码；系统 MUST 以 `limit = 100`、`offset = 0` 开始读取，直至累计条目数达到筛选结果的 `total`。共享记忆库 MUST 不呈现个人记忆导出操作，导出 MUST 不调用共享记忆库 API，也 MUST NOT 导出 `SHARED` 记录。

导出 MUST 生成带 UTF-8 BOM 的 CSV。点击导出时的当前界面语言 MUST 决定列头以及记忆类型、记忆来源和状态的显示值；中文界面 MUST 输出中文，英文界面 MUST 输出英文。固定列 MUST 依次包含记忆类型、摘要、正文、置信度、记忆来源、状态、更新时间和 `label1..label10` 的本地化列头；更新时间 MUST 使用当前 locale 的日期时间格式。每个字段 MUST 按 CSV 规则转义，标签 MUST 分别投影到 10 个标签列。文件 MUST NOT 包含 owner/agent scope、`memoryInstance`、`memoryId`、`sharingState`、来源记忆标识、版本、访问统计或内部来源数据。

CSV 注入防护 MUST 应用于所有单元格。检测 MUST 在不改变原始输出值的 NFKC 规范化视图上进行，并 MUST 跳过可被表格程序忽略的前导空白、C0/C1 控制字符以及字面 `/u0000`、`\\u0000` 标记；若首个有效字符是半角或全角 `= - + @`，输出值 MUST 增加文本前缀以阻止公式、命令或超链接执行。下载文件名 MUST 使用 `nextagent-memories-YYYYMMDD-HHmmss.csv`。导出任一分页失败时 MUST 不生成下载文件，并显示错误。

导出成功后，页面 MUST 使用实际写入 CSV 的记录数显示当前 Tab 专属提示：“我的记忆”显示已导出 N 条我的记忆，“已归档”显示已导出 N 条已归档的记忆。

**需求类别**：功能性需求

#### Scenario: 导出我的记忆
- **GIVEN** 用户位于“我的记忆”Tab
- **WHEN** 用户点击“导出我的记忆”并成功生成包含 N 条记录的文件
- **THEN** 页面从 `state=ACTIVE`、`offset=0` 开始读取当前完整筛选结果
- **AND** 成功提示说明已导出 N 条我的记忆

#### Scenario: 导出已归档记忆
- **GIVEN** 用户在“已归档”Tab 搜索 `BGP`、选择记忆类型并位于第二页
- **WHEN** 用户点击“导出归档的记忆”并成功生成包含 N 条记录的文件
- **THEN** 页面以 `state=ARCHIVED`、当前 `queryText` 和记忆类型从 offset 0 开始读取
- **AND** 导出请求不包含当前页码
- **AND** 文件包含该筛选条件下所有分页的个人记忆且不包含 ACTIVE 记录
- **AND** 成功提示说明已导出 N 条已归档的记忆

#### Scenario: 导出超过一页的筛选结果
- **GIVEN** 当前 ACTIVE 筛选结果共有 150 条
- **WHEN** 用户导出筛选结果
- **THEN** 页面读取 offset 0 和 100 两页
- **AND** 下载文件包含 150 条记忆

#### Scenario: 中文导出包含完整本地化列
- **WHEN** 用户在中文界面导出包含 `FACTUAL`、`CONFIGURED`、`ACTIVE` 记录的筛选结果
- **THEN** CSV 使用“记忆类型、摘要、正文、置信度、记忆来源、状态、更新时间、标签1..标签10”列头
- **AND** 对应枚举显示为“事实记忆、用户设定、有效”
- **AND** 文件包含该记录的更新时间

#### Scenario: 公式注入载荷作为文本导出
- **WHEN** 任一导出字段以半角或全角 `= - + @` 开始，或在前导空白、控制字符、`/u0000`、`\\u0000` 后出现这些字符
- **THEN** CSV 单元格增加文本前缀
- **AND** Excel 或兼容表格程序不得把该单元格作为公式、命令或超链接执行
- **AND** 输出仍保留原始字段内容

#### Scenario: 排除共享记忆库
- **WHEN** 当前用户浏览共享记忆库中的 SHARED 记录
- **THEN** 页面不显示个人记忆导出操作
- **AND** 页面不调用共享记忆库列表 API 执行导出

#### Scenario: 分页失败不产生不完整文件
- **WHEN** ACTIVE 或 ARCHIVED 的任一分页读取失败
- **THEN** 页面显示导出失败
- **AND** 不触发文件下载
