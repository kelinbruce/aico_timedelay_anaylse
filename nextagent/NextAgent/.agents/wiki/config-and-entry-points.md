---
sources:
  - src/main.ts
  - openspec/overview.md
  - openspec/designs/modules/agent-app.md
last-verified: 2026-09-01
---

# 配置文件与入口点速查

CodeAgent 修改配置、排查启动问题或理解入口时参考。

## 入口点

| 入口 | 路径 | 职责 |
|---|---|---|
| 后端主进程 | `src/main.ts` | 创建 NextAgentApp，设置 fatal boundary，启动 server |
| 进程致命边界 | `src/process-fatal.ts` | uncaught exception / unhandled rejection 边界 |
| 前端 local 入口 | `frontend/agent-web/src/entries/local/` | 本地开发者 UI 入口 |
| 前端 immersive 入口 | `frontend/agent-web/src/entries/immersive/` | 沉浸式嵌入入口 |
| 前端 collaborative 入口 | `frontend/agent-web/src/entries/collaborative/` | PIU 协作嵌入入口 |

**所有业务逻辑在 `packages/*/src/`，根 `src/` 只有进程入口。**

## 配置文件

| 配置 | 路径 | 用途 | 谁消费 |
|---|---|---|---|
| Agent 定义 | `{configRoot}/agents/{agentId}/agent.yaml` | Agent 配置、model、prompt、capability binding、hooks | agent-app 启动期冻结 |
| 应用配置 | `{configRoot}/application.yaml` | 全局模型、认证、gateway、部署模式 | agent-app 启动期冻结 |
| Builtin Skill | `{configRoot}/skills/` | 系统级本地 Skill（EAGER discovery） | agent-capability |
| Agent-owned Skill | `{configRoot}/agents/{agentId}/skills/` | Agent 包下的本地 Skill（SEARCH discovery） | agent-capability |
| Plugin 定义 | `plugin.json` + `index.js` | 插件元数据与入口 | agent-app plugin loader |

### configRoot 与 workspaceRoot

| 根 | 含义 | 典型路径 |
|---|---|---|
| `configRoot` | 配置和只读输入根 | 安装目录或指定目录 |
| `workspaceRoot` | 运行时工作空间根 | 用户数据目录 |

### 执行文件访问

从 `workspaceRoot/execution` 派生 accepted-run 逻辑根：

| 子目录 | 权限 | 用途 |
|---|---|---|
| `workspace/` | durable read/write | 需跨 run 保留的产物 |
| `.nextagent/` | system-managed | 系统管理的授权资源 |
| `temp/` | run-scoped scratch | 临时文件，run 结束可清理 |

Read/Write/Edit/Glob/Grep/Bash/Python 对无已知 root 前缀的相对路径统一使用 accepted-run execution view 根。

## 数据库文件

| 文件 | 路径 | 内容 |
|---|---|---|
| working-memory | `{workspaceRoot}/working-memory.sqlite` | session/message/timeline/checkpoint/pending-input/annotation/share |
| long-term-memory | `{workspaceRoot}/long-term-memory.sqlite` | 长期记忆 |
| nextagent | `{workspaceRoot}/nextagent.sqlite` | attachment/blob/trajectory/todo/question activity |

**三个独立文件，不读取旧单库、不双写、不运行时 fallback。**

## 日志与诊断文件

| 文件族 | 路径前缀 | 轮转 | retention |
|---|---|---|---|
| Operational log | `{logDir}/nextagent-operational` | 30MiB/daily/gzip/10 archive | 7 天 |
| Metrics | `{logDir}/nextagent-metrics` | 同上 | 7 天 |
| Audit | `{logDir}/nextagent-audit` | 同上 | 7 天 |
| Plugin diagnostic | `{logDir}/nextagent-plugin-diagnostic` | 同上 | 3 天 |
| Developer diagnostic artifact | `{logDir}/nextagent-plugin-diagnostic` | 同上 | 3 天 |

## 构建与验证入口

| 命令 | 工作目录 | 用途 |
|---|---|---|
| `npm run build` | 仓库根 | 后端编译 + builtin Skill asset 复制 |
| `npm test` | 仓库根 | 完整测试套件 |
| `npm run test:contract` | 仓库根 | 契约测试 |
| `npm run lint:architecture` | 仓库根 | 架构边界 lint |
| `npm run build` | `frontend/agent-web/` | 前端 TypeScript + Vite 构建 |
| `npm test -- ...` | `frontend/agent-web/` | 前端单元测试 |
| `npm run build:vite:modes` | `frontend/agent-web/` | 多宿主模式构建 |

**注意**：根 `npm run build` 不执行前端构建。

## Fullstack 打包边界

前端源码在 `frontend/agent-web/`，构建后以 `@nextagent/agent-web` npm artifact 进入 `agent-app` 静态托管。`agent-app-frontend-hosting` 注册静态资源路由和 SPA fallback。

→ 详见 [architecture-map.md](architecture-map.md)、[verification-gates.md](verification-gates.md)
