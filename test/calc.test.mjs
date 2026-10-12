// 表达式层测试：node test/calc.test.mjs
import {calculate, findCalculation, applyCalculation, settleText} from "../src/lib/expr.mjs";

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

/** 模拟编辑器的结算过程：算出最终整行文本 */
const settle = (text, options) => settleText(text, options).text;

// ---------------------------------------------------------------- 结算用例
const cases = [
    // —— 需求里给出的四个用例 ——
    ["12*5=", "12*5=60"],
    ["测试12*5=", "测试12*5=60"],
    ["12×5=", "12×5=60"],
    ["12×5=60*3=", "12×5=60*3=180"],

    // —— 基本四则（按常规算式优先级：先乘除后加减）——
    ["1+1=", "1+1=2"],
    ["2+3*4=", "2+3*4=14"],
    ["1+2*3=", "1+2*3=7"],
    ["(2+3)*4=", "(2+3)*4=20"],
    ["10-3-2=", "10-3-2=5"],
    ["100/4=", "100/4=25"],
    ["10/4=", "10/4=2.5"],
    ["1/8=", "1/8=0.125"],
    ["0.1+0.2=", "0.1+0.2=0.3"],
    ["1.5*2=", "1.5*2=3"],
    ["-5+3=", "-5+3=-2"],
    ["3-10=", "3-10=-7"],
    ["2^10=", "2^10=1024"],
    ["2**8=", "2**8=256"],
    ["50%=", "50%=0.5"],
    ["200*10%=", "200*10%=20"],
    [".5+.25=", ".5+.25=0.75"],
    ["12×3÷4=", "12×3÷4=9"],
    ["2×3-4=", "2×3-4=2"],
    ["1,000+1=", "1,000+1=1001"],
    ["6/4=", "6/4=1.5"],
    ["7%2=", "7%2=1"],

    // —— 中文与前后缀 ——
    ["测试=", "测试="],
    ["价格12*5元=", "价格12*5元="],   // 等号前是「元」，不结算
    ["共12+3=", "共12+3=15"],
    ["abc12*5=", "abc12*5=60"],
    ["#12*5=", "#12*5=60"],
    ["12+=", "12+="],
    ["12++=", "12++="],
    ["==", "=="],
    ["=", "="],
    ["abc=", "abc="],
    ["x=", "x="],
    ["(1+2=", "(1+2="],
    ["12*(5=3)=", "12*(5=3)="],
    ["5>=3=", "5>=3="],
    // —— 连锁结算：等号只是「算出来了」的记号，最终结果取自最后一段 ——
    ["2+3=5+5=", "2+3=5+5=10"],
    ["1+1=2*2=", "1+1=2*2=4"],
    ["1+1=2+1=3*3=", "1+1=2+1=3*3=9"],
    ["10/4=2.5*4=", "10/4=2.5*4=10"],
    ["12×5=60+3=", "12×5=60+3=63"],
    // —— 全角符号 ——
    ["12＋3=", "12＋3=15"],
    ["12＊3=", "12＊3=36"],
    ["（2+3）*4=", "（2+3）*4=20"],
    ["（2＋3）＊4=", "（2＋3）＊4=20"],

    // —— 精度 ——
    ["99999999999999999999+1=", "99999999999999999999+1=100000000000000000000"],
    ["1/3=", "1/3=0.3333333333333333333333333333333333333333"],

    // —— 函数 ——
    ["sqrt(16)=", "sqrt(16)=4"],
    ["max(3,7,5)=", "max(3,7,5)=7"],
    ["min(3,7,5)=", "min(3,7,5)=3"],
    ["round(2.6)=", "round(2.6)=3"],
    ["round(2.4)=", "round(2.4)=2"],
    ["floor(2.9)=", "floor(2.9)=2"],
    ["ceil(2.1)=", "ceil(2.1)=3"],
    ["abs(-7)=", "abs(-7)=7"],
    ["sum(1,2,3)=", "sum(1,2,3)=6"],
    ["avg(1,2,3)=", "avg(1,2,3)=2"],
    ["pi=", "pi=3.14159265358979323846"],
    ["sqrt(-4)=", "sqrt(-4)=2i"],

    // —— 行内赋值：先建立变量，再结算 ——
    ["a=3;a*2=", "a=3;a*2=6"],
    ["x=5;y=2;x*y=", "x=5;y=2;x*y=10"],
    ["a=", "a="],
    ["n=10;n/4=", "n=10;n/4=2.5"],

    // —— 一元方程：等号两边含同一个未知量 ——
    ["x+3=5=", "x+3=5=2"],
    ["a+3=5;a=", "a+3=5;a=2"],
    ["2x=10=", "2x=10=5"],
    ["2x+3=7=", "2x+3=7=2"],
    ["12-2x=4=", "12-2x=4=4"],
    ["x/2=3=", "x/2=3=6"],
    ["3x=1=", "3x=1=0.3333333333333333333333333333333333333333"],
    ["2(x+1)=6=", "2(x+1)=6=2"],
    ["x^2=4=", "x^2=4=-2 或 2"],
    ["x^2+1=0=", "x^2+1=0=1i 或 -1i"],
    ["x^3=2=", "x^3=2=1.25992105"],
    ["n=2;n*x=6=", "n=2;n*x=6=3"],

    // —— 隐含乘法 ——
    ["2pi=", "2pi=6.28318530717958647692"],
    ["3(2+1)=", "3(2+1)=9"]
];

