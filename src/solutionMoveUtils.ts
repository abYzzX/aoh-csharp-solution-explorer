import * as path from 'path';

export type SolutionMove = { kind: 'project'; projectPath: string }
    | { kind: 'solutionFolder'; folderPath: string[] }
    | { kind: 'solutionItem'; filePath: string; folderPath: string[] };
const folderTypes = /^(66A26720-8FB5-11D2-AA7E-00C04F688DDE|2150E333-8FDC-42A3-9474-1A3956D46DE8)$/i;
const equal = (a: string[], b: string[]): boolean => a.length === b.length && a.every((part, i) => part === b[i]);
const below = (a: string[], b: string[]): boolean => a.length >= b.length && b.every((part, i) => part === a[i]);
const normalize = (value: string): string => {
    const result = path.normalize(value.replace(/[\\/]/g, path.sep));
    return process.platform === 'win32' ? result.toLowerCase() : result;
};
const segments = (value: string): string[] => value.replace(/\\/g, '/').split('/').filter(Boolean);
const escapeXml = (value: string): string => value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const decodeXml = (value: string): string => value.replace(/&(?:#x([\da-f]+)|#(\d+)|(amp|quot|apos|lt|gt));/gi, (_, hex, decimal, name) =>
    hex || decimal ? String.fromCodePoint(parseInt(hex ?? decimal, hex ? 16 : 10)) : ({ amp: '&', quot: '"', apos: "'", lt: '<', gt: '>' }[name as string] ?? _));

/** Changes only logical solution membership, never physical project paths. Throws before any write. */
export function moveSolutionEntries(text: string, solutionPath: string, sources: SolutionMove[], destination: string[]): string {
    sources = [...new Map(sources.map(source => [JSON.stringify(source), source])).values()];
    if (sources.some(source => source.kind === 'solutionItem' && (!source.folderPath.length || !destination.length))) {
        throw new Error('Files can only be reorganized from one Solution Folder to another.');
    }
    const folderSources = sources.filter((source): source is Extract<SolutionMove, { kind: 'solutionFolder' }> => source.kind === 'solutionFolder');
    for (const source of folderSources) {
        if (!source.folderPath.length || below(destination, source.folderPath)) throw new Error('Cannot move a Solution Folder into itself.');
    }
    // A selected folder carries its descendants with it.
    const effective = sources.filter(source => source.kind === 'project' || !folderSources.some(parent =>
        parent !== source && (source.kind === 'solutionItem' || parent.folderPath.length < source.folderPath.length) && below(source.folderPath, parent.folderPath)));
    return solutionPath.toLowerCase().endsWith('.slnx')
        ? moveSlnx(text, solutionPath, effective, destination)
        : moveSln(text, solutionPath, effective, destination);
}

function moveSln(text: string, solutionPath: string, sources: SolutionMove[], destination: string[]): string {
    const entries = [...text.matchAll(/^Project\("\{([^}]+)\}"\)\s*=\s*"([^"]+)",\s*"([^"]+)",\s*"\{([^}]+)\}"/gm)]
        .map(match => ({ type: match[1], name: match[2], file: match[3], id: match[4].toUpperCase() }));
    const parents = new Map<string, string>();
    const section = /[ \t]*GlobalSection\(NestedProjects\)\s*=\s*preSolution\r?\n([\s\S]*?)[ \t]*EndGlobalSection/.exec(text);
    for (const match of (section?.[1] ?? '').matchAll(/\{([^}]+)\}\s*=\s*\{([^}]+)\}/g)) parents.set(match[1].toUpperCase(), match[2].toUpperCase());
    const folders = new Map(entries.filter(entry => folderTypes.test(entry.type)).map(entry => [entry.id, entry]));
    const folderPath = (id: string): string[] => {
        const result: string[] = [];
        const seen = new Set<string>();
        for (let current: string | undefined = id; current; current = parents.get(current)) {
            if (seen.has(current)) throw new Error('The solution contains cyclic folder nesting.');
            seen.add(current);
            const folder = folders.get(current);
            if (!folder) throw new Error('Could not resolve a Solution Folder.');
            result.unshift(...segments(folder.name));
        }
        return result;
    };
    const findFolder = (parts: string[]): string | undefined => [...folders.keys()].find(id => equal(folderPath(id), parts));
    const target = destination.length ? findFolder(destination) : undefined;
    if (destination.length && !target) throw new Error('The target Solution Folder no longer exists.');
    const selected = new Set(sources.filter(source => source.kind !== 'solutionItem').map(source => {
        const id = source.kind === 'solutionFolder' ? findFolder(source.folderPath) : entries.find(entry =>
            !folderTypes.test(entry.type) && normalize(path.resolve(path.dirname(solutionPath), entry.file.replace(/\\/g, path.sep))) === normalize(source.projectPath))?.id;
        if (!id) throw new Error('A dragged project or Solution Folder no longer exists.');
        return id;
    }));
    const effective = [...selected].filter(id => {
        const seen = new Set<string>();
        for (let parent = parents.get(id); parent; parent = parents.get(parent)) {
            if (seen.has(parent)) throw new Error('The solution contains cyclic folder nesting.');
            seen.add(parent);
            if (selected.has(parent)) return false;
        }
        return parents.get(id) !== target;
    });
    const names = new Set(entries.filter(entry => parents.get(entry.id) === target && !effective.includes(entry.id)).map(entry => entry.name));
    for (const id of effective) {
        const name = entries.find(entry => entry.id === id)!.name;
        if (names.has(name)) throw new Error(`'${name}' already exists in the target Solution Folder.`);
        names.add(name);
    }
    text = moveSlnItems(text, solutionPath, sources, target, findFolder);
    if (!effective.length) return text;
    const eol = text.includes('\r\n') ? '\r\n' : '\n';
    const body = (section?.[1] ?? '').split(/(?<=\n)/).filter(line => {
        const id = /\{([^}]+)\}\s*=/.exec(line)?.[1].toUpperCase();
        return !id || !effective.includes(id);
    }).join('') + (target ? effective.map(id => `\t\t{${id}} = {${target}}${eol}`).join('') : '');
    const replacement = `\tGlobalSection(NestedProjects) = preSolution${eol}${body}\tEndGlobalSection`;
    if (section) return text.replace(/[ \t]*GlobalSection\(NestedProjects\)\s*=\s*preSolution\r?\n([\s\S]*?)[ \t]*EndGlobalSection/, () => replacement);
    if (!/^EndGlobal\r?$/m.test(text)) throw new Error('Could not find the solution EndGlobal section.');
    return text.replace(/^EndGlobal\r?$/m, `${replacement}${eol}EndGlobal${eol === '\r\n' ? '\r' : ''}`);
}

