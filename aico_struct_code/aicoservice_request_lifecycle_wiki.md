# AICOService 外部请求到 Agent 执行的调用流程

## 1. 文档范围

本文说明 AICOService 启动后，一个外部 POST 请求如何经过 HTTP 路由、请求投影、Runtime 受理、调度队列，最终启动 Agent，并将执行事件返回给调用方。

本文主要跟踪 AICOService 显式提供的 A2A-T 接口：

```text
POST /rest/naie/aicoservice/v1/a2at/task
```

同时补充通用 Web 接口作为对照：

```text
POST /api/v1/requests
POST /api/v1/sessions/:sessionId/requests
```

本文在 Agent 被启动后，只描述通用执行框架，不展开 Quick-QA、Recipe 或具体 YAML 工作流的内部逻辑。

---

## 2. 总体调用链

```text
外部 HTTP 请求
    │
    ▼
Sidecar / 网关转发到 Unix Domain Socket
    │
    ▼
Fastify 路由
    │
    ├── A2A-T：POST /rest/naie/aicoservice/v1/a2at/task
    │
    └── Web：POST /api/v1/requests
             POST /api/v1/sessions/:sessionId/requests
    │
    ▼
协议请求投影为 Runtime Command
    │
    ▼
runtime.submit()
    ├── 创建或校验 Session
    ├── 确定 Session 绑定的 Agent
    ├── 创建 requestId / runId / requestContextId
    ├── 持久化用户消息和 QUEUED Run
    ├── 发布 REQUEST_ACCEPTED 事件
    └── enqueueWork()
    │
    ▼
Runtime Scheduler
    ├── 选择待执行任务
    ├── 将 Run 改为 EXECUTING
    └── 获得 Agent 实例
    │
    ▼
DefaultAgent.execute()
    ├── 校验 Run 与 Context
    ├── 解析执行路由
    ├── 组装上下文并执行模型/能力循环
    └── 生成最终执行结果
    │
    ▼
Runtime 提交终态并发布 Timeline Event
    │
    ▼
A2A-T POST 通过 SSE 持续返回事件
```

这里最重要的边界是：

> `runtime.submit()` 负责受理请求并把它放入 Runtime 调度体系；Scheduler 才负责异步启动 Agent。A2A-T POST 在受理后不会立即断开，而是继续订阅 Runtime 事件并通过 SSE 返回执行过程。

---

## 3. 服务启动与路由准备

### 3.1 启动脚本执行 `start.js`

部署启动脚本设置配置目录和远程部署模式，然后执行 AICO Channel 的入口文件：

```bash
export NEXTAGENT_CONFIG_DIR=${APP_ROOT}/config
export NEXTAGENT_DEPLOYMENT_MODE=remote

node ${APP_ROOT}/node_modules/@nextagent/agent-channel-aico/dist/entrypoints/start.js
```

出处：

- 文件索引 S01：`aicoservice@27.68.169/bin/start.sh`
- 行号：75-80

### 3.2 `start.js` 启动通用 Runtime，并注册 AICO 专用路由

`start.js` 调用 `startRemoteRuntimePackage()`。传入的 `beforeStart` 回调负责把 A2A-T、PUB、配置和 BI 导出等 AICO 专用路由挂载到通用 Fastify Server 上。

```js
app = await startRemoteRuntimePackage('.', {
    async beforeStart(nextAgentApp) {
        const a2atDependencies = {
            runtime: nextAgentApp.runtime,
            sessions: nextAgentApp.runtime,
            identityResolver: () => ({ /* ... */ }),
            defaultAgentId: brand(
                process.env.A2AT_DEFAULT_AGENT_ID ?? 'AICOServiceAgent'
            )
        };

        await registerA2atTaskForwardRoute(
            nextAgentApp.server,
            a2atDependencies
        );
        await registerA2atTaskCancelRoute(
            nextAgentApp.server,
            a2atDependencies
        );
    }
});
```

出处：

- 文件索引 S02：`aicoservice@27.68.169/node_modules/@nextagent/agent-channel-aico/dist/entrypoints/start.js`
- 行号：41-65

