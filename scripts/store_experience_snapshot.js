require('dotenv').config();
const { gunzipSync } = require('node:zlib');
const client = require('../lib/supabase');
const { uploadSnapshot, loadSnapshot } = require('../lib/experience_cache');
async function main() {
    if (process.argv.includes('--check')) {
        const posts = await loadSnapshot(client);
        console.log(`PASS private experience cache: ${posts.length} unexpired postings`);
        return;
    }
    const input = process.env.EXPERIENCE_SNAPSHOT;
    if (!input || input.length > 60000 || !/^[A-Za-z0-9+/=]+$/.test(input)) throw new Error('Invalid snapshot input');
    const snapshot = JSON.parse(gunzipSync(Buffer.from(input, 'base64'), { maxOutputLength: 2097152 }).toString('utf8'));
    await uploadSnapshot(client, snapshot);
    const posts = await loadSnapshot(client);
    console.log(`Private experience cache verified: ${posts.length} unexpired postings; no email sent`);
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
