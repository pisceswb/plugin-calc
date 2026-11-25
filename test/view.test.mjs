import {renderCalcNotebook} from "../src/notebook-view.js";

class FakeText {
    constructor(text) {
        this.data = text;
        this.parentNode = null;
    }
    get textContent() {
        return this.data;
    }
}

class FakeElement {
    constructor(tagName, ownerDocument) {
        this.tagName = tagName.toUpperCase();
        this.ownerDocument = ownerDocument;
        this.childNodes = [];
        this.parentNode = null;
        this.attributes = {};
        this.className = "";
        this.dataset = {};
        this.style = {};
        this.listeners = {};
        this.value = "";
        this.selectionStart = 0;
        this.selectionEnd = 0;
        this.scrollHeight = 30;
        this.isConnected = true;
        this.classList = {add: name => {
            if (!this.className.split(" ").includes(name)) {
                this.className = `${this.className} ${name}`.trim();
            }
        }};
    }
    append(...nodes) {
        nodes.forEach(node => {
            node.parentNode = this;
            this.childNodes.push(node);
        });
    }
    replaceChildren(...nodes) {
        this.childNodes = [];
        this.append(...nodes);
    }
    replaceWith(node) {
        const index = this.parentNode.childNodes.indexOf(this);
        this.parentNode.childNodes[index] = node;
        node.parentNode = this.parentNode;
    }
    setAttribute(name, value) {
        this.attributes[name] = String(value);
    }
    getAttribute(name) {
        return this.attributes[name] ?? null;
    }
    addEventListener(type, handler) {
        (this.listeners[type] ||= []).push(handler);
    }
    dispatchEvent(event) {
        (this.listeners[event.type] || []).forEach(handler => handler(event));
    }
    focus() {
        this.ownerDocument.activeElement = this;
    }
    setSelectionRange(start, end) {
        this.selectionStart = start;
        this.selectionEnd = end;
    }
    contains(node) {
        if (node === this) {
            return true;
        }
        return this.childNodes.some(child => child instanceof FakeElement && child.contains(node));
    }
    closest(selector) {
        const match = selector.match(/^\[data-type="([^"]+)"\]$/);
        let current = this;
        while (current) {
            if (match && current.getAttribute("data-type") === match[1]) {
                return current;
            }
            current = current.parentNode;
        }
        return null;
    }
    querySelectorAll(selector) {
        if (selector.includes(" > ")) {
            const [parentSelector, childSelector] = selector.split(" > ");
            return this.querySelectorAll(parentSelector).flatMap(parent =>
                parent.childNodes.filter(child => child instanceof FakeElement && child.matches(childSelector)));
        }
        const result = [];
        const walk = node => {
            node.childNodes.forEach(child => {
                if (child instanceof FakeElement) {
                    if (child.matches(selector)) {
                        result.push(child);
                    }
                    walk(child);
                }
            });
        };
        walk(this);
        return result;
    }
    querySelector(selector) {
        return this.querySelectorAll(selector)[0] || null;
    }
    matches(selector) {
        if (selector.startsWith(".")) {
            return this.className.split(" ").includes(selector.slice(1));
        }
        return this.tagName === selector.toUpperCase();
    }
    get textContent() {
        return this.childNodes.map(node => node.textContent).join("");
    }
    set textContent(value) {
        this.replaceChildren(new FakeText(String(value)));
    }
}

const createDocument = () => ({
    activeElement: null,
    createElement: tag => new FakeElement(tag, document),
    createTextNode: text => new FakeText(text)
});
const all = (root, className) => root.querySelectorAll(`.${className}`);
const click = element => element.dispatchEvent({type: "click"});
const keydown = (element, key) => {
    const event = {type: "keydown", key, isComposing: false, prevented: false, preventDefault() {
        this.prevented = true;
    }};
    element.dispatchEvent(event);
    return event;
};
let passed = 0;
let failed = 0;
const eq = (actual, expected, label) => {
    if (actual === expected) {
        passed++;
    } else {
        failed++;
        const print = value => value instanceof FakeElement ? `<${value.tagName} ${value.className}>` : JSON.stringify(value);
        console.log(`FAIL ${label}\n  actual=${print(actual)}\n  expected=${print(expected)}`);
    }
};

