import { createHash } from 'node:crypto';

import { safeFailure } from './path-security.js';
export { truncateUtf8 } from '@nextagent/agent-common';

export interface DecodedText {
  readonly text: string;
  readonly encoding: 'UTF8' | 'UTF8_BOM' | 'UTF16_LE' | 'UTF16_BE' | 'GBK';
}

export function decodeText(bytes: Buffer): DecodedText {
  let decoded: DecodedText;
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    decoded = { text: new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(3)), encoding: 'UTF8_BOM' };
  } else if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) {
    decoded = { text: new TextDecoder('utf-16le', { fatal: true }).decode(bytes.subarray(2)), encoding: 'UTF16_LE' };
  } else if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
    const swapped = Buffer.allocUnsafe(bytes.length - 2);
    for (let index = 2; index < bytes.length; index += 2) {
      swapped[index - 2] = bytes[index + 1] ?? 0;
      swapped[index - 1] = bytes[index]!;
    }
    decoded = { text: new TextDecoder('utf-16le', { fatal: true }).decode(swapped), encoding: 'UTF16_BE' };
  } else {
    try {
      decoded = { text: new TextDecoder('utf-8', { fatal: true }).decode(bytes), encoding: 'UTF8' };
    } catch {
      // Windows system binaries (ping, cmd) emit output in the system codepage
      // (GBK/CP936 on zh-CN hosts), which is not valid UTF-8. Fall back to GBK
      // so the Read tool can surface background-task output and similar files.
      try {
        decoded = { text: new TextDecoder('gbk').decode(bytes), encoding: 'GBK' };
      } catch {
        decoded = { text: new TextDecoder('utf-8').decode(bytes), encoding: 'UTF8' };
      }
    }
  }
  if (decoded.text.includes('\u0000')) {
    throw safeFailure('CAPABILITY_PATH_REJECTED', 'File is not supported text.', 'AUTHORIZATION');
  }
  return decoded;
}

export function encodeText(text: string, encoding: DecodedText['encoding']): Buffer {
  if (text.includes('\u0000')) {
    throw safeFailure('CAPABILITY_INPUT_INVALID', 'Text content must not contain NUL characters.', 'VALIDATION');
  }
  if (encoding === 'UTF8') {
    return Buffer.from(text, 'utf8');
  }
  if (encoding === 'UTF8_BOM') {
    return Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(text, 'utf8')]);
  }
  if (encoding === 'GBK') {
    // GBK is read-only decode-only (Node cannot re-encode GBK). On Write/Edit,
    // normalize the file to UTF-8 so subsequent reads stay valid.
    return Buffer.from(text, 'utf8');
  }
  const littleEndian = Buffer.from(text, 'utf16le');
  if (encoding === 'UTF16_LE') {
    return Buffer.concat([Buffer.from([0xff, 0xfe]), littleEndian]);
  }
  const bigEndian = Buffer.allocUnsafe(littleEndian.length);
  for (let index = 0; index < littleEndian.length; index += 2) {
    bigEndian[index] = littleEndian[index + 1]!;
    bigEndian[index + 1] = littleEndian[index]!;
  }
  return Buffer.concat([Buffer.from([0xfe, 0xff]), bigEndian]);
}

export function fingerprint(bytes: Uint8Array, mtimeMs: number, mode: number): string {
  return `${mtimeMs}:${mode}:${bytes.byteLength}:${createHash('sha256').update(bytes).digest('hex')}`;
}
