# Capability Current Resource Failure Isolation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkboxes for tracking.

**Goal:** Prevent one invalid current Capability resource from making the entire Session capability-presentation query return 503 while preserving source-level failure, public contracts, and existing Catalog winner semantics.

**Architecture:** Keep `CapabilityDiscovery.listCurrent` returning `Promise<readonly CapabilityDescriptor[]>`. Local Skill, SkillHub, and local subagent sources skip a single resource that cannot form a valid descriptor and reuse safe bounded diagnostics; Workflow keeps its existing per-file skip. Root/index/registry/locator failures other than an optional Skill root `ENOENT`, Provider throw/timeout/cancel, invalid descriptor aggregates, and incomplete EAGER facts still reject. Sources recheck cancellation after non-cancellable awaits and before publishing diagnostic snapshots. Local subagent mapping uses the canonical descriptor schema per assembly so one malformed descriptor cannot reach aggregate validation. `StaticCapabilityCatalog` keeps its existing winner/governance semantics and governs only valid descriptors, so presentation and model-visible execution share the same winner rules. Provider guard and Catalog safe rethrows retain the original error as `cause` solely for local diagnostics. The Web fallback records that source-level cause chain locally while retaining the existing safe 503 response.

**Tech Stack:** TypeScript strict ESM, Vitest, Fastify, runtime logger, npm workspaces, OpenSpec.

---

## File Structure

- Modify `packages/agent-capability/src/local/skill-discovery.ts`: skip one current Skill manifest failure and reuse existing safe diagnostics.
- Modify `packages/agent-capability/tests/local-skill-source.test.ts`: reproduce missing and invalid Skill failures with valid siblings.
- Verify `packages/agent-capability/tests/runtime-generated-skill-activation.test.ts`: retain coverage of the shared runtime-generated path.
- Modify `packages/agent-capability/src/skillhub/skillhub-source.ts`: skip one installed manifest failure while keeping strict index failure.
- Modify `packages/agent-capability/tests/skillhub-source.test.ts`: cover missing, invalid, and hash-mismatched installed manifests.
- Modify `packages/agent-capability/src/agents/agent-discovery.ts`: validate each mapped descriptor canonically and retain valid parent subagents when one assembly is invalid.
- Modify `packages/agent-capability/tests/invoked-agent-discovery.test.ts`: cover per-assembly descriptor-schema isolation and source failure.
- Modify `packages/agent-workflow/tests/workflow-recipe-blackbox.test.ts`: characterize existing per-file isolation; production loader is unchanged.
- Modify `packages/agent-capability/src/extension-registration.ts`: keep current-read failure mapping unchanged while retaining the caught error as `cause`.
- Modify `packages/agent-capability/tests/extension-registration.test.ts`: retain external Provider source-level negative coverage and verify the safe cause chain.
- Modify `packages/agent-capability/src/catalog/catalog.ts`: keep current winner/governance behavior unchanged while retaining current-reader failure as `cause`.
- Modify `packages/agent-capability/tests/capability-current-view.test.ts`: characterize existing Catalog/current/model-visible winner parity and verify the safe cause chain.
- Modify `packages/agent-channel-web/src/routes/requests.ts`: record canonical `rawExceptionData` before returning the safe 503.
- Modify `packages/agent-channel-web/tests/capability-presentation-resource-routes.test.ts`: verify local diagnostics and public non-disclosure.
- Modify the active OpenSpec artifacts and Issue #763 to record the final scope and evidence.

No new directory, `agent-contracts` type, failure DTO, reason code, Gateway contract, Web DTO, frontend state, Skill parser/schema, Catalog winner/governance rule, model disclosure path, execution path, or persistence object is introduced. The only guard/Catalog production change is preserving `Error.cause` across existing safe error normalization for local diagnostics.

### Task 1: Isolate Local Skill current resource failures

**Files:**
- Modify: `packages/agent-capability/tests/local-skill-source.test.ts`
- Modify: `packages/agent-capability/tests/runtime-generated-skill-activation.test.ts`
- Modify: `packages/agent-capability/src/local/skill-discovery.ts`

- [x] **Step 1: Write RED tests for a missing/unreadable manifest and a schema-rejected manifest**

Create a current source root containing one valid Skill plus one invalid sibling. Assert `listCurrent(...)` resolves with only the valid descriptor. Cover both the `parseMetadataViewFromFile` catch path and `parsed.outcome === 'rejected'`. Preserve configured locator invalid/throw and root-level non-`ENOENT` read failure; lock locator `not-found`/`undefined` and optional Skill root `ENOENT` as a complete empty source. Delay a locator, cancel while it is pending, and assert rejection without replacing the last completed diagnostic snapshot.

- [x] **Step 2: Run the focused tests and verify RED**

Run:

```bash
npx vitest run --config vitest.config.release.ts packages/agent-capability/tests/local-skill-source.test.ts packages/agent-capability/tests/runtime-generated-skill-activation.test.ts
```

