// @vitest-environment jsdom
import { cleanup, fireEvent, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MessageInput } from '../src/features/composer/components/MessageInput.tsx';
import { renderWithAppProviders as render } from './renderWithAppProviders.tsx';
import { LONG_TEXT_THRESHOLD } from '../src/constants/inputLimits.ts';

afterEach(cleanup);

describe('MessageInput long text truncation', () => {
  it('truncates input exceeding the threshold and shows a notice', () => {
    const onSend = vi.fn();
    render(<MessageInput onSend={onSend} />);

    const textarea = screen.getByTestId('message-textarea') as HTMLTextAreaElement;
    const longText = 'a'.repeat(LONG_TEXT_THRESHOLD + 100);
    fireEvent.change(textarea, { target: { value: longText } });

    expect(textarea.value).toHaveLength(LONG_TEXT_THRESHOLD);
    const notice = screen.getByTestId('message-input-inline-notice');
    expect(notice.textContent).toContain(String(LONG_TEXT_THRESHOLD));
  });

  it('does not truncate or show notice when input is within threshold', () => {
    const onSend = vi.fn();
    render(<MessageInput onSend={onSend} />);

    const textarea = screen.getByTestId('message-textarea') as HTMLTextAreaElement;
    const okText = 'a'.repeat(LONG_TEXT_THRESHOLD);
    fireEvent.change(textarea, { target: { value: okText } });

    expect(textarea.value).toHaveLength(LONG_TEXT_THRESHOLD);
    expect(screen.queryByTestId('message-input-inline-notice')).toBeNull();
  });

  it('does not show notice for short input', () => {
    const onSend = vi.fn();
    render(<MessageInput onSend={onSend} />);

    const textarea = screen.getByTestId('message-textarea') as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: 'hello world' } });

    expect(textarea.value).toBe('hello world');
    expect(screen.queryByTestId('message-input-inline-notice')).toBeNull();
  });

  it('clears the notice when user edits after truncation', () => {
    const onSend = vi.fn();
    render(<MessageInput onSend={onSend} />);

    const textarea = screen.getByTestId('message-textarea') as HTMLTextAreaElement;
    const longText = 'a'.repeat(LONG_TEXT_THRESHOLD + 100);
    fireEvent.change(textarea, { target: { value: longText } });

    expect(screen.getByTestId('message-input-inline-notice')).toBeTruthy();

    // User edits back to a short value
    fireEvent.change(textarea, { target: { value: 'short' } });
    expect(screen.queryByTestId('message-input-inline-notice')).toBeNull();
  });

  it('re-truncates if content still exceeds threshold after edit', () => {
    const onSend = vi.fn();
    render(<MessageInput onSend={onSend} />);

    const textarea = screen.getByTestId('message-textarea') as HTMLTextAreaElement;
    const longText1 = 'a'.repeat(LONG_TEXT_THRESHOLD + 50);
    fireEvent.change(textarea, { target: { value: longText1 } });
    expect(textarea.value).toHaveLength(LONG_TEXT_THRESHOLD);

    const longText2 = 'b'.repeat(LONG_TEXT_THRESHOLD + 200);
    fireEvent.change(textarea, { target: { value: longText2 } });
    expect(textarea.value).toHaveLength(LONG_TEXT_THRESHOLD);
    expect(screen.getByTestId('message-input-inline-notice')).toBeTruthy();
  });

  it('handles paste the same as manual input', () => {
    const onSend = vi.fn();
    render(<MessageInput onSend={onSend} />);

    const textarea = screen.getByTestId('message-textarea') as HTMLTextAreaElement;
    const longText = 'x'.repeat(LONG_TEXT_THRESHOLD + 10);
    const textItem = {
      type: 'text/plain',
      getAsString: (cb: (text: string) => void) => cb(longText),
    };
    fireEvent.paste(textarea, {
      clipboardData: {
        getData: () => longText,
        items: [textItem],
        types: ['text/plain'],
      },
    });

    expect(textarea.value).toHaveLength(LONG_TEXT_THRESHOLD);
    expect(screen.getByTestId('message-input-inline-notice')).toBeTruthy();
  });

  it('shows character counter when near threshold (90%)', () => {
    const onSend = vi.fn();
    render(<MessageInput onSend={onSend} />);

    const textarea = screen.getByTestId('message-textarea') as HTMLTextAreaElement;
    const nearText = 'a'.repeat(Math.floor(LONG_TEXT_THRESHOLD * 0.91));
    fireEvent.change(textarea, { target: { value: nearText } });

    const counter = screen.getByTestId('char-counter');
    expect(counter.textContent).toContain(String(nearText.length));
    expect(counter.textContent).toContain(String(LONG_TEXT_THRESHOLD));
  });

  it('does not show character counter when well below threshold', () => {
    const onSend = vi.fn();
    render(<MessageInput onSend={onSend} />);

    const textarea = screen.getByTestId('message-textarea') as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: 'short message' } });

    expect(screen.queryByTestId('char-counter')).toBeNull();
  });

  it('does not disable send button when truncated', () => {
    const onSend = vi.fn();
    render(<MessageInput onSend={onSend} />);

    const textarea = screen.getByTestId('message-textarea') as HTMLTextAreaElement;
    const longText = 'a'.repeat(LONG_TEXT_THRESHOLD + 100);
    fireEvent.change(textarea, { target: { value: longText } });

    const sendButton = screen.getByTestId('btn-send') as HTMLButtonElement;
    expect(sendButton.disabled).toBe(false);
  });
});
