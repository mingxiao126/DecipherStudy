const fs = require('fs');
const path = require('path');
const FileStore = require('../storage/file-store');

const CONTENT_DIR = path.join(__dirname, '..', 'content');
const REPORT_PATH = path.join(CONTENT_DIR, 'inbox', 'reports', 'duplicate-candidates.json');
const MIGRATION_REPORT_PATH = path.join(CONTENT_DIR, 'inbox', 'reports', 'bulk-shared-migration-report.json');
const SCHOOL_ID = 'ualberta';

const SUBJECT_MAP = {
    '经济学': 'econ102',
    '统计学': 'stat124',
    'economics': 'econ102',
    'statistics': 'stat124'
};

const fileStore = new FileStore(CONTENT_DIR);

function mapSubject(item) {
    // 1. Try subjectHint
    if (item.subjectHint && SUBJECT_MAP[item.subjectHint]) {
        return SUBJECT_MAP[item.subjectHint];
    }

    // 2. Try fileName keywords
    const lowerName = item.fileName.toLowerCase();
    if (lowerName.includes('经济学') || lowerName.includes('econ')) return 'econ102';
    if (lowerName.includes('统计学') || lowerName.includes('stat')) return 'stat124';

    return null;
}

async function run() {
    console.log("Starting bulk shared migration...");

    if (!fs.existsSync(REPORT_PATH)) {
        console.error("Source report not found:", REPORT_PATH);
        return;
    }

    const sourceData = JSON.parse(fs.readFileSync(REPORT_PATH, 'utf8'));
    const candidates = sourceData.candidates || [];

    const summary = {
        candidatesTotal: candidates.length,
        migrated: 0,
        updated: 0,
        skipped: 0,
        errors: 0
    };

    const migratedItems = [];
    const skippedItems = [];
    const errors = [];

    for (const item of candidates) {
        // Validation: Only process safe candidates
        if (!item.sameContent || !item.sameFileName) {
            skippedItems.push({ fileName: item.fileName, reason: "not_identical_match" });
            summary.skipped++;
            continue;
        }

        const subjectId = mapSubject(item);
        if (!subjectId) {
            skippedItems.push({ fileName: item.fileName, reason: "unmapped_subject" });
            summary.skipped++;
            continue;
        }

        try {
            // Read content from first user path
            const sourcePath = item.paths[0];
            if (!fs.existsSync(sourcePath)) {
                skippedItems.push({ fileName: item.fileName, reason: "missing_source_file" });
                summary.skipped++;
                continue;
            }

            const data = JSON.parse(fs.readFileSync(sourcePath, 'utf8'));

            // Prepare record for FileStore.publishToShared
            const record = {
                id: item.id || `ds_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
                schoolId: SCHOOL_ID,
                subject: subjectId,
                type: item.type,
                fileName: item.fileName,
                displayName: item.fileName.replace('.json', '') // Fallback name
            };

            // Use FileStore to publish (handles index updates and atomic writes)
            const sharedDir = path.join(CONTENT_DIR, 'shared', SCHOOL_ID, subjectId);
            const indexPath = path.join(sharedDir, `${item.type}_topics.json`);
            const exists = fs.existsSync(path.join(sharedDir, item.fileName));

            fileStore.publishToShared(record, data);

            migratedItems.push({
                type: item.type,
                fileName: item.fileName,
                subjectId: subjectId,
                sourceUser: item.users[0],
                targetPath: path.join('content', 'shared', SCHOOL_ID, subjectId, item.fileName),
                result: exists ? "updated" : "created"
            });

            if (exists) summary.updated++;
            else summary.migrated++;

        } catch (e) {
            console.error(`Error migrating ${item.fileName}:`, e.message);
            errors.push({ fileName: item.fileName, error: e.message });
            summary.errors++;
        }
    }

    const migrationReport = {
        generatedAt: new Date().toISOString(),
        sourceReport: "content/inbox/reports/duplicate-candidates.json",
        schoolId: SCHOOL_ID,
        summary,
        migratedItems,
        skippedItems,
        errors
    };

    const reportDir = path.dirname(MIGRATION_REPORT_PATH);
    if (!fs.existsSync(reportDir)) fs.mkdirSync(reportDir, { recursive: true });

    fs.writeFileSync(MIGRATION_REPORT_PATH, JSON.stringify(migrationReport, null, 2));

    console.log("Migration complete!");
    console.log(`- Total Candidates: ${summary.candidatesTotal}`);
    console.log(`- Migrated: ${summary.migrated}`);
    console.log(`- Updated: ${summary.updated}`);
    console.log(`- Skipped: ${summary.skipped}`);
    console.log(`- Errors: ${summary.errors}`);
}

run().catch(console.error);
