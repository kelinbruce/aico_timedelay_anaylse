# Safe Capability Technical Name Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show the validated technical target name for Skill, Agent, and ordinary-tool ApiCall process cards without exposing arbitrary tool arguments or raising their result disclosure level.

**Architecture:** `agent-channel-common` reuses the already validated `ASSISTANT_TOOL_USE` association and projects one allowlisted identifier as `capabilityTargetName` on `CAPABILITY_STARTED`. Agent Web retains that title by `toolCallId` across result and completion events. Existing Bash/Read `DETAIL` support remains configuration-only and production defaults remain unchanged.

**Tech Stack:** TypeScript strict ESM, Vitest, React process projection, OpenSpec spec-driven workflow, npm workspaces.

---

## File Structure

- Create `openspec/changes/expose-safe-capability-technical-name/.openspec.yaml`: select the spec-driven workflow.
- Create `openspec/changes/expose-safe-capability-technical-name/proposal.md`: define the development-debugging problem, scope, non-goals, and impacted Function.
- Create `openspec/changes/expose-safe-capability-technical-name/design.md`: define the single message-associated projection path and security boundary.
- Create `openspec/changes/expose-safe-capability-technical-name/specs/ts-run-status-visibility/spec.md`: define the public target-name behavior and disclosure-policy independence.
- Create `openspec/changes/expose-safe-capability-technical-name/tasks.md`: track the exact TDD and verification evidence below.
- Modify `packages/agent-channel-common/tests/process-message-projection.test.ts`: characterize allowlisted identity projection and negative leakage cases.
- Modify `packages/agent-channel-common/src/projections/stream-envelope.ts`: project one validated target identifier from the associated tool call.
- Modify `frontend/agent-web/tests/processDetailsProjection.test.ts`: characterize title rendering and retention across lifecycle events.
- Modify `frontend/agent-web/src/features/chat/process/processDetails.ts`: render and retain the projected target identifier.

### Task 1: Establish the OpenSpec contract

**Files:**
- Create: `openspec/changes/expose-safe-capability-technical-name/.openspec.yaml`
- Create: `openspec/changes/expose-safe-capability-technical-name/proposal.md`
- Create: `openspec/changes/expose-safe-capability-technical-name/design.md`
- Create: `openspec/changes/expose-safe-capability-technical-name/specs/ts-run-status-visibility/spec.md`
- Create: `openspec/changes/expose-safe-capability-technical-name/tasks.md`
- Reference: `docs/superpowers/specs/2026-08-05-safe-capability-technical-name-design.md`

- [ ] **Step 1: Create the spec-driven change shell**

Create `.openspec.yaml` with:

```yaml
schema: spec-driven
created: 2026-08-05
```

- [ ] **Step 2: Write the proposal and design with one implementation path**

The proposal must state:

```markdown
## Why

Skill、Agent 和普通 Tool 路径的 ApiCall 在没有安全结果 projector 时只显示 wrapper 名称，业务开发调测者无法确认实际执行对象。结果显示级别不能解决公共身份缺失，因为没有 projector 的结果必须继续收窄为 STATUS_ONLY。

## What Changes

- 从已通过完整 Message 关联校验的 ASSISTANT_TOOL_USE Tool Call 中，只投影 Skill.name、Agent.agentId 或 ApiCall.apiName。
- 合法技术标识作为可选 capabilityTargetName 进入 CAPABILITY_STARTED 公共 payload。
- Agent Web 将 wrapper 名称与目标技术标识组合，并在同一 toolCallId 的后续结果和完成事件中保留。
- Bash、Read 的 DETAIL 继续使用现有配置和安全 projector；不修改生产默认级别。
```

The design must make these decisions explicit:

1. The channel is the sole owner of argument-to-public-identity projection.
2. The identifier must match `^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$` after trim.
3. Only the three exact wrapper/field pairs are read; arbitrary argument probing is forbidden.
4. The value appears only on a successfully associated `CAPABILITY_STARTED` envelope.
5. Completion and result events do not recover identity from result bodies; the frontend retains the started title by `toolCallId`.
6. Direct ApiCall paths that do not emit an ordinary lifecycle card remain unchanged.
7. No `agent-contracts`, Gateway, runtime persistence, Message schema, result projector, or default policy changes are allowed.

- [ ] **Step 3: Write the delta requirement and scenarios**

