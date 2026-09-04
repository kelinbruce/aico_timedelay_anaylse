## 背景与问题（Why）

电信领域 Skill 的 `SKILL.md` 已能在 `metadata` 中声明 `zh-name` 和 `en-name`。manifest 解析会将这些安全的字符串保留为 `SkillMetadata.sourceMetadata`，但 `/api/v1/skills` 目录接口只返回固定的名称和描述字段，前端也没有可消费的本地化名称。因此页面只能展示技术 capabilityId，无法展示 Skill 作者已配置的中文或英文名称。

需要让用户可调用 Skill 的安全 source metadata 沿着既有 Skill catalog 查询链路传到页面，同时保持运行治理 metadata、extension 和其他内部 descriptor 数据不对 Web API 暴露。

## 变更范围（What Changes）

- 修改 `GET /api/v1/skills` 的 Skill catalog summary：可选返回经 Skill manifest 校验的 `sourceMetadata`。
- `agent-core` 仅从已识别的 Skill metadata 投影 `sourceMetadata`；不投影 `extension`、工具约束、模型配置或完整 `CapabilityDescriptor.metadata`。
- 前端目录与已选 Skill 显示按当前界面语言选择 `sourceMetadata.zh-name` 或 `sourceMetadata.en-name`，缺失时回退既有 `displayName`。
- 不改变 Skill 的 capabilityId、运行时路由、模型可见名称或 `SKILL.md` 的解析规则。

## Capability 影响（Capabilities）

### 新增 Capability
- `skill-catalog-query`: 用户可调用 Skill 的目录查询、受控 source metadata 返回和本地化显示名回退。

### 修改的 Capability
- 无。

## 影响范围（Impact）

- `packages/agent-contracts/runtime` 的 `SkillCatalogSummaryEntry` public contract。
- `packages/agent-core` 的 catalog 查询投影。
- `packages/agent-channel-web` 的 `/api/v1/skills` response schema。
- `frontend/agent-web` 的 catalog、选择条和已选 Skill 显示。
- 覆盖 catalog port、Web route/schema 和前端本地化回退的测试。

## 归档前更新基线（Baseline Promotion Plan）

行为契约：
- `openspec/specs/skill-catalog-query/spec.md`：新增，归并目录结果的安全 source metadata 投影和本地化显示语义。

长期背景：
- `openspec/overview.md`：无。

设计视图：
- `openspec/designs/architecture/core-contracts.md`：修改，记录 `SkillCatalogSummaryEntry` 的受控 source metadata 边界。
- `openspec/designs/modules/agent-core.md`：修改，记录 catalog query 的 metadata 投影职责。
- `openspec/designs/modules/agent-channel-web.md`：修改，记录 Web response schema 的公开边界。
- `openspec/designs/modules/agent-web.md`：修改，记录本地化显示名选择与回退。
- `openspec/designs/adr/<id>.md`：无。
- `openspec/designs/spec-to-design-map.md`：如 `skill-catalog-query` 尚无导航则补充，否则无。

验证入口：
- `packages/agent-app/tests/skill-catalog-query-port.test.ts`
- `packages/agent-channel-web` 的路由/response schema 测试
- `frontend/agent-web/tests/SkillSelector.test.tsx`
