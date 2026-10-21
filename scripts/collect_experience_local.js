// Runs only the public experience collector; never sends email or marks delivery history.
const path = require('node:path');
const fs = require('node:fs');
const { gzipSync } = require('node:zlib');
const { spawnSync } = require('node:child_process');
const { collectSource } = require('../lib/weekly_sources');
const { validateSnapshot } = require('../lib/experience_cache');
const root = path.resolve(__dirname, '..');
const logPath = path.join(root, 'data', 'experience-local.log');
function log(message) {
    const line = `${new Date().toISOString()} ${message}\n`;
    fs.mkdirSync(path.dirname(logPath), { recursive: true });
    fs.appendFileSync(logPath, line);
    console.log(message);
}
async function main() {
    log('Starting public experience collection');
    const posts = await collectSource('experience');
    const snapshot = { version: 1, source: 'experience', collectedAt: new Date().toISOString(), posts };
    validateSnapshot(snapshot);
    const payload = gzipSync(JSON.stringify(snapshot)).toString('base64');
    if (payload.length > 60000) throw new Error('Snapshot exceeds safe workflow input size');
    const result = spawnSync('gh', ['workflow', 'run', 'experience-cache.yml', '--repo', 'jjiiw0n/AX_Career_Newsletter_Service', '--ref', 'main', '--json'], {
        cwd: root, input: JSON.stringify({ snapshot: payload }), encoding: 'utf8', windowsHide: true, timeout: 60000
    });
    if (result.error || result.status !== 0) throw new Error(result.error?.message || result.stderr || 'Snapshot dispatch failed');
    const runUrl = result.stdout.match(/https:\/\/github\.com\/[^\s]+\/actions\/runs\/(\d+)/);
    if (!runUrl) throw new Error('Snapshot dispatched but upload run URL not returned; check GitHub Actions');
    log(`Collected ${posts.length} postings; waiting for private cache upload: ${runUrl[0]}`);
    const watched = spawnSync('gh', ['run', 'watch', runUrl[1], '--repo', 'jjiiw0n/AX_Career_Newsletter_Service', '--exit-status', '--interval', '10'], {
        cwd: root, encoding: 'utf8', windowsHide: true, timeout: 480000
    });
    if (watched.error || watched.status !== 0) throw new Error('Private cache upload did not complete successfully; check GitHub Actions');
    log(`SUCCESS: ${posts.length} postings uploaded; no email sent`);
}
main().catch(error => { log(`FAILED: ${error.message}`); process.exitCode = 1; });
