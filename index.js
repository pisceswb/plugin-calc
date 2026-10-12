/*!
 * 等号计算 (Equals Calc) —— 思源笔记插件
 *
 * 在编辑器里输入以等号结尾的算式并回车，自动把结果补在等号后面。
 * 本文件由 build.mjs 从 src/ 生成，请直接修改 src/ 下的源码。
 *
 * 计算不使用 eval / new Function：表达式解析与十进制高精度运算都是自己实现的，
 * 因此 0.1 + 0.2 会得到 0.3，大整数也不会丢精度。
 *
 * MIT License
 */
(function () {
    "use strict";

    /** 模块表：首次 require 时执行工厂函数并缓存导出 */
    const __registry = {};
    const __cache = {};

    function __require(id) {
        if (id === "siyuan") {
            return require("siyuan");
        }
        if (Object.prototype.hasOwnProperty.call(__cache, id)) {
            return __cache[id].exports;
        }
        const factory = __registry[id];
        if (!factory) {
            throw new Error("[plugin-calc] 未注册的模块: " + id);
        }
        const module = {exports: {}};
        __cache[id] = module;
        factory(module, module.exports, __require);
        return module.exports;
    }

    /* ---------------- src/lib/number.mjs ---------------- */
    __registry["lib/number"] = function (module, exports, __require) {
/*!
 * 等号计算 (Equals Calc) —— 十进制高精度算术
 *
 * 不依赖思源笔记 API，也不使用 eval / new Function，可直接在 Node.js 中测试。
 *
 * 唯一约定：数字用「高位在前」的数字数组表示，和书写顺序完全一致。
 *   "60"  -> [6, 0]
 *   "103" -> [1, 0, 3]
 * 于是 digitsToString 就是 join，digitsOfString 就是 split —— 没有方向歧义。
 *
 * 小数用 {int, scale, neg}：值 = (int 当整数读) / 10^scale。
 *   0.125 -> {int: [1,2,5], scale: 3, neg: false}
 *   0.05  -> {int: [5],     scale: 2, neg: false}   （int 去掉前导 0，但 scale 保留）
 * scale 与 int 相互独立，所以 0.05 不会退化成 0.5。
 *
 * 加减乘除都对「高位在前」的数组做右侧对齐运算，逻辑和手算一致。
 */

const DIGIT_CHARS = "0123456789";
const SCALE_MAX = 40; // 除法最多展开的小数位

/* ------------------------------------------------------------------ *
 * 1. 十进制数字数组
 * ------------------------------------------------------------------ */

/** 数字数组 -> 字符串（高位在前，直接拼接） */
const digitsToString = (digits) => {
    if (digits.length === 0) {
        return "0";
    }
    let text = "";
    for (let i = 0; i < digits.length; i++) {
        text += DIGIT_CHARS[digits[i]];
    }
    return text;
};

/** 去掉前导 0；全为 0 时返回 [0] */
const trimLeading = (digits) => {
    let start = 0;
    while (start < digits.length - 1 && digits[start] === 0) {
        start++;
    }
    return digits.slice(start);
};

/** 左边补 0 到指定长度（高位在前，所以补在前面） */
const padLeft = (digits, length) => {
    const out = digits.slice();
    while (out.length < length) {
        out.unshift(0);
    }
    return out;
};

/** 比较大小 */
const compareDigits = (a, b) => {
    const left = trimLeading(a);
    const right = trimLeading(b);
    if (left.length !== right.length) {
        return left.length > right.length ? 1 : -1;
    }
    for (let i = 0; i < left.length; i++) {
        if (left[i] !== right[i]) {
            return left[i] > right[i] ? 1 : -1;
        }
    }
    return 0;
};

/** 加法 */
const addDigits = (a, b) => {
    const length = Math.max(a.length, b.length);
    const left = padLeft(a, length);
    const right = padLeft(b, length);
    const out = new Array(length).fill(0);
    let carry = 0;
    for (let i = length - 1; i >= 0; i--) {
        const sum = left[i] + right[i] + carry;
        out[i] = sum % 10;
        carry = sum >= 10 ? 1 : 0;
    }
    if (carry > 0) {
        out.unshift(carry);
    }
    return trimLeading(out);
};

/** a - b，要求 a >= b */
const subDigits = (a, b) => {
    const length = Math.max(a.length, b.length);
    const left = padLeft(a, length);
    const right = padLeft(b, length);
    const out = new Array(length).fill(0);
    let borrow = 0;
    for (let i = length - 1; i >= 0; i--) {
        let diff = left[i] - right[i] - borrow;
        if (diff < 0) {
            diff += 10;
            borrow = 1;
        } else {
            borrow = 0;
        }
        out[i] = diff;
    }
    return trimLeading(out);
};

/** 乘法 */
const mulDigits = (a, b) => {
    const left = trimLeading(a);
    const right = trimLeading(b);
    if (digitsToString(left) === "0" || digitsToString(right) === "0") {
        return [0];
    }
    const out = new Array(left.length + right.length).fill(0);
    for (let i = left.length - 1; i >= 0; i--) {
        for (let j = right.length - 1; j >= 0; j--) {
            const position = i + j + 1;
            out[position] += left[i] * right[j];
        }
    }
    for (let k = out.length - 1; k > 0; k--) {
        const carry = Math.floor(out[k] / 10);
        out[k] %= 10;
        out[k - 1] += carry;
    }
    return trimLeading(out);
};

/** 乘以 10^k：末尾补 k 个 0 */
const shiftLeft = (digits, k) => {
    const base = trimLeading(digits);
    if (digitsToString(base) === "0" || k <= 0) {
        return base;
    }
    return base.concat(new Array(k).fill(0));
};

/** 10 的 k 次方 */
const pow10 = (k) => (k <= 0 ? [1] : [1].concat(new Array(k).fill(0)));

/** 取个位 */
const units = (digits) => (digits.length === 0 ? 0 : digits[digits.length - 1]);

/** 字符串 -> 数字数组（高位在前，直接拆字符） */
const digitsOfString = (text) => {
    const out = [];
    for (let i = 0; i < text.length; i++) {
        out.push(text.charCodeAt(i) - 48);
    }
    return trimLeading(out);
};

const isZeroDigits = (digits) => digitsToString(trimLeading(digits)) === "0";

/**
 * 除法：返回 {quotient, remainder}。
 * 竖式长除法，从最高位开始逐位试商；每一步余数都小于「除数 × 10」，
 * 所以商只会是 0~9，用高位估商后向下修正一次即可。
 */
const divMod = (a, b) => {
    const divisor = trimLeading(b);
    if (isZeroDigits(divisor)) {
        throw new Error("divide by zero");
    }
    const dividend = trimLeading(a);
    const quotient = [];
    let remainder = [0];
    for (let i = 0; i < dividend.length; i++) {
        // 「余数 × 10 + 当前位」。
        // 注意 shiftLeft 已经在末尾补了一个 0（那就是「×10」的个位），
        // 所以直接把当前位放到数组最后，不能 concat 到末尾之外。
        const shifted = shiftLeft(remainder, 1);
        shifted[shifted.length - 1] = dividend[i];
        remainder = trimLeading(shifted);
        let digit = 0;
        const cmp = compareDigits(remainder, divisor);
        if (cmp > 0) {
            const remainderText = digitsToString(remainder);
            const divisorText = digitsToString(divisor);
            const approx = Math.floor(
                parseInt(remainderText.slice(0, 16), 10) / parseInt(divisorText.slice(0, 16), 10)
            );
            digit = isFinite(approx) && approx > 0 ? approx : 1;
            if (digit > 9) {
                digit = 9;
            }
            let product = mulDigits(divisor, [digit]);
            if (compareDigits(product, remainder) > 0) {
                digit--;
                product = mulDigits(divisor, [digit]);
            }
            remainder = subDigits(padLeft(remainder, product.length), product);
        } else if (cmp === 0) {
            digit = 1;
            remainder = [0];
        }
        quotient.push(digit);
    }
    return {quotient: trimLeading(quotient), remainder: trimLeading(remainder)};
};

/* ------------------------------------------------------------------ *
 * 2. 定点数：{int, scale, neg}，值 = ±int / 10^scale
 * ------------------------------------------------------------------ */

const fixZero = () => ({int: [0], scale: 0, neg: false});
const fixIsZero = (f) => isZeroDigits(f.int);
const fixNorm = (int, scale, neg) => {
    const trimmed = trimLeading(int);
    if (isZeroDigits(trimmed)) {
        return fixZero();
    }
    return {int: trimmed, scale: scale, neg: neg};
};

/** 取负：0 保持不带负号 */
const fixNeg = (f) => (fixIsZero(f) ? fixZero() : fixNorm(f.int, f.scale, !f.neg));

/** 定点数 -> 字符串 */
const fixToString = (f) => {
    if (fixIsZero(f)) {
        return "0";
    }
    // 把 int 补到至少 scale+1 位，再按 scale 切开
    const padded = padLeft(f.int, f.scale + 1);
    const split = padded.length - f.scale;
    const intPart = digitsToString(padded.slice(0, split));
    const fracPart = digitsToString(padded.slice(split)).replace(/0+$/, "");
    return (f.neg ? "-" : "") + (fracPart === "" ? intPart : intPart + "." + fracPart);
};

/** 定点数 -> JS number（用于 Math.* 入参） */
const fixToNumber = (f) => {
    const value = parseFloat(digitsToString(f.int)) / Math.pow(10, f.scale);
    return f.neg ? -value : value;
};

/** 定点数 -> 有理数 {n, d, neg} */
const fixToRat = (f) => ({n: trimLeading(f.int), d: pow10(f.scale), neg: f.neg});

/* ------------------------------------------------------------------ *
 * 3. 有理数：{n, d, neg}，值 = ±n / d
 * ------------------------------------------------------------------ */

const ratZero = () => ({n: [0], d: [1], neg: false});
const ratIsZero = (r) => isZeroDigits(r.n);
const ratNorm = (n, d, neg) => {
    if (isZeroDigits(n)) {
        return ratZero();
    }
    return {n: trimLeading(n), d: trimLeading(d), neg: neg};
};

const ratAdd = (a, b) => {
    if (ratIsZero(a)) {
        return b;
    }
    if (ratIsZero(b)) {
        return a;
    }
    const na = mulDigits(a.n, b.d);
    const nb = mulDigits(b.n, a.d);
    const d = mulDigits(a.d, b.d);
    if (a.neg === b.neg) {
        return ratNorm(addDigits(na, nb), d, a.neg);
    }
    const cmp = compareDigits(na, nb);
    if (cmp === 0) {
        return ratZero();
    }
    return cmp > 0 ? ratNorm(subDigits(na, nb), d, a.neg) : ratNorm(subDigits(nb, na), d, b.neg);
};

const ratNeg = (r) => (ratIsZero(r) ? ratZero() : {n: r.n, d: r.d, neg: !r.neg});
const ratSub = (a, b) => ratAdd(a, ratNeg(b));
const ratMul = (a, b) => {
    if (ratIsZero(a) || ratIsZero(b)) {
        return ratZero();
    }
    return ratNorm(mulDigits(a.n, b.n), mulDigits(a.d, b.d), a.neg !== b.neg);
};

/** 精确除法；除不尽时四舍五入到 SCALE_MAX 位小数 */
const ratDiv = (a, b) => {
    if (ratIsZero(b)) {
        throw new Error("divide by zero");
    }
    if (ratIsZero(a)) {
        return ratZero();
    }
    const neg = a.neg !== b.neg;
    const numerator = mulDigits(a.n, b.d);
    const denominator = mulDigits(a.d, b.n);
    const direct = divMod(numerator, denominator);
    if (isZeroDigits(direct.remainder)) {
        return ratNorm(direct.quotient, [1], neg);
    }
    const fracDigits = [];
    let remainder = direct.remainder;
    for (let i = 0; i < SCALE_MAX; i++) {
        const step = divMod(shiftLeft(remainder, 1), denominator);
        fracDigits.push(units(step.quotient));
        remainder = step.remainder;
        if (isZeroDigits(remainder)) {
            break;
        }
    }
    if (!isZeroDigits(remainder)) {
        // 还有余数：四舍五入（末位进位）
        const step = divMod(shiftLeft(remainder, 1), denominator);
        if (units(step.quotient) >= 5) {
            let carry = 1;
            for (let i = fracDigits.length - 1; i >= 0 && carry > 0; i--) {
                if (fracDigits[i] + carry >= 10) {
                    fracDigits[i] = 0;
                } else {
                    fracDigits[i] += carry;
                    carry = 0;
                }
            }
            if (carry > 0) {
                return ratNorm(addDigits(direct.quotient, [1]), [1], neg);
            }
        }
    }
    // 值 = 整数部分 + 小数部分 / 10^k，写成分数就是 (整数部分*10^k + 小数部分) / 10^k
    const scale = fracDigits.length;
    const combined = addDigits(shiftLeft(direct.quotient, scale), fracDigits);
    return ratNorm(combined, pow10(scale), neg);
};

/** 有理数 -> 定点数 */
const ratToFix = (r) => {
    if (ratIsZero(r)) {
        return fixZero();
    }
    const direct = divMod(r.n, r.d);
    if (isZeroDigits(direct.remainder)) {
        return fixNorm(direct.quotient, 0, r.neg);
    }
    const fracDigits = [];
    let remainder = direct.remainder;
    for (let i = 0; i < SCALE_MAX; i++) {
        const step = divMod(shiftLeft(remainder, 1), r.d);
        fracDigits.push(units(step.quotient));
        remainder = step.remainder;
        if (isZeroDigits(remainder)) {
            break;
        }
    }
    if (!isZeroDigits(remainder)) {
        const step = divMod(shiftLeft(remainder, 1), r.d);
        if (units(step.quotient) >= 5) {
            let carry = 1;
            for (let i = fracDigits.length - 1; i >= 0 && carry > 0; i--) {
                if (fracDigits[i] + carry >= 10) {
                    fracDigits[i] = 0;
                } else {
                    fracDigits[i] += carry;
                    carry = 0;
                }
            }
            if (carry > 0) {
                return fixNorm(addDigits(direct.quotient, [1]), 0, r.neg);
            }
        }
    }
    const scale = fracDigits.length;
    const combined = addDigits(shiftLeft(direct.quotient, scale), fracDigits);
    return fixNorm(combined, scale, r.neg);
};

/** 字符串 -> 定点数 */
const fixFromString = (text) => {
    const negative = text.charAt(0) === "-";
    const body = negative ? text.slice(1) : text;
    const dot = body.indexOf(".");
    const intText = dot === -1 ? body : body.slice(0, dot);
    const fracText = dot === -1 ? "" : body.slice(dot + 1);
    const combined = digitsOfString((intText === "" ? "0" : intText) + fracText);
    return fixNorm(combined, fracText.length, negative);
};

/** JS number -> 定点数（最多 12 位小数） */
const numberToFix = (value) => {
    if (!isFinite(value) || isNaN(value)) {
        throw new Error("not a finite number");
    }
    return fixFromString(value.toFixed(12).replace(/0+$/, "").replace(/\.$/, ""));
};

/* ------------------------------------------------------------------ *
 * 4. 复数：{re, im}
 * ------------------------------------------------------------------ */

const cZero = () => ({re: fixZero(), im: fixZero()});
const cFromFix = (f) => ({re: f, im: fixZero()});
const cFromNumber = (value) => ({re: numberToFix(value), im: fixZero()});
/** 由有理数构造复数，不经过定点数，避免多项式系数被截断 */
const cFromRat = (rational) => ({re: ratToFix(rational), im: fixZero()});
const cIsReal = (c) => fixIsZero(c.im);
const cNeg = (c) => ({
    re: ratToFix(ratNeg(fixToRat(c.re))),
    im: ratToFix(ratNeg(fixToRat(c.im)))
});
/** 共轭：多项式求值需要 */
const cConjugate = (c) => ({re: c.re, im: fixNeg(c.im)});
const cAdd = (a, b) => ({
    re: ratToFix(ratAdd(fixToRat(a.re), fixToRat(b.re))),
    im: ratToFix(ratAdd(fixToRat(a.im), fixToRat(b.im)))
});
const cSub = (a, b) => ({
    re: ratToFix(ratSub(fixToRat(a.re), fixToRat(b.re))),
    im: ratToFix(ratSub(fixToRat(a.im), fixToRat(b.im)))
});

/** (a+bi)(c+di) = (ac-bd) + (ad+bc)i */
const cMul = (a, b) => ({
    re: ratToFix(ratSub(ratMul(fixToRat(a.re), fixToRat(b.re)), ratMul(fixToRat(a.im), fixToRat(b.im)))),
    im: ratToFix(ratAdd(ratMul(fixToRat(a.re), fixToRat(b.im)), ratMul(fixToRat(a.im), fixToRat(b.re))))
});

/** (a+bi)/(c+di) = ((ac+bd) + (bc-ad)i) / (c²+d²) */
const cDiv = (a, b) => {
    const denominator = ratAdd(ratMul(fixToRat(b.re), fixToRat(b.re)), ratMul(fixToRat(b.im), fixToRat(b.im)));
    if (ratIsZero(denominator)) {
        throw new Error("divide by zero");
    }
    const ac = ratMul(fixToRat(a.re), fixToRat(b.re));
    const bd = ratMul(fixToRat(a.im), fixToRat(b.im));
    const bc = ratMul(fixToRat(a.im), fixToRat(b.re));
    const ad = ratMul(fixToRat(a.re), fixToRat(b.im));
    return {
        re: ratToFix(ratDiv(ratAdd(ac, bd), denominator)),
        im: ratToFix(ratDiv(ratSub(bc, ad), denominator))
    };
};

/** 复数 -> 字符串；虚部为 0 时只显示实部 */
const complexToString = (c) => {
    if (fixIsZero(c.im)) {
        return fixToString(c.re);
    }
    const imAbs = {int: c.im.int, scale: c.im.scale, neg: false};
    const imText = fixToString(imAbs) === "1" ? "i" : fixToString(imAbs) + "i";
    if (fixIsZero(c.re)) {
        return (c.im.neg ? "-" : "") + imText;
    }
    return fixToString(c.re) + (c.im.neg ? "-" : "+") + imText;
};



    module.exports = {
    "DIGIT_CHARS": DIGIT_CHARS,
    "SCALE_MAX": SCALE_MAX,
    "digitsToString": digitsToString,
    "trimLeading": trimLeading,
    "padLeft": padLeft,
    "compareDigits": compareDigits,
    "addDigits": addDigits,
    "subDigits": subDigits,
    "mulDigits": mulDigits,
    "shiftLeft": shiftLeft,
    "pow10": pow10,
    "units": units,
    "digitsOfString": digitsOfString,
    "isZeroDigits": isZeroDigits,
    "divMod": divMod,
    "fixZero": fixZero,
    "fixIsZero": fixIsZero,
    "fixNeg": fixNeg,
    "fixNorm": fixNorm,
    "fixToString": fixToString,
    "fixToNumber": fixToNumber,
    "fixToRat": fixToRat,
    "fixFromString": fixFromString,
    "numberToFix": numberToFix,
    "ratZero": ratZero,
    "ratIsZero": ratIsZero,
    "ratNorm": ratNorm,
    "ratAdd": ratAdd,
    "ratSub": ratSub,
    "ratMul": ratMul,
    "ratDiv": ratDiv,
    "ratToFix": ratToFix,
    "cZero": cZero,
    "cFromFix": cFromFix,
    "cFromNumber": cFromNumber,
    "cFromRat": cFromRat,
    "cIsReal": cIsReal,
    "cNeg": cNeg,
    "cConjugate": cConjugate,
    "cAdd": cAdd,
    "cSub": cSub,
    "cMul": cMul,
    "cDiv": cDiv,
    "complexToString": complexToString
    };
    };

    /* ---------------- src/lib/precision.mjs ---------------- */
    __registry["lib/precision"] = function (module, exports, __require) {
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

const {addDigits, compareDigits, divMod, isZeroDigits, ratDiv, ratMul, ratNorm, shiftLeft, trimLeading} = __require("lib/number");

const ROUND_MODES = ["exact", "places", "digits"];

/**
 * 规范化精度设置。
 * @param {{roundMode?: string, roundDigits?: number|string}} options
 */
const normalizePolicy = (options) => {
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
const policyIsExact = (policy) => !policy || policy.mode === "exact";

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
const magnitude = (rational) => {
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
const roundRational = (rational, policy) => {
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
const applyPrecision = (rational, policy) => {
    const rounded = roundRational(rational, policy);
    return ratNorm(rounded.n, rounded.d, rounded.neg);
};

const __test__ = {
    quantize: quantize,
    ratPow10: ratPow10,
    ratDiv: ratDiv
};

    module.exports = {
    "ROUND_MODES": ROUND_MODES,
    "normalizePolicy": normalizePolicy,
    "policyIsExact": policyIsExact,
    "magnitude": magnitude,
    "roundRational": roundRational,
    "applyPrecision": applyPrecision,
    "__test__": __test__
    };
    };

    /* ---------------- src/lib/polynomial.mjs ---------------- */
    __registry["lib/polynomial"] = function (module, exports, __require) {
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

const {cAdd, cDiv, cFromFix, cIsReal, cMul, cZero, fixIsZero, fixToNumber, fixToString, numberToFix, ratAdd, ratDiv, ratIsZero, ratMul, ratNorm, ratSub, ratToFix, trimLeading} = __require("lib/number");
const {applyPrecision, normalizePolicy, policyIsExact} = __require("lib/precision");

/** 牛顿迭代上限，防止病态方程卡住 */
const NEWTON_MAX_ITERATIONS = 120;
/** 数值解在没有精度设置时的显示位数 */
const NUMERIC_DEFAULT_DIGITS = 10;

const ratZeroValue = () => ({n: [0], d: [1], neg: false});
const ratOneValue = () => ({n: [1], d: [1], neg: false});

/** 小整数 -> 有理数（导出给测试与调用方使用） */
const ratFromSmallInt = (value) => {
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

const polyZero = () => ({coeffs: new Map()});

const polyConst = (rational) => (ratIsZero(rational) ?
    polyZero() : {coeffs: new Map([[0, rational]])});

const polyVariable = () => ({coeffs: new Map([[1, ratOneValue()]])});

const polyIsZero = (poly) => poly.coeffs.size === 0;

/** 是否含未知量 */
const polyHasVariable = (poly) => {
    let found = false;
    poly.coeffs.forEach((coefficient, degree) => {
        if (degree > 0 && !ratIsZero(coefficient)) {
            found = true;
        }
    });
    return found;
};

/** 最高次数；零多项式返回 -1 */
const polyDegree = (poly) => {
    let degree = -1;
    poly.coeffs.forEach((coefficient, power) => {
        if (!ratIsZero(coefficient) && power > degree) {
            degree = power;
        }
    });
    return degree;
};

/** 按次数取系数（缺项为 0） */
const polyCoefficient = (poly, power) => poly.coeffs.get(power) || ratZeroValue();

const polyAdd = (a, b) => {
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

const polyNeg = (poly) => {
    const coeffs = new Map();
    poly.coeffs.forEach((coefficient, power) => {
        coeffs.set(power, {n: coefficient.n, d: coefficient.d, neg: !coefficient.neg});
    });
    return {coeffs: coeffs};
};

const polySub = (a, b) => polyAdd(a, polyNeg(b));

const polyMul = (a, b) => {
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
const polyPow = (poly, exponent) => {
    let result = polyConst(ratOneValue());
    for (let i = 0; i < exponent; i++) {
        result = polyMul(result, poly);
    }
    return result;
};

/** 求导 */
const polyDerivative = (poly) => {
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
const polyEvaluate = (poly, value) => {
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
const fixToRatExact = (fix) => {
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
const fixToDisplayString = (fix, policy) =>
    ratToDisplayString(fixToRatExact(fix), policy);

/** 按精度策略格式化复数 */
const complexToDisplayString = (value, policy) => {
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
const solveEquation = (left, right, variableName, policy) => {
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
const newtonRealRoot = (poly) => {
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

const __test__ = {
    fixToRatExact: fixToRatExact,
    numberToRat: numberToRat,
    ratFromSmallInt: ratFromSmallInt,
    ratToDisplayString: ratToDisplayString,
    polyEvaluate: polyEvaluate,
    polyDerivative: polyDerivative
};

    module.exports = {
    "ratFromSmallInt": ratFromSmallInt,
    "polyZero": polyZero,
    "polyConst": polyConst,
    "polyVariable": polyVariable,
    "polyIsZero": polyIsZero,
    "polyHasVariable": polyHasVariable,
    "polyDegree": polyDegree,
    "polyCoefficient": polyCoefficient,
    "polyAdd": polyAdd,
    "polyNeg": polyNeg,
    "polySub": polySub,
    "polyMul": polyMul,
    "polyPow": polyPow,
    "polyDerivative": polyDerivative,
    "polyEvaluate": polyEvaluate,
    "fixToRatExact": fixToRatExact,
    "fixToDisplayString": fixToDisplayString,
    "complexToDisplayString": complexToDisplayString,
    "solveEquation": solveEquation,
    "newtonRealRoot": newtonRealRoot,
    "__test__": __test__
    };
    };

    /* ---------------- src/lib/expr.mjs ---------------- */
    __registry["lib/expr"] = function (module, exports, __require) {
/*!
 * 等号计算 (Equals Calc) —— 表达式解析与求值
 *
 * 结算规则（与「顺序输入、按回车结算」的书写习惯一致）：
 *   12*5=            -> 12*5=60
 *   测试12*5=        -> 测试12*5=60
 *   12×5=            -> 12×5=60
 *   12×5=60*3=       -> 12×5=60*3=180    （前面算出的 60 参与后面的运算）
 *   a+3=5;a=         -> a+3=5;a=2        （一元方程求解）
 *
 * 语法：
 *   program := statement ((";"|",") statement)*
 *   statement := name "=" expr | expr
 *   expr    := term ("=" term)*          链式结算 / 方程
 *   term    := factor (("+"|"-") factor)*
 *   factor  := unary (("*"|"/") unary | 隐含乘法)*
 *   unary   := ("+"|"-") unary | power
 *   power   := postfix ("^" unary)?
 *   postfix := base ("%")*
 *   base    := number | name | name "(" args ")" | "(" expr ")"
 *
 * 括号里的优先级遵循常规算式习惯（先乘除后加减）。
 * 表达式里出现未知量且带等号时，交给 polynomial.mjs 当作一元方程求解。
 */

const {cAdd, cDiv, cFromFix, cFromNumber, cIsReal, cMul, cNeg, cSub, cZero, complexToString, digitsToString, fixFromString, fixIsZero, fixToNumber, fixToRat, numberToFix, ratDiv, ratToFix} = __require("lib/number");
const {normalizePolicy} = __require("lib/precision");
const {complexToDisplayString, polyAdd, polyConst, polyEvaluate, polyHasVariable, polyMul, polyNeg, polyPow, polySub, polyVariable, polyZero, solveEquation} = __require("lib/polynomial");

/* ------------------------------------------------------------------ *
 * 1. 字符规范化：全角符号、× ÷ 、π 等
 * ------------------------------------------------------------------ */

const FULLWIDTH_MAP = {
    "０": "0", "１": "1", "２": "2", "３": "3", "４": "4",
    "５": "5", "６": "6", "７": "7", "８": "8", "９": "9",
    "＋": "+", "－": "-", "＊": "*", "／": "/", "（": "(", "）": ")",
    "％": "%", "＾": "^", "．": ".", "，": ",", "；": ";", "＿": "_",
    "＝": "=", "　": " "
};

const OPERATOR_ALIAS = {
    "×": "*", "✕": "*", "✖": "*", "·": "*", "⋅": "*", "∙": "*", "∗": "*",
    "÷": "/", "∕": "/", "⁄": "/",
    "−": "-", "–": "-", "—": "-", "ー": "-",
    "π": "pi", "Π": "pi", "𝜋": "pi", "τ": "tau"
};

/**
 * 这个字符可以出现在待计算表达式里吗。
 * 等号也算在内，否则行内赋值 "a=3;a*2=" 往前收集时会在第一个等号处断开。
 */
const isExprChar = (ch) => {
    if (/[0-9a-zA-Z_]/.test(ch)) {
        return true;
    }
    if ("+-*/%^().,;_ \t\u00a0=".indexOf(ch) > -1) {
        return true;
    }
    return FULLWIDTH_MAP[ch] !== undefined || OPERATOR_ALIAS[ch] !== undefined;
};

const isEqualsChar = (ch) => ch === "=" || ch === "＝";

/** 统一成 ASCII，供分词使用 */
const normalizeExpression = (source) => {
    let out = "";
    for (let i = 0; i < source.length; i++) {
        const ch = source[i];
        out += OPERATOR_ALIAS[ch] !== undefined ? OPERATOR_ALIAS[ch] :
            FULLWIDTH_MAP[ch] !== undefined ? FULLWIDTH_MAP[ch] : ch;
    }
    return out;
};

/* ------------------------------------------------------------------ *
 * 2. 词法分析
 * ------------------------------------------------------------------ */

const T_NUM = "num";
const T_NAME = "name";
const T_OP = "op";
const T_LP = "(";
const T_RP = ")";
const T_SEP = ",";
const T_END = "end";

const calcError = (message, position) => {
    const error = new Error(message);
    error.name = "CalcError";
    error.position = position;
    return error;
};

const tokenize = (source) => {
    const tokens = [];
    let i = 0;
    while (i < source.length) {
        const ch = source[i];
        if (ch === " " || ch === "\t" || ch === "\u00a0") {
            i++;
            continue;
        }
        const start = i;
        if (/[0-9]/.test(ch) || (ch === "." && /[0-9]/.test(source[i + 1] || ""))) {
            let text = "";
            if (ch === ".") {
                text = "0.";
                i++;
                while (i < source.length && /[0-9]/.test(source[i])) {
                    text += source[i];
                    i++;
                }
            } else {
                while (i < source.length && /[0-9]/.test(source[i])) {
                    text += source[i];
                    i++;
                    // 千分位分隔符：只有「数字,三位数字」才吃掉，
                    // 这样 max(3,7,5) 的逗号仍然被当作参数分隔符
                    if (source[i] === "," && /^[0-9]{3}(?![0-9])/.test(source.slice(i + 1))) {
                        i++;
                    }
                }
                if (source[i] === ".") {
                    text += ".";
                    i++;
                    while (i < source.length && /[0-9]/.test(source[i])) {
                        text += source[i];
                        i++;
                    }
                }
            }
            tokens.push({type: T_NUM, text: text, start: start, end: i});
            continue;
        }
        if (/[A-Za-z_]/.test(ch)) {
            let text = "";
            while (i < source.length && /[A-Za-z0-9_]/.test(source[i])) {
                text += source[i];
                i++;
            }
            tokens.push({type: T_NAME, text: text, start: start, end: i});
            continue;
        }
        if (ch === "(" || ch === ")") {
            tokens.push({type: ch === "(" ? T_LP : T_RP, text: ch, start: start, end: start + 1});
            i++;
            continue;
        }
        if (ch === "," || ch === ";") {
            tokens.push({type: T_SEP, text: ch, start: start, end: start + 1});
            i++;
            continue;
        }
        if ("+-*/%^=".indexOf(ch) > -1) {
            if (ch === "*" && source[i + 1] === "*") {
                tokens.push({type: T_OP, text: "^", start: start, end: start + 2});
                i += 2;
                continue;
            }
            tokens.push({type: T_OP, text: ch, start: start, end: start + 1});
            i++;
            continue;
        }
        throw calcError("unexpected token", start);
    }
    tokens.push({type: T_END, text: "", start: source.length, end: source.length});
    return tokens;
};

/* ------------------------------------------------------------------ *
 * 3. 语法分析（按书写顺序，不实现乘除优先）
 * ------------------------------------------------------------------ */

const parse = (tokens) => {
    let pos = 0;
    const peek = (offset) => tokens[Math.min(pos + (offset || 0), tokens.length - 1)];
    const next = () => tokens[pos++];
    const isOp = (token, text) => token.type === T_OP && token.text === text;
    /** 结尾的 % 既能当取模也能当百分比：后面还有操作数就是取模 */
    const isModulo = (token) => isOp(token, "%") &&
        (peek(1).type === T_NUM || peek(1).type === T_NAME || peek(1).type === T_LP);

    /** 表达式末尾位置（用于行内赋值的写回边界） */
    const endOf = (node) => (node && node.end !== undefined ? node.end : pos);

    /**
     * 链式结算：segments[0] = segments[1] = …
     * 语义见 calculate()：最终结果取自最后一段。
     */
    const parseChain = () => {
        const first = parseTerm();
        const segments = [first];
        while (isOp(peek(), "=")) {
            next();
            segments.push(parseTerm());
        }
        if (segments.length === 1) {
            return first;
        }
        return {kind: "chain", segments: segments, start: first.start, end: endOf(segments[segments.length - 1])};
    };

    /**
     * 单个表达式。
     * 分隔符（, ;）只由语句序列和函数参数列表处理，这里不消费，
     * 否则 "a=3;a*2" 会被当成 a 赋值为 "3;a*2"。
     */
    const parseExpression = () => parseChain();

    const parseTerm = () => {
        let node = parseFactor();
        while (true) {
            const token = peek();
            if (isOp(token, "+") || isOp(token, "-") || isModulo(token)) {
                next();
                const right = parseFactor();
                node = {kind: "binary", op: isOp(token, "%") ? "mod" : token.text, left: node, right: right,
                    start: node.start, end: endOf(right)};
                continue;
            }
            break;
        }
        return node;
    };

    /** 下一个 token 是不是一个操作数（用于识别隐含乘法） */    /**
     * 隐含乘法的右操作数：
     *   2x、2pi、2(x+1)、(x+1)(x-1) 都成立；
     *   但 (1+2)3、2 3 这种「数字紧跟在后面」不成立，
     *   否则 "(1+2)3=" 会被算成 9 而不是报错。
     */
    const startsImplicitOperand = (token) => token.type === T_NAME || token.type === T_LP;

    const parseFactor = () => {
        let node = parseUnary();
        while (true) {
            const token = peek();
            if (isOp(token, "*") || isOp(token, "/") || isModulo(token)) {
                next();
                const right = parseUnary();
                node = {kind: "binary", op: isOp(token, "%") ? "mod" : token.text, left: node, right: right,
                    start: node.start, end: endOf(right)};
                continue;
            }
            // 隐含乘法：2x、2(x+1)、(x+1)(x-1)、2pi
            // parsePrimary 已把「名字 + (」当作函数调用，所以这里不会误伤 max(1,2)。
            if (startsImplicitOperand(token)) {
                const right = parseUnary();
                node = {kind: "binary", op: "*", left: node, right: right,
                    start: node.start, end: endOf(right), implicit: true};
                continue;
            }
            break;
        }
        return node;
    };

    const parseUnary = () => {
        const token = peek();
        if (isOp(token, "-") || isOp(token, "+")) {
            next();
            const operand = parseUnary();
            return {kind: "unary", op: token.text, operand: operand, start: token.start, end: endOf(operand)};
        }
        return parsePower();
    };

    /** 幂运算，右结合：2^3^2 = 2^9 */
    const parsePower = () => {
        const base = parsePostfix();
        if (isOp(peek(), "^")) {
            next();
            const right = parseUnary();
            return {kind: "binary", op: "^", left: base, right: right, start: base.start, end: endOf(right)};
        }
        return base;
    };

    const parsePostfix = () => {
        let node = parsePrimary();
        while (peek().type === T_OP && peek().text === "%" && !isModulo(peek())) {
            next();
            node = {kind: "percent", operand: node, start: node.start, end: endOf(node)};
        }
        return node;
    };

    const parsePrimary = () => {
        const token = next();
        if (token.type === T_NUM) {
            return {kind: "num", text: token.text, start: token.start, end: token.end};
        }
        if (token.type === T_NAME) {
            const args = [];
            let isCall = false;
            let callEnd = token.end;
            if (peek().type === T_LP) {
                next();
                isCall = true;
                if (peek().type !== T_RP) {
                    args.push(parseExpression());
                    while (peek().type === T_SEP) {
                        next();
                        args.push(parseExpression());
                    }
                }
                if (peek().type !== T_RP) {
                    throw calcError("missing )", peek().start);
                }
                callEnd = next().end;
            }
            return {kind: "name", text: token.text, args: args, isCall: isCall, start: token.start, end: callEnd};
        }
        if (token.type === T_LP) {
            const inner = parseExpression();
            if (peek().type !== T_RP) {
                throw calcError("missing )", peek().start);
            }
            next();
            return inner;
        }
        throw calcError("unexpected token", token.start);
    };

    /**
     * 程序：由分隔符连接的若干语句，取最后一条语句的值。
     *   "a=3;a*2" -> 先把 a 赋值为 3，再算 a*2
     */
    const parseStatement = () => {
        if (peek().type === T_NAME && isOp(peek(1), "=")) {
            const nameToken = next();
            next();
            return {
                kind: "assign",
                name: nameToken.text,
                value: parseExpression(),
                start: nameToken.start,
                end: nameToken.end
            };
        }
        return {kind: "expr", value: parseExpression()};
    };

    const statements = [parseStatement()];
    while (peek().type === T_SEP) {
        next();
        statements.push(parseStatement());
    }
    if (peek().type !== T_END) {
        throw calcError("unexpected token", peek().start);
    }
    return {kind: "program", statements: statements};
};

/* ------------------------------------------------------------------ *
 * 4. 求值
 * ------------------------------------------------------------------ */

const CONSTANTS = {
    pi: () => fixFromString("3.14159265358979323846"),
    e: () => fixFromString("2.718281828459045"),
    tau: () => fixFromString("6.283185307179586")
};

const isConstantName = (name) => Object.prototype.hasOwnProperty.call(CONSTANTS, name);

/**
 * 数学函数与幂运算的实现。
 * 抽出来是因为「数值求值」和「多项式求值」都要用同一份实现：
 * 前者整个表达式是数字，后者只在参数是常量时（如 sqrt(3)、cos(2)）用到。
 */
const createMathEnvironment = () => {
    /** 幂运算：非负整数指数精确计算，其余走 Math.pow */
    const complexPow = (base, exponent) => {
        if (!cIsReal(exponent)) {
            throw new Error("unsupported exponent");
        }
        const exponentFix = exponent.re;
        if (exponentFix.scale === 0 && !exponentFix.neg) {
            const times = parseInt(digitsToString(exponentFix.int), 10);
            if (isFinite(times) && times <= 64) {
                let result = cFromFix(fixFromString("1"));
                for (let i = 0; i < times; i++) {
                    result = cMul(result, base);
                }
                return result;
            }
        }
        if (!cIsReal(base)) {
            throw new Error("unsupported power");
        }
        const value = Math.pow(fixToNumber(base.re), fixToNumber(exponentFix));
        if (!isFinite(value)) {
            throw new Error("result is out of range");
        }
        return cFromNumber(value);
    };

    const callFunction = (name, args) => {
        const realArg = (index) => {
            if (index >= args.length) {
                throw new Error(name + "() missing argument");
            }
            if (!cIsReal(args[index])) {
                throw new Error(name + "() does not accept complex numbers");
            }
            return args[index].re;
        };
        const finite = (value) => {
            if (!isFinite(value)) {
                throw new Error("result is out of range");
            }
            return value;
        };
        /** 取整类函数：借用 Math.* 的结果重新构造定点数 */
        const roundViaMath = (fix, fn) => {
            const value = fn(fixToNumber(fix));
            if (!isFinite(value)) {
                throw new Error("result is out of range");
            }
            return numberToFix(value);
        };
        switch (name) {
            case "sqrt": {
                const value = realArg(0);
                if (value.neg) {
                    return {re: fixFromString("0"), im: numberToFix(Math.sqrt(-fixToNumber(value)))};
                }
                return cFromNumber(Math.sqrt(fixToNumber(value)));
            }
            case "abs":
                return cFromFix({int: realArg(0).int, scale: realArg(0).scale, neg: false});
            case "floor":
                return cFromFix(roundViaMath(realArg(0), Math.floor));
            case "ceil":
                return cFromFix(roundViaMath(realArg(0), Math.ceil));
            case "round":
                return cFromFix(roundViaMath(realArg(0), Math.round));
            case "trunc":
            case "int":
                return cFromFix(roundViaMath(realArg(0), Math.trunc));
            case "min": {
                let best = realArg(0);
                for (let i = 1; i < args.length; i++) {
                    const candidate = realArg(i);
                    if (fixToNumber(candidate) < fixToNumber(best)) {
                        best = candidate;
                    }
                }
                return cFromFix(best);
            }
            case "max": {
                let best = realArg(0);
                for (let i = 1; i < args.length; i++) {
                    const candidate = realArg(i);
                    if (fixToNumber(candidate) > fixToNumber(best)) {
                        best = candidate;
                    }
                }
                return cFromFix(best);
            }
            case "sum": {
                let total = cZero();
                args.forEach((item) => {
                    total = cAdd(total, item);
                });
                return total;
            }
            case "avg":
            case "mean": {
                if (args.length === 0) {
                    throw new Error("avg() missing argument");
                }
                let total = cZero();
                args.forEach((item) => {
                    total = cAdd(total, item);
                });
                return cDiv(total, cFromNumber(args.length));
            }
            case "log": {
                const value = realArg(0);
                if (value.neg || fixIsZero(value)) {
                    throw new Error("log() domain error");
                }
                if (args.length > 1) {
                    return cFromNumber(finite(Math.log(fixToNumber(value)) / Math.log(fixToNumber(realArg(1)))));
                }
                return cFromNumber(Math.log10(fixToNumber(value)));
            }
            case "ln": {
                const value = realArg(0);
                if (value.neg || fixIsZero(value)) {
                    throw new Error("ln() domain error");
                }
                return cFromNumber(Math.log(fixToNumber(value)));
            }
            case "exp":
                return cFromNumber(finite(Math.exp(fixToNumber(realArg(0)))));
            case "sin":
            case "cos":
            case "tan":
            case "asin":
            case "acos":
            case "atan":
                return cFromNumber(Math[name](fixToNumber(realArg(0))));
            case "pow":
                if (args.length < 2) {
                    throw new Error("pow() missing argument");
                }
                return complexPow(args[0], args[1]);
            default:
                throw new Error("unknown function: " + name);
        }
    };

    return {complexPow: complexPow, callFunction: callFunction};
};

/** 数值求值：返回复数结果，以及行内赋值产生的副作用 */
const evaluate = (statement) => {
    const variables = {};
    const effects = [];
    const environment = createMathEnvironment();
    const {complexPow, callFunction} = environment;

    const getVariable = (name) => {
        if (Object.prototype.hasOwnProperty.call(variables, name)) {
            return variables[name];
        }
        throw new Error("undefined variable: " + name);
    };

    /**
     * 链式结算：segments[0] = segments[1] = …
     *
     * 等号在书写里是「这里算出来了」的记号，链式写法中每一段都会把上一段的结果
     * 再计入一次（例如 12*5=60*3，第二段里的 60 就是第一段的结果），
     * 所以最终结果就是最后一段按常规优先级求出来的值。
     */
    const evalChain = (segments) => evalNode(segments[segments.length - 1]);

    const evalNode = (node) => {
        switch (node.kind) {
            case "num":
                return cFromFix(fixFromString(node.text));
            case "seq":
                evalNode(node.left);
                return evalNode(node.right);
            case "unary": {
                const operand = evalNode(node.operand);
                return node.op === "-" ? cNeg(operand) : operand;
            }
            case "percent":
                return cMul(cFromFix(fixFromString("0.01")), evalNode(node.operand));
            case "binary": {
                const left = evalNode(node.left);
                const right = evalNode(node.right);
                switch (node.op) {
                    case "+":
                        return cAdd(left, right);
                    case "-":
                        return cSub(left, right);
                    case "*":
                        return cMul(left, right);
                    case "/":
                        return cDiv(left, right);
                    case "mod": {
                        if (!cIsReal(left) || !cIsReal(right)) {
                            throw new Error("unsupported modulo");
                        }
                        const divisor = fixToNumber(right.re);
                        if (divisor === 0) {
                            throw new Error("divide by zero");
                        }
                        return cFromNumber(fixToNumber(left.re) % divisor);
                    }
                    case "^":
                        return complexPow(left, right);
                    default:
                        throw new Error("unsupported operator: " + node.op);
                }
            }
            case "chain":
                return evalChain(node.segments);
            case "name": {
                const lower = node.text.toLowerCase();
                if (!node.isCall) {
                    if (Object.prototype.hasOwnProperty.call(CONSTANTS, lower)) {
                        return cFromFix(CONSTANTS[lower]());
                    }
                    return getVariable(node.text);
                }
                return callFunction(lower, node.args.map(evalNode));
            }
            default:
                throw new Error("unsupported node: " + node.kind);
        }
    };

    const run = (node) => {
        if (node.kind === "program") {
            let value = cZero();
            let lastAssigned = null;
            node.statements.forEach((statement) => {
                value = run(statement);
                lastAssigned = statement.kind === "assign" ? statement.name : lastAssigned;
            });
            // "a=" 解析成「赋值 a，然后写变量名 a」；此时用刚赋进去的值作为结果
            if (lastAssigned !== null && node.statements[node.statements.length - 1].kind === "expr") {
                const lastValue = node.statements[node.statements.length - 1].value;
                if (lastValue && lastValue.kind === "name" && !lastValue.isCall &&
                    Object.prototype.hasOwnProperty.call(variables, lastValue.text)) {
                    return variables[lastValue.text];
                }
            }
            return value;
        }
        if (node.kind === "assign") {
            const value = evalNode(node.value);
            if (!cIsReal(value)) {
                throw new Error("assignment requires a real value");
            }
            variables[node.name] = value;
            effects.push({
                name: node.name,
                value: value,
                start: node.start,
                end: node.end
            });
            return value;
        }
        if (node.kind === "name" && !node.isCall &&
            Object.prototype.hasOwnProperty.call(variables, node.text)) {
            // 行内赋值后只写变量名的情形
            return variables[node.text];
        }
        return evalNode(node.value);
    };

    return {value: run(statement), effects: effects};
};

/* ------------------------------------------------------------------ *
 * 5. 对外接口
 * ------------------------------------------------------------------ */
/* ------------------------------------------------------------------ *
 * 6. 多项式求解（支持 a+3=5;a= 这类一元方程）
 *
 * 思路：等号两边各自求成「关于未知量的多项式」，移项后求解。
 * 只有在一元一次 / 一元二次 / 更高次的一元方程上才走这条路，
 * 其余情况仍是普通的链式结算。
 * ------------------------------------------------------------------ */

/** 复数 -> 多项式（虚部为 0 才可精确表示） */
const complexToPoly = (value) => {
    if (!cIsReal(value)) {
        throw new Error("结果不是实数，无法作为方程系数");
    }
    return polyConst(fixToRat(value.re));
};

/** 把节点求值成复数（用于 mod、以及函数参数） */
const complexOf = (node, context) => {
    const value = polyOf(node, context);
    if (polyHasVariable(value)) {
        throw new Error("这里不能含未知量");
    }
    return polyEvaluate(value, cZero());
};

/** 赋值语句的右值：必须是实数常量 */
const evalAssignmentValue = (node, context) => {
    const value = polyOf(node, context);
    if (polyHasVariable(value)) {
        throw new Error("赋值右值里不能含未知量");
    }
    const evaluated = polyEvaluate(value, cZero());
    if (!cIsReal(evaluated)) {
        throw new Error("赋值右值必须是实数");
    }
    return fixToRat(evaluated.re);
};

/** 收集 AST 里出现的变量名（不含函数名与内置常量） */
const collectVariableNames = (node, out) => {
    if (!node) {
        return out;
    }
    switch (node.kind) {
        case "program":
            node.statements.forEach((item) => collectVariableNames(item, out));
            break;
        case "assign":
            // 赋值左值不是未知量，但右值里可能有
            collectVariableNames(node.value, out);
            break;
        case "chain":
            node.segments.forEach((item) => collectVariableNames(item, out));
            break;
        case "unary":
            collectVariableNames(node.operand, out);
            break;
        case "percent":
            collectVariableNames(node.operand, out);
            break;
        case "binary":
            collectVariableNames(node.left, out);
            collectVariableNames(node.right, out);
            break;
        case "name":
            if (node.isCall) {
                node.args.forEach((item) => collectVariableNames(item, out));
            } else if (!isConstantName(node.text.toLowerCase())) {
                out.add(node.text);
            }
            break;
        default:
            break;
    }
    return out;
};

/** 记录方程解算结果，供 calculate 取用 */
const setEquationResult = (context, chainNode) => {
    const segments = chainNode.segments;
    if (segments.length !== 2) {
        throw new Error("暂不支持多重等号的方程");
    }
    const names = collectVariableNames(chainNode, new Set());
    // 已经赋过值的当常量，其余的才是未知量
    const unknowns = Array.from(names).filter((name) => !context.variables.has(name));
    if (unknowns.length === 0) {
        throw new Error("no unknown");
    }
    if (unknowns.length > 1) {
        throw new Error("方程里出现了多个未知量: " + unknowns.join(" 和 "));
    }
    const variable = unknowns[0];
    context.targetVariable = variable;
    const left = polyOf(segments[0], context);
    const right = polyOf(segments[1], context);
    const solution = solveEquation(left, right, variable, context.policy);
    if (!solution.ok) {
        throw new Error(solution.error);
    }
    context.equation = solution;
    return polyZero();
};

/** 求值：把 AST 节点变成多项式 */
const polyOf = (node, context) => {
    switch (node.kind) {
        case "num":
            return polyConst(fixToRat(fixFromString(node.text)));
        case "expr":
            // 语句包装节点（"expr" 里面才是真正的表达式）
            return polyOf(node.value, context);
        case "program": {
            let value = polyZero();
            node.statements.forEach((statement) => {
                value = polyOf(statement, context);
            });
            return value;
        }
        case "assign":
            // 方程里的赋值（如 "a=3;a*2="）先把右值记进符号表
            context.variables.set(node.name, evalAssignmentValue(node.value, context));
            return polyZero();
        case "chain":
            return setEquationResult(context, node);
        case "unary": {
            const operand = polyOf(node.operand, context);
            return node.op === "-" ? polyNeg(operand) : operand;
        }
        case "percent":
            return polyMul(polyConst(fixToRat(fixFromString("0.01"))), polyOf(node.operand, context));
        case "binary": {
            const left = polyOf(node.left, context);
            const right = polyOf(node.right, context);
            switch (node.op) {
                case "+":
                    return polyAdd(left, right);
                case "-":
                    return polySub(left, right);
                case "*":
                    return polyMul(left, right);
                case "/": {
                    if (polyHasVariable(right)) {
                        throw new Error("暂不支持除以含未知量的式子");
                    }
                    const divisor = polyEvaluate(right, cZero());
                    if (!cIsReal(divisor) || fixIsZero(divisor.re)) {
                        throw new Error("divide by zero");
                    }
                    const inverse = ratDiv(fixToRat(fixFromString("1")), fixToRat(divisor.re));
                    return polyMul(left, polyConst(inverse));
                }
                case "mod": {
                    const leftValue = complexOf(node.left, context);
                    const rightValue = complexOf(node.right, context);
                    if (!cIsReal(leftValue) || !cIsReal(rightValue)) {
                        throw new Error("unsupported modulo");
                    }
                    const divisor = fixToNumber(rightValue.re);
                    if (divisor === 0) {
                        throw new Error("divide by zero");
                    }
                    return polyConst(numberToRat(fixToNumber(leftValue.re) % divisor));
                }
                case "^": {
                    if (polyHasVariable(right)) {
                        throw new Error("指数里不能含未知量");
                    }
                    const exponentValue = polyEvaluate(right, cZero());
                    if (!cIsReal(exponentValue)) {
                        throw new Error("方程的幂指数必须是实数");
                    }
                    const exponentFix = exponentValue.re;
                    if (exponentFix.scale !== 0 || exponentFix.neg) {
                        throw new Error("方程的幂指数必须是非负整数");
                    }
                    const times = Number.parseInt(digitsToString(exponentFix.int), 10);
                    if (!Number.isFinite(times) || times > 16) {
                        throw new Error("幂次过大");
                    }
                    return polyPow(left, times);
                }
                default:
                    throw new Error("不支持的运算符: " + node.op);
            }
        }
        case "name": {
            const lower = node.text.toLowerCase();
            if (!node.isCall) {
                if (isConstantName(lower)) {
                    return polyConst(fixToRat(CONSTANTS[lower]()));
                }
                // 赋过值的变量当常量；否则它就是待求解的未知量
                if (context.variables.has(node.text)) {
                    return polyConst(context.variables.get(node.text));
                }
                if (node.text === context.targetVariable) {
                    return polyVariable();
                }
                throw new Error("undefined variable: " + node.text);
            }
            const args = node.args.map((argument) => complexOf(argument, context));
            return complexToPoly(context.callFunction(lower, args));
        }
        default:
            throw new Error("不支持的节点: " + node.kind);
    }
};

/** 双精度数字 -> 有理数（保留 12 位小数） */
const numberToRat = (value) => fixToRat(numberToFix(value));

/**
 * 计算一个不含结尾等号的表达式。
 *
 * @param {string} source 例如 "12×5"、"a=3;a*2"、"a+3=5;a"
 * @param {{roundMode?:string, roundDigits?:number|string}} [options] 结果显示精度
 * @returns {{ok:true, text:string, assignments:Array}|{ok:false, error:string, position:number}}
 */
const calculate = (source, options) => {
    try {
        if (typeof source !== "string" || source.length > 500) {
            throw new Error("expression too long");
        }
        // "a=" 这类只剩变量名的写法还没有可计算的内容（等号后面还没输入数值），不结算
        const trimmed = source.trim();
        if (/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(trimmed) && !isConstantName(trimmed.toLowerCase())) {
            return {ok: false, error: "incomplete assignment", position: -1};
        }
        const policy = normalizePolicy(options);
        const statement = parse(tokenize(normalizeExpression(source)));

        // 先按多项式路径试一次：能解出方程就返回解
        const context = {
            variables: new Map(),
            targetVariable: null,
            equation: null,
            policy: policy,
            callFunction: createMathEnvironment().callFunction
        };
        try {
            const value = polyOf(statement, context);
            if (context.equation) {
                return {
                    ok: true,
                    text: context.equation.text,
                    assignments: [],
                    equation: context.equation
                };
            }
            // 多项式路径成功但没有方程：说明整个式子都能算，
            // 且不涉及未知量（否则会抛「多个未知量」或走到下面）
            if (!polyHasVariable(value)) {
                const evaluated = polyEvaluate(value, cZero());
                return {
                    ok: true,
                    text: complexToDisplayString(evaluated, policy),
                    assignments: buildAssignments(context, statement)
                };
            }
        } catch (error) {
            // 多项式路径走不通（比如含未知量但不是方程），
            // 若是「方程无解」这类明确结论则直接返回，否则退回数值求值
            if (error && (error.message === "方程无解")) {
                return {ok: false, error: error.message, position: -1};
            }
        }

        const {value, effects} = evaluate(statement);
        const lastByName = new Map();
        effects.forEach((effect) => {
            lastByName.set(effect.name, effect);
        });
        return {
            ok: true,
            text: complexToDisplayString(value, policy),
            assignments: Array.from(lastByName.values())
        };
    } catch (error) {
        return {
            ok: false,
            error: error && error.message ? error.message : String(error),
            position: error && typeof error.position === "number" ? error.position : -1
        };
    }
};

/**
 * 把多项式路径里记录的赋值整理成与数值路径一致的 effects，
 * 让 "a=3;a*2=" 也能正常写回。
 */
const buildAssignments = (context, statement) => {
    const statements = statement.statements || [];
    return statements
        .filter((item) => item.kind === "assign" && context.variables.has(item.name))
        .map((item) => ({
            name: item.name,
            value: context.variables.get(item.name),
            start: item.start,
            end: item.end
        }));
};



/** 合法表达式的首字符：字母、数字、点、下划线、左括号，或一元正负号 */
const isExprStartChar = (ch) => {
    if (ch === undefined || ch === "") {
        return false;
    }
    if (/[0-9a-zA-Z_(.+-]/.test(ch)) {
        return true;
    }
    if (ch === "（") {
        return true;
    }
    // 全角数字
    return FULLWIDTH_MAP[ch] !== undefined && /[0-9]/.test(FULLWIDTH_MAP[ch]);
};

/** 表达式结束位置的下一个字符不能是比较符，否则 "5>=3=" 会被算成 "3" */
const isComparisonBefore = (ch) => ch === "=" || ch === ">" || ch === "<" || ch === "!" || ch === "＝";

const isDigitsOrNameChar = (ch) => /[0-9a-zA-Z_.]/.test(ch) ||
    (FULLWIDTH_MAP[ch] !== undefined && /[0-9.]/.test(FULLWIDTH_MAP[ch]));

/**
 * 在一段「以等号结尾」的文本里找出可计算的表达式。
 *
 * 先扫一遍前缀，记录所有「可以作为一个表达式起点」的位置：
 *   - 前面是表达式边界（行首、等号、分号、运算符或左括号）时，可以另起一个表达式
 *   - 左右括号里的内容不算独立表达式（除非正好在左括号后面）
 * 然后从最长的候选开始解析，第一个能算出结果的就是答案。
 *
 * 这样同时覆盖：
 *   12×5=60*3=      链式：60 是前一段的结果
 *   1+1=2*2=        链式，按常规优先级
 *   a=3;a*2=        行内赋值
 *   -5+3=           一元负号
 *   测试12*5=        前面有中文
 *   (1+2=           括号不配平，不结算
 *
 * @param {string} text 光标前的整段文本
 * @param {{roundMode?:string, roundDigits?:number|string}} [options] 结果显示精度
 * @returns {null|{start:number, end:number, source:string, text:string, assignments:Array}}
 */
const findCalculation = (text, options) => {
    if (typeof text !== "string" || text.length === 0) {
        return null;
    }
    if (!isEqualsChar(text[text.length - 1])) {
        return null;
    }
    // 结尾等号前的字符必须是操作数（数字/字母/右括号/百分号），否则只是敲了个符号
    const before = text[text.length - 2];
    const beforeIsOperand = before !== undefined && (/[0-9a-zA-Z_)）.．%]/.test(before) ||
        (FULLWIDTH_MAP[before] !== undefined && /[0-9%]/.test(FULLWIDTH_MAP[before])));
    if (!beforeIsOperand) {
        return null;
    }

    const prefix = text.slice(0, -1);
    const starts = [];
    for (let i = 0; i < prefix.length; i++) {
        const ch = prefix[i];
        const prev = i > 0 ? prefix[i - 1] : "";
        if (isDigitsOrNameChar(ch)) {
            // 字母和数字连写（abc12）时，数字处也可以作为表达式起点
            const prevIsName = /[a-zA-Z_]/.test(prev);
            const chIsDigit = /[0-9]/.test(ch) ||
                (FULLWIDTH_MAP[ch] !== undefined && /[0-9]/.test(FULLWIDTH_MAP[ch]));
            if (i === 0 || !isDigitsOrNameChar(prev) || (prevIsName && chIsDigit)) {
                starts.push(i);
            }
            continue;
        }
        starts.push(i);
    }

    // 从最长的候选（也就是最早的起点）开始尝试
    for (let k = 0; k < starts.length; k++) {
        const start = starts[k];
        if (start >= prefix.length) {
            continue;
        }
        if (start > 0) {
            const prev = prefix[start - 1];
            // 前面是等号或比较符时不能另起一段
            if (isComparisonBefore(prev)) {
                continue;
            }
            // 只有「前置运算符（含左括号）」才允许另起一段；
            // 前面是普通操作符（+ - * / ^ %）说明截取点落在表达式中途，跳过。
            const isPrefixContext = prev === "(" || prev === "（" || prev === ";" || prev === ";";
            if (!isPrefixContext && "+-*/^%".indexOf(prev) > -1) {
                continue;
            }
            // 前面是左括号时，整段前缀的括号必须配平，否则 "(1+2=" 会被算成 "1+2"
            if ((prev === "(" || prev === "（") && !hasBalancedParens(prefix)) {
                continue;
            }
        }
        if (!isExprStartChar(prefix[start])) {
            continue;
        }
        // 一元正负号只能出现在行首、分隔符或左括号之后
        if ((prefix[start] === "+" || prefix[start] === "-") && start > 0) {
            const beforeSign = prefix[start - 1];
            if ("=;,(（".indexOf(beforeSign) === -1) {
                continue;
            }
        }
        const body = prefix.slice(start);
        if (!hasBalancedParens(body) || hasTopLevelEqualsInsideParens(body)) {
            continue;
        }
        const result = calculate(body, options);
        if (!result.ok) {
            continue;
        }
        return {
            start: start,
            end: text.length,
            source: body,
            text: result.text,
            assignments: result.assignments
        };
    }
    return null;
};

/** 括号里出现等号时不当表达式处理，例如 "12*(5=3)=" */
const hasTopLevelEqualsInsideParens = (body) => {
    let depth = 0;
    for (let i = 0; i < body.length; i++) {
        const ch = body[i];
        if (ch === "(" || ch === "（") {
            depth++;
        } else if (ch === ")" || ch === "）") {
            depth = Math.max(0, depth - 1);
        } else if (depth > 0 && (ch === "=" || ch === "＝")) {
            return true;
        }
    }
    return false;
};

/** 左右括号是否配平（从左往右读，中途不能出现多余的右括号） */
const hasBalancedParens = (body) => {
    let depth = 0;
    for (let i = 0; i < body.length; i++) {
        if (body[i] === "(" || body[i] === "（") {
            depth++;
        } else if (body[i] === ")" || body[i] === "）") {
            depth--;
            if (depth < 0) {
                return false;
            }
        }
    }
    return depth === 0;
};

/**
 * 结算一段文本，返回 {text, changed, calculation}。
 *
 * 写回规则很简单：
 *   - 表达式里本来就有等号（链式 "12×5=60*3" 或行内赋值 "a=3;a*2"）：
 *     这些等号是「已经算出来了」的记号，保留原文，只把结尾那个等号换成 "=结果"
 *     （结尾等号就是用户刚敲下的那一个）。
 *   - 表达式里没有等号（如 "12*5"）：同样把结尾等号换成 "=结果"。
 * 两种情形在文本层面是同一个替换，所以直接拼接即可。
 *
 * @param {string} text 光标前的整段文本
 * @param {{roundMode?:string, roundDigits?:number|string}} [options] 结果显示精度
 */
const settleText = (text, options) => {
    const calculation = findCalculation(text, options);
    if (!calculation) {
        return {text: text, changed: false, calculation: null};
    }
    const result = text.slice(0, calculation.start) + calculation.source + "=" +
        calculation.text + text.slice(calculation.end);
    return {text: result, changed: result !== text, calculation: calculation};
};

/** 兼容旧调用：定位 + 结算 */
const applyCalculation = (text, calculation) => {
    if (!calculation) {
        return {text: text, caret: text.length};
    }
    const result = text.slice(0, calculation.start) + calculation.source + "=" +
        calculation.text + text.slice(calculation.end);
    return {text: result, caret: result.length};
};

const __test__ = {
    tokenize: tokenize,
    parse: parse,
    evaluate: evaluate,
    normalizeExpression: normalizeExpression,
    isExprChar: isExprChar,
    isExprStartChar: isExprStartChar,
    hasBalancedParens: hasBalancedParens,
    isComparisonBefore: isComparisonBefore,
    hasTopLevelEqualsInsideParens: hasTopLevelEqualsInsideParens,
    buildStarts: (prefix) => {
        const starts = [];
        for (let i = 0; i < prefix.length; i++) {
            const ch = prefix[i];
            const prev = i > 0 ? prefix[i - 1] : "";
            if (isDigitsOrNameChar(ch)) {
                const prevIsName = /[a-zA-Z_]/.test(prev);
                const chIsDigit = /[0-9]/.test(ch) ||
                    (FULLWIDTH_MAP[ch] !== undefined && /[0-9]/.test(FULLWIDTH_MAP[ch]));
                if (i === 0 || !isDigitsOrNameChar(prev) || (prevIsName && chIsDigit)) {
                    starts.push(i);
                }
                continue;
            }
            starts.push(i);
        }
        return starts;
    }
};
    module.exports = {
    "calculate": calculate,
    "findCalculation": findCalculation,
    "settleText": settleText,
    "applyCalculation": applyCalculation,
    "__test__": __test__
    };
    };

    /* ---------------- src/index.js ---------------- */
    __registry["index"] = function (module, exports, __require) {
/*!
 * 等号计算 (Equals Calc) —— 思源笔记插件
 *
 * 在编辑器里输入以等号结尾的算式，按回车即可算出结果：
 *   12*5=            -> 12*5=60
 *   测试12*5=        -> 测试12*5=60
 *   12×5=            -> 12×5=60
 *   12×5=60*3=       -> 12×5=60*3=180
 *
 * 实现要点：
 *   1. 在 document 上以「捕获阶段」监听 keydown，确保早于 Protyle 自己的回车处理；
 *   2. 命中算式后先改 DOM，再通过 updateTransactionElement 提交事务，
 *      这样内核里的块内容和撤销栈都会同步，避免只改 DOM 导致数据不一致；
 *   3. 计算过程不使用 eval / new Function，表达式解析和十进制运算都在本地实现。
 */

const {Plugin, getAllEditor, Setting, showMessage} = __require("siyuan");
const {settleText} = __require("lib/expr");

/** 设置存储文件名 */
const STORAGE_NAME = "settings";
/** 顶栏按钮 ID */
const TOP_BAR_ID = "plugin-calc-topbar";
/** 顶栏图标 ID；必须用 addIcons 注册成 symbol，否则 <use> 找不到会显示空白 */
const TOP_BAR_ICON = "iconCalcEquals";
/** 顶栏图标的 symbol 定义（内置图标里没有计算器，所以自定义一个） */
const TOP_BAR_ICON_SVG = `<symbol id="${TOP_BAR_ICON}" viewBox="0 0 32 32">
<path d="M9.5 3h13A2.5 2.5 0 0 1 25 5.5v21a2.5 2.5 0 0 1-2.5 2.5h-13A2.5 2.5 0 0 1 7 26.5v-21A2.5 2.5 0 0 1 9.5 3zm0 2a.5.5 0 0 0-.5.5v21a.5.5 0 0 0 .5.5h13a.5.5 0 0 0 .5-.5v-21a.5.5 0 0 0-.5-.5h-13z"></path>
<path d="M11.5 7h9a1 1 0 0 1 1 1v5a1 1 0 0 1-1 1h-9a1 1 0 0 1-1-1V8a1 1 0 0 1 1-1zm1 2v3h7V9h-7z"></path>
<path d="M11 17.2h3v1.8h-3zM18 17.2h3v1.8h-3zM11 21.2h3v1.8h-3zM18 21.2h3v1.8h-3zM11 25.2h10V27H11z"></path>
</symbol>`;

const DEFAULT_SETTINGS = {
    enabled: true,
    triggerOnSpace: false,
    triggerOnCtrlEnter: true,
    /** 结果精度：exact（精确）/ places（小数位）/ digits（有效数字） */
    roundMode: "exact",
    /** places 模式是小数位数；digits 模式是有效数字位数 */
    roundDigits: 6
};

class EqualsCalcPlugin extends Plugin {

    constructor(options) {
        super(options);
        this.settings = Object.assign({}, DEFAULT_SETTINGS);
        /** 绑在 document 上的 keydown 处理器（捕获阶段） */
        this.onKeyDownBindThis = this.onKeyDown.bind(this);
        /** 顶栏图标元素，用来显示启用状态 */
        this.topBarElement = null;
    }

    async onload() {
        await this.loadSettings();

        // 捕获阶段监听：Protyle 自身的 keydown 在冒泡阶段，
        // 放在捕获阶段才能保证「回车」先经过本插件。
        document.addEventListener("keydown", this.onKeyDownBindThis, true);

        // 顶栏用自定义 svg 图标：内置图标里没有计算器，
        // 而且通过 addTopBar 渲染的是 <use xlink:href="#id">，必须先把 symbol 注册进 DOM。
        this.addIcons(TOP_BAR_ICON_SVG);

        this.topBarElement = this.addTopBar({
            id: TOP_BAR_ID,
            icon: TOP_BAR_ICON,
            // 留空标题：不在图标上显示悬停提示，避免遮挡编辑区
            title: "",
            position: "right",
            callback: () => this.toggleEnabled()
        });
    }

    async onLayoutReady() {
        // 顶栏按钮是同步创建的，这里只做一次状态回显
        this.syncTopBarState();
    }

    onunload() {
        document.removeEventListener("keydown", this.onKeyDownBindThis, true);
    }

    /* ---------------------------------------------------------------- *
     * 设置
     * ---------------------------------------------------------------- */

    async loadSettings() {
        let saved = {};
        try {
            saved = (await this.loadData(STORAGE_NAME)) || {};
        } catch (error) {
            console.warn(`[${this.name}] 读取设置失败，使用默认值`, error);
        }
        this.settings = Object.assign({}, DEFAULT_SETTINGS, saved);
        this.createSetting();
    }

    async saveSettings() {
        await this.saveData(STORAGE_NAME, this.settings);
        this.syncTopBarState();
    }

    /**
     * 构建设置面板。
     *
     * 注意：必须给 Setting 传 confirmCallback。思源内部实现是
     *   const btnsElement = dialog.element.querySelectorAll(".b3-dialog__action .b3-button");
     *   btnsElement[0].addEventListener(...)
     * 没有 confirmCallback 时那一行虽然带 fn__none，但按钮仍然会被创建，
     * 问题在于按钮容器被隐藏时 querySelectorAll 取不到按钮，于是 btnsElement[0] 为 undefined，
     * 抛出 TypeError 导致对话框根本显示不出来（表现为「点击设置没反应」）。
     */
    createSetting() {
        this.setting = new Setting({
            confirmCallback: () => {
                this.saveSettings();
                showMessage(this.i18n.savedMessage);
            }
        });
        this.renderSettings();
    }

    renderSettings() {
        if (!this.setting) {
            return;
        }
        const addSwitch = (title, description, key) => {
            const select = this.buildSelect([
                {value: "true", label: this.i18n.on},
                {value: "false", label: this.i18n.off}
            ], this.settings[key] ? "true" : "false", (value) => {
                this.settings[key] = value === "true";
                this.saveSettings();
            });
            this.setting.addItem({title: title, description: description, actionElement: select});
        };

        addSwitch(this.i18n.enabledTitle, this.i18n.enabledTip, "enabled");
        addSwitch(this.i18n.spaceTitle, this.i18n.spaceTip, "triggerOnSpace");
        addSwitch(this.i18n.ctrlEnterTitle, this.i18n.ctrlEnterTip, "triggerOnCtrlEnter");

        // 结果精度：模式 + 位数。位数输入框只在 places / digits 模式下可用。
        const modeSelect = this.buildSelect([
            {value: "exact", label: this.i18n.roundExact},
            {value: "places", label: this.i18n.roundPlaces},
            {value: "digits", label: this.i18n.roundDigits}
        ], this.settings.roundMode, (value) => {
            this.settings.roundMode = value;
            this.saveSettings();
            digitsInput.disabled = value === "exact";
            digitsInput.classList.toggle("plugin-calc__disabled", value === "exact");
        });

        const digitsInput = document.createElement("input");
        digitsInput.type = "number";
        digitsInput.min = "0";
        digitsInput.max = "15";
        digitsInput.step = "1";
        digitsInput.className = "b3-text-field fn__size200";
        digitsInput.value = String(this.settings.roundDigits);
        digitsInput.disabled = this.settings.roundMode === "exact";
        digitsInput.classList.toggle("plugin-calc__disabled", digitsInput.disabled);
        digitsInput.addEventListener("change", () => {
            const parsed = Number.parseInt(digitsInput.value, 10);
            this.settings.roundDigits = Number.isFinite(parsed) ? parsed : 6;
            digitsInput.value = String(this.settings.roundDigits);
            this.saveSettings();
        });

        const precisionRow = document.createElement("div");
        precisionRow.className = "fn__flex plugin-calc__row";
        precisionRow.append(modeSelect, digitsInput);
        this.setting.addItem({
            title: this.i18n.precisionTitle,
            description: this.i18n.precisionTip,
            actionElement: precisionRow
        });

        const hint = document.createElement("div");
        hint.className = "plugin-calc__hint";
        hint.textContent = this.i18n.usageTip;
        this.setting.addItem({title: this.i18n.usageTitle, actionElement: hint});
    }

    /** 构造一个下拉框，并在值变化时回调 */
    buildSelect(options, current, onChange) {
        const select = document.createElement("select");
        select.className = "b3-select fn__block";
        options.forEach((item) => {
            const option = document.createElement("option");
            option.value = item.value;
            option.textContent = item.label;
            select.append(option);
        });
        select.value = current;
        select.addEventListener("change", () => onChange(select.value));
        return select;
    }

    /** 传给计算层的精度设置 */
    getPrecisionOptions() {
        return {
            roundMode: this.settings.roundMode,
            roundDigits: this.settings.roundDigits
        };
    }

    /**
     * 切换启用状态。
     *
     * 顶栏图标已经去掉了右键菜单和悬停提示，只保留「点击开关」这一个行为；
     * 设置请从顶栏右侧的插件总菜单 →「等号计算」进入。
     */
    toggleEnabled() {
        this.settings.enabled = !this.settings.enabled;
        this.saveSettings();
        // 关闭时给一次提示，避免用户以为插件失效
        if (!this.settings.enabled) {
            showMessage(this.i18n.disabledMessage);
        }
    }

    syncTopBarState() {
        const element = this.topBarElement || document.querySelector(`[data-id="${TOP_BAR_ID}"]`);
        if (!element) {
            return;
        }
        element.classList.toggle("plugin-calc__topbar--off", !this.settings.enabled);
    }

    /* ---------------------------------------------------------------- *
     * 键盘处理
     * ---------------------------------------------------------------- */

    onKeyDown(event) {
        if (!this.settings.enabled) {
            return;
        }
        if (event.isComposing || event.keyCode === 229) {
            return;
        }
        const isEnter = event.key === "Enter";
        const isSpace = event.key === " " || event.code === "Space";
        if (!isEnter && !isSpace) {
            return;
        }
        const withCtrl = event.ctrlKey || event.metaKey;
        if (withCtrl) {
            // Ctrl/Cmd + 回车：强制结算（即使设置里关掉了自动结算）
            if (!isEnter || !this.settings.triggerOnCtrlEnter) {
                return;
            }
        } else if (event.altKey || event.shiftKey) {
            // Alt/Shift + 回车属于换行等其它编辑操作，不拦截
            return;
        } else if (isSpace) {
            if (!this.settings.triggerOnSpace) {
                return;
            }
        }

        const target = event.target;
        if (!target || typeof target.closest !== "function") {
            return;
        }
        const editorElement = target.closest(".protyle-wysiwyg");
        if (!editorElement || editorElement.getAttribute("contenteditable") === "false") {
            return;
        }

        if (!this.applyCalculation(editorElement)) {
            return;
        }
        // 结算成功：吃掉这次按键，避免 Protyle 再插入新块或空格
        event.preventDefault();
        event.stopPropagation();
    }

    /**
     * 尝试结算光标所在的块。
     * @returns {boolean} 是否真的做了替换
     */
    applyCalculation(editorElement) {
        const selection = window.getSelection();
        if (!selection || selection.rangeCount === 0 || !selection.isCollapsed) {
            return false;
        }
        const range = selection.getRangeAt(0);
        if (!range.collapsed || !editorElement.contains(range.startContainer)) {
            return false;
        }
        const blockElement = this.findBlockElement(range.startContainer, editorElement);
        if (!blockElement || blockElement.getAttribute("contenteditable") === "false") {
            return false;
        }
        const editableElement = blockElement.querySelector("[contenteditable=\"true\"]") || blockElement;
        if (!editableElement.contains(range.startContainer)) {
            return false;
        }

        // 只取光标以前的文本参与结算
        const beforeRange = document.createRange();
        beforeRange.setStart(editableElement, 0);
        beforeRange.setEnd(range.startContainer, range.startOffset);
        const textBeforeCaret = beforeRange.toString();
        if (!textBeforeCaret) {
            return false;
        }

        const settled = settleText(textBeforeCaret, this.getPrecisionOptions());
        if (!settled.changed) {
            return false;
        }

        // 先改 DOM，再提交事务；这样 updateTransactionElement 记录到的
        // oldHTML 是修改前的、内核收到的是修改后的内容。
        const oldHTML = blockElement.outerHTML;
        if (!this.replaceRangeText(editableElement, range, settled.text)) {
            return false;
        }
        this.commitChange(blockElement, oldHTML);
        // 光标落到替换后文本的末尾
        this.restoreCaret(editableElement, settled.text.length);
        return true;
    }

    /** 从光标位置往上找带 data-node-id 的块元素 */
    findBlockElement(node, editorElement) {
        let current = node;
        while (current && current !== editorElement) {
            if (current.nodeType === Node.ELEMENT_NODE && current.getAttribute("data-node-id")) {
                return current;
            }
            current = current.parentNode;
        }
        return null;
    }

    /**
     * 把可编辑元素里 [0, 光标) 这段文本整体换成 newText。
     * 用 Range 处理，所以光标落在行内样式（加粗等）里面也能正常工作。
     */
    replaceRangeText(editableElement, caretRange, newText) {
        try {
            const startRange = document.createRange();
            startRange.setStart(editableElement, 0);
            startRange.setEnd(caretRange.startContainer, caretRange.startOffset);
            startRange.deleteContents();
            startRange.insertNode(document.createTextNode(newText));
            return true;
        } catch (error) {
            console.error(`[${this.name}] 替换文本失败`, error);
            return false;
        }
    }

    /** 提交块内容变更：优先用新 API，旧版本回退到 updateTransaction */
    commitChange(blockElement, oldHTML) {
        const id = blockElement.getAttribute("data-node-id");
        const protyle = this.findProtyle(blockElement);
        const instance = protyle && typeof protyle.getInstance === "function" ? protyle.getInstance() : null;
        if (!instance) {
            // 找不到编辑器实例时至少保证 DOM 是对的，下次输入会同步
            console.warn(`[${this.name}] 未找到 Protyle 实例，本次修改可能未持久化`);
            return;
        }
        if (typeof instance.updateTransactionElement === "function") {
            instance.updateTransactionElement(blockElement, oldHTML);
        } else if (typeof instance.updateTransaction === "function") {
            instance.updateTransaction(id, blockElement.outerHTML, oldHTML);
        }
    }

    /** 通过块元素反查所属 Protyle 实例 */
    findProtyle(blockElement) {
        const editorElement = blockElement.closest(".protyle-wysiwyg");
        if (!editorElement) {
            return null;
        }
        let current = editorElement.parentElement;
        while (current) {
            if (current.classList && current.classList.contains("protyle")) {
                return this.findProtyleByElement(current);
            }
            current = current.parentElement;
        }
        return null;
    }

    /** 在已打开的编辑器里按 .protyle 元素匹配 Protyle 实例 */
    findProtyleByElement(protyleElement) {
        const editors = getAllEditor() || [];
        for (const protyle of editors) {
            if (protyle && protyle.element === protyleElement) {
                return protyle;
            }
        }
        return null;
    }

    /** 把光标放回结算后的位置 */
    restoreCaret(editableElement, offset) {
        const range = document.createRange();
        let remaining = offset;
        const walker = document.createTreeWalker(editableElement, NodeFilter.SHOW_TEXT, null);
        let node = walker.nextNode();
        let lastNode = null;
        while (node) {
            const length = node.textContent.length;
            if (remaining <= length) {
                range.setStart(node, Math.max(0, remaining));
                range.collapse(true);
                const selection = window.getSelection();
                selection.removeAllRanges();
                selection.addRange(range);
                return;
            }
            remaining -= length;
            lastNode = node;
            node = walker.nextNode();
        }
        if (lastNode) {
            range.setStart(lastNode, lastNode.textContent.length);
            range.collapse(true);
            const selection = window.getSelection();
            selection.removeAllRanges();
            selection.addRange(range);
        }
    }
}

    module.exports = {
    "default": EqualsCalcPlugin
    };
    };

    const plugin = __require("index").default;
    if (typeof module !== "undefined" && module.exports) {
        module.exports = plugin;
    } else if (typeof window !== "undefined") {
        window.EqualsCalcPlugin = plugin;
    }
})();
