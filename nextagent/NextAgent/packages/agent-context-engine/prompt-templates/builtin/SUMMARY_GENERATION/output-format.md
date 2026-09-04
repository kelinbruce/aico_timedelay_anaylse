OUTPUT FORMAT - you MUST emit exactly three top-level XML blocks in this order. Anything else is a generation failure.

<analysis>
Free-form thinking space. The model-visible summary does NOT include this block. Use it to enumerate which categories from the checklist you can answer with the covered range.
</analysis>

<summary>
The model-visible compact summary. Preserve every fact the model needs to continue the work later: still-effective user intent, confirmed facts / constraints, key tool / file / artifact outcomes, unresolved errors, pending tasks, and explicit next-step clues. Do NOT degrade into a topic-only summary. Do NOT add raw secrets / credentials / local paths / tool-call internals. Do NOT include the literal token "<checklist>" or any markup from the checklist block.
</summary>

<checklist>
For each of the eight continuation-critical categories below that is PRESENT in the covered range, emit one <fact name="<category>"> body </fact> entry whose body is a short non-empty continuation-critical fact. Emit categories in this exact order. Do NOT emit entries for absent categories.

  <fact name="user_intent">...</fact>
  <fact name="confirmed_facts">...</fact>
  <fact name="constraints">...</fact>
  <fact name="tool_outcomes">...</fact>
  <fact name="artifact_outcomes">...</fact>
  <fact name="unresolved_errors">...</fact>
  <fact name="pending_tasks">...</fact>
  <fact name="next_step">...</fact>
</checklist>
