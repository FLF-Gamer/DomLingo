import { describe, expect, it } from 'vitest';

import { PRODUCT_FULL_NAME, PRODUCT_NAME, PRODUCT_NAME_ZH } from '../../src/shared/product';

describe('product metadata', () => {
  it('exposes a stable bilingual name', () => {
    expect(PRODUCT_NAME).toBe('DomLingo');
    expect(PRODUCT_NAME_ZH).toBe('原页译');
    expect(PRODUCT_FULL_NAME).toBe('DomLingo · 原页译');
  });
});
