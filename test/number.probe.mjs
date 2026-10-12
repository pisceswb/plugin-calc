// 算术层自检：node test/number.probe.mjs
import * as N from "../src/lib/number.mjs";

let passed = 0;
let failed = 0;
const eq = (actual, label, expected) => {
    if (actual === expected) {
        passed++;
    } else {
        failed++;
        console.log(`FAIL  ${label}\n      actual   = ${JSON.stringify(actual)}\n      expected = ${JSON.stringify(expected)}`);
    }
};

const d = (text) => N.digitsOfString(text);
const s = (digits) => N.digitsToString(digits);
const fx = (text) => N.fixFromString(text);
const show = (f) => N.fixToString(f);
const rat = (text) => N.fixToRat(fx(text));
const ratShow = (r) => N.fixToString(N.ratToFix(r));

// —— 数组表示：高位在前，和书写顺序一致
eq(s([6, 0]), "[6,0]", "60");
eq(s([1, 0, 3]), "[1,0,3]", "103");
eq(s(d("60")), "digitsOfString('60')", "60");
eq(JSON.stringify(d("60")), "digitsOfString('60') 数组", "[6,0]");
eq(JSON.stringify(N.trimLeading([0, 6, 0])), "trimLeading([0,6,0])", "[6,0]");
eq(s(N.shiftLeft(d("3"), 2)), "3 * 100", "300");
eq(s(N.pow10(2)), "pow10(2)", "100");
eq(s(N.pow10(0)), "pow10(0)", "1");

// —— 四则
eq(s(N.addDigits(d("10"), d("5"))), "10 + 5", "15");
eq(s(N.addDigits(d("99"), d("1"))), "99 + 1", "100");
eq(s(N.addDigits(d("999"), d("1"))), "999 + 1", "1000");
eq(s(N.addDigits(d("0"), d("0"))), "0 + 0", "0");
eq(s(N.subDigits(d("100"), d("4"))), "100 - 4", "96");
eq(s(N.subDigits(d("1000"), d("1"))), "1000 - 1", "999");
eq(s(N.subDigits(d("100"), d("100"))), "100 - 100", "0");
eq(s(N.mulDigits(d("12"), d("5"))), "12 * 5", "60");
eq(s(N.mulDigits(d("10"), d("5"))), "10 * 5", "50");
eq(s(N.mulDigits(d("144"), d("144"))), "144 * 144", "20736");
eq(s(N.mulDigits(d("0"), d("5"))), "0 * 5", "0");
eq(s(N.mulDigits(d("999"), d("999"))), "999 * 999", "998001");
eq(N.compareDigits(d("10"), d("9")), "10 vs 9", 1);
eq(N.compareDigits(d("9"), d("10")), "9 vs 10", -1);
eq(N.compareDigits(d("10"), d("10")), "10 vs 10", 0);
eq(N.compareDigits(d("0"), d("0")), "0 vs 0", 0);

// —— 除法
const dv = (x, y) => N.divMod(d(x), d(y));
eq(s(dv("100", "4").quotient), "100 / 4", "25");
eq(s(dv("100", "4").remainder), "100 % 4", "0");
eq(s(dv("1000", "7").quotient), "1000 / 7", "142");
eq(s(dv("1000", "7").remainder), "1000 % 7", "6");
eq(s(dv("3", "7").quotient), "3 / 7", "0");
eq(s(dv("3", "7").remainder), "3 % 7", "3");
eq(s(dv("99999999999999999999", "3").quotient), "20 位 / 3", "33333333333333333333");
eq(s(dv("7", "7").quotient), "7 / 7", "1");

