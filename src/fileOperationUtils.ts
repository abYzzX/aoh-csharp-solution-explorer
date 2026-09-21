/** Helpers for filesystem edit operations that can be tested without VS Code. */

export function isValidSinglePathName(value: string): boolean {
    const name = value.trim();
    return name.length > 0 && name !== '.' && name !== '..' && !/[\\/]/.test(name);
}

/**
 * Conservatively rename the type that matches a copied C# file name.
 *
 * This intentionally does less rather than guessing. The rename is only applied
 * when exactly one class/record/struct/interface/enum declaration matches the old
 * file stem and every additional identifier occurrence is a constructor/destructor
 * declaration. If the old identifier is used anywhere else, the source is returned
 * unchanged so we never rewrite arbitrary code by string replacement.
 */
export function renameMatchingCSharpType(
    source: string,
    oldTypeName: string,
    newTypeName: string
): { text: string; renamed: boolean } {
    if (!isCSharpIdentifier(oldTypeName) || !isCSharpIdentifier(newTypeName) || oldTypeName === newTypeName) {
        return { text: source, renamed: false };
    }

    const declaration = new RegExp(`\\b(class|record|struct|interface|enum)\\s+${escapeRegExp(oldTypeName)}\\b`, 'g');
    const declarations = [...source.matchAll(declaration)];
    if (declarations.length !== 1) return { text: source, renamed: false };

    const identifier = new RegExp(`\\b${escapeRegExp(oldTypeName)}\\b`, 'g');
    const occurrences = [...source.matchAll(identifier)];
    if (!occurrences.length) return { text: source, renamed: false };

    const declarationNameIndex = declarations[0].index! + declarations[0][0].lastIndexOf(oldTypeName);
    const safeIndexes = new Set<number>([declarationNameIndex]);

    // Constructors/destructors are safe to rename together with the matching type.
    const constructor = new RegExp(`(?:^|[\\r\\n])[^\\r\\n]*?\\b(~?)${escapeRegExp(oldTypeName)}\\s*\\(`, 'g');
    for (const match of source.matchAll(constructor)) {
        const local = match[0].lastIndexOf(oldTypeName);
        if (local >= 0) safeIndexes.add(match.index! + local);
    }

    if (occurrences.some(match => !safeIndexes.has(match.index!))) {
        return { text: source, renamed: false };
    }

    return {
        text: source.replace(identifier, newTypeName),
        renamed: true
    };
}

function isCSharpIdentifier(value: string): boolean {
    return /^[_A-Za-z][_A-Za-z0-9]*$/.test(value);
}

function escapeRegExp(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
