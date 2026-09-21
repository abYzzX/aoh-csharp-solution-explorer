/** Adds an object to a top-level JSON/JSONC array property without reformatting the rest of the file. */
export function appendObjectToJsoncArray(text: string, property: string, objectText: string): string | undefined {
    const match = findTopLevelArray(text, property);
    if (!match) return undefined;

    const arrayStart = match.arrayStart;
    const arrayEnd = findMatchingBracket(text, arrayStart);
    if (arrayEnd < 0) return undefined;

    const inside = text.slice(arrayStart + 1, arrayEnd);
    const indent = detectIndent(text, match.index);
    const childIndent = `${indent}  `;
    const formatted = objectText.split('\n').map(line => `${childIndent}${line}`).join('\n');
    const lastToken = lastJsoncToken(inside);
    const lineEnding = text.includes('\r\n') ? '\r\n' : '\n';
    const insertion = lastToken !== undefined && lastToken !== ','
        ? `,${lineEnding}${formatted}${lineEnding}${indent}`
        : `${lineEnding}${formatted}${lineEnding}${indent}`;

    return `${text.slice(0, arrayEnd)}${insertion}${text.slice(arrayEnd)}`;
}

function findMatchingBracket(text: string, start: number): number {
    let depth = 0;
    let inString = false;
    let quote = '';
    let lineComment = false;
    let blockComment = false;

    for (let i = start; i < text.length; i++) {
        const c = text[i];
        const n = text[i + 1];
        if (lineComment) { if (c === '\n') lineComment = false; continue; }
        if (blockComment) { if (c === '*' && n === '/') { blockComment = false; i++; } continue; }
        if (inString) { if (c === '\\') { i++; continue; } if (c === quote) inString = false; continue; }
        if (c === '/' && n === '/') { lineComment = true; i++; continue; }
        if (c === '/' && n === '*') { blockComment = true; i++; continue; }
        if (c === '"' || c === "'") { inString = true; quote = c; continue; }
        if (c === '[') depth++;
        if (c === ']' && --depth === 0) return i;
    }
    return -1;
}

function lastJsoncToken(text: string): string | undefined {
    let last: string | undefined;
    let i = 0;
    while ((i = skipTrivia(text, i)) < text.length) {
        const c = text[i++];
        if (c === '"' || c === "'") {
            while (i < text.length && text[i] !== c) {
                if (text[i] === '\\') i++;
                i++;
            }
            i++;
        }
        last = c;
    }
    return last;
}

function detectIndent(text: string, index: number): string {
    const lineStart = text.lastIndexOf('\n', index) + 1;
    return /^\s*/.exec(text.slice(lineStart, index))?.[0] ?? '';
}

function skipTrivia(text: string, start: number): number {
    let i = start;
    while (i < text.length) {
        if (/\s/.test(text[i])) { i++; continue; }
        if (text.startsWith('//', i)) {
            while (i < text.length && text[i] !== '\n' && text[i] !== '\r') i++;
            continue;
        }
        if (text.startsWith('/*', i)) {
            const end = text.indexOf('*/', i + 2);
            if (end < 0) return text.length;
            i = end + 2;
            continue;
        }
        break;
    }
    return i;
}

function findTopLevelArray(text: string, property: string): { index: number; arrayStart: number } | undefined {
    let i = skipTrivia(text, 0);
    if (text[i] !== '{') return undefined;
    let depth = 1;
    let previous = '{';
    i++;

    while ((i = skipTrivia(text, i)) < text.length && depth > 0) {
        const c = text[i];
        if (c === '"' || c === "'") {
            const start = i++;
            while (i < text.length && text[i] !== c) {
                if (text[i] === '\\') i++;
                i++;
            }
            if (i >= text.length) return undefined;
            i++;
            if (depth === 1 && (previous === '{' || previous === ',')) {
                let name: string;
                try {
                    name = c === '"' ? JSON.parse(text.slice(start, i)) : text.slice(start + 1, i - 1);
                } catch { return undefined; }
                const colon = skipTrivia(text, i);
                const value = skipTrivia(text, colon + 1);
                if (name === property && text[colon] === ':' && text[value] === '[') {
                    return { index: start, arrayStart: value };
                }
            }
            previous = 'string';
            continue;
        }
        if (c === '{' || c === '[') depth++;
        if (c === '}' || c === ']') depth--;
        previous = c;
        i++;
    }
    return undefined;
}
