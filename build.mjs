/*!
 * 等号计算 (Equals Calc) —— 零依赖打包脚本
 *
 * 思源笔记的插件入口是 CommonJS（`require("siyuan")`、`module.exports`），
 * 而源码写成 ESM 便于在 Node 里测试。这里把 src/ 下的模块注册进一个
 * 内存模块表，由内置的 __require 按需初始化 —— 不依赖任何第三方打包器。
 *
 * 用法：node build.mjs
 */

import {readFileSync, writeFileSync} from "node:fs";
import {dirname, resolve} from "node:path";
import {fileURLToPath} from "node:url";

const root = dirname(fileURLToPath(import.meta.url));

/** 模块 ID -> 源文件（顺序即注册顺序，__require 按需初始化，所以依赖顺序不敏感） */
const MODULES = [
    {id: "lib/number", path: "src/lib/number.mjs"},
    {id: "lib/precision", path: "src/lib/precision.mjs"},
    {id: "lib/polynomial", path: "src/lib/polynomial.mjs"},
    {id: "lib/expr", path: "src/lib/expr.mjs"},
    {id: "index", path: "src/index.js"}
];

/** "./lib/expr.mjs" -> "lib/expr" */
const toModuleId = (specifier) => {
    const cleaned = specifier.replace(/^\.\//, "").replace(/\.mjs$/, "").replace(/\.js$/, "");
    return cleaned.startsWith("lib/") ? cleaned : `lib/${cleaned}`;
};

/** 把一个 ESM 源文件改写成 CJS 风格：收集导出、改写导入 */
const transform = (source) => {
    let out = source;
    const exports = [];
    /** default 导出对应的本地名字 */
    let defaultName = "undefined";

    // import {...} from "x";  ->  const {...} = ...
    out = out.replace(
        /import\s*\{([\s\S]*?)\}\s*from\s*["']([^"']+)["'];?/g,
        (match, names, from) => {
            const list = names.split(",").map((item) => item.trim()).filter(Boolean).join(", ");
            return from === "siyuan"
                ? `const {${list}} = __require("siyuan");`
                : `const {${list}} = __require(${JSON.stringify(toModuleId(from))});`;
        }
    );

    // export const NAME = ...  ->  const NAME = ...
    out = out.replace(/export\s+const\s+([A-Za-z_$][\w$]*)\s*=/g, (match, name) => {
        exports.push(name);
        return `const ${name} =`;
    });
    // export let / var 同理
    out = out.replace(/export\s+(let|var)\s+([A-Za-z_$][\w$]*)\s*=/g, (match, kind, name) => {
        exports.push(name);
        return `${kind} ${name} =`;
    });
    // export default class NAME / export default class
    out = out.replace(/export\s+default\s+class\s*([A-Za-z_$][\w$]*)?/, (match, name) => {
        defaultName = name || defaultName;
        exports.push("default");
        return name ? `class ${name}` : "class __DefaultExport";
    });
    out = out.replace(/export\s+default\s+function\s*([A-Za-z_$][\w$]*)?/, (match, name) => {
        defaultName = name || defaultName;
        exports.push("default");
        return name ? `function ${name}` : "function __DefaultExport";
    });
    // export default <表达式>
    out = out.replace(/export\s+default\s+/, () => {
        exports.push("default");
        defaultName = "__DefaultExport";
        return "const __DefaultExport = ";
    });
    // 末尾的 export {...};
    out = out.replace(/export\s*\{([\s\S]*?)\};?/g, (match, names) => {
        names.split(",").map((item) => item.trim()).filter(Boolean).forEach((item) => {
            const parts = item.split(/\s+as\s+/);
            exports.push((parts[1] || parts[0]).trim());
        });
        return "";
    });
    // 其它 export 关键字（export class / export function 等）
    out = out.replace(/^export\s+(?=(class|function|async)\b)/gm, "");

    // 去掉可能残留的 export 语句，避免打包产物里出现 ESM 语法
    if (/^\s*export\s/m.test(out)) {
        throw new Error("打包后仍有未处理的 export 语句");
    }
    // default 导出必须能解析到一个真实标识符，否则产物会在语法上就出错
    if (exports.includes("default") && defaultName === "undefined") {
        throw new Error("default 导出没有对应的类名或函数名，无法生成 module.exports");
    }

    const unique = Array.from(new Set(exports));
    const assignments = unique.map((name) => {
        const local = name === "default" ? defaultName : name;
        return `    ${JSON.stringify(name)}: ${local}`;
    }).join(",\n");
    return {code: out, exports: unique, assignments: assignments};
};

/* ------------------------------------------------------------------ *
 * 生成 bundle
 * ------------------------------------------------------------------ */

const banner = `/*!
 * 等号计算 (Equals Calc) —— 思源笔记插件
 *
 * 在编辑器里输入以等号结尾的算式并回车，自动把结果补在等号后面。
 * 本文件由 build.mjs 从 src/ 生成，请直接修改 src/ 下的源码。
 *
 * 计算不使用 eval / new Function：表达式解析与十进制高精度运算都是自己实现的，
 * 因此 0.1 + 0.2 会得到 0.3，大整数也不会丢精度。
 *
 * MIT License
 */`;

const parts = [];
parts.push(banner);
parts.push("(function () {");
parts.push("    \"use strict\";");
parts.push("");
parts.push("    /** 模块表：首次 require 时执行工厂函数并缓存导出 */");
parts.push("    const __registry = {};");
parts.push("    const __cache = {};");
parts.push("");
parts.push("    function __require(id) {");
parts.push("        if (id === \"siyuan\") {");
parts.push("            return require(\"siyuan\");");
parts.push("        }");
parts.push("        if (Object.prototype.hasOwnProperty.call(__cache, id)) {");
parts.push("            return __cache[id].exports;");
parts.push("        }");
parts.push("        const factory = __registry[id];");
parts.push("        if (!factory) {");
parts.push("            throw new Error(\"[plugin-calc] 未注册的模块: \" + id);");
parts.push("        }");
parts.push("        const module = {exports: {}};");
parts.push("        __cache[id] = module;");
parts.push("        factory(module, module.exports, __require);");
parts.push("        return module.exports;");
parts.push("    }");
parts.push("");

for (const item of MODULES) {
    const source = readFileSync(resolve(root, item.path), "utf8");
    const result = transform(source);
    parts.push(`    /* ---------------- ${item.path} ---------------- */`);
    parts.push(`    __registry[${JSON.stringify(item.id)}] = function (module, exports, __require) {`);
    parts.push(result.code);
    parts.push("    module.exports = {");
    parts.push(result.assignments);
    parts.push("    };");
    parts.push("    };");
    parts.push("");
}

parts.push("    const plugin = __require(\"index\").default;");
parts.push("    if (typeof module !== \"undefined\" && module.exports) {");
parts.push("        module.exports = plugin;");
parts.push("    } else if (typeof window !== \"undefined\") {");
parts.push("        window.EqualsCalcPlugin = plugin;");
parts.push("    }");
parts.push("})();");

const output = parts.join("\n") + "\n";
writeFileSync(resolve(root, "index.js"), output, "utf8");
console.log(`已生成 index.js（${output.length} 字节）`);
