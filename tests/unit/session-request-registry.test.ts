import { describe, expect, it } from 'vitest';

import { SessionRequestRegistry } from '../../src/background/session-request-registry';

describe('SessionRequestRegistry', () => {
  it('cancels every live request associated with a closed or navigating tab', () => {
    const registry = new SessionRequestRegistry();
    const first = new AbortController();
    const second = new AbortController();
    const otherTab = new AbortController();

    expect(registry.register('session-a', 7, first)).toBe(true);
    expect(registry.register('session-a', 7, second)).toBe(true);
    expect(registry.register('session-b', 8, otherTab)).toBe(true);

    expect(registry.cancelTab(7)).toBe(1);
    expect(first.signal.aborted).toBe(true);
    expect(second.signal.aborted).toBe(true);
    expect(otherTab.signal.aborted).toBe(false);
    expect(registry.cancelTab(7)).toBe(0);
    expect(registry.register('session-a', 7, new AbortController())).toBe(false);
  });

  it('keeps a session registered until its last concurrent request completes', () => {
    const registry = new SessionRequestRegistry();
    const first = new AbortController();
    const second = new AbortController();

    registry.register('session', 3, first);
    registry.register('session', 3, second);
    registry.unregister('session', first);

    expect(registry.cancelSession('session', 3)).toBe(true);
    expect(first.signal.aborted).toBe(false);
    expect(second.signal.aborted).toBe(true);
  });

  it('rejects a session ID reused by a different tab', () => {
    const registry = new SessionRequestRegistry();

    expect(registry.register('shared-session', 1, new AbortController())).toBe(true);
    expect(registry.register('shared-session', 2, new AbortController())).toBe(false);
    expect(registry.cancelSession('shared-session', 2)).toBe(false);
  });
});
