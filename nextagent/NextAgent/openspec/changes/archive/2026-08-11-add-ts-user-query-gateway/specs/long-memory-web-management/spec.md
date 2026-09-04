## Function

- **所属 Function**：`FN-8.15 管理长期记忆`
- **Function 变更类型**：`MODIFIED`
- **spec 角色**：主规格

## ADDED Requirements

### Requirement: 共享知识展示发布者用户名

共享知识管理结果的每个条目 MUST 保留 required `ownerUserId`，并 MUST 允许返回 optional `ownerUserName`。`ownerUserId` MUST 继续表示共享记忆事实中的稳定 `ownerSubjectId`；`ownerUserName` 只用于展示，MUST NOT 取代身份关联、授权判断或共享记忆 owner scope。`ownerUserName` 存在时 MUST 是对应 `ownerUserId` 的 1..256 个 Unicode code point 的非空用户名；Web response MUST 拒绝其它新增用户属性。

系统 MUST 使用当前可信调用者的 `tenantId` 和 `subjectId` 作为用户查询授权上下文，并 MUST 只查询本次共享知识页面实际包含的发布者标识。系统 MUST 对同一页面的重复发布者标识去重，并 MUST 把当前请求的 `AbortSignal` 传递给用户查询。用户查询成功且返回对应用户时，management result MUST 设置 `ownerUserName`；用户查询返回普通 `SafeError` 或省略某个用户时，共享知识内容 MUST 继续返回，并 MUST 对受影响条目省略 `ownerUserName`。用户查询返回 category 为 `CANCELED` 的 `SafeError` 时，management operation MUST 返回取消结果，MUST NOT 把取消转换为成功页面。

共享知识列表和详情 MUST 优先显示非空 `ownerUserName`；字段缺失时 MUST 显示 `ownerUserId`。LOCAL 默认部署下，每个条目 MUST 显示 `${ownerUserId}-name`。用户查询失败、结果缺失和展示回退 MUST NOT 改变共享知识页面的内容、总数、分页、排序、发布、撤销发布或复制语义，也 MUST NOT 向 Web response 暴露用户查询的原始错误。

**需求类别**：功能性需求

#### Scenario: LOCAL 共享知识显示默认用户名

- **GIVEN** LOCAL 默认用户查询 Gateway 可用
- **WHEN** 共享知识页面包含发布者 `publisher-a`
- **THEN** management result MUST 同时包含 `ownerUserId=publisher-a` 和 `ownerUserName=publisher-a-name`
- **AND** 列表与详情 MUST 显示 `publisher-a-name`

#### Scenario: 同一页面批量解析发布者

- **GIVEN** 共享知识页面包含多个条目且部分条目具有相同 `ownerUserId`
- **WHEN** 系统解析发布者用户名
- **THEN** 用户查询输入 MUST 只包含该页面去重后的发布者标识
- **AND** 每个已解析条目 MUST 获得与其 `ownerUserId` 对应的 `ownerUserName`

#### Scenario: 单个发布者未解析时回退标识

- **WHEN** 用户查询结果省略某个页面发布者
- **THEN** 对应共享知识条目 MUST 保留 `ownerUserId` 并省略 `ownerUserName`
- **AND** 列表与详情 MUST 显示 `ownerUserId`
- **AND** 其它已解析条目 MUST 继续显示各自用户名

#### Scenario: 用户查询普通失败不阻断共享知识

- **WHEN** 用户查询返回 category 不为 `CANCELED` 的 `SafeError`
- **THEN** 共享知识 management operation MUST 返回原有页面内容和分页信息
- **AND** 全部受影响条目 MUST 省略 `ownerUserName` 并显示 `ownerUserId`
- **AND** Web response MUST NOT 包含原始用户查询错误

#### Scenario: 用户查询取消终止管理请求

- **WHEN** 用户查询返回 category 为 `CANCELED` 的 `SafeError`
- **THEN** management operation MUST 返回取消结果
- **AND** MUST NOT 返回部分补充用户名的成功页面

#### Scenario: 空共享知识页面不查询用户

- **WHEN** 共享知识页面不包含条目
- **THEN** 系统 MUST 返回原有空页面和分页信息
- **AND** MUST NOT 发起空目标集合的用户查询

## Function 变更汇总

### 输出

- **变更类型**：修改
- **目标内容**：共享知识管理结果保留 required 发布者用户标识，并为已解析发布者提供 optional 用户名。
- **依据 Requirements**：`共享知识展示发布者用户名`

### 处理过程

- **变更类型**：修改
- **目标内容**：系统为当前共享知识页面解析去重后的发布者用户名；普通查询失败或用户缺失时保持内容可用并回退稳定标识，取消时终止当前管理请求。
- **依据 Requirements**：`共享知识展示发布者用户名`

### 结果

- **变更类型**：修改
- **目标内容**：列表和详情优先显示发布者用户名，缺失时显示稳定用户标识；共享知识内容、分页和共享操作语义不变。
- **依据 Requirements**：`共享知识展示发布者用户名`

### 规格

- **规格项**：共享知识发布者展示
- **变更类型**：新增
- **原规格值**：不适用（新增）
- **目标规格值**：用户名可用时显示用户名，查询失败或缺失时显示稳定用户标识；LOCAL 默认用户名为 `${ownerUserId}-name`
- **依据 Requirements**：`共享知识展示发布者用户名`