这里的 `defaultAgentId` 只是在 A2A-T 请求没有通过已有 Session 确定 Agent 时，为请求投影提供默认 Agent ID。默认值是 `AICOServiceAgent`，但可以由 `A2AT_DEFAULT_AGENT_ID` 环境变量覆盖。

### 3.3 `beforeStart` 在 Server 开始监听前执行

远程部署框架先创建完整的 `NextAgentApp`，再执行初始化和 `beforeStart`，最后调用 `app.start()`：

```js
const app = await createNextAgentAppAsync(...);
await runPostCreateInit(app, options);

async function runPostCreateInit(app, options) {
    // 初始化认证、操作日志和远程服务
    await options.beforeStart?.(app);
    await app.start();
}
```

出处：

- 文件索引 S03：`aicoservice@27.68.169/node_modules/@nextagent/agent-platform-gateway-remote/dist/entrypoints/remote-start.js`
- 行号：795-835

因此，Fastify 真正开始接收请求时，A2A-T 路由已经注册完成。

### 3.4 Fastify 监听 Unix Domain Socket

当前系统配置使用 Fastify，并监听：

```json
{
  "channel": {
    "transport": "fastify",
    "udsPath": "/opt/sidecar/backend/http.sock"
  },
  "hostedAgent": {
    "activeAgentId": "AICOServiceAgent"
  }
}
```

出处：

- 文件索引 S04：`aicoservice@27.68.169/config/default-system.yaml`
- 行号：38-44

启动阶段根据 `udsPath` 调用 Fastify 的 `listen()`：

```js
if (input.systemConfig.channel.udsPath) {
    await input.server.listen({
        path: input.systemConfig.channel.udsPath
    });
}
```

出处：

- 文件索引 S05：`aicoservice@27.68.169/node_modules/@nextagent/agent-app/dist/composition/app-lifecycle-composition.js`
- 行号：148-166

所以从部署拓扑看，外部请求通常先到达网关或 Sidecar，再被转发到 `/opt/sidecar/backend/http.sock`；Node.js 进程本身不一定监听对外 TCP 端口。

---

## 4. A2A-T POST 请求入口

### 4.1 Fastify 命中任务转发路由

A2A-T 路由直接注册在主 Fastify 实例上：

```js
instance.post(
    '/rest/naie/aicoservice/v1/a2at/task',
    { schema: { body: A2atTaskRequestSchema } },
    async (request, reply) => {
        // 处理请求
    }
);
```

出处：

- 文件索引 S06：`aicoservice@27.68.169/node_modules/@nextagent/agent-channel-aico/dist/a2at/routes/task-forward.js`
- 行号：158-164

路由处理器依次完成：

1. 创建 HTTP Trace Span。
2. 校验请求体和消息内容。
3. 解析调用方身份。
4. 将 A2A-T 请求投影成 Runtime Command。
5. 调用 Runtime。
6. 订阅 Timeline 事件并通过 SSE 返回。

对应主干代码：

```js
validateTaskRequest(request.body);
const taskRequest = Value.Parse(A2atTaskRequestSchema, request.body);
const identity = dependencies.identityResolver(request);

const projection = projectA2atTaskRequest(
    taskRequest,
    identity,
    dependencies.defaultAgentId,
    []
);

const { sessionId, requestId, runId } =
    await executeRuntimeCommand(
        projection,
        dependencies.runtime,
        httpSpan,
        dependencies.executionCorrelation
    );
```

出处：

- 文件索引 S06
- 行号：164-190

### 4.2 请求投影为 Runtime Command

`projectA2atTaskRequest()` 根据请求是否带有 `pendingInputId`，生成两种命令。

#### 新请求

没有 `pendingInputId` 时生成 `SubmitRequestCommand`：

```js
const submitCommand = {
    ...(sessionId !== undefined ? { sessionId } : {}),
    agentId,
    identityContext,
    inputText: sourcePrefix + inputText,
    attachmentIds,
    locale,
    routingConstraints,
    idempotencyKey
};

return {
    kind: 'SUBMIT',
    submitCommand,
    a2atTaskId: request.a2atTaskId,
    sessionId
};
```

出处：

- 文件索引 S07：`aicoservice@27.68.169/node_modules/@nextagent/agent-channel-aico/dist/a2at/projections/a2at-request.js`
- 行号：31-53

