import { afterEach, describe, expect, it, vi } from 'vitest';

import { TranslationProgressOverlay } from '../../src/content/progress-overlay';

describe('TranslationProgressOverlay', () => {
  afterEach(() => {
    document.body.innerHTML = '';
    document.querySelector('[data-domlingo-overlay]')?.remove();
  });

  it('mounts in a closed shadow root and removes itself when the session returns idle', () => {
    const overlay = new TranslationProgressOverlay(document, {
      onStop: vi.fn(),
      onRestore: vi.fn(),
    });

    overlay.update({
      state: 'translating',
      total: 10,
      translated: 4,
      failed: 0,
      message: '正在翻译 4 / 10…',
    });

    const host = document.querySelector<HTMLElement>('[data-domlingo-overlay]');
    expect(host).not.toBeNull();
    expect(host?.shadowRoot).toBeNull();

    overlay.update({
      state: 'idle',
      total: 0,
      translated: 0,
      failed: 0,
      message: '已恢复原文。',
    });
    expect(document.querySelector('[data-domlingo-overlay]')).toBeNull();
  });
});
