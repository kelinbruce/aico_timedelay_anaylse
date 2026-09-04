// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { MarkdownContent } from '../src/features/chat/components/MarkdownContent.tsx';
import { redactSensitiveDisplayText } from '../src/utils/redactSensitiveDisplayText.ts';

describe('redaction placeholder presentation consistency', () => {
  it('shows the same canonical placeholder in Chat Markdown and Memory plain text', () => {
    const escapedPlaceholder = '[REDACTED\\_PATH]';

    render(
      <>
        <div data-testid="chat-placeholder">
          <MarkdownContent content={escapedPlaceholder} />
        </div>
        <div data-testid="memory-placeholder">{redactSensitiveDisplayText(escapedPlaceholder)}</div>
      </>,
    );

    expect(screen.getByTestId('chat-placeholder').querySelector('.markdown-content p')?.textContent).toBe('[REDACTED_PATH]');
    expect(screen.getByTestId('memory-placeholder').textContent).toBe('[REDACTED_PATH]');
  });

  it('shows the same sensitive-category placeholders in Chat Markdown and Memory plain text', () => {
    const sensitiveText = 'password=hunter2 Bearer abcdefghijk 13800138000';
    const redactedText = redactSensitiveDisplayText(sensitiveText);

    render(
      <>
        <div data-testid="chat-sensitive-placeholder">
          <MarkdownContent content={redactedText} />
        </div>
        <div data-testid="memory-sensitive-placeholder">{redactedText}</div>
      </>,
    );

    const expected = '[REDACTED_SECRET] Bearer [REDACTED_TOKEN] [REDACTED_PHONE]';
    expect(screen.getByTestId('chat-sensitive-placeholder').querySelector('.markdown-content p')?.textContent).toBe(expected);
    expect(screen.getByTestId('memory-sensitive-placeholder').textContent).toBe(expected);
  });
});
