## MODIFIED Requirements

### Requirement: Skill 选择栏组件位置

前端 SHALL 在聊天输入框上方 16px 处渲染一个可切换的组件容器（`QuickOperatorArea`），该容器 SHALL 通过参数控制渲染 Skill 选择栏组件或分类问题组件。容器默认 SHALL 渲染 Skill 选择栏组件。当渲染 Skill 选择栏时，Skill 栏的宽度 SHALL 与输入框宽度齐平。Skill 栏 SHALL 作为该可切换组件容器的一个 slot。当当前 Agent Scope 下没有可用 Skill 时，Skill 栏 MUST NOT 渲染，且输入框上方 MUST NOT 保留空白间距。当渲染分类问题组件时，分类问题组件 SHALL 复用相同的容器位置和宽度约束。

#### Scenario: 默认渲染分类问题组件
- **WHEN** 输入框上方组件容器参数为默认值（"skills"）
- **THEN** 容器 MUST 渲染 Skill 选择栏组件
- **AND** MUST NOT 渲染 Skill 选择栏

#### Scenario: 参数指定渲染 Skill 选择栏
- **WHEN** 输入框上方组件容器参数指定为 Skill 选择栏
- **THEN** 容器 MUST 渲染 Skill 选择栏
- **AND** Skill 栏宽度 MUST 与输入框宽度一致

#### Scenario: 有可用 Skill 时渲染选择栏
- **WHEN** 组件容器渲染 Skill 选择栏且 `GET /api/v1/skills` 返回 `total > 0`
- **THEN** 前端 MUST 在输入框上方 16px 处渲染 Skill 选择栏
- **AND** Skill 栏宽度 MUST 与输入框宽度一致

#### Scenario: 无可用 Skill 时不渲染选择栏
- **WHEN** 组件容器渲染 Skill 选择栏且 `GET /api/v1/skills` 返回 `total=0` 或请求失败
- **THEN** 前端 MUST NOT 渲染 Skill 选择栏
- **AND** 输入框上方 MUST NOT 出现额外空白间距
