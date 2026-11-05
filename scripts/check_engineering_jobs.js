// Read-only: no emails, cache uploads or delivery-history access.
const { collectSource } = require('../lib/weekly_sources');
async function main() {
    for (const source of process.argv.slice(2)) {
        if (!['youth', 'experience'].includes(source)) throw new Error('Specify youth or experience');
        const posts = await collectSource(source, undefined, { engineeringOnly: true });
        console.log(JSON.stringify({ source, count: posts.length, sample: posts.slice(0, 4).map(({ title, jobField, engineeringDuties }) => ({ title, jobField, engineeringDuties })) }));
    }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
