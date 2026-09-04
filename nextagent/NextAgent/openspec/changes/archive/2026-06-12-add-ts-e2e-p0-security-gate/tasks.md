## 1. Gate 基础设施

- [x] 1.1 增加 `npm run test:e2e:security` 和隔离 security Playwright project。
  验证：命令启动真实 local product candidate 并生成 security evidence。
  来源：spec requirement “Security E2E 验证真实安全边界”
- [x] 1.2 实现敏感 canary 注入、hash 记录和 response/stream/log/audit/report 扫描。
  验证：注入泄漏 fixture 后 gate 实际失败，report 不包含 canary 原值。
  来源：spec requirement “Security E2E 不得泄漏敏感 canary”；design D1
- [x] 1.3 将扫描面限定为 HTTP response、stream 输出、safe error、结构化日志、audit sink 和 Playwright report；不得复制 secret grammar、redaction policy source assertion、依赖禁止扫描或全盘 artifact 扫描。
  验证：code review 检查本 gate 只扫描上述表面，低层 security assertions 仍归 `add-ts-security-test-gate`。
  来源：design D5

## 2. Security E2E 用例

- [x] 2.1 实现 e2e-P0-01：未认证 challenge 且不创建用户数据。
  验证：`npm run test:e2e:security -- --grep e2e-P0-01`。
  来源：spec requirement “Security E2E 验证真实安全边界”
- [x] 2.2 实现 e2e-P0-12：非启用/超限附件返回 safe error 且不泄漏。
  验证：`npm run test:e2e:security -- --grep e2e-P0-12`。
  来源：同上
- [x] 2.3 实现 e2e-P0-16：动态执行不能绕过 sandbox gateway。
  验证：`npm run test:e2e:security -- --grep e2e-P0-16`。
  来源：同上
- [x] 2.4 实现 e2e-P0-17：provider/model failure 映射为 SafeError。
  验证：`npm run test:e2e:security -- --grep e2e-P0-17`。
  来源：同上
- [x] 2.5 实现 e2e-P0-21：audit/log 输出安全字段且不含禁止内容。
  验证：`npm run test:e2e:security -- --grep e2e-P0-21`。
  来源：同上

## 3. Negative Gate 和收尾

- [x] 3.1 增加真实泄漏 negative fixture，断言任一输出表面出现 canary 即阻断。
  验证：security gate negative test；每个被扫描表面在明确列表内，且不新增产品可见测试开关。
  来源：spec scenario “扫描失败不能解释为安全”；design D5
- [x] 3.2 增加 sink 不可读和 case skipped negative fixture，断言 gate fail closed。
  验证：security gate negative test。
  来源：spec scenario “安全 case 无法执行”；design D4
- [x] 3.3 运行本 change 和仓库门禁。
  验证：`npm run test:e2e:security`、`npm run build`、`npm test`、`npm run test:contract`、`npm run lint:architecture`、`openspec validate add-ts-e2e-security-gate --strict`。
  来源：AGENTS.md 验证门禁

## 归档前更新基线检查（非实施任务）

- 同步 `openspec/specs/ts-e2e-security-gate/spec.md`。
- 更新 `openspec/designs/architecture/e2e-quality-gates.md`、`openspec/designs/modules/agent-observability.md` 和 `openspec/designs/spec-to-design-map.md`。
