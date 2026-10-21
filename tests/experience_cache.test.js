const test = require('node:test');
const assert = require('node:assert/strict');
const { validateSnapshot, loadSnapshot, MAX_AGE_MS } = require('../lib/experience_cache');
const now = Date.parse('2026-10-21T01:00:00Z');
const post = {
    title: '일경험 인턴', period: '모집기간: 26-10-20 ~ 26-10-23',
    link: 'https://yw.work24.go.kr/d/a/selectWkexPrgmList.do?pgnm=test',
    historyKey: 'https://yw.work24.go.kr/program/PG123'
};
function snapshot(posts = [post]) { return { version: 1, source: 'experience', collectedAt: new Date(now).toISOString(), posts }; }
test('fresh private snapshot returns original durable job identities', () => {
    assert.deepEqual(validateSnapshot(snapshot(), now), [post]);
});
test('stale, future, malformed snapshots fail rather than claiming no new jobs', () => {
    assert.throws(() => validateSnapshot(snapshot(), now + MAX_AGE_MS + 1), /36 hours/);
    assert.throws(() => validateSnapshot(snapshot(), now - 300001), /36 hours/);
    assert.throws(() => validateSnapshot(snapshot([{ ...post, link: 'https://example.com' }]), now), /Invalid/);
});
test('a fresh snapshot filters jobs whose deadlines have passed', () => {
    assert.deepEqual(validateSnapshot(snapshot([{ ...post, period: '26-10-01 ~ 26-10-20' }]), now), []);
});
test('missing private cache is an error, not an empty source', async () => {
    await assert.rejects(loadSnapshot({ storage: { from: () => ({ download: async () => ({ error: { message: 'not found' } }) }) } }), /unavailable/);
});
