const LISTS = [
    { source: '코리아쉬핑가제트', url: 'https://www.ksg.co.kr/', kind: 'ksg' },
    { source: '한국해운신문', url: 'http://www.maritimepress.co.kr/news/articleList.html?sc_sub_section_code=S2N16&view_type=sm', kind: 'maritime' },
    { source: '더구루', url: 'https://www.theguru.co.kr/news/section.html?sec_no=108', kind: 'guru' },
    { source: '아시아투데이', url: 'https://www.asiatoday.co.kr/kn/reporter/eileen5030', kind: 'asia' }
];
const RELEVANT = /한화오션|HD현대|HD한국조선|삼성중공업|삼성重|한국선급|조선|선박|LNG선|운반선|탱커|스마트야드|자율운항|해양플랜트|함정|잠수함|구축함|호위함|군함/;
const EXCLUDED = /주가|목표주가|목표가|관련주|테마주|매수추천|매수 추천|투자의견|증권사|페스타|축제|봉사|성금|승진|임원.*인사|골프/;
const ARTICLE_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
const EXPANDED_SOURCES = new Set(['더구루', '아시아투데이', '국방일보']);
function isMarineHeadline(title) {
    return /조선|해양|선박|함정|잠수함|구축함|호위함|군함|쇄빙선|스마트야드|LNG선|운반선|탱커|한화오션|삼성중공업|삼성重|HD현대중공업|HD현대重/.test(title)
        && !/순항훈련|친선|입항|위문|체육|교류행사/.test(title);
}

function comparableTitle(title) {
    return String(title).normalize('NFKC').toLowerCase()
        .replace(/삼성重/g, '삼성중공업').replace(/hd현대重/g, 'hd현대중공업')
        .replace(/[^a-z0-9가-힣]/g, '');
}
function sameShipEvent(left, right) {
    const a = comparableTitle(left), b = comparableTitle(right);
    if (!a || !b) return false;
    if (a === b) return true;
    const grams = value => new Set(Array.from({ length: Math.max(0, value.length - 1) }, (_, i) => value.slice(i, i + 2)));
    const x = grams(a), y = grams(b);
    const overlap = [...x].filter(g => y.has(g)).length;
    return x.size > 0 && y.size > 0 && 2 * overlap / (x.size + y.size) >= 0.65;
}
function rankShipbuilding(candidates, now = Date.now()) {
    return candidates.filter(article => {
        const age = now - Date.parse(article.publishedAt);
        return article.publicBody === true && article.title.length <= 160 && RELEVANT.test(article.title + ' ' + (article.evidence || ''))
            && (!EXPANDED_SOURCES.has(article.source) || isMarineHeadline(article.title))
            && !EXCLUDED.test(article.title) && age >= -300000 && age <= ARTICLE_WINDOW_MS;
    }).map(article => {
        const material = article.title + ' ' + (article.evidence || '');
        const impact = /수주|건조 계약|인도|인증|공개|기술 개발|조선소|규제|정책/.test(article.title) ? 35 : 15;
        const company = /한화오션|HD현대|HD한국조선|삼성중공업|삼성重/.test(material) ? 25 : 10;
        const evidence = /계약.*체결|체결.*계약|공시|인증.*획득|기본인증|기본 인증|발표|밝혔다/.test(material) ? 25 : 10;
        const freshness = 15 * Math.max(0, 1 - (now - Date.parse(article.publishedAt)) / ARTICLE_WINDOW_MS);
        return { ...article, score: impact + company + evidence + freshness };
    }).sort((a, b) => b.score - a.score || Date.parse(b.publishedAt) - Date.parse(a.publishedAt));
}

