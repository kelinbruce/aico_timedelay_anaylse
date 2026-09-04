import { memo, useCallback, useEffect, useRef, useState, type CSSProperties } from 'react';
import { Alert, Button, Checkbox, Radio, Spin, Tooltip, Typography } from 'antd';
import { ArrowUpOutlined, ExclamationCircleOutlined } from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { useUserInputStore } from '../../../state/userInputStore.ts';
import type { ActiveUserInput } from '../../../state/userInputStore.ts';
import type { QuestionAnswerKind, UserInputKind, WireTimestamp } from '../../../state/contracts.ts';

export interface RespondInputProps {
  readonly activeInput: ActiveUserInput;
  readonly onSubmit: RespondSubmit;
  readonly onCancel?: RespondCancel;
  readonly disabled?: boolean;
}

type RespondAnswers = ReadonlyArray<readonly string[]>;
type RespondSubmit = (answers: RespondAnswers, answerKinds?: readonly QuestionAnswerKind[]) => Promise<void>;
type RespondCancel = () => Promise<void> | void;

const CUSTOM_OPTION_ID = 'custom';
const FREE_TEXT_ANSWER_MAX_LENGTH = 500;
const CUSTOM_ANSWER_MAX_LENGTH = FREE_TEXT_ANSWER_MAX_LENGTH;
const HUMAN_HANDOFF_CONTENT_MAX_LENGTH = FREE_TEXT_ANSWER_MAX_LENGTH;
const CUSTOM_TEXTAREA_MAX_ROWS = 3;
const CUSTOM_TEXTAREA_LINE_HEIGHT = 20;
const CUSTOM_TEXTAREA_VERTICAL_PADDING = 14;
const CUSTOM_TEXTAREA_MAX_HEIGHT = CUSTOM_TEXTAREA_MAX_ROWS * CUSTOM_TEXTAREA_LINE_HEIGHT + CUSTOM_TEXTAREA_VERTICAL_PADDING;

const RISK_LEVEL_KEYS: Record<string, string> = {
  LOW: 'respondInput.risk.LOW',
  MEDIUM: 'respondInput.risk.MEDIUM',
  HIGH: 'respondInput.risk.HIGH',
  CRITICAL: 'respondInput.risk.CRITICAL',
};

function formatCountdown(
  expiresAt: WireTimestamp,
  timeoutDurationMs: number | null | undefined,
  receivedAt: number | null | undefined,
  t: TFunction,
): string {
  const remaining =
    timeoutDurationMs !== undefined && timeoutDurationMs !== null && receivedAt !== undefined && receivedAt !== null
      ? timeoutDurationMs - (performance.now() - receivedAt)
      : new Date(expiresAt).getTime() - Date.now();
  if (remaining <= 0) {
    return t('respondInput.expired');
  }
  const seconds = Math.floor(remaining / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  if (hours > 0) {
    return t('respondInput.hoursMinutes', { hours, minutes: minutes % 60 });
  }
  if (minutes > 0) {
    return t('respondInput.minutesSeconds', { minutes, seconds: seconds % 60 });
  }
  return t('respondInput.seconds', { seconds });
}

function resizeCustomTextarea(element: HTMLTextAreaElement): void {
  element.style.height = 'auto';
  element.style.height = `${Math.min(element.scrollHeight, CUSTOM_TEXTAREA_MAX_HEIGHT)}px`;
}

function optionRowStyle(selected: boolean, disabled: boolean, extra?: CSSProperties): CSSProperties {
  return {
    minHeight: 36,
    width: '100%',
    minWidth: 0,
    borderRadius: 8,
    border: selected ? '1px solid var(--color-primary)' : '1px solid var(--color-border)',
    background: selected ? 'var(--color-bg-active)' : 'var(--color-bg-primary)',
    color: 'var(--color-text-primary)',
    display: 'flex',
    alignItems: 'flex-start',
    gap: 8,
    padding: '7px 10px',
    boxSizing: 'border-box',
    cursor: disabled ? 'not-allowed' : 'pointer',
    opacity: disabled ? 0.6 : 1,
    ...extra,
  };
}

function optionLabelStyle(extra?: CSSProperties): CSSProperties {
  return {
    flex: 1,
    fontSize: 14,
    lineHeight: '20px',
    minWidth: 0,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    ...extra,
  };
}

function isCustomTriggerOption(option: { readonly id: string }): boolean {
  return option.id.trim().toLowerCase() === CUSTOM_OPTION_ID;
}

function panelActionsStyle(extra?: CSSProperties): CSSProperties {
  return {
    display: 'flex',
    justifyContent: 'flex-end',
    gap: 8,
    marginTop: 2,
    ...extra,
  };
}

function panelActionButtonStyle(extra?: CSSProperties): CSSProperties {
  return {
    borderRadius: 6,
    fontSize: 13,
    height: 28,
    padding: '0 12px',
    ...extra,
  };
}

function isConfirmationPrimaryAction(optionId: string): boolean {
  return ['approve', 'confirm', 'continue'].includes(optionId.trim().toLowerCase());
}

function confirmationActionRank(optionId: string): number {
  const normalized = optionId.trim().toLowerCase();
  if (['cancel', 'deny', 'reject', 'stop'].includes(normalized)) {
    return 0;
  }
  if (isConfirmationPrimaryAction(normalized)) {
    return 1;
  }
  return 1;
}

function ClarificationInput({
  activeInput,
  disabled,
  onSubmit,
}: {
  readonly activeInput: ActiveUserInput;
  readonly disabled: boolean;
  readonly onSubmit: RespondSubmit;
}) {
  const { t } = useTranslation();
  const [value, setValue] = useState('');
  const submitStatus = useUserInputStore((s) => s.submitStatus);
  const submitError = useUserInputStore((s) => s.submitError);
  const isSubmitting = submitStatus === 'submitting';

  const handleSubmit = useCallback(() => {
    const trimmed = value.trim();
    if (!trimmed || isSubmitting) {
      return;
    }
    void onSubmit([[trimmed]]);
  }, [value, isSubmitting, onSubmit]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleSubmit();
      }
    },
    [handleSubmit],
  );

  return (
    <div
      data-testid="respond-input-clarification"
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 8 }}>
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 2 }}>
          <textarea
            data-testid="respond-textarea"
            value={value}
            placeholder={t('respondInput.placeholder')}
            maxLength={FREE_TEXT_ANSWER_MAX_LENGTH}
            disabled={disabled || isSubmitting}
            onChange={(e) => setValue(e.target.value.slice(0, FREE_TEXT_ANSWER_MAX_LENGTH))}
            onKeyDown={handleKeyDown}
            rows={2}
            style={{
              width: '100%',
              resize: 'none',
              border: '1px solid var(--color-border)',
              borderRadius: 12,
              padding: '8px 12px',
              fontSize: 14,
              lineHeight: 1.5,
              outline: 'none',
              fontFamily: 'inherit',
              background: 'var(--color-bg-primary)',
              color: 'var(--color-text-primary)',
              boxSizing: 'border-box',
            }}
          />
          <span
            data-testid="respond-textarea-count"
            style={{ alignSelf: 'flex-end', fontSize: 11, lineHeight: '14px', color: 'var(--color-text-tertiary)' }}
          >
            {value.length}/{FREE_TEXT_ANSWER_MAX_LENGTH}
          </span>
        </div>
        <Button
          type="primary"
          shape="circle"
          icon={isSubmitting ? <Spin size="small" /> : <ArrowUpOutlined />}
          size="small"
          data-testid="btn-submit-response"
          disabled={disabled || !value.trim() || isSubmitting}
          onClick={handleSubmit}
          style={{ width: 32, height: 32, flexShrink: 0 }}
        />
      </div>

      {submitError && (
        <Alert
          data-testid="respond-submit-error"
          type="error"
          showIcon={false}
          message={submitError}
          style={{ borderRadius: 10, padding: '6px 10px' }}
        />
      )}
    </div>
  );
}

