import { defineConfig } from 'wxt';

export default defineConfig({
  srcDir: 'src',
  modules: ['@wxt-dev/module-react'],
  dev: {
    server: {
      port: 3000,
      strictPort: true,
    },
  },
  manifest: {
    name: 'DomLingo - 原页译',
    short_name: 'DomLingo',
    description: '使用你自己的大模型 API，在原网页中翻译英文正文。',
    permissions: ['activeTab', 'scripting', 'storage'],
    optional_host_permissions: ['https://*/*', 'http://localhost/*', 'http://127.0.0.1/*'],
    action: {
      default_title: 'DomLingo - 原页译',
    },
  },
});
