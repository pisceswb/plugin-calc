/*!
 * 填入 GitHub 用户名与仓库名：node tools/set-repo.mjs <用户名> [仓库名]
 *
 * 集市要求 plugin.json 的 url 指向你自己的仓库，author 建议与 GitHub 用户名一致。
 * 这个脚本把占位符（YourGitHubName / plugin-calc）替换成实际值。
 *
 * 例：node tools/set-repo.mjs zhangsan
 *     -> author: zhangsan
 *     -> url:    https://github.com/zhangsan/plugin-calc
 *
 * 例：node tools/set-repo.mjs zhangsan siyuan-calc
 *     -> 仓库名也一起改（注意：仓库名必须与 plugin.json 的 name 一致，
 *        所以同时会把 name 改成 siyuan-calc）
 */

import {readFileSync, writeFileSync} from "node:fs";
import {dirname, join, resolve} from "node:path";
import {fileURLToPath} from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const [, , owner, repo] = process.argv;

if (!owner) {
    console.error("用法：node tools/set-repo.mjs <GitHub 用户名> [仓库名]");
    process.exit(1);
}
if (!/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/.test(owner)) {
    console.error(`GitHub 用户名格式看起来不对：${owner}`);
    process.exit(1);
}

const pluginJsonPath = join(root, "plugin.json");
const pluginJson = JSON.parse(readFileSync(pluginJsonPath, "utf8"));

const previousName = pluginJson.name;
const repoName = repo || pluginJson.name;
if (!/^[A-Za-z0-9._-]+$/.test(repoName)) {
    console.error(`仓库名格式看起来不对：${repoName}（建议只用字母、数字、-、_、.）`);
    process.exit(1);
}

pluginJson.name = repoName;
pluginJson.author = owner;
pluginJson.url = `https://github.com/${owner}/${repoName}`;

writeFileSync(pluginJsonPath, JSON.stringify(pluginJson, null, 2) + "\n", "utf8");

console.log("已更新 plugin.json：");
console.log(`  name   : ${previousName} -> ${pluginJson.name}`);
console.log(`  author : ${pluginJson.author}`);
console.log(`  url    : ${pluginJson.url}`);

if (repoName !== previousName) {
    console.log("");
    console.log("提示：name 变了，本地开发目录名也应与之一致（集市要求仓库名 = name）。");
}
console.log("");
console.log("下一步：重新打包并自检");
console.log("  node build.mjs && node tools/pack.mjs && node tools/preflight.mjs");