function ConfirmationInput({
  activeInput,
  disabled,
  onSubmit,
}: {
  readonly activeInput: ActiveUserInput;
  readonly disabled: boolean;
  readonly onSubmit: RespondSubmit;
}) {
  const { t } = useTranslation();
  const submitStatus = useUserInputStore((s) => s.submitStatus);
  const submitError = useUserInputStore((s) => s.submitError);
  const isSubmitting = submitStatus === 'submitting';
  const options = [
    ...(activeInput.options ?? [
      { id: 'deny', label: t('respondInput.deny') },
      { id: 'confirm', label: t('respondInput.confirm') },
    ]),
  ].sort((left, right) => confirmationActionRank(left.id) - confirmationActionRank(right.id));

  return (
    <div
      data-testid="respond-input-confirmation"
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
      }}
    >
      <div style={panelActionsStyle({ marginTop: 0 })}>
        {options.map((option) => (
          <Button
            key={option.id}
            size="small"
            type={isConfirmationPrimaryAction(option.id) ? 'primary' : 'default'}
            data-testid={`respond-option-${option.id}`}
            autoInsertSpace={false}
            disabled={disabled || isSubmitting}
            onClick={() => {
              if (!isSubmitting) {
                void onSubmit([[option.id]]);
              }
            }}
            style={panelActionButtonStyle()}
          >
            {option.label}
          </Button>
        ))}
      </div>

      {submitError && (
        <Alert
          data-testid="respond-submit-error"
          type="error"
          showIcon={false}
          message={submitError}
          style={{ borderRadius: 10, padding: '6px 10px' }}
        />
      )}
    </div>
  );
}

function ApprovalInput({
  activeInput,
  disabled,
  onSubmit,
}: {
  readonly activeInput: ActiveUserInput;
  readonly disabled: boolean;
  readonly onSubmit: RespondSubmit;
}) {
  const { t } = useTranslation();
  const submitStatus = useUserInputStore((s) => s.submitStatus);
  const submitError = useUserInputStore((s) => s.submitError);
  const isSubmitting = submitStatus === 'submitting';

  const riskLabelKey = activeInput.riskLevel ? RISK_LEVEL_KEYS[activeInput.riskLevel] : undefined;
  const riskLabel = activeInput.riskLevel ? (riskLabelKey ? t(riskLabelKey) : activeInput.riskLevel) : null;

  return (
    <div
      data-testid="respond-input-approval"
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
      }}
    >
      {riskLabel && (
        <div
          data-testid="respond-risk-level"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            alignSelf: 'flex-start',
            padding: '4px 10px',
            borderRadius: 999,
            background: activeInput.riskLevel === 'CRITICAL' || activeInput.riskLevel === 'HIGH' ? '#fff2f0' : '#fffbe6',
            border: activeInput.riskLevel === 'CRITICAL' || activeInput.riskLevel === 'HIGH' ? '1px solid #ffccc7' : '1px solid #ffe58f',
            color: activeInput.riskLevel === 'CRITICAL' || activeInput.riskLevel === 'HIGH' ? '#cf1322' : '#ad6800',
            fontSize: 12,
            lineHeight: '18px',
          }}
        >
          <ExclamationCircleOutlined style={{ fontSize: 12 }} />
          {riskLabel}
        </div>
      )}

      <div style={panelActionsStyle({ marginTop: 0 })}>
        {(
          activeInput.options ?? [
            { id: 'approve', label: t('respondInput.approve') },
            { id: 'reject', label: t('respondInput.reject') },
          ]
        ).map((option) => (
          <Button
            key={option.id}
            size="small"
            data-testid={`respond-option-${option.id}`}
            autoInsertSpace={false}
            disabled={disabled || isSubmitting}
            danger={option.id === 'reject'}
            onClick={() => {
              if (!isSubmitting) {
                void onSubmit([[option.id]]);
              }
            }}
            style={panelActionButtonStyle()}
          >
            {option.label}
          </Button>
        ))}
      </div>

      {submitError && (
        <Alert
          data-testid="respond-submit-error"
          type="error"
          showIcon={false}
          message={submitError}
          style={{ borderRadius: 10, padding: '6px 10px' }}
        />
      )}
    </div>
  );
}

