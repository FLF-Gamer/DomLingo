import { afterEach, describe, expect, it, vi } from 'vitest';

import { monitorPageLifecycle } from '../../src/content/page-lifecycle';

describe('page lifecycle monitor', () => {
  afterEach(() => {
    vi.useRealTimers();
    window.history.replaceState({}, '', '/');
  });

  it('detects history API navigation that does not reload the document', () => {
    vi.useFakeTimers();
    const onNavigation = vi.fn();
    const monitor = monitorPageLifecycle(window, onNavigation, 100);

    window.history.pushState({}, '', '/next-route');
    vi.advanceTimersByTime(100);
    vi.advanceTimersByTime(500);

    expect(onNavigation).toHaveBeenCalledOnce();
    monitor.dispose();
  });

  it('cancels immediately when the current document is being discarded', () => {
    vi.useFakeTimers();
    const onNavigation = vi.fn();
    const monitor = monitorPageLifecycle(window, onNavigation);

    window.dispatchEvent(new PageTransitionEvent('pagehide'));

    expect(onNavigation).toHaveBeenCalledOnce();
    monitor.dispose();
    window.dispatchEvent(new PageTransitionEvent('pagehide'));
    expect(onNavigation).toHaveBeenCalledOnce();
  });

  it('ignores ordinary document anchors but detects hash-routed pages', () => {
    vi.useFakeTimers();
    const onNavigation = vi.fn();
    const monitor = monitorPageLifecycle(window, onNavigation, 100);

    window.history.pushState({}, '', '/#section-heading');
    vi.advanceTimersByTime(100);
    expect(onNavigation).not.toHaveBeenCalled();

    window.history.pushState({}, '', '/#/next-route');
    vi.advanceTimersByTime(100);
    expect(onNavigation).toHaveBeenCalledOnce();
    monitor.dispose();
  });
});
