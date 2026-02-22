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
        this.writeJsonAtomic(path.join(userDir, 'topics.json'), []);
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

        let indexFile = 'topics.json';
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
        const filePath = path.join(this.contentDir, userId, safeName);

        if (!fs.existsSync(filePath)) {
            throw new Error('题库内容不存在');
        }

        return this.readJson(filePath);
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
        let indexName = 'topics.json';
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
}

module.exports = FileStore;
