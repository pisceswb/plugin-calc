/*!
 * 插件集成测试：在 Node 里用最小 DOM / 思源 API 桩跑通「回车结算」。
 *
 * 覆盖 src/index.js 里的关键链路：
 *   选区 -> 找到块 -> 取光标前文本 -> settleText -> 改 DOM -> 提交事务 -> 恢复光标
 *
 * 用法：node test/plugin.test.mjs
 */

/* ------------------------------------------------------------------ *
 * 1. 最小 DOM 桩
 * ------------------------------------------------------------------ */

class NodeBase {
    constructor(type) {
        this.nodeType = type;
        this.parentNode = null;
    }
    get textContent() {
        return "";
    }
}

class StubText extends NodeBase {
    constructor(data) {
        super(3);
        this.data = data;
    }
    get textContent() {
        return this.data;
    }
    set textContent(value) {
        this.data = value;
    }
}

class StubElement extends NodeBase {
    constructor(tagName) {
        super(1);
        this.tagName = tagName.toUpperCase();
        this.childNodes = [];
        this.attributes = {};
        this._classes = new Set();
        this._listeners = {};
        this.classList = {
            add: (name) => this._classes.add(name),
            remove: (name) => this._classes.delete(name),
            contains: (name) => this._classes.has(name),
            toggle: (name, force) => {
                const on = force === undefined ? !this._classes.has(name) : force;
                if (on) {
                    this._classes.add(name);
                } else {
                    this._classes.delete(name);
                }
            }
        };
    }
    getAttribute(name) {
        return Object.prototype.hasOwnProperty.call(this.attributes, name) ? this.attributes[name] : null;
    }
    setAttribute(name, value) {
        this.attributes[name] = String(value);
    }
    hasAttribute(name) {
        return Object.prototype.hasOwnProperty.call(this.attributes, name);
    }
    appendChild(node) {
        node.parentNode = this;
        this.childNodes.push(node);
        return node;
    }
    /** 与浏览器一致：append 可以一次加多个节点 */
    append(...nodes) {
        nodes.forEach((node) => this.appendChild(node));
    }
    dispatchEvent(event) {
        const list = this._listeners[event.type] || [];
        list.slice().forEach((handler) => handler(event));
        return true;
    }
    removeChild(node) {
        const index = this.childNodes.indexOf(node);
        if (index > -1) {
            this.childNodes.splice(index, 1);
            node.parentNode = null;
        }
        return node;
    }
    get children() {
        return this.childNodes.filter((node) => node.nodeType === 1);
    }
    /** 与浏览器一致：parentElement 只在父节点是元素时返回 */
    get parentElement() {
        return this.parentNode && this.parentNode.nodeType === 1 ? this.parentNode : null;
    }
    get firstChild() {
        return this.childNodes[0] || null;
    }
    get textContent() {
        return this.childNodes.map((node) => node.textContent).join("");
    }
    set textContent(value) {
        this.childNodes.forEach((node) => {
            node.parentNode = null;
        });
        this.childNodes = [];
        this.appendChild(new StubText(String(value)));
    }
    get outerHTML() {
        const attrs = Object.keys(this.attributes)
            .map((name) => ` ${name}="${this.attributes[name]}"`)
            .join("");
        const inner = this.childNodes.map((node) =>
            node.nodeType === 3 ? node.textContent : node.outerHTML).join("");
        return `<${this.tagName.toLowerCase()}${attrs}>${inner}</${this.tagName.toLowerCase()}>`;
    }
    contains(node) {
        let current = node;
        while (current) {
            if (current === this) {
                return true;
            }
            current = current.parentNode;
        }
        return false;
    }
    closest(selector) {
        let current = this;
        while (current) {
            if (current.nodeType === 1 && matchesSelector(current, selector)) {
                return current;
            }
            current = current.parentNode;
        }
        return null;
    }
    querySelector(selector) {
        const found = this.querySelectorAll(selector);
        return found.length > 0 ? found[0] : null;
    }
    querySelectorAll(selector) {
        const result = [];
        const walk = (node) => {
            node.childNodes.forEach((child) => {
                if (child.nodeType !== 1) {
                    return;
                }
                if (matchesSelector(child, selector)) {
                    result.push(child);
                }
                walk(child);
            });
        };
        walk(this);
        return result;
    }
    addEventListener(type, handler) {
        (this._listeners[type] = this._listeners[type] || []).push(handler);
    }
    removeEventListener(type, handler) {
        const list = this._listeners[type] || [];
        const index = list.indexOf(handler);
        if (index > -1) {
            list.splice(index, 1);
        }
    }
}

