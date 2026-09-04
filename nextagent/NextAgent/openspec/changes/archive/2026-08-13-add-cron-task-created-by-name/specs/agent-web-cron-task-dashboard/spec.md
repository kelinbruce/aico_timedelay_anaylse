## Function

- **所属 Function**：`FN-10.9 Cron 工具`
- **Function 变更类型**：`MODIFIED`
- **spec 角色**：遗留规格

## MODIFIED Requirements

### Requirement: Cron task dashboard lists manageable tasks
Cron task dashboard SHALL 分为"任务"和"执行记录"两个 Tab。页面 MUST 具备与会话界面一致的整体布局：顶部 Header 左侧展示"定时任务管理"，右侧展示"手动创建"和 primary 风格的"通过会话创建"按钮，业务主体 MUST 使用与会话界面相同的最大宽度并居中显示。任务 Tab SHALL 加载并展示当前 trusted owner 与 active Agent 下可管理的 Cron tasks。页面 MUST 使用现有 Cron task management REST API，不得直接调用 Cron Tool、gateway、runtime command 或 stream event。任务 Tab MUST NOT 展示任务总数、当前页、执行记录三个指标块。任务 Tab MUST 以单列行式卡片展示 task；每张 task 卡片 MUST 使用 header、content、footer 结构，其中 header 左侧展示标题，header 右侧展示"执行"按钮、更多操作入口和表示是否开启的 switch，content 展示任务描述，footer 左侧展示时间和频率，footer 右侧展示创建该任务的用户名，footer 右侧 MUST 从 API 响应的 `createdByName` 字段读取用户名，当 `createdByName` 为 null 或缺失时 MUST 展示占位符 `-`，不得展示 `undefined`、`null` 或空字符串；"修改"和"删除"MUST 收纳在更多操作入口展开后的菜单中，同一时间 MUST NOT 有多个卡片菜单同时展开。

**需求类别**：功能性需求

#### Scenario: Dashboard renders task list
- **WHEN** 用户打开 Cron task dashboard route 且后端返回 task page
- **THEN** 页面 MUST 渲染单列行式 task 卡片列表
- **AND** 顶部 Header MUST 展示"定时任务管理"、"手动创建"和 primary 风格的"通过会话创建"
- **AND** 业务主体 MUST 按会话界面的最大宽度居中显示
- **AND** 每张卡片 MUST 以 header、content、footer 展示标题、描述、时间、频率、创建人、执行按钮、更多操作入口和开启 switch
- **AND** footer 右侧 MUST 从 `createdByName` 展示创建者名称，值为 null 时展示 `-`
- **AND** 任务 Tab MUST NOT 展示任务总数、当前页、执行记录三个指标块
- **AND** 页面 MUST NOT 同时展示独立"激活"按钮和开启 switch
- **AND** 用户 MUST 能直接点击"执行"进入该 task 的执行记录，并能通过更多操作菜单进入"修改"和"删除"
- **AND** 页面 MUST NOT 要求用户先进入或创建 chat session

#### Scenario: Dashboard handles unavailable service
- **WHEN** Cron task management API 返回 503 unavailable
- **THEN** 页面 MUST 显示可恢复错误状态
- **AND** 页面 MUST 提供重新加载入口

## Function 变更汇总

### 处理过程

- **变更类型**：修改
- **目标内容**：任务卡片 footer 右侧从 API 响应 `createdByName` 字段读取创建者名称并展示，值为 null 时展示占位符 `-`；多个卡片菜单同一时间只允许一个展开。
- **依据 Requirements**：`Cron task dashboard lists manageable tasks`

### 遗留规格

- **变更类型**：修改
- **目标内容**：`agent-web-cron-task-dashboard`
- **依据 Requirements**：`Cron task dashboard lists manageable tasks`
