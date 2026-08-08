import type { ContentCommandMessage } from '../messaging/protocol';
import { monitorPageLifecycle } from '../content/page-lifecycle';
import { TranslationProgressOverlay } from '../content/progress-overlay';
import { PageTranslationSession } from '../content/translation-session';

export default defineUnlistedScript(() => {
  const overlay = new TranslationProgressOverlay(document, {
    onStop: () => session.stop(),
    onRetry: () => session.retryFailed(),
    onRestore: () => session.restore(),
  });
  const session = new PageTranslationSession(document, (status) => overlay.update(status));
  monitorPageLifecycle(window, () => session.invalidateForNavigation());

  chrome.runtime.onMessage.addListener((message: unknown, sender, sendResponse) => {
    if (sender.id !== chrome.runtime.id || typeof message !== 'object' || message === null) {
      return false;
    }

    const command = message as Partial<ContentCommandMessage>;
    switch (command.type) {
      case 'CONTENT_PING':
      case 'CONTENT_GET_STATUS':
        sendResponse(session.getStatus());
        return false;
      case 'CONTENT_START_TRANSLATION':
      case 'CONTENT_RETRY_FAILED':
        if (
          command.options &&
          typeof command.options.batchCharacterLimit === 'number' &&
          typeof command.options.concurrency === 'number'
        ) {
          if (command.type === 'CONTENT_START_TRANSLATION') {
            session.start(command.options);
          } else {
            session.retryFailed(command.options);
          }
          sendResponse(session.getStatus());
        }
        return false;
      case 'CONTENT_STOP_TRANSLATION':
        sendResponse(session.stop());
        return false;
      case 'CONTENT_RESTORE_ORIGINAL':
        sendResponse(session.restore());
        return false;
      default:
        return false;
    }
  });
});
