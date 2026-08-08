import { describe, expect, it, vi } from 'vitest';

import {
  registerTabLifecycleCancellation,
  type TabLifecycleEvents,
} from '../../src/background/tab-lifecycle';

describe('tab lifecycle cancellation', () => {
  it('cancels on tab removal and top-level loading, but not ordinary updates', () => {
    let onRemoved: ((tabId: number) => void) | undefined;
    let onUpdated: ((tabId: number, changeInfo: { status?: string }) => void) | undefined;
    const tabs: TabLifecycleEvents = {
      onRemoved: {
        addListener: (callback) => {
          onRemoved = callback;
        },
      },
      onUpdated: {
        addListener: (callback) => {
          onUpdated = callback;
        },
      },
    };
    const cancelTabSessions = vi.fn();

    registerTabLifecycleCancellation(tabs, cancelTabSessions);
    onUpdated?.(11, { status: 'complete' });
    onUpdated?.(12, { status: 'loading' });
    onUpdated?.(13, {});
    onRemoved?.(14);

    expect(cancelTabSessions.mock.calls).toEqual([[12], [14]]);
  });
});
