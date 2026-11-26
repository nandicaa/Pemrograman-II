const test = require('node:test');
const assert = require('node:assert/strict');
const {
  parseRule,
  ruleTimes,
  intervalText,
  isTime,
  isDate,
  isTimezone,
  localToUtc,
  localDate,
  addDays,
  doseTimes,
} = require('../src/lib/schedule');
const dbPath = require.resolve('../src/db');
require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: {} };
const { summarize } = require('../src/lib/doses');

test('parseRule parses valid medication rules and rejects invalid ones', () => {
  assert.deepEqual(parseRule('3x1'), { timesPerDay: 3, qtyPerDose: 1 });
  assert.deepEqual(parseRule(' 2 × ½ '), { timesPerDay: 2, qtyPerDose: 0.5 });
  assert.deepEqual(parseRule('4*1,5'), { timesPerDay: 4, qtyPerDose: 1.5 });
  assert.deepEqual(parseRule('1x1/2'), { timesPerDay: 1, qtyPerDose: 0.5 });

  assert.equal(parseRule('0x1'), null);
  assert.equal(parseRule('7x1'), null);
  assert.equal(parseRule('3x0'), null);
  assert.equal(parseRule('3x25'), null);
  assert.equal(parseRule('abc'), null);
});

test('ruleTimes and intervalText compute sorted local schedule times', () => {
  assert.deepEqual(ruleTimes(3, '06:00'), ['06:00', '14:00', '22:00']);
  assert.deepEqual(ruleTimes(3, '20:00'), ['04:00', '12:00', '20:00']);
  assert.equal(intervalText(3), '8 jam');
  assert.equal(intervalText(5), '4 jam 48 menit');
});

test('date, time, timezone validators and calendar arithmetic', () => {
  assert.equal(isTime('06:30'), true);
  assert.equal(isTime('24:00'), false);
  assert.equal(isDate('2026-02-28'), true);
  assert.equal(isDate('2026-02-30'), false);
  assert.equal(isTimezone('Asia/Jakarta'), true);
  assert.equal(isTimezone('Mars/Olympus'), false);
  assert.equal(addDays('2026-11-30', 2), '2026-12-02');
});

test('localToUtc, localDate, and doseTimes convert Asia/Jakarta properly', () => {
  const utc = localToUtc('2026-11-26', '06:00', 'Asia/Jakarta');
  assert.equal(utc.toISOString(), '2026-11-25T23:00:00.000Z');
  assert.equal(localDate(utc, 'Asia/Jakarta'), '2026-11-26');

  const times = doseTimes({ start_date: '2026-11-26', first_time: '06:00', times_per_day: 3, duration_days: 2 }, 'Asia/Jakarta');
  assert.equal(times.length, 6);
  assert.equal(times[0].toISOString(), '2026-11-25T23:00:00.000Z');
  assert.equal(times[1].toISOString(), '2026-11-26T07:00:00.000Z');
  assert.equal(times[5].toISOString(), '2026-11-27T15:00:00.000Z');
});

test('summarize excludes terjadwal and computes adherence percentage', () => {
  assert.deepEqual(
    summarize([{ status: 'terjadwal' }]),
    { total: 0, taken: 0, skipped: 0, missed: 0, adherence: null }
  );
  assert.deepEqual(
    summarize([
      { status: 'diminum' },
      { status: 'diminum' },
      { status: 'terlewat' },
      { status: 'terjadwal' },
    ]),
    { total: 3, taken: 2, skipped: 0, missed: 1, adherence: 67 }
  );
});
