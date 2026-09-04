# skill-body-validation Specification

## Purpose
定义 Skill 正文解析、路径泄漏校验和临时文件通配规则的安全契约，防止未经授权的执行路径或临时文件引用进入 Skill 可见内容。
## Requirements
### Requirement: Skill Body Leakage Validation SHALL Allow Relative Tmp Globs

Skill body safe leakage validation SHALL NOT treat relative path or glob patterns containing `/tmp/` as host path leakage merely because the path contains a `tmp` segment.

#### Scenario: Relative tmp glob loads successfully
- **WHEN** a Skill body contains `XX/*/tmp/*`
- **THEN** Skill loading SHALL succeed if no other safe boundary or leakage rule is violated.

### Requirement: Skill Body Leakage Validation SHALL Continue Blocking Host Paths

Skill body safe leakage validation SHALL continue to reject high-confidence host absolute paths and concrete credential-like values before injecting the Skill body into hidden context. Placeholder credential or authorization examples SHALL be allowed when the value is clearly not a concrete secret.

#### Scenario: Host absolute paths fail leakage validation
- **WHEN** a Skill body contains `/tmp/private/file`, `/home/operator/.ssh/id_rsa`, or `C:\Users\operator\.ssh\id_rsa`
- **THEN** Skill loading SHALL fail with safe leakage validation.

#### Scenario: Placeholder credential examples load successfully
- **WHEN** a Skill body contains examples such as `Authorization: Bearer your-token`, `token=${TOKEN}`, or `api_key=os.environ["API_KEY"]`
- **THEN** Skill loading SHALL succeed if no concrete credential value or other safe boundary violation is present.