Expected: the single-manifest cases reject with `Local Skill current view is unavailable.`, while the pending-locator cancellation resolves as an empty success and replaces evidence.

- [x] **Step 3: Implement the minimal source-local skip**

In `scanCurrentRoot`, replace only the single-manifest catch/rejected throws with the same safe `LOCAL_SKILL_MANIFEST_MISSING` / `LOCAL_SKILL_MANIFEST_INVALID` diagnostic shape used by startup `scanRoot`, then `continue`. Recheck cancellation after locator, directory, and manifest awaits and before committing the diagnostic snapshot. Keep root `readdir` non-ENOENT, locator failure, unsafe directory names, parser/schema, and loading facts unchanged.

- [x] **Step 4: Run Local Skill tests and verify GREEN**

Run the command from Step 2 plus:

```bash
npx vitest run --config vitest.config.release.ts packages/agent-capability/tests/skill-manifest.test.ts
```

Expected: all focused tests pass and parser behavior is unchanged.

### Task 2: Isolate SkillHub installed resource failures

**Files:**
- Modify: `packages/agent-capability/tests/skillhub-source.test.ts`
- Modify: `packages/agent-capability/src/skillhub/skillhub-source.ts`

- [x] **Step 1: Write RED table tests**

For an installed index containing one valid sibling, cover one other installed manifest that is missing, schema-invalid, or has a frontmatter hash mismatch. Assert the valid descriptor remains and the invalid resource is absent. Assert corrupt `readStrict()` index still rejects and presentation current-read performs no remote list/fetch/install/index write. Delay `readStrict()`, cancel while it is pending, and assert rejection without replacing the last completed diagnostic snapshot.

- [x] **Step 2: Run the focused test and verify RED**

Run:

```bash
npx vitest run --config vitest.config.release.ts packages/agent-capability/tests/skillhub-source.test.ts
```

Expected: each new case rejects with `SkillHub current view is unavailable.`.

- [x] **Step 3: Implement the minimal installed-item skip**

In `SkillHubSource.listCurrent`, reuse existing `SKILLHUB_MANIFEST_MISSING` or `SKILLHUB_MANIFEST_INVALID` evidence and continue for only the current installed fact. Recheck cancellation after index and manifest awaits and before committing diagnostics. Preserve strict index failure, scope matching, remote acquisition behavior, body loading, and descriptor projection.

- [x] **Step 4: Run SkillHub tests and verify GREEN**

Run the command from Step 2. Record the known unrelated governed Skill Tool baseline failure separately if it remains exactly attributable to Issue #764.

### Task 3: Isolate local subagent assembly failures and characterize Workflow/external sources

**Files:**
- Modify: `packages/agent-capability/tests/invoked-agent-discovery.test.ts`
- Modify: `packages/agent-capability/src/agents/agent-discovery.ts`
- Modify: `packages/agent-workflow/tests/workflow-recipe-blackbox.test.ts`
- Modify: `packages/agent-capability/tests/extension-registration.test.ts`

- [x] **Step 1: Write the local subagent RED test**

Return one valid parent-subagent assembly and one assembly whose mapped descriptor has a schema-invalid locale. Assert `listCurrent` returns the valid Agent descriptor and records existing `LOCAL_AGENT_DEFINITION_INVALID` evidence. Add or retain a configured source throw/cancellation assertion, and characterize an unconfigured optional source as a complete empty source.

- [x] **Step 2: Verify local subagent RED**

Run:

```bash
npx vitest run --config vitest.config.release.ts packages/agent-capability/tests/invoked-agent-discovery.test.ts
```

Expected: the invalid descriptor is returned alongside the valid sibling because source mapping does not yet apply the canonical descriptor schema; aggregate guard validation would then fail the whole Provider result.

- [x] **Step 3: Isolate invalid mapped descriptors**

Delete the post-map `descriptors.length !== assemblies.length` throw and validate each mapped descriptor with the canonical `capabilityDescriptorSchema` before it enters the result array. Reuse existing invalid evidence. Keep the source call, scope request, sorting, and public contract unchanged.

- [x] **Step 4: Add characterization tests without production changes**

Use the public Workflow recipe provider current reader to prove one invalid Recipe file does not hide a valid sibling. Retain external SEARCH Provider guard coverage showing Provider throw/timeout/cancel/invalid descriptor aggregate rejects. Do not change the Workflow loader or any Provider/Catalog success, descriptor, winner, or governance semantics; only preserve the cause chain across existing safe failures.

- [x] **Step 5: Run the focused tests and verify GREEN**

Run:

```bash
npx vitest run --config vitest.config.release.ts packages/agent-capability/tests/invoked-agent-discovery.test.ts packages/agent-workflow/tests/workflow-recipe-blackbox.test.ts packages/agent-capability/tests/extension-registration.test.ts
```