for (const [input, expected] of cases) {
    eq(settle(input), expected, `settle(${JSON.stringify(input)})`);
}

// ---------------------------------------------------------------- 精度设置
eq(settle("1/3=", {roundMode: "places", roundDigits: 4}), "1/3=0.3333", "精度：4 位小数");
eq(settle("1/3=", {roundMode: "digits", roundDigits: 4}), "1/3=0.3333", "精度：4 位有效数字");
eq(settle("2/3=", {roundMode: "places", roundDigits: 3}), "2/3=0.667", "精度：进位");
eq(settle("1234.5678+0=", {roundMode: "places", roundDigits: 2}), "1234.5678+0=1234.57",
    "精度：固定小数位");
eq(settle("1234.5678+0=", {roundMode: "digits", roundDigits: 3}), "1234.5678+0=1230",
    "精度：有效数字");
eq(settle("3x=1=", {roundMode: "places", roundDigits: 2}), "3x=1=0.33", "精度：作用到方程解");
eq(settle("1/3=", {roundMode: "exact"}), "1/3=0.3333333333333333333333333333333333333333",
    "精度：精确模式");
eq(settle("12*5=", {roundMode: "places", roundDigits: 2}), "12*5=60", "精度：整数不受影响");
eq(settle("10/4=", {roundMode: "places", roundDigits: 0}), "10/4=3", "精度：0 位小数");
eq(settle("10/4=", {roundMode: "digits", roundDigits: 1}), "10/4=3", "精度：1 位有效数字");

// ---------------------------------------------------------------- calculate 直测
eq(calculate("12*5").text, "60", "calculate 12*5");
eq(calculate("2+3*4").text, "14", "calculate 2+3*4");
eq(calculate("").ok, false, "calculate empty");
eq(calculate("12+").ok, false, "calculate trailing operator");
eq(calculate("(1+2").ok, false, "calculate unbalanced paren");
eq(calculate("1/0").ok, false, "calculate divide by zero");
eq(calculate("a*2").ok, false, "calculate undefined variable");

// ---------------------------------------------------------------- 定位信息
const chinese = findCalculation("测试12*5=");
eq(chinese.start, 2, "start after chinese");
eq(chinese.source, "12*5", "source skips chinese");
eq(chinese.text, "60", "text is 60");
eq(findCalculation("12*5=").start, 0, "start at 0");
eq(findCalculation("12*5"), null, "no trailing equals -> null");
eq(findCalculation("刚才 1+1= 的结果"), null, "not at end -> null");
eq(findCalculation("") === null, true, "empty -> null");
eq(findCalculation("1,000+1=").start, 0, "thousand separator keeps full expression");

// ---------------------------------------------------------------- 赋值展开
const assign = findCalculation("a=3;a*2=");
eq(assign.assignments.length, 1, "assignment count");
eq(assign.assignments[0].name, "a", "assignment name");
eq(settle("a="), "a=", "settle a= (只有变量名，不结算)");

// ---------------------------------------------------------------- 光标位置
const caretCase = applyCalculation("测试12*5=", findCalculation("测试12*5="));
eq(caretCase.text, "测试12*5=60", "applyCalculation text");
eq(caretCase.caret, "测试12*5=60".length, "caret at end");

// ---------------------------------------------------------------- unchanged 标记
eq(settleText("测试").changed, false, "无等号 -> 未改变");
eq(settleText("12*5=").changed, true, "有等号 -> 已改变");

console.log(`\n表达式层: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
