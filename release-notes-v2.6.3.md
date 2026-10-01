# 记账统计 v2.6.3 · 余额校准差额备注

- 在插件设置 → 余额校准中新增“余额校准差额备注”，支持多行文字并自动保存，用于记录差额资金的大致去向。
- 点击桌面工资瀑布图的“余额校准差额”或手机端对应条目，即可弹出备注；支持键盘 Enter / 空格操作。
- 未填写备注时显示设置路径提示。备注只作文字说明，不影响消费统计、余额计算或 AI 判断；重新校准或进入新周期后仍会保留，请按需更新。
- 类型检查、106 项自动测试及生产构建通过。

## BRAT 更新

本版本为正式 Latest Release，包含 BRAT 所需的独立 `main.js`、`manifest.json`、`styles.css` 附件。插件版本为 `2.6.3`，最低 Obsidian 版本为 `1.5.12`，支持桌面与移动端。

已通过 BRAT 安装的用户可执行 **BRAT: Check for updates to all beta plugins and UPDATE**；若固定了旧版本，请先切换到最新版本。

手动安装可下载 ZIP，将三个文件复制到 `.obsidian/plugins/ledger-statistics/` 后重新加载插件。
