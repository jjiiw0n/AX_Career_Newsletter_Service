const test = require('node:test');
const assert = require('node:assert/strict');
const { parseNaverBlogRss, extractFirstImageUrl } = require('../monitor_v2');

test('parses a Naver blog RSS item into title, image, link, and date', () => {
    const xml = `<rss><channel><item>
        <title><![CDATA[새 글 제목]]></title>
        <link><![CDATA[https://blog.naver.com/rgm84d/123?fromRss=true]]></link>
        <guid>https://blog.naver.com/rgm84d/123</guid>
        <description><![CDATA[블로그 본문입니다. <img src="https://example.com/cover.jpg">]]></description>
        <pubDate>Wed, 09 Sep 2026 12:00:00 +0900</pubDate>
    </item></channel></rss>`;
    assert.deepEqual(parseNaverBlogRss(xml), [{
        title: '새 글 제목',
        link: 'https://blog.naver.com/rgm84d/123',
        imageUrl: 'https://example.com/cover.jpg',
        publishedAt: 'Wed, 09 Sep 2026 12:00:00 +0900'
    }]);
});

test('returns an empty image URL when a blog post has no image', () => {
    assert.equal(extractFirstImageUrl('이미지가 없는 본문입니다.'), '');
});