Add one requirement named `Capability lifecycle may expose an allowlisted technical target identifier` with these normative scenarios:

- Skill/Agent/ordinary ApiCall valid identifiers are visible in live and refreshed history.
- Other arguments, prompt, path, result body, and unmatched Message content remain absent.
- Missing association, wrong coordinates, invalid identifiers, and completion-only events degrade to the existing wrapper title.
- `STATUS_ONLY`, `SUMMARY`, and `DETAIL` produce the same identity while result fields stay governed by the effective result level.
- Bash/Read `DETAIL` uses existing safe projectors and does not imply raw input/output access.

- [ ] **Step 4: Write tasks matching Tasks 2-4 of this plan**

Use unchecked tasks for backend RED/GREEN, frontend RED/GREEN, focused verification, full scoped gates, and semantic review. Do not include localization, business-name configuration, direct ApiCall cards, or new result projectors.

- [ ] **Step 5: Validate and review the change**

Run:

```bash
openspec validate expose-safe-capability-technical-name --strict
```

Expected: the change is valid with no warnings or errors.

Then apply the repository `nextagent-skill-review` checklist. Expected conclusion: `PASS`, no `agent-contracts` group-confirmation item.

- [ ] **Step 6: Commit the OpenSpec contract**

```bash
git add openspec/changes/expose-safe-capability-technical-name
git commit -m "docs(capability): specify safe technical target identity"
```

### Task 2: Project a validated target identifier from the associated Tool Call

**Files:**
- Modify: `packages/agent-channel-common/tests/process-message-projection.test.ts`
- Modify: `packages/agent-channel-common/src/projections/stream-envelope.ts`

- [ ] **Step 1: Add failing positive projection tests**

Add a table-driven test using the existing `assistantToolUseMessage` helper:

```ts
it.each([
  ['Skill', { name: 'network-diagnostics' }],
  ['Agent', { agentId: 'network-explorer' }],
  ['ApiCall', { apiName: 'query-network-kpi' }],
] as const)('projects the validated %s technical target name from the associated tool call', (capabilityId, args) => {
  const message = assistantToolUseMessage({
    toolCalls: [{ toolCallId: 'call-1', toolName: capabilityId, arguments: args }],
  });
  const outcome = projectTimelineEventToStreamEnvelope(
    event('CAPABILITY_STARTED', { messageId: message.messageId, capabilityId, toolCallId: 'call-1' }),
    { processMessageAssociation: { message }, capabilityResultPresentationPolicy: detailPolicy },
  );

  expect(outcome).toMatchObject({
    kind: 'ENVELOPE',
    envelope: { payload: { capabilityId, toolCallId: 'call-1', capabilityTargetName: Object.values(args)[0] } },
  });
});
```

- [ ] **Step 2: Add failing negative boundary tests**

Cover an ordinary `Read` call carrying `name`, a Skill call containing `args`, `path`, and `prompt`, and invalid target values `''`, `'two lines\nsecret'`, `'../private-skill'`, and 129 ASCII characters. Assert that `capabilityTargetName` and all non-allowlisted values are absent from serialized output.

- [ ] **Step 3: Run the backend test and verify RED**

Run:

```bash
PATH=/Users/gaoyang/.nvm/versions/node/v22.22.2/bin:$PATH npx vitest run packages/agent-channel-common/tests/process-message-projection.test.ts
```

Expected: the new positive assertions fail because `capabilityTargetName` is missing; existing tests remain passing.

- [ ] **Step 4: Implement the minimal channel projector**

In the `CAPABILITY_STARTED` branch, retain the result of `readReferencedToolCall` and project the optional identifier:

```ts
const toolCall = readReferencedToolCall(referencedMessage, event.inlinePayload.toolCallId, event.inlinePayload.capabilityId);
if (toolCall === undefined) {
  projectUnavailableCapabilityPayload(payload, event);
  return payload as JsonObject;
}
const capabilityTargetName = projectCapabilityTargetName(toolCall, event.inlinePayload.capabilityId);
if (capabilityTargetName !== undefined) {
  payload.capabilityTargetName = capabilityTargetName;
}
```

Add one private helper near `readReferencedToolCall`:

