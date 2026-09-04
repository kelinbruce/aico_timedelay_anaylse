## MODIFIED Requirements

### Requirement: Frontend 本地视图状态 MUST 保持视觉与导航上的稳定

Frontend MUST 对 chat viewport 和 sidebar session-list viewport 应用相同的主题化滚动条处理。在深色主题下，保留的滚动条 gutter 和轨道区域 MUST 使用主题化的页面背景，MUST NOT 回退到浅色的浏览器默认轨道。

Sidebar session-list 的展开/折叠状态 MUST 存储为 sessionStorage 支持的本地 UI 偏好。当该偏好在同一浏览器标签页刷新后被恢复为展开时，session-list 刷新入口点 MUST 保留展开的历史数据窗口，而不是折叠回最近 session 的页大小。这包括挂载时的刷新以及稍后重新加载 session 历史而无显式分页的 request-control 或 stream 恢复刷新。

普通模式的 Composer 草稿 MUST 在浏览器标签页存活期间按路由隔离：每个 session MUST 拥有自己的草稿，pre-session 根路由 MUST 拥有单独的草稿。切换路由 MUST 保存离开中的普通草稿并恢复目标路由草稿，且在 hydration 完成之前 MUST NOT 把离开中的文本暴露为目标路由草稿。不可用的浏览器会话存储 MUST NOT 阻碍当前页面生命周期内的编辑。成功的普通提交 MUST 清空已提交路由的草稿，而失败的普通提交 MUST 保留它。编辑模式的替换文本和活动的 pending-input 回答 MUST NOT 覆盖普通路由草稿。包括精确 `/edit` 命令消费在内的入口路径特定编辑恢复，仍由 `request-edit-resubmit` 拥有，本需求不重新定义。

#### Scenario: Sidebar session list 使用与 chat 相同的主题化滚动条

- **WHEN** sidebar session list 展开且可滚动
- **THEN** 其滚动条 thumb、track、gutter 和深色模式 color-scheme SHOULD 与主 chat viewport 的滚动条处理匹配
- **AND** 该样式 MUST NOT 在滚动条变得可用或不可用时在任一 viewport 中引入水平内容位移

#### Scenario: 恢复为展开的 session list 请求展开的页大小

- **GIVEN** 用户此前展开了 sidebar session list
- **WHEN** frontend 再次加载
- **THEN** sidebar MUST 从 sessionStorage 恢复展开状态
- **AND** 挂载时的 session-list 刷新请求 MUST 使用展开的历史页大小
- **AND** 稍后不带分页的 session-list 刷新 MUST 保留当前展开的历史数据窗口
- **AND** 折叠 MUST 更新已存储的偏好，使下一次刷新回到最近 session 的页大小

#### Scenario: 所选 session 的 Composer 草稿被恢复

- **GIVEN** 用户在 session A 中输入了未发送的普通模式草稿
- **WHEN** 用户切换到 session B 后在同一浏览器标签页中返回 session A
- **THEN** Composer MUST 恢复 session A 的未发送草稿
- **AND** session B 的草稿 MUST 与 session A 的草稿保持隔离
- **AND** 从 session A 切换到 session B MUST NOT 在 session B 被 hydration 之前把 session A 当前可见的输入发布为 session B 的普通草稿
- **AND** 成功提交的草稿 MUST 为该 session 清空
- **AND** 编辑模式文本和 pending-input 回答文本 MUST NOT 被存储为普通 session 草稿

#### Scenario: Pre-session 根草稿保持独立

- **GIVEN** 用户在 pre-session 根路由上输入了未发送的普通模式草稿
- **WHEN** 用户进入一个 session 路由后在同一浏览器标签页中返回根路由
- **THEN** frontend MUST 恢复 pre-session 草稿
- **AND** MUST NOT 把它暴露为该 session 的普通草稿

#### Scenario: 存储失败不阻碍当前页面编辑

- **GIVEN** 浏览器会话存储不可用
- **WHEN** 用户编辑普通 Composer
- **THEN** Composer MUST 在当前页面生命周期内保持可用

#### Scenario: 失败的普通提交保留其草稿

- **GIVEN** 一个路由拥有非空的普通 Composer 草稿
- **WHEN** 普通提交在接受之前失败
- **THEN** frontend MUST 保留该路由的草稿以供修正或重试
