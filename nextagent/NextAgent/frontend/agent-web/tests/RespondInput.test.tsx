// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { RespondInput } from '../src/features/composer/components/RespondInput.tsx';
import { useUserInputStore, type ActiveUserInput } from '../src/state/userInputStore.ts';

function makeInput(overrides: Partial<ActiveUserInput> = {}): ActiveUserInput {
  return {
    inputRequestId: 'input-1',
    inputKind: 'CLARIFICATION',
    prompt: '请补充诊断范围',
    requestId: 'req-1',
    origin: null,
    originId: null,
    riskLevel: null,
    expiresAt: null,
    timeoutDurationMs: null,
    receivedAt: null,
    ...overrides,
  };
}

describe('RespondInput', () => {
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.restoreAllMocks();
    useUserInputStore.getState().clear();
  });

  it('submits question text with Enter', () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);

    render(<RespondInput activeInput={makeInput()} onSubmit={onSubmit} />);

    const textarea = screen.getByTestId('respond-textarea');
    fireEvent.change(textarea, { target: { value: '只检查核心防火墙' } });
    fireEvent.keyDown(textarea, { key: 'Enter' });

    expect(onSubmit).toHaveBeenCalledWith([['只检查核心防火墙']]);
  });

  it('keeps pending prompt readable beside a stable countdown', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date', 'performance'] });
    vi.setSystemTime(new Date('2026-04-19T10:00:00.000Z'));
    const longPrompt = '工作区中没有找到 Cell-A-001 的相关数据。请提供该小区的相关运行数据，如 KPI、告警、日志、配置快照或数据来源。';

    render(
      <RespondInput
        activeInput={makeInput({
          prompt: longPrompt,
          expiresAt: Date.parse('2026-04-19T10:30:00.000Z'),
          timeoutDurationMs: 30 * 60 * 1000,
          receivedAt: performance.now(),
        })}
        onSubmit={vi.fn()}
      />,
    );

    const header = screen.getByTestId('respond-input-header');
    const title = screen.getByTestId('respond-input-title');
    const countdown = screen.getByTestId('respond-countdown');

    expect(header.style.display).toBe('grid');
    expect(title.textContent).toBe(longPrompt);
    expect(title.style.whiteSpace).toBe('normal');
    expect(title.style.textOverflow).toBe('');
    expect(countdown.textContent).toContain('剩余时间');
    expect(countdown.style.whiteSpace).toBe('nowrap');
  });

  it('shows projected expiry without submitting or canceling', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date', 'performance'] });
    vi.setSystemTime(new Date('2026-04-19T10:00:00.000Z'));
    const onSubmit = vi.fn();
    const onCancel = vi.fn();

    render(
      <RespondInput
        activeInput={makeInput({
          expiresAt: Date.parse('2026-04-19T10:00:01.000Z'),
          timeoutDurationMs: 1000,
          receivedAt: performance.now(),
        })}
        onSubmit={onSubmit}
        onCancel={onCancel}
      />,
    );

    expect(screen.getByTestId('respond-countdown').textContent).toContain('剩余时间');

    act(() => {
      vi.advanceTimersByTime(1_000);
    });

    expect(screen.getByTestId('respond-countdown').textContent).toContain('已过期');
    expect(screen.getByTestId('respond-input')).toBeTruthy();
    expect(onSubmit).not.toHaveBeenCalled();
    expect(onCancel).not.toHaveBeenCalled();
  });

  it('renders confirmation options and submits the selected action', () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);

    render(
      <RespondInput
        activeInput={makeInput({
          inputKind: 'CONFIRMATION',
          prompt: '是否继续执行诊断？',
          options: [
            { id: 'continue', label: '继续' },
            { id: 'stop', label: '停止' },
          ],
        })}
        onSubmit={onSubmit}
      />,
    );

    const buttons = screen.getAllByTestId(/^respond-option-/);
    expect(buttons.map((button) => button.getAttribute('data-testid'))).toEqual(['respond-option-stop', 'respond-option-continue']);

    fireEvent.click(screen.getByTestId('respond-option-continue'));

    expect(onSubmit).toHaveBeenCalledWith([['continue']]);
  });

  it('renders authorization as a bounded authorization request and submits authorization decisions', () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);

    render(
      <RespondInput
        activeInput={makeInput({
          inputKind: 'AUTHORIZATION',
          prompt: '是否批准删除生产环境防火墙规则？',
          riskLevel: 'CRITICAL',
        })}
        onSubmit={onSubmit}
      />,
    );

    expect(screen.queryByTestId('respond-risk-level')).toBeNull();
    expect(screen.getByTestId('respond-authorization-label')).toBeTruthy();
    expect(screen.getByTestId('respond-input-authorization')).toBeTruthy();

    fireEvent.click(screen.getByTestId('respond-option-approve'));

    expect(onSubmit).toHaveBeenCalledWith([['approve']]);
  });

  it('requires a selection before submitting question options', () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);

    render(
      <RespondInput
        activeInput={makeInput({
          inputKind: 'SELECTION',
          prompt: '请选择诊断路径',
          options: [
            { id: 'blue', label: '蓝色路径' },
            { id: 'green', label: '绿色路径' },
          ],
        })}
        onSubmit={onSubmit}
      />,
    );

    const submit = screen.getByTestId('btn-submit-response') as HTMLButtonElement;
    expect(submit.disabled).toBe(true);

    fireEvent.click(screen.getByText('蓝色路径'));
    expect(submit.disabled).toBe(false);

    fireEvent.click(submit);

    expect(onSubmit).toHaveBeenCalledWith([['blue']]);
  });

  it('keeps type-anything available when a question declares custom false', () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(
      <RespondInput
        activeInput={makeInput({
          inputKind: 'QUESTION',
          prompt: 'Choose an interaction type',
          questions: [
            {
              prompt: 'Choose an interaction type',
              custom: false,
              options: [
                { id: 'confirmation', label: 'Confirmation' },
                { id: 'manual_input', label: 'Manual input' },
              ],
            },
          ],
        })}
        onSubmit={onSubmit}
      />,
    );

    expect(screen.getByTestId('respond-question-0-option-confirmation')).toBeTruthy();
    expect(screen.getByTestId('respond-question-0-option-manual_input')).toBeTruthy();
    fireEvent.click(screen.getByTestId('respond-question-0-custom'));
    fireEvent.change(screen.getByTestId('respond-question-0-custom-textarea'), { target: { value: 'Use another interaction' } });
    fireEvent.click(screen.getByTestId('btn-submit-response'));

    expect(onSubmit).toHaveBeenCalledWith([['Use another interaction']], ['CUSTOM_TEXT']);
  });

  it('renders NextAgent QUESTION inputs as clarification prompts', () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);

    render(
      <RespondInput
        activeInput={makeInput({
          inputKind: 'QUESTION',
          prompt: 'Which route should be checked?',
        })}
        onSubmit={onSubmit}
      />,
    );

    const textarea = screen.getByTestId('respond-question-0-textarea');
    fireEvent.change(textarea, { target: { value: 'route-a' } });
    fireEvent.keyDown(textarea, { key: 'Enter' });

    expect(onSubmit).toHaveBeenCalledWith([['route-a']], ['TEXT']);
  });

  it('renders custom QUESTION options as an in-place bounded textarea', () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    const onCancel = vi.fn();

    render(
      <RespondInput
        activeInput={makeInput({
          inputKind: 'QUESTION',
          prompt: 'Which code should receive unit tests?',
          questions: [
            {
              prompt: 'Which code should receive unit tests?',
              custom: true,
              options: [
                { id: 'service', label: 'Service layer' },
                { id: 'custom', label: 'Enter manually' },
              ],
            },
          ],
        })}
        onSubmit={onSubmit}
        onCancel={onCancel}
      />,
    );

    const submit = screen.getByTestId('btn-submit-response') as HTMLButtonElement;
    expect(submit.disabled).toBe(true);

    fireEvent.click(screen.getByTestId('respond-question-0-custom'));

    const textarea = screen.getByTestId('respond-question-0-custom-textarea') as HTMLTextAreaElement;
    expect(textarea.placeholder).toBe('输入你的回答…');
    expect(textarea.getAttribute('maxLength')).toBe('500');

    fireEvent.change(textarea, { target: { value: `${'x'.repeat(505)}` } });
    expect(textarea.value).toHaveLength(500);
    expect(screen.getByTestId('respond-question-0-custom-count').textContent).toBe('500/500');

    fireEvent.change(textarea, { target: { value: 'Site C\nSector 3' } });
    expect(submit.disabled).toBe(false);

    fireEvent.click(submit);
    expect(onSubmit).toHaveBeenCalledWith([['Site C\nSector 3']], ['CUSTOM_TEXT']);

    fireEvent.click(screen.getByTestId('btn-cancel-response'));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('preserves custom input origin when its text equals an option value', () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(
      <RespondInput
        activeInput={makeInput({
          inputKind: 'QUESTION',
          prompt: 'Choose an action',
          questions: [
            {
              prompt: 'Choose an action',
              options: [
                { id: 'keep_current', label: 'Keep current' },
                { id: 'change_ne', label: 'Change network element' },
              ],
            },
          ],
        })}
        onSubmit={onSubmit}
      />,
    );

    fireEvent.click(screen.getByTestId('respond-question-0-custom'));
    fireEvent.change(screen.getByTestId('respond-question-0-custom-textarea'), { target: { value: 'change_ne' } });
    fireEvent.click(screen.getByTestId('btn-submit-response'));

    expect(onSubmit).toHaveBeenCalledWith([['change_ne']], ['CUSTOM_TEXT']);
  });

  it('preserves selected options and custom text as one mixed answer', () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(
      <RespondInput
        activeInput={makeInput({
          inputKind: 'QUESTION',
          prompt: 'Select alarm levels',
          questions: [
            {
              prompt: 'Select alarm levels',
              multiple: true,
              options: [
                { id: 'critical', label: 'Critical' },
                { id: 'fatal', label: 'Fatal' },
              ],
            },
          ],
        })}
        onSubmit={onSubmit}
      />,
    );

    fireEvent.click(screen.getByTestId('respond-question-0-option-critical'));
    fireEvent.click(screen.getByTestId('respond-question-0-option-fatal'));
    fireEvent.click(screen.getByTestId('respond-question-0-custom'));
    fireEvent.change(screen.getByTestId('respond-question-0-custom-textarea'), { target: { value: 'Include unacknowledged alarms only' } });
    fireEvent.click(screen.getByTestId('btn-submit-response'));

    expect(onSubmit).toHaveBeenCalledWith([['critical', 'fatal', 'Include unacknowledged alarms only']], ['OPTION_SELECTIONS_WITH_CUSTOM_TEXT']);
  });

  it('allows toggling off the custom answer in multi-select without losing selected options', () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(
      <RespondInput
        activeInput={makeInput({
          inputKind: 'QUESTION',
          prompt: 'Select alarm levels',
          questions: [
            {
              prompt: 'Select alarm levels',
              multiple: true,
              options: [
                { id: 'critical', label: 'Critical' },
                { id: 'fatal', label: 'Fatal' },
              ],
            },
          ],
        })}
        onSubmit={onSubmit}
      />,
    );

    fireEvent.click(screen.getByTestId('respond-question-0-option-critical'));
    fireEvent.click(screen.getByTestId('respond-question-0-custom'));
    fireEvent.change(screen.getByTestId('respond-question-0-custom-textarea'), { target: { value: 'extra note' } });

    // Toggle off the custom option — selected options must be preserved.
    fireEvent.click(screen.getByTestId('respond-question-0-custom'));
    expect(screen.queryByTestId('respond-question-0-custom-textarea')).toBeNull();
    fireEvent.click(screen.getByTestId('btn-submit-response'));

    expect(onSubmit).toHaveBeenCalledWith([['critical']], ['OPTION_SELECTION']);
  });

  it('preserves custom textarea content when typing spaces in multi-select mode', () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(
      <RespondInput
        activeInput={makeInput({
          inputKind: 'QUESTION',
          prompt: 'Select alarm levels',
          questions: [
            {
              prompt: 'Select alarm levels',
              multiple: true,
              options: [{ id: 'critical', label: 'Critical' }],
            },
          ],
        })}
        onSubmit={onSubmit}
      />,
    );

    fireEvent.click(screen.getByTestId('respond-question-0-custom'));
    const textarea = screen.getByTestId('respond-question-0-custom-textarea') as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: 'unacknowledged alarms' } });

    // The textarea must still be visible and contain the text with spaces.
    expect(screen.getByTestId('respond-question-0-custom-textarea')).toBeTruthy();
    expect(textarea.value).toBe('unacknowledged alarms');
  });

  it('supports multiple distinct options that each expand their own required text input', () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);

    render(
      <RespondInput
        activeInput={makeInput({
          inputKind: 'QUESTION',
          prompt: 'What should receive unit tests?',
          questions: [
            {
              prompt: 'What should receive unit tests?',
              options: [
                { id: 'new_project', label: 'New example project' },
                {
                  id: 'existing_project',
                  label: 'Existing project',
                  requiresTextInput: true,
                  inputPlaceholder: 'Enter the project path',
                },
                {
                  id: 'single_file',
                  label: 'Single file',
                  requiresTextInput: true,
                  inputPlaceholder: 'Enter the file path',
                },
              ],
            },
          ],
        })}
        onSubmit={onSubmit}
      />,
    );

    const submit = screen.getByTestId('btn-submit-response') as HTMLButtonElement;
    fireEvent.click(screen.getByTestId('respond-question-0-option-existing_project'));
    const projectInput = screen.getByTestId('respond-question-0-option-existing_project-textarea') as HTMLTextAreaElement;
    expect(projectInput.placeholder).toBe('Enter the project path');
    expect(submit.disabled).toBe(true);
    fireEvent.change(projectInput, { target: { value: 'single_file' } });
    expect(submit.disabled).toBe(false);
    expect(screen.getByTestId('respond-question-0-option-single_file').getAttribute('aria-checked')).toBe('false');

    fireEvent.click(screen.getByTestId('respond-question-0-option-new_project'));
    expect(screen.queryByTestId('respond-question-0-option-existing_project-textarea')).toBeNull();
    expect(submit.disabled).toBe(false);

    fireEvent.click(screen.getByTestId('respond-question-0-option-single_file'));
    const fileInput = screen.getByTestId('respond-question-0-option-single_file-textarea') as HTMLTextAreaElement;
    expect(fileInput.value).toBe('');
    expect(fileInput.placeholder).toBe('Enter the file path');
    expect(fileInput.getAttribute('maxLength')).toBe('500');
    expect(submit.disabled).toBe(true);

    fireEvent.change(fileInput, { target: { value: 'src/example.ts' } });
    fireEvent.click(submit);
    expect(onSubmit).toHaveBeenCalledWith([['single_file', 'src/example.ts']], ['OPTION_ATTACHED_TEXT']);
  });

  it('pages through four questions, preserves drafts, and submits once from the final question', () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(<RespondInput activeInput={makeQuestionInput(4)} onSubmit={onSubmit} />);

    expect(screen.getByTestId('respond-question-progress').textContent).toContain('1 / 4');
    expect(screen.getByTestId('respond-question-0')).toBeTruthy();
    expect(screen.queryByTestId('respond-question-1')).toBeNull();
    expect(screen.queryByTestId('btn-submit-response')).toBeNull();
    const firstNext = screen.getByTestId('btn-next-question') as HTMLButtonElement;
    expect(firstNext.disabled).toBe(true);

    fireEvent.change(screen.getByTestId('respond-question-0-textarea'), { target: { value: 'answer-1' } });
    expect(firstNext.disabled).toBe(false);
    fireEvent.click(firstNext);

    expect(screen.getByTestId('respond-question-progress').textContent).toContain('2 / 4');
    expect(document.activeElement).toBe(screen.getByTestId('respond-question-1'));
    fireEvent.change(screen.getByTestId('respond-question-1-textarea'), { target: { value: 'answer-2' } });
    fireEvent.keyDown(screen.getByTestId('respond-question-1-textarea'), { key: 'Enter' });

    fireEvent.change(screen.getByTestId('respond-question-2-textarea'), { target: { value: 'answer-3' } });
    fireEvent.click(screen.getByTestId('btn-next-question'));
    fireEvent.change(screen.getByTestId('respond-question-3-textarea'), { target: { value: 'answer-4' } });

    expect(screen.getByTestId('respond-question-progress').textContent).toContain('4 / 4');
    expect(onSubmit).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId('btn-previous-question'));
    expect((screen.getByTestId('respond-question-2-textarea') as HTMLTextAreaElement).value).toBe('answer-3');
    fireEvent.click(screen.getByTestId('btn-next-question'));
    expect((screen.getByTestId('respond-question-3-textarea') as HTMLTextAreaElement).value).toBe('answer-4');

    fireEvent.click(screen.getByTestId('btn-submit-response'));
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit).toHaveBeenCalledWith([['answer-1'], ['answer-2'], ['answer-3'], ['answer-4']], ['TEXT', 'TEXT', 'TEXT', 'TEXT']);
  });

  it('renders and submits 20 accepted questions without mounting every question at once', () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(<RespondInput activeInput={makeQuestionInput(20)} onSubmit={onSubmit} />);

    for (let index = 0; index < 20; index += 1) {
      expect(screen.getAllByTestId(/^respond-question-\d+$/)).toHaveLength(1);
      expect(screen.getByTestId('respond-question-progress').textContent).toContain(`${index + 1} / 20`);
      fireEvent.change(screen.getByTestId(`respond-question-${index}-textarea`), {
        target: { value: `answer-${index + 1}` },
      });
      if (index < 19) {
        fireEvent.click(screen.getByTestId('btn-next-question'));
      }
    }

    fireEvent.click(screen.getByTestId('btn-submit-response'));
    expect(onSubmit).toHaveBeenCalledWith(
      Array.from({ length: 20 }, (_, index) => [`answer-${index + 1}`]),
      Array.from({ length: 20 }, () => 'TEXT'),
    );
  });

  it('resets the current page and drafts when the pending input id changes', () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    const view = render(<RespondInput activeInput={makeQuestionInput(4)} onSubmit={onSubmit} />);

    fireEvent.change(screen.getByTestId('respond-question-0-textarea'), { target: { value: 'draft' } });
    fireEvent.click(screen.getByTestId('btn-next-question'));
    expect(screen.getByTestId('respond-question-progress').textContent).toContain('2 / 4');

    view.rerender(<RespondInput activeInput={makeQuestionInput(4, { inputRequestId: 'input-2' })} onSubmit={onSubmit} />);

    expect(screen.getByTestId('respond-question-progress').textContent).toContain('1 / 4');
    expect((screen.getByTestId('respond-question-0-textarea') as HTMLTextAreaElement).value).toBe('');
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('keeps the final page and all drafts when submission reports an error', async () => {
    const onSubmit = vi.fn(async () => {
      useUserInputStore.getState().setSubmitStatus('error', 'Submit failed');
    });
    render(<RespondInput activeInput={makeQuestionInput(2)} onSubmit={onSubmit} />);

    fireEvent.change(screen.getByTestId('respond-question-0-textarea'), { target: { value: 'answer-1' } });
    fireEvent.click(screen.getByTestId('btn-next-question'));
    fireEvent.change(screen.getByTestId('respond-question-1-textarea'), { target: { value: 'answer-2' } });
    await act(async () => {
      fireEvent.click(screen.getByTestId('btn-submit-response'));
    });

    expect(screen.getByTestId('respond-question-progress').textContent).toContain('2 / 2');
    expect((screen.getByTestId('respond-question-1-textarea') as HTMLTextAreaElement).value).toBe('answer-2');
    expect(screen.getByTestId('respond-submit-error').textContent).toContain('Submit failed');
    fireEvent.click(screen.getByTestId('btn-previous-question'));
    expect((screen.getByTestId('respond-question-0-textarea') as HTMLTextAreaElement).value).toBe('answer-1');
  });

  it('renders NextAgent AUTHORIZATION inputs as approval prompts', () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);

    render(
      <RespondInput
        activeInput={makeInput({
          inputKind: 'AUTHORIZATION',
          prompt: 'Allow sandbox execution?',
          riskLevel: 'HIGH',
        })}
        onSubmit={onSubmit}
      />,
    );

    const buttons = screen.getAllByTestId(/^respond-option-/);
    expect(buttons.map((button) => button.getAttribute('data-testid'))).toEqual(['respond-option-deny', 'respond-option-approve']);

    fireEvent.click(screen.getByTestId('respond-option-approve'));

    expect(onSubmit).toHaveBeenCalledWith([['approve']]);
  });

  it('renders HUMAN_HANDOFF as mode plus content answers', () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    const onCancel = vi.fn();

    render(
      <RespondInput
        activeInput={makeInput({
          inputKind: 'HUMAN_HANDOFF',
          prompt: 'Human handoff',
          questions: [
            {
              prompt: 'Choose handoff mode.',
              options: [
                { id: 'final_answer', label: 'Final answer' },
                { id: 'resume_instruction', label: 'Resume instruction' },
              ],
            },
            { prompt: 'Enter handoff content.' },
          ],
        })}
        onSubmit={onSubmit}
        onCancel={onCancel}
      />,
    );

    const submit = screen.getByTestId('btn-submit-response') as HTMLButtonElement;
    expect(submit.disabled).toBe(true);

    fireEvent.click(screen.getByTestId('respond-handoff-mode-resume_instruction'));
    expect(submit.disabled).toBe(true);

    const textarea = screen.getByTestId('respond-handoff-content-textarea') as HTMLTextAreaElement;
    expect(textarea.getAttribute('maxLength')).toBe('500');

    fireEvent.change(textarea, { target: { value: `${'x'.repeat(505)}` } });
    expect(textarea.value).toHaveLength(500);
    expect(screen.getByTestId('respond-handoff-content-count').textContent).toBe('500/500');

    fireEvent.change(textarea, { target: { value: 'Continue with Cell-A-001.' } });
    expect(submit.disabled).toBe(false);

    fireEvent.click(submit);
    expect(onSubmit).toHaveBeenCalledWith([['resume_instruction'], ['Continue with Cell-A-001.']]);

    fireEvent.click(screen.getByTestId('btn-cancel-response'));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('enforces 500-character maxLength on ClarificationInput textarea', () => {
    render(<RespondInput activeInput={makeInput()} onSubmit={vi.fn()} />);

    const textarea = screen.getByTestId('respond-textarea') as HTMLTextAreaElement;
    expect(textarea.getAttribute('maxLength')).toBe('500');

    const longValue = 'x'.repeat(505);
    fireEvent.change(textarea, { target: { value: longValue } });
    expect(textarea.value).toHaveLength(500);

    const count = screen.getByTestId('respond-textarea-count');
    expect(count.textContent).toBe('500/500');
  });

  it('enforces 500-character maxLength on QuestionInput free-text textarea', () => {
    render(<RespondInput activeInput={makeQuestionInput(1)} onSubmit={vi.fn()} />);

    const textarea = screen.getByTestId('respond-question-0-textarea') as HTMLTextAreaElement;
    expect(textarea.getAttribute('maxLength')).toBe('500');

    const longValue = 'x'.repeat(505);
    fireEvent.change(textarea, { target: { value: longValue } });
    expect(textarea.value).toHaveLength(500);

    const count = screen.getByTestId('respond-question-0-textarea-count');
    expect(count.textContent).toBe('500/500');
  });

  it('surfaces submit errors from the user input store', () => {
    useUserInputStore.getState().setSubmitStatus('error', '提交失败，请重试');

    render(<RespondInput activeInput={makeInput({ inputKind: 'AUTHORIZATION' })} onSubmit={vi.fn()} />);

    expect(screen.getByTestId('respond-submit-error').textContent).toContain('提交失败，请重试');
  });
});

