## 技术设计

### 测试框架

使用 Playwright 作为统一 E2E 测试框架。理由：
- 现有 30 个测试已基于 Playwright，保持一致性
- Playwright 同时支持 API 级别测试（APIRequestContext）和浏览器 UI 测试（Page）
- SSE/WebSocket stream 消费通过 Playwright 的 page.goto + SSE API 可实现
- 并发测试通过多个 request context 或多个 page 实现可行

### Mock 策略

分层 mock，按测试类型选择 mock 级别：

| 测试类型 | Mock 级别 | 实现方式 |
|---|---|---|
| 业务流 happy_path | 无 mock（真实 product process） | `node bin\nextagent-start` 启动真实服务 |
| Spec SHALL error_path | HTTP mock（page.route） | 拦截特定 API 返回 SafeError |
| 并发竞争态 | 真实并发 + timing 控制 | 多 request/page 同时提交 |
| 非功能性性能 | 无 mock | 真实请求 + 时间测量 |
| 非功能性安全 | canary 注入 + HTTP mock | 注入 canary 到配置请求 |
| 前端 UI | 真实前端 + 确定性模型 mock | page.route mock 模型 API |

### Selector 策略

优先使用 data-testid，fallback 使用 class/aria-label：
```
[data-testid='xxx'] > [aria-label*='xxx'] > button:has-text('xxx') > [class*='xxx']
```

### 测试组织结构

按 spec 分类组织目录：
```
tests/suites/
  business-flow/       ← TC-SUB-01~TC-CCO-02 (54个)
  spec-shall/          ← TC-SPC-* 系列 (148个)
  concurrency/         ← TC-CON-* 系列 (9个)
  non-functional/      ← TC-PER/REL/SEC/RES-* 系列 (15个)
  ui-interaction/      ← TC-UI-01~TC-UI-16 (16个)
tests/suites/add-ts-architecture-test-gate/
  business-flow/       ← 53 files (55 active + 20 skip = 75 TC)
  spec-shall/          ← 148 files (144 active + 4 skip = 148 TC)
  concurrency/         ← 9 files (9 active TC)
  non-functional/      ← 15 files (10 active + 23 skip = 33 TC)
  ui-interaction/      ← 16 files (9 active + 8 skip = 17 TC)

每个测试文件对应一个独立 TC（如 TC-SUB-01.spec.ts），而非按功能分组。
```

### 确定性模型 Mock

前端 UI 测试使用确定性模型 mock。实现方式：page.route 拦截模型 API，返回预定义的 SSE stream 序列（包含 text delta、tool call、terminal event），确保前端交互可重复验证。

### 进程重启测试实现

使用子进程管理实现重启测试：
```typescript
const proc = spawn('node', ['bin/nextagent-start'], { ... });
// kill 进程
proc.kill('SIGTERM');
// 重启
const newProc = spawn('node', ['bin/nextagent-start'], { ... });
```

### 质量属性设计

- **安全**：所有安全测试使用 canary 注入验证，mock 不使用真实 credential，测试环境使用 localhost-only 配置
- **性能**：性能测试只验证阈值达标，不做精确 benchmark，使用 performance.now() 或 Date.now() 测量时间差
- **可靠性**：每个测试独立创建 session，不依赖其他测试的 state，使用 test.beforeEach 创建测试 session
- **可维护性**：测试文件按 spec 分类组织，每个测试文件名与 spec 名称对应，TC 编号在测试描述中标注
- **可测试性**：API 测试使用 APIRequestContext（更快、更稳定），UI 测试使用 Page（完整前端验证）

### 追溯链

每个测试标注追溯链：TP 编号 → Spec Requirement 编号。测试描述包含 TC 编号和用例名称。
