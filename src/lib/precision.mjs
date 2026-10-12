/*!
 * 等号计算 (Equals Calc) —— 结果显示精度
 *
 * 计算本身始终用精确有理数，这个模块只负责「把结果写成什么样的字符串」。
 * 三种模式：
 *   exact  —— 精确值（默认，能除尽就原样显示，除不尽保留内置的 40 位）
 *   places —— 固定小数位数（四舍五入，末尾多余的 0 去掉）
 *   digits —— 固定有效数字位数
 *
 * 两种模式最终都归约为「按 10^k 的整数倍量化」：
 *   小数位      ->  量化到 10^(-places)
 *   有效数字    ->  量化到 10^(exponent - digits + 1)
 * 其中 9.99 取 3 位有效数字要让位给进位后的 10（量子从 0.01 放粗到 0.1），
 * 所以量化后如果量级被抬高，会用量级修正过的量子再量化一次。
 *
 * 约定：所有数字数组都是「高位在前」，与 number.mjs 保持一致。
 */

import {
    addDigits,
    compareDigits,
    divMod,
    isZeroDigits,
    ratDiv,
    ratMul,
    ratNorm,
    shiftLeft,
    trimLeading
} from "./number.mjs";

export const ROUND_MODES = ["exact", "places", "digits"];

/**
 * 规范化精度设置。
 * @param {{roundMode?: string, roundDigits?: number|string}} options
 */
export const normalizePolicy = (options) => {
    const raw = options || {};
    const mode = ROUND_MODES.includes(raw.roundMode) ? raw.roundMode : "exact";
    let digits = Number.parseInt(raw.roundDigits, 10);
    if (!Number.isFinite(digits)) {
        digits = 6;
    }
    // 小数位 0~15；有效数字 1~15（再多也会被内部位数限制住）
    digits = Math.max(mode === "digits" ? 1 : 0, Math.min(15, digits));
    return {mode: mode, digits: digits};
};

/** 是否需要对结果做舍入 */
export const policyIsExact = (policy) => !policy || policy.mode === "exact";

/** 数字数组当成整数（高位在前） */
const ratFromArray = (digits) => ratNorm(trimLeading(digits), [1], false);

/** 10^k 对应的有理数，k 可以为负 */
const ratPow10 = (k) => (k >= 0 ?
    ratFromArray([1].concat(new Array(k).fill(0))) :
    ratNorm([1], [1].concat(new Array(-k).fill(0)), false));

/**
 * 取有理数的十进制量级 exponent，使 10^exponent <= |value| < 10^(exponent+1)。
 * 例如 1234.5678 -> 3；0.001234 -> -3。
 */
export const magnitude = (rational) => {
    const n = trimLeading(rational.n);
    const d = trimLeading(rational.d);
    if (isZeroDigits(n)) {
        return 0;
    }
    let exponent = n.length - d.length;
    if (exponent >= 0) {
        if (compareDigits(n, shiftLeft(d, exponent)) < 0) {
            exponent -= 1;
        }
    } else if (compareDigits(shiftLeft(n, -exponent), d) < 0) {
        exponent -= 1;
    }
    return exponent;
};

/**
 * 量化：把 value 舍入到 quantum 的整数倍（quantum 必须是 10 的整数次幂）。
 * @param {{n:number[], d:number[], neg:boolean}} value 非负
 * @param {number} k 10 的指数
 */
const quantize = (value, k) => {
    // value / 10^k  ->  n / d
    let scaledN = trimLeading(value.n);
    let scaledD = trimLeading(value.d);
    if (k >= 0) {
        scaledD = shiftLeft(scaledD, k);
    } else {
        scaledN = shiftLeft(scaledN, -k);
    }
    const direct = divMod(scaledN, scaledD);
    let quotient = direct.quotient;
    if (!isZeroDigits(direct.remainder)) {
        // 余数过半则进位：余数 × 2 >= 除数  <=>  余数 >= 除数 / 2
        // （shiftLeft 是乘 10 而不是乘 2，所以和「除数的一半」比较）
        const half = divMod(scaledD, [2]).quotient;
        if (compareDigits(direct.remainder, half) >= 0) {
            quotient = addDigits(quotient, [1]);
        }
    }
    return ratMul(ratFromArray(quotient), ratPow10(k));
};

/**
 * 按精度设置舍入。
 * @param {{n:number[], d:number[], neg:boolean}} rational
 * @param {{mode:string, digits:number}} policy
 * @returns {{n:number[], d:number[], neg:boolean}}
 */
export const roundRational = (rational, policy) => {
    const value = {n: trimLeading(rational.n), d: trimLeading(rational.d), neg: rational.neg};
    if (policyIsExact(policy) || isZeroDigits(value.n)) {
        return value;
    }
    if (policy.mode === "places") {
        const rounded = quantize(value, -policy.digits);
        return {n: rounded.n, d: rounded.d, neg: value.neg};
    }

    // 有效数字：量化到 10^(exponent - digits + 1)
    //   1234.5678 取 2 位 -> exponent 3，量化到 100 -> 1200
    //   9.99 取 3 位      -> exponent 0，量化到 0.01 -> 9.99
    const exponent = magnitude(value);
    let step = exponent - policy.digits + 1;
    let rounded = quantize(value, step);
    // 量化把量级抬高时（9.99 取 3 位，量化到 0.01 本身不成问题，
    // 但例如 9.96 取 2 位会得到 10），用抬高后的量级再量化一次，
    // 让量子与最终量级匹配。
    while (magnitude(rounded) > exponent) {
        const nextStep = magnitude(rounded) - policy.digits + 1;
        if (nextStep <= step) {
            break;
        }
        step = nextStep;
        rounded = quantize(value, step);
    }
    return {n: rounded.n, d: rounded.d, neg: value.neg};
};

/** 便捷入口：接收 {n, d, neg}，返回舍入后的 {n, d, neg} */
export const applyPrecision = (rational, policy) => {
    const rounded = roundRational(rational, policy);
    return ratNorm(rounded.n, rounded.d, rounded.neg);
};

export const __test__ = {
    quantize: quantize,
    ratPow10: ratPow10,
    ratDiv: ratDiv
};
