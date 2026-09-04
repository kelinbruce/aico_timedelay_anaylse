# 修复 Skill 脚本路径歧义（SKILL_RESOURCE_PATH_AMBIGUOUS）

## 背景

NextAgent 的 Bash 工具支持 Skill 相对脚本路径补全。当模型在 Bash 命令中使用形如 `scripts/foo.py` 或 `<skill-name>/scripts/foo.py` 的路径时，Bash 工具会在已加载的 Skill 投影中查找匹配的脚本文件，找到唯一匹配则补全为 root-qualified 路径，找到多个匹配则返回 `SKILL_RESOURCE_PATH_AMBIGUOUS` 错误。

## 问题原因

当同一个 projectId 下加载了多个 Skill，且这些 Skill 的 `scripts/` 目录下存在同名的脚本文件时（例如 `cn-data-query/scripts/test.py` 和 `cn-data-query-v2/scripts/test.py`），模型如果只写裸路径 `python scripts/test.py`（不含 Skill name 前缀），解析器无法区分该脚本属于哪个 Skill。

**根因在 `resolveSkillResourcePath` 函数的过滤逻辑**（`packages/agent-capability/src/builtins/workspace-files/workspace-file-port.ts`）：

```typescript
async function resolveSkillResourcePath(relativePath: string, context: ToolExecutionContext): Promise<SkillResourcePathResolution> {
    const parsed = parseSkillRelativeResourcePath(relativePath);
    if (parsed === undefined) {
      return { status: 'not-found' };
    }
    const view = await resolveView(context);
    const systemRoot = requireRoot(view, 'systemResources');
    const candidates: string[] = [];
    for (const rootRelativePath of await discoverVerifiedSkillRoots(view)) {
      const root = parseSkillRootRelativePath(rootRelativePath);
      // 问题在这里：parsed.skillName 为 undefined 时不按 skill name 过滤
      if (root === undefined || (parsed.skillName !== undefined && root.skillName !== parsed.skillName)) {
        continue;
      }
      // ... 后续校验逻辑 ...
      candidates.push(`${rootRelativePath}/${parsed.resourcePath}`);
    }
    // 多个候选 -> ambiguous
}
```

`parseSkillRelativeResourcePath` 的解析规则：

- `scripts/test.py` → `{ skillName: undefined, resourcePath: 'scripts/test.py' }`（裸路径，不含 Skill name）
- `my-skill/scripts/test.py` → `{ skillName: 'my-skill', resourcePath: 'scripts/test.py' }`（含 Skill name）

当 `parsed.skillName` 为 `undefined` 时，过滤条件 `(parsed.skillName !== undefined && root.skillName !== parsed.skillName)` 恒为 `false`，所有已加载的 Skill 都不会被跳过。如果多个 Skill 都有同名的 `scripts/test.py`，就产生多个 candidate，返回 `ambiguous`。

## 可用的上下文信息

Tool-loop 在 Skill 加载成功后，会把当前激活的 Skill 信息写入 `flowVariables.activeSkillContext`（`packages/agent-core/src/tools/tool-loop.ts`）：

```typescript
agenticFlowVars['activeSkillContext'] = {
  skillName: input.result.metadata?.['skillName'],
  skillVersion: input.result.metadata?.['skillVersion'],
  providerId: input.result.metadata?.['providerId'],
  // ...
};
```

`ToolExecutionContext.flowVariables` 的类型定义（`packages/agent-capability/src/tools/tool-spi.ts`）：

```typescript
export interface ToolExecutionContext {
  // ...
  readonly flowVariables?: import('@nextagent/agent-common').JsonObject;
}
```

`resolveSkillResourcePath` 已经接收 `context: ToolExecutionContext` 参数，可以直接访问 `context.flowVariables?.['activeSkillContext']?.['skillName']`。

## 修改方案

文件：`packages/agent-capability/src/builtins/workspace-files/workspace-file-port.ts`

### 修改 1：新增 helper 函数

在 `resolveSkillResourcePath` 函数之前，新增 `readActiveSkillName` 函数，从 `flowVariables.activeSkillContext` 中安全读取当前激活的 Skill name：

```typescript
function readActiveSkillName(
  flowVariables: ToolExecutionContext['flowVariables'],
): string | undefined {
  const activeSkillContext = flowVariables?.['activeSkillContext'];
  if (
    activeSkillContext === null ||
    typeof activeSkillContext !== 'object' ||
    Array.isArray(activeSkillContext)
  ) {
    return undefined;
  }
  const skillName = (activeSkillContext as Record<string, unknown>)['skillName'];
  return typeof skillName === 'string' ? skillName : undefined;
}
```

### 修改 2：在 `resolveSkillResourcePath` 中计算 effectiveSkillName

在 `parsed === undefined` 检查之后、`resolveView` 调用之前，插入一行：

```typescript
const effectiveSkillName = parsed.skillName ?? readActiveSkillName(context.flowVariables);
```