// —— 定点数
eq(show(fx("1.5")), "1.5", "1.5");
eq(show(fx("0.125")), "0.125", "0.125");
eq(show(fx("2.50")), "2.50", "2.5");
eq(show(fx(".5")), ".5", "0.5");
eq(show(fx("10")), "10", "10");
eq(show(fx("0")), "0", "0");
eq(show(fx("-3.25")), "-3.25", "-3.25");
eq(show(fx("100")), "100", "100");
eq(show(fx("0.05")), "0.05", "0.05");
eq(show(fx("0.005")), "0.005", "0.005");
eq(show(fx("1234.5678")), "1234.5678", "1234.5678");
eq(show(fx("0.000001")), "0.000001", "0.000001");
eq(show(fx("1000000")), "1000000", "1000000");

// —— 有理数换算
eq(s(N.fixToRat(fx("1.5")).n), "1.5 分子", "15");
eq(s(N.fixToRat(fx("1.5")).d), "1.5 分母", "10");
eq(s(N.fixToRat(fx("0.125")).n), "0.125 分子", "125");
eq(s(N.fixToRat(fx("0.125")).d), "0.125 分母", "1000");
eq(s(N.fixToRat(fx("0.05")).n), "0.05 分子", "5");
eq(s(N.fixToRat(fx("0.05")).d), "0.05 分母", "100");
eq(N.fixToNumber(fx("42.75")), "42.75 -> number", 42.75);
eq(N.fixToNumber(fx("-3.25")), "-3.25 -> number", -3.25);

// —— 有理数往返
eq(ratShow(rat("1.5")), "1.5 往返", "1.5");
eq(ratShow(rat("0.125")), "0.125 往返", "0.125");
eq(ratShow(rat("42.75")), "42.75 往返", "42.75");
eq(ratShow(rat("0.05")), "0.05 往返", "0.05");
eq(ratShow(rat("-3.25")), "-3.25 往返", "-3.25");

// —— 有理数运算
eq(ratShow(N.ratAdd(rat("0.1"), rat("0.2"))), "0.1 + 0.2", "0.3");
eq(ratShow(N.ratMul(rat("1.5"), rat("2"))), "1.5 * 2", "3");
eq(ratShow(N.ratMul(rat("10"), rat("5"))), "10 * 5", "50");
eq(ratShow(N.ratDiv(rat("10"), rat("4"))), "10 / 4", "2.5");
eq(ratShow(N.ratDiv(rat("1"), rat("8"))), "1 / 8", "0.125");
eq(ratShow(N.ratDiv(rat("1"), rat("3"))), "1 / 3", "0.3333333333333333333333333333333333333333");
eq(ratShow(N.ratDiv(rat("100"), rat("4"))), "100 / 4", "25");
eq(ratShow(N.ratSub(rat("3"), rat("10"))), "3 - 10", "-7");
eq(ratShow(N.ratSub(rat("1"), rat("1"))), "1 - 1", "0");
eq(ratShow(N.ratAdd(rat("1.5"), rat("20"))), "1.5 + 20", "21.5");
eq(ratShow(N.ratAdd(rat("0.7"), rat("0.1"))), "0.7 + 0.1", "0.8");
eq(ratShow(N.ratMul(rat("0.25"), rat("4"))), "0.25 * 4", "1");
eq(ratShow(N.ratDiv(rat("2"), rat("3"))), "2 / 3", "0.6666666666666666666666666666666666666667");

// —— Math 往返
eq(show(N.numberToFix(0.5)), "numberToFix(0.5)", "0.5");
eq(show(N.numberToFix(4)), "numberToFix(4)", "4");
eq(show(N.numberToFix(0.1)), "numberToFix(0.1)", "0.1");
eq(show(N.numberToFix(Math.sqrt(16))), "numberToFix(sqrt 16)", "4");
eq(show(N.numberToFix(-2.5)), "numberToFix(-2.5)", "-2.5");

// —— 复数
eq(N.complexToString(N.cMul(N.cFromNumber(2), N.cFromNumber(3))), "2 * 3 复数", "6");
eq(N.complexToString(N.cAdd(N.cFromNumber(1), N.cFromNumber(2))), "1 + 2 复数", "3");
eq(N.complexToString(N.cFromNumber(-4)), "-4 复数", "-4");

console.log(`\n算术层: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
