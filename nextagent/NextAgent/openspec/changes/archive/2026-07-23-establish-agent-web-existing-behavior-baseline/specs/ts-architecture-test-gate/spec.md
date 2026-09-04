## MODIFIED Requirements

### Requirement: ui-interaction-test-behavior-contracts

NextAgent TS 后端与配套 Web UI MUST 以用户可观察行为验证 submit/stream、Pending Input、断连恢复、Session List、Composer 草稿和主题样式。测试 SHALL 断言公共 contract、可访问角色或稳定用户结果，SHALL NOT 将具体 test id、未定义的 browser-storage key 或“已知失败”文字作为长期产品契约。

#### Scenario: Web UI 提交消息并渲染 stream 回复
- **WHEN** 用户在 Composer 输入非空文本并提交，后端接受并持续推送事件
- **THEN** Composer SHALL 按成功提交语义清空
- **AND** turn SHALL 先呈现执行中状态，再随 stream 收敛为 assistant 内容和终态状态

#### Scenario: Web UI Pending Input 可响应
- **WHEN** request 进入需要用户授权或输入的 pending-input 状态
- **THEN** Web UI SHALL 呈现对应的可操作响应面
- **AND** 用户响应后 request SHALL 继续通过 canonical lifecycle 推进

#### Scenario: Stream 断连重连保留可见内容
- **WHEN** stream 断连并发生重连或 history 恢复
- **THEN** Web UI SHALL 呈现连接状态或降级反馈
- **AND** SHALL NOT 使已接受 request 静默变成空白内容

#### Scenario: Session List 展开偏好跨组件重建恢复
- **GIVEN** 用户切换了 Session List 的展开或收起状态
- **WHEN** Sidebar 在同一 browser session 内重建
- **THEN** Web UI SHALL 恢复该偏好
- **AND** SHALL 使用与恢复状态一致的 session 获取窗口

#### Scenario: Composer 草稿按 session 隔离恢复
- **GIVEN** 不同 session 存在不同 Composer 草稿
- **WHEN** 用户在这些 session 间切换
- **THEN** Web UI SHALL 保存离开 session 的草稿并恢复目标 session 的草稿
- **AND** SHALL NOT 依赖规格中固定某个 storage key 名称

#### Scenario: 主题切换同步 scrollbar 语义
- **WHEN** local 入口选择 light、dark 或 system 主题，或 host 入口切换 lightday/evening
- **THEN** Web UI SHALL 更新根主题状态
- **AND** 使用主题 scrollbar 类的区域 SHALL 通过主题变量呈现相应 thumb 和 hover 颜色
