## 1. FN-6.3 沙箱执行命令

- [x] 1.1 将 `Dynamic execution SHALL use deployment-mode-specific sandbox enforcement` 从 `skill-resource-access` 原子迁移到 `sandbox-runtime`，并补充宿主权限元数据保持约束。验证：`openspec validate refine-ts-sandbox-host-permission-preservation --strict`；结果：通过。
- [x] 1.2 先补充回归测试，覆盖原始 Skill、workspace、shared-data 在成功、失败和并发执行后的权限保持，以及 LOCAL 实现不再调用宿主 chmod/ACL 降权；在实现前运行相关测试并确认新增行为测试失败。结果：实现前定向测试按预期因仍存在 `protectReadonlyRoots` 失败；实现后 Windows 定向测试通过，POSIX 实际产物探针确认成功、失败和并发后 mode 不变。
- [x] 1.3 先补充执行策略测试，覆盖 Python 脚本无需 execute 位、必须直接执行的可读非可执行脚本使用 sandbox-owned 临时副本、不可读或不可遍历路径返回安全且可诊断的权限不足结果；在实现前运行相关测试并记录失败或既有基线。结果：新增 POSIX 测试已提交；Ubuntu WSL 实际产物探针验证 `0640` Python、`0640` direct script staging/cleanup 和 `000` unreadable rejection 全部通过。
- [x] 1.4 删除 LOCAL 沙箱对原始只读根目录的权限修改，实现直接脚本临时副本、生命周期清理及 `EACCES`/`EPERM` 安全错误映射。验证：原始路径权限不变，只有 sandbox-owned 临时副本可获得执行权限。结果：typecheck/build 通过，定向测试及 WSL POSIX 探针通过。
- [x] 1.5 运行沙箱网关与 Bash/Python sandbox execution port 定向测试。验证：`npx vitest run --config vitest.config.release.ts packages/agent-platform-gateway-local/tests/restricted-local-sandbox.test.ts packages/agent-capability/tests/sandbox-execution-port.test.ts packages/agent-capability/tests/python-capability.test.ts`；结果：53 passed，4 个 POSIX 用例在 Windows 跳过并由 WSL 实际产物探针补充通过。

## 2. 变更门禁

- [x] 2.1 运行后端常规门禁并记录结果。验证：`npm run build`、`npm test`、`npm run test:contract`、`npm run lint:architecture`；结果：build 通过，unit 1214 passed，contract 338 passed，architecture 251 passed。
- [x] 2.2 运行全量 OpenSpec 严格校验并完成变更语义复核。验证：`openspec validate --all --strict`；结果：270 passed，0 failed；`nextagent-skill-review` 与 `nextagent-code-review` 均为 PASS。

## 长期基线同步（归档前，非本次实现任务）

- 将已迁移的 Requirement、FN-6.3 Function 描述及 Feature/Function/spec 映射同步到 stable OpenSpec、Function、Feature、架构设计和 `spec-to-design-map`，随后再归档本 change。