/** 只支持插件用到的几种选择器（含逗号分隔的组合） */
const matchesSelector = (element, selector) => {
    if (selector.indexOf(",") > -1) {
        return selector.split(",").some((part) => matchesSelector(element, part.trim()));
    }
    if (selector.startsWith(".")) {
        return element._classes.has(selector.slice(1));
    }
    if (selector.startsWith("[")) {
        const match = selector.match(/^\[([^=\]]+)="?([^"\]]*)"?\]$/);
        return match ? element.getAttribute(match[1]) === match[2] : false;
    }
    return element.tagName === selector.toUpperCase();
};

class StubRange {
    constructor() {
        this.startContainer = null;
        this.startOffset = 0;
        this.endContainer = null;
        this.endOffset = 0;
        this.collapsed = true;
    }
    setStart(node, offset) {
        this.startContainer = node;
        this.startOffset = offset;
        if (this.endContainer === null) {
            this.endContainer = node;
            this.endOffset = offset;
        }
        this._sync();
    }
    setEnd(node, offset) {
        this.endContainer = node;
        this.endOffset = offset;
        if (this.startContainer === null) {
            this.startContainer = node;
            this.startOffset = offset;
        }
        this._sync();
    }
    collapse() {
        this.endContainer = this.startContainer;
        this.endOffset = this.startOffset;
        this.collapsed = true;
    }
    _sync() {
        this.collapsed = this.startContainer === this.endContainer && this.startOffset === this.endOffset;
    }
    /** 取 [start, end) 的纯文本 */
    toString() {
        if (this.startContainer === null) {
            return "";
        }
        const root = this._commonRoot();
        const nodes = collectRangeNodes(root, this.startContainer, this.startOffset,
            this.endContainer, this.endOffset);
        return nodes.map((item) => item.node.data.slice(item.from, item.to)).join("");
    }
    /** 两个端点共同的祖先（测试桩用简化算法） */
    _commonRoot() {
        const ancestors = [];
        let node = this.startContainer;
        while (node) {
            ancestors.push(node);
            node = node.parentNode;
        }
        node = this.endContainer;
        while (node) {
            if (ancestors.indexOf(node) > -1) {
                return node;
            }
            node = node.parentNode;
        }
        return this.startContainer;
    }
    deleteContents() {
        const root = this._commonRoot();
        const nodes = collectRangeNodes(root, this.startContainer, this.startOffset,
            this.endContainer, this.endOffset);
        if (nodes.length === 0) {
            return;
        }
        // 单节点内删除
        if (nodes.length === 1 && nodes[0].node.nodeType === 3) {
            const item = nodes[0];
            item.node.data = item.node.data.slice(0, item.from) + item.node.data.slice(item.to);
            return;
        }
        // 跨节点：保留首个节点的前缀、末个节点的后缀，删除中间的
        const first = nodes[0];
        const last = nodes[nodes.length - 1];
        first.node.data = first.node.data.slice(0, first.from);
        last.node.data = last.node.data.slice(last.to);
        for (let i = 1; i < nodes.length - 1; i++) {
            const node = nodes[i].node;
            if (node.parentNode) {
                node.parentNode.removeChild(node);
            }
        }
    }
    insertNode(node) {
        const container = this.startContainer;
        if (container.nodeType === 3) {
            const parent = container.parentNode;
            const index = parent.childNodes.indexOf(container);
            node.parentNode = parent;
            parent.childNodes.splice(index + 1, 0, node);
            return;
        }
        node.parentNode = container;
        container.childNodes.push(node);
    }
};