function moveSlnItems(text: string, solutionPath: string, sources: SolutionMove[], target: string | undefined, findFolder: (parts: string[]) => string | undefined): string {
    const files = sources.filter((source): source is Extract<SolutionMove, { kind: 'solutionItem' }> => source.kind === 'solutionItem');
    if (!files.length) return text;
    if (!target) throw new Error('Files must be dropped onto a Solution Folder.');
    const blockRegex = /^Project\([^\r\n]+\)\s*=\s*"[^"]+",\s*"[^"]+",\s*"\{([^}]+)\}"\r?\n[\s\S]*?^EndProject[ \t]*(?:\r?\n|$)/gm;
    const blocks = new Map([...text.matchAll(blockRegex)].map(match => [match[1].toUpperCase(), match[0]]));
    const sectionRegex = /[ \t]*ProjectSection\(SolutionItems\)\s*=\s*preProject\r?\n([\s\S]*?)[ \t]*EndProjectSection/;
    const lines = (block: string): string[] => (sectionRegex.exec(block)?.[1] ?? '').split(/(?<=\n)/).filter(Boolean);
    const fileKey = (line: string): string | undefined => {
        const item = /^\s*(.*?)\s*=/.exec(line)?.[1];
        return item ? normalize(path.resolve(path.dirname(solutionPath), item.replace(/\\/g, path.sep))) : undefined;
    };
    const removals = new Map<string, Set<string>>();
    const additions: string[] = [];
    const existing = new Set(lines(blocks.get(target) ?? '').map(fileKey));
    for (const source of files) {
        const owner = findFolder(source.folderPath);
        if (!owner) throw new Error('The source Solution Folder no longer exists.');
        const key = normalize(source.filePath);
        const line = lines(blocks.get(owner) ?? '').find(line => fileKey(line) === key);
        if (!line) throw new Error('The file is no longer part of the source Solution Folder.');
        if (owner === target) continue;
        if (existing.has(key)) throw new Error('The target Solution Folder already contains this file.');
        existing.add(key);
        additions.push(line);
        if (!removals.has(owner)) removals.set(owner, new Set());
        removals.get(owner)!.add(key);
    }
    if (!additions.length) return text;
    const eol = text.includes('\r\n') ? '\r\n' : '\n';
    return text.replace(blockRegex, (block: string, id: string) => {
        id = id.toUpperCase();
        if (!removals.has(id) && id !== target) return block;
        const body = lines(block).filter(line => !removals.get(id)?.has(fileKey(line) ?? '')).join('') + (id === target ? additions.join('') : '');
        const section = `\tProjectSection(SolutionItems) = preProject${eol}${body}\tEndProjectSection`;
        return sectionRegex.test(block) ? block.replace(sectionRegex, () => section) : block.replace(/^EndProject/m, () => `${section}${eol}EndProject`);
    });
}

