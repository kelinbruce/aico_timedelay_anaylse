import { describe, expect, it } from 'vitest';
import { resolveIconSrc } from './iconUtils.ts';

describe('resolveIconSrc', () => {
  it('returns fallback when icon is undefined', () => {
    expect(resolveIconSrc(undefined, 'logo.svg')).toBe('logo.svg');
  });

  it('returns icon as-is when it starts with data:', () => {
    const dataUrl = 'data:image/png;base64,iVBORw0KGgo=';
    expect(resolveIconSrc(dataUrl, 'logo.svg')).toBe(dataUrl);
  });

  it('returns icon as-is when it starts with http', () => {
    const url = 'http://example.com/icon.png';
    expect(resolveIconSrc(url, 'logo.svg')).toBe(url);
  });

  it('returns icon as-is when it starts with https', () => {
    const url = 'https://example.com/icon.png';
    expect(resolveIconSrc(url, 'logo.svg')).toBe(url);
  });

  it('returns root-relative path as-is', () => {
    const path = '/static/icons/agent.svg';
    expect(resolveIconSrc(path, 'logo.svg')).toBe(path);
  });

  it('returns ./ relative path as-is', () => {
    const path = './icons/agent.svg';
    expect(resolveIconSrc(path, 'logo.svg')).toBe(path);
  });

  it('returns ../ relative path as-is', () => {
    const path = '../assets/agent.svg';
    expect(resolveIconSrc(path, 'logo.svg')).toBe(path);
  });

  it('wraps raw base64 string with data:image/png prefix', () => {
    expect(resolveIconSrc('iVBORw0KGgo=', 'logo.svg')).toBe('data:image/png;base64,iVBORw0KGgo=');
  });
});
