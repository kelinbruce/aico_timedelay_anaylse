# rename-piu-to-aico Design

## 背景

PIU 启动名称 `AIAgentPIU` 需要更名为 `AICOPIU`。本次只改 Prel 启动契约中的 PIU 名称常量及其运行时联动项，构建产物文件名保持不变。

## 命名映射

| 旧值 | 新值 | 出现位置 | 改动 |
| --- | --- | --- | --- |
| `AIAgentPIU` (PIU name) | `AICOPIU` | prel.ts 常量、prel-mock.ts name、local.tsx 硬编码 | 改 |
| `requested["AIAgentPIU"]` | `requested["AICOPIU"]` | prelude-mock-source.mjs、hosting autoLoad check | 改 |
| `nextagent:AIAgentPIU:activeSessionId` | `nextagent:AICOPIU:activeSessionId` | activeSessionStorage.ts | 改 |
| `[AIAgentPIU]` (console prefix) | `[AICOPIU]` | registerAIAgentPIU.tsx console.warn | 改 |
| `AIAgentPIU.js` / `AIAgentPIU.css` | 不变 | vite config、build-modes.mjs、hosting 路径、验证脚本 | 不改 |
| `AICOPIU` (immersive mode) | `AFWebsitePIU` | immersive.tsx `prel.start` name | 改 |

## 不修改的标识符

- 函数名 `registerAIAgentPIU` 及文件名 `registerAIAgentPIU.tsx`
- 组件名 `AIAgentPiuRuntime` 及文件名 `AIAgentPiuRuntime.tsx`
- store 名 `aiAgentPiuRuntimeStore`
- 宿主 PIU 名 `AIAgentPIUHost`（collaborative.ts 中的独立宿主 PIU）
- handler 名 `loadAIAgent` / `displayAIAgent` / `minimizeAIAgent`
- 构建产物文件名 `AIAgentPIU.js` / `AIAgentPIU.css` 及相关 vite/build/验证配置
- 已归档 OpenSpec change 历史记录

## 关键设计决策

Prel autoLoad 检查键与构建产物文件名可以解耦：hosting/mock 检查 `requested["AICOPIU"]` 决定是否加载 PIU，然后注入 `/piu/AIAgentPIU.js`（文件名不变）。这允许只改运行时 PIU 名称而不动构建系统。

### 沉浸式 PIU 名称独立化
沉浸式与协作式在同一环境共存时，两者均使用 `AICOPIU` 作为 `Prel.start` 名称会导致注册冲突。将沉浸式 PIU 名称改为 `AFWebsitePIU`，协作式 PIU 名称保持 `AICOPIU` 不变。新增常量 `IMMERSIVE_PIU_NAME = 'AFWebsitePIU'` 供 `immersive.tsx` 使用，`AI_AGENT_PIU_NAME` 继续用于协作式 PIU 产物和 `local.tsx`。

## Breaking Change

sessionStorage key 从 `nextagent:AIAgentPIU:activeSessionId` 变为 `nextagent:AICOPIU:activeSessionId`。已有 collaborative session 的 active session id 将丢失。

## 验证

- `openspec validate --all --strict` 通过
- 前端 `npm test` 断言 PIU name 为 `AICOPIU`
- 前端 `npm run build` 通过（产物文件名仍为 `AIAgentPIU.js`）
- `npm run lint:architecture` 通过
