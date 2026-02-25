const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const FileStore = require('../storage/file-store');

const CONTENT_DIR = path.join(__dirname, '..', 'content');
const DUP_REPORT_PATH = path.join(CONTENT_DIR, 'inbox', 'reports', 'duplicate-candidates.json');
const MIG_REPORT_PATH = path.join(CONTENT_DIR, 'inbox', 'reports', 'bulk-shared-migration-report.json');
const CLEANUP_REPORT_PATH = path.join(CONTENT_DIR, 'inbox', 'reports', 'personal-duplicate-cleanup-report.json');

const fileStore = new FileStore(CONTENT_DIR);

function sortObjectKeys(obj) {
    if (obj === null || typeof obj !== 'object') return obj;
    if (Array.isArray(obj)) return obj.map(sortObjectKeys);
    const sortedKeys = Object.keys(obj).sort();
    const result = {};
    sortedKeys.forEach(key => { result[key] = sortObjectKeys(obj[key]); });
    return result;
}

function getHash(filePath) {
    if (!fs.existsSync(filePath)) return null;
    try {
        const content = JSON.parse(fs.readFileSync(filePath, 'utf8'));
        const normalized = JSON.stringify(sortObjectKeys(content));
        return crypto.createHash('sha256').update(normalized).digest('hex');
    } catch (e) {
        return null;
    }
}

async function run() {
    console.log("Starting personal duplicate cleanup...");

    if (!fs.existsSync(DUP_REPORT_PATH) || !fs.existsSync(MIG_REPORT_PATH)) {
        console.error("Required reports missing.");
        return;
    }

    const dupData = JSON.parse(fs.readFileSync(DUP_REPORT_PATH, 'utf8'));
    const migData = JSON.parse(fs.readFileSync(MIG_REPORT_PATH, 'utf8'));

    // Map migrated filenames for quick lookup
    const migratedMap = new Map();
    migData.migratedItems.forEach(item => {
        migratedMap.set(`${item.type}:${item.fileName}`, item);
    });

    const summary = {
        candidatesReviewed: dupData.candidates.length,
        deletedFiles: 0,
        updatedIndexes: 0,
        skipped: 0,
        errors: 0
    };

    const deletedItems = [];
    const skippedItems = [];
    const errors = [];

    for (const candidate of dupData.candidates) {
        const key = `${candidate.type}:${candidate.fileName}`;
        const migrationInfo = migratedMap.get(key);

        if (!migrationInfo || (migrationInfo.result !== 'created' && migrationInfo.result !== 'updated')) {
            skippedItems.push({ fileName: candidate.fileName, reason: "not_in_migration_report_or_failed" });
            summary.skipped++;
            continue;
        }

        const sharedPath = path.join(CONTENT_DIR, '..', migrationInfo.targetPath);
        const sharedHash = getHash(sharedPath);

        if (!sharedHash) {
            skippedItems.push({ fileName: candidate.fileName, reason: "shared_file_missing_or_invalid", path: migrationInfo.targetPath });
            summary.skipped++;
            continue;
        }

        // Clean up for each user who has this duplicate
        for (const userId of candidate.users) {
            try {
                const personalPath = path.join(CONTENT_DIR, userId, candidate.fileName);
                const personalHash = getHash(personalPath);

                if (!personalHash) {
                    // Item might already be cleaned up or missing
                    skippedItems.push({ userId, fileName: candidate.fileName, reason: "personal_file_missing" });
                    summary.skipped++;
                    continue;
                }

                // SECURE CHECK: Hashes must match exactly
                if (personalHash !== sharedHash) {
                    skippedItems.push({ userId, fileName: candidate.fileName, reason: "hash_mismatch_security_stop" });
                    summary.skipped++;
                    continue;
                }

                // 1. Remove from personal index
                const indexPath = path.join(CONTENT_DIR, userId, `${candidate.type}_topics.json`);
                if (!fs.existsSync(indexPath)) {
                    skippedItems.push({ userId, fileName: candidate.fileName, reason: "personal_index_missing" });
                    summary.skipped++;
                    continue;
                }

                const index = JSON.parse(fs.readFileSync(indexPath, 'utf8'));
                const newIndex = index.filter(t => t.file !== candidate.fileName);

                if (index.length === newIndex.length) {
                    skippedItems.push({ userId, fileName: candidate.fileName, reason: "entry_not_in_index" });
                    summary.skipped++;
                    continue;
                }

                // ATOMIC WRITE INDEX
                fileStore.writeJsonAtomic(indexPath, newIndex);
                summary.updatedIndexes++;

                // 2. DELETE PERSONAL FILE
                fs.unlinkSync(personalPath);
                summary.deletedFiles++;

                deletedItems.push({
                    userId,
                    type: candidate.type,
                    fileName: candidate.fileName,
                    personalPath: `content/${userId}/${candidate.fileName}`,
                    sharedPath: migrationInfo.targetPath,
                    indexFile: `content/${userId}/${candidate.type}_topics.json`
                });

            } catch (e) {
                console.error(`Error cleaning up ${candidate.fileName} for ${userId}:`, e.message);
                errors.push({ userId, fileName: candidate.fileName, error: e.message });
                summary.errors++;
            }
        }
    }

    const report = {
        generatedAt: new Date().toISOString(),
        sourceReports: {
            duplicates: "content/inbox/reports/duplicate-candidates.json",
            migration: "content/inbox/reports/bulk-shared-migration-report.json"
        },
        scope: dupData.scope,
        summary,
        deletedItems,
        skippedItems,
        errors
    };

    fs.writeFileSync(CLEANUP_REPORT_PATH, JSON.stringify(report, null, 2));

    console.log("Cleanup complete!");
    console.log(`- Files Deleted: ${summary.deletedFiles}`);
    console.log(`- Indexes Updated: ${summary.updatedIndexes}`);
    console.log(`- Skipped: ${summary.skipped}`);
    console.log(`- Errors: ${summary.errors}`);
}

run().catch(console.error);
