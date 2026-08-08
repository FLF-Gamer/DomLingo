interface TabRemovedEvent {
  addListener(callback: (tabId: number) => void): void;
}

interface TabUpdatedEvent {
  addListener(callback: (tabId: number, changeInfo: { status?: string }) => void): void;
}

export interface TabLifecycleEvents {
  onRemoved: TabRemovedEvent;
  onUpdated: TabUpdatedEvent;
}

export function registerTabLifecycleCancellation(
  tabs: TabLifecycleEvents,
  cancelTabSessions: (tabId: number) => void,
): void {
  tabs.onRemoved.addListener((tabId) => cancelTabSessions(tabId));
  tabs.onUpdated.addListener((tabId, changeInfo) => {
    if (changeInfo.status === 'loading') cancelTabSessions(tabId);
  });
}
