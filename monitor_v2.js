require('dotenv').config();
const { randomUUID } = require('node:crypto');
const { chromium } = require('playwright');
const nodemailer = require('nodemailer');
const supabase = require('./lib/supabase');

// --- Helpers & Parsers ---
// ... (existing helper functions: normalizeLink, parseEtri, parseBtp, parseYouth)
// --- Newsletter Helpers ---

function filterAndSort(articles, keywords) {
    if (keywords.length === 0) return articles;
    const priority = articles.filter(a => keywords.some(k => a.title.toUpperCase().includes(k.toUpperCase())));
    const others = articles.filter(a => !keywords.some(k => a.title.toUpperCase().includes(k.toUpperCase())));
    return [...priority, ...others];
}

function selectDongAScienceArticles(candidates, limit = 3) {
    const seenLinks = new Set();
    const articles = [];

    for (const candidate of candidates) {
        const fullText = (candidate.fullText || '').replace(/\s+/g, ' ').trim();
        const title = (
            candidate.headingText ||
            candidate.singleLineText ||
            candidate.truncatedText ||
            (fullText.length <= 120 ? fullText : '')
        ).replace(/\s+/g, ' ').trim();

        if (title.length <= 15 || title.length > 160 || seenLinks.has(candidate.link)) continue;

        seenLinks.add(candidate.link);
        articles.push({ title, link: candidate.link });
        if (articles.length === limit) break;
    }

    return articles;
}

async function scrapeNews(context) {
    console.log('Starting Newsletter Scraping...');
    const results = { science: [], ai: [], defense: [] };
    const priorityKeywords = {
        science: [],
        ai: ['ETRI', 'KT', 'SKT', 'LG'],
        defense: ['LIG', '한화', 'KAI', '현대']
    };

    try {
        const sciencePage = await context.newPage();
        await sciencePage.goto('https://www.dongascience.com/', { waitUntil: 'domcontentloaded' });
        const scienceCandidates = await sciencePage.evaluate(() => {
            return Array.from(document.querySelectorAll('a'))
                .filter(a => a.href.includes('/news/') && !a.href.includes('/list'))
                .map(a => ({
                    link: a.href,
                    fullText: a.innerText,
                    headingText: a.querySelector('h1, h2, h3, h4, h5, h6')?.innerText || '',
                    singleLineText: a.querySelector('[class*="line-clamp-1"]')?.innerText || '',
                    truncatedText: a.querySelector('.truncate')?.innerText || ''
                }));
        });
        results.science = selectDongAScienceArticles(scienceCandidates, 20);
        await sciencePage.close();
    } catch (e) {
        console.error('DongA Science scrape failed:', e.message);
    }

    try {
        const aiPage = await context.newPage();
        await aiPage.goto('https://www.aitimes.kr/news/articleList.html?sc_sub_section_code=S2N16&view_type=sm', { waitUntil: 'domcontentloaded' });
        results.ai = filterAndSort(await aiPage.evaluate(() => Array.from(document.querySelectorAll('h4.titles a')).map(a => ({ title: a.innerText.trim(), link: a.href }))), priorityKeywords.ai);
        await aiPage.close();
    } catch (e) {
        console.error('AI Times scrape failed:', e.message);
    }

    try {
        const defPage = await context.newPage();
        await defPage.goto('https://www.dailydefense.co.kr/news/articleList.html?sc_section_code=S1N1&view_type=sm', { waitUntil: 'domcontentloaded' });
        results.defense = filterAndSort(await defPage.evaluate(() => Array.from(document.querySelectorAll('.altlist-subject a')).map(a => ({ title: a.innerText.trim(), link: a.href }))), priorityKeywords.defense);
        await defPage.close();
    } catch (e) {
        console.error('Daily Defense scrape failed:', e.message);
    }

    const totalArticles = Object.values(results).reduce((sum, articles) => sum + articles.length, 0);
    if (totalArticles === 0) {
        throw new Error('All newsletter sources returned zero articles; refusing to send an empty newsletter.');
    }
    return results;
}

function normalizeArticleTitle(title) {
    return (title || '').normalize('NFKC').replace(/\s+/g, ' ').trim().toLowerCase();
}

function normalizeArticleLink(link) {
    if (!link) return '';
    try {
        const url = new URL(link);
        url.hash = '';
        ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content'].forEach(key => url.searchParams.delete(key));
        return url.toString().replace(/\/$/, '');
    } catch {
        return link.trim().replace(/\/$/, '');
    }
}

