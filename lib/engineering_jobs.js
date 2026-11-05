const { spawnSync } = require('node:child_process');
const FIELD = /^(IT|연구\s*[·ㆍ・]\s*R&D|생산\s*[·ㆍ・]\s*제조)$/i;
const SUBJECT = /소프트웨어|프로그래밍|코딩|웹\s*(서비스|사이트|앱|개발)|서버|백엔드|프론트엔드|알고리즘|AI\b|인공지능|프롬프트|전기\s*설비|전자\s*회로|통신\s*장비|네트워크|센서|반도체|로봇|기계\s*(설계|설비|부품|장비)|도면|CAD\b|선박|해양\s*(장비|공학|구조물)|수질|대기오염|시스템|공정|소재|시제품/i;
const DATA_WORK = /데이터(?:셋)?\s*(?:(?:수집|가공)\s*(?:·|및|과|,)?\s*)?(?:분석|정제|전처리|모델링|시각화|검증|처리)/;
const ACTION = /개발|설계|구현|테스트|시험|검증|분석|모델링|측정|계측|제어|구축|정비|점검|시뮬레이션|최적화|도면\s*작성|품질\s*검수/;
const NOT_DUTIES = /전공|학위|자격증|우대사항|응시자격|지원자격|교육과정|(?:교육|수업)\s*(?:운영|진행)|멘토링|문서\s*정리|자료\s*입력|단순\s*조립/;

function plainLines(html) {
    return html.replace(/<!--[\s\S]*?-->/g, '').replace(/<(?:script|style)\b[^>]*>[\s\S]*?<\/(?:script|style)>/gi, '')
        .replace(/<br\s*\/?\s*>|<\/(?:p|li|tr|div|h[1-6])>/gi, '\n').replace(/<[^>]*>/g, '')
        .replace(/&amp;/gi, '&').replace(/&nbsp;|&#160;/gi, ' ').replace(/&#8203;/g, '');
}

function engineeringDuties(text) {
    return [...new Set(text.split(/\r?\n/).map(line => line.replace(/^\s*[-•ㅇ○▸▪]+\s*/, '').replace(/\s+/g, ' ').trim())
        .filter(line => line.length >= 5 && line.length <= 180 && (DATA_WORK.test(line) || (SUBJECT.test(line) && ACTION.test(line))) && !NOT_DUTIES.test(line)))].slice(0, 3);
}

function experienceDuties(html) {
    const cell = html.match(/<th\b[^>]*>\s*주요내용\s*<\/th>\s*<td\b[^>]*>([\s\S]*?)<\/td>/i)?.[1];
    return cell ? engineeringDuties(plainLines(cell).split(/\[과업\s*주요내용\]|\[참여\s*조건\]|\[선발\s*기준\]/)[0]) : [];
}

function youthDuties(text) {
    const start = /주요\s*업무\s*내용|주요\s*업무|담당\s*업무|직무\s*내용/.exec(text);
    if (!start) return [];
    return engineeringDuties(text.slice(start.index + start[0].length)
        .split(/응시\s*자격|지원\s*자격|선발\s*절차|시험\s*방법|가산\s*요건/)[0].slice(0, 7000));
}

function pdfAttachment(html) {
    for (const [anchor] of html.matchAll(/<a\b[^>]*fn_egov_downFile\('[A-Za-z0-9+/=]+','\d+'\)[\s\S]*?<\/a>/g)) {
        if (!/\.pdf\s*<\/p>/i.test(anchor)) continue;
        const [, id, sn] = anchor.match(/fn_egov_downFile\('([^']+)','(\d+)'\)/);
        const url = new URL('https://www.2030db.go.kr/cmm/fms/FileDown.do');
        url.searchParams.set('atchFileId', id);
        url.searchParams.set('fileSn', sn);
        return url;
    }
    return null;
}

async function fetchText(url, options = {}) {
    const response = await fetch(url, { ...options, signal: AbortSignal.timeout(12000) });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.text();
}

async function readPdf(url) {
    const response = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(18000) });
    if (!response.ok || !response.body) throw new Error(`PDF HTTP ${response.status}`);
    let total = 0;
    const chunks = [];
    for await (const chunk of response.body) {
        total += chunk.length;
        if (total > 8 * 1024 * 1024) throw new Error('PDF exceeds size limit');
        chunks.push(chunk);
    }
    const bytes = Buffer.concat(chunks);
    if (bytes.subarray(0, 5).toString() !== '%PDF-') throw new Error('Attachment is not a PDF');
    const result = spawnSync(process.env.JOB_PDF_PYTHON || 'python3', ['-c',
        'import io,sys; from pypdf import PdfReader; r=PdfReader(io.BytesIO(sys.stdin.buffer.read())); print(chr(10).join(p.extract_text(extraction_mode="layout") or "" for p in r.pages[:8]))'],
    { input: bytes, encoding: 'utf8', timeout: 15000, maxBuffer: 1024 * 1024, windowsHide: true,
        env: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot,
            PYTHONPATH: process.env.PYTHONPATH, PYTHONIOENCODING: 'utf-8' } });
    if (result.status !== 0 || result.error) throw new Error('PDF text extraction unavailable');
    return result.stdout;
}

async function filterEngineeringJobs(source, posts, { getText = fetchText, getPdf = readPdf } = {}) {
    if (!['experience', 'youth'].includes(source)) return posts;
    const candidates = source === 'experience' ? posts.filter(post => FIELD.test(post.jobField || '')) : posts;
    const selected = new Map();
    let next = 0, failures = 0;
    await Promise.all(Array.from({ length: Math.min(3, candidates.length) }, async () => {
        while (next < candidates.length) {
            const index = next++;
            const post = candidates[index];
            try {
                let duties;
                if (source === 'experience') {
                    const id = post.historyKey?.match(/\/(PG\d+)$/)?.[1];
                    if (!id) continue;
                    duties = experienceDuties(await getText('https://yw.work24.go.kr/d/a/selectItrnPrjtEsgPrgmDtal.do', {
                        method: 'POST', body: new URLSearchParams({ untyPrgmCtn: id, prgmSecd: 'I' })
                    }));
                } else {
                    const html = await getText(post.link);
                    const detail = html.match(/<div\s+class="post-detail"[\s\S]*?<!--\s*첨부파일\s*-->/)?.[0] || '';
                    duties = youthDuties(plainLines(detail));
                    if (!duties.length) {
                        const attachment = pdfAttachment(html);
                        if (attachment) duties = youthDuties(await getPdf(attachment));
                    }
                }
                if (duties.length) selected.set(index, { ...post, engineeringDuties: duties });
            } catch { failures++; }
        }
    }));
    console.log(`${source} engineering: ${posts.length} open, ${candidates.length} checked, ${selected.size} matched, ${failures} detail failures`);
    if (candidates.length && failures === candidates.length) throw new Error(`${source}: all engineering detail checks failed`);
    return [...selected.entries()].sort(([a], [b]) => a - b).map(([, post]) => post);
}

module.exports = { filterEngineeringJobs, experienceDuties, youthDuties, pdfAttachment };