这个投影过程会：

- 从 `message` 中提取文本、结构化数据或文件描述；
- 在输入文本前增加 A2A-T 来源标识；
- 根据运行环境设置 `zh-CN` 或 `en-US`；
- 生成新的幂等键；
- 把 `AICOServiceAgent` 写入 `agentId`。

#### 回答等待中的 Agent

带有 `pendingInputId` 时生成 `AnswerPendingInputCommand`，用于恢复之前暂停的 Run：

```js
if (request.pendingInputId !== undefined) {
    const answerCommand = {
        identityContext,
        idempotencyKey,
        answer: {
            sessionId,
            pendingInputId,
            answers
        }
    };

    return { kind: 'ANSWER_PENDING', answerCommand };
}
```

出处：

- 文件索引 S07
- 行号：8-30

### 4.3 投影结果调用 Runtime

任务转发路由根据投影类型调用不同的 Runtime 方法：

```js
if (projection.kind === 'ANSWER_PENDING') {
    return runtime.answerPendingInput(projection.answerCommand);
}

if (projection.kind === 'SUBMIT') {
    return runtime.submit(projection.submitCommand);
}
```

出处：

- 文件索引 S06
- 行号：58-95

新问题由 `runtime.submit()` 进入执行系统；补充信息则由 `runtime.answerPendingInput()` 恢复已有执行。

---

## 5. `runtime.submit()` 如何受理请求

`runtime.submit()` 是 HTTP 接入层与 Agent Runtime 之间最关键的边界。

入口位置：

- 文件索引 S08：`aicoservice@27.68.169/node_modules/@nextagent/agent-runtime/dist/lifecycle/submit.js`
- 行号：652-854

### 5.1 创建或校验 Session

如果命令没有 `sessionId`，Runtime 会创建 Session；否则读取已有 Session：

```js
const session = command.sessionId === undefined
    ? await this.createSubmitSession(command)
    : await this.requireSession({
        identityContext: command.identityContext,
        sessionId: command.sessionId
    });
```

出处：

- 文件索引 S08
- 行号：662-678

Session 一旦创建，就会绑定 Agent。已有 Session 不允许在后续请求中切换到不同的 Agent：

```js
if (
    command.agentId !== undefined &&
    command.agentId !== session.agentId
) {
    throw new AgentError({
        code: 'SUBMIT_AGENT_SCOPE_MISMATCH'
    });
}
```

出处：

- 文件索引 S08
- 行号：667-675

### 5.2 检查 Session 是否已有执行中的请求

Runtime 按租户、用户、Agent 和 Session 构造调度 Lane，并读取当前 Lane 状态：

```js
const laneKey = this.laneKey(
    tenantId,
    subjectId,
    session.agentId,
    session.sessionId
);

const laneSnapshot =
    await this.deps.requestRunStore.loadSessionLaneSnapshot(...);

if (laneSnapshot.executingRun !== undefined) {
    throw new AgentError({
        code: 'SESSION_HAS_RUNNING_REQUEST'
    });
}
```

出处：

- 文件索引 S08
- 行号：693-723

这保证同一个 Session 不会同时执行两个普通请求。

### 5.3 确定 Agent Assembly 并创建 Run

Runtime 根据 Session 绑定的 Agent 加载当前 Assembly：

```js
const assembly = acceptedCommand.agentVersion === undefined
    ? await this.deps.assemblyRegistry.active(session.agentId)
    : await this.deps.assemblyRegistry.require(
        session.agentId,
        acceptedCommand.agentVersion
    );
```

然后创建 Run，初始状态为 `QUEUED`：

```js
const run = {
    runId,
    sessionId,
    requestId,
    agentId: assembly.agentId,
    agentVersion: assembly.agentVersion,
    agentAssemblyRef: assembly.agentAssemblyRef,
    attempt: 1,
    priority,
    status: 'QUEUED',
    version: 1,
    terminalCommitState: 'NOT_STARTED',
    createdAt: now,
    updatedAt: now
};
```

出处：

- 文件索引 S08
- 行号：724-765

同时创建 Request Context，其中包括：

- 身份信息；
- 原始输入；
- Agent ID 和版本；
- 当前执行步骤；
- 生命周期阶段；
- 工具调用状态；
- 流程变量。

