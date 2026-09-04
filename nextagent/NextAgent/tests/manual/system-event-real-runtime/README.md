# 系统过程事件真实 Runtime 验证

本目录只用于人工集成验收，不参与默认 Agent、默认系统配置、构建 artifact 或发布包。它使用真实 MiniMax、标准 Runtime、公共 Web API、SSE、history API 和当前正式 `@nextagent/agent-web` artifact，补充确定性前端 E2E。

本目录层的 owner、职责边界、生命周期以及构建、打包和运行时影响，见 OpenSpec change `refine-system-event-business-language` 的 [`tests/manual/system-event-real-runtime/` 目录层架构评审结论](../../../openspec/changes/refine-system-event-business-language/design.md#testsmanualsystem-event-real-runtime-目录层架构评审结论)。评审结论为 `PASS`（2026-08-13）。

## 覆盖范围

| 场景 | 真实 Runtime 事件 | live/history | UI |
|---|---|---|---|
| `degradation` | `DEGRADATION_NOTICE` | SSE 与 run history 都必须存在且 code 相同 | 固定警告语义；code 默认收起、主动展开可见；完整运行图一致 |
| `context-compaction` | `CONTEXT_COMPACTED` | SSE 与 run history 都必须存在 | 固定信息语义；live 短暂提示出现；刷新只保留 durable 条目 |

`HOOK_DEGRADED` 不在该矩阵中。当前后端没有该事件的 producer、channel vocabulary 或 history projector；它继续由 `frontend/agent-web/tests/e2e/system-event-business-language.spec.cjs` 的 compatibility fixture 验证。

## 数据与隔离

- 失败 Tool code：`SYSTEM_EVENT_SCENARIO_FAILED`。
- degradation 服务端口：`3111`；context-compaction 服务端口：`3112`。
- context profile：`contextWindowTokens=13257`、`maxOutputTokens=256`；验证请求不覆盖 `maxOutputTokens`，因此 Runtime 的可用输入为 13257 units，严格大于 13000-unit 小窗口保护，并把测试触发点固定为 257 units。profile 的 `maxOutputTokens` 仅约束 provider 输出上限。
- 长上下文由脚本生成，正文长度为 24000 个 ASCII 字符左右，内容是重复的有界电信告警记录；固定短答指令放在文本开头，避免预算裁剪丢失指令。
- context Agent 显式禁用全部 builtin Tool；验证脚本由同一正式页面发起公共 request API，并只补充 `toolChoice=NONE`。首轮长上下文后最多追加 3 个有界短触发轮次，以首个真实产生 `CONTEXT_COMPACTED` 的 run 为验收目标。
- 两个场景分别写入本目录下被 `.gitignore` 排除的 `state/degradation` 与 `state/context-compaction`，不读取或修改默认服务数据。
- 验证输出只包含 session/request/run 坐标、事件类型、受控错误码、terminal status 和 history event type 清单；不输出 prompt、模型正文或 credential。

这些值属于测试资产，不是产品默认值或长期设计。环境变化时可以在本目录内调整，但不得改变 OpenSpec 定义的产品语义和隔离边界。

## 前置条件

1. 从仓库根目录完成依赖安装和前端 artifact 构建。
2. MiniMax token 已存入既有 macOS Keychain service `codex.nextagent.minimax.token`。
3. 目标端口没有被其他进程占用。

不得把 token 写入命令、配置、`.env`、日志或验证产物。

## degradation 场景

终端 A：

```bash
NEXTAGENT_APPLICATION_CONFIG="$PWD/tests/manual/system-event-real-runtime/config/degradation.yaml" \
  node /Users/gaoyang/.codex/tools/nextagent-minimax-launcher/src/cli.mjs start "$PWD"
```

listener ready 后，终端 B：

```bash
node tests/manual/system-event-real-runtime/verify.mjs \
  --scenario degradation \
  --base-url http://127.0.0.1:3111/
```

## context-compaction 场景

停止当前任务自己启动的 degradation 服务，确认 3112 未被占用后，终端 A：

```bash
NEXTAGENT_APPLICATION_CONFIG="$PWD/tests/manual/system-event-real-runtime/config/context-compaction.yaml" \
  node /Users/gaoyang/.codex/tools/nextagent-minimax-launcher/src/cli.mjs start "$PWD"
```

listener ready 后，终端 B：

```bash
node tests/manual/system-event-real-runtime/verify.mjs \
  --scenario context-compaction \
  --base-url http://127.0.0.1:3112/
```

## 确定性门禁

```bash
npx vitest run --config vitest.config.architecture.ts \
  tests/architecture/system-event-real-runtime-fixture-isolation.test.ts \
  tests/architecture/system-event-real-runtime-support.test.ts
```

该门禁验证失败结果 contract、测试身份不进入默认装配/打包输入、后端不产生 `HOOK_DEGRADED`，并覆盖 SSE 解析、run 过滤、目标事件缺失和安全证据白名单。
