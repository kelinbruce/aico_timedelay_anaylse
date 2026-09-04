## ADDED Requirements

### Requirement: 预览交互仅在显式导航后才驱动 process-history hydration

会话 preview rail MUST 将 preview 数据加载与 run event hydration 保持分离。悬停已加载 marker 或其 card 时 MUST 只使用 browser state 中已有的 bounded preview 响应。悬停未加载 placeholder MUST 保持无动作。任一悬停路径都 MUST NOT 查询 run event history 或改变主会话 viewport。

点击已加载的 marker/card，或点击解析为 marker 的未加载 placeholder，MUST 建立最新的 preview-navigation 目标。消息导航 MUST 在目标消息本地可用或 anchored message window 已加载后立即完成；它 MUST NOT 等待 run event history。在目标 turn 和 display run 已知后，frontend MUST 以最高的 process-history hydration 优先级选择该 run。

#### Scenario: 已加载 marker 悬停不查询 process history
- **GIVEN** 一个已加载的 preview marker 带有 bounded 的用户与回答 preview 文本
- **WHEN** 用户悬停该 marker 或移入其 card
- **THEN** frontend MUST 从已加载的 preview marker 渲染 card
- **AND** MUST NOT 查询 `GET /api/v1/sessions/:sessionId/runs/:runId/events`
- **AND** MUST NOT 改变主会话 viewport

#### Scenario: placeholder 悬停保持无动作
- **WHEN** 用户悬停一个未加载的 preview placeholder
- **THEN** frontend MUST NOT 请求该 placeholder 的 preview window
- **AND** MUST NOT 请求 run event history
- **AND** MUST NOT 显示 preview card

#### Scenario: preview 点击在 process history 完成前完成导航
- **GIVEN** 所选 preview 目标消息不在当前 message window 中
- **WHEN** 用户点击其已加载 marker 或 card
- **THEN** frontend MUST 加载 anchored message window，并在该消息加载成功后滚动到目标
- **AND** MUST NOT 在等待 run event history 期间延迟滚动
- **AND** 在识别出目标 display run 后，MUST 以最高的 process-history hydration 优先级选择该 run

#### Scenario: 快速连续 preview 选择使用最新目标
- **WHEN** 用户在 A 的消息或事件工作完成前依次选择 preview 目标 A 和 B
- **THEN** B MUST 是唯一允许移动 viewport 的导航目标
- **AND** A 独有的事件工作 MUST NOT 延迟 B
- **AND** 已启动的 A 事件请求 MUST 在 session 存活期间继续到正常结果
- **AND** 当 session 存活时，身份匹配且通过校验的 A 结果 MUST 只更新 A 的 run-scoped cache
- **AND** 迟到的 A 响应 MUST NOT 恢复 A 的 preview pin、移动 viewport 或进入 B 的 turn

#### Scenario: preview 导航只 pin 当前目标
- **GIVEN** preview 目标 A 已选择一个 display run
- **WHEN** 用户选择 preview 目标 B
- **THEN** B MUST 取代 A 成为当前 preview pin source
- **AND** 在 A 的 session 仍存活期间，A 的一个已激活请求 MUST 仅由其 active-request 生命周期保持 pinned，直到其加载结果
- **AND** session teardown 则 MUST 取消 A 并释放其 pin，且不发布 process-history UI 结果
