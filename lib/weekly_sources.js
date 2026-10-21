const SOURCES = {
    etri: { site_name: 'ETRI 인턴 공고', url: 'https://www.etri.re.kr/kor/bbs/list.etri?b_board_id=ETRI39' },
    youth: { site_name: '중앙부처 청년인턴', url: 'https://www.2030db.go.kr/user/youthIntern/selectYouthInternList.do' },
    experience: { site_name: '일경험 인턴', url: 'https://yw.work24.go.kr/d/a/selectWkexPrgmList.do' },
    knda: { site_name: '기업 교육 · K-뉴딜 아카데미', url: 'https://www.krivet.re.kr/kor/knda/homeKndaList.do' }
};

function text(value) {
    return String(value || '').replace(/<[^>]*>/g, '').replace(/&#8203;/g, '')
        .replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
        .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/\s+/g, ' ').trim();
}
function todayKst() {
    return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date()).replaceAll('-', '');
}
function dateKey(value) { return value.replace(/\D/g, ''); }
function formatDate(value) { return `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}`; }

function parseExperience(html, today = todayKst()) {
    const posts = [];
    for (const [card] of html.matchAll(/<div class="card">[\s\S]*?<\/div>\s*<\/li>/g)) {
        const id = card.match(/fn_searchDetail\('I','([^']+)'\)/)?.[1];
        const title = text(card.match(/title="([^"]+)"/)?.[1]);
        const period = text(card.match(/<strong>모집기간<\/strong><span>([\s\S]*?)<\/span>/)?.[1]);
        const dates = period.match(/\d{2,4}[-.]\d{2}[-.]\d{2}/g) || [];
        const end = dates[1] && dateKey(dates[1]);
        if (!id || !title || !end) continue;
        if ((end.length === 6 ? `20${end}` : end) < today) continue;
        posts.push({ title, period: `모집기간: ${period} · 검색 결과에서 제목을 눌러 상세 확인`,
            link: `${SOURCES.experience.url}?pgnm=${encodeURIComponent(title)}`,
            historyKey: `https://yw.work24.go.kr/program/${id}` });
    }
    return posts;
}

function parseYouthOpen(html, today = todayKst()) {
    const posts = [];
    for (const [row] of html.matchAll(/<tr[^>]*>[\s\S]*?<\/tr>/g)) {
        const id = row.match(/fn_selectYouthInternDetail\s*\(\s*'([^']+)'/)?.[1];
        const title = text(row.match(/<a[^>]*>([\s\S]*?)<\/a>/)?.[1]);
        const dates = row.match(/\d{4}[-.]\d{2}[-.]\d{2}/g) || [];
        if (!id || !title || dates.length < 2 || /합격|결과|면접시험|접수마감/.test(row)) continue;
        if (dateKey(dates.at(-1)) < today) continue;
        posts.push({ title, period: `접수기간: ${dates.slice(-2).join(' ~ ')}`,
            link: `https://www.2030db.go.kr/user/youthIntern/selectYouthInternDetail.do?youthId=${id}` });
    }
    return posts;
}

