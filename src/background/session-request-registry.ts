export class SessionRequestRegistry {
  private static readonly MAX_CANCELLED_SESSION_IDS = 500;
  private readonly activeRequests = new Map<string, Set<AbortController>>();
  private readonly sessionTabs = new Map<string, number>();
  private readonly cancelledSessionIds = new Set<string>();
  private readonly cancelledSessionOrder: string[] = [];

  register(sessionId: string, tabId: number, controller: AbortController): boolean {
    if (this.cancelledSessionIds.has(sessionId)) return false;
    const existingTabId = this.sessionTabs.get(sessionId);
    if (existingTabId !== undefined && existingTabId !== tabId) return false;

    this.sessionTabs.set(sessionId, tabId);
    const controllers = this.activeRequests.get(sessionId) ?? new Set<AbortController>();
    controllers.add(controller);
    this.activeRequests.set(sessionId, controllers);
    return true;
  }

  unregister(sessionId: string, controller: AbortController): void {
    const controllers = this.activeRequests.get(sessionId);
    controllers?.delete(controller);
    if (controllers?.size === 0) {
      this.activeRequests.delete(sessionId);
      this.sessionTabs.delete(sessionId);
    }
  }

  cancelSession(sessionId: string, tabId: number): boolean {
    if (this.sessionTabs.get(sessionId) !== tabId) return false;
    for (const controller of this.activeRequests.get(sessionId) ?? []) controller.abort();
    this.activeRequests.delete(sessionId);
    this.sessionTabs.delete(sessionId);
    this.rememberCancellation(sessionId);
    return true;
  }

  cancelTab(tabId: number): number {
    const sessionIds = [...this.sessionTabs.entries()].flatMap(([sessionId, sessionTabId]) =>
      sessionTabId === tabId ? [sessionId] : [],
    );
    for (const sessionId of sessionIds) this.cancelSession(sessionId, tabId);
    return sessionIds.length;
  }

  private rememberCancellation(sessionId: string): void {
    if (this.cancelledSessionIds.has(sessionId)) return;
    this.cancelledSessionIds.add(sessionId);
    this.cancelledSessionOrder.push(sessionId);
    if (this.cancelledSessionOrder.length <= SessionRequestRegistry.MAX_CANCELLED_SESSION_IDS) {
      return;
    }
    const expired = this.cancelledSessionOrder.shift();
    if (expired) this.cancelledSessionIds.delete(expired);
  }
}
