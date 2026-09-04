# 长期记忆公开契约调整确认记录

## 状态

- 状态：`APPROVED`
- Issue：[#277](https://gitcode.com/gdd_hw/NextAgent/issues/277)
- OpenSpec change：`add-ts-memory-application-contract`
- 确认日期：2026-07-17
- 证据来源：用户在当前 Codex 任务中两次明确转述群内评审结论，并确认“群里评审通过了”
- 群平台、群名称、消息链接或消息 ID：未提供，后续可补充

## 已确认结论

1. 之前长期记忆 Gateway 公开接口调整的契约修改，群内确认无问题。
2. 本次长期记忆管理接口调整已在群内确认。
3. 评审确认的唯一合适路径是：

```text
agent-channel-web
  -> agent-contracts/channel.LongTermMemoryManagementPort
  -> agent-memory application service
  -> agent-contracts/gateway long-term memory ports
```

4. `agent-app` 仅负责 composition/wiring，不承载 management DTO mapping、Record projection、记忆业务校验或 Gateway delegation。
5. 不新增 `agent-contracts/memory` subpath；长期记忆 management port 和相关 management DTO 放在已有 `agent-contracts/channel`。
6. Channel 不接收、不导入、不调用 `LongTermMemoryGatewayBindings` 或长期记忆 Store/Retriever/Sharing Gateway ports。

## 实施约束

- `LongTermMemoryManagementPort` 覆盖现有 12 个长期记忆 management operation，不增加 count、batch 或兼容别名。
- management DTO 与 Gateway Request、Query、Record、Result、write options 分层，两个 subpath 不互相导入。
- `agent-memory` 实现 management port，并负责 management DTO 与 Gateway DTO 的映射。
- `agent-app` 只选择 Gateway bindings、调用 `agent-memory` factory并注入返回 port。
- 任何重新新增 `agent-contracts/memory`、Channel 直连 Gateway、让 Channel 依赖 `agent-memory` implementation，或把业务映射放进 `agent-app` 的方案，都需要重新群内确认。

## 后续专家评审闭环

- 专家意见：长期记忆 management command/query 应传递 frozen core contract 已定义的完整 `IdentityContext`，不得另行展平 `tenantId` 和 `subjectId` 形成平行身份契约。
- 处理结论：`LongTermMemoryManagementScope` 调整为 `{ identityContext: IdentityContext, agentId: AgentId }`；Channel 原样传 trusted resolver 结果，Agent Scope 继续独立传递。
- Gateway 映射：`agent-memory` 只从 `IdentityContext` 提取 `tenantId` 和 `subjectId`，`displayName` 不进入 Gateway、REST response、日志或诊断。
- 状态：`RESOLVED`。

## 追溯信息

- 群平台：待补充
- 群名称或群 ID：待补充
- 原始消息链接或消息 ID：待补充
- 明确确认人：待补充

群评审结论已经生效，上述字段缺失不改变 `APPROVED` 状态；归档前应尽量补齐，以便长期审计。

## 最终 Review

- frozen contract disposition：`APPROVED`
- spec/architecture review 日期：2026-07-17
- spec/architecture disposition：`PASS_WITH_FOLLOW_UP`
- review 结论：唯一调用链、owner、DTO/Record 分层、scope、取消和 composition 设计合理，无架构阻断问题
- follow-up：实施前登记 roadmap；归档前尽量补齐群名称、确认人和原始消息链接或 ID
- code review：已执行 `$nextagent-code-review`；frozen contract、architecture boundary、minimal kernel、安全、OpenSpec consistency、Clean Code 和群确认记录均无 P0/P1/P2 代码问题，结论为 `PASS_WITH_FOLLOW_UP`
- implementation disposition：`READY_FOR_PR`
- OpenSpec authoring review：`PASS`；roadmap 主要 owner 已收敛为单一 `agent-memory`，公开契约群确认状态保持 `APPROVED`
- 已通过：`openspec validate --all --strict`（205/205）、`npm run build`、四个受影响 workspace 的 TypeScript build、`npm run test:contract`（275/275）、`npm run lint:architecture`（190/190）、focused tests（28/28）、排除无关 browser smoke 后的全仓单测（696/696）
- 明确排除：`agent-dev-workbench/tests/browser-smoke.test.ts` 依赖本机 Playwright Chromium；用户确认该用例与本次长期记忆提交无关并同意不执行，不作为本次代码问题或 push 阻断项
- follow-up：归档前尽量补齐群平台、群名称、确认人和原始消息链接或 ID
