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

import {
    cAdd,
    cDiv,
    cFromFix,
    cFromNumber,
    cIsReal,
    cMul,
    cNeg,
    cSub,
    cZero,
    complexToString,
    digitsToString,
    fixFromString,
    fixIsZero,
    fixToNumber,
    fixToRat,
    numberToFix,
    ratDiv,
    ratToFix
} from "./number.mjs";
import {normalizePolicy} from "./precision.mjs";
import {
    complexToDisplayString,
    polyAdd,
    polyConst,
    polyEvaluate,
    polyHasVariable,
    polyMul,
    polyNeg,
    polyPow,
    polySub,
    polyVariable,
    polyZero,
    solveEquation
} from "./polynomial.mjs";

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
export const calculate = (source, options) => {
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
export const findCalculation = (text, options) => {
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
export const settleText = (text, options) => {
    const calculation = findCalculation(text, options);
    if (!calculation) {
        return {text: text, changed: false, calculation: null};
    }
    const result = text.slice(0, calculation.start) + calculation.source + "=" +
        calculation.text + text.slice(calculation.end);
    return {text: result, changed: result !== text, calculation: calculation};
};

/** 兼容旧调用：定位 + 结算 */
export const applyCalculation = (text, calculation) => {
    if (!calculation) {
        return {text: text, caret: text.length};
    }
    const result = text.slice(0, calculation.start) + calculation.source + "=" +
        calculation.text + text.slice(calculation.end);
    return {text: result, caret: result.length};
};

export const __test__ = {
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