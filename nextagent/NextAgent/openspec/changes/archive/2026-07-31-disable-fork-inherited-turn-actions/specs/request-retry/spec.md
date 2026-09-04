## ADDED Requirements

### Requirement: Agent Web 禁用继承 latest turn 的 retry 入口

Agent Web SHALL 通过 conversation message `metadata.forkInherited` 识别 fork 继承 turn。当 session 的 latest turn 是继承 turn 时，agent-web MUST 禁用该 turn 的 retry 按钮（TurnBlock 与 Composer 入口），禁用态 MUST 包含禁用光标 `not-allowed`、降低透明度，并在悬浮时通过 Tooltip 展示"派生会话继承的回答不可重试"的原因说明。fork 后新提问产生的 turn MUST 正常展示并使用 retry 入口。agent-web MUST NOT 以本地标记替代后端权威校验；继承标记缺失时按钮保持现状渲染，后端既有 `REQUEST_RETRY_NOT_FOUND` / `REQUEST_RETRY_NOT_LATEST` 安全错误仍是最终边界。

#### Scenario: 继承 latest turn 的 retry 按钮禁用并提示
- **WHEN** 用户打开刚派生、尚无新提问的 child session
- **THEN** latest 继承 turn 的 retry 按钮 MUST 呈现禁用视觉态（`not-allowed` 光标、降低透明度）
- **AND** 悬浮 Tooltip MUST 说明该回答由派生继承、不可重试
- **AND** 点击 MUST NOT 发起 retry 请求

#### Scenario: 新提问后的 latest turn retry 正常
- **WHEN** 用户在 child session 提交新问题并得到回答
- **THEN** 新 latest turn 的 retry 按钮 MUST 正常可用
- **AND** retry 请求 MUST 以后端 lane latest 语义正常处理
