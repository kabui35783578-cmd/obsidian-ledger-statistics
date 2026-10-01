# 记账统计 v2.6.4 · 备注弹窗移动端优化

- 余额校准差额备注改用紧凑卡片布局，标题使用弹窗标题栏，减少重复说明和多余留白。
- 弹窗高度随内容自适应；长备注在卡片内滚动，关闭按钮保留 44px 触控区域。
- 仅对备注弹窗禁用大幅平移，关闭时保留内容高度，避免卡片先塌缩再退出；不改变其他弹窗。
- 类型检查、106 项自动测试及生产构建通过。已在 Obsidian 中核对手机样式与 390px 窄容器布局，未进行实体手机测试。

## BRAT 更新

正式 Latest Release，包含独立的 `main.js`、`manifest.json`、`styles.css` 附件。版本 `2.6.4`，最低 Obsidian 版本仍为 `1.5.12`，支持桌面与移动端。

通过 BRAT 安装的用户可运行 **BRAT: Check for updates to all beta plugins and UPDATE**。若固定了旧版本，请先切换到最新版本。

手动安装可下载 ZIP，将其中三个文件复制到 `.obsidian/plugins/ledger-statistics/` 后重新加载插件。
