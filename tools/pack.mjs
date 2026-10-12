/*!
 * 打包插件：node tools/pack.mjs
 *
 * 生成 package.zip。不用 PowerShell 的 Compress-Archive，
 * 因为它写入的条目名是反斜杠（Windows 路径），部分解压实现会当成文件名的一部分。
 * 这里按 ZIP 规范手工写入正斜杠路径，并使用 deflate 压缩。
 */

import {readFileSync, writeFileSync, readdirSync, statSync} from "node:fs";
import {dirname, join, relative, resolve, sep} from "node:path";
import {fileURLToPath} from "node:url";
import {deflateRawSync} from "node:zlib";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** 打进包里的文件（相对插件目录），顺序固定便于复现 */
const INCLUDE = [
    "plugin.json",
    "index.js",
    "index.css",
    "icon.png",
    "preview.png",
    "i18n/en.json",
    "i18n/zh-CN.json",
    "README.md",
    "README.zh-CN.md"
];

/* ---- CRC32 ---- */
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

const crc32 = (buffer) => {
    let crc = -1;
    for (let i = 0; i < buffer.length; i++) {
        crc = (crc >>> 8) ^ crcTable[(crc ^ buffer[i]) & 0xff];
    }
    return (crc ^ -1) >>> 0;
};

/* ---- 把若干文件写成一个 zip ---- */
const localParts = [];
const centralParts = [];
let offset = 0;

for (const relativePath of INCLUDE) {
    const absolutePath = join(root, relativePath);
    const data = readFileSync(absolutePath);
    // ZIP 规范要求条目名用正斜杠
    const name = relative(root, absolutePath).split(sep).join("/");
    const nameBuffer = Buffer.from(name, "utf8");
    const compressed = deflateRawSync(data, {level: 9});
    const crc = crc32(data);

    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(0x04034b50, 0); // 本地文件头签名
    localHeader.writeUInt16LE(20, 4);         // 解压所需版本
    localHeader.writeUInt16LE(0x0800, 6);     // 通用标志位：UTF-8 文件名
    localHeader.writeUInt16LE(8, 8);          // 压缩方法：deflate
    localHeader.writeUInt16LE(0, 10);         // 修改时间
    localHeader.writeUInt16LE(0x21, 12);      // 修改日期（1996-01-01）
    localHeader.writeUInt32LE(crc, 14);
    localHeader.writeUInt32LE(compressed.length, 18);
    localHeader.writeUInt32LE(data.length, 22);
    localHeader.writeUInt16LE(nameBuffer.length, 26);
    localHeader.writeUInt16LE(0, 28);         // 扩展字段长度

    localParts.push(localHeader, nameBuffer, compressed);

    const centralHeader = Buffer.alloc(46);
    centralHeader.writeUInt32LE(0x02014b50, 0); // 中央目录签名
    centralHeader.writeUInt16LE(20, 4);         // 创建版本
    centralHeader.writeUInt16LE(20, 6);         // 解压所需版本
    centralHeader.writeUInt16LE(0x0800, 8);     // UTF-8 标志
    centralHeader.writeUInt16LE(8, 10);         // deflate
    centralHeader.writeUInt16LE(0, 12);
    centralHeader.writeUInt16LE(0x21, 14);
    centralHeader.writeUInt32LE(crc, 16);
    centralHeader.writeUInt32LE(compressed.length, 20);
    centralHeader.writeUInt32LE(data.length, 24);
    centralHeader.writeUInt16LE(nameBuffer.length, 28);
    centralHeader.writeUInt16LE(0, 30);         // 扩展字段
    centralHeader.writeUInt16LE(0, 32);         // 注释
    centralHeader.writeUInt16LE(0, 34);         // 磁盘号
    centralHeader.writeUInt16LE(0, 36);         // 内部属性
    centralHeader.writeUInt32LE(0, 38);         // 外部属性
    centralHeader.writeUInt32LE(offset, 42);    // 本地头偏移
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

const zip = Buffer.concat([...localParts, centralDirectory, endRecord]);
const outputPath = join(root, "package.zip");
writeFileSync(outputPath, zip);

console.log(`已生成 package.zip（${zip.length} 字节，共 ${INCLUDE.length} 个文件）`);
INCLUDE.forEach((item) => {
    const size = statSync(join(root, item)).size;
    console.log(`  ${item.padEnd(24)} ${String(size).padStart(7)} 字节`);
});
void readdirSync;
