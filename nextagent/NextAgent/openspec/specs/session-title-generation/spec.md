# session-title-generation Specification

## Purpose
定义 ordinary submit acceptance 后非阻塞的会话标题生成、手工或既有标题保护、确定性有界提取及 owner-and-Agent scoped persistence；retry 和 edit 不触发自动生成。
## Requirements
### Requirement: Accepted ordinary submit SHALL start a non-blocking title attempt until the session is resolved

After each ordinary submit has persisted and emitted `REQUEST_ACCEPTED`, runtime SHALL start automatic title generation as fire-and-forget work using that accepted command input text, unless the same runtime instance has already recorded the session as generated or intentionally skipped because a manual or existing title was found. Title generation MUST NOT delay request scheduling, execution, streaming, or terminal commit. It SHALL NOT wait for request terminal state and SHALL NOT query conversation history to choose a different prompt. Retry and edit-resubmit acceptance SHALL NOT start this title path.

#### Scenario: Accepted ordinary submit starts title work
- **GIVEN** an ordinary submit has persisted and emitted `REQUEST_ACCEPTED`
- **WHEN** the current runtime has not resolved title generation for that session
- **THEN** runtime SHALL start automatic title generation from that command's input text
- **AND** SHALL continue scheduling without awaiting title completion

#### Scenario: Failed or ineligible attempt may be retried by a later submit
- **GIVEN** an attempt returns without generation because its input is blank, slash-prefixed, unsafe, missing, or failed
- **WHEN** a later ordinary submit is accepted in the same session
- **THEN** runtime SHALL attempt title generation again from the later command input

#### Scenario: Retry and edit do not start title work
- **WHEN** retry or edit-resubmit is accepted
- **THEN** that acceptance SHALL NOT invoke the automatic title generation path

#### Scenario: Title failure does not fail the request
- **WHEN** automatic title generation throws or cannot persist a title
- **THEN** the request lifecycle SHALL continue independently
- **AND** the failure SHALL NOT alter the request terminal outcome

### Requirement: Automatic title generation SHALL preserve manual or existing titles

Automatic generation SHALL load the session with trusted owner and Agent scope. It SHALL do nothing for a missing session, a session whose `titleSource` is `manual`, or a session whose current title has non-zero length. Blank input and slash-command input SHALL not produce an automatic title.

#### Scenario: Manual title is not overwritten
- **GIVEN** a session has `titleSource="manual"`
- **WHEN** automatic title generation runs
- **THEN** it SHALL preserve the existing title and source

#### Scenario: Existing non-empty title is not overwritten
- **GIVEN** a session already has a title whose length is greater than zero
- **WHEN** automatic title generation runs
- **THEN** it SHALL preserve that title

#### Scenario: Slash command does not generate a title
- **GIVEN** the accepted input begins with `/` after trimming
- **WHEN** automatic title generation evaluates it
- **THEN** it SHALL not persist an automatic title

### Requirement: Automatic title extraction SHALL be deterministic and bounded

Automatic title extraction SHALL normalize control characters and whitespace, remove leading or trailing punctuation, prefer an early sentence or a sentence-boundary truncation for longer prompts, and bound the persisted title to 40 characters. If the preferred extraction becomes too short, the implementation MAY fall back to normalized original input and still persist a shorter non-empty title. Automatic title output that matches the implemented secret- or XSS-sensitive patterns SHALL be rejected.

#### Scenario: Long prompt produces a bounded title
- **WHEN** accepted input exceeds the preferred title length
- **THEN** extraction SHALL prefer an early sentence or sentence-boundary truncation
- **AND** the persisted automatic title SHALL contain at most 40 characters

#### Scenario: Short normalized fallback remains eligible
- **GIVEN** preferred extraction produces fewer than four characters but normalized original input is non-empty
- **WHEN** fallback extraction runs
- **THEN** the fallback MAY be persisted even when it is shorter than four characters

#### Scenario: Sensitive-looking output is rejected
- **WHEN** extracted output matches the implemented secret- or XSS-sensitive pattern
- **THEN** automatic title generation SHALL NOT persist it

### Requirement: Automatic title persistence SHALL be owner-and-Agent scoped

Runtime SHALL persist an automatic title through the session owner with trusted owner and Agent scope and `titleSource="automatic"`.

#### Scenario: Automatic title write uses trusted scope
- **WHEN** runtime persists an eligible automatic title
- **THEN** the session owner SHALL receive trusted owner and Agent scope
- **AND** the stored title source SHALL be `automatic`
