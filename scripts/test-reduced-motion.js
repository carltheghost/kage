#!/usr/bin/env node
'use strict';

// Exercise the production motion helpers without loading Three.js or a browser.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
function productionFunction(name) {
  const start = html.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `index.html must define ${name}`);
  const open = html.indexOf('{', start);
  let depth = 0;
  for (let i = open; i < html.length; i++) {
    if (html[i] === '{') depth++;
    else if (html[i] === '}' && --depth === 0) return html.slice(start, i + 1);
  }
  assert.fail(`${name} must have a complete function body`);
}

const frameDelta = vm.runInNewContext(`(${productionFunction('frameDelta')})`);
const frameElapsed = vm.runInNewContext(`(${productionFunction('frameElapsed')})`);
assert.equal(frameDelta(1 / 60, true), 0,
  'reduced motion must freeze scene time');
assert.equal(frameDelta(0.2, false), 0.05,
  'normal motion keeps the existing frame-delta cap');

let sceneTime = 0, elapsed = 0;
for (const [raw, reduced] of Array.from({ length: 150 }, () => [1 / 60, true])) {
  sceneTime += frameDelta(raw, reduced);
  elapsed = frameElapsed(raw, elapsed);
}
assert.equal(sceneTime, 0, 'elapsed warmup must not advance the scene while reduced');
assert.ok(elapsed > 2.2, 'the performance governor warmup must elapse while reduced');
const beforeResume = elapsed;
sceneTime += frameDelta(1 / 60, false);
elapsed = frameElapsed(1 / 60, elapsed);
assert.ok(Math.abs(sceneTime - 1 / 60) < 1e-12,
  'resuming motion must advance by the current frame only');
assert.ok(elapsed > beforeResume, 'elapsed warmup must continue without restarting');

const watchReducedMotion = vm.runInNewContext(`(${productionFunction('watchReducedMotion')})`);
const handlers = [];
const media = {
  addEventListener(type, handler) { assert.equal(type, 'change'); handlers.push(handler); },
  removeEventListener(type, handler) { assert.equal(type, 'change'); assert.equal(handlers[0], handler); },
};
const changes = [];
const stopWatching = watchReducedMotion(media, value => changes.push(value));
handlers[0]({ matches: true });
handlers[0]({ matches: false });
stopWatching();
assert.deepEqual(changes, [true, false], 'live media-query changes must reach both directions');

assert.match(html, /watchReducedMotion\(REDUCE_MEDIA,/,
  'the page must subscribe to its live reduced-motion media query');
assert.match(html, /const dt = frameDelta\(raw, REDUCE\)/,
  'scene time must use the tested reduced-motion delta helper');
assert.match(html, /PERF\.elapsed = frameElapsed\(raw, PERF\.elapsed\)/,
  'performance elapsed must use its independent monotonic helper');
assert.match(html, /onReducedMotionChange\(reduced => \{\s*if \(reduced\) \{\s*running = false;\s*cancelAnimationFrame\(raf\);\s*\}\s*else start\(\);/,
  'the independent cloth loop must stop and resume with the preference');
assert.match(html, /onReducedMotionChange\(reduced => \{\s*if \(reduced\) \{\s*cancelAnimationFrame\(raf\);\s*running = false;\s*x = tx2; y = ty; paint\(\);/,
  'the pointer cursor loop must stop interpolating while reduced');
assert.match(html, /pending\.forEach\(\(timer, el\) => \{ clearTimeout\(timer\); el\.classList\.add\('rv-in'\); \}\)/,
  'pending reveal delays must settle when reduced motion is enabled');
assert.match(html, /timers\.forEach\(\(timer, stage\) => \{\s*clearTimeout\(timer\);\s*stage\.classList\.remove\('fg-retiring'\);\s*park\(stage\);/,
  'pending foreground retire transitions must settle when reduced motion is enabled');
assert.match(html, /onReducedMotionChange\(\(\) => \{ tPrev = performance\.now\(\); \}\)/,
  'preference changes must reset the frame baseline without resetting elapsed time');
assert.match(html, /INTRO\.time = Math\.min\(INTRO\.time \+ dt, 4\)/,
  'intro progress must pause and resume with the scene delta');
assert.match(html, /RIG\.intro = sat\(INTRO\.time \/ 2\.4\)/,
  'camera intro progress must come from the same pauseable timeline');
assert.match(html, /!PERF\.locked && PERF\.elapsed > 2\.2/,
  'the adaptive quality governor must warm up on elapsed time, not scene time');
assert.match(html, /get running\(\)\s*\{ return running; \}, get frames\(\)\s*\{ return frames; \}/,
  'cloth loop state must remain inspectable by browser QA');
console.log('reduced-motion tests: 19 passed');
