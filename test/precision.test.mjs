// 精度设置测试：node test/precision.test.mjs
import {normalizePolicy, applyPrecision} from "../src/lib/precision.mjs";
import {fixFromString, fixToRat, ratToFix, fixToString, ratIsZero} from "../src/lib/number.mjs";

let passed = 0;
let failed = 0;
const eq = (actual, expected, label) => {
    if (actual === expected) {
        passed++;
    } else {
        failed++;
        console.log(`FAIL  ${label}\n      actual   = ${JSON.stringify(actual)}\n      expected = ${JSON.stringify(expected)}`);
    }
};

/** 小数文本 -> 有理数 */
const rat = (text) => fixToRat(fixFromString(text));

/** 按精度策略格式化一个数值，返回字符串 */
const show = (value, mode, digits) => {
    const policy = normalizePolicy({roundMode: mode, roundDigits: digits});
    const rounded = applyPrecision(rat(value), policy);
    return ratIsZero(rounded) ? "0" : fixToString(ratToFix(rounded));
};

// —— 精确模式：不做任何改动
eq(show("1234.5678", "exact", 6), "1234.5678", "exact 不改动");
eq(show("0.1", "exact", 6), "0.1", "exact 保留 0.1");
eq(show("2", "exact", 6), "2", "exact 整数");

// —— 固定小数位
eq(show("1234.5678", "places", 2), "1234.57", "2 位小数进位");
eq(show("1234.5612", "places", 2), "1234.56", "2 位小数舍去");
eq(show("1234.5678", "places", 0), "1235", "0 位小数");
eq(show("0.5", "places", 0), "1", "0 位小数进位到 1");
eq(show("0.4", "places", 0), "0", "0 位小数舍去为 0");
eq(show("2.5", "places", 3), "2.5", "末尾多余的 0 去掉");
eq(show("1.999", "places", 2), "2", "连续进位");
eq(show("9.999", "places", 2), "10", "进位跨整数位");
eq(show("-3.14159", "places", 3), "-3.142", "负数舍入");
eq(show("-0.0001", "places", 2), "0", "负数舍入到 0");
eq(show("1.005", "places", 2), "1.01", "1.005 -> 1.01（十进制精确舍入）");

// —— 有效数字
eq(show("1234.5678", "digits", 4), "1235", "4 位有效数字");
eq(show("1234.5678", "digits", 2), "1200", "2 位有效数字");
eq(show("0.001234", "digits", 3), "0.00123", "小数 3 位有效数字");
eq(show("0.001234", "digits", 2), "0.0012", "小数 2 位有效数字");
eq(show("9.99", "digits", 3), "9.99", "9.99 本身已是 3 位有效数字");
eq(show("9.9996", "digits", 3), "10", "9.9996 三位有效数字进位 -> 10");
eq(show("9.9996", "digits", 2), "10", "9.9996 两位有效数字进位 -> 10");
eq(show("999.96", "digits", 3), "1000", "999.96 三位有效数字进位 -> 1000");
eq(show("999.9", "digits", 3), "1000", "999.9 三位有效数字 -> 1000");
eq(show("9.99", "digits", 2), "10", "9.99 两位有效数字 -> 10");
eq(show("99.9", "digits", 2), "100", "99.9 两位有效数字 -> 100");
eq(show("1.005", "digits", 3), "1.01", "1.005 三位有效数字");
eq(show("12345", "digits", 3), "12300", "整数有效数字");
eq(show("987.65", "digits", 3), "988", "三位有效数字");
eq(show("-987.65", "digits", 3), "-988", "负数有效数字");
eq(show("0.5", "digits", 1), "0.5", "0.5 一位有效数字");
eq(show("0.05", "digits", 1), "0.05", "0.05 一位有效数字");
eq(show("0", "digits", 3), "0", "0 保持 0");

// —— 1/3 这类除不尽的数
eq(show("0.3333333333333333333333", "places", 4), "0.3333", "1/3 类小数取 4 位");
eq(show("0.3333333333333333333333", "digits", 4), "0.3333", "1/3 类小数取 4 位有效数字");
eq(show("0.6666666666666666666666", "places", 3), "0.667", "0.666… 取 3 位小数进位");

// —— 设置规范化
eq(normalizePolicy({}).mode, "exact", "默认精确模式");
eq(normalizePolicy({roundMode: "???"}).mode, "exact", "未知模式回落到精确");
eq(normalizePolicy({roundMode: "places", roundDigits: "abc"}).digits, 6, "非法位数用默认 6");
eq(normalizePolicy({roundMode: "places", roundDigits: -3}).digits, 0, "小数位下限 0");
eq(normalizePolicy({roundMode: "places", roundDigits: 99}).digits, 15, "小数位上限 15");
eq(normalizePolicy({roundMode: "digits", roundDigits: 0}).digits, 1, "有效数字下限 1");
eq(normalizePolicy({roundMode: "digits", roundDigits: 99}).digits, 15, "有效数字上限 15");
eq(normalizePolicy({roundMode: "digits", roundDigits: "8"}).digits, 8, "字符串位数也能解析");

console.log(`\n精度层: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
