## Why

PIU 启动名称 `AIAgentPIU` 需要更名为 `AICOPIU`，以匹配 AICO 产品线品牌命名。本次只改 Prel 启动契约中的 PIU 名称常量及其运行时联动项，构建产物文件名保持 `AIAgentPIU.js` / `AIAgentPIU.css` 不变。

## 目标与非目标（Goals / Non-Goals）

**目标：**

- 将 `AI_AGENT_PIU_NAME` 常量从 `'AIAgentPIU'` 改为 `'AICOPIU'`。
- 同步改运行时联动项：dev/mock Prel `autoLoad` 检查键、后端 hosting `autoLoad` 检查键、mockPiu `name`、`local.tsx` 硬编码启动名、`sessionStorage` key、console 日志前缀。
- 同步更新 stable spec 中 PIU 启动名称引用和测试断言。
- 沉浸式 PIU 名称独立化为 `AFWebsitePIU`，避免与协作式 `AICOPIU` 同环境冲突。

**非目标：**

- 不改构建产物文件名（`AIAgentPIU.js` / `AIAgentPIU.css`）、vite lib name、build-modes.mjs 验证路径、validate-fullstack-packaging.mjs 产物路径、artifact-validation 错误消息、hosting 静态路径 `standalonePiuScriptPath` / `standalonePiuStylePath`。
- 不重命名函数 `registerAIAgentPIU`、组件 `AIAgentPiuRuntime`、文件 `registerAIAgentPIU.tsx` 等内部实现标识符。
- 不修改 `AIAgentPIUHost`（协作式开发宿主 PIU 名称）。
- 不修改 `loadAIAgent` / `displayAIAgent` / `minimizeAIAgent` 等 handler 名称。
- 不修改已归档 OpenSpec change 中的历史记录。

## What Changes

- `AI_AGENT_PIU_NAME` 常量值从 `'AIAgentPIU'` 改为 `'AICOPIU'`。
- `local.tsx` 中硬编码的 `'AIAgentPIU'` 改为使用 `AI_AGENT_PIU_NAME` 常量。
- `prel-mock.ts` mockPiu `name` 从 `'AIAgentPIU'` 改为 `'AICOPIU'`。
- dev mock `prelude-mock-source.mjs` 的 `autoLoad` 检查键从 `"AIAgentPIU"` 改为 `"AICOPIU"`。
- 后端 hosting `autoLoad` 检查键从 `"AIAgentPIU"` 改为 `"AICOPIU"`（静态路径不变）。
- `activeSessionStorage.ts` storage key 从 `nextagent:AIAgentPIU:activeSessionId` 改为 `nextagent:AICOPIU:activeSessionId`。
- `registerAIAgentPIU.tsx` console.warn 前缀从 `[AIAgentPIU]` 改为 `[AICOPIU]`。
- `immersive.tsx` `prel.start` 名称从 `AICOPIU` 改为 `AFWebsitePIU`（新增常量 `IMMERSIVE_PIU_NAME`），避免沉浸式与协作式同环境共存时的 Prel 注册名称冲突。
- 相关测试断言同步更新。

## Feature 影响（Features）

### 修改的 Feature

- `F-3.1 多宿主前端运行模式`：PIU 启动名称更名，功能行为不变。

## Function 影响（OpenSpec Capabilities）

### 新增 Function

无。

### 修改的 Function

- `FN-3.1 协作式 PIU 宿主集成` -> `specs/agent-web-multi-host-modes/spec.md`
  - 功能边界：PIU 启动名称从 `AIAgentPIU` 改为 `AICOPIU`，sessionStorage key 同步更名；构建产物文件名不变。
  - 系统质量属性：可维护性。
  - 映射说明：canonical spec。
- `FN-3.5 AICO 显示控制` -> `specs/aico-display-control/spec.md`
  - 功能边界：sessionStorage key 中 PIU 名称部分从 `AIAgentPIU` 改为 `AICOPIU`。
  - 系统质量属性：可维护性。
  - 映射说明：canonical spec。

## 影响范围（Impact）

- 产品集成页面通过 `Prel.autoLoad({ AICOPIU: version })` 加载 PIU；构建产物文件名仍为 `AIAgentPIU.js` / `AIAgentPIU.css`，hosting 静态路径不变。
- 协作式 sessionStorage key 变更，已有 collaborative session 的 active session id 将丢失（breaking change，符合预期）。
- 后端 API、Runtime、Gateway、持久化、部署配置和运维接口不受影响。