/** 把容器 + 偏移换算成「扁平文本」上的位置 */
const toTextOffset = (root, container, offset) => {
    const texts = [];
    const walk = (node) => {
        node.childNodes.forEach((child) => {
            if (child.nodeType === 3) {
                texts.push(child);
            } else {
                walk(child);
            }
        });
    };
    walk(root);
    if (container.nodeType === 3) {
        let total = 0;
        for (const node of texts) {
            if (node === container) {
                return total + offset;
            }
            total += node.data.length;
        }
        return total;
    }
    // 元素容器：offset 是子节点下标，累加它之前所有子树的文本长度
    let consumed = 0;
    for (let i = 0; i < offset && i < container.childNodes.length; i++) {
        consumed += textLengthOf(container.childNodes[i]);
    }
    // 找到该容器自身在扁平序列里的起点
    let base = 0;
    let reached = false;
    const scan = (node) => {
        if (reached) {
            return;
        }
        if (node === container) {
            reached = true;
            return;
        }
        node.childNodes.forEach((child) => {
            if (reached) {
                return;
            }
            if (child.nodeType === 3) {
                base += child.data.length;
            } else {
                scan(child);
            }
        });
    };
    scan(root);
    return base + consumed;
};

/** 某个节点子树的文本总长度 */
const textLengthOf = (node) => {
    if (node.nodeType === 3) {
        return node.data.length;
    }
    let total = 0;
    node.childNodes.forEach((child) => {
        total += textLengthOf(child);
    });
    return total;
};

/** 收集 range 覆盖的文本节点片段 */
const collectRangeNodes = (root, startContainer, startOffset, endContainer, endOffset) => {
    const texts = [];
    const walk = (node) => {
        node.childNodes.forEach((child) => {
            if (child.nodeType === 3) {
                texts.push(child);
            } else {
                walk(child);
            }
        });
    };
    walk(root);
    let start = toTextOffset(root, startContainer, startOffset);
    let end = toTextOffset(root, endContainer, endOffset);
    if (start > end) {
        const swap = start;
        start = end;
        end = swap;
    }
    const result = [];
    let cursor = 0;
    for (const node of texts) {
        const nodeStart = cursor;
        const nodeEnd = cursor + node.data.length;
        cursor = nodeEnd;
        if (nodeEnd <= start || nodeStart >= end) {
            continue;
        }
        result.push({
            node: node,
            from: Math.max(0, start - nodeStart),
            to: Math.min(node.data.length, end - nodeStart)
        });
    }
    return result;
};

/* ------------------------------------------------------------------ *
 * 2. 全局环境
 * ------------------------------------------------------------------ */

const globals = globalThis;
globals.Node = {ELEMENT_NODE: 1, TEXT_NODE: 3};
globals.NodeFilter = {SHOW_TEXT: 4};
globals.document = {
    _listeners: {},
    createElement: (tag) => new StubElement(tag),
    createTextNode: (text) => new StubText(text),
    createRange: () => new StubRange(),
    createTreeWalker: (root) => {
        const texts = [];
        const walk = (node) => {
            node.childNodes.forEach((child) => {
                if (child.nodeType === 3) {
                    texts.push(child);
                } else {
                    walk(child);
                }
            });
        };
        walk(root);
        let index = -1;
        return {
            nextNode: () => {
                index++;
                return index < texts.length ? texts[index] : null;
            }
        };
    },
    addEventListener: (type, handler) => {
        (globals.document._listeners[type] = globals.document._listeners[type] || []).push(handler);
    },
    removeEventListener: (type, handler) => {
        const list = globals.document._listeners[type] || [];
        const i = list.indexOf(handler);
        if (i > -1) {
            list.splice(i, 1);
        }
    },
    querySelector: () => null
};

let currentRange = null;
globals.window = {
    getSelection: () => ({
        rangeCount: currentRange ? 1 : 0,
        isCollapsed: currentRange ? currentRange.collapsed : true,
        getRangeAt: () => currentRange,
        removeAllRanges: () => {
            currentRange = null;
        },
        addRange: (range) => {
            currentRange = range;
        }
    }),
    siyuan: {}
};

/* ------------------------------------------------------------------ *
 * 3. 思源 API 桩
 * ------------------------------------------------------------------ */

/** 记录插件提交的事务；必须在使用前初始化 */
const transactions = [];
/** 已打开的编辑器实例列表 */
const editors = [];
/** 记录 addTopBar 收到的参数，用来检查图标用法 */
const topBarOptions = [];
/** 记录 addIcons 注册的 svg */
const registeredIcons = [];
/** 记录 showMessage 的调用 */
const messages = [];

