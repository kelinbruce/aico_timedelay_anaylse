## ADDED Requirements

### Requirement: Security E2E 验证真实安全边界

Security E2E gate SHALL 通过真实 local product process、真实网络入口、真实 sandbox boundary 和真实日志/audit sink 执行 e2e-P0-01、12、16、17、21。任何 case 缺失、skipped、timeout 或 failed 时 gate MUST 失败。

#### Scenario: 所有真实安全边界通过
- **WHEN** 五个必需 security E2E case 均通过
- **THEN** gate 产出 passed security E2E evidence

#### Scenario: 安全 case 无法执行
- **WHEN** 必需 sink、sandbox boundary 或受保护入口无法被验证
- **THEN** gate MUST fail closed

### Requirement: Security E2E 不得泄漏敏感 canary

gate MUST 使用唯一敏感 canary 验证 response、stream、safe error、log、audit 和测试报告。任何禁止表面包含 canary 原值时 gate MUST 失败，持久化 evidence MUST 只保留安全 reason 和 canary hash。

#### Scenario: 敏感值跨边界被拦截
- **WHEN** 恶意输入携带敏感 canary 并触发认证、附件、sandbox、provider failure 或 audit 路径
- **THEN** 所有外部输出和持久化诊断均不包含 canary 原值

#### Scenario: 扫描失败不能解释为安全
- **WHEN** 任一必需输出表面无法读取或扫描
- **THEN** gate MUST 返回 failed