async function scrapeShipbuilding(context, { now = Date.now() } = {}) {
    const candidates = [];
    const status = {};
    for (const site of LISTS) {
        const page = await context.newPage();
        try {
            const response = await page.goto(site.url, { waitUntil: 'domcontentloaded', timeout: 20000 });
            if (!response?.ok()) throw new Error(`List HTTP ${response?.status()}`);
            const links = await page.evaluate(kind => {
                const selectors = { maritime: '#section-list h4.titles a', ksg: 'a[href*="main_newsView.jsp?pNum="]',
                    guru: 'a[href*="/news/article.html?no="]', asia: 'a[href*="/kn/view.php?key="]', kookbang: 'a[href$="/view.do"]' };
                const anchors = document.querySelectorAll(selectors[kind]);
                const seen = new Set();
                return [...anchors].map(a => ({ title: (a.querySelector('h1,h2,h3,h4,h5,.title,.tit')?.innerText || a.innerText).replace(/\s+/g, ' ').trim(), link: a.href }))
                    .filter(a => a.title && a.title.length < 160 && !seen.has(a.link) && seen.add(a.link));
            }, site.kind);
            if (!links.length) throw new Error('Article list selectors returned no headlines');
            const relevant = links.filter(a => (EXPANDED_SOURCES.has(site.source) ? isMarineHeadline(a.title) : RELEVANT.test(a.title)) && !EXCLUDED.test(a.title)).slice(0, 12);
            let publicCount = 0;
            for (const candidate of relevant) {
                try {
                    const articleResponse = await page.goto(candidate.link, { waitUntil: 'domcontentloaded', timeout: 15000 });
                    if (!articleResponse?.ok()) continue;
                    const details = await page.evaluate(({ kind, listedTitle }) => {
                        const selectors = { ksg: '#newsContent', maritime: '#article-view-content-div', guru: '#news_body_area',
                            asia: '.article_body', kookbang: '#article_body_view' };
                        const body = document.querySelector(selectors[kind]);
                        const content = body?.innerText?.trim() || '';
                        const pageText = document.body.innerText;
                        const date = kind === 'ksg' ? pageText.match(/\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}/)?.[0]
                            : pageText.match(/(?:입력|등록|승인)\s*:?\s*(\d{4}[.-]\s*\d{2}[.-]\s*\d{2}\s+\d{2}:\d{2})/)?.[1];
                        const isoDate = document.querySelector('meta[property="article:published_time"]')?.content;
                        const title = kind === 'ksg' ? document.querySelector('h1.maintit')?.innerText
                            : kind === 'kookbang' ? listedTitle : kind === 'asia' ? document.title.replace(/\s*-\s*아시아투데이\s*$/, '') : document.title.split(' < ')[0];
                        return { title: title?.replace(/\s+/g, ' ').trim(), content: content.slice(0, 5000), date, isoDate,
                            restricted: /유료회원으로 가입|회원 로그인이 필요합니다|유료회원 전용|로그인 후 기사/.test(content) };
                    }, { kind: site.kind, listedTitle: candidate.title });
                    if (!details.title || (!details.date && !details.isoDate) || details.content.length < 250 || details.restricted) continue;
                    publicCount++;
                    candidates.push({ title: details.title, link: candidate.link, source: site.source,
                        publishedAt: new Date(details.isoDate || details.date.replace(/\.\s*/g, '-').replace(/\s+/, 'T') + ':00+09:00').toISOString(),
                        publicBody: true, evidence: details.content });
                } catch (error) { console.warn(`Shipbuilding article skipped: ${candidate.link}: ${error.message}`); }
            }
            if (relevant.length && !publicCount) throw new Error('No relevant public article bodies could be verified');
            status[site.kind] = { ok: true, publicCount };
        } catch (error) {
            status[site.kind] = { ok: false, error: error.message };
            console.error(`Shipbuilding ${site.source} failed: ${error.message}`);
        } finally { await page.close(); }
    }
    return { articles: rankShipbuilding(candidates, now), status };
}

module.exports = { scrapeShipbuilding, rankShipbuilding, sameShipEvent, isMarineHeadline };
