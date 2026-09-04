# add-developer-hook-trace-timing

## 背景与问题（Why）

`developer-hook-trace` 用于检查本地 Agent 循环执行，但当前每个 NDJSON 节点缺少打印时间戳。模型结果 trace 条目也没有暴露首个模型反馈时延和端到端模型调用时延，使慢模型响应的本地诊断不完整。

## 变更范围（What Changes）

- 为 SDK 拥有的 `developer-hook-trace` NDJSON 输出新增 trace 条目打印时间元数据。
- 在模型结果生命周期边界新增安全的数值型模型时延元数据：
  - 模型流返回首个 token 时的首个模型反馈时延（毫秒），
  - 模型调用 E2E 时延（毫秒）。
- 模型时延和所有生命周期业务 payload 只保留在原始 `boundary` 中；不把它们复制为顶层 trace 字段。
- 只在 `agents/default-agent/agent.yaml` 暂存默认 Agent；不打包重复的 `config/default-agent.yaml`。

## 非目标（Non-Goals）

- 不改变 Web API、stream event、audit、metric、trace、timeline 或运营日志 contract。
- 除既有 developer trace raw 字段外，不额外暴露原始 provider delta、prompt、凭据、secret 或模型输出。
- 不默认激活 `developer-hook-trace`。
- 不从 trace 打印时间戳进行第二次时延计算。

## 验证入口（Validation）

- `npx vitest run packages/agent-plugin-sdk/tests/plugin-sdk.test.ts packages/agent-core/tests/agent-routing-core.test.ts`
- `openspec validate add-developer-hook-trace-timing --strict`
