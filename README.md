# DomLingo（原页译）

DomLingo 是一个 Chrome 网页翻译扩展。它不要求注册或订阅，由用户配置自己的大模型 API，将英文网页正文翻译为简体中文，并尽量保持原网页的 DOM 结构、CSS 和交互不变。

当前仓库已经完成 M0 工程骨架并进入 M1：模型设置、域名权限与 Provider
连接。正文翻译闭环将在 M2 实现。详细状态和下一步见[开发路线图](docs/development-roadmap.md)。

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

M0 的按钮处于禁用状态是预期行为；翻译设置将在 M1 实现，正文翻译闭环将在
M2 实现。
