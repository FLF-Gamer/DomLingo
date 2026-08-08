export interface PageLifecycleMonitor {
  dispose(): void;
}

function routeKey(location: Location): string {
  const hashRoute = /^#(?:!|\/)/.test(location.hash) ? location.hash : '';
  return `${location.origin}${location.pathname}${location.search}${hashRoute}`;
}

export function monitorPageLifecycle(
  view: Window,
  onNavigation: () => void,
  pollIntervalMs = 250,
): PageLifecycleMonitor {
  let currentRoute = routeKey(view.location);
  let disposed = false;
  const checkUrl = (): void => {
    const nextRoute = routeKey(view.location);
    if (disposed || nextRoute === currentRoute) return;
    currentRoute = nextRoute;
    onNavigation();
  };
  const handlePageHide = (): void => {
    if (!disposed) onNavigation();
  };

  view.addEventListener('popstate', checkUrl);
  view.addEventListener('hashchange', checkUrl);
  view.addEventListener('pagehide', handlePageHide);
  const safePollInterval = Number.isFinite(pollIntervalMs)
    ? Math.max(100, Math.floor(pollIntervalMs))
    : 250;
  const timer = view.setInterval(checkUrl, safePollInterval);

  return {
    dispose: () => {
      if (disposed) return;
      disposed = true;
      view.clearInterval(timer);
      view.removeEventListener('popstate', checkUrl);
      view.removeEventListener('hashchange', checkUrl);
      view.removeEventListener('pagehide', handlePageHide);
    },
  };
}
