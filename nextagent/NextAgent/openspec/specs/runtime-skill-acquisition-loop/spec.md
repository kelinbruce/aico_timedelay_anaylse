# runtime-skill-acquisition-loop Specification

## Purpose

Define controlled same-run SkillHub-backed Skill acquisition, frozen model invocation snapshots, step-boundary replanning, safe evidence and runtime-generated local Skill activation.
## Requirements
### Requirement: Runtime Skill Acquisition MUST Replan Within The Same Run

当主执行 loop 发现当前 capability snapshot 无法满足用户任务时，系统 SHALL support a controlled Skill acquisition path that can discover, install and govern a remote Skill within the same accepted request/run, then continue execution from a later model step. The acquisition result MUST NOT make an ungoverned remote payload directly executable; it MUST only make the Skill available through the governed catalog for a later capability resolution after the Skill has entered the governed catalog.

#### Scenario: Missing Skill is acquired and used in the same run
- **WHEN** an accepted request/run starts with a capability snapshot that does not contain the Skill needed to complete the telecom task
- **AND** the agent loop triggers the controlled acquisition path for that missing Skill
- **AND** SkillHub search, content fetch, managed install, index publication and catalog governance all succeed
- **THEN** runtime MUST rebuild the capability snapshot for a later model step in the same request/run
- **AND** that later model step MUST be able to see the acquired Skill as a governed catalog descriptor
- **AND** Skill Tool body loading MUST use the installed source loading facts for that descriptor rather than the raw remote response

#### Scenario: Acquisition failure degrades safely
- **WHEN** the controlled acquisition path cannot find, fetch, validate, install or govern a requested Skill
- **THEN** the current request/run MUST continue through a safe failure or replanning path instead of exposing an ungoverned Skill
- **AND** the safe outcome MUST NOT expose endpoint, credential, managed install path, staging path, raw package bytes, raw provider response or provider-private loading key

### Requirement: Model Invocation Capability Snapshot MUST Be Frozen

Each model invocation SHALL use a frozen capability snapshot. Runtime, core, capability, hook or acquisition code MUST NOT silently add, remove or mutate the toolset disclosed to a model invocation after that invocation has started. Newly acquired Skills MAY affect only a later model step after runtime records the acquisition outcome and rebuilds the snapshot.

#### Scenario: Acquisition does not mutate an active model invocation
- **WHEN** a model invocation has started with a capability snapshot
- **AND** a remote Skill becomes available during or after that invocation
- **THEN** the active invocation MUST continue with its original disclosed toolset
- **AND** the new Skill MUST NOT appear until a later model step receives a rebuilt capability snapshot

#### Scenario: Rebuilt snapshot is tied to a step boundary
- **WHEN** acquisition succeeds after a model step determines that additional Skill capability is needed
- **THEN** runtime MUST record a step boundary before using a rebuilt capability snapshot
- **AND** the next model step MUST have a new observable planning boundary or equivalent execution evidence showing that the snapshot was rebuilt after acquisition

### Requirement: Runtime Skill Acquisition MUST Be Observable And Recoverable

Skill acquisition inside a request/run SHALL produce safe execution evidence sufficient to diagnose whether the run searched, installed, skipped, failed or rebuilt its capability snapshot. The evidence MUST preserve runtime terminal commit correctness and replay/recovery clarity without leaking provider-private facts.

#### Scenario: Acquisition emits safe timeline evidence
- **WHEN** runtime performs controlled Skill acquisition inside a request/run
- **THEN** the run timeline or equivalent execution evidence MUST include generic safe capability invocation/result evidence for the acquisition capability
- **AND** those events MUST identify provider kind, safe provider id, safe skill id when known, and safe outcome code
- **AND** those events MUST NOT include endpoint, credential, managed install path, staging path, raw package bytes, raw provider response or provider-private loading key

#### Scenario: Resume does not replay unsafe acquisition side effects
- **WHEN** a request/run is resumed after acquisition already installed and indexed a Skill
- **THEN** the resumed execution MUST rely on durable governed catalog/index facts or repeat acquisition through the same idempotent install/governance path
- **AND** it MUST NOT execute a staged folder, raw package or remote response that has not been published through the governed index

### Requirement: Runtime Generated Skill MUST Activate As Local Execution-Scope Source

When `skill-creator` or an equivalent governed write path creates a Skill under the execution-scope `generated-skills/<skill-name>/` root, the system SHALL treat that Skill as runtime-generated local source for the current execution scope. It MUST NOT require SkillHub synchronization before local use, and it MUST NOT automatically publish, copy or register that Skill into SkillHub managed install/index.

The generated Skill MAY become visible only through a later capability resolution or later model step. It MUST NOT mutate the toolset of an already started model invocation.

#### Scenario: Generated Skill becomes available in the next step
- **WHEN** a governed write creates `generated-skills/<skill-name>/SKILL.md` with a valid manifest in the current execution scope
- **THEN** a later capability resolution in the same execution scope MUST be able to discover that Skill as runtime-generated local source
- **AND** a later model step MAY call it through the governed Skill Tool path
- **AND** the active model invocation that performed the write MUST NOT have its disclosed toolset mutated in place

#### Scenario: Generated Skill is not silently synchronized to SkillHub
- **WHEN** a generated Skill is created under `generated-skills/<skill-name>/`
- **THEN** the system MUST NOT write that Skill to SkillHub managed install directories or `remote-skill-content-index.json`
- **AND** the system MUST NOT call SkillHub publish, search or package endpoints solely because the local generated Skill exists
- **AND** any later publication to SkillHub MUST be performed through an explicit governed publish path defined by a separate capability/change
