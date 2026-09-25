const test = require('node:test');
const assert = require('node:assert/strict');
const { parseYouTubeFeed, normalizeYouTubeTitle, formatYouTubeTitle } = require('../monitor_v2');

test('parses YouTube feed entries into thumbnail, title, link, and date', () => {
    const xml = `<feed xmlns:yt="http://www.youtube.com/xml/schemas/2015" xmlns:media="http://search.yahoo.com/mrss/">
        <entry>
            <yt:videoId>abc123</yt:videoId>
            <title>새 군사 영상</title>
            <link rel="alternate" href="https://www.youtube.com/watch?v=abc123"/>
            <published>2026-09-25T01:00:00+00:00</published>
            <media:group><media:thumbnail url="https://i.ytimg.com/vi/abc123/hqdefault.jpg"/></media:group>
        </entry>
    </feed>`;

    assert.deepEqual(parseYouTubeFeed(xml), [{
        title: '새 군사 영상',
        link: 'https://www.youtube.com/watch?v=abc123',
        imageUrl: 'https://i.ytimg.com/vi/abc123/hqdefault.jpg',
        publishedAt: '2026-09-25T01:00:00+00:00'
    }]);
});

test('uses the standard YouTube thumbnail when the feed omits one', () => {
    const xml = `<feed><entry><yt:videoId>fallback123</yt:videoId><title>영상 제목</title><published>2026-09-25T01:00:00Z</published></entry></feed>`;
    assert.equal(parseYouTubeFeed(xml)[0].imageUrl, 'https://i.ytimg.com/vi/fallback123/hqdefault.jpg');
});

test('excludes Shorts and keeps the latest regular upload', () => {
    const xml = `<feed>
        <entry><yt:videoId>short1</yt:videoId><title>짧은 영상</title><link href="https://www.youtube.com/shorts/short1"/></entry>
        <entry><yt:videoId>regular1</yt:videoId><title>일반 영상</title><link href="https://www.youtube.com/watch?v=regular1"/></entry>
    </feed>`;
    assert.deepEqual(parseYouTubeFeed(xml, 1).map(video => video.title), ['일반 영상']);
});

test('removes YouTube hashtags from the displayed title', () => {
    assert.equal(normalizeYouTubeTitle('영상 제목 #첫태그 #두번째태그'), '영상 제목');
    assert.equal(
        formatYouTubeTitle('영상 제목#첫태그#두번째태그'),
        '영상 제목'
    );
});
