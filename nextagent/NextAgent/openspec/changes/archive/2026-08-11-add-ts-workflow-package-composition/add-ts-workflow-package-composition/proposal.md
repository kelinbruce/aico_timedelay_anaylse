## 背景与问题（Why）

workflow minimal contracts 冻结后，还需要一个物理 package 承载实现，并在 `agent-app` 中完成显式 wiring。

本 change 只解决 package 和 composition 问题，不负责 routing、调度、持久化或恢复。

## 变更范围（What Changes）

- **新增** `packages/agent-workflow/` workspace package
- **新增** `createWorkflowExecutionService()` factory 暴露面
- **新增** `agent-app` composition wiring
- **新增** 启动期本地 recipe 文件加载：
  - 扫描工程打包根目录（与 skills 根路径一致）下的 `recipes/` 与 `agents/{agentId}/recipes/`
  - 解析并用已冻结 schema 校验
  - 将静态 recipe 发布为 `WORKFLOW` capability descriptor，并提供执行期 recipe definition source

## 不在范围内（Explicit Non-Goals）

- 不实现 workflow 调度逻辑
- 不实现 routing strategy
- 不实现 recipe durable store
- 不实现 workflow persistence / recovery
- 不实现远端 recipe source 或 hot reload

## Capability 影响（Capabilities）

### 新增 Capability

- `workflow-package`

### 修改的 Capability

无

## 影响范围（Impact）

- `packages/agent-workflow`
- `agent-app`

## 归档前更新基线（Baseline Promotion Plan）

行为契约：
- `openspec/specs/ts-backend-architecture/spec.md`

设计视图：
- `openspec/designs/modules/agent-workflow.md`
- `openspec/designs/architecture/ts-backend-architecture.md`

验证入口：
- build / architecture / wiring integration tests
