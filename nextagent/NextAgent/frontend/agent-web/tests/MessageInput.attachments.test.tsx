// @vitest-environment jsdom
import { cleanup, fireEvent, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MessageInput } from '../src/features/composer/components/MessageInput.tsx';
import { runtimeConfig } from '../src/config/runtimeConfig.ts';
import { validateAttachmentSelection, type ComposerAttachmentView } from '../src/features/composer/attachmentRules.ts';
import { renderWithAppProviders } from './renderWithAppProviders.tsx';

afterEach(cleanup);
afterEach(() => {
  delete runtimeConfig.chatUploadFileConfig;
});

function makeAttachment(overrides: Partial<ComposerAttachmentView> = {}): ComposerAttachmentView {
  return {
    localId: 'att-1',
    fileName: 'report.pdf',
    sizeBytes: 1024 * 1024,
    status: 'uploaded',
    progressPercent: 100,
    errorMessage: null,
    ...overrides,
  };
}

describe('MessageInput attachments', () => {
  it('renders queued attachment items with retry controls for failures', () => {
    renderWithAppProviders(
      <MessageInput
        attachments={[
          makeAttachment({ localId: 'attached', fileName: 'draft.pdf' }),
          makeAttachment({
            localId: 'error',
            fileName: 'broken.xlsx',
            status: 'error',
            errorMessage: 'Attachment upload failed',
          }),
        ]}
        onRetryAttachment={async () => {}}
      />,
    );

    expect(screen.getByTestId('attachment-queue')).toBeTruthy();
    expect(screen.getByText('draft.pdf')).toBeTruthy();
    expect(screen.getByText('broken.xlsx')).toBeTruthy();
    expect(screen.getByTestId('attachment-retry-error')).toBeTruthy();
  });

  it('forwards selected files to the attachment handler', () => {
    runtimeConfig.chatUploadFileConfig = {
      chatUploadFileType: ['*.pdf'],
      chatUploadMaxFileNumber: 10,
      chatUploadMaxFileSize: 10,
      uploadFileIdleExpireTime: 5,
      uploadFileMaxExpireTime: 30,
    };
    const onAddAttachments = vi.fn();
    const { container } = renderWithAppProviders(<MessageInput onAddAttachments={onAddAttachments} />);
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File(['content'], 'report.pdf', { type: 'application/pdf' });

    fireEvent.change(input, { target: { files: [file] } });

    expect(onAddAttachments).toHaveBeenCalledWith([file]);
  });

  it('allows removing an attachment from the queue', () => {
    const onRemoveAttachment = vi.fn();

    renderWithAppProviders(<MessageInput attachments={[makeAttachment({ localId: 'uploaded' })]} onRemoveAttachment={onRemoveAttachment} />);

    fireEvent.click(screen.getByTestId('attachment-remove-uploaded'));
    expect(onRemoveAttachment).toHaveBeenCalledWith('uploaded');
  });

  it('shows a lightweight drop hint while files are dragged over the composer', () => {
    renderWithAppProviders(<MessageInput />);

    fireEvent.dragEnter(screen.getByTestId('message-input-root'), {
      dataTransfer: {
        types: ['Files'],
      },
    });

    expect(screen.getByTestId('attachment-drop-hint')).toBeTruthy();
    expect(screen.getByTestId('message-input-root').getAttribute('data-drag-active')).toBe('true');
  });

  it('forwards dropped files to the attachment handler', () => {
    runtimeConfig.chatUploadFileConfig = {
      chatUploadFileType: ['*.pdf'],
      chatUploadMaxFileNumber: 10,
      chatUploadMaxFileSize: 10,
      uploadFileIdleExpireTime: 5,
      uploadFileMaxExpireTime: 30,
    };
    const onAddAttachments = vi.fn();
    const file = new File(['content'], 'dragged.pdf', { type: 'application/pdf' });

    renderWithAppProviders(<MessageInput onAddAttachments={onAddAttachments} />);

    fireEvent.drop(screen.getByTestId('message-input-root'), {
      dataTransfer: {
        types: ['Files'],
        files: [file],
      },
    });

    expect(onAddAttachments).toHaveBeenCalledWith([file]);
    expect(screen.getByTestId('message-input-root').getAttribute('data-drag-active')).toBe('false');
  });

  it('blocks Enter submission while an attachment is not uploaded', async () => {
    const onSend = vi.fn();
    renderWithAppProviders(
      <MessageInput attachments={[makeAttachment({ localId: 'pending', status: 'uploading', progressPercent: 40 })]} onSend={onSend} />,
    );

    const textarea = screen.getByTestId('message-textarea');
    fireEvent.change(textarea, { target: { value: 'question with pending upload' } });
    fireEvent.keyDown(textarea, { key: 'Enter' });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(onSend).not.toHaveBeenCalled();
  });

  it('submits via Enter when every attachment is uploaded', async () => {
    const onSend = vi.fn().mockResolvedValue(undefined);
    renderWithAppProviders(<MessageInput attachments={[makeAttachment({ localId: 'ready' })]} onSend={onSend} />);

    const textarea = screen.getByTestId('message-textarea');
    fireEvent.change(textarea, { target: { value: 'question with uploaded file' } });
    fireEvent.keyDown(textarea, { key: 'Enter' });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(onSend).toHaveBeenCalledWith('question with uploaded file');
  });

  it('submits via Enter when an attachment is expired', async () => {
    const onSend = vi.fn().mockResolvedValue(undefined);
    renderWithAppProviders(<MessageInput attachments={[makeAttachment({ localId: 'expired', status: 'expired' })]} onSend={onSend} />);

    const textarea = screen.getByTestId('message-textarea');
    fireEvent.change(textarea, { target: { value: 'question after expiry' } });
    fireEvent.keyDown(textarea, { key: 'Enter' });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(onSend).toHaveBeenCalledWith('question after expiry');
  });

  it('submits via Enter when an attachment is invalid', async () => {
    const onSend = vi.fn().mockResolvedValue(undefined);
    renderWithAppProviders(<MessageInput attachments={[makeAttachment({ localId: 'invalid', status: 'invalid' })]} onSend={onSend} />);

    const textarea = screen.getByTestId('message-textarea');
    fireEvent.change(textarea, { target: { value: 'question with invalid file' } });
    fireEvent.keyDown(textarea, { key: 'Enter' });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(onSend).toHaveBeenCalledWith('question with invalid file');
  });
});

