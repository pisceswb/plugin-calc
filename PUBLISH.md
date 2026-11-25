# 构建、发布与官方集市更新

## 本地验证

项目只有 Node.js 内置模块依赖，使用 Node.js 22：

```bash
npm test
npm run package
```

`npm test` 会从 `src/` 重新生成 `index.js` 并运行全部测试。`npm run package` 会生成并校验两种 ZIP：

- `plugin-calc.zip`：手动安装包，ZIP 内带一层 `plugin-calc/` 目录。
- `package.zip`：官方集市包，`plugin.json`、`index.js`、`index.css`、README 等直接位于 ZIP 根目录。

两个 ZIP 都是构建产物，不提交到 Git。

## 自动发布

同步提高 `plugin.json` 和 `package.json` 的版本号，提交并推送到 `main`，再推送对应标签：

```bash
git tag v0.5.0
git push origin v0.5.0
```

`.github/workflows/build-release.yml` 会在以下情况运行：

- 推送到 `main`：构建、测试、打包并上传 Workflow 产物，不创建 Release。
- 推送 `v*` 标签：额外创建同名 GitHub Release，并上传 `plugin-calc.zip` 和 `package.zip`。
- 手动触发：只构建和上传 Workflow 产物。

标签必须是 `v` 加两个清单中的版本号。重复推送已有 Release 的标签时，Workflow 会覆盖同名附件。

## 官方集市

官方 `plugins.txt` 已包含：

```text
pisceswb/plugin-calc
```

本仓库是该官方插件的 fork。根据 Bazaar 规则，插件名不能重复，提交者也必须是作者或获得作者授权，因此不能再添加 `ljq29/plugin-calc`，也不能在没有原作者确认时发起维护者变更。

增强功能应通过 `ljq29/plugin-calc` 向 `pisceswb/plugin-calc` 提交 PR。原作者合并并发布新的 Latest Release 后，官方集市会在常规索引更新中自动拉取新版本，无需修改 Bazaar。

如果以后原作者明确同意移交维护，再按 [Bazaar 维护者变更规则](https://github.com/siyuan-note/bazaar#changing-maintainers)单独提交 PR，并在该 PR 中取得原作者确认。

规则来源：

- [插件打包与上架说明](https://github.com/siyuan-note/plugin-sample#list-on-the-marketplace)
- [Bazaar 收录与更新规则](https://github.com/siyuan-note/bazaar#submitting-a-bazaar-package)
