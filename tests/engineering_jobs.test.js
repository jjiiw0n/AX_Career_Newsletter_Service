const test = require('node:test');
const assert = require('node:assert/strict');
const { experienceDuties, youthDuties, filterEngineeringJobs } = require('../lib/engineering_jobs');
const detail = html => `<tr><th scope="row">주요내용</th><td>${html}</td></tr>`;

test('IT classification alone does not make a job engineering', () => {
    assert.deepEqual(experienceDuties(detail('AI 교육 운영 지원<br>데이터 정리<br>사무 보조')), []);
    assert.deepEqual(experienceDuties(detail('전공 무관<br>- 프롬프트 테스트 결과 검증<br>- 행정 지원')), ['프롬프트 테스트 결과 검증']);
});

test('youth checks duties, not agency title or qualifications', () => {
    assert.deepEqual(youthDuties('기술연구원\n담당 업무\n문서 정리\n응시자격\n소프트웨어 개발 관련 전공'), []);
    assert.deepEqual(youthDuties('담당 업무\n수산생물 시험 분석, 데이터 정리'), []);
    assert.deepEqual(youthDuties('주요 업무 내용\n인턴01 행정 보조\n인턴02 선박 센서 계측 시험\n2 응시자격'), ['인턴02 선박 센서 계측 시험']);
});

test('experience skips nontechnical categories before opening details', async () => {
    let requests = 0;
    const posts = await filterEngineeringJobs('experience', [
        { title: '연구기관 사무', jobField: '경영·사무', historyKey: '/PG123' },
        { title: '설비 직무', jobField: '생산·제조', historyKey: '/PG456' }
    ], { getText: async (url, options) => {
        requests++;
        assert.equal(options.body.get('untyPrgmCtn'), 'PG456');
        return detail('전기설비 안전 점검');
    } });
    assert.equal(requests, 1);
    assert.deepEqual(posts[0].engineeringDuties, ['전기설비 안전 점검']);
});

test('youth uses a public PDF when HTML lacks duties and skips unreadable jobs', async () => {
    const posts = await filterEngineeringJobs('youth', [{ link: 'https://www.2030db.go.kr/test1' }, { link: 'https://www.2030db.go.kr/test2' }], {
        getText: async link => link.endsWith('1') ? `<a onclick="return fn_egov_downFile('ABC=','1')"><p>공고.pdf</p></a>` : '<p>첨부 없음</p>',
        getPdf: async url => {
            assert.equal(url.hostname, 'www.2030db.go.kr');
            return '주요업무내용\nㅇ 전자회로 시제품 설계\n응시자격';
        }
    });
    assert.equal(posts.length, 1);
    assert.deepEqual(posts[0].engineeringDuties, ['전자회로 시제품 설계']);
});
