/*!
 * 等号计算 (Equals Calc) —— 多项式与方程求解
 *
 * 支持 "a+3=5;a=" 这类写法：把等号两边看成同一个未知量的多项式，
 * 移项后求解。系数全部用精确有理数，不做浮点运算。
 *
 * 多项式表示：{ coeffs: Map<次数, 有理数> }
 *   3x^2 + 1  ->  Map{ 2 => 3, 0 => 1 }
 * 次数 0 的项即常数项。空 Map 表示 0。
 *
 * 求解策略：
 *   无未知量 -> 恒等式或无解
 *   一次     -> 移项得精确解
 *   二次     -> 求根公式；判别式为负时给出共轭复根
 *   三次以上 -> 牛顿迭代求一个实根
 */

import {
    cAdd,
    cDiv,
    cFromFix,
    cIsReal,
    cMul,
    cZero,
    fixIsZero,
    fixToNumber,
    fixToString,
    numberToFix,
    ratAdd,
    ratDiv,
    ratIsZero,
    ratMul,
    ratNorm,
    ratSub,
    ratToFix,
    trimLeading
} from "./number.mjs";
import {applyPrecision, normalizePolicy, policyIsExact} from "./precision.mjs";

/** 牛顿迭代上限，防止病态方程卡住 */
const NEWTON_MAX_ITERATIONS = 120;
/** 数值解在没有精度设置时的显示位数 */
const NUMERIC_DEFAULT_DIGITS = 10;

const ratZeroValue = () => ({n: [0], d: [1], neg: false});
const ratOneValue = () => ({n: [1], d: [1], neg: false});

/** 小整数 -> 有理数（导出给测试与调用方使用） */
export const ratFromSmallInt = (value) => {
    const text = String(Math.abs(Math.trunc(value)));
    const digits = [];
    for (let i = 0; i < text.length; i++) {
        digits.push(text.charCodeAt(i) - 48);
    }
    return {n: trimLeading(digits), d: [1], neg: value < 0};
};

/* ------------------------------------------------------------------ *
 * 1. 多项式基本运算
 * ------------------------------------------------------------------ */

export const polyZero = () => ({coeffs: new Map()});

export const polyConst = (rational) => (ratIsZero(rational) ?
    polyZero() : {coeffs: new Map([[0, rational]])});

export const polyVariable = () => ({coeffs: new Map([[1, ratOneValue()]])});

export const polyIsZero = (poly) => poly.coeffs.size === 0;

/** 是否含未知量 */
export const polyHasVariable = (poly) => {
    let found = false;
    poly.coeffs.forEach((coefficient, degree) => {
        if (degree > 0 && !ratIsZero(coefficient)) {
            found = true;
        }
    });
    return found;
};

/** 最高次数；零多项式返回 -1 */
export const polyDegree = (poly) => {
    let degree = -1;
    poly.coeffs.forEach((coefficient, power) => {
        if (!ratIsZero(coefficient) && power > degree) {
            degree = power;
        }
    });
    return degree;
};

/** 按次数取系数（缺项为 0） */
export const polyCoefficient = (poly, power) => poly.coeffs.get(power) || ratZeroValue();

export const polyAdd = (a, b) => {
    const coeffs = new Map(a.coeffs);
    b.coeffs.forEach((coefficient, power) => {
        const existing = coeffs.get(power);
        const sum = existing ? ratAdd(existing, coefficient) : coefficient;
        if (ratIsZero(sum)) {
            coeffs.delete(power);
        } else {
            coeffs.set(power, sum);
        }
    });
    return {coeffs: coeffs};
};

export const polyNeg = (poly) => {
    const coeffs = new Map();
    poly.coeffs.forEach((coefficient, power) => {
        coeffs.set(power, {n: coefficient.n, d: coefficient.d, neg: !coefficient.neg});
    });
    return {coeffs: coeffs};
};

export const polySub = (a, b) => polyAdd(a, polyNeg(b));

export const polyMul = (a, b) => {
    const coeffs = new Map();
    a.coeffs.forEach((left, leftPower) => {
        b.coeffs.forEach((right, rightPower) => {
            const power = leftPower + rightPower;
            const product = ratMul(left, right);
            const existing = coeffs.get(power);
            const sum = existing ? ratAdd(existing, product) : product;
            if (ratIsZero(sum)) {
                coeffs.delete(power);
            } else {
                coeffs.set(power, sum);
            }
        });
    });
    return {coeffs: coeffs};
};

/** 非负整数次幂 */
export const polyPow = (poly, exponent) => {
    let result = polyConst(ratOneValue());
    for (let i = 0; i < exponent; i++) {
        result = polyMul(result, poly);
    }
    return result;
};

