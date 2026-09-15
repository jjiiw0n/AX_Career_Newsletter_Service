const test = require('node:test');
const assert = require('node:assert/strict');

const { selectDongAScienceArticles } = require('../monitor_v2');

test('DongA Science uses the heading instead of the card summary', () => {
    const longSummary = '기사 소개문입니다. '.repeat(30);
    const articles = selectDongAScienceArticles([
        {
            link: 'https://www.dongascience.com/ko/news/1',
            fullText: `정확한 기사 제목 ${longSummary}`,
            headingText: '정확한 기사 제목만 뉴스레터에 표시됩니다',
            singleLineText: '',
            truncatedText: '',
        },
    ]);

    assert.deepEqual(articles, [
        {
            title: '정확한 기사 제목만 뉴스레터에 표시됩니다',
            link: 'https://www.dongascience.com/ko/news/1',
        },
    ]);
});

test('DongA Science rejects a long anchor when no title element exists', () => {
    const articles = selectDongAScienceArticles([
        {
            link: 'https://www.dongascience.com/ko/news/2',
            fullText: '제목과 본문이 함께 들어온 링크입니다. '.repeat(20),
            headingText: '',
            singleLineText: '',
            truncatedText: '',
        },
    ]);

    assert.deepEqual(articles, []);
});