出处：

- 文件索引 S08
- 行号：766-788

### 5.4 持久化并发布受理事件

Run 正式进入队列前，Runtime 会：

```js
await this.lifecycleHookStageExecutor.invokeStage(
    ...,
    'BEFORE_REQUEST_ACCEPT',
    ...
);

await this.persistUserMessage(finalCommand, run);
await this.deps.requestRunStore.saveRun(...);
await this.saveCheckpoint(..., 'RUN_ACCEPTED');
await this.emitCanonical(..., {
    type: 'REQUEST_ACCEPTED'
}, ...);
```

出处：

- 文件索引 S08
- 行号：789-823

用户消息的具体持久化入口是：

```js
await this.deps.messageStore.appendSessionMessage({
    role: 'USER',
    content: command.inputText,
    visible: true,
    // sessionId、requestId、runId、agentId 等
});
```

出处：

- 文件索引 S08
- 行号：5002-5021

### 5.5 请求进入调度队列

受理完成后，Runtime 调用：

```js
this.enqueueWork({
    command: finalCommand,
    run,
    context,
    laneKey
});

return {
    sessionId,
    requestId,
    runId,
    attempt: 1
};
```

出处：

- 文件索引 S08
- 行号：842-845

`enqueueWork()` 将任务放入 Lane 队列并唤醒 Scheduler：

```js
enqueueWork(work, options = {}) {
    const queue = this.pendingLaneWork.get(work.laneKey) ?? [];
    queue.push(work);
    this.pendingLaneWork.set(work.laneKey, queue);

    if (options.startDispatch !== false) {
        this.wakeScheduler();
    }
}
```

出处：

- 文件索引 S08
- 行号：2099-2114

因此 `runtime.submit()` 返回表示请求已经被可靠受理，并不表示 Agent 已经执行完成。

---

## 6. Scheduler 如何真正启动 Agent

### 6.1 Scheduler 选择任务

`wakeScheduler()` 异步启动调度循环：

```js
wakeScheduler() {
    this.schedulerRunning = true;
    void this.runSchedulerLoop();
}

async runSchedulerLoop() {
    while (this.executingRuns.size + this.inflightCount
           < this.maxConcurrentRuns()) {
        const reservation = this.reserveNextWork();
        if (reservation === undefined) break;
        void this.dispatchReservedWork(reservation);
    }
}
```

出处：

- 文件索引 S08
- 行号：3390-3415

队列按 Lane 隔离，并根据 `HIGH`、`NORMAL`、`LOW` 优先级选择任务。

### 6.2 Run 从 `QUEUED` 变成 `EXECUTING`

调度器确认持久层中的 Run 仍然可执行后，调用 `startRun()`：

```js
const run = await this.startRun(
    work.command,
    this.toRuntimeRun(durable)
);
```

出处：

- 文件索引 S08
- 行号：3445-3489

`startAcceptedRun()` 将状态改为 `EXECUTING`，并使用版本号进行并发保护：

```js
const executing = {
    ...run,
    status: 'EXECUTING',
    version: run.version + 1,
    updatedAt: now()
};

await requestRunStore.saveRun(executing, {
    expectedVersion: run.version
});
```

出处：

- 文件索引 S09：`aicoservice@27.68.169/node_modules/@nextagent/agent-runtime/dist/lifecycle/dispatcher.js`
- 行号：3-11

### 6.3 根据 Assembly 获取 Agent 实例

执行阶段重新读取冻结的 Agent Assembly，然后从 `AgentInstanceManager` 获取 Agent：

```js
const assembly = await this.deps.assemblyRegistry.require(
    run.agentId,
    run.agentVersion
);

const agent = this.agentManager.getOrCreate(assembly);
const agentOutcome = await agent.execute(
    run,
    work.context,
    executionState.controller.signal
);
```

出处：

- 文件索引 S08
- 行号：3533-3568

`AgentInstanceManager` 使用以下组合作为实例缓存键：

```text
agentId : agentVersion : agentAssemblyRef
```

并根据 `assembly.agentType` 选择已注册的 Agent 构造器：

