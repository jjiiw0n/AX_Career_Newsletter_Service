const test = require('node:test');
const assert = require('node:assert/strict');

const { generateHtml, parseEtri, parseCsvSet, getJobSource, selectJobSubscribers } = require('../monitor_v2');

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

test('enables only ETRI for the selected weekly recipient', () => {
    const subscribers = [
        {
            email: 'jeew0n.lee.217@gmail.com',
            monitoring_sites: [
                { site_name: 'ETRI 인턴 공고', url: 'https://www.etri.re.kr/kor/bbs/list.etri?b_board_id=ETRI39' },
                { site_name: 'KAI 신입', url: 'https://koreaaero.recruiter.co.kr/career/job' }
            ]
        },
        { email: 'cdy3976@gmail.com', monitoring_sites: [] }
    ];

    const selected = selectJobSubscribers(
        subscribers,
        parseCsvSet('etri'),
        parseCsvSet('jeew0n.lee.217@gmail.com')
    );

    assert.equal(selected.length, 1);
    assert.equal(selected[0].email, 'jeew0n.lee.217@gmail.com');
    assert.deepEqual(selected[0].monitoring_sites.map(site => getJobSource(site.url)), ['etri']);
});

test('ETRI parser keeps only internship postings and decodes the link', () => {
    const html = `<table><tbody>
        <tr><td><a href="/kor/bbs/view.etri?b_board_id=ETRI39&amp;b_idx=10">정규직 공개채용</a></td><td>2026-10-01</td></tr>
        <tr><td><a href="/kor/bbs/view.etri?b_board_id=ETRI39&amp;b_idx=11">연구연수생 인턴 공개채용</a></td><td>2026-10-02</td></tr>
    </tbody></table>`;

    assert.deepEqual(parseEtri(html), [{
        title: '연구연수생 인턴 공개채용',
        link: 'https://www.etri.re.kr/kor/bbs/view.etri?b_board_id=ETRI39&b_idx=11',
        date: '2026-10-02'
    }]);
});
