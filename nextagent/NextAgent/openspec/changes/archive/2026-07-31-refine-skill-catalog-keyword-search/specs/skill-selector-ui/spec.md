## MODIFIED Requirements

### Requirement: Modal 搜索与分页加载

Modal 搜索输入框 SHALL 执行服务端关键字搜索，通过调用 `GET /api/v1/skills?keyword=xxx&pageNum=1&pageSize=50` 实现。搜索输入 MUST 应用防抖机制，MUST NOT 在每次按键时都发起 API 请求。搜索输入 MUST 限制关键字最大长度，超过服务端接受上限时 MUST NOT 发起 API 请求。Skill 列表 SHALL 以每页 50 条的方式分页加载。当用户滚动到列表底部时，前端 MUST 请求下一页并将结果追加到现有列表。当搜索关键字变化时，前端 MUST 重置到第 1 页并清空之前的列表结果。分页加载和搜索 MUST NOT 在列表中产生重复的 Skill。

#### Scenario: 搜索输入防抖
- **WHEN** 用户在搜索框中连续输入文字
- **THEN** 前端 MUST 在用户停止输入一段时间（防抖延迟）后才发起 API 请求
- **AND** 前端 MUST NOT 对每次按键都发起 API 请求

#### Scenario: 超长关键字不发起请求
- **WHEN** 用户输入或粘贴的关键字长度超过服务端接受上限
- **THEN** 前端 MUST NOT 发起包含该关键字的 API 请求
- **AND** 搜索输入框 MUST 阻止超过上限的字符进入输入内容

#### Scenario: 无限滚动加载下一页
- **WHEN** 用户滚动到 Skill 列表底部
- **AND** 当前已加载的 Skill 数量小于 `total`
- **THEN** 前端 MUST 请求下一页（`pageNum` 递增）
- **AND** 新加载的 Skill MUST 追加到现有列表末尾
- **AND** 列表中 MUST NOT 出现重复的 Skill

#### Scenario: 搜索关键字变化重置列表
- **WHEN** 用户修改搜索框中的关键字
- **THEN** 前端 MUST 清空当前列表
- **AND** 前端 MUST 从第 1 页开始重新查询
- **AND** `pageNum` MUST 重置为 1

#### Scenario: 所有 Skill 已加载
- **WHEN** 已加载的 Skill 数量等于 `total`
- **THEN** 前端 MUST NOT 发起额外的分页请求
- **AND** 滚动到底部时 MUST NOT 触发加载
