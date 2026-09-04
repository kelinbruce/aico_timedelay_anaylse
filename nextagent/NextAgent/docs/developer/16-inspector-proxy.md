# Inspector 本地代理（LLM Debug Proxy）

如果你刚开始用 NextAgent，想把 LLM 工具（Claude Code、Cursor、Cline、Continue 等）接到本地 LLM Debug Proxy 上调试，看这一篇。

> 本篇是**环境与外部工具配置指南**。LLM Debug Proxy 不是一个随 NextAgent 代码仓库分发的组件——NextAgent 仓库内没有 Inspector 进程、启动脚本或相关 skill 的实现。如果你在团队内已经部署了独立的 LLM Debug Proxy 服务，可按本文配置接入；如果尚未部署，请先向你的平台/工具团队确认 Inspector 服务的来源与启动方式。

## 这是什么

Inspector 是一个**跑在你本机**的 HTTP 代理（默认端口 `25947`），位于"LLM 工具"和"真实 LLM 服务"之间。它会：

- **转发请求**：LLM 工具看到的 `BASE_URL` 就是它，转发到真实 provider。
- **记录日志**：所有请求/响应落到 Inspector 进程自带的存储里，方便回放。
- **可观测**：把 `inspector_get_log` / `inspector_replay_log` 等 MCP 工具暴露给 Agent，让模型本身也能看自己的调用历史。

它不是 NextAgent 的组件，是一个**独立服务**。NextAgent 不依赖它运行；它只在调试 LLM 调用链时有用。

## 推荐的 URL：`http://inspector.localhost:25947/proxy`

不要写 `http://localhost:25947/proxy`——小白用户经常误以为这是一个公网地址。

**推荐写法**：

```bash
# Claude Code / Cursor / Cline 等
LLM_BASE_URL=http://inspector.localhost:25947/proxy
```

**为什么用 `inspector.localhost` 而不是 `localhost`**：

- `localhost` 是个抽象的"本机"概念，小白用户看到 `http://localhost:...` 容易怀疑是不是要去外网、要注册、要防火墙放行。
- `inspector.localhost` 是一个**有名字的本机服务**，一看就知道是 Inspector 在本机提供的能力。
- `*.localhost` 是 [RFC 6761](https://www.rfc-editor.org/rfc/rfc6761) 保留的命名空间，**任何子域名都直接解析为 `127.0.0.1`**，不需要：
  - 改 `/etc/hosts`
  - 安装 `dnsmasq` / `avahi` / `mDNSResponder`
  - 配置 DNS server
- 主流系统都原生支持（Windows 10+、macOS、Linux 配 systemd-resolved / glibc 2.36+）。
- 浏览器地址栏直接打开 `http://inspector.localhost:25947/proxy` 也能看到日志面板。

如果用户的 OS 不支持 `*.localhost`（极少见，例如老版本 Linux），fallback 才是 `http://127.0.0.1:25947/proxy`，不要回退到 `localhost`。

## 启动 Inspector

> NextAgent 仓库内不包含 Inspector 的启动脚本或 skill。以下步骤假设你已从团队或独立项目获得 Inspector 服务。

启动 Inspector 的一般做法：

1. 启动 `llm-inspector` 进程，监听 `25947`。
2. 在当前 shell 设置三个环境变量：
   - `OPENAI_API_KEY=llm-Inspector`（占位 key，Inspector 自身校验用）
   - `OPENAI_BASE_URL=http://inspector.localhost:25947/proxy`（用上面的推荐 URL）
   - `OPENAI_MODEL_NAME=<debug-model>`（如 `MiniMax-M2.7-highspeed`）
3. 让 NextAgent 使用一个对接上述 env 的 `modelProfiles[]` 条目（`credentialRef: "env:OPENAI_API_KEY"`、`baseUrl` 指向 Inspector）。
4. 退出 Inspector 时还原原始 env。

> 退出后所有 `OPENAI_*` 环境变量都会还原；下次想用再重新启动 Inspector 即可。

## 在 LLM 工具里配置

不同的 LLM 工具读取环境变量的方式不同，常见三种：

| 工具 | 推荐做法 |
|------|---------|
| Claude Code | 把 `LLM_BASE_URL` 写到 `~/.claude/settings.local.json` 的 `env` 字段（**注意：此文件在 `.claude/` 下，是本机状态，不要 commit**） |
| Cursor | Settings → Models → OpenAI API Key 区域，点 "Override OpenAI Base URL"，填入 URL |
| Cline / Continue | `.continuerc.json` 或 VS Code 设置里的 `apiBase` |
| 其他 OpenAI-兼容工具 | 找工具设置里的 "Base URL" / "API Endpoint" 字段 |

最简的 shell 一次性测试：

```bash
curl http://inspector.localhost:25947/proxy/v1/models
# 期望返回 JSON 列表，而不是 connection refused
```

## 怎么验证接对了

启动 Inspector 并配置好 env 后，在 NextAgent 里随便发一句话让模型调用一次工具。然后问模型：

> "列出最近 5 次模型调用的延迟和 token 用量。"

模型会通过 `mcp__llm-inspector__inspector_list_logs` 调出真实数据。如果能列出，URL 就接对了。

如果模型说"Capability is unavailable" / "Tool call limit exceeded" 或者日志里没有任何 inspector 调用记录，说明 URL 没接上，回到上一节排查。

## 常见错误

| 现象 | 原因 | 修复 |
|------|------|------|
| `Connection refused` | Inspector 没启动 / 端口不是 25947 | 启动 Inspector，确认没有端口冲突 |
| `404 Not Found` | URL 漏了 `/proxy` 前缀 | 必须是 `http://inspector.localhost:25947/proxy`，**不是** `http://inspector.localhost:25947/v1/...` |
| 401 / Invalid API Key | LLM 工具的 API key 没设成 `llm-Inspector` 占位 | 工具里把 OpenAI API Key 字段写成 `llm-Inspector`（任意非空字符串都行） |
| 模型走的是真实 OpenAI，没经过代理 | LLM 工具用了自己的 base URL 而不是 env 变量 | 显式在工具里 override OpenAI Base URL |
| `inspector.localhost` 打不开 | OS 不支持 `*.localhost` | 临时用 `http://127.0.0.1:25947/proxy`；或升级 OS / 配置 systemd-resolved |
| NextAgent 启动报 "App configuration is blocked" | `credentialRef` 写了明文 key | Inspector 场景下 `credentialRef` 仍用 `env:OPENAI_API_KEY`，env 值为 `llm-Inspector` 占位 |

## 不要做的事

- **不要**把 Inspector 暴露到公网（不要监听 `0.0.0.0`，不要配 nginx 反代）。它只信任本机 loopback。
- **不要**在生产环境的 LLM 工具里写这个 URL。Inspector 是 debug 工具，会记录全部请求/响应。
- **不要**把 `inspector.localhost:25947` 写进仓库的 `.env.example` / README 默认值。新用户看到会以为是公网 endpoint。
- **不要**把 Inspector URL 写进 NextAgent 的 `default-system.yaml` 提交配置。`modelProfiles[].baseUrl` 在生产应指向真实 provider。

## 相关资源

- [RFC 6761 — Special-Use Domain Names](https://www.rfc-editor.org/rfc/rfc6761) — `*.localhost` 解析规则
- [部署说明](./12-deployment.md) — `modelProfiles` 与 `credentialRef` 配置
- [常见问题排查](./14-troubleshooting-faq.md) — 模型调用 401/403、配置校验失败
