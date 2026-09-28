/** Compile the explorer's existing glob syntax once per structural refresh. */
export function createExcludeMatcher(patterns: readonly string[]): (relativePath: string, name: string) => boolean {
    const expressions = patterns.flatMap(pattern => {
        const normalized = pattern.trim().replace(/\\/g, '/');
        if (!normalized) return [];
        const candidates = normalized.startsWith('**/') ? [normalized, normalized.slice(3)] : [normalized];
        return candidates.map(candidate => {
            const escaped = candidate.replace(/[.+^${}()|[\]\\]/g, '\\$&');
            const regex = escaped
                .replace(/\*\*/g, '§§DOUBLESTAR§§')
                .replace(/\*/g, '[^/]*')
                .replace(/\?/g, '[^/]')
                .replace(/§§DOUBLESTAR§§/g, '.*');
            return new RegExp(`^${regex}$`, 'i');
        });
    });
    return (relativePath, name) => expressions.some(regex => regex.test(name) || regex.test(relativePath));
}
