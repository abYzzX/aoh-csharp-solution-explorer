/** Shares in-flight reads and caps concurrent I/O. Create one cache per tree build. */
export class AsyncReadCache<T> {
    private readonly values = new Map<string, Promise<T>>();
    private readonly waiting: Array<(() => void) | undefined> = [];
    private waitingHead = 0;
    private active = 0;

    constructor(private readonly read: (key: string) => PromiseLike<T>, private readonly concurrency = 8) {
        if (!Number.isInteger(concurrency) || concurrency < 1) throw new Error('Invalid concurrency');
    }

    get(key: string): Promise<T> {
        let value = this.values.get(key);
        if (!value) {
            value = this.run(key);
            this.values.set(key, value);
            void value.catch(() => {
                if (this.values.get(key) === value) this.values.delete(key);
            });
        }
        return value;
    }

    private async run(key: string): Promise<T> {
        if (this.active >= this.concurrency) {
            await new Promise<void>(resolve => this.waiting.push(resolve));
        } else {
            this.active++;
        }
        try {
            return await this.read(key);
        } finally {
            const next = this.waiting[this.waitingHead];
            if (next) this.waiting[this.waitingHead++] = undefined;
            if (this.waitingHead === this.waiting.length) {
                this.waiting.length = 0;
                this.waitingHead = 0;
            }
            if (next) next();
            else this.active--;
        }
    }
}