function SelectionInput({
  activeInput,
  disabled,
  onSubmit,
}: {
  readonly activeInput: ActiveUserInput;
  readonly disabled: boolean;
  readonly onSubmit: RespondSubmit;
}) {
  const [selected, setSelected] = useState<string | null>(null);
  const submitStatus = useUserInputStore((s) => s.submitStatus);
  const submitError = useUserInputStore((s) => s.submitError);
  const isSubmitting = submitStatus === 'submitting';

  const options = activeInput.options ?? [];

  const handleSubmit = useCallback(() => {
    if (!selected || isSubmitting) {
      return;
    }
    void onSubmit([[selected]]);
  }, [selected, isSubmitting, onSubmit]);

  return (
    <div
      data-testid="respond-input-selection"
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        minWidth: 0,
      }}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, minWidth: 0, width: '100%' }}>
        {options.map((option) => (
          <Tooltip key={option.id} title={option.label} rootClassName="app-common-tooltip">
            <div
              role="radio"
              aria-checked={selected === option.id}
              tabIndex={disabled || isSubmitting ? -1 : 0}
              data-testid={`respond-option-${option.id}`}
              onClick={() => {
                if (!disabled && !isSubmitting) {
                  setSelected(option.id);
                }
              }}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault();
                  if (!disabled && !isSubmitting) {
                    setSelected(option.id);
                  }
                }
              }}
              style={optionRowStyle(selected === option.id, disabled || isSubmitting)}
            >
              <Radio checked={selected === option.id} style={{ pointerEvents: 'none', flexShrink: 0 }} />
              <span style={optionLabelStyle()}>{option.label}</span>
            </div>
          </Tooltip>
        ))}
      </div>

      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <Button
          type="primary"
          shape="circle"
          icon={isSubmitting ? <Spin size="small" /> : <ArrowUpOutlined />}
          size="small"
          data-testid="btn-submit-response"
          disabled={disabled || !selected || isSubmitting}
          onClick={handleSubmit}
          style={{ width: 32, height: 32 }}
        />
      </div>

      {submitError && (
        <Alert
          data-testid="respond-submit-error"
          type="error"
          showIcon={false}
          message={submitError}
          style={{ borderRadius: 10, padding: '6px 10px' }}
        />
      )}
    </div>
  );
}

function AuthorizationInput({
  activeInput,
  disabled,
  onSubmit,
}: {
  readonly activeInput: ActiveUserInput;
  readonly disabled: boolean;
  readonly onSubmit: RespondSubmit;
}) {
  const { t } = useTranslation();
  const submitStatus = useUserInputStore((s) => s.submitStatus);
  const submitError = useUserInputStore((s) => s.submitError);
  const isSubmitting = submitStatus === 'submitting';
  const options = [
    ...(activeInput.options ?? [
      { id: 'deny', label: t('respondInput.deny') },
      { id: 'approve', label: t('respondInput.authorize') },
    ]),
  ].sort((left, right) => {
    const order = (id: string) => (id === 'deny' ? 0 : id === 'approve' ? 1 : 2);
    return order(left.id) - order(right.id);
  });

  return (
    <div
      data-testid="respond-input-authorization"
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
      }}
    >
      <Typography.Text style={{ fontSize: 13, color: 'var(--color-text-secondary)', lineHeight: '20px' }}>
        {t('respondInput.authorizationHint')}
      </Typography.Text>

      <div style={panelActionsStyle({ marginTop: 14 })}>
        {options.map((option) => (
          <Button
            key={option.id}
            size="small"
            type={option.id === 'approve' ? 'primary' : 'default'}
            data-testid={`respond-option-${option.id}`}
            autoInsertSpace={false}
            disabled={disabled || isSubmitting}
            onClick={() => {
              if (!isSubmitting) {
                void onSubmit([[option.id]]);
              }
            }}
            style={panelActionButtonStyle()}
          >
            {option.label}
          </Button>
        ))}
      </div>

      {submitError && (
        <Alert
          data-testid="respond-submit-error"
          type="error"
          showIcon={false}
          message={submitError}
          style={{ borderRadius: 10, padding: '6px 10px' }}
        />
      )}
    </div>
  );
}

