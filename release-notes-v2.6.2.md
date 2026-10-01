# 记账统计 v2.6.2

- 修复点击“数据核验”后页面跳回顶部的问题：仅展开／收起核验面板，不再重绘整个统计页面。
- 保留核验按钮及其展开状态，异常记录的“打开来源”功能不变。
- 类型检查、104 项自动测试及生产构建通过。

## BRAT 更新

本版本为正式 Latest Release，包含独立的 `main.js`、`manifest.json`、`styles.css` 附件；插件版本为 `2.6.2`，最低 Obsidian 版本仍为 `1.5.12`，支持桌面与移动端。

已通过 BRAT 安装的用户可执行 **BRAT: Check for updates to all beta plugins and UPDATE**。若固定了旧版本，请先切换到最新版本。

手动安装用户可下载 ZIP，将其中三个文件复制到 `.obsidian/plugins/ledger-statistics/`，然后重新加载插件。
