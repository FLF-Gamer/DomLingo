# DomLingo 图标

`domlingo-icon.png` 为内置图像生成工具制作的透明背景源图。设计使用与现有界面一致的靛蓝色、页面形状的字母 D 和双向翻译箭头。

生产资源位于 `public/icons/`，包括 `16 × 16`、`32 × 32`、`48 × 48` 和 `128 × 128` PNG。Chrome Manifest 的 `icons` 和 `action.default_icon` 显式引用这些资源；弹窗与设置页也使用同一图标。

## 生成提示词

```text
Use case: logo-brand. Asset type: final production Chrome extension icon for DomLingo (原页译), an English-to-Chinese in-place webpage translator. Create a single original flat app icon, not a sheet of alternatives or a mockup. Design: one bold white capital D shaped subtly like an open page, with a small simple translation exchange cue cut into the counter; crisp, balanced, immediately recognizable at 16px. Use the app's existing indigo color #4f46e5 for a rounded-square tile, white for the main mark, with at most one small light-indigo accent. Centered, square canvas, tile occupies around 88 percent of canvas, generous safe padding for Chrome toolbar rendering. Actual transparent background outside the rounded-square tile. No tiny text, no full brand name, no tagline, no extra badges, no browser/device frames, no shadows, no gradients, no 3D, no texture, no watermark. Keep the geometry clean and the silhouette extremely simple for 16/32/48/128px PNG export.
```

## 导出尺寸

源图保留透明度，使用 macOS 自带的 `sips` 等比缩小，不重绘内容。在仓库根目录执行：

```bash
for size in 16 32 48 128; do
  sips -z "$size" "$size" assets/branding/domlingo-icon.png --out "public/icons/icon-$size.png"
done
```

`pnpm build` 将这些文件复制到 `.output/chrome-mv3/icons/`。端到端构建检查会验证 Manifest 路径、PNG 格式和各尺寸。
