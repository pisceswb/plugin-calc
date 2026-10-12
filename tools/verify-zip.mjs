// 校验 package.zip：条目名用正斜杠、压缩数据可解压、内容与源文件一致
// node tools/verify-zip.mjs

import {readFileSync} from "node:fs";
import {dirname, join, resolve} from "node:path";
import {fileURLToPath} from "node:url";
import {inflateRawSync} from "node:zlib";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const zip = readFileSync(join(root, "package.zip"));

let offset = 0;
let checked = 0;
let failed = 0;

while (offset + 4 <= zip.length && zip.readUInt32LE(offset) === 0x04034b50) {
    const method = zip.readUInt16LE(offset + 8);
    const crc = zip.readUInt32LE(offset + 14);
    const compressedSize = zip.readUInt32LE(offset + 18);
    const uncompressedSize = zip.readUInt32LE(offset + 22);
    const nameLength = zip.readUInt16LE(offset + 26);
    const extraLength = zip.readUInt16LE(offset + 28);
    const name = zip.slice(offset + 30, offset + 30 + nameLength).toString("utf8");
    const dataStart = offset + 30 + nameLength + extraLength;
    const compressed = zip.slice(dataStart, dataStart + compressedSize);
    const content = method === 8 ? inflateRawSync(compressed) : compressed;

    const nameOk = name.includes("/") ? !name.includes("\\") : true;
    const sizeOk = content.length === uncompressedSize;
    let contentOk = true;
    try {
        const original = readFileSync(join(root, name));
        contentOk = original.equals(content);
    } catch (error) {
        contentOk = false;
    }
    if (!nameOk || !sizeOk || !contentOk) {
        failed++;
        console.log(`FAIL  ${name}  正斜杠=${nameOk} 尺寸=${sizeOk} 内容=${contentOk}`);
    } else {
        checked++;
    }
    void crc;
    offset = dataStart + compressedSize;
}

console.log(`\n校验完成：${checked} 个条目通过，${failed} 个失败`);
process.exit(failed === 0 ? 0 : 1);
