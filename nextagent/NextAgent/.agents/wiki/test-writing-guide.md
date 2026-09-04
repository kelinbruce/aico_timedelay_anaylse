---
sources:
  - tests/architecture/
  - tests/contract/
  - vitest.config.ts
  - dependency-cruiser.config.cjs
last-verified: 2026-09-01
---

# 测试编写指南

CodeAgent 写测试时最常遇到的问题：测什么、放哪里、用什么模式。

→ 验证命令详见 [verification-gates.md](verification-gates.md)

## 测试分类与位置

| 测试类型 | 目录 | Vitest 配置 | 测什么 |
|---|---|---|---|
| 单元测试 | `packages/{pkg}/src/__tests__/` | `vitest.config.ts` | 单个函数/类的行为 |
| 架构测试 | `tests/architecture/` | `vitest.config.architecture.ts` | 包边界、依赖规则、scope 隔离、日志安全 |
| 契约测试 | `tests/contract/` | `vitest.config.contract.ts` | port interface、schema conformance、gateway contract |
| E2E (alpha) | `tests/e2e/alpha-kernel-gate/` | 专用配置 | 最小内核门禁 |
| E2E (P1/P2) | `tests/e2e/p1-p2-scenario-gate/` | 专用配置 | 联合场景门禁 |
| E2E (product) | `tests/e2e/product-journey/` | 专用配置 | 产品旅程 |
| E2E (security) | `tests/e2e/security/` | 专用配置 | 安全门禁 |
| E2E (resilience) | `tests/e2e/resilience/` | 专用配置 | 可靠性门禁 |
| 冒烟测试 | `tests/smoke/` | `vitest.config.smoke.ts` | 快速验证 |
| 前端测试 | `frontend/agent-web/src/` | 前端 vitest 配置 | React 组件、store、service |
| 前端 E2E | `frontend/agent-web/e2e/` | Playwright | 浏览器用户旅程 |

## 选择测试类型的决策树

```
你在测什么？
│
├─ 包内部函数/类的行为
│  → 单元测试 (packages/{pkg}/src/__tests__/)
│
├─ 跨包 port/contract 的契约符合性
│  → 契约测试 (tests/contract/)
│
├─ 包边界、依赖方向、scope 隔离
│  → 架构测试 (tests/architecture/)
│
├─ 请求完整生命周期（submit → execute → terminal commit）
│  → E2E 测试 (tests/e2e/)
│
├─ 前端组件渲染/交互
│  → 前端单元测试 (frontend/agent-web/src/)
│
└─ 浏览器用户旅程
   → Playwright E2E (frontend/agent-web/e2e/)
```

## 架构测试怎么写

架构测试断言**结构和规则**，不测行为。典型模式：

```typescript
// tests/architecture/dependency-rules.test.ts
// 断言包 A 不依赖包 B
import { allSourceFilesIn } from './helpers.js';

describe('dependency rules', () => {
  it('agent-channel-web must not import agent-runtime', () => {
    const files = allSourceFilesIn('agent-channel-web');
    for (const file of files) {
      expect(file.imports).not.toContainPackage('agent-runtime');
    }
  });
});
```

**什么时候需要新增架构测试**：
- 新增了包或 contract subpath
- 修改了 dependency-cruiser 规则
- 发现了依赖违规（先加测试防止回退）

## 契约测试怎么写

契约测试验证 port/contract 的**接口符合性和 schema conformance**。

```typescript
// tests/contract/session-store-gateway-contract.test.ts
// 验证 gateway 实现符合 port interface
describe('SessionStoreGateway contract', () => {
  it('appendSessionMessage returns SessionMessageRecord with required fields', async () => {
    const result = await gateway.appendSessionMessage(record, options);
    expect(result).toMatchSchema(SessionMessageRecordSchema);
    expect(result.sessionId).toBe(record.sessionId);
  });
});
```

**关键原则**：
- 测 contract 或 observable behavior，不测 private implementation
- 测 schema conformance（TypeBox schema 验证）
- 测 port interface 的所有路径（成功、失败、边界）

## E2E 测试怎么写

E2E 测试使用**真实 product process、真实 transport、真实 persistence**。

```typescript
// tests/e2e/alpha-kernel-gate/xxx.test.ts
// 黑盒：submit → stream → terminal result
describe('alpha kernel gate', () => {
  it('submit request returns terminal result via SSE', async () => {
    const session = await createSession(agentId);
    const result = await submitAndWaitForTerminal(session.id, userMessage);
    expect(result.status).toBe('COMPLETED');
  });
});
```

**关键原则**：
- 不用假设值覆盖真实返回码
- 不 mock SSE-only transport 或 trusted identity 产品路径
- 黑盒：只看外部可观察结果

## 前端测试怎么写

```typescript
// frontend/agent-web/src/features/chat/__tests__/ChatMessage.test.tsx
import { render, screen } from '@testing-library/react';
import { ChatMessage } from '../ChatMessage';

describe('ChatMessage', () => {
  it('renders markdown content safely', () => {
    render(<ChatMessage content="**bold** text" />);
    expect(screen.getByText('bold')).toBeInTheDocument(); // bold element
  });
});
```

## 常见错误

| 错误 | 正确做法 |
|---|---|
| 为锁死私有实现细节写 brittle test | 测外部可观察行为或 contract 结果 |
| mock 掉真实 transport 做架构测试 | 架构测试断言结构规则，不跑 transport |
| 在单元测试中测试跨包集成 | 跨包集成用契约测试或 E2E |
| E2E 测试用假数据跳过真实路径 | E2E 必须走真实 process/transport/persistence |
| 测试 fixture 泄漏到产品代码 | fixture 只在测试目录，不导出给 src/ |

## 必须补测试的场景

修改以下内容时必须补 characterization/contract/architecture 测试：

- Runtime lifecycle
- Concurrency
- Cancellation
- Retry/edit
- Terminal commit
- Streaming
- Gateway persistence
- Sandbox
- Security
- Agent scope
- Owner scope

## 测试辅助工具

| 工具 | 位置 | 用途 |
|---|---|---|
| agent-test-kit | `packages/agent-test-kit/` | 测试 helper 和 fixture |
| 测试 helpers | `tests/helpers/` | 共享测试辅助函数 |
| 测试 fixtures | `tests/fixtures/` | 测试数据 |
| create-test-composition | `agent-app/src/composition/` | 创建测试用 app composition（classified test host） |
