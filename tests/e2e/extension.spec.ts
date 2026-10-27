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

test('extension and toolbar icons are packaged at their declared PNG sizes', () => {
  const output = resolve(process.cwd(), '.output/chrome-mv3');
  const manifest = JSON.parse(readFileSync(resolve(output, 'manifest.json'), 'utf8')) as {
    icons: Record<string, string>;
    action: { default_icon: Record<string, string> };
  };

  expect(manifest.action.default_icon).toEqual(manifest.icons);
  expect(Object.keys(manifest.icons).sort()).toEqual(['128', '16', '32', '48']);
  for (const [size, path] of Object.entries(manifest.icons)) {
    const png = readFileSync(resolve(output, path));
    expect(png.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
    expect(png.readUInt32BE(16)).toBe(Number(size));
    expect(png.readUInt32BE(20)).toBe(Number(size));
  }

  for (const page of ['popup.html', 'options.html']) {
    expect(readFileSync(resolve(output, page), 'utf8')).toContain('icons/icon-32.png');
  }
});
