/*!
 * 集市规范预检：node tools/preflight.mjs
 *
 * 按思源社区集市（siyuan-note/bazaar）的校验规则，对 package.zip 做本地自检，
 * 尽量在提 PR 之前发现问题。规则来源：bazaar 仓库 rules/*.go。
 *
 * 覆盖：
 *   - 包根必要文件（README.md、plugin.json、index.js，文件名大小写敏感）
 *   - 清单字段白名单与必填项
 *   - version / minAppVersion 语义化版本
 *   - icon / preview 必须存在、格式受支持、体积不超限
 *   - backends / frontends / kernels 的取值与 "all" 互斥
 *   - 路径不得命中 Windows 保留设备名、不得有首尾空格
 *
 * 用法：node tools/preflight.mjs [--author <GitHub 用户名>]
 */

import {readFileSync, existsSync, statSync} from "node:fs";
import {dirname, join, resolve} from "node:path";
import {fileURLToPath} from "node:url";
import {inflateRawSync} from "node:zlib";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/* ------------------------------------------------------------------ *
 * 规则（与 bazaar/rules 对齐）
 * ------------------------------------------------------------------ */

const COMMON_KEYS = [
    "name", "author", "url", "version",
    "displayName", "description", "readme", "icon", "preview",
    "funding", "keywords",
    "minAppVersion"
];
const PLUGIN_KEYS = [
    ...COMMON_KEYS,
    "backends", "frontends", "kernels", "bootAppearances",
    "disabledInPublish", "settingsWindow", "publish"
];

const REQUIRED_FILES = ["README.md", "plugin.json", "index.js"];

const IMAGE_SPECS = [
    {field: "icon", legacy: "icon.png", maxBytes: 64 * 1024},
    {field: "preview", legacy: "preview.png", maxBytes: 512 * 1024}
];

const IMAGE_EXTENSIONS = [".png", ".jpg", ".jpeg", ".webp", ".avif"];

const RESERVED_DEVICE_NAMES = new Set([
    "CON", "PRN", "AUX", "NUL",
    "COM1", "COM2", "COM3", "COM4", "COM5", "COM6", "COM7", "COM8", "COM9",
    "LPT1", "LPT2", "LPT3", "LPT4", "LPT5", "LPT6", "LPT7", "LPT8", "LPT9"
]);

const ARRAY_FIELDS_WITH_ALL = ["backends", "frontends", "kernels"];

/* ------------------------------------------------------------------ *
 * 小工具
 * ------------------------------------------------------------------ */

const issues = [];
const notes = [];
const fail = (message) => issues.push(message);
const note = (message) => notes.push(message);

/** 语义化版本（允许 1.0.0 / 1.0.0-beta.1，不允许 v 前缀） */
const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-.]+)?(?:\+[0-9A-Za-z-.]+)?$/;

const checkSemver = (label, value, required) => {
    if (value === undefined) {
        if (required) {
            fail(`${label} 缺失`);
        }
        return;
    }
    if (typeof value !== "string" || value.trim() !== value || value === "") {
        fail(`${label} 必须是非空、无首尾空格的字符串，当前为 ${JSON.stringify(value)}`);
        return;
    }
    if (/^v/i.test(value)) {
        fail(`${label} 不能带 v 前缀：${value}`);
        return;
    }
    if (!SEMVER.test(value)) {
        fail(`${label} 不是合法的语义化版本：${value}`);
    }
};

/* ------------------------------------------------------------------ *
 * 读取 package.zip
 * ------------------------------------------------------------------ */

const zipPath = join(root, "package.zip");
if (!existsSync(zipPath)) {
    console.error("找不到 package.zip，请先运行 node tools/pack.mjs");
    process.exit(1);
}

/** 解析 zip 的本地文件头，拿到条目名与内容 */
const readZip = (buffer) => {
    const entries = new Map();
    let offset = 0;
    while (offset + 4 <= buffer.length && buffer.readUInt32LE(offset) === 0x04034b50) {
        const method = buffer.readUInt16LE(offset + 8);
        const compressedSize = buffer.readUInt32LE(offset + 18);
        const nameLength = buffer.readUInt16LE(offset + 26);
        const extraLength = buffer.readUInt16LE(offset + 28);
        const name = buffer.slice(offset + 30, offset + 30 + nameLength).toString("utf8");
        const dataStart = offset + 30 + nameLength + extraLength;
        const raw = buffer.slice(dataStart, dataStart + compressedSize);
        entries.set(name, method === 8 ? inflateRawSync(raw) : raw);
        offset = dataStart + compressedSize;
    }
    return entries;
};