```js
const constructor = this.constructors.get(assembly.agentType);
const agent = new constructor({
    ...this.deps.agentRuntimeDependencies,
    runState: this.deps.runState
});
```

出处：

- 文件索引 S10：`aicoservice@27.68.169/node_modules/@nextagent/agent-runtime/dist/lifecycle/agent-instance-manager.js`
- 行号：24-36

---

## 7. `AICOServiceAgent` 与 `DefaultAgent` 的关系

Runtime 组合阶段注册的是通用 Agent 执行类：

```js
const runtime = createRequestLifecycleCoordinator({
    agentConstructors: [DefaultAgent],
    // 其他运行时依赖
    defaultRouteAgentId: input.systemConfig.activeAgentId
});
```

出处：

- 文件索引 S11：`aicoservice@27.68.169/node_modules/@nextagent/agent-app/dist/composition/request-runtime-composition.js`
- 行号：52-75、243-247

两者承担不同职责：

| 名称 | 作用 |
|---|---|
| `AICOServiceAgent` | 业务 Agent ID，用于选择 Agent Assembly、配置、能力和版本 |
| `DefaultAgent` | 通用执行引擎，实现上下文组装、模型调用、能力调用和多轮执行循环 |

因此，并不是存在一个名为 `AICOServiceAgent` 的 JavaScript 类。实际运行关系是：

```text
AICOServiceAgent 的 Assembly
          +
DefaultAgent 通用执行器
          ↓
本次请求使用的 Agent 实例
```

`BaseAgent.execute()` 首先校验 Run 与 Context 的 ID 是否一致，再进入具体执行：

```js
async execute(run, context, signal) {
    this.assertRunContext(run, context);
    return (await this.executeRun(run, context, signal))
        ?? { status: 'COMPLETED' };
}
```

出处：

- 文件索引 S12：`aicoservice@27.68.169/node_modules/@nextagent/agent-core/dist/agent/base-agent.js`
- 行号：7-22

`DefaultAgent.executeRun()` 随后进入通用执行过程：解析附件、确定路由、组装上下文、执行模型或能力循环，并产生执行结果。

出处：

- 文件索引 S13：`aicoservice@27.68.169/node_modules/@nextagent/agent-core/dist/agent/default-agent.js`
- 行号：32-47、125-161、352-493、767-856

---

## 8. Agent 执行结束与终态提交

Agent 返回后，Runtime 从 `runState` 汇总最终输出：

```js
const output = await this.runState.finishRun(run);

const terminalStatus = executionState.superseded
    ? 'SUPERSEDED'
    : output.outputExceeded
        ? 'FAILED'
        : 'COMPLETED';

await this.commitExecutionTerminal(
    work.command,
    run,
    work.context,
    terminalContent,
    terminalStatus
);
```

出处：

- 文件索引 S08
- 行号：3581-3607

异常、取消、等待用户输入也在同一个执行边界内处理：

- `PENDING_INPUT`：Run 暂停，等待后续 `answerPendingInput()`；
- `CANCELED`：提交取消终态；
- 执行异常：转为安全的 `FAILED` 终态；
- 正常完成：提交 `COMPLETED` 终态。

无论成功或失败，执行清理阶段都会释放当前 Run 并再次唤醒 Scheduler：

```js
finally {
    this.leaveExecutingRun(run.runId);
    this.drainingLanes.delete(work.laneKey);
    this.wakeScheduler();
}
```

出处：

- 文件索引 S08
- 行号：3609-3696

---

## 9. A2A-T 如何通过同一个 POST 返回执行结果

`runtime.submit()` 返回 `sessionId`、`requestId` 和 `runId` 后，A2A-T 路由把当前 HTTP 响应切换为 SSE：

```js
reply.raw.setHeader('Content-Type', 'text/event-stream');
reply.raw.setHeader('Cache-Control', 'no-cache');
reply.raw.setHeader('Connection', 'keep-alive');
```

接着构造 Stream Query 并订阅 Runtime Timeline：

```js
const streamQuery = {
    identityContext: identity,
    sessionId,
    requestId,
    runId,
    lastSeenSequence: 0,
    signal: abortController.signal
};

const eventStream =
    dependencies.sessions.streamEvents(streamQuery);

await streamSseEvents(
    eventStream,
    reply,
    taskRequest,
    sessionId,
    projection
);
```

