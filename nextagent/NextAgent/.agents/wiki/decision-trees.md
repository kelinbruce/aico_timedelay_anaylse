---
sources:
  - AGENTS.md
  - openspec/designs/architecture/core-contracts.md
last-verified: 2026-09-01
---

# 开发决策树："X 应该放在哪？"

面对常见开发决策时的快速指引。每个决策给出唯一答案和理由。

→ 包职责详解详见 [architecture-map.md](architecture-map.md)
→ 边界不变量详见 [package-ownership.md](package-ownership.md)
→ 前端专用决策详见 [frontend-rules.md](frontend-rules.md)

## 1. 新增一个类型/接口，应该放在哪个包？

```
这个类型是什么？
│
├─ 跨多个包共享的 branded ID / enum / 工具类型
│  → agent-common
│  约束: 不放 DO、DTO、Record、port 或业务服务
│
├─ 包间协作的 public DTO / schema / port interface
│  → agent-contracts 的对应 subpath
│  约束: 只依赖 agent-common 和 @sinclair/typebox
│
├─ Gateway 持久化的入参或返回值
│  → agent-contracts/gateway (*Record)
│  约束: 只引用 agent-common 和 gateway 自身 vocabulary
│  禁止: 让 *Record 继承 *Request
│
├─ Web/channel 层的公开 API 响应结构
│  → agent-channel-web 内部定义 (DTO)
│  约束: 不进入领域服务 public return
│
├─ Gateway-local 内部的 DB 行/实体
│  → agent-platform-gateway-local 内部 (PO)
│  约束: 只允许停留在 gateway-local 私有实现
│
└─ 领域服务的内部 read model
   → 对应领域包内部 (DO)
   约束: 不暴露为 public return 的 Record
```

## 2. 新增一个字段，应该加在哪个层？

```
这个字段的消费者是谁？
│
├─ 前端显示用（displayTitle, lastActivityAt, cursor, nextCursor, attachments）
│  → agent-channel-web schema/projection 层 (public Web alias)
│  约束: 内部 read model 必须使用 canonical 字段
│
├─ 持久化事实（需要写入/读取 SQLite）
│  → *Record (agent-contracts/gateway)
│  → *Row (agent-platform-gateway-local 私有)
│  约束: Record 是 port 边界，Row 是实现细节
│
├─ 领域逻辑使用
│  → DO (对应领域包内部)
│  → agent-common (如果是跨包 vocabulary)
│  约束: 不通过 Record 传领域语义
│
└─ 模型输入/输出
   → agent-contracts/model (ModelMessage, ModelFinalResult)
   或 agent-contracts/context (ContextAssembly)
```

## 3. 新增业务逻辑，应该放在哪个包？

```
逻辑的性质是什么？
│
├─ 请求生命周期控制（admission、lane、terminal commit、recovery）
│  → agent-runtime
│
├─ Agent 内部路由/调度（model/tool loop、业务分支）
│  → agent-core
│
├─ Workflow 节点执行
│  → agent-workflow
│  禁止: workflow 不拥有 request lifecycle / cancel / checkpoint / terminal commit
│
├─ 上下文选择/组装/compaction
│  → agent-context-engine
│
├─ 能力治理（discovery/binding/authorization/invocation）
│  → agent-capability
│
├─ 模型调用/provider 适配
│  → agent-model
│
├─ 长期记忆 CRUD/lifecycle
│  → agent-memory
│
├─ 持久化 row mapping / CAS / 事务
│  → agent-platform-gateway-local (或 remote)
│  禁止: gateway 不反推业务语义
│
├─ HTTP/SSE/WS 传输和 DTO 投影
│  → agent-channel-web (或 task)
│  禁止: channel 不拥有 request lifecycle / trusted identity
│
├─ 结构化日志/trace/metric/audit
│  → agent-observability
│
└─ 启动编排/配置冻结
   → agent-app
   禁止: agent-app 不写业务逻辑
```

## 4. 新增持久化，应该用什么模式？

```
持久化的性质是什么？
│
├─ 简单写入（单事实 create/update）
│  → Record + write options
│  约束: idempotencyKey、expectedVersion 属于 command metadata，不塞进 Record
│  禁止: 为同形 record + idempotencyKey 新增一次性 *WriteRequest/*AppendRequest
│
├─ 查询/过滤
│  → 专门 request type (如 SessionLookupRequest)
│
├─ 多事实复合事务
│  → gateway 单一 composite write + 单一数据库事务
│  约束: runtime/application 组装 Record，gateway-local 只做事务
│
├─ 幂等写入
│  → 锚点事实表原则
│  约束: 按 owner scope + agent scope + 业务坐标建立 scoped uniqueness
│  禁止: 独立 idempotency store（除非无清晰锚点且已写入 OpenSpec design）
│
└─ 状态推进
   → CAS transition
   禁止: 为"看起来幂等"追加无法锚定的伪 operation key
```

