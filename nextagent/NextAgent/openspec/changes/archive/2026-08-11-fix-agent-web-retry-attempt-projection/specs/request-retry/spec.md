## Function

- **所属 Function**：`FN-2.3 重试请求`
- **Function 变更类型**：`MODIFIED`
- **spec 角色**：主规格

## MODIFIED Requirements

### Requirement: Retry 新 run 自动展开实时过程

当 retry command 进入 pending 时，用户界面 MUST 立即停止把被替换 attempt 的 Think、工具步骤或答案展示为当前执行过程。HTTP acceptance 尚未返回真实新 `runId` 时，界面 MUST 展示不包含旧 attempt 内容的既有等待状态。acceptance 前失败时，界面 MUST 恢复原轮次。

HTTP acceptance 或后续权威状态确认新 `runId` 后，用户界面 MUST 将该 `runId` 作为该 request 的当前 attempt。当前轮次的 Think、工具步骤、阶段文字和 canonical assistant answer MUST 只由当前 `runId` 的事实组成；其他 attempt 的过程或答案 MUST NOT 参与当前 attempt 的合并、去重、完成判定或答案抑制。新的 retry run 开始产生实时过程后，用户界面 MUST 将其作为独立的一次执行过程展示并自动展开过程面板，不得沿用被替换 run 的折叠状态。该行为 MUST 同时适用于 inherited attempt `1` 和后续普通 retry attempt，并在 live、会话切换返回和 authoritative history reload 后保持一致。

**需求类别**：功能性需求

#### Scenario: retry 新 run 的实时过程自动展开

- **GIVEN** 被 retry 的轮次过程面板处于折叠状态
- **WHEN** inherited 或普通 retry 的新 run 开始产生实时过程
- **THEN** 用户界面 MUST 将新 run 展示为独立的一次执行过程
- **AND** 新 run 的过程面板 MUST 自动展开
- **AND** MUST NOT 继承被替换 run 的用户折叠状态

#### Scenario: retry pending 不展示旧 attempt 过程

- **GIVEN** 被 retry 的轮次已有可见 Think、工具过程或答案
- **WHEN** retry command 已进入 pending 但 HTTP acceptance 尚未返回新 `runId`
- **THEN** 用户界面 MUST NOT 把旧 attempt 的内容展示为本次 retry 的开头
- **AND** acceptance 前失败时 MUST 恢复原轮次及其过程和答案

#### Scenario: 当前 attempt 的答案不被旧答案抑制

- **GIVEN** 同一 request 的被替换 attempt 已有 canonical assistant answer
- **AND** 新 retry attempt 已确认 `runId`
- **WHEN** 新 attempt 产生 canonical assistant answer
- **THEN** 用户界面 MUST 展示新 attempt 的答案
- **AND** MUST NOT 因被替换 attempt 已有答案而丢弃或隐藏新答案
- **AND** 默认当前轮次 MUST NOT 同时展示被替换 attempt 的答案

#### Scenario: 当前 attempt 不混入旧执行过程

- **GIVEN** 同一 request 的被替换 attempt 已有 Think 和工具步骤
- **AND** 新 retry attempt 已确认 `runId`
- **WHEN** 新 attempt 的实时过程到达或过程历史完成加载
- **THEN** 用户界面 MUST 只把新 `runId` 的过程组成当前执行详情
- **AND** MUST NOT 按相同 request 或相同内容跨 attempt 合并或去重

#### Scenario: authoritative reload 保持当前 attempt

- **GIVEN** retry attempt 已被接受并产生可见过程或答案
- **WHEN** 用户切换会话后返回，或页面重新加载 authoritative history
- **THEN** 用户界面 MUST 继续展示该 request 的当前 attempt
- **AND** live 与 history 对当前 `runId` 的过程和答案 MUST 得出相同默认可见结果

#### Scenario: 已有分享保持冻结结果

- **GIVEN** 用户在 Retry 前已创建会话分享
- **WHEN** 普通会话中的同一 request 完成新的 Retry attempt
- **THEN** 已有分享 MUST 继续展示创建分享时冻结的 attempt
- **AND** Retry 后新建的分享 MUST 展示普通会话当前可见的新 attempt

#### Scenario: fork child Retry 不修改 parent

- **GIVEN** fork child 的最新继承轮次满足 Retry 资格
- **WHEN** 用户在 child 中发起 Retry 且新 child `runId` 被接受
- **THEN** child 当前轮次 MUST 只展示该 child 新 attempt
- **AND** parent session 的过程、答案和已有分享 MUST 保持不变

## Function 变更汇总

### 处理过程

- **变更类型**：修改
- **目标内容**：系统在 Retry pending 时移除旧 attempt 的当前展示，在新 `runId` 被确认后只以该 run 的事实组成当前过程和答案，并自动展开新过程。
- **依据 Requirements**：`Retry 新 run 自动展开实时过程`

### 结果

- **变更类型**：修改
- **目标内容**：用户在 live、会话切换返回和重新加载后只看到当前 retry attempt 的执行过程与答案；接受前失败时恢复原轮次。
- **依据 Requirements**：`Retry 新 run 自动展开实时过程`
