import { afterEach, describe, expect, it, vi } from 'vitest';

import { TranslationProgressOverlay } from '../../src/content/progress-overlay';

describe('TranslationProgressOverlay', () => {
  afterEach(() => {
    document.body.innerHTML = '';
    document.querySelector('[data-domlingo-overlay]')?.remove();
    vi.restoreAllMocks();
  });

  it('mounts in a closed shadow root and removes itself when the session returns idle', () => {
    const overlay = new TranslationProgressOverlay(document, {
      onStop: vi.fn(),
      onRetry: vi.fn(),
      onRestore: vi.fn(),
    });

    overlay.update({
      state: 'translating',
      total: 10,
      translated: 4,
      failed: 0,
      failureDetails: {},
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
      failureDetails: {},
      message: '已恢复原文。',
    });
    expect(document.querySelector('[data-domlingo-overlay]')).toBeNull();
  });

  it('shows and invokes retry only when failed nodes remain', () => {
    const originalAttachShadow = Element.prototype.attachShadow;
    let capturedShadow: ShadowRoot | undefined;
    vi.spyOn(Element.prototype, 'attachShadow').mockImplementation(function (
      this: Element,
      init: ShadowRootInit,
    ) {
      capturedShadow = originalAttachShadow.call(this, init);
      return capturedShadow;
    });
    const onRetry = vi.fn();
    const overlay = new TranslationProgressOverlay(document, {
      onStop: vi.fn(),
      onRetry,
      onRestore: vi.fn(),
    });

    overlay.update({
      state: 'completed',
      total: 10,
      translated: 8,
      failed: 2,
      failureDetails: { INVALID_RESPONSE: 2 },
      message: '翻译完成：成功 8，失败 2。',
    });

    const retryButton = capturedShadow?.querySelector<HTMLButtonElement>(
      'button[data-action="retry"]',
    );
    expect(retryButton?.hidden).toBe(false);
    expect(retryButton?.textContent).toBe('重试失败内容（2）');
    retryButton?.click();
    expect(onRetry).toHaveBeenCalledOnce();
  });
});