/** 求导 */
export const polyDerivative = (poly) => {
    const coeffs = new Map();
    poly.coeffs.forEach((coefficient, power) => {
        if (power === 0) {
            return;
        }
        const scaled = ratMul(coefficient, ratFromSmallInt(power));
        if (!ratIsZero(scaled)) {
            coeffs.set(power - 1, scaled);
        }
    });
    return {coeffs: coeffs};
};

/** 代入求值（支持复数） */
export const polyEvaluate = (poly, value) => {
    let total = cZero();
    poly.coeffs.forEach((coefficient, power) => {
        let term = cFromFix(ratToFix(coefficient));
        for (let i = 0; i < power; i++) {
            term = cMul(term, value);
        }
        total = cAdd(total, term);
    });
    return total;
};

/* ------------------------------------------------------------------ *
 * 2. 定点数 / 有理数互转
 * ------------------------------------------------------------------ */

/** 定点数 -> 有理数（精确） */
export const fixToRatExact = (fix) => {
    const digits = trimLeading(fix.int);
    const d = [1].concat(new Array(fix.scale).fill(0));
    return ratNorm(digits, d, fix.neg);
};

/** 双精度数字 -> 有理数（保留 12 位小数） */
const numberToRat = (value) => fixToRatExact(numberToFix(value));

/** 按精度策略把有理数转成显示字符串 */
const ratToDisplayString = (rational, policy) =>
    fixToString(ratToFix(applyPrecision(rational, policy)));

/** 定点数按精度策略格式化（内部先转成有理数） */
export const fixToDisplayString = (fix, policy) =>
    ratToDisplayString(fixToRatExact(fix), policy);

/** 按精度策略格式化复数 */
export const complexToDisplayString = (value, policy) => {
    const realText = fixToDisplayString(value.re, policy);
    if (fixIsZero(value.im)) {
        return realText;
    }
    const imagAbs = fixToDisplayString({int: value.im.int, scale: value.im.scale, neg: false}, policy);
    const imagText = imagAbs === "1" ? "i" : imagAbs + "i";
    // 实部舍入后可能变成 0（例如 0.0001 取 0 位小数），这时只显示虚部
    if (realText === "0") {
        return (value.im.neg ? "-" : "") + imagText;
    }
    return realText + (value.im.neg ? "-" : "+") + imagText;
};

/* ------------------------------------------------------------------ *
 * 3. 方程求解
 * ------------------------------------------------------------------ */

/**
 * 解一元方程 left = right。
 *
 * @param {{coeffs: Map}} left 等号左边
 * @param {{coeffs: Map}} right 等号右边
 * @param {string} variableName 未知量名字，用于提示
 * @param {{mode:string, digits:number}} policy 显示精度
 * @returns {{ok:true, text:string, solutions:string[], note:string, variable:string}
 *          |{ok:false, error:string}}
 */
export const solveEquation = (left, right, variableName, policy) => {
    const difference = polySub(left, right);
    const degree = polyDegree(difference);
    const variable = variableName || "x";

    if (degree < 0) {
        // 两边恒等
        return {ok: true, text: "任意值", solutions: [], note: "identity", variable: variable};
    }
    if (degree === 0) {
        return {ok: false, error: "方程无解"};
    }

    if (degree === 1) {
        // ax + b = 0  ->  x = -b / a
        const a = polyCoefficient(difference, 1);
        const b = polyCoefficient(difference, 0);
        const solution = ratDiv({n: b.n, d: b.d, neg: !b.neg}, a);
        const text = ratToDisplayString(solution, policy);
        return {ok: true, text: text, solutions: [text], note: "exact", variable: variable};
    }

    if (degree === 2) {
        // ax^2 + bx + c = 0
        const a = polyCoefficient(difference, 2);
        const b = polyCoefficient(difference, 1);
        const c = polyCoefficient(difference, 0);
        const discriminant = ratSub(ratMul(b, b), ratMul(ratMul(ratFromSmallInt(4), a), c));
        const twoA = ratMul(ratFromSmallInt(2), a);
        const negativeB = {n: b.n, d: b.d, neg: !b.neg};

        if (ratIsZero(discriminant)) {
            const text = ratToDisplayString(ratDiv(negativeB, twoA), policy);
            return {ok: true, text: text, solutions: [text], note: "exact", variable: variable};
        }
        if (discriminant.neg) {
            // 共轭复根
            const realPart = ratDiv(negativeB, twoA);
            const absDiscriminant = {n: discriminant.n, d: discriminant.d, neg: false};
            const imagPart = ratDiv(numberToRat(Math.sqrt(fixToNumber(ratToFix(absDiscriminant)))), twoA);
            const realText = ratToDisplayString(realPart, policy);
            const imagText = ratToDisplayString(imagPart, policy);
            if (realText === "0") {
                // 实部为 0 时不要写成 "0+2i"，直接给出 ±2i
                const plus = imagText + "i";
                return {ok: true, text: plus + " 或 -" + plus, solutions: [plus, "-" + plus],
                    note: "complex", variable: variable};
            }
            const plus = realText + "+" + imagText + "i";
            const minus = realText + "-" + imagText + "i";
            return {ok: true, text: plus + " 或 " + minus, solutions: [plus, minus],
                note: "complex", variable: variable};
        }
        const root = numberToRat(Math.sqrt(fixToNumber(ratToFix(discriminant))));
        const first = ratDiv(ratSub(negativeB, root), twoA);
        const second = ratDiv(ratAdd(negativeB, root), twoA);
        const firstText = ratToDisplayString(first, policy);
        const secondText = ratToDisplayString(second, policy);
        const solutions = firstText === secondText ? [firstText] : [firstText, secondText];
        return {ok: true, text: solutions.join(" 或 "), solutions: solutions,
            note: "exact", variable: variable};
    }

    // 三次及以上：牛顿迭代求一个实根
    const realRoot = newtonRealRoot(difference);
    if (realRoot === null) {
        return {ok: false, error: "无法求解该方程"};
    }
    // 数值解默认只显示 10 位有效数字，避免一长串无意义的尾数
    const effective = policyIsExact(policy) ?
        normalizePolicy({roundMode: "digits", roundDigits: NUMERIC_DEFAULT_DIGITS}) : policy;
    const text = ratToDisplayString(realRoot, effective);
    return {ok: true, text: text, solutions: [text], note: "numeric", variable: variable};
};