function excludeRecentlySentArticles(newsData, sentRows, limit = 3) {
    const sentLinks = new Set(sentRows.map(row => normalizeArticleLink(row.article_link)).filter(Boolean));
    const sentTitles = new Set(sentRows.map(row => normalizeArticleTitle(row.article_title)).filter(Boolean));

    return Object.fromEntries(Object.entries(newsData).map(([source, articles]) => {
        const selected = [];
        const seenLinks = new Set();
        const seenTitles = new Set();
        for (const article of articles) {
            const link = normalizeArticleLink(article.link);
            const title = normalizeArticleTitle(article.title);
            if (!link || !title || sentLinks.has(link) || sentTitles.has(title) || seenLinks.has(link) || seenTitles.has(title)) continue;
            seenLinks.add(link);
            seenTitles.add(title);
            selected.push({ ...article, link });
            if (selected.length === limit) break;
        }
        return [source, selected];
    }));
}

function selectLatestDeliveryRows(rows) {
    if (!rows || rows.length === 0) return [];
    const latestDeliveryId = rows[0].delivery_id || `legacy-${String(rows[0].sent_at || '').slice(0, 10)}`;
    return rows.filter(row => {
        const deliveryId = row.delivery_id || `legacy-${String(row.sent_at || '').slice(0, 10)}`;
        return deliveryId === latestDeliveryId;
    });
}

async function filterRecentlySentNewsletter(newsData) {
    const { data, error } = await supabase.from('newsletter_history')
        .select('article_title, article_link, delivery_id, sent_at')
        .in('source', ['science', 'ai', 'defense'])
        .order('sent_at', { ascending: false })
        .limit(100);
    if (error) throw new Error(`Failed to load newsletter history: ${error.message}`);
    return excludeRecentlySentArticles(newsData, selectLatestDeliveryRows(data || []));
}

async function saveNewsletterHistory(newsData) {
    const deliveryId = randomUUID();
    const sentAt = new Date().toISOString();
    const rows = Object.entries(newsData).flatMap(([source, articles]) => articles.map(article => ({
        source,
        article_title: article.title.trim(),
        article_link: normalizeArticleLink(article.link),
        delivery_id: deliveryId,
        sent_at: sentAt
    })));
    if (rows.length === 0) return;
    const { error } = await supabase.from('newsletter_history').upsert(rows, {
        onConflict: 'source,article_link'
    });
    if (error) throw new Error(`Failed to save newsletter history: ${error.message}`);
}