Expected: all focused tests pass.

### Task 4: Preserve Catalog and model-disclosure winner parity

**Files:**
- Modify: `packages/agent-capability/tests/local-skill-source.test.ts`
- Modify: `packages/agent-capability/tests/capability-current-view.test.ts`

- [x] **Step 1: Add the cross-path characterization**

Arrange an invalid high-priority current resource with the same `capabilityId` as a valid lower-priority resource. Because the invalid resource never forms a descriptor, assert the valid resource wins in both `CapabilityCurrentViewPort.listCurrent(...)` and the execution/model-visible `listAvailable({ modelInvocable: true })` path. Also assert the invalid resource cannot resolve or invoke.

- [x] **Step 2: Run the Catalog tests**

Run:

```bash
npx vitest run --config vitest.config.release.ts packages/agent-capability/tests/local-skill-source.test.ts packages/agent-capability/tests/capability-current-view.test.ts packages/agent-capability/tests/catalog.test.ts packages/agent-capability/tests/conflict-resolution.test.ts
```

Expected: tests pass with no Catalog descriptor, winner, or governance behavior change; the only `catalog.ts` production diff retains the caught current-reader error as `cause`.

### Task 5: Record source-level presentation failures safely

**Files:**
- Modify: `packages/agent-channel-web/tests/capability-presentation-resource-routes.test.ts`
- Modify: `packages/agent-channel-web/src/routes/requests.ts`

- [x] **Step 1: Write the RED logging test**

Bind a capturing runtime logger, make `listResources` throw an error containing an internal-path canary, and assert the local warning contains event identity plus canonical `rawExceptionData`. Independently assert the HTTP response is still status 503 with only `CAPABILITY_PRESENTATION_RESOURCES_UNAVAILABLE` and the generic message, with no canary or path.

- [x] **Step 2: Run the route test and verify RED**

Run:

```bash
npx vitest run --config vitest.config.channel-web.ts packages/agent-channel-web/tests/capability-presentation-resource-routes.test.ts
```

Expected: the HTTP assertion passes but no warning with `rawExceptionData` is captured.

- [x] **Step 3: Implement canonical local diagnostics**

At the Capability presentation route only, replace its generic fallback call with a narrow try/catch around `withAbortableRequest`. Catch `error`, compute `runtimeRawExceptionData(error)`, and call the existing request-routes runtime logger before sending the current safe 503. Use stable code-owned event and safe error code fields. Do not modify the shared `withUnavailableFallback` or add the raw data to Fastify reply, SafeError, timeline, stream, metric, trace, or audit output.

- [x] **Step 4: Run the route and logging safety tests**

Run the command from Step 2 and the relevant runtime logger security tests. Expected: local diagnostics are present and the public response remains unchanged.

### Task 6: Update Issue/OpenSpec evidence and verify the boundary

**Files:**
- Modify: `openspec/changes/provide-provider-backed-capability-display-names/proposal.md`
- Modify: `openspec/changes/provide-provider-backed-capability-display-names/design.md`
- Modify: `openspec/changes/provide-provider-backed-capability-display-names/specs/capability-source-configuration/spec.md`
- Modify: `openspec/changes/provide-provider-backed-capability-display-names/tasks.md`
- External: GitCode Issue #763

- [x] **Step 1: Update Issue #763**

Keep assignee `gcw_qP9C4e91`. Record the source-local isolation matrix, unchanged array contract, unchanged parser/schema/Catalog/Web DTO/Gateway/persistence, source-level 503 boundary, safe diagnostics, and acceptance tests. Link parser compatibility Issue #762 and baseline Issue #764.

- [x] **Step 2: Record verified RED/GREEN evidence in OpenSpec tasks**

Check off each task only after its specified command succeeds. Keep the Issue #764 baseline record separate from change-caused failures.

- [x] **Step 3: Run focused and project gates**

Run:

```bash
npm run build
npm run test:contract
npm run lint:architecture
openspec validate provide-provider-backed-capability-display-names --strict
openspec validate --all --strict
git diff --check
```

Run the affected Vitest files from Tasks 1–5. Run broader `npm test` and record any exact baseline failure separately.

The final browser gate starts the fixed commit through the branch-fullstack launcher with the immutable `all-scenarios` version, creates a Session from the real MiniMax Local Web UI, waits for a terminal response, and observes the browser-owned presentation request. Acceptance requires HTTP 200 from `capability-presentation-resources`, valid projected resources, the localized completed process title, and no visible request failure. Per-resource invalid Skill isolation remains a source/Catalog black-box test because Scenario Packs own read-only business data rather than Agent-owned Skill configuration.

- [x] **Step 4: Perform semantic reviews**

Use `nextagent-skill-review` for the updated OpenSpec and `nextagent-code-review` for the complete implementation diff. Fix all BLOCKER/P0/P1 findings before push; do not push unless the user requests it and the mandatory push review passes.
