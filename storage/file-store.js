const fs = require('fs');
const path = require('path');

/**
 * FileStore: 抽象存储层 (文件实现)
 * 模拟数据库行为，为未来迁移提供一致的接口
 */
class FileStore {
    constructor(contentDir) {
        this.contentDir = contentDir;
        this.RESERVED_IDS = ['inbox', 'verified', 'tmp', 'system', 'catalog'];
    }

    /**
     * 原子写入 JSON 文件
     * 先写临时文件再重命名，避免写入中断导致损坏
     */
    writeJsonAtomic(filePath, data) {
        const tempPath = filePath + '.tmp';
        try {
            fs.writeFileSync(tempPath, JSON.stringify(data, null, 2), 'utf8');
            fs.renameSync(tempPath, filePath);
        } catch (error) {
            console.error(`Atomic write failed to ${filePath}:`, error);
            if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
            throw error;
        }
    }

    /**
     * 读取 JSON 文件，不存在返回 null
     */
    readJson(filePath) {
        if (!fs.existsSync(filePath)) return null;
        try {
            return JSON.parse(fs.readFileSync(filePath, 'utf8'));
        } catch (error) {
            console.error(`Read JSON failed from ${filePath}:`, error);
            return null;
        }
    }

    /**
     * 获取活跃用户列表
     */
    listUsers() {
        const usersPath = path.join(this.contentDir, 'users.json');
        const users = this.readJson(usersPath) || [];
        return users.filter(u => u.status === 'active' && !u.isSystem);
    }

    /**
     * 创建工作区
     * 初始化租户所需的所有元数据和索引文件
     */
    createWorkspace(id, name) {
        const userId = String(id || '').trim().toLowerCase();
        if (this.RESERVED_IDS.includes(userId)) {
            throw new Error('该 ID 为系统保留名称，不可使用');
        }

        const userDir = path.join(this.contentDir, userId);
        if (fs.existsSync(userDir)) {
            throw new Error('工作区 ID 已存在');
        }

        // 1. 创建物理目录
        fs.mkdirSync(userDir, { recursive: true });

        // 2. 初始化索引文件 (模拟建表)
        this.writeJsonAtomic(path.join(userDir, 'flashcard_topics.json'), []);
        this.writeJsonAtomic(path.join(userDir, 'decoder_topics.json'), []);
        this.writeJsonAtomic(path.join(userDir, 'practice_topics.json'), []);

        // 3. 构建用户元数据 (模拟 User/Workspace 表记录)
        const now = new Date().toISOString();
        const userMeta = {
            id: userId,
            displayName: name,
            status: 'active',
            createdAt: now,
            updatedAt: now,
            dataVersion: 'v1',
            isSystem: false
        };

        this.writeJsonAtomic(path.join(userDir, 'meta.json'), userMeta);

        // 4. 更新全局用户索引 (模拟 User 汇总表)
        const usersPath = path.join(this.contentDir, 'users.json');
        const users = this.readJson(usersPath) || [];
        // 检查是否已存在同 ID 记录（虽然物理目录不存在，但 users.json 可能残留）
        const filtered = users.filter(u => u.id !== userId);
        filtered.push(userMeta);
        this.writeJsonAtomic(usersPath, filtered);

        return userMeta;
    }

    /**
     * 获取当前工作区的题库列表 (Metadata)
     */
    listDatasetMeta(userId, type) {
        const userDir = path.join(this.contentDir, userId);
        if (!fs.existsSync(userDir)) return [];

        let indexFile = 'flashcard_topics.json';
        if (type === 'decoder') indexFile = 'decoder_topics.json';
        if (type === 'practice') indexFile = 'practice_topics.json';

        return this.readJson(path.join(userDir, indexFile)) || [];
    }

    /**
     * 获取题库具体内容 (Blob/Content)
     */
    getDatasetContent(userId, fileName) {
        // 安全校验：防止路径穿越
        const safeName = path.basename(fileName);
        let filePath = path.join(this.contentDir, userId, safeName);

        // 1. 优先从用户个人库读取
        if (fs.existsSync(filePath)) {
            return this.readJson(filePath);
        }

        // 2. 如果个人库没有，则尝试从共享库读取（针对在该工作区已授权的科目）
        try {
            const context = this.getUserContext(userId);
            const { schoolId } = context.user;
            const accessibleSubjects = context.accessibleSubjects;

            for (const subject of accessibleSubjects) {
                const sharedPath = path.join(this.contentDir, 'shared', schoolId, subject.id, safeName);
                if (fs.existsSync(sharedPath)) {
                    return this.readJson(sharedPath);
                }
            }
        } catch (e) {
            console.error(`[FileStore] Shared lookup failed for ${userId}:`, e.message);
        }

        throw new Error('题库内容不存在');
    }