function decodeXmlText(value) {
    return (value || '')
        .replace(/^<!\[CDATA\[|\]\]>$/g, '')
        .replace(/<img\b[^>]*>/gi, ' ')
        .replace(/<br\s*\/?\s*>/gi, ' ')
        .replace(/<[^>]+>/g, ' ')
        .replace(/&nbsp;/gi, ' ')
        .replace(/&amp;/gi, '&')
        .replace(/&lt;/gi, '<')
        .replace(/&gt;/gi, '>')
        .replace(/&quot;/gi, '"')
        .replace(/&#39;|&apos;/gi, "'")
        .replace(/\s+/g, ' ')
        .trim();
}

function extractRssField(itemXml, field) {
    const match = itemXml.match(new RegExp(`<${field}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${field}>`, 'i'));
    return decodeXmlText(match?.[1] || '');
}

function extractFirstImageUrl(description) {
    const match = (description || '').match(/<img\b[^>]*\bsrc=["']([^"']+)["']/i);
    if (!match) return '';
    const imageUrl = decodeXmlText(match[1]);
    return /^https?:\/\//i.test(imageUrl) ? imageUrl : '';
}

function parseNaverBlogRss(xml, limit = 10) {
    return Array.from(xml.matchAll(/<item>([\s\S]*?)<\/item>/gi))
        .slice(0, limit)
        .map(([, itemXml]) => {
            const link = extractRssField(itemXml, 'guid') || extractRssField(itemXml, 'link');
            const descriptionMatch = itemXml.match(/<description(?:\s[^>]*)?>([\s\S]*?)<\/description>/i);
            return {
                title: extractRssField(itemXml, 'title'),
                link: normalizeArticleLink(link),
                imageUrl: extractFirstImageUrl(descriptionMatch?.[1] || ''),
                publishedAt: extractRssField(itemXml, 'pubDate')
            };
        })
        .filter(post => post.title && post.link);
}

async function scrapeNaverBlog() {
    const response = await fetch('https://rss.blog.naver.com/rgm84d.xml', {
        headers: { 'User-Agent': 'Career-Newsletter-Service/1.0' }
    });
    if (!response.ok) throw new Error(`Naver Blog RSS returned HTTP ${response.status}`);
    return parseNaverBlogRss(await response.text());
}

async function filterUnsentBlogPosts(posts, limit = 1) {
    const { data, error } = await supabase.from('newsletter_history')
        .select('article_link')
        .eq('source', 'naver_blog_rgm84d');
    if (error) throw new Error(`Failed to load blog history: ${error.message}`);
    const sentLinks = new Set((data || []).map(row => normalizeArticleLink(row.article_link)));
    return posts.filter(post => !sentLinks.has(normalizeArticleLink(post.link))).slice(0, limit);
}

function escapeNewsletterHtml(value) {
    return String(value || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function formatBlogDate(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    return new Intl.DateTimeFormat('ko-KR', {
        timeZone: 'Asia/Seoul', year: 'numeric', month: 'long', day: 'numeric'
    }).format(date);
}

async function sendNewsletter(to, userName, newsData, insight, blogPosts = [], options = {}) {
    const today = new Date().toLocaleDateString('ko-KR');
    let newsletterHtml = '';
    const categories = [{ key: 'science', name: '과학' }, { key: 'ai', name: 'AI/네트워크' }, { key: 'defense', name: '방산/국방' }];

    categories.forEach(cat => {
        const articles = newsData[cat.key] || [];
        if (articles.length === 0) return;
        newsletterHtml += `<hr style="border: 0; border-top: 1px solid #ddd; margin: 30px 0;">`;
        newsletterHtml += `<h3 style="color: #2c3e50; margin-top: 0;">📌 오늘의 ${cat.name} 주요 뉴스</h3><ul style="list-style: none; padding: 0;">`;
        articles.forEach((art, i) => {
            newsletterHtml += `<li style="margin-top: 10px;"><a href="${art.link}" style="text-decoration: none; color: #333;"><strong>${i+1}. ${art.title}</strong></a></li>`;
        });
        newsletterHtml += `</ul>`;
    });

    let blogHtml = '';
    if (blogPosts.length > 0) {
        blogHtml = `<hr style="border:0; border-top:1px solid #e7d8d1; margin:34px 0 26px;">
        <div style="margin-top:0;">
            <p style="margin:0 0 6px; color:#c95f52; font-size:13px; font-weight:bold; letter-spacing:0.04em;">ADBC 새 글</p>
            <h3 style="margin:0 0 18px; color:#4b332b; font-size:21px;">📝 밀리터리 블로그 업데이트</h3>
            ${blogPosts.map(post => `<div style="overflow:hidden; background:#fffaf7; border:1px solid #f0ddd5; border-radius:12px; margin-top:12px;">
                ${post.imageUrl ? `<a href="${escapeNewsletterHtml(post.link)}" style="display:block; text-decoration:none;"><img src="${escapeNewsletterHtml(post.imageUrl)}" alt="${escapeNewsletterHtml(post.title)}" width="680" style="display:block; width:100%; max-width:680px; height:auto; border:0;"></a>` : ''}
                <div style="padding:18px 20px 20px;">
                    ${formatBlogDate(post.publishedAt) ? `<p style="margin:0 0 7px; color:#8c746b; font-size:12px;">${formatBlogDate(post.publishedAt)}</p>` : ''}
                    <a href="${escapeNewsletterHtml(post.link)}" style="display:block; color:#33231e; font-size:18px; font-weight:bold; line-height:1.55; word-break:keep-all; text-decoration:none;">${escapeNewsletterHtml(post.title)}</a>
                </div>
            </div>`).join('')}
        </div>`;
    }

    let html = `
    <div style="font-family: 'Malgun Gothic', sans-serif; max-width: 800px; margin: 0 auto; padding: 20px; border: 1px solid #eee; color: #333;">
        <h1 style="color: #1a73e8; text-align: center; border-bottom: 2px solid #1a73e8; padding-bottom: 15px;">🚀 ${userName}님을 위한 데일리 뉴스레터</h1>
    `;
    // ... (rest of html building logic from notify_newsletter.js)
    html += `<div style="margin-top: 30px; padding: 25px; background-color: #fcfcfc; border: 1px dashed #1a73e8; border-radius: 10px;">
             <p style="background-color: #f8f9fa; padding: 15px; border-left: 5px solid #1a73e8; font-style: italic; font-size: 1.1em;">"${insight}"</p>
            ${newsletterHtml}
            ${blogHtml}
        </div>
        <p style="margin-top: 40px; font-size: 12px; color: #999; text-align: center;">발송 시각: ${new Date().toLocaleString('ko-KR')}</p>
    </div>
    `;

    const transporter = nodemailer.createTransport({
        service: 'gmail',
        auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS }
    });
    const subject = options.subject || `[데일리 뉴스레터] 오늘의 산업 동향 (${today})`;
    await transporter.sendMail({ from: process.env.EMAIL_USER, to, subject, html });
}

// --- Main Logic ---
// ... (existing monitor function, updated to include newsletter logic)

function normalizeLink(link) {
    if (!link) return '';
    let normalized = link.replace(/;jsessionid=[^?#]*/, '');
    if (normalized.includes('?')) {
        const urlObj = new URL(normalized);
        const params = urlObj.searchParams;
        const newParams = new URLSearchParams();
        if (params.has('b_idx')) newParams.set('b_idx', params.get('b_idx'));
        if (params.has('internId')) newParams.set('internId', params.get('internId'));
        if (params.has('id')) newParams.set('internId', params.get('id'));
        if (params.has('youthId')) newParams.set('youthId', params.get('youthId'));
        const queryString = newParams.toString();
        return queryString ? `${urlObj.origin}${urlObj.pathname}?${queryString}` : `${urlObj.origin}${urlObj.pathname}`;
    }
    return normalized;
}

function parseEtri(html) {
    const posts = [];
    const tbodyMatch = html.match(/<tbody>([\s\S]*?)<\/tbody>/);
    if (tbodyMatch) {
        const rows = tbodyMatch[1].match(/<tr>([\s\S]*?)<\/tr>/g);
        if (rows) {
            rows.forEach(row => {
                const titleMatch = row.match(/<a[^>]*?>([\s\S]*?)<\/a>/);
                const linkMatch = row.match(/href="([^"]*?)"/);
                const dateMatch = row.match(/\d{4}-\d{2}-\d{2}/);
                if (titleMatch && linkMatch) {
                    posts.push({
                        title: titleMatch[1].replace(/<[^>]*>?/gm, '').trim(),
                        link: 'https://www.etri.re.kr' + linkMatch[1],
                        date: dateMatch ? dateMatch[0] : 'N/A'
                    });
                }
            });
        }
    }
    return posts;
}

function parseBtp(html) {
    const posts = [];
    const rows = html.match(/<tr>([\s\S]*?)<\/tr>/g);
    if (rows) {
        rows.forEach(row => {
            if (row.includes('부산지역인재')) {
                const titleMatch = row.match(/<a[^>]*?>([\s\S]*?)<\/a>/);
                const linkMatch = row.match(/href="([^"]*?)"/);
                const dateMatch = row.match(/\d{4}-\d{2}-\d{2}/);
                if (titleMatch && linkMatch) {
                    posts.push({
                        title: titleMatch[1].replace(/<[^>]*>?/gm, '').trim(),
                        link: 'https://www.btp.or.kr' + linkMatch[1].replace(/&amp;/g, '&'),
                        date: dateMatch ? dateMatch[0] : 'N/A'
                    });
                }
            }
        });
    }
    return posts;
}

function parseYouth(html) {
    const posts = [];
    const rows = html.match(/<tr[^>]*?>([\s\S]*?)<\/tr>/g);
    if (rows) {
        rows.forEach(row => {
            const titleMatch = row.match(/<a[^>]*?>([\s\S]*?)<\/a>/);
            const idMatch = row.match(/fn_selectYouthInternDetail\s*\(\s*'([^']+)'/);
            const periodMatch = row.match(/\d{4}\.\d{2}\.\d{2}\s*~\s*\d{4}\.\d{2}\.\d{2}/);
            const orgMatch = row.match(/<td[^>]*?class="org"[^>]*?>([\s\S]*?)<\/td>/) || row.match(/<td[^>]*?>([^<]*?)<\/td>/g);

            if (titleMatch && idMatch) {
                let org = 'N/A';
                if (orgMatch && orgMatch.length > 2) {
                    org = orgMatch[2].replace(/<[^>]*>?/gm, '').trim();
                }
                const youthId = idMatch[1];
                posts.push({
                    title: titleMatch[1].replace(/<[^>]*>?/gm, '').trim(),
                    link: `https://www.2030db.go.kr/user/youthIntern/selectYouthInternDetail.do?youthId=${youthId}`,
                    period: periodMatch ? periodMatch[0] : 'N/A',
                    org: org
                });
            }
        });
    }
    return posts;
}

// --- Email Notification ---

function escapeHtml(value) {
    return String(value ?? '')
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#039;');
}

function generateHtml(userResults, userName) {
    const siteEntries = Object.entries(userResults);
    const totalNew = siteEntries.reduce((sum, [, posts]) => sum + posts.length, 0);
    const safeUserName = escapeHtml(userName);
    const siteSummary = siteEntries
        .map(([siteName, posts]) => `
            <span style="display:inline-block; margin:0 6px 8px 0; padding:7px 11px; border:1px solid #eadbd5; border-radius:999px; background:#ffffff; color:#55372f; font-size:12px; font-weight:600;">
                ${escapeHtml(siteName)} · ${posts.length > 0 ? `신규 ${posts.length}건` : '확인 완료'}
            </span>
        `)
        .join('');

    let html = `
    <div style="margin:0; padding:24px 12px; background:#fffaf7; font-family:'Malgun Gothic','Apple SD Gothic Neo',sans-serif; color:#33231f;">
      <div style="max-width:720px; margin:0 auto; overflow:hidden; border:1px solid #eadbd5; border-radius:18px; background:#ffffff;">
        <div style="padding:30px 28px 24px; border-bottom:1px solid #eadbd5; background:#ffffff;">
          <div style="margin-bottom:18px; font-size:16px; font-weight:700; color:#55372f;">시그널 주간 채용 공고</div>
          <div style="display:inline-block; margin-bottom:12px; padding:5px 9px; border-radius:999px; background:#ffe3de; color:#9f3f36; font-size:11px; font-weight:700;">매주 월요일 업데이트</div>
          <h1 style="margin:0; color:#33231f; font-size:25px; line-height:1.4; letter-spacing:-0.5px;">${safeUserName}님이 선택한 채용 사이트를 확인했습니다</h1>
          <p style="margin:10px 0 0; color:#765f57; font-size:14px; line-height:1.7;">
            이번 주에는 관심 사이트 ${siteEntries.length}곳을 확인했고, 신규 공고는 <strong style="color:#f36f61;">${totalNew}건</strong>입니다.
            선택하지 않은 사이트의 공고는 포함하지 않았습니다.
          </p>
        </div>
        <div style="padding:20px 28px 12px; background:#f8eee9;">
          <div style="margin-bottom:9px; color:#765f57; font-size:12px; font-weight:700;">이번 주 확인한 사이트</div>
          <div>${siteSummary}</div>
        </div>
        <div style="padding:8px 28px 28px;">
    `;

    siteEntries.forEach(([siteName, posts]) => {
        const hasNew = posts.length > 0;
        const statusText = hasNew ? `신규 ${posts.length}건` : '신규 공고 없음';

        html += `
        <div style="margin-top:20px; overflow:hidden; border:1px solid ${hasNew ? '#f5b2a8' : '#eadbd5'}; border-radius:14px; background:#ffffff;">
          <div style="padding:15px 18px; border-bottom:1px solid #eadbd5; background:${hasNew ? '#fff0ed' : '#f7f1ee'};">
            <table role="presentation" style="width:100%; border-collapse:collapse;"><tr>
              <td style="color:#55372f; font-size:15px; font-weight:700;">${escapeHtml(siteName)}</td>
              <td style="text-align:right;"><span style="display:inline-block; padding:4px 8px; border-radius:999px; background:${hasNew ? '#f36f61' : '#ffffff'}; color:${hasNew ? '#ffffff' : '#765f57'}; font-size:11px; font-weight:700;">${statusText}</span></td>
            </tr></table>
          </div>
          <div style="padding:4px 18px;">
        `;

        if (posts.length === 0) {
            html += `<p style="margin:0; padding:18px 0; color:#8b756d; font-size:13px; line-height:1.6;">이번 주 새롭게 등록된 공고가 없습니다. 다음 주에도 계속 확인할게요.</p>`;
        } else {
            posts.forEach(post => {
                html += `
                  <div style="padding:16px 0; border-bottom:1px solid #f0e5e0;">
                    <a href="${escapeHtml(post.link)}" style="color:#33231f; font-size:14px; font-weight:700; line-height:1.55; text-decoration:none;">${escapeHtml(post.title)}</a>
                    <div style="margin-top:7px; color:#8b756d; font-size:12px;">${escapeHtml(post.date || post.period || '일정 확인 필요')} · <a href="${escapeHtml(post.link)}" style="color:#c65348; font-weight:700; text-decoration:none;">공고 보기 →</a></div>
                  </div>`;
            });
        }

        html += `</div></div>`;
    });

    html += `
        </div>
        <div style="padding:22px 28px; border-top:1px solid #eadbd5; background:#fffaf7; color:#8b756d; font-size:11px; line-height:1.7; text-align:center;">
          이 메일은 직접 선택한 채용 사이트만 확인해 자동 발송했습니다.<br>
          발송 시각: ${new Date().toLocaleString('ko-KR')}
        </div>
      </div>
    </div>
    `;

    return { html, totalNew };
}

async function sendEmail(to, userName, userResults) {
    if (Object.keys(userResults).length === 0) {
        throw new Error(`No monitoring sites are connected to ${to}; refusing to send an empty job email.`);
    }
    const { html, totalNew } = generateHtml(userResults, userName);
    const monitoredSiteCount = Object.keys(userResults).length;
    const subject = totalNew > 0
        ? `[주간 공고] ${userName}님, 선택한 ${monitoredSiteCount}곳에서 신규 공고 ${totalNew}건이 있습니다.`
        : `[주간 공고] 이번 주 신규 공고가 없습니다`;

    const transporter = nodemailer.createTransport({
        service: 'gmail',
        auth: {
            user: process.env.EMAIL_USER,
            pass: process.env.EMAIL_PASS
        }
    });

    await transporter.sendMail({
        from: process.env.EMAIL_USER,
        to: to,
        subject: subject,
        html: html
    });
}

// --- Main Logic ---

async function monitor() {
    console.log('Starting Service Monitor...');

    // 1. Fetch Subscribers & Sites
    const { data: subscribers, error: subError } = await supabase
        .from('subscribers')
        .select(`
            *,
            monitoring_sites (*)
        `)
        .eq('is_active', true);

    if (subError) {
        console.error('Error fetching subscribers:', subError);
        return;
    }

    if (!subscribers || subscribers.length === 0) {
        console.log('No active subscribers found.');
        return;
    }

    // Legacy single-user data may have monitoring_sites.subscriber_id = null.
    // Use those rows only when there is exactly one active subscriber, so a
    // broken foreign key cannot produce an empty email or leak data to others.
    if (subscribers.length === 1 && subscribers[0].monitoring_sites.length === 0) {
        const { data: orphanSites, error: orphanError } = await supabase
            .from('monitoring_sites')
            .select('*')
            .is('subscriber_id', null);
        if (orphanError) throw orphanError;
        if (orphanSites?.length) {
            console.warn(`Using ${orphanSites.length} legacy monitoring site(s) with no subscriber_id.`);
            subscribers[0].monitoring_sites = orphanSites;
        }
    }

    // GitHub Actions runs in UTC, so determine the weekly delivery day in KST.
    const isMonday = new Intl.DateTimeFormat('en-US', {
        timeZone: 'Asia/Seoul',
        weekday: 'short'
    }).format(new Date()) === 'Mon';
    let dataCache = {};
    let htmlCache = {};
    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext();

    // 2. The industry newsletter is collected and sent every day.
    try {
        const scrapedNewsData = await scrapeNews(context);
        const newsData = await filterRecentlySentNewsletter(scrapedNewsData);
        const articleCount = Object.values(newsData).reduce((sum, articles) => sum + articles.length, 0);
        let blogPosts = [];
        try {
            blogPosts = await filterUnsentBlogPosts(await scrapeNaverBlog());
        } catch (blogError) {
            console.error('Naver Blog scrape failed:', blogError.message);
        }
        const insight = '오늘의 과학·AI·방산 분야 주요 소식을 전해드립니다.';
        if (articleCount === 0 && blogPosts.length === 0) {
            console.log('No unsent newsletter articles or blog posts found. Skipping daily newsletter.');
        } else {
            for (const subscriber of subscribers.filter(subscriber => subscriber.daily_enabled !== false)) {
                await sendNewsletter(subscriber.email, subscriber.user_name || '회원', newsData, insight, blogPosts);
                console.log(`Daily newsletter sent to ${subscriber.email}`);
            }
            await saveNewsletterHistory({ ...newsData, naver_blog_rgm84d: blogPosts });
        }
    } catch (error) {
        console.error('Daily newsletter failed:', error);
    }

    // 3. Recruitment sites are collected and mailed once a week on Monday.
    if (isMonday) {
        console.log('Monday detected. Starting site scraping...');

        // --- Static/Regex Sites ---
        // Scrape ETRI
        try {
            const page = await context.newPage();
            await page.setExtraHTTPHeaders({ 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36' });
            await page.goto('https://www.etri.re.kr/kor/bbs/list.etri?b_board_id=ETRI39', { waitUntil: 'domcontentloaded' });
            htmlCache['etri'] = await page.content();
            await page.close();
        } catch (e) { console.error('ETRI scrape failed'); }

        // Scrape BTP
        try {
            const page = await context.newPage();
            await page.setExtraHTTPHeaders({ 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36' });
            await page.goto('https://www.btp.or.kr/index.php?pCode=MN2000192', { waitUntil: 'domcontentloaded' });
            htmlCache['btp'] = await page.content();
            await page.close();
        } catch (e) { console.error('BTP scrape failed'); }

        // Scrape Youth
        try {
            const page = await context.newPage();
            await page.setExtraHTTPHeaders({ 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36' });
            await page.goto('https://www.2030db.go.kr/user/youthIntern/selectYouthInternList.do', { waitUntil: 'domcontentloaded' });
            htmlCache['youth'] = await page.content();
            await page.close();
        } catch (e) { console.error('Youth scrape failed'); }

        // --- Dynamic/Evaluate Sites ---
        // Scrape Lig
        try {
            const page = await context.newPage();
            await page.setExtraHTTPHeaders({ 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36' });
            await page.goto('https://ligdna.recruiter.co.kr/app/jobnotice/list', { waitUntil: 'domcontentloaded' });
            await page.waitForSelector('li', { timeout: 10000 }).catch(() => {});
            dataCache['lig_data'] = await page.evaluate(() => {
                const results = [];
                document.querySelectorAll('li').forEach(li => {
                    const linkAnchor = li.querySelector('a[href*="/app/jobnotice/view"]');
                    if (linkAnchor && li.innerText.includes('접수중')) {
                        const title = linkAnchor.innerText.trim();
                        if (title.includes('신입')) {
                            const dateMatch = li.innerText.match(/\d{4}\.\d{2}\.\d{2}/);
                            results.push({ title, link: linkAnchor.href, date: dateMatch ? dateMatch[0] : 'N/A' });
                        }
                    }
                });
                return results;
            });
            await page.close();
        } catch (e) { console.error('Lig scrape failed'); }

        // Scrape Hanwha
        try {
            const page = await context.newPage();
            await page.setExtraHTTPHeaders({ 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36' });
            await page.goto('https://www.hanwhain.com/portal/apply/recruit', { waitUntil: 'domcontentloaded' });
            await page.waitForTimeout(5000);
            dataCache['hanwha_data'] = await page.evaluate(() => {
                const results = [];
                document.querySelectorAll('li').forEach(li => {
                    const affiliate = li.querySelector('.affiliate-name')?.innerText || '';
                    const title = li.querySelector('.recruit-title')?.innerText || '';
                    if ((affiliate.includes('한화시스템') || affiliate.includes('한화에어로스페이스')) && title.includes('신입')) {
                        const dateMatch = li.innerText.match(/\d{4}\.\d{2}\.\d{2}/);
                        results.push({ title: `[${affiliate}] ${title}`, link: 'https://www.hanwhain.com/portal/apply/recruit', date: dateMatch ? dateMatch[0] : 'N/A' });
                    }
                });
                return results;
            });
            await page.close();
        } catch (e) { console.error('Hanwha scrape failed'); }

        // Scrape KoreaAero
        try {
            const page = await context.newPage();
            await page.setExtraHTTPHeaders({ 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36' });
            await page.goto('https://koreaaero.recruiter.co.kr/career/job', { waitUntil: 'domcontentloaded' });
            await page.waitForSelector('li', { timeout: 10000 }).catch(() => {});
            dataCache['kai_data'] = await page.evaluate(() => {
                const results = [];
                document.querySelectorAll('li').forEach(li => {
                    const linkAnchor = li.querySelector('a[href*="/career/jobs/"]');
                    if (linkAnchor && li.innerText.includes('접수중')) {
                        const lines = li.innerText
                            .split('\n')
                            .map(line => line.trim())
                            .filter(Boolean);
                        const title = lines.find(line => line !== '접수중') || linkAnchor.innerText.trim();
                        if (li.innerText.includes('신입')) {
                            const dateMatch = li.innerText.match(/\d{4}\.\d{2}\.\d{2}/);
                            results.push({ title, link: linkAnchor.href, date: dateMatch ? dateMatch[0] : 'N/A' });
                        }
                    }
                });
                return results;
            });
            await page.close();
        } catch (e) { console.error('KoreaAero scrape failed'); }

    } else {
        console.log('Not Monday. Skipping site scraping.');
    }

    // 4. Build and send each subscriber's weekly recruitment digest.
    if (isMonday) {
        for (const subscriber of subscribers) {
            console.log(`Processing weekly jobs for: ${subscriber.email}`);
            const userResults = {};

            for (const site of subscriber.monitoring_sites) {
                let posts = [];
                if (site.url.includes('etri.re.kr') && htmlCache.etri) {
                    posts = parseEtri(htmlCache.etri);
                } else if (site.url.includes('btp.or.kr') && htmlCache.btp) {
                    posts = parseBtp(htmlCache.btp);
                } else if (site.url.includes('2030db.go.kr') && htmlCache.youth) {
                    posts = parseYouth(htmlCache.youth);
                } else if (site.url.includes('ligdna.recruiter.co.kr')) {
                    posts = dataCache.lig_data || [];
                } else if (site.url.includes('hanwhain.com')) {
                    posts = dataCache.hanwha_data || [];
                } else if (site.url.includes('koreaaero.recruiter.co.kr')) {
                    posts = dataCache.kai_data || [];
                }

                const newPosts = [];
                for (const post of posts) {
                    const normalizedLink = normalizeLink(post.link);
                    const { data: existing, error: historyError } = await supabase
                        .from('crawl_history')
                        .select('id')
                        .eq('site_id', site.id)
                        .eq('job_link', normalizedLink)
                        .maybeSingle();
                    if (historyError) throw historyError;

                    if (!existing) {
                        newPosts.push({ ...post, link: normalizedLink });
                    }
                }
                userResults[site.site_name] = newPosts;
            }

            try {
                await sendEmail(subscriber.email, subscriber.user_name || '회원', userResults);

                // Mark posts as sent only after SMTP succeeds.
                for (const site of subscriber.monitoring_sites) {
                    for (const post of userResults[site.site_name] || []) {
                        const { error: insertError } = await supabase.from('crawl_history').insert({
                            site_id: site.id,
                            job_title: post.title.trim(),
                            job_link: post.link
                        });
                        if (insertError && insertError.code !== '23505') throw insertError;
                    }
                }
                console.log(`Weekly job digest sent to ${subscriber.email}`);
            } catch (error) {
                console.error(`Weekly job digest failed for ${subscriber.email}:`, error);
            }
        }
    }

    await context.close();
    await browser.close();
    console.log('Monitor run completed.');
}

if (require.main === module) {
    monitor().catch(error => {
        console.error('Fatal monitor error:', error);
        process.exitCode = 1;
    });
}

module.exports = {
    filterAndSort,
    selectDongAScienceArticles,
    scrapeNews,
    normalizeArticleTitle,
    normalizeArticleLink,
    excludeRecentlySentArticles,
    selectLatestDeliveryRows,
    decodeXmlText,
    extractFirstImageUrl,
    parseNaverBlogRss,
    scrapeNaverBlog,
    filterUnsentBlogPosts,
    sendNewsletter,
    normalizeLink,
    parseEtri,
    parseBtp,
    parseYouth,
    generateHtml
};