const zip = readZip(readFileSync(zipPath));
const entryNames = Array.from(zip.keys());

/* ---- 必要文件（大小写敏感，必须在包根） ---- */
for (const name of REQUIRED_FILES) {
    if (!entryNames.includes(name)) {
        fail(`package.zip 包根缺少必要文件 ${name}（文件名大小写必须完全一致）`);
    }
}

/* ---- 路径规范 ---- */
for (const name of entryNames) {
    for (const part of name.split("/")) {
        if (part !== part.trim()) {
            fail(`路径 ${name} 中「${part}」有首尾空格，Windows 不支持`);
        }
        const base = part.split(".")[0].toUpperCase();
        if (RESERVED_DEVICE_NAMES.has(base)) {
            fail(`路径 ${name} 中「${part}」是 Windows 保留设备名`);
        }
    }
}

/* ---- 清单 ---- */
let manifest = null;
if (zip.has("plugin.json")) {
    try {
        manifest = JSON.parse(zip.get("plugin.json").toString("utf8"));
    } catch (error) {
        fail(`plugin.json 不是合法 JSON：${error.message}`);
    }
}

if (manifest) {
    // 字段白名单
    for (const key of Object.keys(manifest)) {
        if (!PLUGIN_KEYS.includes(key)) {
            fail(`plugin.json 含未知字段「${key}」，集市只允许：${PLUGIN_KEYS.join(", ")}`);
        }
    }

    // 必填身份字段
    for (const key of ["name", "author", "url", "version"]) {
        if (typeof manifest[key] !== "string" || manifest[key].trim() === "") {
            fail(`plugin.json 缺少必填字段 ${key}（必须是非空字符串）`);
        }
    }
    checkSemver("version", manifest.version, true);
    checkSemver("minAppVersion", manifest.minAppVersion, false);

    if (typeof manifest.name === "string" && !/^[A-Za-z0-9._-]+$/.test(manifest.name)) {
      note(`name「${manifest.name}」含非常规字符，建议只用字母数字和 - _ .`);
    }

    // readme
    if (!manifest.readme || typeof manifest.readme !== "object" || Array.isArray(manifest.readme)) {
        fail("plugin.json 的 readme 必须是对象，例如 { \"default\": \"README.md\" }");
    } else {
        if (!manifest.readme.default) {
            fail("plugin.json 的 readme 缺少必填键 default");
        }
        for (const [locale, file] of Object.entries(manifest.readme)) {
            if (typeof file !== "string") {
                fail(`readme.${locale} 必须是字符串文件名`);
                continue;
            }
            if (!entryNames.includes(file)) {
                fail(`readme.${locale} 指向的 ${file} 不在 package.zip 里`);
            }
        }
    }

    // 数组字段
    for (const key of ARRAY_FIELDS_WITH_ALL) {
        const value = manifest[key];
        if (value === undefined) {
            continue;
        }
        if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
            fail(`${key} 必须是字符串数组`);
            continue;
        }
        if (value.includes("all") && value.length > 1) {
            fail(`${key} 含 "all" 时不能再混入其它取值`);
        }
    }

    for (const key of ["disabledInPublish", "settingsWindow"]) {
        if (manifest[key] !== undefined && typeof manifest[key] !== "boolean") {
            fail(`${key} 必须是布尔值 true/false，不能是字符串`);
        }
    }

    // 图片
    for (const spec of IMAGE_SPECS) {
        const declared = manifest[spec.field];
        let fileName = declared;
        if (fileName === undefined) {
            fileName = entryNames.includes(spec.legacy) ? spec.legacy : undefined;
        } else if (typeof fileName !== "string" || fileName.trim() === "") {
            fail(`${spec.field} 必须是无首尾空白的非空文件名字符串`);
            continue;
        } else if (fileName.includes("/") || fileName.includes("\\")) {
            fail(`${spec.field}「${fileName}」必须是包根文件名，不能带目录`);
            continue;
        }
        if (fileName === undefined) {
            note(`未提供 ${spec.field}，集市列表会缺少图片`);
            continue;
        }
        if (!entryNames.includes(fileName)) {
            fail(`${spec.field} 声明的 ${fileName} 不在 package.zip 包根`);
            continue;
        }
        const extension = fileName.slice(fileName.lastIndexOf(".")).toLowerCase();
        if (!IMAGE_EXTENSIONS.includes(extension)) {
            fail(`${spec.field}「${fileName}」格式不受支持（仅 PNG/JPEG/WebP/AVIF，不支持 SVG）`);
        }
        if (zip.get(fileName).length > spec.maxBytes) {
            fail(`${spec.field}「${fileName}」超过 ${Math.round(spec.maxBytes / 1024)} KiB`);
        }
    }

    // 发布声明：声明了 data 但代码里没用到，属于残留配置
    if (manifest.publish !== undefined) {
        if (typeof manifest.publish !== "object" || Array.isArray(manifest.publish)) {
            fail("publish 必须是对象");
        } else {
            const data = manifest.publish.data;
            if (Array.isArray(data) && data.length > 0) {
                note(`publish.data 声明了 ${JSON.stringify(data)}，确认插件确实通过 savePublishData 写入这些字段，否则请删除`);
            }
        }
    }
}

