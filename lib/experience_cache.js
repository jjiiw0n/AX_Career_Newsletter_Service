const BUCKET = 'weekly-source-cache';
const OBJECT = 'experience.json';
const MAX_AGE_MS = 36 * 60 * 60 * 1000;

function validateSnapshot(snapshot, now = Date.now()) {
    const collectedAt = Date.parse(snapshot?.collectedAt);
    if (snapshot?.version !== 1 || snapshot.source !== 'experience' || !Array.isArray(snapshot.posts)
        || !Number.isFinite(collectedAt) || collectedAt > now + 300000 || now - collectedAt > MAX_AGE_MS) {
        throw new Error('Local experience snapshot missing, invalid, or older than 36 hours');
    }
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now).replaceAll('-', '');
    return snapshot.posts.filter(post => {
        if (typeof post.title !== 'string' || typeof post.period !== 'string'
            || !/^https:\/\/yw\.work24\.go\.kr\/program\/PG\d+$/.test(post.historyKey)
            || !post.link?.startsWith('https://yw.work24.go.kr/d/a/selectWkexPrgmList.do?pgnm=')) {
            throw new Error('Invalid experience snapshot posting');
        }
        const dates = post.period.match(/\d{2,4}[-.]\d{2}[-.]\d{2}/g);
        if (!dates || dates.length < 2) throw new Error('Missing experience application deadline');
        let end = dates[1].replace(/\D/g, '');
        if (end.length === 6) end = `20${end}`;
        return end >= today;
    });
}

async function uploadSnapshot(client, snapshot) {
    validateSnapshot(snapshot);
    const { data: bucket, error: lookupError } = await client.storage.getBucket(BUCKET);
    if (!bucket) {
        const { error } = await client.storage.createBucket(BUCKET, {
            public: false, fileSizeLimit: 2097152, allowedMimeTypes: ['application/json']
        });
        if (error) throw new Error(`Cannot create private source cache: ${error.message || lookupError?.message}`);
    } else if (bucket.public) throw new Error('Source cache must be private');
    const { error } = await client.storage.from(BUCKET).upload(OBJECT, JSON.stringify(snapshot), {
        contentType: 'application/json', upsert: true
    });
    if (error) throw error;
}

async function loadSnapshot(client) {
    const { data, error } = await client.storage.from(BUCKET).download(OBJECT);
    if (error) throw new Error(`Local experience cache unavailable: ${error.message}`);
    return validateSnapshot(JSON.parse(await data.text()));
}

module.exports = { validateSnapshot, uploadSnapshot, loadSnapshot, MAX_AGE_MS };
