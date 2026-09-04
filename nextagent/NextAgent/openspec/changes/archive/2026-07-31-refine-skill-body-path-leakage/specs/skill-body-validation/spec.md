## ADDED Requirements

### Requirement: Skill body 泄漏校验 SHALL 允许相对 tmp glob

Skill body 安全泄漏校验 SHALL NOT 仅因为路径包含 `tmp` 段，就把包含 `/tmp/` 的相对路径或 glob 模式判定为 host 路径泄漏。

#### Scenario: 相对 tmp glob 成功加载
- **WHEN** 一个 Skill body 包含 `XX/*/tmp/*`
- **THEN** 在未违反其他安全边界或泄漏规则时，Skill 加载 SHALL 成功。

### Requirement: Skill body 泄漏校验 SHALL 继续阻断 host 路径

Skill body 安全泄漏校验 SHALL 在把 Skill body 注入隐藏上下文之前，继续拒绝高置信度的 host 绝对路径和具体的类 credential 值。当值明显不是具体 secret 时，占位符 credential 或 authorization 示例 SHALL 被允许。

#### Scenario: host 绝对路径未通过泄漏校验
- **WHEN** 一个 Skill body 包含 `/tmp/private/file`、`/home/operator/.ssh/id_rsa` 或 `C:\Users\operator\.ssh\id_rsa`
- **THEN** Skill 加载 SHALL 因安全泄漏校验而失败。

#### Scenario: 占位符 credential 示例成功加载
- **WHEN** 一个 Skill body 包含诸如 `Authorization: Bearer your-token`、`token=${TOKEN}` 或 `api_key=os.environ["API_KEY"]` 的示例
- **THEN** 在不存在具体 credential 值或其他安全边界违规时，Skill 加载 SHALL 成功。
