export const LOCAL_CACHE_KEY = '@fleetbase/storage:local-cache';
export const MAX_ENTRY_SIZE = 256 * 1024;

/**
 * The console keeps fetch responses in one localStorage object, and every write to it
 * re-serialises the whole object. The country list used to be ~5 MB (flag SVG markup), which
 * made each write stall the page and filled the browser's storage quota. The API now sends a
 * small list; drop any oversized entry left from before so it is fetched again.
 */
export function trimLocalCache(storage = window.localStorage, maxEntrySize = MAX_ENTRY_SIZE) {
    let raw;
    try {
        raw = storage.getItem(LOCAL_CACHE_KEY);
    } catch (e) {
        return [];
    }

    if (!raw || raw.length <= maxEntrySize) {
        return [];
    }

    let cache;
    try {
        cache = JSON.parse(raw);
    } catch (e) {
        storage.removeItem(LOCAL_CACHE_KEY);
        return [LOCAL_CACHE_KEY];
    }

    const removed = Object.keys(cache).filter((key) => JSON.stringify(cache[key] ?? null).length > maxEntrySize);
    removed.forEach((key) => {
        delete cache[key];
        delete cache[`${key}-version`];
    });

    if (removed.length) {
        storage.setItem(LOCAL_CACHE_KEY, JSON.stringify(cache));
    }

    return removed;
}

export function initialize() {
    trimLocalCache();
}

export default {
    name: 'trim-local-cache',
    initialize,
};
