## 背景与问题（Why）

首版本地 release 已按能力 change 分别定义认证、会话、请求控制、stream、附件、context、capability、feedback、标题和双语输出，但分散的 unit、contract 和 mocked browser tests 不能证明这些能力通过真实监听端口和产品 composition 组合后仍然可用。发布前需要一组边界清晰、可重复执行的产品旅程 E2E，证明用户可见主链路没有在跨模块集成处断裂。

## 变更范围（What Changes）

- 新增产品旅程 E2E gate，使用真实 local product process、真实 HTTP/SSE/WebSocket 连接和真实浏览器验证首版用户旅程。
- 为 e2e-P0-02、03、04、06、07、08、09、10、11、13、14、15、18、22、23、24 建立唯一主要维护归属。
- 统一测试目录、启动/清理 helper、用例标签、超时、失败证据和命令入口。
- 明确 mocked browser journey 只能用于前端行为回归，不能满足本 gate。
- 明确本 change 只验证已有 OpenSpec 行为，不新增或重新定义产品 API、runtime lifecycle、capability、context 或 persistence 语义。

BREAKING：无。

## Capability 影响（Capabilities）

### 新增 Capability

- `ts-e2e-product-journey-gate`: 定义首版本地产品主旅程必须通过的真实边界 E2E gate。

### 修改的 Capability

无。

## 影响范围（Impact）

- 主要影响 `tests/e2e/` 的 Playwright 配置、真实产品 process fixture、产品旅程 specs 和执行脚本。
- 消费既有 local auth、Web channel、runtime、session、stream、attachment、context、model、capability、feedback、title 和 local gateway 行为。
- gate 结果作为 release smoke evidence 输入；不修改 `agent-contracts`。
- 维护唯一标准命令 `npm run test:e2e:product-journey`，产出 machine-readable release smoke `ReleaseCheckResult`。

## 归档前更新基线（Baseline Promotion Plan）

行为契约：
- `openspec/specs/ts-e2e-product-journey-gate/spec.md`：新增产品旅程 E2E gate 行为。

长期背景：
- `openspec/overview.md`：记录首版本地 release 需要真实产品旅程 E2E 证明。

设计视图：
- `openspec/designs/architecture/e2e-quality-gates.md`：承载 E2E 分类、真实边界、用例唯一归属和 evidence 规则。
- `openspec/designs/modules/agent-app.md`：只增加产品 composition E2E 验证入口导航。
- `openspec/designs/adr/<id>.md`：无。
- `openspec/designs/spec-to-design-map.md`：增加本 capability 与验证入口导航。

验证入口：
- `npm run test:e2e:product-journey`
- `openspec validate add-ts-e2e-product-journey-gate --strict`