class StubPlugin {
    constructor(options) {
        this.app = options.app;
        this.name = options.name;
        this.displayName = options.displayName;
        this.i18n = options.i18n;
        this.data = {};
        this.setting = null;
    }
    async loadData() {
        return {};
    }
    async saveData(name, value) {
        this.data[name] = value;
        return {code: 0};
    }
    addTopBar(options) {
        const element = new StubElement("div");
        topBarOptions.push(options);
        return element;
    }
    addIcons(svg) {
        registeredIcons.push(svg);
    }
    addCommand() {}
    openSetting() {
        if (this.setting) {
            this.setting.open(this.displayName || this.name);
        }
    }
}

/**
 * 思源 Setting 的桩。
 *
 * 真实实现里是这样接按钮的：
 *     const btnsElement = dialog.element.querySelectorAll(".b3-dialog__action .b3-button");
 *     btnsElement[0].addEventListener("click", ...);
 * 如果没有 confirmCallback，按钮容器带 fn__none、按钮取不到，
 * btnsElement[0] 就是 undefined，这里用同样的方式抛错，
 * 从而让测试能捕获「设置打不开」这类问题。
 */
class StubSetting {
    constructor(options) {
        this.options = options || {};
        this.items = [];
        this.opened = false;
        // 复刻思源的真实行为：没有 confirmCallback 时取按钮会失败
        this.actionButtons = this.options.confirmCallback ? [new StubElement("button"), new StubElement("button")] : [];
        if (!this.actionButtons[0]) {
            // 与思源一致的失败方式
            throw new TypeError("Cannot read properties of undefined (reading 'addEventListener')");
        }
    }
    addItem(options) {
        this.items.push(options);
    }
    open(name) {
        this.openedName = name;
        this.opened = true;
    }
    close() {
        this.opened = false;
    }
}

const moduleExports = {
    Plugin: StubPlugin,
    Setting: StubSetting,
    getAllEditor: () => editors,
    showMessage: (text) => messages.push(text)
};
const requireShim = (name) => {
    if (name === "siyuan") {
        return moduleExports;
    }
    throw new Error(`unexpected require: ${name}`);
};

/* ------------------------------------------------------------------ *
 * 4. 加载插件 bundle
 * ------------------------------------------------------------------ */

const {readFileSync} = await import("node:fs");
const {dirname, resolve} = await import("node:path");
const {fileURLToPath} = await import("node:url");
const here = dirname(fileURLToPath(import.meta.url));
const code = readFileSync(resolve(here, "..", "index.js"), "utf8");
const moduleShim = {exports: {}};
const factory = new Function("module", "require", "window", "document", "console", code);
factory(moduleShim, requireShim, globals.window, globals.document, console);
const PluginClass = moduleShim.exports;
if (typeof PluginClass !== "function") {
    console.error("bundle 未导出插件类");
    process.exit(1);
}

/* ------------------------------------------------------------------ *
 * 5. 组装一个编辑器：块 > 可编辑 div > 文本
 * ------------------------------------------------------------------ */

const buildEditor = (blockText) => {
    const protyleElement = new StubElement("div");
    protyleElement.classList.add("protyle");
    const contentElement = new StubElement("div");
    contentElement.classList.add("protyle-content");
    const wysiwyg = new StubElement("div");
    wysiwyg.classList.add("protyle-wysiwyg");
    wysiwyg.setAttribute("contenteditable", "true");
    const block = new StubElement("div");
    block.setAttribute("data-node-id", "20240101120000-abcdefg");
    block.setAttribute("data-type", "NodeParagraph");
    const editable = new StubElement("div");
    editable.setAttribute("contenteditable", "true");
    const textNode = new StubText(blockText);
    editable.appendChild(textNode);
    block.appendChild(editable);
    wysiwyg.appendChild(block);
    contentElement.appendChild(wysiwyg);
    protyleElement.appendChild(contentElement);
    return {protyleElement, contentElement, wysiwyg, block, editable, textNode};
};

/** 用 updateTransactionElement 记录事务，模拟内核落库 */
const makeProtyleInstance = (protyleElement) => {
    const protyle = {
        element: protyleElement,
        getInstance: () => protyle,
        updateTransactionElement: (element, oldHTML) => {
            transactions.push({id: element.getAttribute("data-node-id"), newHTML: element.outerHTML, oldHTML});
        }
    };
    editors.push(protyle);
    return protyle;
};

/* ------------------------------------------------------------------ *
 * 6. 断言
 * ------------------------------------------------------------------ */

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