/* ---- 入口脚本里的 require ---- */
if (zip.has("index.js")) {
    const indexJs = zip.get("index.js").toString("utf8");
    if (!/require\(\s*["']siyuan["']\s*\)/.test(indexJs)) {
        note("index.js 里没有看到 require(\"siyuan\")，确认插件入口正确");
    }
    if (/^\s*import\s/m.test(indexJs)) {
        fail("index.js 里仍有 ESM 的 import 语句，插件前端入口需要是 CommonJS/IIFE");
    }
    if (/^\s*export\s/m.test(indexJs)) {
        fail("index.js 里仍有 ESM 的 export 语句，插件前端入口需要是 CommonJS/IIFE");
    }
}

/* ---- 仓库级要求（这些文件不在 package.zip 里，但集市会检查仓库根目录） ---- */

const REPO_REQUIRED_FILES = [
    {name: "LICENSE", alternatives: ["LICENSE", "LICENSE.txt", "LICENSE.md", "COPYING"],
        hint: "集市 PR Check 要求仓库根目录存在 LICENSE 或 LICENSE.txt"},
    {name: "README.md", alternatives: ["README.md"], hint: "仓库根说明文档"},
    {name: "plugin.json", alternatives: ["plugin.json"], hint: "插件清单"},
    {name: "index.js", alternatives: ["index.js"], hint: "插件前端入口"}
];

for (const spec of REPO_REQUIRED_FILES) {
    const found = spec.alternatives.some((file) => existsSync(join(root, file)));
    if (!found) {
        fail(`仓库根缺少 ${spec.name}：${spec.hint}（需要提交到 Git 仓库，不是只放进 package.zip）`);
    }
}

// LICENSE 至少要有点内容，别是空文件
for (const file of ["LICENSE", "LICENSE.txt", "LICENSE.md", "COPYING"]) {
    const path = join(root, file);
    if (existsSync(path) && statSync(path).size < 100) {
        fail(`${file} 内容过短（${statSync(path).size} 字节），确认是完整的许可证文本`);
    }
}

/* ---- 本地仓库文件是否齐全（发布 Release 时用） ---- */
for (const file of ["README.md", "README.en.md", "plugin.json", "index.js", "index.css", "icon.png", "preview.png"]) {
    if (!existsSync(join(root, file))) {
        note(`本地缺少 ${file}（package.zip 里已有则不影响集市安装）`);
    }
}
void statSync;

/* ------------------------------------------------------------------ *
 * 输出
 * ------------------------------------------------------------------ */

console.log(`检查对象：package.zip（${entryNames.length} 个条目）`);
console.log(`条目：${entryNames.join(", ")}`);
if (manifest) {
  console.log(`插件名：${manifest.name}  版本：${manifest.version}  最低思源：${manifest.minAppVersion || "(未声明)"}`);
  console.log(`作者：${manifest.author}  仓库：${manifest.url}`);
}
console.log("");

if (notes.length > 0) {
    console.log("提示：");
    notes.forEach((item) => console.log(`  · ${item}`));
    console.log("");
}

if (issues.length > 0) {
    console.log(`发现 ${issues.length} 个会导致集市检查失败的问题：`);
    issues.forEach((item) => console.log(`  ✗ ${item}`));
    process.exit(1);
}

console.log("预检通过：未发现会导致集市 PR Check 失败的问题。");
