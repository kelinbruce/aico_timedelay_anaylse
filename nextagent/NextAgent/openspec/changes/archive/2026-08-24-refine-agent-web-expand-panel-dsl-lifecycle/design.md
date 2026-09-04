## 设计要点

### 内容来源状态

`ExpandPanelState` 增加 `contentSource`，用于区分当前谁在控制扩展面板内容：

- `'react'`：`setContent` 写入的结构化内容（TEXT/FILE/OPERATOR/...）。
- `'view'`：`setView` 写入的 React 视图页（收藏夹、记忆管理、投诉历史、定时任务）。
- `'dsl'`：DSL 引擎通过 `init` 直接接管容器渲染。
- `null`：面板关闭。

### 生命周期回调

`ExpandPanelStore` 提供 `registerDslClearHandler(handler)` 注册一个无参回调。当 `contentSource === 'dsl'` 时发生以下任一情况，调用该回调：

- `close()` 被调用（外部关闭）。
- `setContent()` 被调用（切换到 React 结构化内容）。
- `setView()` 被调用（切换到视图页）。

DSL 引擎正常关闭（调用 `handleExpandPanel(false)`）时，走 `closeDsl()`，不触发回调。

### 容器 key 与 DOM 清理

`ExpandPanel` 容器 div 使用 `contentSource` 作为 React key。来源切换时 React 重新挂载容器，自动清空 DSL 注入的 DOM。

### 宿主注册

`ImmersiveApp` 与 `AIAgentPiuRuntime` 都通过 `PiuContext` 拿到 `piu`，注册：

```ts
expandPanelStore.getState().registerDslClearHandler(() => {
  piu?.emit('smart-canvas:clearExpandPanel');
});
```

卸载时取消注册。

### 与现有互斥逻辑的关系

扩展面板与 TurnRunGraphPanel 的互斥逻辑保持不变。当 DSL 来源被 graph 打开而关闭时，同样触发 DSL 清理回调。
