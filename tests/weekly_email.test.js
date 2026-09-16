const test = require('node:test');
const assert = require('node:assert/strict');

const { generateHtml } = require('../monitor_v2');

test('weekly email summarizes only the subscriber selected sites', () => {
    const userResults = {
        '2030 청년인턴': [],
        '한화에어로스페이스·한화시스템 신입': [
            {
                title: '2026년 하반기 신입사원 채용',
                link: 'https://example.com/jobs/1',
                date: '2026.08.17'
            }
        ],
        'KAI 신입': []
    };

    const { html, totalNew } = generateHtml(userResults, '이지원');

    assert.equal(totalNew, 1);
    assert.match(html, /관심 사이트 3곳을 확인했고/);
    assert.match(html, /2030 청년인턴/);
    assert.match(html, /한화에어로스페이스·한화시스템 신입/);
    assert.match(html, /KAI 신입/);
    assert.doesNotMatch(html, /ETRI/);
    assert.match(html, /신규 1건/);
    assert.match(html, /신규 공고 없음/);
});

test('weekly email escapes scraped content', () => {
    const { html } = generateHtml({
        '테스트 사이트': [
            { title: '<script>alert(1)</script>', link: 'https://example.com/?a=1&b=2' }
        ]
    }, '<관리자>');

    assert.doesNotMatch(html, /<script>/);
    assert.match(html, /&lt;script&gt;/);
    assert.match(html, /&lt;관리자&gt;/);
    assert.match(html, /a=1&amp;b=2/);
});
