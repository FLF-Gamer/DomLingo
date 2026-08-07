# Contributing to DomLingo

感谢你参与 DomLingo。项目采用 GitHub Flow：`main` 始终保持可构建和可发布，所有改动都在短生命周期分支中完成，并通过 Pull Request 合并。

## 1. 开始之前

1. 阅读[产品需求文档](docs/product-requirements.md)、[技术设计文档](docs/technical-design.md)和[开发路线图](docs/development-roadmap.md)。
2. 确认改动对应一个 Issue、路线图任务或明确的问题说明。
3. 一个分支只解决一个主题，不把无关格式化或重构混入功能改动。
4. 不提交 API Key、真实用户网页内容、浏览器 Profile、翻译缓存或其他敏感数据。

## 2. GitHub Flow

```text
main
  └─ feature/fix/docs branch
       ├─ implementation
       ├─ local checks
       ├─ Pull Request
       ├─ CI and review
       └─ squash merge → main
```

标准流程：

1. 从最新 `main` 创建分支；
2. 在分支中完成一个独立改动；
3. 同步测试、文档和变更说明；
4. 在本地运行全部必要检查；
5. 创建 Draft PR，说明范围、数据流和测试方式；
6. 功能完成后转为 Ready for review；
7. 所有必需检查通过、讨论解决后合并；
8. 默认使用 squash merge；
9. 合并后删除特性分支。

禁止直接向 `main` 开发或提交功能。紧急修复也必须使用 `fix/*` 分支和 PR。

## 3. 分支命名

普通贡献分支：

```text
feat/<short-description>
fix/<short-description>
docs/<short-description>
refactor/<short-description>
test/<short-description>
chore/<short-description>
release/<version>
```

由 Codex 创建的分支增加 `codex/` 前缀：

```text
codex/feat/project-foundation
codex/feat/provider-settings
codex/fix/stale-node-write
```

规则：

- 使用小写英文和连字符；
- 名称描述用户可理解的单一目标；
- 不使用个人姓名、日期或模糊名称，如 `work`、`update`、`test1`。

## 4. 提交格式

提交信息采用 Conventional Commits 风格：

```text
feat: add OpenAI-compatible provider settings
fix: prevent stale responses from updating detached nodes
docs: record GitHub release workflow
test: cover dynamic content deduplication
chore: configure TypeScript strict mode
```

允许的主要类型：

- `feat`：新功能；
- `fix`：缺陷修复；
- `docs`：只修改文档；
- `refactor`：不改变行为的重构；
- `test`：测试；
- `perf`：性能改进；
- `build`：构建系统或依赖；
- `ci`：CI 配置；
- `chore`：维护工作。

提交应当保持可理解、可审查。不要把整个里程碑压成一个无法审查的工作提交；最终 PR 仍使用 squash merge形成一个清晰的 `main` 提交。

## 5. Pull Request 要求

每个 PR 必须：

- 说明解决的问题和不包含的范围；
- 关联 Issue、PRD 编号或路线图任务；
- 列出测试命令和人工验证结果；
- UI 变化提供截图或录屏；
- 权限、密钥、缓存或网页数据流变化提供安全说明；
- 更新受影响的 PRD、TDD、路线图和 CHANGELOG；
- 不包含真实 API Key、用户正文或本地绝对路径；
- 保持构建产物可由源码重复生成。

以下情况应保持 Draft：

- P0 功能尚未完成；
- 测试尚未通过；
- 数据流或权限设计仍待确认；
- 包含临时代码、调试开关或已知密钥风险。

## 6. 必需检查

工程初始化后，每个 PR 至少运行：

```text
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

修改正文识别、DOM 写回、动态页面、权限、存储或 Provider 时，还必须运行相关集成测试。涉及用户主流程的改动必须运行 Playwright 端到端测试。

CI 名称和命令在 M0 完成后以 `package.json` 与 GitHub Actions 为准；文档不得与实际脚本长期不一致。

## 7. 审查重点

审查按以下优先级进行：

1. 用户数据、API Key、权限和内容访问边界；
2. DOM 结构、网页交互和恢复原文能力；
3. 正确性、失败隔离和 Service Worker 生命周期；
4. 自动化测试与回归风险；
5. 性能、可维护性和界面体验。

不得仅因代码风格问题阻塞安全或正确性修复；风格应交给自动化工具统一处理。

## 8. 合并规则

- 默认 squash merge；
- PR 标题必须符合提交格式，并成为 squash 后的提交标题；
- 合并前解决所有阻塞讨论；
- 不允许 force-push `main`；
- 不允许将失败、跳过或未运行的必需检查视为通过；
- 有其他维护者时至少需要 1 个批准；
- 项目早期只有一名维护者时，可以在全部检查通过并完成自审清单后合并；
- Release 只能从 `main` 上已通过 CI 的标签生成。

## 9. GitHub 分支保护建议

远程仓库创建后，为 `main` 启用：

- Require a pull request before merging；
- Require status checks to pass；
- Require conversation resolution；
- Require linear history；
- Block force pushes；
- Block deletions；
- 自动删除已合并分支。

项目早期可以不强制 Code Owner 审批；出现第二名维护者后启用至少 1 个批准。

## 10. 发布流程

- `0.1.x-alpha`、`0.2.x-beta`：GitHub Releases 开发者版本；
- `0.9.x`：GitHub Release 与 Chrome Web Store Unlisted；
- `1.0.0`：GitHub Release 与 Chrome Web Store Public；
- 发布 PR 只允许版本、变更日志、发布材料和必要修复，不混入新功能；
- 发布标签必须与对应构建和校验值可追溯。

## 11. 安全问题

不要通过公开 Issue 提交 API Key、包含私人正文的日志或可利用的未修复安全细节。远程仓库建立后，以 `SECURITY.md` 中的私密报告方式为准。
