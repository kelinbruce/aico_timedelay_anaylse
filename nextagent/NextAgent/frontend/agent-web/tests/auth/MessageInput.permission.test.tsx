// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { AppProviders } from '../../src/app/AppProviders.tsx';
import { MessageInput } from '../../src/features/composer/components/MessageInput.tsx';
import type { HostSiteContext } from '../../src/app/hostTypes.ts';
import { runtimeConfig } from '../../src/config/runtimeConfig.ts';

afterEach(cleanup);

function renderInMode(ops: string[], mode: 'immersive' | 'piu' = 'immersive') {
  runtimeConfig.chatUploadFileConfig = {
    chatUploadFileType: ['*.md'],
    chatUploadMaxFileNumber: 10,
    chatUploadMaxFileSize: 10,
    uploadFileIdleExpireTime: 5,
    uploadFileMaxExpireTime: 30,
  };
  const site: HostSiteContext = { user: { ops } };
  render(
    <AppProviders mode={mode} site={site}>
      <MessageInput onSend={async () => {}} />
    </AppProviders>,
  );
}

describe('MessageInput permission control', () => {
  it('disables send button when user lacks Write', () => {
    renderInMode(['AICOService.View']);
    const sendBtn = screen.getByTestId('btn-send');
    expect(sendBtn.hasAttribute('disabled')).toBe(true);
  });

  it('disables textarea when user lacks Write', () => {
    renderInMode(['AICOService.View']);
    const textarea = screen.getByTestId('message-textarea');
    expect(textarea.hasAttribute('disabled')).toBe(true);
  });

  it('disables attach button when user lacks Write', () => {
    renderInMode(['AICOService.View']);
    // AuthGate wraps Dropdown (not Button directly), so it uses pointerEvents wrapper
    const attachBtn = screen.getByTestId('attach-button');
    expect(attachBtn.parentElement?.style.pointerEvents).toBe('none');
  });

  it('does not render file input when user lacks Write', () => {
    renderInMode(['AICOService.View']);
    expect(document.querySelector('input[type="file"]')).toBeNull();
  });

  it('keeps send button enabled when user has Write', () => {
    renderInMode(['AICOService.View', 'AICOService.Write']);
    // AuthGate passes through when user has Write; button may still be disabled by submitDisabled (empty message)
    // Verify AuthGate did not inject disabled by checking it's not wrapped in pointerEvents span
    const sendBtn = screen.getByTestId('btn-send');
    expect(sendBtn.parentElement?.style.pointerEvents).not.toBe('none');
  });

  it('keeps attach button enabled when user has Write', () => {
    renderInMode(['AICOService.View', 'AICOService.Write']);
    const attachBtn = screen.getByTestId('attach-button');
    expect(attachBtn.parentElement?.style.pointerEvents).not.toBe('none');
  });

  it('renders file input when user has Write', () => {
    renderInMode(['AICOService.View', 'AICOService.Write']);
    expect(document.querySelector('input[type="file"]')).toBeTruthy();
  });

  it('renders stop button even when user lacks Write (stop is a safety action, not a write)', () => {
    render(
      <AppProviders mode="immersive" site={{ user: { ops: ['AICOService.View'] } }}>
        <MessageInput onSend={async () => {}} isExecuting onStop={() => {}} />
      </AppProviders>,
    );
    expect(screen.getByTestId('btn-stop')).toBeTruthy();
  });
});
