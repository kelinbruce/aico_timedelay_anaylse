// @vitest-environment jsdom
import { cleanup, fireEvent, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MessageInput } from '../src/features/composer/components/MessageInput.tsx';
import { renderWithAppProviders as render } from './renderWithAppProviders.tsx';

afterEach(cleanup);

describe('MessageInput cancel shortcut', () => {
  it('does not render the stop button in danger style', () => {
    render(<MessageInput onSend={async () => {}} isExecuting onStop={() => {}} />);

    const stopButton = screen.getByTestId('btn-stop');
    expect(stopButton.className).not.toContain('ant-btn-dangerous');
  });

  it('renders stop as the sole primary action while a request is executing', () => {
    const onStop = vi.fn();

    render(<MessageInput onSend={async () => {}} isExecuting onStop={onStop} initialInput="next question" />);

    const stopButton = screen.getByTestId('btn-stop') as HTMLButtonElement;
    expect(screen.queryByTestId('btn-send')).toBeNull();
    expect(screen.getByTestId('message-textarea').textContent).toBe('next question');

    fireEvent.click(stopButton);
    expect(onStop).toHaveBeenCalledTimes(1);
  });

  it('requires pressing Escape twice to cancel and shows a hint after the first press', () => {
    vi.useFakeTimers();
    const onStop = vi.fn();

    render(<MessageInput onSend={async () => {}} isExecuting onStop={onStop} />);

    const textarea = screen.getByTestId('message-textarea');
    fireEvent.keyDown(textarea, { key: 'Escape' });

    expect(onStop).not.toHaveBeenCalled();
    expect(screen.getByTestId('esc-cancel-hint').textContent).toContain('再按一次 Esc 取消当前请求');

    fireEvent.keyDown(textarea, { key: 'Escape' });

    expect(onStop).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId('esc-cancel-hint')).toBeNull();
    vi.useRealTimers();
  });

  it('cancels with double Escape even when focus is outside the textarea', () => {
    vi.useFakeTimers();
    const onStop = vi.fn();

    render(<MessageInput onSend={async () => {}} isExecuting onStop={onStop} />);

    fireEvent.keyDown(window, { key: 'Escape' });

    expect(onStop).not.toHaveBeenCalled();
    expect(screen.getByTestId('esc-cancel-hint').textContent).toContain('Esc');

    fireEvent.keyDown(window, { key: 'Escape' });

    expect(onStop).toHaveBeenCalledTimes(1);
    expect(onStop).toHaveBeenCalledWith();
    expect(screen.queryByTestId('esc-cancel-hint')).toBeNull();
    vi.useRealTimers();
  });

  it('does not arm request cancellation while an escape-dismissible dialog is visible', () => {
    vi.useFakeTimers();
    const onStop = vi.fn();
    const dialog = document.createElement('div');
    dialog.setAttribute('role', 'dialog');
    dialog.getClientRects = () => [{ width: 100, height: 100 }] as unknown as DOMRectList;
    document.body.appendChild(dialog);

    try {
      render(<MessageInput onSend={async () => {}} isExecuting onStop={onStop} />);

      fireEvent.keyDown(window, { key: 'Escape' });
      fireEvent.keyDown(window, { key: 'Escape' });

      expect(onStop).not.toHaveBeenCalled();
      expect(screen.queryByTestId('esc-cancel-hint')).toBeNull();
    } finally {
      dialog.remove();
      vi.useRealTimers();
    }
  });

  it('arms request cancellation when a stale hidden dialog remains in the DOM', () => {
    vi.useFakeTimers();
    const onStop = vi.fn();
    const dialog = document.createElement('div');
    dialog.setAttribute('role', 'dialog');
    dialog.getClientRects = () => [] as unknown as DOMRectList;
    document.body.appendChild(dialog);

    try {
      render(<MessageInput onSend={async () => {}} isExecuting onStop={onStop} />);

      fireEvent.keyDown(window, { key: 'Escape' });

      expect(onStop).not.toHaveBeenCalled();
      expect(screen.getByTestId('esc-cancel-hint').textContent).toContain('Esc');
    } finally {
      dialog.remove();
      vi.useRealTimers();
    }
  });
});