const pressEnter = (plugin, target) => {
    const listeners = globals.document._listeners.keydown || [];
    const event = {
        key: "Enter",
        code: "Enter",
        keyCode: 13,
        ctrlKey: false,
        metaKey: false,
        altKey: false,
        shiftKey: false,
        isComposing: false,
        target: target,
        _prevented: false,
        _stopped: false,
        preventDefault() {
            this._prevented = true;
        },
        stopPropagation() {
            this._stopped = true;
        }
    };
    listeners.forEach((listener) => listener(event));
    return event;
};

/** 跑一个用例：输入文本 -> 回车 -> 返回结算后的文本 */
const runCase = async (input, options = {}) => {
    transactions.length = 0;
    editors.length = 0;
    const dom = buildEditor(input);
    makeProtyleInstance(dom.protyleElement);

    const plugin = new PluginClass({
        app: {plugins: []},
        name: "plugin-calc",
        displayName: "等号计算",
        i18n: {openPluginSettings: "s", on: "开", off: "关"}
    });
    await plugin.onload();
    if (options.settings) {
        Object.assign(plugin.settings, options.settings);
    }

    // 光标放在文本末尾
    const range = new StubRange();
    range.setStart(dom.textNode, dom.textNode.textContent.length);
    range.collapse();
    currentRange = range;

    const event = pressEnter(plugin, dom.editable);
    plugin.onunload();
    return {
        text: dom.editable.textContent,
        prevented: event._prevented,
        stopped: event._stopped,
        transactions: transactions.slice()
    };
};

// —— 需求里的四个用例
const cases = [
    ["12*5=", "12*5=60"],
    ["测试12*5=", "测试12*5=60"],
    ["12×5=", "12×5=60"],
    ["12×5=60*3=", "12×5=60*3=180"],
    // 一元方程
    ["x+3=5=", "x+3=5=2"],
    ["a+3=5;a=", "a+3=5;a=2"],
    ["2x=10=", "2x=10=5"],
    ["x^2=4=", "x^2=4=-2 或 2"]
];
for (const [input, expected] of cases) {
    const result = await runCase(input);
    eq(result.text, expected, `回车结算 ${JSON.stringify(input)}`);
    eq(result.prevented, true, `拦截回车 ${JSON.stringify(input)}`);
    eq(result.transactions.length, 1, `产生一条事务 ${JSON.stringify(input)}`);
    if (result.transactions.length === 1) {
        eq(result.transactions[0].newHTML.includes(expected.split("=").pop()),
            true, `事务里的新内容包含结果 ${JSON.stringify(input)}`);
        eq(result.transactions[0].oldHTML.includes(input), true, `事务里的旧内容是原文 ${JSON.stringify(input)}`);
    }
}

// —— 不该结算的情形：不应该拦截回车，也不应该产生事务
const noopCases = ["测试", "12*5", "abc=", "(1+2="];
for (const input of noopCases) {
    const result = await runCase(input);
    eq(result.text, input, `不结算 ${JSON.stringify(input)}`);
    eq(result.prevented, false, `不拦截回车 ${JSON.stringify(input)}`);
    eq(result.transactions.length, 0, `无事务 ${JSON.stringify(input)}`);
}

// —— 关闭开关后不结算
const disabled = await runCase("12*5=", {settings: {enabled: false}});
eq(disabled.text, "12*5=", "关闭后不结算");
eq(disabled.prevented, false, "关闭后不拦截回车");

// —— 精度设置生效：1/3 保留 4 位小数
const rounded = await runCase("1/3=", {settings: {roundMode: "places", roundDigits: 4}});
eq(rounded.text, "1/3=0.3333", "精度设置生效（4 位小数）");
eq(rounded.prevented, true, "精度设置下仍拦截回车");

// —— 精度设置生效：方程解也按精度显示
const equationRounded = await runCase("3x=1=", {settings: {roundMode: "places", roundDigits: 2}});
eq(equationRounded.text, "3x=1=0.33", "方程解同样按精度显示");

// —— 换行组合键不拦截
const shiftCase = await runCase("12*5=");
eq(shiftCase.text, "12*5=60", "默认设置下可结算（用于对照）");

/* ------------------------------------------------------------------ *
 * 7. 顶栏与设置面板
 * ------------------------------------------------------------------ */

