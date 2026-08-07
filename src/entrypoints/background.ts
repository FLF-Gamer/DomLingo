const TRUSTED_CONTEXTS = { accessLevel: 'TRUSTED_CONTEXTS' } as const;

async function restrictStorageAccess(): Promise<void> {
  await Promise.all([
    chrome.storage.local.setAccessLevel(TRUSTED_CONTEXTS),
    chrome.storage.sync.setAccessLevel(TRUSTED_CONTEXTS),
    chrome.storage.session.setAccessLevel(TRUSTED_CONTEXTS),
  ]);
}

export default defineBackground(() => {
  void restrictStorageAccess().catch((error: unknown) => {
    console.error('[DomLingo] Unable to restrict extension storage access.', error);
  });
});
