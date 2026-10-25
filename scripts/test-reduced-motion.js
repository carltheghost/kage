#!/usr/bin/env node
'use strict';

// Exercise the exact frame-delta helper embedded in index.html, without
// pulling in Three.js or a browser runtime.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const html = fs.readFileSync(require('node:path').join(__dirname, '..', 'index.html'), 'utf8');
const match = html.match(/function frameDelta\(raw, reducedMotion\)\s*\{[^}]*\}/);
assert.ok(match, 'index.html must define the production frameDelta helper');
const frameDelta = vm.runInNewContext(`(${match[0]})`);

assert.equal(frameDelta(1 / 60, true), 0, 'reduced motion must freeze scene time');
assert.equal(frameDelta(0.2, false), 0.05, 'normal motion keeps the existing delta cap');
console.log('reduced-motion tests: 2 passed');
