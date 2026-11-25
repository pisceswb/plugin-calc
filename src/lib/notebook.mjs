import {calculate} from "./expr.mjs";

const DEFINITION_PATTERN = /^([\p{L}_][\p{L}\p{N}_]*)\s*=\s*(.*)$/u;
const NAME_PATTERN = /^[\p{L}_][\p{L}\p{N}_]*$/u;
const CALC_OPTIONS = {maxLength: 10000};

const evaluate = (expression, definitions, options) => {
    const source = definitions.concat(expression).join(";");
    return calculate(source, Object.assign({}, options, CALC_OPTIONS));
};

const resultOf = (expression, definitions, options) => {
    const result = evaluate(expression, definitions, options);
    return result.ok ? {ok: true, value: result.text} : {ok: false, error: result.error};
};

const parseInline = (line, definitions, options) => {
    const parts = [];
    let cursor = 0;
    const appendText = end => {
        if (end > cursor) {
            parts.push({kind: "text", text: line.slice(cursor, end)});
        }
    };
    while (cursor < line.length) {
        const open = line.indexOf("{{", cursor);
        const close = line.indexOf("}}", cursor);
        if (close > -1 && (open === -1 || close < open)) {
            appendText(close);
            parts.push({kind: "error", error: "缺少 {{"});
            cursor = close + 2;
            continue;
        }
        if (open === -1) {
            appendText(line.length);
            break;
        }
        appendText(open);
        const end = line.indexOf("}}", open + 2);
        if (end === -1) {
            parts.push({kind: "error", error: "缺少 }}"});
            break;
        }
        const expression = line.slice(open + 2, end).trim();
        parts.push(Object.assign({kind: "calculation", source: line.slice(open, end + 2), expression},
            expression ? resultOf(expression, definitions, options) : {ok: false, error: "公式为空"}));
        cursor = end + 2;
    }
    return parts;
};

const looksLikeFormula = (line, definitions) => {
    if (/^[0-9./*^%()]/.test(line) || (/^[+-]/.test(line) && !/^[+-]\s/.test(line)) ||
        (/\d/.test(line) && /[+\-*/^%]/.test(line)) ||
        /^[A-Za-z_][A-Za-z0-9_]*\s*\(/.test(line) ||
        /^[A-Za-z_][A-Za-z0-9_]*(?:\s*[+\-*/^%]\s*[A-Za-z_][A-Za-z0-9_]*)+$/.test(line)) {
        return true;
    }
    return definitions.some(definition => {
        const name = definition.slice(0, definition.indexOf("=")).trim();
        return new RegExp("(?<![\\p{L}\\p{N}_])" + name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") +
            "(?![\\p{L}\\p{N}_])", "u").test(line);
    });
};

export const evaluateNotebook = (source, options = {}) => {
    const lines = String(source || "").replace(/\r\n?/g, "\n").split("\n");
    const definitions = [];
    return lines.map(line => {
        const trimmed = line.trim();
        if (!trimmed) {
            return {kind: "blank", source: line};
        }
        const definition = trimmed.match(DEFINITION_PATTERN);
        if (definition) {
            const name = definition[1];
            const expression = definition[2].trim();
            const result = expression ? resultOf(expression, definitions, options) :
                {ok: false, error: "缺少变量值或公式"};
            if (result.ok) {
                definitions.push(name + "=" + expression);
            }
            return {kind: "definition", source: line, name, expression, result};
        }
        if (trimmed.includes("{{") || trimmed.includes("}}")) {
            const parts = parseInline(line, definitions, options);
            if (parts) {
                return {kind: "inline", source: line, parts};
            }
            return {kind: "inline", source: line, parts: [
                {kind: "text", text: line},
                {kind: "error", error: "缺少 }}"}
            ]};
        }
        let expression = trimmed;
        if (NAME_PATTERN.test(trimmed) && definitions.some(item => item.startsWith(trimmed + "="))) {
            expression = trimmed + "*1";
        }
        const result = resultOf(expression, definitions, options);
        if (result.ok || looksLikeFormula(trimmed, definitions)) {
            return {kind: "formula", source: line, expression: trimmed, result};
        }
        return {kind: "text", source: line};
    });
};
