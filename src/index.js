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

import {Plugin, getAllEditor, Setting, showMessage} from "siyuan";
import {settleText} from "./lib/expr.mjs";

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

export default class EqualsCalcPlugin extends Plugin {

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
