import * as path from 'path';

const identifier = '@?[\\p{L}_][\\p{L}\\p{N}\\p{Mn}\\p{Mc}\\p{Pc}\\p{Cf}]*';
const namespacePattern = new RegExp(`^${identifier}(?:\\.${identifier})*$`, 'u');
const keywords = new Set(('abstract as base bool break byte case catch char checked class const continue decimal default delegate do double else enum event explicit extern false finally fixed float for foreach goto if implicit in int interface internal is lock long namespace new null object operator out override params private protected public readonly ref return sbyte sealed short sizeof stackalloc static string struct switch this throw true try typeof uint ulong unchecked unsafe ushort using virtual void volatile while').split(' '));

export function expectedNamespace(projectFile: string, file: string, rootNamespace: string): string | undefined {
    const relative = path.relative(path.dirname(projectFile), path.dirname(file));
    if (path.isAbsolute(relative) || relative.split(path.sep).includes('..')) return undefined;
    const parts = [rootNamespace, ...relative.split(path.sep)].filter(Boolean).flatMap(part => part.split('.'));
    const result = parts.map(part => keywords.has(part) ? `@${part}` : part).join('.');
    return namespacePattern.test(result) ? result : undefined;
}

