/*!
 * 打包插件：node tools/pack.mjs
 *
 * package.zip 的安装文件位于 ZIP 根目录，供官方集市使用。
 * plugin-calc.zip 带一层 plugin-calc/ 目录，供手动解压到 data/plugins/。
 * 不用 PowerShell 的 Compress-Archive，以免 ZIP 条目名混入反斜杠。
 */

import {readFileSync, writeFileSync, statSync} from "node:fs";
import {dirname, join, resolve} from "node:path";
import {fileURLToPath} from "node:url";
import {deflateRawSync} from "node:zlib";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const INCLUDE = [
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

const crcTable = (() => {
    const table = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
        let c = n;
        for (let k = 0; k < 8; k++) {
            c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
        }
        table[n] = c;
    }
    return table;
})();

const crc32 = buffer => {
    let crc = -1;
    for (let i = 0; i < buffer.length; i++) {
        crc = (crc >>> 8) ^ crcTable[(crc ^ buffer[i]) & 0xff];
    }
    return (crc ^ -1) >>> 0;
};

const createZip = prefix => {
    const localParts = [];
    const centralParts = [];
    let offset = 0;

    for (const relativePath of INCLUDE) {
        const data = readFileSync(join(root, relativePath));
        const nameBuffer = Buffer.from(prefix + relativePath, "utf8");
        const compressed = deflateRawSync(data, {level: 9});
        const crc = crc32(data);

        const localHeader = Buffer.alloc(30);
        localHeader.writeUInt32LE(0x04034b50, 0);
        localHeader.writeUInt16LE(20, 4);
        localHeader.writeUInt16LE(0x0800, 6);
        localHeader.writeUInt16LE(8, 8);
        localHeader.writeUInt16LE(0, 10);
        localHeader.writeUInt16LE(0x21, 12);
        localHeader.writeUInt32LE(crc, 14);
        localHeader.writeUInt32LE(compressed.length, 18);
        localHeader.writeUInt32LE(data.length, 22);
        localHeader.writeUInt16LE(nameBuffer.length, 26);
        localHeader.writeUInt16LE(0, 28);
        localParts.push(localHeader, nameBuffer, compressed);

        const centralHeader = Buffer.alloc(46);
        centralHeader.writeUInt32LE(0x02014b50, 0);
        centralHeader.writeUInt16LE(20, 4);
        centralHeader.writeUInt16LE(20, 6);
        centralHeader.writeUInt16LE(0x0800, 8);
        centralHeader.writeUInt16LE(8, 10);
        centralHeader.writeUInt16LE(0, 12);
        centralHeader.writeUInt16LE(0x21, 14);
        centralHeader.writeUInt32LE(crc, 16);
        centralHeader.writeUInt32LE(compressed.length, 20);
        centralHeader.writeUInt32LE(data.length, 24);
        centralHeader.writeUInt16LE(nameBuffer.length, 28);
        centralHeader.writeUInt16LE(0, 30);
        centralHeader.writeUInt16LE(0, 32);
        centralHeader.writeUInt16LE(0, 34);
        centralHeader.writeUInt16LE(0, 36);
        centralHeader.writeUInt32LE(0, 38);
        centralHeader.writeUInt32LE(offset, 42);
        centralParts.push(centralHeader, nameBuffer);
        offset += localHeader.length + nameBuffer.length + compressed.length;
    }

    const centralDirectory = Buffer.concat(centralParts);
    const endRecord = Buffer.alloc(22);
    endRecord.writeUInt32LE(0x06054b50, 0);
    endRecord.writeUInt16LE(0, 4);
    endRecord.writeUInt16LE(0, 6);
    endRecord.writeUInt16LE(INCLUDE.length, 8);
    endRecord.writeUInt16LE(INCLUDE.length, 10);
    endRecord.writeUInt32LE(centralDirectory.length, 12);
    endRecord.writeUInt32LE(offset, 16);
    endRecord.writeUInt16LE(0, 20);
    return Buffer.concat([...localParts, centralDirectory, endRecord]);
};

for (const [file, prefix] of [["package.zip", ""], ["plugin-calc.zip", "plugin-calc/"]]) {
    const zip = createZip(prefix);
    writeFileSync(join(root, file), zip);
    console.log(`已生成 ${file}（${zip.length} 字节，共 ${INCLUDE.length} 个文件）`);
    INCLUDE.forEach(item => {
        const size = statSync(join(root, item)).size;
        console.log(`  ${(prefix + item).padEnd(34)} ${String(size).padStart(7)} 字节`);
    });
}
