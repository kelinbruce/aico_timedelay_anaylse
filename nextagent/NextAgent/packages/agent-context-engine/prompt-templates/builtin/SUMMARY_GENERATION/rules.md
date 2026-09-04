RULES:
- The <summary> block is the only block the model will see in the next turn. Make it self-contained.
- The <checklist> block is consumed only by the compaction module for validation; it is never shown to the model.
- If a present category has no continuation-critical content, you MUST still emit its <fact> entry with a non-empty body indicating why, for example "no explicit constraint was stated in the covered range, but the request was confirmatory".
- Never invent facts that are not supported by the covered messages.
