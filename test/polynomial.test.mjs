// 多项式与方程求解测试：node test/polynomial.test.mjs
import {
    polyZero, polyConst, polyVariable, polyAdd, polySub, polyMul, polyPow,
    polyDegree, polyHasVariable, polyEvaluate, solveEquation, newtonRealRoot,
    complexToDisplayString, fixToRatExact, ratFromSmallInt
} from "../src/lib/polynomial.mjs";
import {applyPrecision, normalizePolicy} from "../src/lib/precision.mjs";
import {
    fixFromString, ratToFix, fixToString, cFromFix, ratNorm, trimLeading
} from "../src/lib/number.mjs";

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

/** 用系数数组构造多项式：coeffs[0] 是常数项 */
const poly = (...coefficients) => {
    let result = polyZero();
    coefficients.forEach((value, power) => {
        if (value === 0) {
            return;
        }
        result = polyAdd(result, {
            coeffs: new Map([[power, ratFromSmallInt(value)]])
        });
    });
    return result;
};

const exact = normalizePolicy({roundMode: "exact"});
const solve = (left, right, policy = exact) => solveEquation(left, right, "x", policy);

/* -------- 多项式基本运算 -------- */

eq(polyDegree(poly(1, 2, 3)), 2, "二次多项式次数");
eq(polyDegree(polyZero()), -1, "零多项式次数 -1");
eq(polyDegree(poly(5)), 0, "常数多项式次数 0");
eq(polyHasVariable(poly(1, 2)), true, "含未知量");
eq(polyHasVariable(poly(1)), false, "不含未知量");

// (x + 1)(x - 1) = x^2 - 1
const product = polyMul(polyAdd(polyVariable(), poly(1)), polySub(polyVariable(), poly(1)));
eq(polyDegree(product), 2, "(x+1)(x-1) 次数");
// 求根公式按 (-b-√D)/(2a) 在前，所以顺序是 -1 再 1
eq(solve(product, poly(0), exact).text, "-1 或 1", "(x+1)(x-1)=0 的根");

// x^2 和 x^3
eq(polyDegree(polyPow(polyVariable(), 3)), 3, "x^3 次数");
eq(polyDegree(polyMul(polyVariable(), polyVariable())), 2, "x*x 次数");

// 代入求值：3x^2 + 2x + 1 在 x=2 处 = 17
const quadratic = poly(1, 2, 3);
const atTwo = polyEvaluate(quadratic, cFromFix(fixFromString("2")));
eq(fixToString(ratToFix(fixToRatExact(atTwo.re))), "17", "3x^2+2x+1 在 x=2 处为 17");

/* -------- 一次方程（精确） -------- */

eq(solve(polyAdd(polyVariable(), poly(3)), poly(5)).text, "2", "x+3=5 -> x=2");
eq(solve(poly(3), polyVariable()).text, "3", "3=x -> x=3");
eq(solve(polyMul(poly(2), polyVariable()), poly(10)).text, "5", "2x=10 -> x=5");
eq(solve(polyAdd(polyMul(poly(2), polyVariable()), poly(3)), poly(7)).text, "2", "2x+3=7 -> x=2");
eq(solve(polyMul(poly(3), polyVariable()), poly(1)).text, "0.3333333333333333333333333333333333333333",
    "3x=1 -> 1/3（精确模式保留完整精度）");
eq(solve(polyAdd(polyVariable(), poly(1)), poly(1)).text, "0", "x+1=1 -> x=0");
eq(solve(polyMul(poly(-2), polyVariable()), poly(6)).text, "-3", "-2x=6 -> x=-3");
eq(solve(polyVariable(), poly(-4)).text, "-4", "x=-4 -> x=-4");

/* -------- 一次方程按精度显示 -------- */

const threePlaces = normalizePolicy({roundMode: "places", roundDigits: 3});
eq(solve(polyMul(poly(3), polyVariable()), poly(1), threePlaces).text, "0.333",
    "3x=1 保留 3 位小数");