function QuestionInput({
  activeInput,
  disabled,
  onSubmit,
  onCancel,
}: {
  readonly activeInput: ActiveUserInput;
  readonly disabled: boolean;
  readonly onSubmit: RespondSubmit;
  readonly onCancel?: RespondCancel;
}) {
  const { t } = useTranslation();
  const questions =
    activeInput.questions && activeInput.questions.length > 0
      ? activeInput.questions
      : [{ prompt: activeInput.prompt, ...(activeInput.options ? { options: activeInput.options } : {}) }];
  const hasMultipleQuestions = questions.length > 1;
  const headerPrompt = activeInput.prompt || questions[0]?.prompt || '';
  const [answers, setAnswers] = useState<ReadonlyArray<readonly string[]>>(() => questions.map(() => []));
  const [customActiveIndexes, setCustomActiveIndexes] = useState<ReadonlySet<number>>(() => new Set());
  const [customTextValues, setCustomTextValues] = useState<readonly string[]>(() => questions.map(() => ''));
  const [currentQuestionIndex, setCurrentQuestionIndex] = useState(0);
  const currentQuestionRef = useRef<HTMLDivElement>(null);
  const submitStatus = useUserInputStore((s) => s.submitStatus);
  const submitError = useUserInputStore((s) => s.submitError);
  const isSubmitting = submitStatus === 'submitting';

  useEffect(() => {
    setAnswers(questions.map(() => []));
    setCustomActiveIndexes(new Set());
    setCustomTextValues(questions.map(() => ''));
    setCurrentQuestionIndex(0);
  }, [activeInput.inputRequestId, questions.length]);

  useEffect(() => {
    if (hasMultipleQuestions) {
      currentQuestionRef.current?.focus();
    }
  }, [currentQuestionIndex, hasMultipleQuestions]);

  const setQuestionAnswer = useCallback(
    (index: number, values: readonly string[]) => {
      setAnswers((current) => questions.map((_, currentIndex) => (currentIndex === index ? values : (current[currentIndex] ?? []))));
    },
    [questions],
  );

  const setQuestionCustomActive = useCallback((index: number, active: boolean) => {
    setCustomActiveIndexes((current) => {
      const next = new Set(current);
      if (active) {
        next.add(index);
      } else {
        next.delete(index);
      }
      return next;
    });
  }, []);

  const isQuestionReady = useCallback(
    (question: (typeof questions)[number], index: number) => {
      const values = answers[index] ?? [];
      if (customActiveIndexes.has(index)) {
        const customValue = customTextValues[index] ?? '';
        if (customValue.trim().length === 0) {
          return false;
        }
      }
      return values.length > 0 && values.every((value) => value.trim().length > 0);
    },
    [answers, customActiveIndexes, customTextValues],
  );
  const ready = questions.every(isQuestionReady);
  const currentQuestion = questions[currentQuestionIndex] ?? questions[0]!;
  const currentQuestionReady = isQuestionReady(currentQuestion, currentQuestionIndex);
  const isLastQuestion = currentQuestionIndex === questions.length - 1;

  const handleSubmit = useCallback(() => {
    if (!ready || isSubmitting) {
      return;
    }
    const normalizedAnswers = answers.map((values) => values.map((value) => value.trim()).filter(Boolean));
    const answerKinds = questions.map((question, index): QuestionAnswerKind => {
      const options = (question.options ?? []).filter((option) => !isCustomTriggerOption(option));
      if (options.length === 0) {
        return 'TEXT';
      }
      if (customActiveIndexes.has(index)) {
        return question.multiple === true && normalizedAnswers[index]!.length > 1 ? 'OPTION_SELECTIONS_WITH_CUSTOM_TEXT' : 'CUSTOM_TEXT';
      }
      const selectedOption = options.find((option) => option.id === normalizedAnswers[index]?.[0]);
      return selectedOption?.requiresTextInput === true ? 'OPTION_ATTACHED_TEXT' : 'OPTION_SELECTION';
    });
    void onSubmit(normalizedAnswers, answerKinds);
  }, [answers, customActiveIndexes, isSubmitting, onSubmit, questions, ready]);

  const handleTextareaKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        if (hasMultipleQuestions && !isLastQuestion) {
          if (currentQuestionReady) {
            setCurrentQuestionIndex((index) => Math.min(index + 1, questions.length - 1));
          }
          return;
        }
        handleSubmit();
      }
    },
    [currentQuestionReady, handleSubmit, hasMultipleQuestions, isLastQuestion, questions.length],
  );

  return (
    <div
      data-testid="respond-input-question"
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 12,
      }}
    >
      {hasMultipleQuestions && (
        <Typography.Text
          data-testid="respond-question-progress"
          aria-live="polite"
          style={{ fontSize: 13, color: 'var(--color-text-secondary)', lineHeight: '20px' }}
        >
          {t('respondInput.questionProgress', {
            current: currentQuestionIndex + 1,
            total: questions.length,
          })}
        </Typography.Text>
      )}
      <div
        data-testid="respond-question-list"
        className="nextagent-themed-scrollbar"
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 12,
          maxHeight: 'min(420px, 45vh)',
          overflowY: 'auto',
          paddingRight: 2,
          scrollbarColor: 'var(--color-scrollbar) var(--color-bg-primary)',
          scrollbarGutter: 'stable',
        }}
      >
        {(hasMultipleQuestions ? [currentQuestionIndex] : [0]).map((index) => {
          const question = questions[index]!;
          const optionValues = answers[index] ?? [];
          const options = question.options ?? [];
          const selectableOptions = question.custom === true ? options.filter((option) => !isCustomTriggerOption(option)) : options;
          const customTrigger = question.custom === true ? options.find(isCustomTriggerOption) : undefined;
          const optionIds = new Set(selectableOptions.map((option) => option.id));
          const storedCustomValue = customTextValues[index] ?? '';
          const optionAnswerValues =
            customActiveIndexes.has(index) && question.multiple === true && storedCustomValue.length > 0 ? optionValues.slice(0, -1) : optionValues;
          const selectedOptionValues =
            question.multiple === true
              ? optionAnswerValues.filter((value) => optionIds.has(value))
              : !customActiveIndexes.has(index) && optionValues[0] !== undefined && optionIds.has(optionValues[0])
                ? [optionValues[0]]
                : [];
          const customValue = customActiveIndexes.has(index)
            ? storedCustomValue
            : question.multiple !== true
              ? optionValues[0] !== undefined && !optionIds.has(optionValues[0])
                ? optionValues[0]
                : ''
              : (optionValues.find((value) => !optionIds.has(value)) ?? '');
          const customActive = customActiveIndexes.has(index) || customValue.trim().length > 0;
          const customLabel = customTrigger?.label ?? t('respondInput.customAnswer');
          const promptRenderedInHeader = !hasMultipleQuestions && index === 0 && question.prompt === headerPrompt;
          const showQuestionPrompt = !promptRenderedInHeader && (questions.length > 1 || question.prompt !== activeInput.prompt);
          const questionPrompt = question.prompt;

          const setCustomValue = (nextValue: string) => {
            const bounded = nextValue.slice(0, CUSTOM_ANSWER_MAX_LENGTH);
            setCustomTextValues((current) => questions.map((_, currentIndex) => (currentIndex === index ? bounded : (current[currentIndex] ?? ''))));
            if (question.multiple === true) {
              setQuestionAnswer(index, [...selectedOptionValues, ...(bounded.length > 0 ? [bounded] : [])]);
              return;
            }
            setQuestionAnswer(index, bounded.length > 0 ? [bounded] : []);
          };

          const activateCustom = () => {
            if (disabled || isSubmitting) {
              return;
            }
            if (customActiveIndexes.has(index)) {
              setQuestionCustomActive(index, false);
              setCustomTextValues((current) => questions.map((_, currentIndex) => (currentIndex === index ? '' : (current[currentIndex] ?? ''))));
              setQuestionAnswer(index, question.multiple === true ? [...selectedOptionValues] : []);
              return;
            }
            setQuestionCustomActive(index, true);
            if (question.multiple !== true) {
              setQuestionAnswer(index, customValue.length > 0 ? [customValue] : []);
            }
          };

          const setOptionSelected = (optionId: string, selected: boolean) => {
            if (disabled || isSubmitting) {
              return;
            }
            if (question.multiple === true) {
              const nextSelectedOptions = selected
                ? Array.from(new Set([...selectedOptionValues, optionId]))
                : selectedOptionValues.filter((value) => value !== optionId);
              setQuestionAnswer(index, [...nextSelectedOptions, ...(customActive && customValue.length > 0 ? [customValue] : [])]);
              return;
            }
            setQuestionCustomActive(index, false);
            setCustomTextValues((current) => questions.map((_, currentIndex) => (currentIndex === index ? '' : (current[currentIndex] ?? ''))));
            const selectedOption = selectableOptions.find((option) => option.id === optionId);
            setQuestionAnswer(index, selectedOption?.requiresTextInput === true ? [optionId, ''] : [optionId]);
          };

          return (
            <div
              key={`${index}:${question.prompt}`}
              ref={currentQuestionRef}
              tabIndex={hasMultipleQuestions ? -1 : undefined}
              data-testid={`respond-question-${index}`}
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: 8,
              }}
            >
              {showQuestionPrompt && (
                <Typography.Text style={{ fontSize: 15, fontWeight: 600, color: 'var(--color-text-primary)', lineHeight: '22px' }}>
                  {questionPrompt}
                </Typography.Text>
              )}

              {options.length > 0 ? (
                <div
                  className="nextagent-themed-scrollbar"
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 6,
                    maxHeight: 'min(280px, 35vh)',
                    overflowY: 'auto',
                    scrollbarGutter: 'stable',
                  }}
                >
                  {selectableOptions.map((option) => {
                    const selected = selectedOptionValues.includes(option.id);
                    const attachedTextValue = selected && option.requiresTextInput === true ? (optionValues[1] ?? '') : '';
                    return (
                      <Tooltip key={option.id} title={option.label} rootClassName="app-common-tooltip">
                        <div
                          role={question.multiple === true ? 'checkbox' : 'radio'}
                          aria-checked={selected}
                          tabIndex={disabled || isSubmitting ? -1 : 0}
                          data-testid={`respond-question-${index}-option-${option.id}`}
                          onClick={() => setOptionSelected(option.id, !selected)}
                          onKeyDown={(event) => {
                            if (event.key === 'Enter' || event.key === ' ') {
                              event.preventDefault();
                              setOptionSelected(option.id, !selected);
                            }
                          }}
                          style={optionRowStyle(selected, disabled || isSubmitting, {
                            minHeight: selected && option.requiresTextInput === true ? 72 : 36,
                          })}
                        >
                          {question.multiple === true ? (
                            <Checkbox checked={selected} style={{ pointerEvents: 'none', flexShrink: 0 }} />
                          ) : (
                            <Radio checked={selected} style={{ pointerEvents: 'none', flexShrink: 0 }} />
                          )}
                          {selected && option.requiresTextInput === true ? (
                            <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
                              <span style={optionLabelStyle()}>{option.label}</span>
                              <textarea
                                data-testid={`respond-question-${index}-option-${option.id}-textarea`}
                                value={attachedTextValue}
                                placeholder={option.inputPlaceholder ?? t('respondInput.placeholder')}
                                maxLength={CUSTOM_ANSWER_MAX_LENGTH}
                                disabled={disabled || isSubmitting}
                                rows={1}
                                autoFocus
                                onClick={(event) => event.stopPropagation()}
                                onChange={(event) => {
                                  const bounded = event.target.value.slice(0, CUSTOM_ANSWER_MAX_LENGTH);
                                  setQuestionAnswer(index, [option.id, bounded]);
                                  resizeCustomTextarea(event.currentTarget);
                                }}
                                onInput={(event) => resizeCustomTextarea(event.currentTarget)}
                                onKeyDown={(event) => {
                                  event.stopPropagation();
                                  handleTextareaKeyDown(event);
                                }}
                                style={{
                                  width: '100%',
                                  minHeight: 34,
                                  maxHeight: CUSTOM_TEXTAREA_MAX_HEIGHT,
                                  resize: 'none',
                                  overflowY: 'auto',
                                  border: '1px solid var(--color-border)',
                                  borderRadius: 6,
                                  padding: '6px 8px',
                                  fontSize: 14,
                                  lineHeight: `${CUSTOM_TEXTAREA_LINE_HEIGHT}px`,
                                  outline: 'none',
                                  fontFamily: 'inherit',
                                  background: 'var(--color-bg-primary)',
                                  color: 'var(--color-text-primary)',
                                  boxSizing: 'border-box',
                                }}
                              />
                            </div>
                          ) : (
                            <span style={optionLabelStyle()}>{option.label}</span>
                          )}
                        </div>
                      </Tooltip>
                    );
                  })}
                  <div
                    role={question.multiple === true ? 'checkbox' : 'radio'}
                    aria-checked={customActive}
                    tabIndex={disabled || isSubmitting ? -1 : 0}
                    data-testid={`respond-question-${index}-custom`}
                    onClick={activateCustom}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault();
                        activateCustom();
                      }
                    }}
                    style={optionRowStyle(customActive, disabled || isSubmitting, {
                      minHeight: customActive ? 72 : 36,
                    })}
                  >
                    {question.multiple === true ? (
                      <Checkbox checked={customActive} style={{ pointerEvents: 'none', flexShrink: 0 }} />
                    ) : (
                      <Radio checked={customActive} style={{ pointerEvents: 'none', flexShrink: 0 }} />
                    )}
                    {customActive ? (
                      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
                        <textarea
                          data-testid={`respond-question-${index}-custom-textarea`}
                          value={customValue}
                          placeholder={t('respondInput.placeholder')}
                          maxLength={CUSTOM_ANSWER_MAX_LENGTH}
                          disabled={disabled || isSubmitting}
                          rows={1}
                          onClick={(event) => event.stopPropagation()}
                          onChange={(event) => {
                            setCustomValue(event.target.value);
                            resizeCustomTextarea(event.currentTarget);
                          }}
                          onInput={(event) => resizeCustomTextarea(event.currentTarget)}
                          onKeyDown={(event) => {
                            event.stopPropagation();
                            handleTextareaKeyDown(event);
                          }}
                          style={{
                            width: '100%',
                            minHeight: 34,
                            maxHeight: CUSTOM_TEXTAREA_MAX_HEIGHT,
                            resize: 'none',
                            overflowY: 'auto',
                            border: '1px solid var(--color-border)',
                            borderRadius: 6,
                            padding: '6px 8px',
                            fontSize: 14,
                            lineHeight: `${CUSTOM_TEXTAREA_LINE_HEIGHT}px`,
                            outline: 'none',
                            fontFamily: 'inherit',
                            background: 'var(--color-bg-primary)',
                            color: 'var(--color-text-primary)',
                            boxSizing: 'border-box',
                          }}
                        />
                        <span
                          data-testid={`respond-question-${index}-custom-count`}
                          style={{ alignSelf: 'flex-end', fontSize: 11, lineHeight: '14px', color: 'var(--color-text-tertiary)' }}
                        >
                          {customValue.length}/{CUSTOM_ANSWER_MAX_LENGTH}
                        </span>
                      </div>
                    ) : (
                      <span style={optionLabelStyle()}>{customLabel}</span>
                    )}
                  </div>
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                  <textarea
                    data-testid={`respond-question-${index}-textarea`}
                    value={optionValues[0] ?? ''}
                    placeholder={t('respondInput.placeholder')}
                    maxLength={FREE_TEXT_ANSWER_MAX_LENGTH}
                    disabled={disabled || isSubmitting}
                    onChange={(e) => setQuestionAnswer(index, [e.target.value.slice(0, FREE_TEXT_ANSWER_MAX_LENGTH)])}
                    onKeyDown={handleTextareaKeyDown}
                    rows={2}
                    style={{
                      width: '100%',
                      resize: 'none',
                      border: '1px solid var(--color-border)',
                      borderRadius: 12,
                      padding: '8px 12px',
                      fontSize: 14,
                      lineHeight: 1.5,
                      outline: 'none',
                      fontFamily: 'inherit',
                      background: 'var(--color-bg-primary)',
                      color: 'var(--color-text-primary)',
                      boxSizing: 'border-box',
                    }}
                  />
                  <span
                    data-testid={`respond-question-${index}-textarea-count`}
                    style={{ alignSelf: 'flex-end', fontSize: 11, lineHeight: '14px', color: 'var(--color-text-tertiary)' }}
                  >
                    {(optionValues[0] ?? '').length}/{FREE_TEXT_ANSWER_MAX_LENGTH}
                  </span>
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div style={panelActionsStyle()}>
        {onCancel && (
          <Button
            data-testid="btn-cancel-response"
            size="small"
            autoInsertSpace={false}
            disabled={disabled || isSubmitting}
            onClick={() => {
              if (!isSubmitting) {
                void onCancel();
              }
            }}
            style={panelActionButtonStyle()}
          >
            {t('respondInput.cancel')}
          </Button>
        )}
        {hasMultipleQuestions && (
          <Button
            size="small"
            data-testid="btn-previous-question"
            autoInsertSpace={false}
            disabled={disabled || isSubmitting || currentQuestionIndex === 0}
            onClick={() => setCurrentQuestionIndex((index) => Math.max(0, index - 1))}
            style={panelActionButtonStyle()}
          >
            {t('respondInput.previousQuestion')}
          </Button>
        )}
        {hasMultipleQuestions && !isLastQuestion ? (
          <Button
            type="primary"
            size="small"
            data-testid="btn-next-question"
            autoInsertSpace={false}
            disabled={disabled || isSubmitting || !currentQuestionReady}
            onClick={() => setCurrentQuestionIndex((index) => Math.min(index + 1, questions.length - 1))}
            style={panelActionButtonStyle()}
          >
            {t('respondInput.nextQuestion')}
          </Button>
        ) : (
          <Button
            type="primary"
            size="small"
            data-testid="btn-submit-response"
            autoInsertSpace={false}
            {...(isSubmitting ? { loading: true } : {})}
            disabled={disabled || !ready || isSubmitting}
            onClick={handleSubmit}
            style={panelActionButtonStyle()}
          >
            {t('respondInput.submit')}
          </Button>
        )}
      </div>

      {submitError && (
        <Alert
          data-testid="respond-submit-error"
          type="error"
          showIcon={false}
          message={submitError}
          style={{ borderRadius: 10, padding: '6px 10px' }}
        />
      )}
    </div>
  );
}

