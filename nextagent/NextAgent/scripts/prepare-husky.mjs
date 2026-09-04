import { existsSync } from 'node:fs';

if (process.env.HUSKY === '0' || process.env.NODE_ENV === 'production') {
  process.exit(0);
}

if (!existsSync('.husky')) {
  process.exit(0);
}

try {
  const husky = (await import('husky')).default;
  const message = husky();
  if (message) console.log(message);
} catch {
  // husky not installed (e.g. CI / production with --omit=dev), skip silently
}