describe('validateAttachmentSelection config-driven rules', () => {
  it('accepts telecom capture types from the bootstrap config', () => {
    const file = new File(['telecom bytes'], 'capture.pcap');
    const error = validateAttachmentSelection([file], [], {
      chatUploadFileType: ['*.pcap', '*.zip', '*.tmf', '*.ptmf'],
      chatUploadMaxFileNumber: 10,
      chatUploadMaxFileSize: 100,
    });
    expect(error).toBeNull();
  });

  it('rejects markdown when the configured list replaces the default', () => {
    const file = new File(['# notes'], 'notes.md');
    const error = validateAttachmentSelection([file], [], {
      chatUploadFileType: ['*.pcap'],
    });
    expect(error).not.toBeNull();
    expect(error).toContain('.pcap');
  });

  it('rejects all files when no config is provided', () => {
    const pcap = new File(['telecom bytes'], 'capture.pcap');
    expect(validateAttachmentSelection([pcap], [])).not.toBeNull();
    const md = new File(['# notes'], 'notes.md');
    expect(validateAttachmentSelection([md], [])).not.toBeNull();
  });

  it('uses the configured size and count limits', () => {
    const big = new File([new Uint8Array(6 * 1024 * 1024)], 'trace.tmf');
    expect(
      validateAttachmentSelection([big], [], {
        chatUploadFileType: ['*.tmf'],
        chatUploadMaxFileSize: 10,
      }),
    ).toBeNull();
    expect(
      validateAttachmentSelection([big], [], {
        chatUploadFileType: ['*.tmf'],
        chatUploadMaxFileSize: 5,
      }),
    ).not.toBeNull();

    const files = [1, 2, 3, 4].map((n) => new File(['x'], `trace-${n}.tmf`));
    expect(
      validateAttachmentSelection(files, [], {
        chatUploadFileType: ['*.tmf'],
        chatUploadMaxFileNumber: 4,
      }),
    ).toBeNull();
    expect(validateAttachmentSelection(files, [])).not.toBeNull();
  });
});