/**
 * 牛顿迭代求一个实根。
 *
 * 这里刻意用双精度做迭代：牛顿法本就是数值方法，若每步都用精确有理数，
 * 分母会指数级膨胀（实测三次方程要 80 秒以上）。迭代收敛后再把结果
 * 转回有理数，并对接近整数 / 简单有理数的解做「吸附」，
 * 这样 x^4=16 会显示 2 而不是 2.0000000000001。
 */
export const newtonRealRoot = (poly) => {
    const coefficients = polyToDoubleCoefficients(poly);
    const degree = coefficients.length - 1;
    if (degree < 1) {
        return null;
    }
    const evaluate = (x) => {
        let total = 0;
        for (let i = coefficients.length - 1; i >= 0; i--) {
            total = total * x + coefficients[i];
        }
        return total;
    };
    const evaluateDerivative = (x) => {
        let total = 0;
        for (let i = coefficients.length - 1; i >= 1; i--) {
            total = total * x + i * coefficients[i];
        }
        return total;
    };

    const starts = [0, 1, -1, 2, -2, 7, -7, 0.5, -0.5];
    for (const start of starts) {
        let x = start;
        for (let i = 0; i < NEWTON_MAX_ITERATIONS; i++) {
            const value = evaluate(x);
            if (!isFinite(value)) {
                break;
            }
            if (Math.abs(value) < 1e-14) {
                return doubleToCleanRat(x);
            }
            const slope = evaluateDerivative(x);
            if (!isFinite(slope) || Math.abs(slope) < 1e-300) {
                break;
            }
            const delta = value / slope;
            x -= delta;
            if (!isFinite(x)) {
                break;
            }
            if (Math.abs(delta) < 1e-15 * Math.max(1, Math.abs(x))) {
                break;
            }
        }
        if (isFinite(x) && Math.abs(evaluate(x)) < 1e-9) {
            return doubleToCleanRat(x);
        }
    }
    return null;
};

/** 把多项式系数转成双精度数组（下标即次数） */
const polyToDoubleCoefficients = (poly) => {
    const degree = polyDegree(poly);
    if (degree < 0) {
        return [0];
    }
    const out = new Array(degree + 1).fill(0);
    poly.coeffs.forEach((coefficient, power) => {
        out[power] = fixToNumber(ratToFix(coefficient));
    });
    return out;
};

/**
 * 双精度结果 -> 有理数。
 * 优先吸附到附近的三位以内小数（含整数），否则保留 12 位小数。
 */
const doubleToCleanRat = (value) => {
    if (!isFinite(value)) {
        return null;
    }
    const rounded = Math.round(value);
    if (rounded !== 0 && Math.abs(value - rounded) <= Math.abs(value) * 1e-12) {
        return ratFromSmallInt(rounded);
    }
    if (rounded === 0 && Math.abs(value) < 1e-12) {
        return ratZeroValue();
    }
    return numberToRat(value);
};

export const __test__ = {
    fixToRatExact: fixToRatExact,
    numberToRat: numberToRat,
    ratFromSmallInt: ratFromSmallInt,
    ratToDisplayString: ratToDisplayString,
    polyEvaluate: polyEvaluate,
    polyDerivative: polyDerivative
};
