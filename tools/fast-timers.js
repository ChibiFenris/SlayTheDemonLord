'use strict';
// Preload for automated playtests: removes the short dramatic pauses between
// turns so bot games finish quickly, and tags server errors so the runner can count them.
const realSetTimeout = global.setTimeout;
global.setTimeout = (fn, ms, ...args) => realSetTimeout(fn, (ms && ms <= 5000) ? 0 : ms, ...args);
const realError = console.error;
console.error = (...a) => realError('@@ERR', ...a.map(x => (x && x.stack) ? x.stack : x));