出处：

- 文件索引 S06
- 行号：191-214

`streamSseEvents()` 将每个 Timeline Event 投影成 A2A-T TaskResponse，然后写入当前 POST 连接：

```js
for await (const event of eventStream) {
    const taskResponse = projectA2atTaskResponse(event, ...);
    reply.raw.write(`data: ${JSON.stringify(taskResponse)}\n\n`);

    if (isTerminalEvent(event.type)) break;
    if (isUserInputRequiredEvent(event.type)) break;
}
```

出处：

- 文件索引 S06
- 行号：97-133

核心状态映射如下：

| Runtime Timeline Event | A2A-T 状态 |
|---|---|
| `REQUEST_ACCEPTED` | `CREATED` |
| `LLM_*`、`CAPABILITY_*` | `STREAMING` |
| `USER_INPUT_REQUIRED` | `PENDING` |
| `REQUEST_COMPLETED` | `COMPLETED` |
| `REQUEST_FAILED`、`REQUEST_CANCELED`、`REQUEST_SUPERSEDED` | `ERROR` |

出处：

- 文件索引 S14：`aicoservice@27.68.169/node_modules/@nextagent/agent-channel-aico/dist/a2at/projections/a2at-response.js`
- 行号：217-243

A2A-T POST 连接会在以下情况结束：

- Run 正常完成；
- Run 失败、取消或被替代；
- Agent 请求用户补充信息，进入 `PENDING`。

---

## 10. 通用 Web POST 与 A2A-T POST 的区别

通用 Web Channel 在应用组合阶段注册：

```js
registerWebChannel(context.server, {
    runtime: context.runtimeCommands,
    sessions: context.runtime,
    defaultAgentId: context.systemConfig.activeAgentId,
    // 其他依赖
});
```

出处：

- 文件索引 S15：`aicoservice@27.68.169/node_modules/@nextagent/agent-app/dist/composition/channel-composition.js`
- 行号：153-214

Web Channel 提供两种提交方式。

### 已有 Session

```text
POST /api/v1/sessions/:sessionId/requests
```

它先校验 Session 和 JSON Body，再调用 `submitStagedRequest()`，最终同样进入 `dependencies.runtime.submit()`。

出处：

- 文件索引 S16：`aicoservice@27.68.169/node_modules/@nextagent/agent-channel-web/dist/routes/requests.js`
- 行号：900-931、1688-1779

### 便捷提交

```text
POST /api/v1/requests
```

如果请求没有 `sessionId`，该接口会先创建 Session，再提交请求。

出处：

- 文件索引 S16
- 行号：933-978

两类入口在 `runtime.submit()` 后共享同一套 Runtime、Scheduler 和 Agent 执行链。主要区别在响应方式：

| 入口 | POST 响应方式 |
|---|---|
| A2A-T | 当前 POST 本身保持 SSE 长连接，持续输出事件 |
| 通用 Web | POST 返回 RequestAccepted；客户端再通过 Session Stream 接口订阅事件 |

---

## 11. 时序总结

```text
调用方              A2A-T Route              Runtime              Scheduler             Agent
  │                       │                      │                      │                    │
  │ POST /a2at/task       │                      │                      │                    │
  ├──────────────────────>│                      │                      │                    │
  │                       │ 校验/解析/请求投影    │                      │                    │
  │                       │ runtime.submit()     │                      │                    │
  │                       ├─────────────────────>│                      │                    │
  │                       │                      │ 创建/校验 Session     │                    │
  │                       │                      │ 持久化消息和 Run       │                    │
  │                       │                      │ REQUEST_ACCEPTED       │                    │
  │                       │                      │ enqueueWork()          │                    │
  │                       │<─────────────────────┤                      │                    │
  │                       │ session/request/run  │ wakeScheduler()       │                    │
  │                       │                      ├─────────────────────>│                    │
  │                       │                      │                      │ Run→EXECUTING      │
  │                       │                      │                      │ agent.execute()     │
  │                       │                      │                      ├───────────────────>│
  │                       │                      │                      │                    │ 执行通用 Agent 循环
  │                       │                      │ Timeline Events       │<───────────────────┤
  │                       │<─────────────────────┴──────────────────────┤                    │
  │<──────────────────────┤ SSE: CREATED/STREAMING/...                 │                    │
  │                       │                      │                      │                    │
  │<──────────────────────┤ SSE: COMPLETED / ERROR / PENDING           │                    │
  │                       │ 关闭当前响应流         │                      │                    │
```

