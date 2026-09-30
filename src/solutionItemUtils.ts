/** Ensure the conventional root folder used for items added to a solution. */
export function ensureSolutionItemsFolder(text: string, slnx: boolean, guid: string): string {
    const eol = text.includes('\r\n') ? '\r\n' : '\n';
    if (slnx) {
        let depth = 0;
        for (const match of text.matchAll(/<\/?Folder\b[^>]*>/gi)) {
            const token = match[0];
            if (/^<\//.test(token)) { depth--; continue; }
            const name = /\bName="([^"]+)"/i.exec(token)?.[1].replace(/\\/g, '/');
            if (name === '/Solution Items/' || (depth === 0 && name?.replace(/^\/|\/$/g, '') === 'Solution Items')) return text;
            if (!/\/\s*>$/.test(token)) depth++;
        }
        if (!/<\/Solution>\s*$/i.test(text)) throw new Error('Could not find the solution closing element.');
        return text.replace(/<\/Solution>\s*$/i, `  <Folder Name="/Solution Items/" />${eol}</Solution>${eol}`);
    }

    const nested = new Set<string>();
    const section = /GlobalSection\(NestedProjects\)[\s\S]*?EndGlobalSection/i.exec(text)?.[0] ?? '';
    for (const match of section.matchAll(/\{([^}]+)\}\s*=\s*\{[^}]+\}/g)) nested.add(match[1].toUpperCase());
    for (const match of text.matchAll(/^Project\("\{(?:66A26720-8FB5-11D2-AA7E-00C04F688DDE|2150E333-8FDC-42A3-9474-1A3956D46DE8)\}"\)\s*=\s*"Solution Items",\s*"[^"]+",\s*"\{([^}]+)\}"/gmi)) {
        if (!nested.has(match[1].toUpperCase())) return text;
    }
    if (!/^Global\r?$/m.test(text)) throw new Error('Could not find the solution Global section.');
    const folder = `Project("{2150E333-8FDC-42A3-9474-1A3956D46DE8}") = "Solution Items", "Solution Items", "{${guid.toUpperCase()}}"${eol}EndProject${eol}`;
    return text.replace(/^Global\r?$/m, `${folder}Global${eol === '\r\n' ? '\r' : ''}`);
}
