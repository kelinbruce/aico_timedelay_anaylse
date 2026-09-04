## 0. 实施前置门禁

- [x] 0.1 确认 `fix-skill-resource-projection-refresh` 和 `normalize-skill-python-output-paths` 已完成并归档；只有 run reauthorization 补偿与 run-scoped Skill root environment changes 均不再处于 active changes 后，才开始本 change 的代码实施。
  来源：proposal `影响范围`；design `部署、迁移与回滚`
  验证：运行 `Test-Path openspec/changes/fix-skill-resource-projection-refresh` 和 `Test-Path openspec/changes/normalize-skill-python-output-paths`，两个结果均预期为 `False`；运行 `openspec validate --all --strict`，预期全部 active/stable artifacts 有效。
  实际结果：两个 `Test-Path` 均返回 `False`；`openspec validate --all --strict` 通过，260 个 items 全部有效。

## 1. `FN-5.10 访问技能资源`

- [x] 1.1 在 `packages/agent-capability/tests/skill-resource-projection.test.ts` 先增加 scope authority 恢复测试：同一 execution scope 的不同 `runId`、调用 `clearRun` 后、重建 `WorkspaceFilePort` 后以及当前 assembly 不再暴露对应 Skill runtime Capability 时，Read、Glob、Grep 和 `sandboxFilesystem` 均可通过已知路径使用既有 committed projection；实施前运行测试并记录目标用例因当前 run-local authority 而失败。
  来源：`FN-5.10 访问技能资源` + 系统质量属性 `可靠性/恢复` + Requirement `Skill projection scope authority 必须可从有效提交事实恢复` + Scenarios `后续 run 恢复同一 scope 的资源权限`、`Subject isolation mode 跨 session 共享`、`进程重启后恢复资源权限`；Requirement `Skill resource access SHALL expose authorized resources through execution roots` + Scenarios `激活后的资源在同一 scope 内持续可达`、`后续 run 执行已有 Skill 脚本`
  验证：运行 `npx vitest run --config vitest.config.release.ts packages/agent-capability/tests/skill-resource-projection.test.ts packages/agent-capability/tests/read-capability.test.ts packages/agent-capability/tests/glob-capability.test.ts packages/agent-capability/tests/grep-capability.test.ts packages/agent-capability/tests/sandbox-execution-port.test.ts`；实施前预期新增恢复用例失败，实施后预期全部通过。
  实际结果：实施前新增用例按预期暴露 later run 无 roots、Read 返回 `SKILL_RESOURCE_UNAVAILABLE`；实施后 scope 恢复、`clearRun`、新建 port、Read/Glob/Grep/sandbox 用例均通过。

- [x] 1.2 在 `packages/agent-capability/tests/skill-resource-projection.test.ts` 和相关文件工具测试中建立安全 negative cases：不同 Agent/tenant/subject、`session` isolation mode 下不同 session、仅有构造路径文本、缺少或损坏 marker、`.staging`、`.locks`、symlink escape 和 projection 写入均不可达且不泄漏目标是否存在；修改前先记录既有拒绝行为基线，修改后保持通过。
  来源：`FN-5.10 访问技能资源` + 系统质量属性 `安全` + Requirement `Skill projection scope authority 必须保持 execution scope 隔离` + Scenarios `不同 subject 不能共享 projection`、`不同 Agent 或 tenant 不能共享 projection`、`Session isolation mode 不跨 session 共享`、`构造的历史路径不产生 authority`；Requirement `Skill projection scope authority 必须可从有效提交事实恢复` + Scenario `无效提交事实不恢复权限`；Requirement `Skill resource access SHALL expose authorized resources through execution roots` + Scenario `Projection 始终保持只读`
  验证：运行 `npx vitest run --config vitest.config.release.ts packages/agent-capability/tests/skill-resource-projection.test.ts packages/agent-capability/tests/path-security.test.ts packages/agent-capability/tests/write-capability.test.ts packages/agent-capability/tests/edit-capability.test.ts`；预期修改前和修改后所有拒绝用例均通过，safe error 不包含目标 physical path 或存在性细节。
  实际结果：不同 Agent/tenant/subject、session 隔离、marker 删除、构造路径、staging/locks、symlink 与写入拒绝用例均通过；返回仅包含逻辑路径和安全 reason code。

