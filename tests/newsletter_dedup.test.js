const test = require('node:test');
const assert = require('node:assert/strict');
const {
    normalizeArticleLink,
    normalizeArticleTitle,
    excludeRecentlySentArticles,
    selectLatestDeliveryRows
} = require('../monitor_v2');

test('normalizes tracking parameters and Korean title spacing', () => {
    assert.equal(normalizeArticleLink('https://example.com/news/1/?utm_source=mail#top'), 'https://example.com/news/1');
    assert.equal(normalizeArticleTitle('  같은   기사 제목  '), '같은 기사 제목');
});

test('uses only the immediately previous newsletter delivery for duplicate checks', () => {
    const rows = [
        { article_title: '직전 기사 1', delivery_id: 'delivery-new', sent_at: '2026-09-11T02:00:00Z' },
        { article_title: '직전 기사 2', delivery_id: 'delivery-new', sent_at: '2026-09-11T02:00:00Z' },
        { article_title: '그 전 기사', delivery_id: 'delivery-old', sent_at: '2026-09-10T02:00:00Z' }
    ];
    assert.deepEqual(selectLatestDeliveryRows(rows), rows.slice(0, 2));
});

test('excludes recent URLs and titles, then fills from the next rank', () => {
    const newsData = { science: [
        { title: '어제 보낸 기사', link: 'https://example.com/1' },
        { title: '주소만 달라진 같은 기사', link: 'https://example.com/new-address' },
        { title: '새 기사 1', link: 'https://example.com/3' },
        { title: '새 기사 2', link: 'https://example.com/4' },
        { title: '새 기사 3', link: 'https://example.com/5' }
    ] };
    const sentRows = [
        { article_title: '어제 보낸 기사', article_link: 'https://example.com/1?utm_source=mail' },
        { article_title: ' 주소만  달라진 같은 기사 ', article_link: 'https://example.com/old-address' }
    ];
    assert.deepEqual(excludeRecentlySentArticles(newsData, sentRows), { science: [
        { title: '새 기사 1', link: 'https://example.com/3' },
        { title: '새 기사 2', link: 'https://example.com/4' },
        { title: '새 기사 3', link: 'https://example.com/5' }
    ] });
});