`effectiveSkillName` 的取值逻辑：

- 模型写了含 Skill name 的路径（如 `my-skill/scripts/test.py`）→ `parsed.skillName` 有值 → `effectiveSkillName` 取 `parsed.skillName`，行为不变
- 模型写了裸路径（如 `scripts/test.py`）→ `parsed.skillName` 为 `undefined` → fallback 到 `readActiveSkillName`，取当前激活 Skill 的 name
- 没有激活的 Skill（`activeSkillContext` 不存在）→ `readActiveSkillName` 返回 `undefined` → `effectiveSkillName` 为 `undefined`，行为与当前完全一致（不过滤 Skill name）

### 修改 3：将过滤条件从 parsed.skillName 改为 effectiveSkillName

```typescript
// 修改前
if (root === undefined || (parsed.skillName !== undefined && root.skillName !== parsed.skillName)) {

// 修改后
if (root === undefined || (effectiveSkillName !== undefined && root.skillName !== effectiveSkillName)) {
```

### 修改后的完整函数

```typescript
async function resolveSkillResourcePath(relativePath: string, context: ToolExecutionContext): Promise<SkillResourcePathResolution> {
    const parsed = parseSkillRelativeResourcePath(relativePath);
    if (parsed === undefined) {
      return { status: 'not-found' };
    }
    // 当模型写裸路径（如 scripts/test.py）时，用当前激活的 Skill name 消歧
    const effectiveSkillName = parsed.skillName ?? readActiveSkillName(context.flowVariables);
    const view = await resolveView(context);
    const systemRoot = requireRoot(view, 'systemResources');
    const candidates: string[] = [];
    for (const rootRelativePath of await discoverVerifiedSkillRoots(view)) {
      const root = parseSkillRootRelativePath(rootRelativePath);
      if (root === undefined || (effectiveSkillName !== undefined && root.skillName !== effectiveSkillName)) {
        continue;
      }
      const committed = await validateCommittedSkillRoot(systemRoot, root.skillProjectionKey, root.skillName);
      if (committed === undefined) {
        continue;
      }
      const manifest = await readProjectionManifest(committed.manifestPath);
      if (manifest === undefined || !manifest.resources.some((resource) => resource.relativePath === parsed.resourcePath)) {
        continue;
      }
      const skillRoot = resolve(systemRoot.physicalPath, 'skills', root.skillProjectionKey, root.skillName);
      try {
        await assertPathHasNoLinks(skillRoot, parsed.resourcePath, true);
        const targetStat = await lstat(resolve(skillRoot, parsed.resourcePath));
        if (!targetStat.isFile()) {
          continue;
        }
      } catch {
        continue;
      }
      candidates.push(`${rootRelativePath}/${parsed.resourcePath}`);
    }
    const uniqueCandidates = [...new Set(candidates)].sort(compareLexical);
    if (uniqueCandidates.length === 0) {
      return { status: 'not-found' };
    }
    if (uniqueCandidates.length === 1) {
      return { status: 'resolved', logicalPath: uniqueCandidates[0]! };
    }
    return { status: 'ambiguous', candidates: uniqueCandidates };
}
```

## 行为变更分析

| 场景 | 修改前 | 修改后 |
|------|--------|--------|
| 路径含 Skill name（`my-skill/scripts/test.py`） | 精确匹配，不 ambiguous | 行为不变 |
| 路径不含 Skill name（`scripts/test.py`），有激活 Skill | 所有 Skill 都匹配，可能 ambiguous | 只匹配当前激活的 Skill，不 ambiguous |
| 路径不含 Skill name，没有激活 Skill | 所有 Skill 都匹配，可能 ambiguous | 行为不变（effectiveSkillName 为 undefined） |
| 路径不含 Skill name，激活的 Skill 没有该脚本 | 所有 Skill 都匹配，可能 ambiguous | 只在激活 Skill 中查找，找不到则 not-found |
| 非 Skill 脚本路径 | 不走 resolveSkillResourcePath | 不受影响 |

## 影响范围

- 仅修改 `packages/agent-capability/src/builtins/workspace-files/workspace-file-port.ts` 一个文件
- 不修改 `ToolExecutionContext` 接口、`flowVariables` 结构、tool-loop 写入逻辑或任何 Skill 加载路径
- 不影响非 Bash 工具、非 Skill 脚本路径的命令
- 不改变 Skill 路径校验、文件安全检查、投影 manifest 验证等逻辑

## 验证方式

1. `npx tsc --noEmit -p packages/agent-capability/tsconfig.json` 无类型错误
2. 既有 `bash-capability.test.ts` 和 `skill-resource-projection.test.ts` 测试全部通过
3. 新增测试：模拟两个 Skill 有同名 `scripts/test.py`、`activeSkillContext.skillName` 存在时，裸路径 `scripts/test.py` 应解析为当前激活 Skill 的路径而非 ambiguous
4. 新增测试：`activeSkillContext` 不存在时，裸路径行为与修改前一致
