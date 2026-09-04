import { useState } from 'react';
import { reportWarning } from '../utils/diagnostics.ts';

export function resolveIconSrc(icon: string | undefined, fallback: string): string {
  if (!icon) {
    return fallback;
  }
  // data: URI, absolute http(s) URL, and relative path are used as-is;
  // everything else is treated as a raw base64 string.
  if (icon.startsWith('data:') || icon.startsWith('http') || icon.startsWith('/') || icon.startsWith('./') || icon.startsWith('../')) {
    return icon;
  }
  return `data:image/png;base64,${icon}`;
}

export function useIconWithFallback(
  icon: string | undefined,
  fallback: string,
  label: string,
): {
  readonly src: string;
  readonly onError: () => void;
} {
  const [hadError, setHadError] = useState(false);
  const resolvedSrc = hadError ? fallback : resolveIconSrc(icon, fallback);
  const onError = () => {
    if (!hadError) {
      reportWarning(`[AICOConfig] Failed to load icon for "${label}", falling back to default.`);
      setHadError(true);
    }
  };
  return { src: resolvedSrc, onError };
}
