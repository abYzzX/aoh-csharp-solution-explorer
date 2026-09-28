/** Narrow exact child patterns without changing wildcard matching or file order. */
export class FileNestingCandidates<T extends { label: string }> {
    private exact: Map<string, T[]> | undefined;
    private sorted: Array<{ file: T; order: number }> | undefined;
    private readonly collator = new Intl.Collator(undefined, { sensitivity: 'accent' });

    constructor(private readonly files: T[], private readonly caseSensitive = process.platform === 'linux') {}

    get(pattern: string): T[] {
        if (pattern.includes('*')) return this.files;
        if (this.caseSensitive) {
            if (!this.exact) {
                this.exact = new Map();
                for (const file of this.files) {
                    const group = this.exact.get(file.label) ?? [];
                    group.push(file);
                    this.exact.set(file.label, group);
                }
            }
            return this.exact.get(pattern) ?? [];
        }

        // Preserve localeCompare's accent-sensitive equality, including Unicode
        // equivalents; lowercasing names is not an equivalent comparison.
        this.sorted ??= this.files.map((file, order) => ({ file, order }))
            .sort((a, b) => this.collator.compare(a.file.label, b.file.label));
        let low = 0;
        let high = this.sorted.length;
        while (low < high) {
            const middle = (low + high) >>> 1;
            if (this.collator.compare(this.sorted[middle].file.label, pattern) < 0) low = middle + 1;
            else high = middle;
        }
        const matches: Array<{ file: T; order: number }> = [];
        for (let i = low; i < this.sorted.length && this.collator.compare(this.sorted[i].file.label, pattern) === 0; i++) {
            matches.push(this.sorted[i]);
        }
        return matches.sort((a, b) => a.order - b.order).map(entry => entry.file);
    }
}