- [x] 1.3 在 `packages/agent-capability/tests/sandbox-execution-port.test.ts` 和 `packages/agent-platform-gateway-local/tests/restricted-local-sandbox.test.ts` 先增加 sandbox scope authority 测试：后续 run 的显式 Python script path 只匹配当前 scope projection，单一 projection 支持 module mode，零 root 和多 root 均显式失败且不发布 physical path；`NEXTAGENT_SKILL_ROOT` 缺失或只指向被唯一选择的只读 root；实施前运行并记录跨 run script-path 用例失败。
  来源：`FN-5.10 访问技能资源` + Requirement `Authorized Skill Projection Supplies A Bounded Python Module Root` + Scenarios `Script path 使用同一 scope 的匹配 projection`、`单一 projection 支持 Python module mode`、`多个 projection roots 不得被隐式选择`；Requirement `Skill Scripts Use Workspace For Results And Temp For Intermediate Files` + Scenario `Skill root 环境变量来自当前 scope 的唯一选择结果`
  验证：运行 `npx vitest run --config vitest.config.release.ts packages/agent-capability/tests/sandbox-execution-port.test.ts packages/agent-platform-gateway-local/tests/restricted-local-sandbox.test.ts`；实施前预期新增跨 run script-path 用例失败，实施后预期全部通过。
  实际结果：实施前 later run sandbox 无 projection root；实施后显式脚本路径在多 root 中选择匹配 root，既有单 root module、零 root、多 root拒绝和环境变量用例全部通过。

- [x] 1.4 修改 `WorkspaceFilePort`：删除 `agentId + runId` 的 `authorizedSkillRoots` authority 集合，改用 `systemResources.physicalPath` 分区的 bounded verified roots cache；按 design 的固定 discovery 顺序复用 manifest identity 派生和现有 committed tree/safe path 校验，cache miss/eviction/新 port 实例均从 committed facts 恢复，root 或 marker 消失/替换时立即失效；`clearRun` 不再撤销 projection authority。
  来源：`FN-5.10 访问技能资源` + Requirements `Skill projection scope authority 必须可从有效提交事实恢复`、`Skill projection scope authority 必须保持 execution scope 隔离`、`Skill resource access SHALL expose authorized resources through execution roots`；design `修改方案/1. 以现有 committed projection 作为唯一持久 authority`、`修改方案/2. 按 scope 缓存已验证 roots，并从 committed facts 恢复`、`修改方案/5. 保持只读、隔离和 public contract 边界`
  验证：运行 `npx vitest run --config vitest.config.release.ts packages/agent-capability/tests/skill-resource-projection.test.ts packages/agent-capability/tests/read-capability.test.ts packages/agent-capability/tests/glob-capability.test.ts packages/agent-capability/tests/grep-capability.test.ts packages/agent-capability/tests/path-security.test.ts packages/agent-capability/tests/write-capability.test.ts packages/agent-capability/tests/edit-capability.test.ts`；预期 scope 恢复用例与全部隔离、完整性、只读 negative cases 通过。
  实际结果：authority cache 已按 resolver 返回的 `systemResources.physicalPath` 分区，cache miss 会验证 committed manifest/tree 并恢复；marker/root 失效会撤销缓存，`clearRun` 仅清理 run snapshot。聚焦回归通过。

- [x] 1.5 删除 `WorkspaceFilePort.reauthorizeSkillResources`、内部 reauthorization contract、core rendered-context 路径扫描、`RequestLocalCapabilityState.reauthorizedSkillRoots`、redisclosure 消息、`CapabilitySubsystem.skillResourceReauthorizer`、`DefaultAgentDependencies.skillResourceReauthorizer` 和 `agent-app` request runtime composition wiring；完成后 core 与 composition 不读取路径文本或当前 Skill descriptor 来创建 projection authority。
  来源：design `修改方案/3. 删除 run reauthorization 补偿`、`修改方案/5. 保持只读、隔离和 public contract 边界`
  验证：运行 `rg -n "reauthorizeSkillResources|SkillResourceReauthorizer|skillResourceReauthorizer|reauthorizedSkillRoots|Current-run Skill resource authorization refreshed" packages --glob "*.ts"`，预期无匹配；运行 `npx vitest run --config vitest.config.release.ts packages/agent-core/tests/agent-routing-core.test.ts packages/agent-capability/tests/tool-framework.test.ts packages/agent-capability/tests/skill-tool.test.ts packages/agent-app/tests/request-runtime-composition.test.ts tests/architecture/capability-source-configuration.test.ts`，预期全部通过。
  实际结果：指定 `rg` 无匹配；core、capability、composition 与架构聚焦测试通过，模型上下文文本和当前 Skill descriptor 不再参与 authority 判定。

