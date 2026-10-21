// No environment credentials, email sending, or database access in this check.
const { SOURCES, requestPublicPage, requestWithRetry, parseExperience, parseYouthOpen, parseKnda } = require('../../lib/weekly_sources');

async function main() {
    await Promise.all(Object.entries(SOURCES).map(async ([source, config]) => {
        const url = source === 'knda'
            ? 'https://www.krivet.re.kr/kor/knda/homeKndaSelectList.do?pageIndex=1&recordCountPerPage=10'
            : config.url;
        try {
            const raw = await requestWithRetry(url, requestPublicPage);
            let count;
            if (source === 'experience') {
                if (!raw.includes('totalRecordCount')) throw new Error('Program list missing');
                count = parseExperience(raw).length;
            } else if (source === 'youth') {
                if (!raw.includes('fn_selectYouthInternDetail')) throw new Error('Youth list missing');
                count = parseYouthOpen(raw).length;
            } else if (source === 'knda') count = parseKnda(JSON.parse(raw)).length;
            else {
                if (!raw.includes('b_idx')) throw new Error('ETRI list missing');
                count = 'HTML verified';
            }
            console.log(`PASS ${source}: ${count}`);
        } catch (error) {
            console.error(`FAIL ${source}: ${error.message}`);
            process.exitCode = 1;
        }
    }));
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
