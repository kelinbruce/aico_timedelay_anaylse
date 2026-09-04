## 背景与问题（Why）

首版安全行为分布在 local auth、附件、sandbox、provider error mapping、redaction 和 audit 等 owner 中。低层 security tests 能证明局部禁止项，但不能证明真实 process、network、filesystem 和日志/audit sink 组合后仍然 fail closed 且不泄漏敏感信息。

## 变更范围（What Changes）

- 新增真实边界 security E2E gate，为 e2e-P0-01、12、16、17、21 建立唯一主要维护归属。
- 使用真实 local product process、真实未认证网络请求、真实附件边界、真实 sandbox adapter 和真实日志/audit 输出验证安全属性。
- 将结果作为既有 security hard gate 的 E2E evidence；已有 `add-ts-security-test-gate` 继续拥有低层 contract、negative 和 architecture 验证。
- 不新增安全策略、认证行为、SafeError 字段或 audit contract。

BREAKING：无。

## Capability 影响（Capabilities）

### 新增 Capability
- `ts-e2e-security-gate`: 定义首版本地 release 必须通过的真实边界安全 E2E。

### 修改的 Capability
无。

## 影响范围（Impact）

- 主要影响 `tests/e2e/` security Playwright project、恶意测试 fixture、日志/audit report 扫描和命令入口。
- 消费 local auth、attachment、sandbox、model/provider、redaction 和 audit 既有行为；不修改 `agent-contracts`。

## 归档前更新基线（Baseline Promotion Plan）

行为契约：
- `openspec/specs/ts-e2e-security-gate/spec.md`：新增真实边界 security E2E gate。

长期背景：
- `openspec/overview.md`：记录 security hard gate 需要真实边界 E2E evidence。

设计视图：
- `openspec/designs/architecture/e2e-quality-gates.md`：记录 security E2E 的真实边界和 evidence 归属。
- `openspec/designs/modules/agent-observability.md`：增加安全 report 验证导航。
- `openspec/designs/adr/<id>.md`：无。
- `openspec/designs/spec-to-design-map.md`：增加导航。

验证入口：
- `npm run test:e2e:security`
- `openspec validate add-ts-e2e-security-gate --strict`
