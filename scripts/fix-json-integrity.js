const fs = require('fs');
const path = require('path');

const CONTENT_DIR = path.join(__dirname, '../content');

function scanDir(dir) {
    const files = fs.readdirSync(dir);

    for (const file of files) {
        const fullPath = path.join(dir, file);
        const stats = fs.statSync(fullPath);

        if (stats.isDirectory()) {
            if (file !== 'node_modules' && file !== '.git') {
                scanDir(fullPath);
            }
        } else if (file.endsWith('.json')) {
            process.stdout.write(`Checking: ${fullPath.replace(CONTENT_DIR, '')} ... `);
            if (stats.size === 0) {
                console.log('CRITICAL (Empty)');
                continue;
            }

            try {
                const content = fs.readFileSync(fullPath, 'utf8');
                JSON.parse(content);
                console.log('OK');
            } catch (e) {
                console.log(`ERROR (${e.message})`);
            }
        }
    }
}

console.log(`Scanning ${CONTENT_DIR} for JSON integrity...`);
try {
    scanDir(CONTENT_DIR);
    console.log('\nScan completed.');
} catch (e) {
    console.error(`\nScan failed: ${e.message}`);
}
