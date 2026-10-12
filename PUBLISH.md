# 发布到思源集市（发布指南）

本文说明如何把「等号计算」发布到思源笔记的社区集市（bazaar）。
规则依据 [siyuan-note/bazaar](https://github.com/siyuan-note/bazaar) 的
`README.zh-CN.md` 与 `rules/*.go`（自动检查用的实际判定代码）。

---

## 0. 一句话流程

1. 建一个 GitHub 仓库（仓库名 = `plugin.json` 的 `name`，分支用 `main`）
2. 改好 `plugin.json` 里的 `author` 和 `url`，重新打包
3. 发一个 Release，**Tag = 版本号**，附件上传 `package.zip`
4. Fork [siyuan-note/bazaar](https://github.com/siyuan-note/bazaar)，在 `plugins.txt` 里加一行 `你的用户名/仓库名`
5. 向 `main` 提 PR，等自动检查 + 人工审核通过后合并
6. 合并后几分钟内集市索引更新，**重启思源**即可在集市里搜到

---

## 1. 准备仓库

```bash
# 仓库名必须和 plugin.json 的 name 一致，这里就是 plugin-calc
git init
git add .
git commit -m "Initial commit"
git branch -M main
git remote add origin https://github.com/<你的用户名>/plugin-calc.git
git push -u origin main
```

仓库里应该提交**源码**（`src/`、`test/`、`tools/`、`build.mjs` 等），
`package.zip` 属于构建产物，放在 Release 附件里即可，不必提交（也可以提交，但没必要）。

### 填上你自己的用户名

`plugin.json` 里已经填好 `pisceswb`：

| 字段 | 值 |
| --- | --- |
| `name` | `plugin-calc`（必须与 GitHub 仓库名一致） |
| `author` | `pisceswb` |
| `url` | `https://github.com/pisceswb/plugin-calc` |
| `version` | `0.2.0`（合法语义化版本，**不能带 `v` 前缀**） |

如果要换账号或改仓库名，跑：

```bash
node tools/set-repo.mjs <你的GitHub用户名> [仓库名]
```

### 仓库根必须有 LICENSE

集市 PR Check 会检查**仓库根目录**（不是 `package.zip` 内部）是否存在
`LICENSE` 或 `LICENSE.txt`。本仓库已经在根目录放好 MIT 的 `LICENSE`，
**记得把它一起提交推送**——只放进 `package.zip` 不算。

`preflight.mjs` 会一起检查这一项，包括 LICENSE 是否内容过短。


---

## 2. 打包并自检

```bash
node build.mjs          # 由 src/ 生成 index.js
node tools/pack.mjs     # 生成 package.zip
node tools/verify-zip.mjs   # 校验 zip 结构
node tools/preflight.mjs    # 按集市规则自检（重要）
```

`preflight.mjs` 会按集市的实际校验规则检查这些内容，**在提 PR 前就能发现问题**：

- 包根必要文件：`README.md`、`plugin.json`、`index.js`（文件名大小写敏感）
- 清单字段白名单与必填字段
- `version` / `minAppVersion` 是否合法语义化版本
- `icon` / `preview` 是否存在、格式受支持、体积不超限（图标 ≤ 64 KiB，预览图 ≤ 512 KiB）
- `backends` / `frontends` / `kernels` 取值是否合法（含 `all` 时不能混其它值）
- 路径是否命中 Windows 保留设备名、是否有首尾空格

`package.zip` 至少要有这些文件，且**都在包根**（不能再套一层目录）：

```
plugin.json
index.js
index.css
icon.png
preview.png
i18n/zh-CN.json
i18n/en.json
README.md
README.en.md
```

---

## 3. 发 Release

在 GitHub 仓库页面 → **Releases** → **Draft a new release**：

- **Choose a tag**：填 `0.2.0`，点「Create new tag on publish」
  - Tag **必须等于** `plugin.json` 里的 `version`（不要写 `v0.2.0`）
- **Release title**：`0.2.0`（随意，一般同 Tag）
- **Attach binaries**：把 `package.zip` 拖进去
- 点 **Publish release**

> 集市索引拉取的是该仓库的 **Latest Release** 里的 `package.zip`。
> 没有 Release 或附件里没有 `package.zip`，PR 检查必然失败。
>
> **修改过代码或清单后，一定要发新的 Release 并把 version 提高**，
> 只改仓库文件而沿用旧 Release 是没用的：检查读的是 Release 里的 `package.zip`。

---

## 4. 提交到集市

1. **Fork** [siyuan-note/bazaar](https://github.com/siyuan-note/bazaar)
   （已经 Fork 过就先同步最新代码）

2. 在 `plugins.txt` **末尾新增一行**，格式为 `owner/repo`：

   ```
   siyuan-note/plugin-sample
   someone/another-plugin
   pisceswb/plugin-calc        ← 新增这一行
   ```

   注意：
   - 每行一个，**不要有多余逗号或空行**
   - 一个 PR 只加一个包，不要夹带其它改动（比如顺手删别的行）

3. **提交 PR** 到 `siyuan-note/bazaar` 的 `main` 分支

   - 分支名建议 `add-plugin-plugin-calc`
   - 标题建议 `Add pisceswb/plugin-calc`
   - 正文按仓库里的 `.github/PULL_REQUEST_TEMPLATE.md` 填写，末尾附上仓库地址

4. **等待检查与合并**

   - PR Check 工作流会自动校验：Release 是否存在、`package.zip` 里文件是否齐全、清单字段是否合法等
   - 检查失败**不要重新开 PR**，直接在原 PR 里改。修好包仓库后，定时任务约每 20 分钟会复检并更新评论
   - 维护者也会人工审核

5. 合并后集市索引在几分钟内更新，**重启一次思源**即可在集市看到

---

## 5. 以后更新版本

**不需要再提 PR**。只要：

1. 把 `plugin.json` 的 `version` 提高（例如 `0.2.0` → `0.2.1`）
2. `node build.mjs && node tools/pack.mjs && node tools/preflight.mjs`
3. 发布一个**新的 Latest Release**，Tag 用新版本号，附件上传新的 `package.zip`

集市索引会每一到三小时自动更新。如果长时间没更新：

- 确认 `version` 确实提高了（**不提版本号是最常见的失败原因**）
- 看 [Stage 检查失败 Issue](https://github.com/siyuan-note/bazaar/issues?q=is%3Aissue%20is%3Aopen%20label%3Astage-fail) 里有没有你的仓库
- 看 [Stage 工作流日志](https://github.com/siyuan-note/bazaar/actions/workflows/stage.yml)

---

## 6. 本次已经帮你排掉的坑

发布前我按 `rules/*.go` 逐条核对过，有两点如果留着会直接导致集市检查失败或体验异常，已经处理：

1. **删掉了 `publish` 字段**
   原来的清单里有 `"publish": { "data": ["readonlyText"] }`，那是从官方示例插件抄来的。
   我们并没有实现公开快照（没用 `savePublishData` / `loadPublishData`），
   留着等于向管理员申请一个用不到的“公开数据授权”，属于误导配置。

2. **删掉了 `funding` 字段**
   原值指向 `plugin-sample` 仓库的赞助链接，发布出去会变成替别人的项目拉赞助。

另外还做了两处调整：

3. **去掉了 `kernels` 字段**：本插件没有 `kernel.js`，声明内核支持是不准确的。
   保留 `backends` / `frontends` 的 `["all"]`（含义是“不限制”，且 `all` 不能与其它值混用）。

4. **补了 `preview.png`**（1024×768，集市列表预览图，112 KiB < 512 KiB 上限）。

---

## 7. 检查清单

提 PR 之前逐条确认：

- [ ] `plugin.json` 的 `author` 是**你自己**的 GitHub 用户名（当前 `pisceswb`）
- [ ] `plugin.json` 的 `url` 指向**你自己**的仓库
- [ ] `plugin.json` 的 `name` 与 GitHub 仓库名**完全一致**（当前 `plugin-calc`）
- [ ] **仓库根目录有 `LICENSE` 或 `LICENSE.txt`**，并且已提交推送
- [ ] 默认分支是 `main`
- [ ] 已发布 Release，且 **Latest Release** 的附件里有 `package.zip`
- [ ] Release Tag = `plugin.json` 的 `version`，且**不带 `v` 前缀**
- [ ] 改动过代码后**提高了 version** 并发了新 Release
- [ ] `node tools/preflight.mjs` 通过
- [ ] `plugins.txt` 只加了一行 `owner/repo`，没有多余改动
- [ ] 仓库里没有把 `node_modules`、临时文件之类提交进去

---

## 8. 规则来源

- 集市提交说明：[bazaar/README.zh-CN.md](https://github.com/siyuan-note/bazaar/blob/main/README.zh-CN.md)
- 自动校验实现：[bazaar/rules](https://github.com/siyuan-note/bazaar/tree/main/rules)
  - `files.go`：包根必要文件
  - `manifest.go`：清单字段与取值
  - `images.go`：`icon` / `preview` 校验
  - `names.go`：路径命名规范
  - `zip.go`：压缩包结构
- 插件开发规范：[plugin-sample/README.zh-CN.md](https://github.com/siyuan-note/plugin-sample/blob/main/README.zh-CN.md)
