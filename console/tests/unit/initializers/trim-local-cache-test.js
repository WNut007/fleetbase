import { module, test } from 'qunit';
import { trimLocalCache, LOCAL_CACHE_KEY } from '@fleetbase/console/initializers/trim-local-cache';

class MemoryStorage {
    constructor(items = {}) {
        this.items = { ...items };
    }
    getItem(key) {
        return key in this.items ? this.items[key] : null;
    }
    setItem(key, value) {
        this.items[key] = String(value);
    }
    removeItem(key) {
        delete this.items[key];
    }
}

module('Unit | Initializer | trim-local-cache', function () {
    test('it drops oversized entries and their versions, keeping the rest', function (assert) {
        const cache = { 'lookup/countries': 'x'.repeat(200), 'lookup/countries-version': '2026-11-23', small: 'ok' };
        const storage = new MemoryStorage({ [LOCAL_CACHE_KEY]: JSON.stringify(cache) });

        assert.deepEqual(trimLocalCache(storage, 100), ['lookup/countries']);
        assert.deepEqual(JSON.parse(storage.getItem(LOCAL_CACHE_KEY)), { small: 'ok' });
    });

    test('a small cache is left untouched', function (assert) {
        const storage = new MemoryStorage({ [LOCAL_CACHE_KEY]: JSON.stringify({ small: 'ok' }) });

        assert.deepEqual(trimLocalCache(storage, 100), []);
        assert.deepEqual(trimLocalCache(new MemoryStorage(), 100), [], 'no cache at all');
    });

    test('a large cache without one oversized entry is not rewritten', function (assert) {
        const cache = { a: 'x'.repeat(60), b: 'y'.repeat(60) };
        const storage = new MemoryStorage({ [LOCAL_CACHE_KEY]: JSON.stringify(cache) });
        storage.setItem = () => assert.ok(false, 'should not write');

        assert.deepEqual(trimLocalCache(storage, 100), []);
    });

    test('an unreadable cache is removed; unavailable storage is ignored', function (assert) {
        const storage = new MemoryStorage({ [LOCAL_CACHE_KEY]: '{not json' + 'x'.repeat(200) });

        assert.deepEqual(trimLocalCache(storage, 100), [LOCAL_CACHE_KEY]);
        assert.strictEqual(storage.getItem(LOCAL_CACHE_KEY), null);

        const blocked = {
            getItem() {
                throw new Error('SecurityError');
            },
        };
        assert.deepEqual(trimLocalCache(blocked, 100), []);
    });
});
