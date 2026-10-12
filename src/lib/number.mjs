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

export {
    DIGIT_CHARS,
    SCALE_MAX,
    digitsToString,
    trimLeading,
    padLeft,
    compareDigits,
    addDigits,
    subDigits,
    mulDigits,
    shiftLeft,
    pow10,
    units,
    digitsOfString,
    isZeroDigits,
    divMod,
    fixZero,
    fixIsZero,
    fixNeg,
    fixNorm,
    fixToString,
    fixToNumber,
    fixToRat,
    fixFromString,
    numberToFix,
    ratZero,
    ratIsZero,
    ratNorm,
    ratAdd,
    ratSub,
    ratMul,
    ratDiv,
    ratToFix,
    cZero,
    cFromFix,
    cFromNumber,
    cFromRat,
    cIsReal,
    cNeg,
    cConjugate,
    cAdd,
    cSub,
    cMul,
    cDiv,
    complexToString
};
