import { AgentError } from '@nextagent/agent-common';

export const maxTerminalMessageChars = 50_000;

const bannedPathPattern = /([A-Za-z]:\\(?:[^\s:<>"|?*]+\\)*[^\s:<>"|?*]+)/gu;
const bannedUnixPathPattern = /\/(?:\S+\/)+\S+/gu;
const bannedCredentialPattern = /(?:sk-[A-Za-z0-9]{10,}|Bearer\s+[A-Za-z0-9._\-~+/=]+)/gu;

function redactErrorMessage(message: string): string {
  return message.replace(bannedPathPattern, '<redacted>').replace(bannedUnixPathPattern, '<redacted>').replace(bannedCredentialPattern, '<redacted>');
}

export function safeErrorContent(error: unknown): string {
  if (error instanceof AgentError) {
    return `Request failed: ${redactErrorMessage(error.message)}`;
  }
  if (error instanceof Error) {
    return `Request failed: ${redactErrorMessage(error.message)}`;
  }
  return 'Request failed.';
}
