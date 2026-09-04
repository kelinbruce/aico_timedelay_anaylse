import dayjs from 'dayjs';
import { afterEach, describe, expect, it } from 'vitest';
import { setLocalePreference } from './index.ts';

describe('i18n dayjs locale integration', () => {
  afterEach(async () => {
    await setLocalePreference('zh-CN');
  });

  it('sets dayjs locale to zh-cn when app locale is zh-CN', async () => {
    await setLocalePreference('zh-CN');
    expect(dayjs.locale()).toBe('zh-cn');
  });

  it('sets dayjs locale to en when app locale is en-US', async () => {
    await setLocalePreference('en-US');
    expect(dayjs.locale()).toBe('en');
  });
});
