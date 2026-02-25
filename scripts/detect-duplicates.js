const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const CONTENT_DIR = path.join(__dirname, '..', 'content');
const USERS = ['daiyihang', 'zhusiyu'];
const TYPES = ['flashcard', 'practice', 'decoder'];

function sortObjectKeys(obj) {
    if (obj === null || typeof obj !== 'object') {
        return obj;
    }
    if (Array.isArray(obj)) {
        return obj.map(sortObjectKeys);
    }
    const sortedKeys = Object.keys(obj).sort();
    const result = {};
    sortedKeys.forEach(key => {
        result[key] = sortObjectKeys(obj[key]);
    });
    return result;
}

function getFileHashAndContent(filePath) {
    try {
        if (!fs.existsSync(filePath)) {
            return { hash: null, error: 'notFound' };
        }
        const rawContent = fs.readFileSync(filePath, 'utf8');
        let parsed;
        try {
            parsed = JSON.parse(rawContent);
        } catch (e) {
            return { hash: null, error: 'parseError' };
        }

        const normalizedJson = JSON.stringify(sortObjectKeys(parsed));
        const hash = crypto.createHash('sha256').update(normalizedJson).digest('hex');
        return { hash, parsed, error: null };
    } catch (e) {
        return { hash: null, error: e.message };
    }
}

function getTopicsForUser(user, type) {
    const topicsFile = path.join(CONTENT_DIR, user, `${type}_topics.json`);
    if (!fs.existsSync(topicsFile)) return [];
    try {
        return JSON.parse(fs.readFileSync(topicsFile, 'utf8'));
    } catch (e) {
        return [];
    }
}

async function run() {
    console.log("Starting duplicate detection...");

    const candidates = [];
    const conflicts = [];
    let sameFileNameCount = 0;
    let sameContentCount = 0;
    let sameFileDifferentContentCount = 0;

    for (const type of TYPES) {
        const userFiles = {};

        // Collect all files for the specified type for each user
        for (const user of USERS) {
            userFiles[user] = {};
            const topics = getTopicsForUser(user, type);
            for (const topic of topics) {
                if (!topic.file) continue;
                const filePath = path.join(CONTENT_DIR, user, topic.file);
                const { hash, error } = getFileHashAndContent(filePath);

                userFiles[user][topic.file] = {
                    subject: topic.subject || 'unknown',
                    path: filePath,
                    hash,
                    error
                };
            }
        }

        // Compare User A and User B (daiyihang vs zhusiyu)
        const userA = USERS[0];
        const userB = USERS[1];

        const filesA = Object.keys(userFiles[userA]);
        const filesB = Object.keys(userFiles[userB]);

        // Find same file names
        const commonFiles = filesA.filter(f => filesB.includes(f));

        for (const fileName of commonFiles) {
            sameFileNameCount++;
            const fileA = userFiles[userA][fileName];
            const fileB = userFiles[userB][fileName];

            if (fileA.error || fileB.error) {
                // One or both files have errors (e.g., parseError)
                conflicts.push({
                    type,
                    fileName,
                    users: USERS,
                    sameFileName: true,
                    sameContent: false,
                    errorState: {
                        [userA]: fileA.error,
                        [userB]: fileB.error
                    },
                    recommendedAction: "manual_review_parse_error"
                });
                sameFileDifferentContentCount++;
            } else if (fileA.hash === fileB.hash) {
                sameContentCount++;
                candidates.push({
                    type,
                    subjectHint: fileA.subject,
                    fileName,
                    users: USERS,
                    paths: [fileA.path, fileB.path],
                    sameFileName: true,
                    sameContent: true,
                    contentHash: fileA.hash,
                    recommendedAction: "promote_to_shared_candidate"
                });
            } else {
                sameFileDifferentContentCount++;
                conflicts.push({
                    type,
                    fileName,
                    users: USERS,
                    sameFileName: true,
                    sameContent: false,
                    hashByUser: {
                        [userA]: fileA.hash,
                        [userB]: fileB.hash
                    },
                    recommendedAction: "manual_review_required"
                });
            }
        }
    }

    const reportDir = path.join(CONTENT_DIR, 'inbox', 'reports');
    if (!fs.existsSync(reportDir)) {
        fs.mkdirSync(reportDir, { recursive: true });
    }

    const report = {
        generatedAt: new Date().toISOString(),
        scope: USERS,
        summary: {
            sameFileNameCount,
            sameContentCount,
            sameFileDifferentContentCount
        },
        candidates,
        conflicts
    };

    const reportPath = path.join(reportDir, 'duplicate-candidates.json');
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));

    console.log(`Detection complete. Report saved to: ${reportPath}`);
    console.log(`- Common Files (Same Name): ${sameFileNameCount}`);
    console.log(`- Exact Match (Same Content): ${sameContentCount}`);
    console.log(`- Conflicts (Diff Content/Errors): ${sameFileDifferentContentCount}`);
}

run().catch(console.error);