/* -------- 二次方程 -------- */
// 求根公式先给 (-b-√D)/(2a)，非二次方程解法约定的顺序不重要，这里按实现固定住

eq(solve(polySub(polyMul(polyVariable(), polyVariable()), poly(4)), poly(0)).text, "-2 或 2",
    "x^2=4 -> -2 或 2");
eq(solve(polySub(polyMul(polyVariable(), polyVariable()), polyMul(poly(2), polyVariable())), poly(0)).text,
    "0 或 2", "x^2=2x -> 0 或 2");
// x^2 - 5x + 6 = 0 -> 2 和 3
const monic = polySub(polyAdd(polyMul(polyVariable(), polyVariable()),
    poly(6)), polyMul(poly(5), polyVariable()));
eq(solve(monic, poly(0)).text, "2 或 3", "x^2-5x+6=0 -> 2 或 3");
// x^2 = -2 -> 纯虚根
const imaginaryTwo = solve(polyAdd(polyMul(polyVariable(), polyVariable()), poly(2)), poly(0));
eq(imaginaryTwo.note, "complex", "x^2+2=0 判定为复数解");
eq(imaginaryTwo.text, "1.414213562373i 或 -1.414213562373i", "x^2+2=0 的纯虚根");
// x^2 = -1 -> ±i
const imaginary = solve(polyAdd(polyMul(polyVariable(), polyVariable()), poly(1)), poly(0));
eq(imaginary.note, "complex", "x^2+1=0 判定为复数解");
eq(imaginary.text, "1i 或 -1i", "x^2+1=0 的复数解显示（实部为 0 时不写 0+）");

/* -------- 无解 / 恒等式 -------- */

const none = solve(poly(3), poly(5));
eq(none.ok, false, "3=5 无解");
eq(none.error, "方程无解", "3=5 的提示");

const identity = solve(poly(3), poly(3));
eq(identity.ok, true, "3=3 有解");
eq(identity.note, "identity", "3=3 是恒等式");
eq(identity.text, "任意值", "3=3 显示任意值");

/* -------- 高次方程（数值解） -------- */
// x^3 = 2 -> 1.2599210499（数值解默认 10 位有效数字）
const cubic = solve(polyPow(polyVariable(), 3), poly(2));
eq(cubic.note, "numeric", "x^3=2 走数值解");
eq(cubic.text, "1.25992105", "x^3=2 保留 10 位有效数字");

// x^4 = 16 -> 2（迭代收敛到整数时吸附成精确值）
const quartic = solve(polyPow(polyVariable(), 4), poly(16));
eq(quartic.note, "numeric", "x^4=16 走数值解");
eq(quartic.text, "2", "x^4=16 -> 2（吸附整数，不出现 1.9999999…）");

/* -------- 牛顿迭代 -------- */
const root = newtonRealRoot(polySub(polyPow(polyVariable(), 3), poly(2)));
eq(root !== null, true, "牛顿迭代有结果");
eq(fixToString(ratToFix(applyPrecision(root, normalizePolicy({roundMode: "places", roundDigits: 6})))),
    "1.259921", "牛顿迭代精度符合预期");

/* -------- 复数格式化（入参是定点数） -------- */
const fx = (text) => fixFromString(text);
eq(complexToDisplayString(cFromFix(fx("2")), exact), "2", "虚部为 0 时只显示实部");
eq(complexToDisplayString({re: fx("2"), im: fx("3")}, exact), "2+3i", "复数格式化 2+3i");
eq(complexToDisplayString({re: fx("2"), im: fx("-3")}, exact), "2-3i", "复数格式化 2-3i");
eq(complexToDisplayString({re: fx("0"), im: fx("1")}, exact), "i", "复数格式化 i");
eq(complexToDisplayString({re: fx("0"), im: fx("-1")}, exact), "-i", "复数格式化 -i");
eq(complexToDisplayString({re: fx("-4"), im: fx("0")}, exact), "-4", "复数格式化负数实部");

void ratNorm;
void trimLeading;
void applyPrecision;
console.log(`\n多项式层: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
