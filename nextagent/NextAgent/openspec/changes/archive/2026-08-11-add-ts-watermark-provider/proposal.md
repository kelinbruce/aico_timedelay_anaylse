# add-ts-watermark-provider

## Why

电信网络智能体输出的正文文本和 workflow 节点输出需要可追溯性水印，用于事后审计和内容溯源。当前系统没有统一的水印通道，集成方无法在不修改持久化数据的前提下对返回给客户端的文本动态添加水印。

水印服务由集成方提供外部 URL 实现，NextAgent 只负责在 channel 层调用外部服务并对返回文本做透明替换。水印默认关闭，集成方通过 agent package 的 `config/config.json` 配置开启。

## What Changes

- **新增** `watermark` gateway adapter kind 和 `WatermarkGatewayPort`（ADDED watermark-gateway），定义水印服务的唯一受治理出口，以 REMOTE 部署，参考 `guardrail` pattern。
- **新增** channel 层水印 transform（ADDED watermark-gateway），对 stream 和历史回显路径的 ASSISTANT 正文内容动态调用水印服务并替换返回文本。
- **新增** `watermarkEnabled` 配置读取（ADDED watermark-gateway），从 `config/config.json` 读取开关，默认 `false`。
- **新增** REMOTE watermark provider 参考实现（ADDED watermark-gateway），调用外部 URL，作为参考实现供集成方使用。

## Non-Goals

- 不修改 runtime 层核心逻辑；水印 transform 全部在 channel 层完成。
- 不修改持久化数据；水印在每次读取时动态调用，不写回存储。
- 不新增 LOCAL watermark provider；水印是 REMOTE-only 能力。
- 不对 USER、CAPABILITY_RESULT、SUMMARY 消息加水印。
- 不对思考过程加水印。
- 不对 CLIP/Bash 工具的 TOOL_STRUCTURED_DELTA 加水印。
- 不定义水印字符的具体实现细节（零宽字符等），由外部水印服务决定。

## Validation

- `npx vitest run packages/agent-channel-common/tests/web-stream-delivery-watermark.test.ts`
- `npx vitest run packages/agent-app/tests/watermark-config.test.ts`
- `npx vitest run packages/agent-platform-gateway-remote/tests/watermark-provider.test.ts`
- `openspec validate add-ts-watermark-provider --strict`