```ts
const capabilityTargetNamePattern = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u;

function projectCapabilityTargetName(toolCall: JsonObject, capabilityIdValue: unknown): string | undefined {
  const capabilityId = readString(capabilityIdValue);
  const field = capabilityId === 'Skill' ? 'name' : capabilityId === 'Agent' ? 'agentId' : capabilityId === 'ApiCall' ? 'apiName' : undefined;
  const argumentsRecord = readRecord(toolCall.arguments);
  const candidate = field === undefined ? undefined : readString(argumentsRecord?.[field])?.trim();
  return candidate !== undefined && capabilityTargetNamePattern.test(candidate) ? candidate : undefined;
}
```

- [ ] **Step 5: Run the backend test and verify GREEN**

Run the command from Step 3. Expected: all tests in `process-message-projection.test.ts` pass and no serialized payload contains the negative canaries.

- [ ] **Step 6: Commit the channel projection**

```bash
git add packages/agent-channel-common/src/projections/stream-envelope.ts packages/agent-channel-common/tests/process-message-projection.test.ts
git commit -m "feat(channel): project safe capability target names"
```

### Task 3: Render and retain the target identifier in Agent Web

**Files:**
- Modify: `frontend/agent-web/tests/processDetailsProjection.test.ts`
- Modify: `frontend/agent-web/src/features/chat/process/processDetails.ts`

- [ ] **Step 1: Add a failing lifecycle title test**

Add a test that builds a started/completed pair with the same `toolCallId`, where only started carries the target:

```ts
it('shows and retains the capability target name across lifecycle events', () => {
  const entries = buildProcessDisplayEntries(
    buildProcessEntries(
      [
        event('CAPABILITY_STARTED', 1, {
          capabilityId: 'Agent',
          capabilityTargetName: 'network-explorer',
          toolCallId: 'tool-agent-target',
        }),
        event('CAPABILITY_COMPLETED', 2, {
          capabilityId: 'Agent',
          toolCallId: 'tool-agent-target',
          status: 'SUCCEEDED',
          resultPresentationLevel: 'STATUS_ONLY',
        }),
      ],
      i18n.getFixedT('zh-CN'),
    ),
    i18n.getFixedT('zh-CN'),
  );

  expect(entries).toHaveLength(1);
  expect(entries[0]?.title).toBe('Agent · network-explorer · 已完成');
});
```

Add table cases for `SKILL · network-diagnostics` and `ApiCall · query-network-kpi`, plus a missing-name case that keeps the current wrapper-only title.

- [ ] **Step 2: Run the frontend test and verify RED**

Run from `frontend/agent-web`:

```bash
PATH=/Users/gaoyang/.nvm/versions/node/v22.22.2/bin:$PATH npx vitest run tests/processDetailsProjection.test.ts
```

Expected: new title assertions fail because the target name is ignored.

- [ ] **Step 3: Implement bounded frontend reading and title retention**

Add a reader that accepts only the already validated wire shape defensively:

```ts
const capabilityTargetNamePattern = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u;

function readCapabilityTargetName(event: StreamEnvelope): string | null {
  const candidate = readPayloadString(event.payload as Record<string, unknown>, 'capabilityTargetName');
  return candidate !== null && capabilityTargetNamePattern.test(candidate) ? candidate : null;
}

function displayCapabilityName(toolName: string, targetName: string | null): string {
  const wrapperName = displayToolName(toolName);
  return targetName === null ? wrapperName : `${wrapperName} · ${targetName}`;
}
```

In the main `CAPABILITY_STARTED` / `CAPABILITY_RESULT_DELTA` / `CAPABILITY_COMPLETED` aggregation branch, compute the display name so later events without the field retain the started value:

```ts
const targetName = readCapabilityTargetName(event);
const normalizedToolName =
  targetName === null
    ? (previousEntry?.toolName ?? displayToolName(toolName ?? t('turn.process.unknownTool')))
    : displayCapabilityName(toolName ?? t('turn.process.unknownTool'), targetName);
```

Use the same helper in `describeProcessTimelineEvent` and the legacy timeline aggregation path only where a title is formed. Do not change `readToolName`, `isSkillToolName`, safe-result formatting, status labels, or card expansion rules.

- [ ] **Step 4: Run the frontend test and verify GREEN**

Run the command from Step 2. Expected: all tests pass, including existing Skill/result, Agent status-only, failure, folding, and AskUserQuestion cases.

