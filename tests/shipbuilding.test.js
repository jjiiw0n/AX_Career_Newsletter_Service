const test = require('node:test');
const assert = require('node:assert/strict');
const { rankShipbuilding, sameShipEvent } = require('../lib/shipbuilding_news');
const { excludeRecentlySentArticles, sendNewsletter } = require('../monitor_v2');
const nodemailer = require('nodemailer');
const now = Date.parse('2026-10-25T03:00:00Z');
const article = (title, extra = {}) => ({ title, link: 'https://example.com/' + encodeURIComponent(title),
    publicBody: true, publishedAt: new Date(now - 3600000).toISOString(), evidence: '건조 계약을 체결했다고 밝혔다.', ...extra });

test('shipbuilding excludes stale, login-only, stock and community publicity articles', () => {
    const posts = rankShipbuilding([
        article('HD현대 LNG선 수주'), article('삼성중공업 목표주가 상향'), article('HD현대 지역 축제 개최'),
        article('한화오션 기술 공개', { publicBody: false }),
        article('삼성중공업 선박 인도', { publishedAt: new Date(now - 169 * 3600000).toISOString() })
    ], now);
    assert.deepEqual(posts.map(p => p.title), ['HD현대 LNG선 수주']);
});

test('shipbuilding accepts 78-hour-old articles and the seven-day boundary, but not older articles', () => {
    const posts = rankShipbuilding([
        article('HD현대 미국 조선소 설립', { publishedAt: new Date(now - 78 * 3600000).toISOString() }),
        article('한화오션 친환경선박 인증', { publishedAt: new Date(now - 168 * 3600000).toISOString() }),
        article('삼성중공업 LNG선 수주', { publishedAt: new Date(now - 168 * 3600000 - 1).toISOString() })
    ], now);
    assert.equal(posts.length, 2);
    assert.equal(posts[0].title, 'HD현대 미국 조선소 설립');
});

test('confirmed material shipbuilding events rank ahead of incidental sector news', () => {
    const posts = rankShipbuilding([article('조선업 동향 소개'), article('HD현대 LNG선 수주')], now);
    assert.equal(posts[0].title, 'HD현대 LNG선 수주');
});

test('shipbuilding dedup fills remaining slots and suppresses overlap with defense', () => {
    const previous = article('삼성중공업 하이브리드 셔틀탱커 개발');
    const defense = article('한화오션 잠수함 건조 계약');
    assert.equal(sameShipEvent('삼성重, 하이브리드 셔틀탱커 개발', previous.title), true);
    const results = excludeRecentlySentArticles({ defense: [defense], shipbuilding: [
        previous, article('삼성重, 하이브리드 셔틀탱커 개발'), defense,
        article('HD현대 LNG선 수주'), article('한국선급 선박 기술 공개'), article('삼성중공업 친환경선박 인증')
    ] }, [{ article_title: previous.title, article_link: previous.link }]);
    assert.equal(results.shipbuilding.length, 3);
    assert.equal(results.shipbuilding[0].title, 'HD현대 LNG선 수주');
});

test('daily shipbuilding section renders at most three title links and no summaries', async () => {
    const original = nodemailer.createTransport;
    let captured;
    nodemailer.createTransport = () => ({ sendMail: async value => { captured = value; } });
    try {
        await sendNewsletter('preview@example.com', '테스트', { shipbuilding: [1, 2, 3, 4].map(i => ({
            title: `조선 기사 ${i}`, link: `https://example.com/${i}`, summary: 'DO_NOT_RENDER_SUMMARY'
        })) }, '');
    } finally { nodemailer.createTransport = original; }
    assert.match(captured.html, /오늘의 조선·해양 주요 뉴스/);
    assert.match(captured.html, /조선 기사 3/);
    assert.doesNotMatch(captured.html, /조선 기사 4|DO_NOT_RENDER_SUMMARY|원문 보기/);
});
