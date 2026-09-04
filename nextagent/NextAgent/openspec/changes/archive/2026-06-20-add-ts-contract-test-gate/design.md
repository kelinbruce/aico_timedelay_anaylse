## 技术设计

### 测试框架

使用 TESTClaw 现有 Vitest 后端测试框架，测试文件位于 `tests/suites/add-ts-contract-test-gate/` 目录下。

### 测试依赖

- 所有契约测试通过 `@nextagent/*` alias 从 `target/node_modules` 加载编译后产物
- 使用 `@nextagent/agent-app/testing` 获取 test kit fixture
- 不需要启动 NextAgent 服务

### 测试组织

在现有 08-contract.test.ts 中按 Gateway/Port 接口分组组织 describe 块：
在 9 个测试文件中按测试类别组织，契约测试文件（08-contract.test.ts）按 Gateway/Port 接口分组组织 describe 块：

| # | 文件 | 用例数 | 测试内容 |
|---|---|---|---|
| 01 | 01-functional.test.ts | 58 | 全链路功能验证 |
| 02 | 02-performance.test.ts | 12 | 性能指标验证 |
| 03 | 03-reliability.test.ts | 10 | 可靠性验证 |
| 04 | 04-compatibility.test.ts | 8 | 兼容性验证 |
| 05 | 05-security.test.ts | 6 | 安全边界验证 |
| 06 | 06-serviceability.test.ts | 8 | 可服务性验证 |
| 07 | 07-e2e.test.ts | 16 | 端到端业务链路 |
| 08 | 08-contract.test.ts | 11 | Gateway/SPI 契约语义验证 |
| 09 | 09-architecture.test.ts | 15 | Package 依赖边界验证 |

```
describe("Contract: Runtime Command", () => { ... })
describe("Contract: Session Store", () => { ... })
describe("Contract: Session Message Store", () => { ... })
describe("Contract: Active Context Store", () => { ... })
describe("Contract: RequestRun Store", () => { ... })
describe("Contract: Timeline Store", () => { ... })
describe("Contract: Checkpoint Store", () => { ... })
describe("Contract: Attachment Store", () => { ... })
describe("Contract: Model Gateway Port", () => { ... })
describe("Contract: Capability Gateway Port", () => { ... })
```

### 幂等性验证策略

对每个幂等写入操作：
1. 执行首次写入，记录返回值
2. 使用相同 key 执行第二次写入
3. 验证第二次返回与首次相同（requestId/runId/attempt 等）
4. 验证持久化层只有一条记录

### Scope 隔离验证策略

使用不同 tenantId/subjectId 的 APIRequestContext 模拟多租户：
1. tenant-A 创建 session
2. tenant-B 查询 session 列表
3. 验证 tenant-B 看不到 tenant-A 的 session

### CAS 验证策略

对 version CAS 操作：
1. 读取当前 version
2. 基于 version 修改
3. 并发执行相同修改
4. 验证只有一个成功，另一个返回冲突错误

### Safe Error 验证策略

对 model provider 错误映射：
1. mock provider 返回包含敏感信息的错误（provider 名称、endpoint、credential）
2. 验证系统返回的 SafeError 不包含这些信息
3. 验证日志中也不包含
