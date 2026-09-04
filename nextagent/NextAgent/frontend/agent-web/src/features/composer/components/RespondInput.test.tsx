import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { RespondInput } from './RespondInput.tsx';
import type { ActiveUserInput } from '../../../state/userInputStore.ts';

vi.mock('../../../state/userInputStore.ts', () => ({
  useUserInputStore: (selector: (s: { submitStatus: string; submitError: string | null }) => unknown) =>
    selector({ submitStatus: 'idle', submitError: null }),
}));

const LONG_LABEL =
  '这是一个非常长的选项文本用于验证当askuser单选场景下内容过长时前端是否会溢出容器边界该文本应当被省略号截断并且在鼠标悬停时通过Tooltip展示完整内容';

const baseInput: ActiveUserInput = {
  inputRequestId: 'req-1',
  inputKind: 'SELECTION',
  prompt: '请选择一个选项',
  options: [
    { id: 'short', label: '短选项' },
    { id: 'long', label: LONG_LABEL },
  ],
  requestId: 'request-1',
};

const questionInput: ActiveUserInput = {
  inputRequestId: 'req-2',
  inputKind: 'QUESTION',
  prompt: '请选择一个选项',
  questions: [
    {
      prompt: '请选择一个选项',
      options: [
        { id: 'short', label: '短选项' },
        { id: 'long', label: LONG_LABEL },
      ],
    },
  ],
  requestId: 'request-2',
};

function renderRespondInput(input: ActiveUserInput = baseInput) {
  const onSubmit = vi.fn();
  const result = render(<RespondInput activeInput={input} onSubmit={onSubmit} />);
  return { ...result, onSubmit };
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  cleanup();
});

describe('RespondInput SelectionInput overflow handling', () => {
  it('renders long option labels with ellipsis truncation styles', () => {
    renderRespondInput();

    const longOption = screen.getByTestId('respond-option-long');
    expect(longOption.textContent).toContain('这是一个非常长的选项文本');

    // The label span is the last child element of the option row (after the Radio)
    const labelSpan = longOption.lastElementChild as HTMLElement;
    expect(labelSpan).toBeTruthy();
    expect(labelSpan.tagName).toBe('SPAN');
    // Ellipsis truncation styles
    expect(labelSpan.style.overflow).toBe('hidden');
    expect(labelSpan.style.textOverflow).toBe('ellipsis');
    expect(labelSpan.style.whiteSpace).toBe('nowrap');
    expect(labelSpan.style.minWidth).toBe('0px');
    expect(labelSpan.style.flex).toContain('1');
  });

  it('wraps option rows with full width and minWidth 0', () => {
    renderRespondInput();

    const longOption = screen.getByTestId('respond-option-long') as HTMLElement;
    expect(longOption.style.width).toBe('100%');
    expect(longOption.style.minWidth).toBe('0px');
    expect(longOption.style.boxSizing).toBe('border-box');
  });

  it('allows selecting a long option and submitting', () => {
    const { onSubmit } = renderRespondInput();

    const longOption = screen.getByTestId('respond-option-long');
    fireEvent.click(longOption);

    const submitButton = screen.getByTestId('btn-submit-response');
    fireEvent.click(submitButton);

    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit.mock.calls[0]![0]).toEqual([['long']]);
  });
});

describe('RespondInput QuestionInput overflow handling', () => {
  it('renders long option labels with ellipsis truncation styles', () => {
    renderRespondInput(questionInput);

    const longOption = screen.getByTestId('respond-question-0-option-long');
    expect(longOption.textContent).toContain('这是一个非常长的选项文本');

    // The label span is the last child element of the option row (after the Radio)
    const labelSpan = longOption.lastElementChild as HTMLElement;
    expect(labelSpan).toBeTruthy();
    expect(labelSpan.tagName).toBe('SPAN');
    // Ellipsis truncation styles
    expect(labelSpan.style.overflow).toBe('hidden');
    expect(labelSpan.style.textOverflow).toBe('ellipsis');
    expect(labelSpan.style.whiteSpace).toBe('nowrap');
    expect(labelSpan.style.minWidth).toBe('0px');
    expect(labelSpan.style.flex).toContain('1');
  });

  it('wraps option rows with full width and minWidth 0', () => {
    renderRespondInput(questionInput);

    const longOption = screen.getByTestId('respond-question-0-option-long') as HTMLElement;
    expect(longOption.style.width).toBe('100%');
    expect(longOption.style.minWidth).toBe('0px');
    expect(longOption.style.boxSizing).toBe('border-box');
  });

  it('allows selecting a long option and submitting', () => {
    const { onSubmit } = renderRespondInput(questionInput);

    const longOption = screen.getByTestId('respond-question-0-option-long');
    fireEvent.click(longOption);

    const submitButton = screen.getByTestId('btn-submit-response');
    fireEvent.click(submitButton);

    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit.mock.calls[0]![0]).toEqual([['long']]);
  });
});
