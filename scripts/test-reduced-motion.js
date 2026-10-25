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
assert.match(html, /onReducedMotionChange\(reduced => \{\s*if \(!reduced\) return;\s*settleStageRetirements\(timers, activeStage, park\);/,
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

const stageContext = vm.createContext({ clearTimeout });
const cancelStageRetirement = vm.runInContext(`(${productionFunction('cancelStageRetirement')})`, stageContext);
const finishStageRetirement = vm.runInContext(`(${productionFunction('finishStageRetirement')})`, stageContext);
stageContext.finishStageRetirement = finishStageRetirement;
const settleStageRetirements = vm.runInContext(`(${productionFunction('settleStageRetirements')})`, stageContext);
let stageChecks = 0;
const stageCheck = (condition, message) => { stageChecks++; assert.ok(condition, message); };
const stageEqual = (actual, expected, message) => { stageChecks++; assert.equal(actual, expected, message); };
const stageDeepEqual = (actual, expected, message) => { stageChecks++; assert.deepEqual(actual, expected, message); };
function fakeStage(name, parent, classNames) {
  const classes = new Set(classNames);
  return {
    name, parentNode: parent,
    classList: {
      add(value) { classes.add(value); },
      remove(value) { classes.delete(value); },
      contains(value) { return classes.has(value); },
    },
  };
}

const stageA = fakeStage('A', '#fg-sky', ['fg-active']);
const stageB = fakeStage('B', '#fg-sky', ['fg-retiring']);
let activeStage = stageA;
const retirements = new Map([[stageA, 'A-old-timer'], [stageB, 'B-timer']]);
const cancelledTimers = [];
const parkedStages = [];
const fakePark = stage => { stage.parentNode = 'home'; parkedStages.push(stage.name); };
stageA.classList.remove('fg-active');
stageA.classList.add('fg-retiring');
stageCheck(cancelStageRetirement(retirements, stageA, timer => cancelledTimers.push(timer)),
  'reactivating A must cancel its retirement');
stageA.classList.remove('fg-retiring');
stageA.classList.add('fg-active');
stageEqual(retirements.has(stageA), false, 'A timer ownership must be deleted on reactivation');
stageDeepEqual(cancelledTimers, ['A-old-timer'], 'the stale A timer must be canceled');
stageEqual(finishStageRetirement(retirements, stageA, 'A-old-timer', activeStage, fakePark), false,
  'a queued callback from A’s canceled timer must be ignored');
stageEqual(stageA.parentNode, '#fg-sky', 'A must stay lifted when its old callback fires');
stageCheck(stageA.classList.contains('fg-active'), 'A must remain active after A→B→A');

settleStageRetirements(retirements, activeStage, fakePark, timer => cancelledTimers.push(timer));
stageEqual(retirements.size, 0, 'enabling reduced motion must clear all retirement ownership');
stageEqual(stageB.parentNode, 'home', 'the genuinely retired B stage must be parked');
stageEqual(stageB.classList.contains('fg-retiring'), false, 'B’s retiring state must be cleared');
stageEqual(stageA.parentNode, '#fg-sky', 'settling B must not park active A');
stageCheck(stageA.classList.contains('fg-active'), 'A must stay active after the first preference toggle');
stageDeepEqual(parkedStages, ['B'], 'only the retired B stage should be parked');

settleStageRetirements(retirements, activeStage, fakePark, timer => cancelledTimers.push(timer));
stageEqual(retirements.size, 0, 'a repeated reduced-motion toggle must leave no stale timer');
stageDeepEqual(parkedStages, ['B'], 'a repeated toggle must not park A or park B twice');
retirements.set(stageA, 'stale-active-timer');
stageA.classList.add('fg-retiring');
settleStageRetirements(retirements, activeStage, fakePark, timer => cancelledTimers.push(timer));
stageEqual(stageA.parentNode, '#fg-sky', 'settling a stale active-stage entry must never park A');
stageCheck(stageA.classList.contains('fg-active'), 'the active class must survive stale-entry cleanup');
stageEqual(stageA.classList.contains('fg-retiring'), false, 'stale retiring state must be removed');
stageEqual(retirements.size, 0, 'stale active-stage ownership must be removed');

retirements.set(stageB, 'B-final-timer');
stageB.parentNode = '#fg-sky';
stageB.classList.add('fg-retiring');
stageCheck(finishStageRetirement(retirements, stageB, 'B-final-timer', activeStage, fakePark),
  'a current retirement callback must finish normally');
stageEqual(retirements.size, 0, 'a completed retirement must release its timer entry');
stageEqual(stageB.parentNode, 'home', 'a completed retired stage must return home');
stageEqual(stageB.classList.contains('fg-retiring'), false, 'completed cleanup must clear its class');
stageEqual(stageA.parentNode, '#fg-sky', 'eventual B cleanup must leave active A lifted');

stageCheck(/cancelStageRetirement\(timers, stage\)/.test(html),
  'activation and retirement must use explicit timer ownership cleanup');
stageCheck(/finishStageRetirement\(timers, stage, timer, activeStage, park\)/.test(html),
  'timer callbacks must verify ownership and current active stage');
stageCheck(/settleStageRetirements\(timers, activeStage, park\)/.test(html),
  'reduced-motion toggles must use active-stage-safe retirement settling');
console.log('reduced-motion tests: 19 passed');
console.log(`foreground-stage retirement tests: ${stageChecks} passed`);
