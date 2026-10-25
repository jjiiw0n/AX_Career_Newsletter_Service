const { chromium } = require('playwright');
const { scrapeShipbuilding } = require('../lib/shipbuilding_news');
async function main() {
    const browser = await chromium.launch({ headless: true, ...(process.env.LOCAL_CHROME === 'true' ? { channel: 'chrome' } : {}) });
    try {
        const context = await browser.newContext();
        const { articles, status } = await scrapeShipbuilding(context);
        console.log(JSON.stringify({ status, eligible: articles.length,
            preview: articles.slice(0, 3).map(({ title, link, publishedAt, score }) => ({ title, link, publishedAt, score })) }));
        if (Object.values(status).some(source => !source.ok)) process.exitCode = 1;
    } finally { await browser.close(); }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