function HumanHandoffInput({
  activeInput,
  disabled,
  onSubmit,
  onCancel,
}: {
  readonly activeInput: ActiveUserInput;
  readonly disabled: boolean;
  readonly onSubmit: RespondSubmit;
  readonly onCancel?: RespondCancel;
}) {
  const { t } = useTranslation();
  const questions = activeInput.questions ?? [];
  const modeQuestion = questions[0];
  const contentQuestion = questions[1];
  const modeOptions = modeQuestion?.options ?? [
    { id: 'final_answer', label: t('respondInput.finalAnswer') },
    { id: 'resume_instruction', label: t('respondInput.resumeInstruction') },
  ];
  const [mode, setMode] = useState<string | null>(null);
  const [content, setContent] = useState('');
  const submitStatus = useUserInputStore((s) => s.submitStatus);
  const submitError = useUserInputStore((s) => s.submitError);
  const isSubmitting = submitStatus === 'submitting';
  const ready = mode !== null && content.trim().length > 0;

  useEffect(() => {
    setMode(null);
    setContent('');
  }, [activeInput.inputRequestId]);

  const handleSubmit = useCallback(() => {
    const trimmed = content.trim();
    if (!mode || !trimmed || isSubmitting) {
      return;
    }
    void onSubmit([[mode], [trimmed]]);
  }, [content, isSubmitting, mode, onSubmit]);

  const handleTextareaKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        handleSubmit();
      }
    },
    [handleSubmit],
  );

  return (
    <div
      data-testid="respond-input-human-handoff"
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 12,
      }}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <Typography.Text style={{ fontSize: 15, fontWeight: 600, color: 'var(--color-text-primary)', lineHeight: '22px' }}>
          {modeQuestion?.prompt ?? t('respondInput.humanHandoffModePrompt')}
        </Typography.Text>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 8 }}>
          {modeOptions.map((option) => {
            const selected = mode === option.id;
            return (
              <div
                key={option.id}
                role="radio"
                aria-checked={selected}
                tabIndex={disabled || isSubmitting ? -1 : 0}
                data-testid={`respond-handoff-mode-${option.id}`}
                onClick={() => {
                  if (!disabled && !isSubmitting) {
                    setMode(option.id);
                  }
                }}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    if (!disabled && !isSubmitting) {
                      setMode(option.id);
                    }
                  }
                }}
                style={optionRowStyle(selected, disabled || isSubmitting)}
              >
                <Radio checked={selected} style={{ pointerEvents: 'none', flexShrink: 0 }} />
                <span style={optionLabelStyle()}>{option.label}</span>
              </div>
            );
          })}
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <Typography.Text style={{ fontSize: 15, fontWeight: 600, color: 'var(--color-text-primary)', lineHeight: '22px' }}>
          {contentQuestion?.prompt ?? t('respondInput.humanHandoffContentPrompt')}
        </Typography.Text>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <textarea
            data-testid="respond-handoff-content-textarea"
            value={content}
            placeholder={t('respondInput.handoffContentPlaceholder')}
            maxLength={HUMAN_HANDOFF_CONTENT_MAX_LENGTH}
            disabled={disabled || isSubmitting}
            rows={2}
            onChange={(event) => {
              setContent(event.target.value.slice(0, HUMAN_HANDOFF_CONTENT_MAX_LENGTH));
              resizeCustomTextarea(event.currentTarget);
            }}
            onInput={(event) => resizeCustomTextarea(event.currentTarget)}
            onKeyDown={handleTextareaKeyDown}
            style={{
              width: '100%',
              minHeight: 58,
              maxHeight: CUSTOM_TEXTAREA_MAX_HEIGHT,
              resize: 'none',
              overflowY: 'auto',
              border: '1px solid var(--color-border)',
              borderRadius: 8,
              padding: '8px 12px',
              fontSize: 14,
              lineHeight: `${CUSTOM_TEXTAREA_LINE_HEIGHT}px`,
              outline: 'none',
              fontFamily: 'inherit',
              background: 'var(--color-bg-primary)',
              color: 'var(--color-text-primary)',
              boxSizing: 'border-box',
            }}
          />
          <span
            data-testid="respond-handoff-content-count"
            style={{ alignSelf: 'flex-end', fontSize: 11, lineHeight: '14px', color: 'var(--color-text-tertiary)' }}
          >
            {content.length}/{HUMAN_HANDOFF_CONTENT_MAX_LENGTH}
          </span>
        </div>
      </div>

      <div style={panelActionsStyle()}>
        {onCancel && (
          <Button
            data-testid="btn-cancel-response"
            autoInsertSpace={false}
            disabled={disabled || isSubmitting}
            onClick={() => {
              if (!isSubmitting) {
                void onCancel();
              }
            }}
            style={panelActionButtonStyle()}
          >
            {t('respondInput.cancel')}
          </Button>
        )}
        <Button
          type="primary"
          size="small"
          data-testid="btn-submit-response"
          autoInsertSpace={false}
          {...(isSubmitting ? { loading: true } : {})}
          disabled={disabled || !ready || isSubmitting}
          onClick={handleSubmit}
          style={panelActionButtonStyle()}
        >
          {t('respondInput.submit')}
        </Button>
      </div>

      {submitError && (
        <Alert
          data-testid="respond-submit-error"
          type="error"
          showIcon={false}
          message={submitError}
          style={{ borderRadius: 10, padding: '6px 10px' }}
        />
      )}
    </div>
  );
}

