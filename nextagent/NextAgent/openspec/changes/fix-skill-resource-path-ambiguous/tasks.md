## 1. Skill 脚本路径消歧

- [x] 1.1 修改 `resolveSkillResourcePath`：裸路径时从 `activeSkillContext.skillName` 获取激活 Skill name 用于过滤。
  验证：`tsc --noEmit` 通过。
- [x] 1.2 新增 `readActiveSkillName` helper 函数。
  验证：类型检查通过。
- [x] 1.3 新增测试：多 Skill 同名脚本 + 激活 Skill 消歧。
  验证：`npx vitest run` 新增测试通过。
- [x] 1.4 新增测试：无激活 Skill 时裸路径行为不变（ambiguous）。
  验证：`npx vitest run` 新增测试通过。

## 2. SYSTEM_PROMPT workspace 指引

- [x] 2.1 更新 `workspace.md`，补充 Skill 脚本路径解析指导。
  验证：文件内容已替换为目标文本。

## 3. 验证

- [ ] 3.1 运行 `openspec validate fix-skill-resource-path-ambiguous --strict`。
  验证：本 change strict validation 通过。
- [ ] 2.2 运行 `npx tsc --noEmit -p packages/agent-capability/tsconfig.json`。
  验证：无类型错误。
- [ ] 2.3 运行 skill-resource-projection 全部测试。
  验证：21 passed、3 skipped、0 failed。