function parseKnda(data, today = todayKst()) {
    if (!Array.isArray(data.list)) throw new Error('Invalid K-Newdeal response');
    const posts = [];
    for (const item of data.list) for (const cycle of item.cyclList || []) {
        if (!['KN2001', 'KN2002'].includes(cycle.recruitStatusCd) || !cycle.eduAplyEndYmd || cycle.eduAplyEndYmd < today) continue;
        const link = cycle.urlAddr || item.ednstUrlAddr;
        if (!/^https?:\/\//.test(link || '')) continue;
        posts.push({ title: `${item.ednstNm} · ${item.crclmNm} (${cycle.eduCycl}회차)`,
            period: `모집: ${formatDate(cycle.eduAplyBgngYmd)} ~ ${formatDate(cycle.eduAplyEndYmd)} · 교육: ${formatDate(cycle.eduBgngYmd)} ~ ${formatDate(cycle.eduEndYmd)}${cycle.recruitStatusCd === 'KN2002' ? ' · 모집예정' : ''}`,
            link, historyKey: `https://www.krivet.re.kr/kor/knda/course/${item.crclmSn}/cycle/${cycle.eduCycl}` });
    }
    return posts;
}

// Use IPv4 explicitly and bound DNS/TCP/TLS/body time, not only fetch headers.
function requestPublicPage(url, { signal } = {}, redirects = 0) {
    return new Promise((resolve, reject) => {
        const req = require('node:https').get(url, { family: 4, signal,
            headers: { 'User-Agent': 'Mozilla/5.0 (compatible; CareerNewsletter/1.0)', 'Accept-Encoding': 'identity' }
        }, res => {
            if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
                res.resume();
                if (redirects >= 3) return reject(new Error('Too many redirects'));
                return requestPublicPage(new URL(res.headers.location, url).href, { signal }, redirects + 1).then(resolve, reject);
            }
            let body = '';
            res.setEncoding('utf8');
            res.on('data', chunk => { body += chunk; if (body.length > 8_000_000) req.destroy(new Error('Response too large')); });
            res.on('error', reject);
            res.on('end', () => resolve({ ok: res.statusCode >= 200 && res.statusCode < 300,
                status: res.statusCode, text: async () => body }));
        });
        req.on('error', reject);
    });
}

async function requestWithRetry(url, request, { attempts = 3, delayMs = 1000, timeoutMs = 20000 } = {}) {
    let lastError;
    for (let attempt = 0; attempt < attempts; attempt++) {
        try {
            const response = await request(url, { signal: AbortSignal.timeout(timeoutMs) });
            if (!response.ok) {
                const error = new Error(`Request failed: ${response.status}`);
                error.retryable = response.status === 429 || response.status >= 500;
                throw error;
            }
            // Read the body inside the retry boundary as this can also time out.
            return await response.text();
        } catch (error) {
            lastError = error;
            if (error.retryable === false || attempt === attempts - 1) break;
            await new Promise(resolve => setTimeout(resolve, delayMs * (attempt + 1)));
        }
    }
    throw lastError;
}

async function collectSource(source, request = requestPublicPage, options = {}) {
    const posts = new Map();
    const startedAt = Date.now();
    for (let page = 1; page <= 200; page++) {
        if (Date.now() - startedAt > 180000) throw new Error(`${source}: collection exceeded 3 minutes`);
        const url = source === 'knda'
            ? `https://www.krivet.re.kr/kor/knda/homeKndaSelectList.do?pageIndex=${page}&recordCountPerPage=10`
            : `${SOURCES[source].url}?${source === 'youth' ? 'pageIndex' : 'currentPageNo'}=${page}${source === 'experience' ? '&prgmSecd=I' : ''}`;
        const raw = await requestWithRetry(url, request, options);
        const data = source === 'knda' ? JSON.parse(raw) : null;
        const items = source === 'knda' ? parseKnda(data) : source === 'youth' ? parseYouthOpen(raw) : parseExperience(raw);
        let added = 0;
        for (const item of items) {
            const key = item.historyKey || item.link;
            if (!posts.has(key)) { posts.set(key, item); added++; }
        }
        const count = source === 'knda' ? Number(data.listCnt) : source === 'experience'
            ? Number(raw.match(/totalRecordCount\s*:\s*"(\d+)"/)?.[1])
            : Math.max(...[...raw.matchAll(/fn_selectYouthInternPaginList\((\d+)\)/g)].map(m => Number(m[1])), 1) * 10;
        const size = source === 'experience' ? 12 : 10;
        if (page * size >= count) return [...posts.values()];
        if (!Number.isFinite(count) || count <= 0) throw new Error(`${source}: pagination unavailable`);
        // Detect ignored pagination rather than silently missing later pages.
        if (page > 1 && added === 0 && items.length) throw new Error(`${source}: repeated page`);
        await new Promise(resolve => setTimeout(resolve, 150));
    }
    throw new Error(`${source}: pagination limit reached`);
}

module.exports = { SOURCES, parseExperience, parseYouthOpen, parseKnda, collectSource, requestPublicPage, requestWithRetry };
