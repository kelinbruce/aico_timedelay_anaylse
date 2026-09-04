## MODIFIED Requirements

### Requirement: Frontend share interaction behavior

前端（agent-web）SHALL 在每轮问答的助手回复操作行中展示分享按钮（与复制、点赞、点踩、收藏、重新生成位于同一行）。点击分享按钮后进入分享勾选模式：当前会话下所有问答对左侧出现复选框，点击分享按钮对应的问答对默认勾选，用户可继续勾选或取消其他问答对。会话面板底部出现全宽分享按钮（占满绘画面板宽度）。

点击底部分享按钮后弹出分享设置弹窗，包含：有效期选项（24 小时、7 天、一个月、永久，始终展示）、权限选项（"保持同样权限"勾选框，仅 remote 模式展示）。点击弹窗内的生成按钮后，前端调用 `POST /api/v1/sessions/:sessionId/shares`，传入勾选的 `runIds`、`originUrl`（取自 `window.location.origin`）、`expiresIn`、`allowedOps`（remote 模式勾选时为 `HostSiteContext.user.ops`，否则为 null）。成功后展示完整 `shareUrl` 供用户复制。

勾选模式 MUST 支持退出（取消按钮或 ESC），退出后恢复正常对话视图。

分享勾选模式与报告勾选模式互斥：同一时间只能处于其中一种模式。进入报告勾选模式时，分享勾选模式 MUST 自动退出并清空分享已选集合；进入分享勾选模式时，报告勾选模式 MUST 自动退出并清空报告已选集合。

#### Scenario: Enter selection mode

- **WHEN** 用户点击某问答对操作行的分享按钮
- **THEN** 当前会话所有问答对左侧出现复选框
- **AND** 该问答对默认勾选
- **AND** 会话面板底部出现全宽分享按钮

#### Scenario: Toggle selection in selection mode

- **WHEN** 用户在勾选模式下点击另一个问答对的复选框
- **THEN** 该问答对被勾选
- **AND** 再次点击取消勾选

#### Scenario: Open share settings dialog

- **WHEN** 用户点击底部全宽分享按钮
- **THEN** 弹出分享设置弹窗
- **AND** 弹窗包含有效期选项（24h/7d/30d/永久）
- **AND** remote 模式下弹窗包含"保持同样权限"勾选框
- **AND** local 模式下弹窗不展示权限勾选框

#### Scenario: Generate share link

- **WHEN** 用户在弹窗中设置有效期和权限后点击生成
- **THEN** 前端调用 `POST /api/v1/sessions/:sessionId/shares`
- **AND** 请求体包含勾选的 `runIds`、`originUrl`、`expiresIn`、`allowedOps`
- **AND** 成功后展示完整 `shareUrl` 供复制

#### Scenario: Exit selection mode

- **WHEN** 用户在勾选模式下点击取消或按 ESC
- **THEN** 退出勾选模式，恢复正常对话视图
- **AND** 复选框消失

#### Scenario: Entering report selection mode exits share selection mode

- **GIVEN** 当前处于分享勾选模式且已勾选若干问答对
- **WHEN** 用户通过右键"生成报告"进入报告勾选模式
- **THEN** 分享勾选模式 MUST 自动退出
- **AND** 分享已选集合 MUST 被清空
- **AND** 报告勾选模式 MUST 激活

#### Scenario: Entering share selection mode exits report selection mode

- **GIVEN** 当前处于报告勾选模式且已勾选若干问答对
- **WHEN** 用户点击分享按钮进入分享勾选模式
- **THEN** 报告勾选模式 MUST 自动退出
- **AND** 报告已选集合 MUST 被清空
- **AND** 分享勾选模式 MUST 激活