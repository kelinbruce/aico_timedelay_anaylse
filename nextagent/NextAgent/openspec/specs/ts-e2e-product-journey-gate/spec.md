## Purpose

Define real-boundary E2E quality gate that verifies end-to-end product journeys using a real local product process, real transport (HTTP/SSE/WebSocket), and real browser execution.

## Requirements

### Requirement: 产品旅程 E2E 使用真实产品边界

产品旅程 E2E gate SHALL 使用真实 local product process、真实监听端口、真实 HTTP/SSE/WebSocket client 和真实浏览器执行。被验证链路中的 product composition、Web transport、runtime、gateway persistence 和 browser interaction MUST NOT 被 mock 替代。

#### Scenario: 真实产品主链路通过
- **WHEN** 执行 `npm run test:e2e:product-journey`
- **THEN** gate 通过真实 local product entrypoint 完成所有必需产品旅程
- **AND** 每个旅程得到用户可见结果或 canonical terminal result

#### Scenario: Mock 不能满足产品旅程 gate
- **WHEN** 用例使用 mock HTTP route、mock EventSource、fake WebSocket 或直接领域 service 调用替代目标链路
- **THEN** 该用例 MUST NOT 被计为本 gate 的通过证据

### Requirement: 产品旅程 E2E 覆盖首版主用户路径

产品旅程 E2E gate MUST 覆盖 e2e-P0-02、03、04、06、07、08、09、10、11、13、14、15、18、22、23、24。每个 case id MUST 只有一个主要维护 spec，且 MUST 验证对应 OpenSpec 行为的外部可观察结果。

#### Scenario: 所有必需产品旅程通过
- **WHEN** 16 个必需 case 均执行并通过
- **THEN** gate 返回 passed

#### Scenario: 必需产品旅程缺失或失败
- **WHEN** 任一必需 case 缺失、skipped、timeout 或 failed
- **THEN** gate 返回 failed
- **AND** 不得用其他 case 的成功覆盖该结果

### Requirement: 产品旅程 E2E 证据安全且可追溯

gate MUST 产出 machine-readable report，至少关联 case id、结果、失败阶段和安全 evidence ref。报告 MUST NOT 包含 raw credential、prompt、完整模型输出、附件内容、secret 或未脱敏路径。

The gate SHALL maintain the single standard command `npm run test:e2e:product-journey`. The command MUST write a machine-readable release smoke `ReleaseCheckResult`. It MUST NOT define an adapter API or implement release verdict aggregation.

#### Scenario: Gate 失败提供安全证据
- **WHEN** 任一产品旅程失败
- **THEN** report 标识失败 case 和阶段
- **AND** evidence 足以定位测试边界但不泄露敏感内容