// 加载插件，用来检查顶栏行为和设置面板
topBarOptions.length = 0;
registeredIcons.length = 0;
editors.length = 0;
const ioPlugin = new PluginClass({
    app: {plugins: []},
    name: "plugin-calc",
    displayName: "等号计算",
    i18n: {
        on: "开", off: "关",
        enabledTitle: "自动计算", enabledTip: "提示",
        spaceTitle: "空格", spaceTip: "提示2",
        ctrlEnterTitle: "Ctrl回车", ctrlEnterTip: "提示3",
        precisionTitle: "结果精度", precisionTip: "精度提示",
        roundExact: "精确", roundPlaces: "保留小数位数", roundDigits: "保留有效数字位数",
        usageTitle: "用法", usageTip: "示例",
        savedMessage: "已保存"
    }
});
await ioPlugin.onload();

// 插件不占用顶栏：不注册图标、不加顶栏按钮。
// 设置入口由思源根据 openSetting 生成（顶栏插件菜单 →「等号计算」）。
eq(topBarOptions.length, 0, "不注册顶栏按钮");
eq(registeredIcons.length, 0, "不注册自定义图标 symbol");
eq(typeof ioPlugin.toggleEnabled, "undefined", "没有顶栏开关方法");
eq(typeof ioPlugin.syncTopBarState, "undefined", "没有顶栏状态同步方法");

// 设置面板可以正常打开
eq(!!ioPlugin.setting, true, "插件创建了 Setting 实例");
eq(ioPlugin.setting.items.length, 5, "设置项数量（3 个开关 + 精度 + 用法说明）");
const settingTitles = ioPlugin.setting.items.map((item) => item.title).join(",");
eq(settingTitles.includes("自动计算"), true, "包含自动计算开关");
eq(settingTitles.includes("空格"), true, "包含空格开关");
eq(settingTitles.includes("Ctrl回车"), true, "包含 Ctrl+回车开关");
eq(settingTitles.includes("结果精度"), true, "包含结果精度设置");
eq(settingTitles.includes("用法"), true, "包含用法说明");

// 精度设置：下拉框 + 位数输入，且精确模式下输入框禁用
const precisionItem = ioPlugin.setting.items[3];
eq(precisionItem.actionElement.children.length, 2, "精度设置包含模式与位数两个控件");
const [modeControl, digitsControl] = precisionItem.actionElement.children;
eq(modeControl.value, "exact", "精度模式默认精确");
eq(digitsControl.disabled, true, "精确模式下位数输入框禁用");
modeControl.value = "places";
modeControl.dispatchEvent({type: "change"});
eq(ioPlugin.settings.roundMode, "places", "切换精度模式写入状态");
eq(digitsControl.disabled, false, "切到小数位模式后输入框可用");
digitsControl.value = "3";
digitsControl.dispatchEvent({type: "change"});
eq(ioPlugin.settings.roundDigits, 3, "位数写入状态");
eq(ioPlugin.getPrecisionOptions().roundMode, "places", "getPrecisionOptions 返回模式");
eq(ioPlugin.getPrecisionOptions().roundDigits, 3, "getPrecisionOptions 返回位数");
// 回到精确模式
modeControl.value = "exact";
modeControl.dispatchEvent({type: "change"});
eq(digitsControl.disabled, true, "切回精确模式后输入框再次禁用");

let openFailed = "";
try {
    ioPlugin.openSetting();
} catch (error) {
    openFailed = error.message;
}
eq(openFailed, "", "openSetting() 不抛异常");
eq(ioPlugin.setting.opened, true, "设置面板已打开");
eq(ioPlugin.setting.openedName, "等号计算", "设置面板标题为插件显示名");

// 设置里的开关能改到内存状态并落盘
const enabledItem = ioPlugin.setting.items[0];
enabledItem.actionElement.value = "false";
enabledItem.actionElement.dispatchEvent({type: "change"});
eq(ioPlugin.settings.enabled, false, "设置面板切换开关会写入插件状态");
eq(ioPlugin.data.settings.enabled, false, "设置面板切换开关会落盘");

// 保存回调
messages.length = 0;
ioPlugin.setting.options.confirmCallback();
eq(messages.includes("已保存"), true, "点击保存会提示已保存");
ioPlugin.onunload();

console.log(`\n插件集成测试: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