const INPUT_KIND_COMPONENTS: Record<
  UserInputKind,
  React.ComponentType<{
    activeInput: ActiveUserInput;
    disabled: boolean;
    onSubmit: RespondSubmit;
    onCancel?: RespondCancel;
  }>
> = {
  CLARIFICATION: ClarificationInput,
  CONFIRMATION: ConfirmationInput,
  APPROVAL: ApprovalInput,
  SELECTION: SelectionInput,
  QUESTION: QuestionInput,
  AUTHORIZATION: AuthorizationInput,
  HUMAN_HANDOFF: HumanHandoffInput,
};

export const RespondInput = memo(function RespondInput({ activeInput, onSubmit, onCancel, disabled = false }: RespondInputProps) {
  const { t } = useTranslation();
  const [countdown, setCountdown] = useState<string | null>(null);

  useEffect(() => {
    if (!activeInput.expiresAt) {
      setCountdown(null);
      return undefined;
    }

    const timeoutDurationMs = activeInput.timeoutDurationMs;
    const receivedAt = activeInput.receivedAt;
    const update = () => setCountdown(formatCountdown(activeInput.expiresAt!, timeoutDurationMs, receivedAt, t));
    update();
    const timer = setInterval(update, 1000);
    return () => clearInterval(timer);
  }, [activeInput.expiresAt, activeInput.timeoutDurationMs, activeInput.receivedAt, t]);

  const InputComponent = INPUT_KIND_COMPONENTS[activeInput.inputKind] ?? ClarificationInput;
  const isAuthorization = activeInput.inputKind === 'AUTHORIZATION';
  const hasMultipleQuestions = activeInput.inputKind === 'QUESTION' && (activeInput.questions?.length ?? 0) > 1;
  const title =
    activeInput.inputKind === 'HUMAN_HANDOFF'
      ? t('respondInput.humanHandoffTitle')
      : hasMultipleQuestions
        ? t('respondInput.multipleQuestionsTitle')
        : activeInput.prompt || activeInput.questions?.[0]?.prompt || '';

  return (
    <div
      data-testid="respond-input"
      style={{
        width: '100%',
        maxWidth: '100%',
        margin: '0 auto',
        position: 'relative',
      }}
    >
      <div
        data-testid="respond-input-panel"
        style={{
          borderRadius: 16,
          boxShadow: 'var(--shadow-sm)',
          border: isAuthorization ? '2px solid var(--color-primary)' : '1px solid var(--color-bg-tertiary)',
          background: 'var(--color-bg-primary)',
          padding: '12px 12px 8px',
          display: 'flex',
          flexDirection: 'column',
          gap: 14,
          minWidth: 0,
          overflow: 'hidden',
        }}
      >
        <div
          data-testid="respond-input-header"
          style={{
            display: 'grid',
            gridTemplateColumns: isAuthorization ? 'minmax(0, 1fr) auto auto' : 'minmax(0, 1fr) auto',
            alignItems: 'start',
            columnGap: 10,
            rowGap: 4,
            minWidth: 0,
            minHeight: 24,
          }}
        >
          <span
            data-testid="respond-input-title"
            style={{
              minWidth: 0,
              overflow: 'visible',
              overflowWrap: 'anywhere',
              whiteSpace: 'normal',
              fontSize: 15,
              lineHeight: '22px',
              fontWeight: 700,
              color: 'var(--color-text-primary)',
            }}
          >
            {title}
          </span>
          {isAuthorization && (
            <span
              data-testid="respond-authorization-label"
              style={{
                flexShrink: 0,
                borderRadius: 999,
                border: '1px solid #91caff',
                background: '#eaf3ff',
                color: '#0958d9',
                fontSize: 12,
                lineHeight: '18px',
                padding: '3px 10px',
              }}
            >
              {t('respondInput.authorizationRequest')}
            </span>
          )}
          {countdown && (
            <span
              data-testid="respond-countdown"
              style={{
                fontSize: 12,
                lineHeight: '18px',
                color: 'var(--color-text-tertiary)',
                whiteSpace: 'nowrap',
              }}
            >
              {t('respondInput.remainingTime', { countdown })}
            </span>
          )}
        </div>

        <InputComponent activeInput={activeInput} disabled={disabled} onSubmit={onSubmit} {...(onCancel === undefined ? {} : { onCancel })} />
      </div>
    </div>
  );
});
