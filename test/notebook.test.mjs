import {calculate, settleText} from "../src/lib/expr.mjs";
import {evaluateNotebook} from "../src/lib/notebook.mjs";

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

const sample = evaluateNotebook(`单价=68
数量=2
运费=10

商品金额：{{单价*数量}}
含运费总价：{{单价*数量+运费}}
单价*数量
单价*数量*0.8`);

eq(sample[0].kind, "definition", "中文变量定义");
eq(sample[0].result.value, "68", "单价为 68");
eq(sample[1].result.value, "2", "数量为 2");
eq(sample[2].result.value, "10", "运费为 10");
eq(sample[3].kind, "blank", "空行保留");
eq(sample[4].parts[0].text, "商品金额：", "行内公式前的文字保留");
eq(sample[4].parts[1].value, "136", "行内公式计算商品金额");
eq(sample[4].parts[1].expression, "单价*数量", "行内公式保留原公式");
eq(sample[5].parts[1].value, "146", "行内公式计算含运费总价");
eq(sample[6].kind, "formula", "独立变量公式行");
eq(sample[6].result.value, "136", "独立公式计算结果");
eq(sample[7].result.value, "108.8", "小数乘法结果");

const dependent = evaluateNotebook("a=3\nb=a*2\na+b");
eq(dependent[1].result.value, "6", "后面的变量可引用前面的变量");
eq(dependent[2].result.value, "9", "独立公式使用顺序依赖");

const changed = evaluateNotebook("单价=70\n数量=2\n运费=10\n商品金额：{{单价*数量}}\n含运费总价：{{单价*数量+运费}}\n单价*数量*0.8");
eq(changed[3].parts[1].value, "140", "修改变量后商品金额自动更新");
eq(changed[4].parts[1].value, "150", "修改变量后总价自动更新");
eq(changed[5].result.value, "112", "修改变量后独立公式自动更新");

const text = evaluateNotebook("这是一段普通文字\n\n今天完成采购\n购物-交通");
eq(text[0].kind, "text", "普通中文不被当成公式");
eq(text[0].source, "这是一段普通文字", "普通文字原样保留");
eq(text[1].kind, "blank", "连续内容中的空行保留");
eq(text[2].kind, "text", "无运算符文字保持原样");
eq(text[3].kind, "text", "含连字符的普通中文保持原样");

const mixed = evaluateNotebook("a=2\n结果 {{a+1}} 与 {{a*4}}。\n0.1+0.2");
eq(mixed[1].parts.length, 5, "多个行内公式与文字按顺序混排");
eq(mixed[1].parts[1].value, "3", "第一个混排公式");
eq(mixed[1].parts[2].text, " 与 ", "公式之间的文字保留");
eq(mixed[1].parts[3].value, "8", "第二个混排公式");
eq(mixed[1].parts[4].text, "。", "公式后的标点保留");
eq(mixed[2].result.value, "0.3", "十进制精确计算");

eq(evaluateNotebook("未定义+1")[0].result.ok, false, "未定义变量显示错误");
eq(evaluateNotebook("1/0")[0].result.ok, false, "除零显示错误");
eq(evaluateNotebook("a=")[0].result.ok, false, "变量值为空显示错误");
eq(evaluateNotebook("{{}}")[0].parts[0].error, "公式为空", "空行内公式显示错误");
eq(evaluateNotebook("总价 {{1+2")[0].parts.some(part => part.error === "缺少 }}"), true, "未闭合行内公式显示错误");
eq(evaluateNotebook("前 {{1+2}} 后 {{3+4")[0].parts.some(part => part.error === "缺少 }}"), true, "部分公式未闭合也能识别");
eq(evaluateNotebook("文字 }}")[0].parts.some(part => part.error === "缺少 {{"), true, "多余结束标记显示错误");
eq(evaluateNotebook("a=3\na")[1].result.value, "3", "独立变量名显示变量值");
eq(evaluateNotebook("sqrt(16)")[0].result.value, "4", "独立函数公式");

eq(calculate("单价=68;单价*2").text, "136", "表达式引擎支持中文变量");
eq(settleText("测试12*5=").text, "测试12*5=60", "原等号结算不受 Unicode 变量支持影响");

console.log(`\n计算笔记本: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