---

## 12. 源码文件索引

| 索引 | 文件 | 关键行号 | 作用 |
|---|---|---:|---|
| S01 | `aicoservice@27.68.169/bin/start.sh` | 75-80 | 设置运行模式并启动 `start.js` |
| S02 | `aicoservice@27.68.169/node_modules/@nextagent/agent-channel-aico/dist/entrypoints/start.js` | 41-65 | 启动 Runtime，注册 AICO 专用路由和默认 Agent ID |
| S03 | `aicoservice@27.68.169/node_modules/@nextagent/agent-platform-gateway-remote/dist/entrypoints/remote-start.js` | 795-835 | 创建 App，调用 `beforeStart`，启动 Server |
| S04 | `aicoservice@27.68.169/config/default-system.yaml` | 38-44 | Fastify、UDS 和 Active Agent 配置 |
| S05 | `aicoservice@27.68.169/node_modules/@nextagent/agent-app/dist/composition/app-lifecycle-composition.js` | 148-166 | Fastify 监听 UDS 或 TCP |
| S06 | `aicoservice@27.68.169/node_modules/@nextagent/agent-channel-aico/dist/a2at/routes/task-forward.js` | 58-95、97-133、158-215 | A2A-T POST 入口、Runtime 调用和 SSE 输出 |
| S07 | `aicoservice@27.68.169/node_modules/@nextagent/agent-channel-aico/dist/a2at/projections/a2at-request.js` | 8-53 | A2A-T 请求投影为 Runtime Command |
| S08 | `aicoservice@27.68.169/node_modules/@nextagent/agent-runtime/dist/lifecycle/submit.js` | 652-854、2099-2114、3390-3696、5002-5021 | 请求受理、持久化、排队、调度和终态处理 |
| S09 | `aicoservice@27.68.169/node_modules/@nextagent/agent-runtime/dist/lifecycle/dispatcher.js` | 3-11 | Run 从 `QUEUED` 转为 `EXECUTING` |
| S10 | `aicoservice@27.68.169/node_modules/@nextagent/agent-runtime/dist/lifecycle/agent-instance-manager.js` | 24-36 | 根据 Assembly 获取或创建 Agent 实例 |
| S11 | `aicoservice@27.68.169/node_modules/@nextagent/agent-app/dist/composition/request-runtime-composition.js` | 52-75、243-300 | 组合 Runtime，注册 `DefaultAgent` |
| S12 | `aicoservice@27.68.169/node_modules/@nextagent/agent-core/dist/agent/base-agent.js` | 7-22 | Agent 执行统一入口和上下文校验 |
| S13 | `aicoservice@27.68.169/node_modules/@nextagent/agent-core/dist/agent/default-agent.js` | 32-47、125-161、352-493、767-856 | 通用 Agent 执行循环 |
| S14 | `aicoservice@27.68.169/node_modules/@nextagent/agent-channel-aico/dist/a2at/projections/a2at-response.js` | 217-243 | Runtime Event 到 A2A-T 状态的映射 |
| S15 | `aicoservice@27.68.169/node_modules/@nextagent/agent-app/dist/composition/channel-composition.js` | 153-214 | 注册通用 Web Channel |
| S16 | `aicoservice@27.68.169/node_modules/@nextagent/agent-channel-web/dist/routes/requests.js` | 900-978、1688-1779 | Web POST 请求进入 `runtime.submit()` |

---

## 13. 一句话结论

AICOService 接收到外部 POST 后，HTTP 路由不会直接执行某个业务 YAML，而是先把协议请求转换成统一的 Runtime Command；`runtime.submit()` 完成 Session/Run 建立、消息持久化和入队，Scheduler 随后异步创建或复用 `DefaultAgent` 实例执行该 Run，执行过程中产生的 Timeline Event 再由 A2A-T 路由通过原 POST 的 SSE 长连接返回给调用方。
