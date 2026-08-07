import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

import { expect, test } from '@playwright/test';

test('Chrome build output exists before extension smoke tests run', () => {
  const manifestPath = resolve(process.cwd(), '.output/chrome-mv3/manifest.json');

  expect(existsSync(manifestPath), 'Run `pnpm build` before running the extension E2E suite.').toBe(
    true,
  );
});