- [ ] **Step 5: Build Agent Web**

Run from `frontend/agent-web`:

```bash
PATH=/Users/gaoyang/.nvm/versions/node/v22.22.2/bin:$PATH npm run build
```

Expected: TypeScript and Vite build complete successfully.

- [ ] **Step 6: Commit the frontend behavior**

```bash
git add frontend/agent-web/src/features/chat/process/processDetails.ts frontend/agent-web/tests/processDetailsProjection.test.ts
git commit -m "feat(agent-web): show capability target names"
```

### Task 4: Verify disclosure isolation and local DETAIL behavior

**Files:**
- Modify: `openspec/changes/expose-safe-capability-technical-name/tasks.md`
- No production configuration file changes.

- [ ] **Step 1: Run focused backend and frontend suites**

From the repository root:

```bash
PATH=/Users/gaoyang/.nvm/versions/node/v22.22.2/bin:$PATH npx vitest run packages/agent-channel-common/tests/process-message-projection.test.ts packages/agent-channel-common/tests/capability-result-presentation-policy.test.ts
```

From `frontend/agent-web`:

```bash
PATH=/Users/gaoyang/.nvm/versions/node/v22.22.2/bin:$PATH npx vitest run tests/processDetailsProjection.test.ts
```

Expected: all focused tests pass; record the exact case counts in `tasks.md`.

- [ ] **Step 2: Verify the existing Bash/Read DETAIL contract**

Run the existing policy suite and confirm its parameterized `Bash` and `Read` cases still produce:

- `DETAIL`: bounded `safeResult` and detail text.
- `SUMMARY`: safe summary without detail body.
- `STATUS_ONLY`: no result body.
- Skill/Agent/ApiCall: no result body at every configured level.

Do not change built-in defaults in `packages/agent-app/src/config/validation.ts`.

- [ ] **Step 3: Run scoped repository gates**

From the repository root:

```bash
PATH=/Users/gaoyang/.nvm/versions/node/v22.22.2/bin:$PATH npm run build
PATH=/Users/gaoyang/.nvm/versions/node/v22.22.2/bin:$PATH npm run lint:architecture
openspec validate expose-safe-capability-technical-name --strict
git diff --check origin/main...HEAD
```

From `frontend/agent-web`:

```bash
PATH=/Users/gaoyang/.nvm/versions/node/v22.22.2/bin:$PATH npm run build
```

Expected: all scoped gates pass. Run broader `npm test` and `npm run test:contract` before push; distinguish baseline noise from change-caused failures with exact evidence.

- [ ] **Step 4: Perform local manual verification without committing config**

Start the real local service with an external `application.yaml` override containing:

```yaml
nextAgent:
  system:
    capability-result-presentation:
      rules:
        - capability-id: Bash
          level: DETAIL
        - capability-id: Read
          level: DETAIL
```

Verify:

1. A real Skill call shows its technical name while executing, after completion, and after refresh.
2. A real Agent call shows its technical id in the same three states.
3. Bash shows exit code and bounded stdout/stderr preview without its input command.
4. Read shows safe display path and bounded content preview.
5. Restoring the original config and restarting returns Bash/Read to `SUMMARY`.

- [ ] **Step 5: Update OpenSpec task evidence and run semantic review**

Mark each OpenSpec task complete only with its exact RED/GREEN command or build result. Apply `nextagent-code-review` before push; expected result is `PASS` or `PASS WITH FOLLOW-UP` with no P0/P1.

- [ ] **Step 6: Commit verification evidence**

```bash
git add openspec/changes/expose-safe-capability-technical-name/tasks.md
git commit -m "docs(capability): record target identity verification"
```

## Completion Criteria

- Skill, Agent, and ordinary-tool ApiCall expose only one validated technical target identifier.
- The identifier survives completion and refreshed history through existing Message association plus frontend `toolCallId` aggregation.
- Arbitrary arguments, paths, prompt, raw results, credentials, and completion-only result content do not become identity.
- Missing or invalid identity degrades locally without hiding the process step or final answer.
- Result disclosure levels and platform ceilings are byte-for-byte unchanged outside the new optional identity field.
- Bash/Read `DETAIL` is proven through existing configuration and safe projectors; production defaults remain unchanged.
- OpenSpec strict validation, focused tests, Agent Web build, architecture lint, and semantic review pass.
