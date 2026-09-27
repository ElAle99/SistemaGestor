const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const app = fs.readFileSync(path.join(__dirname, '../../frontend/js/app.js'), 'utf8');
const start = app.indexOf('function initPatternLock(');
const end = app.indexOf('\nfunction ', start + 1);
const source = app.slice(start, end);

function patternPad(displaySize) {
    const listeners = {};
    const ctx = new Proxy({}, { get: () => () => {} });
    const input = { value: '' };
    const canvas = {
        getContext: () => ctx,
        getBoundingClientRect: () => ({ left: 20, top: 30, width: displaySize, height: displaySize }),
        addEventListener: (name, callback) => { listeners[name] = callback; },
        setPointerCapture() {}, releasePointerCapture() {}
    };
    const elements = {
        'pattern-canvas': canvas,
        'pattern-sequence-display': {},
        'form-lock-pattern-sequence': input,
        'btn-clear-pattern': { addEventListener() {} }
    };
    const window = { PointerEvent: true };
    vm.runInNewContext(`${source}\ninitPatternLock();`, {
        window, document: {
            getElementById: id => elements[id],
            querySelectorAll: () => []
        }, updateLockVisibility() {}
    });
    function event(name, x, y) {
        listeners[name]({ clientX: 20 + x * displaySize / 240, clientY: 30 + y * displaySize / 240,
            pointerId: 1, preventDefault() {} });
    }
    function draw(points) {
        window.clearPattern();
        event('pointerdown', ...points[0]);
        for (let i = 1; i < points.length; i++) {
            const [x, y] = points[i - 1];
            const [nextX, nextY] = points[i];
            for (let step = 1; step <= 100; step++) {
                event('pointermove', x + (nextX - x) * step / 100, y + (nextY - y) * step / 100);
            }
        }
        event('pointerup', ...points.at(-1));
        return input.value;
    }
    return { draw, restore(value) { window.setPatternSequence(value); return input.value; } };
}

test('advanced editor restores the stored pattern sequence for visualization', () => {
    const pad = patternPad(240);
    assert.equal(pad.restore('1-2-5-8'), '1-2-5-8');
    assert.equal(pad.restore(''), '');
});

const dot = id => [40 + ((id - 1) % 3) * 80, 40 + Math.floor((id - 1) / 3) * 80];

for (const size of [180, 240, 320]) {
    test(`all 72 directed pattern connections avoid unrelated dots at ${size}px`, () => {
        const pad = patternPad(size);
        for (let from = 1; from <= 9; from++) {
            for (let to = 1; to <= 9; to++) {
                if (from === to) continue;
                const a = dot(from), b = dot(to);
                const midpoint = Array.from({ length: 9 }, (_, i) => i + 1)
                    .find(id => dot(id)[0] === (a[0] + b[0]) / 2 && dot(id)[1] === (a[1] + b[1]) / 2);
                const expected = [from, ...(midpoint ? [midpoint] : []), to].join('-');
                assert.equal(pad.draw([a, b]), expected, `${from} → ${to}`);
            }
        }
    });
}

test('crossing diagonal patterns preserve order and do not repeat selected dots', () => {
    const pad = patternPad(180);
    const sequence = [1, 8, 3, 4, 9, 2, 7, 6, 1];
    assert.equal(pad.draw(sequence.map(dot)), '1-8-3-4-9-2-7-6');
});

test('aligned endpoints still include the intermediate dot after a curved stroke', () => {
    const pad = patternPad(240);
    assert.equal(pad.draw([dot(1), [0, 80], [0, 160], dot(7)]), '1-4-7');
    // Endpoint midpoint rules still apply, even when the finger takes a detour.
});
