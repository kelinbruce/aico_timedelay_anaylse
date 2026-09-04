import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent, cleanup, act } from '@testing-library/react';
import { MessageInput } from './MessageInput.tsx';

const mockGet = vi.fn();
vi.mock('../../../services/apiClient.ts', () => ({
  apiClient: {
    get: (...args: unknown[]) => mockGet(...args),
    post: vi.fn(),
  },
}));

vi.mock('../../../services/skillCatalogService.ts', () => ({
  querySkills: vi.fn().mockResolvedValue({ skills: [], total: 0 }),
}));

vi.mock('../../../app/AppProviders.tsx', () => ({
  useAppHostContext: () => ({ site: { locale: 'zh-CN' } }),
}));

vi.mock('../../auth/useUserOps.ts', () => ({
  useUserOps: () => null,
}));

vi.mock('../../auth/AuthGate.tsx', () => ({
  AuthGate: ({ children }: { children: React.ReactNode }) => children,
}));

vi.mock('../../auth/AuthWrapper.tsx', () => ({
  AuthWrapper: ({ children }: { children: React.ReactNode }) => children,
}));

vi.mock('../../../state/skillSelectionStore.ts', () => ({
  useSkillSelectionStore: () => null,
}));

vi.mock('../../../state/categorySelectionStore.ts', () => ({
  useCategorySelectionStore: () => null,
}));

beforeEach(() => {
  mockGet.mockReset();
});

afterEach(() => {
  cleanup();
});

function renderMessageInput(submittedMessageHistory: readonly string[] = []) {
  return render(<MessageInput onSend={vi.fn()} submittedMessageHistory={submittedMessageHistory} />);
}

async function typeAndWait(text: string) {
  const textarea = screen.getByTestId('message-textarea');
  textarea.focus();
  fireEvent.change(textarea, { target: { value: text } });
  await waitFor(
    () => {
      expect(mockGet).toHaveBeenCalled();
    },
    { timeout: 3000 },
  );
}

