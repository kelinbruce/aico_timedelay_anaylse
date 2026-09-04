import { describe, expect, it } from 'vitest';

import { CLIP_STREAM_RESULT_PROJECTION_KIND } from '../src/index.js';

describe('capability result projection kind', () => {
  it('owns the durable CLIP stream classifier in agent-common', () => {
    expect(CLIP_STREAM_RESULT_PROJECTION_KIND).toBe('CLIP_STREAM_V1');
  });
});
