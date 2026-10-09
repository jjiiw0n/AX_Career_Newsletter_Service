const test = require('node:test');
const assert = require('node:assert/strict');
const { parseExperience, parseYouthOpen, parseKnda, collectSource } = require('../lib/weekly_sources');

test('experience separates durable identity from the clickable search URL', () => {
    const html = `<div class="card"><a title="새 인턴 공고" href="javascript:fn_searchDetail('I','PG123');"></a><strong>모집기간</strong><span>26-10-01 ~ 26-10-19</span></div></li>`;
    const [post] = parseExperience(html, '20261009');
    assert.equal(post.historyKey, 'https://yw.work24.go.kr/program/PG123');
    assert.match(post.link, /pgnm=/);
    assert.equal(parseExperience(html, '20261020').length, 0);
});

test('youth excludes closed recruitment and interview results', () => {
    const row = title => `<tr><td><a onclick="fn_selectYouthInternDetail('ID1')">${title}</a></td><td>2026-10-01 ~ 2026-10-19</td></tr>`;
    assert.equal(parseYouthOpen(row('청년인턴 모집'), '20261009').length, 1);
    assert.equal(parseYouthOpen(row('청년인턴 합격자 발표'), '20261009').length, 0);
    assert.equal(parseYouthOpen(row('청년인턴 모집'), '20261020').length, 0);
});

test('K-newdeal treats new cycles sharing a URL as different postings', () => {
    const cycle = eduCycl => ({ eduCycl, recruitStatusCd: 'KN2001', eduAplyBgngYmd: '20261001', eduAplyEndYmd: '20261019', eduBgngYmd: '20261101', eduEndYmd: '20261201', urlAddr: 'https://example.com/' });
    const posts = parseKnda({ list: [{ crclmSn: 1, ednstNm: '기업', crclmNm: '교육', cyclList: [cycle(1), cycle(2)] }] }, '20261009');
    assert.equal(posts.length, 2);
    assert.notEqual(posts[0].historyKey, posts[1].historyKey);
    assert.equal(posts[0].link, posts[1].link);
});

test('collector fails on request errors instead of claiming no new postings', async () => {
    await assert.rejects(collectSource('knda', async () => ({ ok: false, status: 503 })), /503/);
});
