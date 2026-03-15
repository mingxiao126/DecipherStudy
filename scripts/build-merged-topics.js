#!/usr/bin/env node
/**
 * 构建合并后的 topics 索引文件
 * 
 * 将每个学校下所有 subject 的 topics 合并为单个文件，减少 Netlify 静态模式下的 HTTP 请求数
 * 生成文件：/content/shared/{schoolId}/all_{type}_topics.json
 * 
 * 用法：node scripts/build-merged-topics.js
 */

const fs = require('fs');
const path = require('path');

const CONTENT_DIR = path.join(__dirname, '..', 'content');
const SHARED_DIR = path.join(CONTENT_DIR, 'shared');
const TOPIC_TYPES = ['flashcard', 'decoder', 'practice'];

function readJsonSafe(filePath) {
    try {
        return JSON.parse(fs.readFileSync(filePath, 'utf8'));
    } catch (e) {
        return null;
    }
}

function buildMergedTopics() {
    if (!fs.existsSync(SHARED_DIR)) {
        console.log('shared 目录不存在，跳过');
        return;
    }

    const schools = fs.readdirSync(SHARED_DIR).filter(name => {
        const full = path.join(SHARED_DIR, name);
        return fs.statSync(full).isDirectory() && name !== '.DS_Store';
    });

    let totalFiles = 0;

    for (const schoolId of schools) {
        const schoolDir = path.join(SHARED_DIR, schoolId);
        const schoolMeta = readJsonSafe(path.join(schoolDir, 'school.json'));

        // 获取所有 subject 目录
        const subjects = fs.readdirSync(schoolDir).filter(name => {
            const full = path.join(schoolDir, name);
            return fs.statSync(full).isDirectory() && name !== '.DS_Store';
        });

        for (const type of TOPIC_TYPES) {
            const indexFile = `${type}_topics.json`;
            const allTopics = [];

            for (const subjectId of subjects) {
                const topicPath = path.join(schoolDir, subjectId, indexFile);
                const topics = readJsonSafe(topicPath);

                if (Array.isArray(topics)) {
                    topics.forEach(t => {
                        if (t && t.file) {
                            // 确保每条记录都有 subject 字段
                            allTopics.push({
                                ...t,
                                subject: t.subject || subjectId
                            });
                        }
                    });
                }
            }

            // 写入合并文件
            const outPath = path.join(schoolDir, `all_${indexFile}`);
            fs.writeFileSync(outPath, JSON.stringify(allTopics, null, 2), 'utf8');
            console.log(`  ✅ ${schoolId}/all_${indexFile} (${allTopics.length} topics)`);
            totalFiles++;
        }
    }

    console.log(`\n完成：共生成 ${totalFiles} 个合并索引文件`);
}

buildMergedTopics();
