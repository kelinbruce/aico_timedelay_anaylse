# rename-piu-to-aico Tasks

## 1. OpenSpec change

- [x] 1.1 创建 `openspec/changes/rename-piu-to-aico` change 目录和 artifacts
- [x] 1.2 `openspec validate --all --strict` 通过

## 2. 前端源码

- [x] 2.1 `src/host/prel.ts`：`AI_AGENT_PIU_NAME` 常量值从 `'AIAgentPIU'` 改为 `'AICOPIU'`
- [x] 2.2 `src/host/prel-mock.ts`：mockPiu `name` 从 `'AIAgentPIU'` 改为 `'AICOPIU'`
- [x] 2.3 `src/entries/local.tsx`：硬编码 `'AIAgentPIU'` 改为使用 `AI_AGENT_PIU_NAME` 常量
- [x] 2.4 `src/piu/activeSessionStorage.ts`：storage key 从 `nextagent:AIAgentPIU:activeSessionId` 改为 `nextagent:AICOPIU:activeSessionId`
- [x] 2.5 `src/piu/registerAIAgentPIU.tsx`：console.warn 前缀从 `[AIAgentPIU]` 改为 `[AICOPIU]`
- [x] 2.6 `scripts/prelude-mock-source.mjs`：autoLoad 检查键从 `"AIAgentPIU"` 改为 `"AICOPIU"`
- [x] 2.7 `src/host/prel.ts`：新增 `IMMERSIVE_PIU_NAME = 'AFWebsitePIU'` 常量
- [x] 2.8 `src/entries/immersive.tsx`：`prel.start` 名称从 `AI_AGENT_PIU_NAME` 改为 `IMMERSIVE_PIU_NAME`

## 3. 后端 hosting

- [x] 3.1 `packages/agent-app-frontend-hosting/src/index.ts`：autoLoad 检查键从 `"AIAgentPIU"` 改为 `"AICOPIU"`（静态路径不变）

## 4. 测试

- [x] 4.1 `tests/piu-runtime-contract.test.tsx`：PIU name 断言和 console.warn 前缀断言更新
- [x] 4.2 `tests/immersive-entry.test.tsx`：PIU name 断言更新
- [x] 4.3 `tests/piu-runtime-contract.test.tsx`：immersive 测试 mock PIU name 更新为 `AFWebsitePIU`
- [x] 4.4 `src/entries/aico-config-entry-loading.test.tsx`：mock 补充 `IMMERSIVE_PIU_NAME`
- [x] 4.5 `tests/e2e/session-activity-awareness.spec.cjs`：immersive mock PIU name 更新为 `AFWebsitePIU`
- [x] 4.6 `tests/piu-state.test.ts`：describe 标签更新
- [x] 4.7 `tests/e2e/process-message-event-projection.spec.cjs`：storage key 更新
- [x] 4.8 `tests/e2e/process-history-modes.spec.cjs`：storage key 更新
- [x] 4.9 `tests/process-history-host-ownership.test.ts`：文件路径引用无需改动（确认）

## 5. 验证

- [x] 5.1 `openspec validate --all --strict` 通过
- [x] 5.2 前端 `npm test` 通过
- [x] 5.3 `npm run lint:architecture` 通过
