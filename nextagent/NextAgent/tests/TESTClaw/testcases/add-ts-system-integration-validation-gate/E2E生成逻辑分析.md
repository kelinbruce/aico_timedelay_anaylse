# E2E 生成逻辑分析

## 推导链

```text
Feature/Function/OpenSpec
        +
现有 fixed/backend/browser 场景
        +
NetAgent 外部依赖边界
        v
公共入口与最终可观察结果
        v
真实边界缺口
        v
TestClaw case + executionRef + evidence
```

## 生成规则

1. 先固定当前 113 个来源 identity，不按文件数或历史文档数量猜测。
2. 对每个来源场景确定公共入口、前置条件、可观察断言和失败边界。
3. 为每个来源场景创建本 Function suite 的独立单 case 执行文件，只复用 helper，不复用其他 case 结果。
4. 为 remote package/HTTP/filesystem 缺口生成 3 个 integration cases。
5. 为真实产品入口到跨边界终态的缺口生成 5 个 E2E cases。
6. 每个 case 固定唯一 executionRef、Feature/Function/Requirement refs 和 evidence。
7. planned/excluded 范围放入 deferred coverage，不生成 skip 用例。

## 防止错误扩张

- 不把所有 TestClaw 现有 405 个 invocations 纳入本门禁。
- 不因测试需要修改产品 public contract 或本地候选包依赖闭包。
- 不把 AICO、集群或 AgentLink 的未规格化目标生成占位测试，也不把独立 `ts-performance-test-gate` 的 verdict 复制为本 Function 用例。
- 不以一次共享 smoke 结果批量满足多个 case。
