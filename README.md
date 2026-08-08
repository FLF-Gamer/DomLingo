# DomLingo（原页译）

DomLingo 是一个 Chrome 网页翻译扩展。它不要求注册或订阅，由用户配置自己的大模型 API，将英文网页正文翻译为简体中文，并尽量保持原网页的 DOM 结构、CSS 和交互不变。

当前仓库已经完成 M0 工程骨架和 M1 模型配置闭环，正在 M2 特性分支开发静态正文翻译。
详细状态和下一步见[开发路线图](docs/development-roadmap.md)。

## 设计文档

- [产品需求文档（PRD）](docs/product-requirements.md)
- [技术设计文档（TDD）](docs/technical-design.md)
- [项目状态与开发路线图](docs/development-roadmap.md)

## 已确定的技术方向

- Chrome Manifest V3
- TypeScript
- React
- WXT 构建框架
- OpenAI-compatible API
- 无账号、无后端、BYOK（用户自带 API Key）
- 仅翻译正文区域
- 仅修改文本节点和受支持的可见文本属性

## 已确定的产品与发布边界

- 用户已经合法打开公开网页
- 翻译只能由用户主动点击触发
- 译文只显示在用户自己的浏览器中
- 不绕过登录、订阅、付费墙或其他访问控制
- GitHub 公开源代码，采用 Apache-2.0
- 第一阶段通过 GitHub Releases 提供开发者版本
- 稳定后提交 Chrome Web Store，商店版作为普通用户主要安装方式

## 本地开发

环境要求：

- Node.js 22.22.2
- pnpm 11.16.0
- Google Chrome

```bash
pnpm install
pnpm dev
```

完整质量检查：

```bash
pnpm check
```

构建后的 Chrome Manifest V3 扩展位于 `.output/chrome-mv3/`。当前开发遵循
[CONTRIBUTING.md](CONTRIBUTING.md) 中定义的 GitHub Flow。

### 在 Chrome 中加载开发版本

```bash
pnpm build
```

1. 打开 `chrome://extensions`；
2. 开启右上角“开发者模式”；
3. 点击“加载已解压的扩展程序”；
4. 选择本仓库中的 `.output/chrome-mv3/`；
5. 打开 DomLingo Popup，并通过“打开设置”确认 Options 页面可用。

设置页可以配置和测试模型服务，API Key 使用设备密钥在本机加密保存。M2 特性分支的
开发者版本会在“测试连接并保存”时探测当前 Endpoint 与模型支持的 JSON Schema、JSON
Mode 或 Prompt 兼容模式，并允许将并发请求数设为 1 至 3。它已接通正文检测、翻译、停止
和恢复操作，并通过固定页面与单元测试；使用真实模型完成 Chrome 人工验收后，才能视为
稳定功能。
