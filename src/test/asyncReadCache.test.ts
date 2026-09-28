import * as assert from 'node:assert/strict';
import { test } from 'node:test';
import { AsyncReadCache } from '../asyncReadCache';

test('shared projects reuse in-flight and completed reads within one build', async () => {
    let reads = 0;
    const cache = new AsyncReadCache(async key => { reads++; return key; });
    const first = cache.get('shared/project');
    assert.equal(cache.get('shared/project'), first);
    assert.equal(await first, 'shared/project');
    assert.equal(await cache.get('shared/project'), 'shared/project');
    assert.equal(reads, 1);
});

test('caps concurrent reads while allowing independent directories to progress', async () => {
    let active = 0;
    let peak = 0;
    const cache = new AsyncReadCache(async key => {
        active++;
        peak = Math.max(peak, active);
        await new Promise<void>(resolve => setImmediate(resolve));
        active--;
        return key;
    }, 4);
    const keys = Array.from({ length: 100 }, (_, index) => String(index));
    assert.deepEqual(await Promise.all(keys.map(key => cache.get(key))), keys);
    assert.equal(peak, 4);
    assert.equal(active, 0);
});

test('failed reads release slots and can be retried', async () => {
    let fail = true;
    const cache = new AsyncReadCache(async key => {
        if (key === 'missing' && fail) throw new Error('missing');
        return key;
    }, 1);
    const missing = cache.get('missing');
    const queued = cache.get('next');
    await assert.rejects(missing, /missing/);
    assert.equal(await queued, 'next');
    fail = false;
    assert.equal(await cache.get('missing'), 'missing');
});

test('a new build reads fresh data instead of retaining a stale snapshot', async () => {
    let content = 'before';
    const read = async () => content;
    const first = new AsyncReadCache(read);
    assert.equal(await first.get('file'), 'before');
    content = 'after';
    assert.equal(await new AsyncReadCache(read).get('file'), 'after');
});

test('long queues preserve FIFO order and can drain repeatedly', async () => {
    const visited: string[] = [];
    const cache = new AsyncReadCache(async key => {
        visited.push(key);
        await Promise.resolve();
        return key;
    }, 1);
    for (let wave = 0; wave < 3; wave++) {
        const keys = Array.from({ length: 2000 }, (_, i) => `${wave}/${i}`);
        assert.deepEqual(await Promise.all(keys.map(key => cache.get(key))), keys);
        assert.deepEqual(visited.splice(0), keys);
    }
});