    /**
     * 保存题库并更新索引 (Atomic Transaction Simulator)
     */
    saveDataset(userId, { type, subject, name, data, fileName }) {
        const userDir = path.join(this.contentDir, userId);
        if (!fs.existsSync(userDir)) {
            throw new Error('工作区不存在，无法保存');
        }

        // 1. 保存实体内容
        const targetPath = path.join(userDir, fileName);
        this.writeJsonAtomic(targetPath, data);

        // 2. 更新索引元数据
        let indexName = 'flashcard_topics.json';
        if (type === 'decoder') indexName = 'decoder_topics.json';
        if (type === 'practice') indexName = 'practice_topics.json';

        const indexPath = path.join(userDir, indexName);
        const index = this.readJson(indexPath) || [];

        const now = new Date().toISOString();
        const existingIdx = index.findIndex(t => t.file === fileName);

        if (existingIdx >= 0) {
            index[existingIdx] = {
                ...index[existingIdx],
                name: name,
                subject: subject,
                updatedAt: now
            };
        } else {
            index.push({
                id: `ds_${Date.now()}`,
                name: name,
                file: fileName,
                subject: subject,
                createdAt: now,
                updatedAt: now
            });
        }

        this.writeJsonAtomic(indexPath, index);
        return { fileName };
    }

    /**
     * 获取用户及其学校的合成上下文信息 (Phase 3)
     */
    getUserContext(userId) {
        if (!userId || !/^[a-z0-9_-]+$/.test(userId)) {
            const error = new Error('非法的用户 ID 格式');
            error.status = 400;
            throw error;
        }

        // 1. 获取用户元数据
        const userDir = path.join(this.contentDir, userId);
        const userMetaPath = path.join(userDir, 'meta.json');

        if (!fs.existsSync(userMetaPath)) {
            const error = new Error('用户不存在');
            error.status = 404;
            throw error;
        }

        const userMeta = this.readJson(userMetaPath);
        if (!userMeta || !userMeta.schoolId) {
            const error = new Error('用户元数据不完整或缺少 schoolId');
            error.status = 400;
            throw error;
        }

        if (userMeta.status !== 'active') {
            const error = new Error('用户状态非 active，拒绝访问');
            error.status = 403;
            throw error;
        }

        // 2. 获取对应的学校配置
        const schoolPath = path.join(this.contentDir, 'shared', userMeta.schoolId, 'school.json');
        if (!fs.existsSync(schoolPath)) {
            const error = new Error('学校配置不存在');
            error.status = 404;
            throw error;
        }

        const schoolMeta = this.readJson(schoolPath);
        if (!schoolMeta || !Array.isArray(schoolMeta.subjects)) {
            const error = new Error('学校配置格式错误');
            error.status = 500;
            throw error;
        }

        // 3. 计算可访问的科目交集 (按 subject id)
        const userEnabledSubjects = userMeta.enabledSubjects || [];
        const accessibleSubjects = schoolMeta.subjects.filter(s =>
            userEnabledSubjects.includes(s.id)
        );

        return {
            user: userMeta,
            school: schoolMeta,
            accessibleSubjects
        };
    }

    /**
     * 通用合并话题方法 — 消除三份重复逻辑
     * @param {string} userId
     * @param {string} topicType - 'flashcard' | 'decoder' | 'practice'
     */
    _getMergedTopics(userId, topicType) {
        const indexFileMap = {
            flashcard: 'flashcard_topics.json',
            decoder: 'decoder_topics.json',
            practice: 'practice_topics.json'
        };
        const indexFile = indexFileMap[topicType];
        if (!indexFile) throw new Error(`未知的 topic 类型: ${topicType}`);

        const context = this.getUserContext(userId);
        const { schoolId } = context.user;
        const accessibleSubjects = context.accessibleSubjects;

        const mergedMap = new Map();

        // 1. 先加载共享库（优先级低）
        for (const subject of accessibleSubjects) {
            const sharedTopicPath = path.join(this.contentDir, 'shared', schoolId, subject.id, indexFile);
            if (fs.existsSync(sharedTopicPath)) {
                const sharedTopics = this.readJson(sharedTopicPath);
                if (Array.isArray(sharedTopics)) {
                    sharedTopics.forEach(topic => {
                        if (topic && topic.file) {
                            mergedMap.set(topic.file, { ...topic, source_scope: 'shared' });
                        }
                    });
                }
            }
        }

        // 2. 再加载个人库（覆盖共享库，优先级高）
        const userTopicPath = path.join(this.contentDir, userId, indexFile);
        if (fs.existsSync(userTopicPath)) {
            const userTopics = this.readJson(userTopicPath);
            if (Array.isArray(userTopics)) {
                userTopics.forEach(topic => {
                    if (topic && topic.file) {
                        mergedMap.set(topic.file, { ...topic, source_scope: 'user' });
                    }
                });
            }
        }

        return Array.from(mergedMap.values());
    }

