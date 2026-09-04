import { AgentError, brand, type JsonObject } from '@nextagent/agent-common';

import { defineTool } from '../../tools/tool-spi.js';
import { askUserQuestionInputSchema, askUserQuestionOutputSchema } from './ask-user-question-schemas.js';

export const askUserQuestionCapabilityId = brand<string, 'CapabilityId'>('AskUserQuestion');

const freeTextAnswerHandlingGuidance =
  'FREE-TEXT ANSWER HANDLING RULE:\n- Predefined options are suggestions, not an allowlist. Free-text is valid even when it does not match an option value or label.\n- Treat resolvedAnswers as authoritative: selections=[] means the user selected no predefined option. When customText is present without a selection, it is an independent natural-language answer; never claim or infer that the user selected an option.\n- Never reject a free-text answer, describe it as invalid, or ask the user to select again solely because it is outside the predefined options.\n- Interpret free text by its own natural-language meaning. Never coerce or map it to the closest predefined option when its literal intent differs from that option.\n- If free text expresses an intent not represented by the options, follow the free-text intent instead of the options; if it belongs to a different domain or target than the question, apply the ANSWER CLASSIFICATION RULE. If it provides enough information, continue directly.\n- If free text expresses a valid intent but lacks required information, preserve that exact intent and ask only for the missing information. Never ask the user to repeat, reselect, or reconfirm information already provided.\n\nANSWER CLASSIFICATION RULE:\n- Classify returned text before using it: if it answers the question, use it as the answer. If it is a new intent aimed at a different domain or target (any clear topic shift, not only imperatives), set the question aside and handle the new request; never force it into the answer slot.\n- Once confirmed as a new request, focus fully on it and treat the original question as closed. Do not re-ask, restate, loop back to, or otherwise resume the original question.';

export const askUserQuestionDescription =
  `${freeTextAnswerHandlingGuidance}\n\n` +
  'Ask the user a clarification question. You MUST call this tool whenever you need to ask the user any ordinary question—never use plain assistant text to ask questions.\n\nWhen to use (mandatory):\n- A Skill returns FAILED because it needs user-provided information.\n- A Skill interaction requires the user to choose among known options or give short text.\n- User intent is ambiguous and cannot be resolved from context or available tools.\n- You need a follow-up, clarification, preference, implementation choice, or ordinary confirmation.\n\nHow to construct arguments:\n- questions must be a native JSON array of one to three question objects.\n- Omit options for free-text answers.\n- Include options for predefined choices, each with a unique value.\n- Set multiple=true only when the user may select more than one option.\n- Set question-level custom=true for one generic free-text answer alongside predefined options; do not add a synthetic custom option.\n- Users may provide free-text answers outside the predefined options regardless of whether custom=true is declared; reference and use such answers in subsequent steps.\n\nCRITICAL OPTION VALIDATION RULE:\n- An option may omit requiresTextInput only when selecting its value alone is a complete, immediately actionable answer.\n- If an option still needs a target, value, identifier, name, reason, description, correction, replacement, or any other detail before the task can continue, you MUST set requiresTextInput=true on it; add inputPlaceholder when useful, and do not combine such options with multiple=true.\n- Omitting requiresTextInput asserts the option is complete and executable as provided; never omit it when any required information remains unspecified.\n- Never request more information only through the option label. If the label asks or implies that the user should enter, specify, provide, change, replace, correct, describe, or explain something, you MUST set requiresTextInput=true.\n- Before returning the call, inspect every option: if clicking it without extra text would leave required information missing, you MUST set requiresTextInput=true.\n\nDo NOT use this tool for generic permission to proceed, plan approval, status acknowledgements, credentials, secrets, authorization grants, protected-operation approval, high-risk confirmations, human handoff, surveys, or long-form forms.';

export const askUserQuestionToolDefinition = defineTool({
  name: askUserQuestionCapabilityId,
  description: askUserQuestionDescription,
  inputSchema: askUserQuestionInputSchema,
  outputSchema: askUserQuestionOutputSchema,
  replayPolicy: 'NON_IDEMPOTENT',
  async execute(_input: JsonObject) {
    throw new AgentError({
      code: 'ASK_USER_QUESTION_PRODUCER_REQUIRED',
      message:
        'AskUserQuestion reached the direct execution boundary instead of the runtime-owned pending-input producer, so no question was accepted. Ask in a normal response or stop and report the invalid runtime path.',
      category: 'INTERNAL',
      retryable: false,
    });
  },
});