- [x] 1.6 使 `sandboxFilesystem` 暴露当前 scope 全部有效 committed projection roots，并使可选 `NEXTAGENT_SKILL_ROOT` 只来自显式 script-path 或单 root module mode 的唯一选择结果；保持 gateway-local 只消费 layout 和选择结果、不拥有 scope/manifest 判定，零 root和多 root结果符合规范。
  来源：`FN-5.10 访问技能资源` + Requirement `Authorized Skill Projection Supplies A Bounded Python Module Root` + Scenarios `Script path 使用同一 scope 的匹配 projection`、`单一 projection 支持 Python module mode`、`多个 projection roots 不得被隐式选择`；Requirement `Skill Scripts Use Workspace For Results And Temp For Intermediate Files` + Scenario `Skill root 环境变量来自当前 scope 的唯一选择结果`；design `修改方案/4. 保持 sandbox 的唯一选择规则`
  验证：运行 `npx vitest run --config vitest.config.release.ts packages/agent-capability/tests/sandbox-execution-port.test.ts packages/agent-platform-gateway-local/tests/restricted-local-sandbox.test.ts packages/agent-platform-gateway-local/tests/deny-by-default-sandbox.test.ts`；预期显式路径、单 root、零 root、多 root和 deny-by-default 用例全部通过。
  实际结果：capability 层发布当前 scope 的全部 verified roots；gateway-local 继续只按 layout 对显式 script path/单 root module mode 做唯一选择。相关 sandbox 与 deny-by-default 测试通过。

- [x] 1.7 完成 `FN-5.10` 聚焦验证，确认同 scope 跨 run/重启恢复、当前 assembly 不再暴露 Skill 时的已知路径读取、workspace 输出、run-scoped temp、local `shared-data` 和跨 scope拒绝均符合 delta spec。
  来源：`FN-5.10 访问技能资源` + 本 change 全部 Requirements 和 Scenarios
  验证：运行 `npx vitest run --config vitest.config.release.ts packages/agent-capability/tests/skill-resource-projection.test.ts packages/agent-capability/tests/read-capability.test.ts packages/agent-capability/tests/glob-capability.test.ts packages/agent-capability/tests/grep-capability.test.ts packages/agent-capability/tests/path-security.test.ts packages/agent-capability/tests/write-capability.test.ts packages/agent-capability/tests/edit-capability.test.ts packages/agent-capability/tests/sandbox-execution-port.test.ts packages/agent-core/tests/agent-routing-core.test.ts packages/agent-platform-gateway-local/tests/restricted-local-sandbox.test.ts packages/agent-platform-gateway-local/tests/deny-by-default-sandbox.test.ts`；预期全部通过。
  实际结果：聚焦命令通过，11 个测试文件共 189 个用例通过、9 个跳过。

## 2. Change 整体验证

- [x] 2.1 运行后端完整门禁和 strict OpenSpec validation，确认代码、契约、架构依赖和全部 active/stable specs 一致；本 change 不修改 `frontend/agent-web`，不以根目录 build 充当前端验证证据。
  来源：proposal `影响范围`；design `验证策略`
  验证：依次运行 `npm run build`、`npm test`、`npm run test:contract`、`npm run lint:architecture`、`openspec validate --all --strict`；预期所有命令退出码为 0。
  实际结果：全部退出码为 0；build/typecheck 通过，unit 118 files/1104 tests，contract 39 files/331 tests，architecture 41 files/247 tests，OpenSpec 260 items 全部通过。本 change 未修改 `frontend/agent-web`。

## 归档前更新基线检查（非实施任务）

实现和验证完成后，归档流程按照 design 的“长期基线刷新计划”同步 `skill-resource-access` stable spec、`FN-5.10` Function、`F-5.6` Feature、Skill invocation architecture、受影响 module 文档和 `spec-to-design-map`。归档检视必须确认长期文档只保留 execution-scope committed projection authority 的目标态，不保留 run reauthorization 补偿语义，也不重复定义 `agent-contracts` 或 gateway contract。