describe('MessageInput association panel', () => {
  it('shows association panel when typing normal text', async () => {
    mockGet.mockResolvedValueOnce({
      locale: 'zh-CN',
      questions: [{ text: 'association-test-q', source: 'pinned' }],
    });
    renderMessageInput();
    await typeAndWait('test');
    await waitFor(() => {
      expect(screen.getByTestId('association-panel')).toBeTruthy();
    });
  });

  it('does not show association panel for slash commands', async () => {
    renderMessageInput();
    const textarea = screen.getByTestId('message-textarea');
    fireEvent.change(textarea, { target: { value: '/help' } });
    await new Promise((resolve) => setTimeout(resolve, 600));
    expect(mockGet).not.toHaveBeenCalled();
    expect(screen.queryByTestId('association-panel')).toBeNull();
  });

  it('does not show association panel for empty input', async () => {
    renderMessageInput();
    const textarea = screen.getByTestId('message-textarea');
    fireEvent.change(textarea, { target: { value: '   ' } });
    await new Promise((resolve) => setTimeout(resolve, 600));
    expect(mockGet).not.toHaveBeenCalled();
    expect(screen.queryByTestId('association-panel')).toBeNull();
  });

  it('does not query associations while recalling submitted messages', async () => {
    mockGet.mockResolvedValue({ locale: 'zh-CN', questions: [] });
    renderMessageInput(['older question', 'latest question']);
    const textarea = screen.getByTestId('message-textarea') as HTMLTextAreaElement;
    textarea.focus();

    fireEvent.keyDown(textarea, { key: 'ArrowUp' });

    expect(textarea.value).toBe('latest question');
    await new Promise((resolve) => setTimeout(resolve, 600));
    expect(mockGet).not.toHaveBeenCalled();
    expect(screen.queryByTestId('association-panel')).toBeNull();
  });

  it('does not query associations while navigating newer history with ArrowDown', async () => {
    mockGet.mockResolvedValue({ locale: 'zh-CN', questions: [] });
    renderMessageInput(['older question', 'latest question']);
    const textarea = screen.getByTestId('message-textarea') as HTMLTextAreaElement;
    textarea.focus();

    fireEvent.keyDown(textarea, { key: 'ArrowUp' });
    fireEvent.keyDown(textarea, { key: 'ArrowUp' });
    fireEvent.keyDown(textarea, { key: 'ArrowDown' });

    expect(textarea.value).toBe('latest question');
    await new Promise((resolve) => setTimeout(resolve, 600));
    expect(mockGet).not.toHaveBeenCalled();
    expect(screen.queryByTestId('association-panel')).toBeNull();
  });

  it('cancels a pending association debounce when entering history recall', async () => {
    mockGet.mockResolvedValue({ locale: 'zh-CN', questions: [] });
    renderMessageInput(['submitted question']);
    const textarea = screen.getByTestId('message-textarea') as HTMLTextAreaElement;
    textarea.focus();

    fireEvent.change(textarea, { target: { value: 'draft' } });
    await new Promise((resolve) => setTimeout(resolve, 100));
    fireEvent.change(textarea, { target: { value: '' } });
    fireEvent.keyDown(textarea, { key: 'ArrowUp' });

    expect(textarea.value).toBe('submitted question');
    await new Promise((resolve) => setTimeout(resolve, 600));
    expect(mockGet).not.toHaveBeenCalled();
    expect(screen.queryByTestId('association-panel')).toBeNull();
  });

  it('resumes association queries after editing a recalled message', async () => {
    mockGet.mockResolvedValue({ locale: 'zh-CN', questions: [] });
    renderMessageInput(['latest question']);
    const textarea = screen.getByTestId('message-textarea') as HTMLTextAreaElement;
    textarea.focus();

    fireEvent.keyDown(textarea, { key: 'ArrowUp' });
    await new Promise((resolve) => setTimeout(resolve, 600));
    mockGet.mockClear();

    fireEvent.change(textarea, { target: { value: 'latest question edited' } });

    await waitFor(() => {
      expect(mockGet).toHaveBeenCalledWith(
        expect.stringContaining('keyword=latest%20question%20edited'),
        expect.objectContaining({ signal: expect.any(AbortSignal) }),
      );
    });
  });

  it('aborts an in-flight association query when entering history recall', async () => {
    const requestState: { signal: AbortSignal | null } = { signal: null };
    let resolveRequest!: (value: { locale: string; questions: ReadonlyArray<{ text: string; source: 'static' }> }) => void;
    mockGet.mockImplementation((_path: string, init?: RequestInit) => {
      requestState.signal = init?.signal ?? null;
      return new Promise((resolve) => {
        resolveRequest = resolve;
      });
    });
    renderMessageInput(['submitted question']);
    const textarea = screen.getByTestId('message-textarea') as HTMLTextAreaElement;
    textarea.focus();

    fireEvent.change(textarea, { target: { value: 'draft' } });
    await waitFor(() => expect(mockGet).toHaveBeenCalledTimes(1));
    expect(requestState.signal?.aborted).toBe(false);

    fireEvent.change(textarea, { target: { value: '' } });
    fireEvent.keyDown(textarea, { key: 'ArrowUp' });

    expect(textarea.value).toBe('submitted question');
    expect(requestState.signal?.aborted).toBe(true);
    resolveRequest({ locale: 'zh-CN', questions: [{ text: 'late result', source: 'static' }] });
    await Promise.resolve();
    expect(screen.queryByTestId('association-panel')).toBeNull();
  });

  it('closes panel when API returns empty list', async () => {
    mockGet.mockResolvedValueOnce({ locale: 'zh-CN', questions: [] });
    renderMessageInput();
    await typeAndWait('nomatch');
    await waitFor(() => {
      expect(screen.queryByTestId('association-panel')).toBeNull();
    });
  });

  it('closes panel on API failure', async () => {
    mockGet.mockRejectedValueOnce(new Error('network'));
    renderMessageInput();
    await typeAndWait('error');
    await waitFor(() => {
      expect(screen.queryByTestId('association-panel')).toBeNull();
    });
  });

  it('renders source labels for each result', async () => {
    mockGet.mockResolvedValueOnce({
      locale: 'zh-CN',
      questions: [
        { text: 'pinned-q', source: 'pinned' },
        { text: 'freq-q', source: 'high-frequency' },
        { text: 'static-q', source: 'static' },
      ],
    });
    renderMessageInput();
    await typeAndWait('q');
    await waitFor(() => {
      expect(screen.getByTestId('association-panel')).toBeTruthy();
    });
    expect(screen.getByText((_, node) => node?.textContent === 'pinned-q')).toBeTruthy();
    expect(screen.getByText((_, node) => node?.textContent === 'freq-q')).toBeTruthy();
    expect(screen.getByText((_, node) => node?.textContent === 'static-q')).toBeTruthy();
  });

  it('fills textarea on click and closes panel', async () => {
    mockGet.mockResolvedValueOnce({
      locale: 'zh-CN',
      questions: [{ text: 'clicked-q', source: 'pinned' }],
    });
    renderMessageInput();
    await typeAndWait('clicked');
    await waitFor(() => {
      expect(screen.getByTestId('association-item-0')).toBeTruthy();
    });
    fireEvent.mouseDown(screen.getByTestId('association-item-0'));
    const textarea = screen.getByTestId('message-textarea') as HTMLTextAreaElement;
    expect(textarea.value).toBe('clicked-q');
    expect(screen.queryByTestId('association-panel')).toBeNull();
  });

  it('navigates with arrow keys and selects with Enter', async () => {
    mockGet.mockResolvedValueOnce({
      locale: 'zh-CN',
      questions: [
        { text: 'q1', source: 'pinned' },
        { text: 'q2', source: 'high-frequency' },
      ],
    });
    renderMessageInput();
    await typeAndWait('q');
    await waitFor(() => {
      expect(screen.getByTestId('association-panel')).toBeTruthy();
    });
    const textarea = screen.getByTestId('message-textarea');
    fireEvent.keyDown(textarea, { key: 'ArrowDown' });
    fireEvent.keyDown(textarea, { key: 'ArrowDown' });
    fireEvent.keyDown(textarea, { key: 'Enter' });
    expect((textarea as HTMLTextAreaElement).value).toBe('q2');
    expect(screen.queryByTestId('association-panel')).toBeNull();
  });

  it('submits the typed text on Enter when no suggestion is keyboard-selected', async () => {
    mockGet.mockResolvedValueOnce({
      locale: 'zh-CN',
      questions: [
        { text: 'q1', source: 'pinned' },
        { text: 'q2', source: 'high-frequency' },
      ],
    });
    const onSend = vi.fn().mockResolvedValue(undefined);
    render(<MessageInput onSend={onSend} />);
    await typeAndWait('hello');
    await waitFor(() => {
      expect(screen.getByTestId('association-panel')).toBeTruthy();
    });
    const textarea = screen.getByTestId('message-textarea');
    fireEvent.keyDown(textarea, { key: 'Enter' });
    await waitFor(() => {
      expect(onSend).toHaveBeenCalledWith('hello');
    });
  });

  it('does not arm Enter when a suggestion is only hovered with the mouse', async () => {
    mockGet.mockResolvedValueOnce({
      locale: 'zh-CN',
      questions: [{ text: 'hovered-q', source: 'pinned' }],
    });
    const onSend = vi.fn().mockResolvedValue(undefined);
    render(<MessageInput onSend={onSend} />);
    await typeAndWait('hello');
    await waitFor(() => {
      expect(screen.getByTestId('association-item-0')).toBeTruthy();
    });
    fireEvent.mouseEnter(screen.getByTestId('association-item-0'));
    const textarea = screen.getByTestId('message-textarea');
    fireEvent.keyDown(textarea, { key: 'Enter' });
    await waitFor(() => {
      expect(onSend).toHaveBeenCalledWith('hello');
    });
    expect((textarea as HTMLTextAreaElement).value).not.toBe('hovered-q');
  });

  it('returns to no selection when pressing ArrowUp on the first item', async () => {
    mockGet.mockResolvedValueOnce({
      locale: 'zh-CN',
      questions: [
        { text: 'q1', source: 'pinned' },
        { text: 'q2', source: 'high-frequency' },
      ],
    });
    const onSend = vi.fn().mockResolvedValue(undefined);
    render(<MessageInput onSend={onSend} />);
    await typeAndWait('hello');
    await waitFor(() => {
      expect(screen.getByTestId('association-panel')).toBeTruthy();
    });
    const textarea = screen.getByTestId('message-textarea');
    fireEvent.keyDown(textarea, { key: 'ArrowDown' });
    fireEvent.keyDown(textarea, { key: 'ArrowUp' });
    fireEvent.keyDown(textarea, { key: 'Enter' });
    await waitFor(() => {
      expect(onSend).toHaveBeenCalledWith('hello');
    });
  });

  it('does not open the association panel for pasted content', async () => {
    renderMessageInput();
    const textarea = screen.getByTestId('message-textarea');
    textarea.focus();
    fireEvent.paste(textarea, {
      clipboardData: {
        items: [
          {
            type: 'text/plain',
            getAsString: (callback: (text: string) => void) => callback('pasted content'),
          },
        ],
      },
    });
    await new Promise((resolve) => setTimeout(resolve, 600));
    expect(mockGet).not.toHaveBeenCalled();
    expect(screen.queryByTestId('association-panel')).toBeNull();
  });

  it('cancels the pending association query when pasting before the debounce fires', async () => {
    renderMessageInput();
    const textarea = screen.getByTestId('message-textarea');
    textarea.focus();
    fireEvent.change(textarea, { target: { value: 'typed' } });
    fireEvent.paste(textarea, {
      clipboardData: {
        items: [
          {
            type: 'text/plain',
            getAsString: (callback: (text: string) => void) => callback(' pasted'),
          },
        ],
      },
    });
    await new Promise((resolve) => setTimeout(resolve, 600));
    expect(mockGet).not.toHaveBeenCalled();
    expect(screen.queryByTestId('association-panel')).toBeNull();
  });

  it('closes the panel when clicking outside of it', async () => {
    mockGet.mockResolvedValueOnce({
      locale: 'zh-CN',
      questions: [{ text: 'q1', source: 'pinned' }],
    });
    renderMessageInput();
    await typeAndWait('q');
    await waitFor(() => {
      expect(screen.getByTestId('association-panel')).toBeTruthy();
    });
    fireEvent.mouseDown(document.body);
    expect(screen.queryByTestId('association-panel')).toBeNull();
  });

  it('closes the panel when the textarea loses focus', async () => {
    mockGet.mockResolvedValueOnce({
      locale: 'zh-CN',
      questions: [{ text: 'q1', source: 'pinned' }],
    });
    renderMessageInput();
    await typeAndWait('q');
    await waitFor(() => {
      expect(screen.getByTestId('association-panel')).toBeTruthy();
    });
    fireEvent.blur(screen.getByTestId('message-textarea'));
    expect(screen.queryByTestId('association-panel')).toBeNull();
  });

  it('does not open the association panel when a result arrives after the textarea loses focus', async () => {
    let resolveRequest!: (value: { locale: string; questions: ReadonlyArray<{ text: string; source: 'static' }> }) => void;
    mockGet.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveRequest = resolve;
        }),
    );
    renderMessageInput();
    const textarea = screen.getByTestId('message-textarea');
    textarea.focus();
    fireEvent.change(textarea, { target: { value: 'q' } });
    await waitFor(() => expect(mockGet).toHaveBeenCalledTimes(1));

    act(() => textarea.blur());
    expect(document.activeElement).not.toBe(textarea);
    await act(async () => {
      resolveRequest({ locale: 'zh-CN', questions: [{ text: 'late result', source: 'static' }] });
    });

    expect(screen.queryByTestId('association-panel')).toBeNull();
  });

  it('does not intercept Enter during IME composition', async () => {
    mockGet.mockResolvedValueOnce({
      locale: 'zh-CN',
      questions: [{ text: 'q1', source: 'pinned' }],
    });
    const onSend = vi.fn().mockResolvedValue(undefined);
    render(<MessageInput onSend={onSend} />);
    const textarea = screen.getByTestId('message-textarea');
    textarea.focus();
    fireEvent.compositionStart(textarea);
    fireEvent.change(textarea, { target: { value: 'q' } });
    await waitFor(() => {
      expect(screen.getByTestId('association-panel')).toBeTruthy();
    });
    fireEvent.keyDown(textarea, { key: 'Enter', isComposing: true });
    expect(onSend).not.toHaveBeenCalled();
    expect((textarea as HTMLTextAreaElement).value).toBe('q');
  });

  it('closes panel on Escape', async () => {
    mockGet.mockResolvedValueOnce({
      locale: 'zh-CN',
      questions: [{ text: 'q1', source: 'pinned' }],
    });
    renderMessageInput();
    await typeAndWait('q');
    await waitFor(() => {
      expect(screen.getByTestId('association-panel')).toBeTruthy();
    });
    const textarea = screen.getByTestId('message-textarea');
    fireEvent.keyDown(textarea, { key: 'Escape' });
    expect(screen.queryByTestId('association-panel')).toBeNull();
  });
});
