## 设计范围

| Function | 本次目标变化 | 涉及 delta specs | 设计章节 |
|---|---|---|---|
| `FN-8.1 持久化运行数据` | submit 和 editLatest 路径新增安全护栏拦截豁免；editLatest 路由接入 guardrail 检查 | `user-question-activity` | `guardBlockRefusal 豁免`、`editLatest 路由接入 guardrail` |

## guardBlockRefusal 豁免

### 当前实现

`createQuestionActivityTrackingCommandPort`（`packages/agent-session/src/services/question-activity-tracking-command-port.ts`）包装 `RuntimeCommandPort.submit` 和 `editLatest`：

```ts
async submit(command: SubmitRequestCommand) {
  const result = await inner.submit(command);
  trackQuestionActivity(command.inputText, command.identityContext, command.locale);
  return result;
},
async editLatest(command: EditLatestRequestCommand) {
  const result = await inner.editLatest(command);
  trackQuestionActivity(command.editedInputText, command.identityContext, command.locale ?? 'zh-CN');
  return result;
},
```

`trackQuestionActivity` 在 inner 命令返回后无条件执行，不检查 `guardBlockRefusal`。

### 修改方案

在 `submit` 和 `editLatest` 方法中，检查 `command.guardBlockRefusal` 是否存在，存在则跳过 `trackQuestionActivity`：

```ts
async submit(command: SubmitRequestCommand) {
  const result = await inner.submit(command);
  if (command.guardBlockRefusal === undefined) {
    trackQuestionActivity(command.inputText, command.identityContext, command.locale);
  }
  return result;
},
async editLatest(command: EditLatestRequestCommand) {
  const result = await inner.editLatest(command);
  if (command.guardBlockRefusal === undefined) {
    trackQuestionActivity(command.editedInputText, command.identityContext, command.locale ?? 'zh-CN');
  }
  return result;
},
```

## editLatest 路由接入 guardrail

### 当前实现

`agent-channel-web` 的 submit 路由在 `dependencies.guardrail !== undefined && dependencies.guardrailEnabled` 时先调 `guardrail.checkQuestion()`，`isLegal === false` 时传入 `guardBlockRefusal`。editLatest 路由没有 guardrail 检查。

### 修改方案

在 editLatest 路由中复用 submit 路由的 guardrail 检查模式：

```ts
if (dependencies.guardrail !== undefined && dependencies.guardrailEnabled) {
  const guardResult = await dependencies.guardrail.checkQuestion({
    questions: [body.editedInputText],
    ignoreItems: ['topic_limit'],
    locale: editLocale,
  });
  if (!guardResult.isLegal) {
    return dependencies.runtime.editLatest({
      ...
      guardBlockRefusal: guardResult.refusalMessage.trim().length > 0
        ? guardResult.refusalMessage
        : guardrailServiceUnavailableMessage(editLocale),
    });
  }
}
```

### runtime editLatest 处理 guardBlockRefusal

在 `editLatest` 方法中，`emitCanonical` 之后、`replaceOlderLaneWork` + `enqueueWork` 之前插入 guardrail 分支：

```ts
if (command.guardBlockRefusal !== undefined) {
  await this.commitTerminal(submitCommand, run, context, command.guardBlockRefusal, 'COMPLETED', {
    guardBlockedVisible: { refusalMessage: command.guardBlockRefusal },
  });
  await this.hideEditedSourceRequestMessages(command, run.agentId, context.requestContextId);
  return { sessionId: command.sessionId, requestId, runId, attempt: 1 };
}
```

与 submit 的 guardrail 分支同构：commitTerminal COMPLETED + 不 enqueueWork。区别是 editLatest 额外调用 `hideEditedSourceRequestMessages`（编辑场景需要隐藏被编辑的旧消息）。

### 公共契约变更

`EditLatestRequestCommand` 新增 `guardBlockRefusal?: string` 可选字段，语义和 `SubmitRequestCommand.guardBlockRefusal` 完全一致。

## 验证策略

1. **新增测试**：submit 和 editLatest 时 `guardBlockRefusal` 存在，断言 `upsertActivity` 不被调用。
2. **回归测试**：submit 和 editLatest 时 `guardBlockRefusal` 不存在，断言 `upsertActivity` 被调用（已有测试覆盖）。
3. **全量测试**：`packages/agent-session/tests/` 和 `packages/agent-core/tests/` 全部通过。
4. **构建**：`npm run build` 通过。

## 长期基线刷新计划

- 归档时将 `openspec/specs/user-question-activity/spec.md` 中 "ask_frequency 增长时机" Requirement 替换为本 change 的 MODIFIED 版本。
- 新增 "安全护栏拦截的 submit 不记录问题活动" 和 "安全护栏拦截的 editLatest 不记录问题活动" Scenario。

## 已知 follow-up

### `guardBlockRefusal` 契约无 stable spec 归属

`SubmitRequestCommand.guardBlockRefusal` 由 commit `785602f1b`（`refine(guardrail): make input-guard-blocked round a normal run lifecycle`）引入，但该 refine 未对应 OpenSpec change 更新 `ts-core-contracts` stable spec。`ts-core-contracts` spec 定义了 `SubmitRequestCommand` 的 `routingConstraints`、`requestModelOptions` 等字段，但缺少 `guardBlockRefusal` 的 Requirement。本次新增 `EditLatestRequestCommand.guardBlockRefusal` 沿用了这个已存在的缺口。

**Follow-up**：应单独提交一个 OpenSpec change，在 `ts-core-contracts` spec 中为 `SubmitRequestCommand.guardBlockRefusal` 和 `EditLatestRequestCommand.guardBlockRefusal` 补充 Requirement，描述 input-guard-blocked round 的契约语义（runtime MUST commitTerminal COMPLETED + 不 enqueueWork + `guardBlockedVisible` terminal option）。不在本次 change 范围内。