const source = "单价=68\n数量=2\n运费=10\n\n商品金额：{{单价*数量}}\n含运费总价：{{单价*数量+运费}}";
const document = createDocument();
const block = document.createElement("div");
block.setAttribute("data-type", "NodeCustomBlock");
block.setAttribute("data-node-id", "block-view-test");
const container = document.createElement("div");
block.append(container);
const requests = [];
globalThis.fetch = async (url, options) => {
    requests.push({url, body: JSON.parse(options.body)});
    return {json: async () => ({code: 0})};
};
const saved = [];
const dispose = renderCalcNotebook({
    element: container,
    content: source,
    setContent: content => {
        saved.push(content);
        return true;
    }
}, {});
const root = all(container, "plugin-calc-notebook")[0];
eq(root.dataset.view, "horizontal", "默认左右视图");
eq(all(root, "plugin-calc-notebook__editor").length, 1, "左右视图有完整原文编辑器");
eq(all(root, "plugin-calc-notebook__preview").length, 1, "左右视图有预览");
const liveButton = all(root, "plugin-calc-notebook__view-button").find(item => item.dataset.view === "live");
click(liveButton);
eq(root.dataset.view, "live", "切换到逐行视图");
eq(block.getAttribute("custom-plugin-calc-view"), "live", "视图写入当前块属性");
eq(requests.at(-1).body.attrs["custom-plugin-calc-view"], "live", "视图模式提交到思源属性接口");
eq(root.querySelector("textarea"), null, "逐行视图未点击时不显示编辑器");

const lines = () => all(root.querySelector(".plugin-calc-notebook__live"), "plugin-calc-notebook__line");
click(lines()[0]);
const editor = root.querySelector("textarea");
eq(editor.value, "单价=68", "点击行显示该行的原始定义");
eq(root.querySelectorAll("textarea").length, 1, "逐行视图只有一个活动编辑器");
editor.focus();
editor.value = "单价=70";
editor.selectionStart = editor.value.length;
editor.selectionEnd = editor.value.length;
editor.dispatchEvent({type: "input"});
eq(root.querySelector("textarea") === editor, true, "输入时不替换当前编辑器");
eq(lines()[4].textContent, "商品金额：140(单价*数量)", "其他行实时重算商品金额");
eq(lines()[5].textContent, "含运费总价：150(单价*数量+运费)", "其他行实时重算总价");
await new Promise(resolve => setTimeout(resolve, 360));
eq(saved.at(-1).startsWith("单价=70\n"), true, "逐行编辑自动保存完整原文");

const enterEvent = keydown(editor, "Enter");
eq(enterEvent.prevented, true, "回车由逐行编辑器处理");
eq(saved.length, 1, "回车后等待防抖保存");
eq(root.querySelector("textarea").value, "", "回车拆分并编辑新行");
eq(lines().length, 7, "回车增加一行");
await new Promise(resolve => setTimeout(resolve, 360));
eq(saved.at(-1).split("\n").length, 7, "拆行结果保存到完整原文");
keydown(root.querySelector("textarea"), "Escape");
eq(root.querySelector("textarea"), null, "Escape 退出当前行编辑");

click(all(root, "plugin-calc-notebook__view-button").find(item => item.dataset.view === "vertical"));
eq(root.dataset.view, "vertical", "切换回上下视图");
eq(root.querySelector("textarea").value.split("\n").length, 7, "切换视图不丢失原文");
eq(requests.at(-1).body.attrs["custom-plugin-calc-view"], "vertical", "上下视图也按块保存");

const savedContainer = document.createElement("div");
const savedBlock = document.createElement("div");
savedBlock.setAttribute("data-type", "NodeCustomBlock");
savedBlock.setAttribute("custom-plugin-calc-view", "vertical");
savedBlock.append(savedContainer);
const disposeSaved = renderCalcNotebook({element: savedContainer, content: source, setContent: () => true}, {});
eq(all(savedContainer, "plugin-calc-notebook")[0].dataset.view, "vertical", "重新渲染读取块级视图记忆");
disposeSaved();
dispose();

console.log(`\n视图交互: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
