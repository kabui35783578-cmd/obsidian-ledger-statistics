# 记账统计 v2.6.5 · 修复备注弹窗关闭闪烁

- 修复移动端关闭余额校准差额备注时闪烁、停顿后才退出的问题。
- 备注弹窗跳过默认手机端进出动画及遮罩动画等待，直接关闭；保留 Obsidian 的原生弹窗清理和焦点恢复流程，不影响其他弹窗。
- 保留紧凑布局、多行备注和长内容滚动。
- 类型检查、107 项自动测试及生产构建通过；尚未进行实体手机测试。

## BRAT 更新

正式 Latest Release，包含独立的 `main.js`、`manifest.json`、`styles.css` 附件。版本 `2.6.5`，最低 Obsidian 版本仍为 `1.5.12`，支持桌面与移动端。

通过 BRAT 安装的用户可运行 **BRAT: Check for updates to all beta plugins and UPDATE**。若固定了旧版本，请先切换到最新版本。

手动安装可下载 ZIP，将其中三个文件复制到 `.obsidian/plugins/ledger-statistics/` 后重新加载插件。