    /** 获取合并后的 Practice 题库列表 */
    getMergedPracticeTopics(userId) {
        return this._getMergedTopics(userId, 'practice');
    }

    /** 获取合并后的 Flashcard 题库列表 */
    getMergedFlashcardTopics(userId) {
        return this._getMergedTopics(userId, 'flashcard');
    }

    /** 获取合并后的 Decoder 题库列表 */
    getMergedDecoderTopics(userId) {
        return this._getMergedTopics(userId, 'decoder');
    }

    /**
     * 追加 inbox 元数据记录 (Phase 8B)
     */
    appendInboxRecord(record) {
        const inboxDir = path.join(this.contentDir, 'inbox');
        if (!fs.existsSync(inboxDir)) {
            fs.mkdirSync(inboxDir, { recursive: true });
        }

        const indexPath = path.join(inboxDir, 'index.json');
        let index = [];
        if (fs.existsSync(indexPath)) {
            try {
                index = JSON.parse(fs.readFileSync(indexPath, 'utf8'));
            } catch (e) {
                console.error("Failed to parse inbox index.json", e);
            }
        }

        index.push(record);
        this.writeJsonAtomic(indexPath, index);
    }

    /**
     * 获取 inbox 元数据记录 (Phase 9A)
     */
    getInboxRecords() {
        const inboxDir = path.join(this.contentDir, 'inbox');
        const indexPath = path.join(inboxDir, 'index.json');
        if (fs.existsSync(indexPath)) {
            try {
                return JSON.parse(fs.readFileSync(indexPath, 'utf8'));
            } catch (e) {
                console.error("Failed to parse inbox index.json", e);
                return [];
            }
        }
        return [];
    }

    /**
     * 发布记录到共享库 (Phase 9D)
     */
    publishToShared(record, data) {
        // 1. 组装共享库目录结构: shared/<schoolId>/<subject>
        const sharedDir = path.join(this.contentDir, 'shared', record.schoolId, record.subject);
        if (!fs.existsSync(sharedDir)) {
            fs.mkdirSync(sharedDir, { recursive: true });
        }

        // 2. 保存实体内容
        const targetPath = path.join(sharedDir, record.fileName);
        this.writeJsonAtomic(targetPath, data);

        // 3. 更新对应的索引文件
        let indexName = 'flashcard_topics.json';
        if (record.type === 'decoder') indexName = 'decoder_topics.json';
        if (record.type === 'practice') indexName = 'practice_topics.json';

        const indexPath = path.join(sharedDir, indexName);
        let index = [];
        if (fs.existsSync(indexPath)) {
            index = this.readJson(indexPath) || [];
        }

        const now = new Date().toISOString();
        const existingIdx = index.findIndex(t => t.file === record.fileName);

        // 兼容回退名
        const displayName = record.name || record.displayName || record.fileName;

        if (existingIdx >= 0) {
            index[existingIdx] = {
                ...index[existingIdx],
                name: displayName,
                subject: record.subject,
                updatedAt: now
            };
        } else {
            index.push({
                id: record.id || `ds_${Date.now()}`,
                name: displayName,
                file: record.fileName,
                subject: record.subject,
                createdAt: now
            });
        }

        this.writeJsonAtomic(indexPath, index);
    }

    /**
     * 确保学校配置中存在指定科目 (Phase 11C)
     */
    ensureSchoolSubject(schoolId, subjectId) {
        const schoolPath = path.join(this.contentDir, 'shared', schoolId, 'school.json');
        if (!fs.existsSync(schoolPath)) {
            throw new Error(`学校 ${schoolId} 配置文件不存在`);
        }

        const schoolMeta = this.readJson(schoolPath);
        if (!schoolMeta || !Array.isArray(schoolMeta.subjects)) {
            throw new Error(`学校 ${schoolId} 格式错误`);
        }

        const exists = schoolMeta.subjects.some(s => s.id === subjectId);
        if (!exists) {
            schoolMeta.subjects.push({
                id: subjectId,
                label: subjectId, // 默认 ID 作为 Label
                enabled: true
            });
            this.writeJsonAtomic(schoolPath, schoolMeta);
        }
    }

    /**
     * 确保用户启用科目列表中存在指定科目 (Phase 11C)
     */
    ensureUserSubject(userId, subjectId) {
        const userDir = path.join(this.contentDir, userId);
        const metaPath = path.join(userDir, 'meta.json');
        if (!fs.existsSync(metaPath)) {
            throw new Error('用户元数据不存在');
        }

        const userMeta = this.readJson(metaPath);
        if (!userMeta) throw new Error('读取用户元数据失败');

        if (!userMeta.enabledSubjects) {
            userMeta.enabledSubjects = [];
        }

        if (!userMeta.enabledSubjects.includes(subjectId)) {
            userMeta.enabledSubjects.push(subjectId);
            this.writeJsonAtomic(metaPath, userMeta);
        }
    }
}

module.exports = FileStore;