## 5. 新增 API 端点，应该走哪个 surface？

```
调用方是谁？
│
├─ 浏览器用户
│  → ER Surface (/api/v1/...)
│  → agent-channel-web
│  可用: 所有端点、WebSocket、multipart upload
│
├─ 后台系统（NMS/编排/告警）
│  → IR Surface (/api/v1/ir/...)
│  → agent-channel-web (routePrefix 参数)
│  只暴露 6 个端点: create session, submit, stream, cancel, retry, answer pending
│  认证: x-tenant-id + x-subject-id header
│  不可用: UI-only 端点、WebSocket、multipart
│
└─ 异步机机 + Callback
   → Task Channel (/api/v1/tasks/..., /api/v1/stream-task/..., /api/v1/async-tasks/...)
   → agent-channel-task
   认证: 自定义（与 ER/IR 隔离）
```

## 6. 新增能力（Capability），应该用什么 kind？

```
能力的性质是什么？
│
├─ 单次函数调用，模型通过 tool_use 调用
│  → TOOL (CapabilityKind.TOOL)
│  举例: bash, glob, read, write, rag, AskUserQuestion
│
├─ 带声明式的技能包，有 manifest 和 prompt
│  → SKILL (CapabilityKind.SKILL)
│  举例: 巡检分析、配置核查
│
├─ 子 Agent 调用，创建 child session/run
│  → AGENT (CapabilityKind.AGENT)
│  举例: 定向诊断 subagent
│
└─ 确定性流程编排，有 recipe 和节点图
   → WORKFLOW (CapabilityKind.WORKFLOW)
   举例: 报告生成、多步骤巡检
```

## 7. 前端需要新功能，应该放在哪里？

```
功能的性质是什么？
│
├─ 对话交互（消息、流式、编辑、重试）
│  → features/chat/
│
├─ 输入交互（composer、命令、草稿）
│  → features/composer/
│
├─ 侧边栏（会话列表、活动状态）
│  → features/sidebar/
│
├─ 结构化内容展示（expand panel）
│  → features/expand-panel/
│
├─ 长期记忆管理
│  → features/memory/
│
├─ 知识管理
│  → features/knowledge/
│
├─ Run Graph 可视化
│  → features/run-graph/
│
├─ Skill 选择
│  → features/skill-selector/
│
├─ 宿主模式集成
│  → host/ (通用) 或 entries/ (入口)
│
├─ API 调用
│  → services/ (SSE, REST, WebSocket 客户端)
│
├─ 状态管理
│  → state/ (Zustand stores)
│
└─ 其他
   → features/ 下新建模块
```

## 8. 新增一个跨层字段，要改哪些文件？

这是最常见的多步操作。假设要给 Session 加一个新字段 `foo`：

```
第 1 步：OpenSpec change
│ openspec/changes/add-session-foo/
│ → proposal.md + design.md + tasks.md

第 2 步：agent-common（如需跨包共享的 enum/常量）
│ packages/agent-common/src/

第 3 步：agent-contracts/gateway（Record 层）
│ packages/agent-contracts/src/gateway/session-record.ts
│ → SessionRecord 加 foo 字段 + TypeBox Schema

第 4 步：agent-platform-gateway-local（PO/Row 层）
│ packages/agent-platform-gateway-local/src/session/
│ → SessionRow 加 foo 列
│ → rowToRecord / recordToRow 映射
│ → Kysely schema migration

第 5 步：领域层（DO）
│ packages/agent-session/src/
│ → 领域对象/internal read model 加 foo
│ → Record ↔ DO 转换

第 6 步：agent-channel-web（DTO 层，如需 Web 暴露）
│ packages/agent-channel-web/src/
│ → Web DTO/Schema 加 foo
│ → DO → DTO 投影
│ → 注意：如果是 public Web alias（如 displayTitle）只在 projection 层加

第 7 步：验证
│ → npm run build
│ → npm test
│ → npm run test:contract
│ → npm run lint:architecture
│ → 确认 schema smoke test 覆盖新字段
```

**关键约束检查清单**：

| 检查项 | 要求 |
|---|---|
| Record 有 foo？ | 是 |
| Record 引用了其他 subpath？ | 禁止，只能引用 agent-common + gateway vocabulary |
| Row 有 foo？ | 是，只在 gateway-local 私有 |
| Web response 有 foo？ | 只在 DTO，不在 Record 直出 |
| 查询带 agentId？ | 主路径查询必须同时带 owner scope + agent scope |
| Schema validation？ | 不可信边界必须 runtime schema validation |
| OpenSpec 先行？ | 必须先有 change |

**前端永远不拥有的**：request lifecycle、canonical stream/history truth、trusted identity、Agent/Owner Scope、capability authority、persistence。