function makeQuestionInput(count: number, overrides: Partial<ActiveUserInput> = {}): ActiveUserInput {
  return makeInput({
    inputKind: 'QUESTION',
    prompt: '',
    questions: Array.from({ length: count }, (_, index) => ({
      prompt: `Question ${index + 1}?`,
      options: [],
    })),
    ...overrides,
  });
}

describe('RespondInput clock-skew resilience', () => {
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it('countdown is correct when server clock is 5 minutes ahead of browser', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date', 'performance'] });
    // Browser time
    vi.setSystemTime(new Date('2026-04-19T10:00:00.000Z'));

    // Server createdAt is 10:05:00 (5 min ahead), server expiresAt is 10:35:00
    // timeoutDurationMs = 10:35:00 - 10:05:00 = 30 min (correct, pure server time)
    // receivedAt = Date.now() = 10:00:00 (browser time)
    // remaining = 30*60*1000 - (10:00:00 - 10:00:00) = 30 min (correct!)
    // Old behavior would have been: 10:35:00 - 10:00:00 = 35 min (wrong!)
    const serverCreatedAt = Date.parse('2026-04-19T10:05:00.000Z');
    const serverExpiresAt = Date.parse('2026-04-19T10:35:00.000Z');
    const timeoutDurationMs = serverExpiresAt - serverCreatedAt; // 30 min

    render(
      <RespondInput
        activeInput={makeInput({
          expiresAt: serverExpiresAt,
          timeoutDurationMs,
          receivedAt: performance.now(),
        })}
        onSubmit={vi.fn()}
      />,
    );

    const countdown = screen.getByTestId('respond-countdown');
    // Should show ~30 minutes, NOT 35 minutes
    expect(countdown.textContent).toContain('30');
    expect(countdown.textContent).not.toContain('35');
  });

  it('countdown is correct when server clock is 5 minutes behind browser', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date', 'performance'] });
    // Browser time
    vi.setSystemTime(new Date('2026-04-19T10:00:00.000Z'));

    // Server createdAt is 09:55:00 (5 min behind), server expiresAt is 10:25:00
    // timeoutDurationMs = 10:25:00 - 09:55:00 = 30 min (correct, pure server time)
    // receivedAt = Date.now() = 10:00:00 (browser time)
    // remaining = 30*60*1000 - (10:00:00 - 10:00:00) = 30 min (correct!)
    // Old behavior would have been: 10:25:00 - 10:00:00 = 25 min (wrong!)
    const serverCreatedAt = Date.parse('2026-04-19T09:55:00.000Z');
    const serverExpiresAt = Date.parse('2026-04-19T10:25:00.000Z');
    const timeoutDurationMs = serverExpiresAt - serverCreatedAt; // 30 min

    render(
      <RespondInput
        activeInput={makeInput({
          expiresAt: serverExpiresAt,
          timeoutDurationMs,
          receivedAt: performance.now(),
        })}
        onSubmit={vi.fn()}
      />,
    );

    const countdown = screen.getByTestId('respond-countdown');
    // Should show ~30 minutes, NOT 25 minutes
    expect(countdown.textContent).toContain('30');
    expect(countdown.textContent).not.toContain('25');
  });

  it('falls back to expiresAt when timeoutDurationMs is not available', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date', 'performance'] });
    vi.setSystemTime(new Date('2026-04-19T10:00:00.000Z'));

    render(
      <RespondInput
        activeInput={makeInput({
          expiresAt: Date.parse('2026-04-19T10:30:00.000Z'),
          timeoutDurationMs: null,
          receivedAt: null,
        })}
        onSubmit={vi.fn()}
      />,
    );

    const countdown = screen.getByTestId('respond-countdown');
    // Falls back to old behavior: 10:30:00 - 10:00:00 = 30 min
    expect(countdown.textContent).toContain('30');
  });
});
