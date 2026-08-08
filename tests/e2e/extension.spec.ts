import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { expect, test } from '@playwright/test';

test('Chrome build output exists before extension smoke tests run', () => {
  const manifestPath = resolve(process.cwd(), '.output/chrome-mv3/manifest.json');

  expect(existsSync(manifestPath), 'Run `pnpm build` before running the extension E2E suite.').toBe(
    true,
  );
});

test('extension features use narrow Chrome permissions', () => {
  const manifestPath = resolve(process.cwd(), '.output/chrome-mv3/manifest.json');
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
    permissions?: string[];
  };

  expect(manifest.permissions).toEqual(['activeTab', 'contextMenus', 'scripting', 'storage']);
  expect(manifest.permissions).not.toContain('tabs');
  expect(manifest.permissions).not.toContain('webNavigation');
});

test('extension pages do not preload shared chunks across Chrome worlds', () => {
  for (const page of ['popup.html', 'options.html']) {
    const htmlPath = resolve(process.cwd(), '.output/chrome-mv3', page);

    expect(readFileSync(htmlPath, 'utf8')).not.toContain('rel="modulepreload"');
  }
});
