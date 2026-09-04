import { create } from 'zustand';
import type { UserInputKind, UserInputOption, UserInputQuestion, WireTimestamp } from './contracts';

export type UserInputSubmitStatus = 'idle' | 'submitting' | 'error';

export interface ActiveUserInput {
  readonly inputRequestId: string;
  readonly inputKind: UserInputKind;
  readonly prompt: string;
  readonly options?: readonly UserInputOption[];
  readonly questions?: readonly UserInputQuestion[];
  readonly origin?: string | null;
  readonly originId?: string | null;
  readonly riskLevel?: string | null;
  readonly expiresAt?: WireTimestamp | null;
  readonly timeoutDurationMs?: number | null;
  readonly receivedAt?: number | null;
  readonly requestId: string;
}

interface UserInputState {
  activeInput: ActiveUserInput | null;
  submitStatus: UserInputSubmitStatus;
  submitError: string | null;
}

interface UserInputActions {
  activateInputRequest: (state: ActiveUserInput) => void;
  resolveInputRequest: (eventType: string) => void;
  setSubmitStatus: (status: UserInputSubmitStatus, error?: string | null) => void;
  clear: () => void;
}

export type UserInputStore = UserInputState & UserInputActions;

export const useUserInputStore = create<UserInputStore>((set, get) => ({
  activeInput: null,
  submitStatus: 'idle',
  submitError: null,

  activateInputRequest: (state) => {
    const current = get().activeInput;
    if (current?.inputRequestId === state.inputRequestId) {
      return;
    }
    set({
      activeInput: state,
      submitStatus: 'idle',
      submitError: null,
    });
  },

  resolveInputRequest: (_eventType) => {
    set({
      activeInput: null,
      submitStatus: 'idle',
      submitError: null,
    });
  },

  setSubmitStatus: (status, error = null) => {
    set({
      submitStatus: status,
      submitError: error,
    });
  },

  clear: () => {
    set({
      activeInput: null,
      submitStatus: 'idle',
      submitError: null,
    });
  },
}));