interface XmlNode { tag: string; start: number; openEnd: number; closeStart: number; end: number; parent?: XmlNode; attrs: Record<string, string>; folder: string[] }
function parseXml(text: string): XmlNode[] {
    const nodes: XmlNode[] = [], stack: XmlNode[] = [];
    for (const match of text.matchAll(/<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<\/?[A-Za-z](?:[^<>"']|"[^"]*"|'[^']*')*>/g)) {
        const token = match[0], start = match.index!;
        if (token.startsWith('<!--') || token.startsWith('<?')) continue;
        const tag = /^<\/?([\w:.-]+)/.exec(token)![1];
        if (token.startsWith('</')) {
            const node = stack.pop();
            if (!node || node.tag !== tag) throw new Error('Unsupported or malformed solution XML.');
            node.closeStart = start; node.end = start + token.length;
            continue;
        }
        const attrs: Record<string, string> = {};
        for (const attr of token.matchAll(/([\w:.-]+)\s*=\s*(["'])(.*?)\2/g)) attrs[attr[1]] = decodeXml(attr[3]);
        const parent = stack.at(-1);
        const parentFolder = parent?.folder ?? [];
        const folder = tag === 'Folder' && attrs.Name
            ? (/^[\\/]/.test(attrs.Name) ? segments(attrs.Name) : [...parentFolder, ...segments(attrs.Name)]) : parentFolder;
        const node: XmlNode = { tag, start, openEnd: start + token.length, closeStart: start + token.length, end: start + token.length, parent, attrs, folder };
        nodes.push(node);
        if (!/\/\s*>$/.test(token)) stack.push(node);
    }
    if (stack.length) throw new Error('Unsupported or malformed solution XML.');
    return nodes;
}

function moveSlnx(text: string, solutionPath: string, sources: SolutionMove[], destination: string[]): string {
    let nodes = parseXml(text);
    const selectedFolders = sources.filter((source): source is Extract<SolutionMove, { kind: 'solutionFolder' }> => source.kind === 'solutionFolder');
    // Validate against both explicit and implicit folder paths before editing.
    const paths = nodes.filter(node => node.tag === 'Folder').flatMap(node => node.folder.map((_, i) => node.folder.slice(0, i + 1)));
    if (destination.length && !paths.some(parts => equal(parts, destination))) throw new Error('The target Solution Folder no longer exists.');
    const occupied = new Set(paths.filter(parts => equal(parts.slice(0, -1), destination)).map(parts => parts.at(-1)!));
    for (const source of selectedFolders) {
        if (!paths.some(parts => equal(parts, source.folderPath))) throw new Error('A dragged Solution Folder no longer exists.');
        if (equal(source.folderPath.slice(0, -1), destination)) continue;
        const name = source.folderPath.at(-1)!;
        if (occupied.has(name)) throw new Error(`'${name}' already exists in the target Solution Folder.`);
        occupied.add(name);
    }
    // Rename all affected logical paths, including flat absolute descendant declarations.
    const renames: Array<{ start: number; end: number; text: string }> = [];
    for (const node of nodes.filter(node => node.tag === 'Folder')) {
        const source = selectedFolders.find(source => below(node.folder, source.folderPath));
        if (!source || equal(source.folderPath.slice(0, -1), destination)) continue;
        const next = [...destination, source.folderPath.at(-1)!, ...node.folder.slice(source.folderPath.length)];
        const opening = text.slice(node.start, node.openEnd).replace(/\bName\s*=\s*(["']).*?\1/, `Name="/${escapeXml(next.join('/'))}/"`);
        renames.push({ start: node.start, end: node.openEnd, text: opening });
    }
    const items = sources.filter(source => source.kind !== 'solutionFolder');
    const moving: XmlNode[] = [];
    for (const source of items) {
        const filePath = source.kind === 'project' ? source.projectPath : source.filePath;
        const tag = source.kind === 'project' ? 'Project' : 'File';
        const node = nodes.find(node => node.tag === tag && node.attrs.Path &&
            (source.kind === 'project' || equal(node.folder, source.folderPath)) &&
            normalize(path.resolve(path.dirname(solutionPath), node.attrs.Path.replace(/\\/g, path.sep))) === normalize(filePath));
        if (!node) throw new Error('A dragged project or solution item no longer exists.');
        if (selectedFolders.some(folder => below(node.folder, folder.folderPath)) || equal(node.folder, destination) || moving.includes(node)) continue;
        if (nodes.some(other => other !== node && other.tag === tag && equal(other.folder, destination) && other.attrs.Path &&
            normalize(path.resolve(path.dirname(solutionPath), other.attrs.Path.replace(/\\/g, path.sep))) === normalize(filePath))) {
            throw new Error('The target Solution Folder already contains this item.');
        }
        moving.push(node);
    }
    const blocks = moving.map(node => text.slice(node.start, node.end));
    for (const node of moving) renames.push({ start: node.start, end: node.end, text: '' });
    for (const edit of renames.sort((a, b) => b.start - a.start)) text = text.slice(0, edit.start) + edit.text + text.slice(edit.end);
    // Keep moved absolute folder declarations at solution level. This also handles
    // nested input without leaving a moved folder physically inside its old parent.
    nodes = parseXml(text);
    const movedPaths = selectedFolders.filter(source => !equal(source.folderPath.slice(0, -1), destination))
        .map(source => [...destination, source.folderPath.at(-1)!]);
    const candidates = nodes.filter(node => node.tag === 'Folder' && movedPaths.some(parts => below(node.folder, parts)));
    const movedFolders = candidates.filter(node => !candidates.some(parent => parent !== node && parent.start < node.start && parent.end > node.end));
    const folderBlocks = movedFolders.map(node => text.slice(node.start, node.end));
    for (const node of movedFolders.sort((a, b) => b.start - a.start)) text = text.slice(0, node.start) + text.slice(node.end);
    if (folderBlocks.length) {
        const root = parseXml(text).find(node => node.tag === 'Solution');
        if (!root) throw new Error('Could not find the solution element.');
        const eol = text.includes('\r\n') ? '\r\n' : '\n';
        text = text.slice(0, root.closeStart) + folderBlocks.join(eol) + eol + text.slice(root.closeStart);
    }
    if (!blocks.length) return text;
    nodes = parseXml(text);
    const eol = text.includes('\r\n') ? '\r\n' : '\n';
    let target = nodes.find(node => destination.length ? node.tag === 'Folder' && equal(node.folder, destination) : node.tag === 'Solution');
    if (!target && destination.length) {
        const root = nodes.find(node => node.tag === 'Solution');
        if (!root) throw new Error('Could not find the solution element.');
        const block = `<Folder Name="/${escapeXml(destination.join('/'))}/">${eol}${blocks.join(eol)}${eol}</Folder>${eol}`;
        return text.slice(0, root.closeStart) + block + text.slice(root.closeStart);
    }
    if (!target) throw new Error('Could not find the target solution element.');
    const content = `${eol}${blocks.join(eol)}${eol}`;
    if (target.end === target.openEnd) {
        const opening = text.slice(target.start, target.openEnd).replace(/\/\s*>$/, '>');
        return text.slice(0, target.start) + opening + content + `</${target.tag}>` + text.slice(target.end);
    }
    return text.slice(0, target.closeStart) + content + text.slice(target.closeStart);
}
