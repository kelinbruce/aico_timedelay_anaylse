// @vitest-environment jsdom
import { cleanup, fireEvent, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MessageInput } from '../src/features/composer/components/MessageInput.tsx';
import { renderWithAppProviders as render } from './renderWithAppProviders.tsx';

afterEach(cleanup);

describe('MessageInput wheel behavior', () => {
  it('does not delegate wheel events to the outer viewport when the textarea itself is scrollable', () => {
    const onOuterWheel = vi.fn();

    render(
      <div onWheel={onOuterWheel}>
        <MessageInput onSend={async () => {}} />
      </div>,
    );

    const textarea = screen.getByTestId('message-textarea') as HTMLTextAreaElement;
    Object.defineProperty(textarea, 'scrollHeight', { value: 240, configurable: true });
    Object.defineProperty(textarea, 'clientHeight', { value: 120, configurable: true });

    fireEvent.wheel(textarea, { deltaY: 100 });

    expect(onOuterWheel).not.toHaveBeenCalled();
  });
});
