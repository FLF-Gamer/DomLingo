import { readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { defineConfig } from 'wxt';

const extensionIcons = {
  16: 'icons/icon-16.png',
  32: 'icons/icon-32.png',
  48: 'icons/icon-48.png',
  128: 'icons/icon-128.png',
};

export default defineConfig({
  srcDir: 'src',
  modules: ['@wxt-dev/module-react'],
  hooks: {
    'build:publicAssets': async (_wxt, files) => {
      for (const directory of ['cmaps', 'standard_fonts', 'wasm']) {
        const root = resolve('node_modules/pdfjs-dist', directory);
        for (const file of await readdir(root)) {
          if (
            directory === 'wasm' &&
            !file.endsWith('_nowasm_fallback.js') &&
            !file.startsWith('LICENSE_')
          )
            continue;
          files.push({
            absoluteSrc: resolve(root, file),
            relativeDest: `pdf-assets/${directory}/${file}`,
          });
        }
      }
      files.push({
        absoluteSrc: resolve('node_modules/pdfjs-dist/LICENSE'),
        relativeDest: 'pdf-assets/LICENSE',
      });
    },
  },
  vite: () => ({
    build: {
      // Chrome may report shared extension chunks as unused cross-world preloads
      // after a popup closes. Static imports still load these chunks normally.
      modulePreload: false,
    },
  }),
  dev: {
    server: {
      port: 3000,
      strictPort: true,
    },
  },
  manifest: {
    name: 'DomLingo - 原页译',
    short_name: 'DomLingo',
    icons: extensionIcons,
    description: '使用你自己的大模型 API，在原网页中翻译英文正文。',
    permissions: ['activeTab', 'contextMenus', 'scripting', 'storage', 'sidePanel'],
    minimum_chrome_version: '116',
    optional_host_permissions: ['https://*/*', 'http://localhost/*', 'http://127.0.0.1/*'],
    action: {
      default_title: 'DomLingo - 原页译',
      default_icon: extensionIcons,
    },
  },
});
