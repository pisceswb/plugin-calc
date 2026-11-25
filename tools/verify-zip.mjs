// 校验两个 ZIP 的条目名、压缩数据和文件内容
// node tools/verify-zip.mjs

import {readFileSync} from "node:fs";
import {dirname, join, resolve} from "node:path";
import {fileURLToPath} from "node:url";
import {inflateRawSync} from "node:zlib";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const expected = [
    "plugin.json",
    "index.js",
    "index.css",
    "icon.png",
    "preview.png",
    "i18n/en.json",
    "i18n/zh-CN.json",
    "README.md",
    "README.en.md"
];
let checked = 0;
let failed = 0;

for (const [file, prefix] of [["package.zip", ""], ["plugin-calc.zip", "plugin-calc/"]]) {
    const zip = readFileSync(join(root, file));
    const names = [];
    let offset = 0;
    while (offset + 4 <= zip.length && zip.readUInt32LE(offset) === 0x04034b50) {
        const method = zip.readUInt16LE(offset + 8);
        const compressedSize = zip.readUInt32LE(offset + 18);
        const uncompressedSize = zip.readUInt32LE(offset + 22);
        const nameLength = zip.readUInt16LE(offset + 26);
        const extraLength = zip.readUInt16LE(offset + 28);
        const name = zip.slice(offset + 30, offset + 30 + nameLength).toString("utf8");
        const dataStart = offset + 30 + nameLength + extraLength;
        const compressed = zip.slice(dataStart, dataStart + compressedSize);
        const content = method === 8 ? inflateRawSync(compressed) : compressed;
        names.push(name);

        const sourceName = name.startsWith(prefix) ? name.slice(prefix.length) : "";
        const nameOk = !name.includes("\\") && expected.includes(sourceName);
        const sizeOk = content.length === uncompressedSize;
        let contentOk = false;
        if (sourceName) {
            try {
                contentOk = readFileSync(join(root, sourceName)).equals(content);
            } catch {
                contentOk = false;
            }
        }
        if (!nameOk || !sizeOk || !contentOk) {
            failed++;
            console.log(`FAIL  ${file}: ${name}  名称=${nameOk} 尺寸=${sizeOk} 内容=${contentOk}`);
        } else {
            checked++;
        }
        offset = dataStart + compressedSize;
    }
    const expectedNames = expected.map(name => prefix + name);
    if (JSON.stringify(names) !== JSON.stringify(expectedNames)) {
        failed++;
        console.log(`FAIL  ${file}: 条目列表或顺序不正确`);
    }
    console.log(`${file}: ${names.length} 个条目`);
}

console.log(`\n校验完成：${checked} 个条目通过，${failed} 个失败`);
process.exit(failed === 0 ? 0 : 1);
