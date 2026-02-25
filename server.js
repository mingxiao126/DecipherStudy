#!/usr/bin/env node

const http = require('http');
const fs = require('fs');
const path = require('path');
const { normalizeDecoderProblems, validateDecoderProblem } = require('./js/core/decoder-schema.js');
const { auditProblems } = require('./js/core/qa-auditor.js');
const { normalizePracticeQuestions, validatePracticeQuestion } = require('./js/core/practice-schema.js');
const { auditQuestions: auditPracticeQuestions } = require('./js/core/practice-auditor.js');
const FileStore = require('./storage/file-store');

const HOST = '127.0.0.1';
const PORT = Number(process.env.PORT || 8000);
const ROOT = __dirname;
const CONTENT_DIR = path.join(ROOT, 'content');

const fileStore = new FileStore(CONTENT_DIR);

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8'
};

function sendJson(res, statusCode, body) {
  res.writeHead(statusCode, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body));
}

/**
 * 校验并解析工作区上下文
 * 1. 严格正则校验 ID 格式 (防止路径穿越)
 * 2. 验证工作区元数据及状态
 */
function resolveWorkspaceContext(userId) {
  if (!userId || typeof userId !== 'string') return null;

  // 仅允许字母、数字、下划线和连字符
  if (!/^[a-z0-9_-]+$/.test(userId)) {
    console.warn(`[Security] Blocked invalid userId pattern: ${userId}`);
    return null;
  }

  try {
    const metaPath = path.join(CONTENT_DIR, userId, 'meta.json');
    if (!fs.existsSync(metaPath)) return null;

    const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
    if (meta.status !== 'active' || meta.isSystem) {
      console.warn(`[Security] Blocked access to inactive/system workspace: ${userId}`);
      return null;
    }
    return meta;
  } catch (e) {
    return null;
  }
}

function sanitizePart(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5_-]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '') || 'untitled';
}

function normalizeSubject(subject) {
  const s = String(subject || '').toLowerCase();
  if (['economics', 'econ', '经济学', '经济'].includes(s)) return '经济学';
  if (['statistics', 'stat', '统计学', '统计'].includes(s)) return '统计学';
  return subject || '未分类';
}

function normalizeFlashcards(data) {
  if (Array.isArray(data)) return data;
  if (data && Array.isArray(data.cards)) return data.cards;
  return null;
}

function validateFlashcards(data) {
  const cards = normalizeFlashcards(data);
  if (!cards || cards.length === 0) {
    return { ok: false, errors: ['闪卡 JSON 必须是非空数组，或对象内包含非空 cards 数组。'] };
  }

  const errors = [];
  cards.forEach((card, index) => {
    const loc = `cards[${index}]`;
    if (!card || typeof card !== 'object') {
      errors.push(`${loc} 必须是对象。`);
      return;
    }
    if (typeof card.question !== 'string' || !card.question.trim()) {
      errors.push(`${loc}.question 必须是非空字符串。`);
    }
    const answerType = typeof card.answer;
    if (!(answerType === 'string' || (answerType === 'object' && card.answer !== null))) {
      errors.push(`${loc}.answer 必须是字符串或对象。`);
    }
  });

  return { ok: errors.length === 0, errors, normalized: cards };
}

function validateDecoders(data) {
  const problems = normalizeDecoderProblems(data);
  if (!Array.isArray(problems) || problems.length === 0) {
    return { ok: false, errors: ['难题 JSON 必须是非空题目数组（或可归一化为数组）。'] };
  }

  const schemaErrors = [];
  problems.forEach((problem, i) => {
    const result = validateDecoderProblem(problem);
    if (!result.valid) {
      schemaErrors.push(`第 ${i + 1} 题: ${result.errors.join('；')}`);
    }
  });

  if (schemaErrors.length > 0) {
    return { ok: false, errors: schemaErrors };
  }

  const audit = auditProblems(problems);
  if (!audit.overall_pass) {
    const qaErrors = (audit.issues || []).slice(0, 5).map(issue => `【${issue.rule_id}】${issue.description}`);
    return { ok: false, errors: qaErrors, audit };
  }

  return { ok: true, errors: [], normalized: problems, audit };
}

function validatePractices(data) {
  const questions = normalizePracticeQuestions(data);
  if (!Array.isArray(questions) || questions.length === 0) {
    return { ok: false, errors: ['考题 JSON 必须是非空题目数组。'] };
  }

  const schemaErrors = [];
  questions.forEach((q, i) => {
    const result = validatePracticeQuestion(q);
    if (!result.valid) {
      schemaErrors.push(`第 ${i + 1} 题: ${result.errors.join('；')}`);
    }
  });

  if (schemaErrors.length > 0) {
    return { ok: false, errors: schemaErrors };
  }

  const audit = auditPracticeQuestions(questions);
  if (!audit.overall_pass) {
    const qaErrors = (audit.issues || []).slice(0, 5).map(issue => `【${issue.rule_id}】${issue.description}`);
    return { ok: false, errors: qaErrors, audit };
  }

  return { ok: true, errors: [], normalized: questions, audit };
}

const LATEX_COMMANDS = [
  'frac',
  'sqrt',
  'sum',
  'hat',
  'sigma',
  'mu',
  'times',
  'approx',
  'cdot',
  'left',
  'right',
  'in',
  'le',
  'ge',
  'alpha',
  'beta',
  'gamma',
  'theta',
  'pi',
  'log',
  'ln',
  'bar',
  'text'
];

// Normalize LaTeX for both over-escape and under-escape cases.
// 1) "\\\\sqrt" -> "\\sqrt" (runtime single slash)
// 2) "\frac" parsed as form-feed+"rac" -> "\\frac"
// 3) "$rac{a}{b}$" -> "$\\frac{a}{b}$"
function normalizeLatexString(str) {
  if (typeof str !== 'string' || !str) return str;

  let out = str
    .replace(/\\{2,}([A-Za-z]+)/g, '\\$1')
    .replace(/\\{2,}([{}])/g, '\\$1')
    .replace(/\u000crac(?=\s*[{(])/g, '\\frac')
    .replace(/\u0008egin(?=\s*[{(])/g, '\\begin')
    .replace(/\u0009ext(?=\s*[{(])/g, '\\text');

  const cmdPattern = LATEX_COMMANDS.join('|');
  const restoreInMath = (content) => content
    .replace(/(^|[^\\A-Za-z])rac(?=\s*[{(])/g, '$1\\frac')
    .replace(new RegExp(`(^|[^\\\\A-Za-z])(${cmdPattern})(?=\\s*[{(])`, 'g'), '$1\\$2')
    .replace(new RegExp(`(^|[^\\\\A-Za-z])(left|right)(?=\\s*[|()[\\]{}])`, 'g'), '$1\\$2')
    .replace(new RegExp(`(^|[^\\\\A-Za-z])(times|cdot|approx|in|le|ge)(?=\\s|$|[0-9A-Za-z{}()\\[\\]])`, 'g'), '$1\\$2');

  out = out.replace(/\$[^$]*\$/g, (block) => `$${restoreInMath(block.slice(1, -1))}$`);
  out = out.replace(/\\\(([\s\S]*?)\\\)/g, (full, inner) => `\\(${restoreInMath(inner)}\\)`);
  out = out.replace(/\\\[([\s\S]*?)\\\]/g, (full, inner) => `\\[${restoreInMath(inner)}\\]`);

  return out;
}

function normalizeLatexPayload(value) {
  if (typeof value === 'string') return normalizeLatexString(value);
  if (Array.isArray(value)) return value.map(normalizeLatexPayload);
  if (value && typeof value === 'object') {
    const out = {};
    Object.keys(value).forEach((k) => {
      out[k] = normalizeLatexPayload(value[k]);
    });
    return out;
  }
  return value;
}


function saveDatasetToContent(payload) {
  const type = payload.type;
  const subject = normalizeSubject(payload.subject);
  const name = String(payload.name || '').trim();
  const userId = String(payload.userId || '').trim();
  const data = normalizeLatexPayload(payload.data);

  // 1. 严格工作区校验
  const workspace = resolveWorkspaceContext(userId);
  if (!workspace) {
    return { ok: false, status: 403, errors: [`无效或已停用的工作区 ID: ${userId}`] };
  }

  // 1.5 将中文 subject 映射为英文稳定 ID（与共享库保持一致）
  let stableSubjectId = subject;
  if (workspace.schoolId) {
    try {
      const schoolPath = path.join(CONTENT_DIR, 'shared', workspace.schoolId, 'school.json');
      if (fs.existsSync(schoolPath)) {
        const schoolMeta = JSON.parse(fs.readFileSync(schoolPath, 'utf8'));
        if (schoolMeta && Array.isArray(schoolMeta.subjects)) {
          const matched = schoolMeta.subjects.find(s =>
            s.id === subject || s.name === subject || s.label === subject
          );
          if (matched) stableSubjectId = matched.id;
        }
      }
    } catch (e) {
      console.warn(`[API] Subject ID resolve failed, using original: ${subject}`, e.message);
    }
  }
  if (!['flashcard', 'decoder', 'practice'].includes(type)) {
    return { ok: false, status: 400, errors: ['type 仅支持 flashcard, decoder 或 practice'] };
  }
  if (!name) {
    return { ok: false, status: 400, errors: ['name 必填'] };
  }

  const typePart = type === 'flashcard' ? 'flashcard' : (type === 'decoder' ? 'decoder' : 'practice');
  const subjectPart = sanitizePart(subject);
  const namePart = sanitizePart(name);
  const fileName = `${typePart}_${subjectPart}_${namePart}.json`;

  let validated;
  if (type === 'flashcard') {
    validated = validateFlashcards(data);
  } else if (type === 'decoder') {
    validated = validateDecoders(data);
  } else {
    validated = validatePractices(data);
  }

  if (!validated.ok) {
    return {
      ok: false,
      status: 422,
      errors: validated.errors,
      audit: validated.audit || null
    };
  }

  try {
    const displayName = `${subject} - ${name}`;
    fileStore.saveDataset(userId, {
      type,
      subject: stableSubjectId,
      name: displayName,
      data: validated.normalized,
      fileName
    });
    try {
      const schoolId = (workspace && workspace.schoolId) ? workspace.schoolId : 'unknown';
      const recordId = `inbox_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`;

      fileStore.appendInboxRecord({
        id: recordId,
        fileName: fileName,
        displayName: displayName,
        type: type,
        subject: stableSubjectId,
        userId: userId,
        schoolId: schoolId,
        createdAt: new Date().toISOString(),
        status: 'pending',
        sourceScopeHint: 'user',
        originalInputMode: payload.inputSource || 'unknown'
      });
    } catch (metaErr) {
      console.warn(`[API] 写入 inbox 元数据失败: ${metaErr.message}`);
    }
    return {
      ok: true,
      status: 200,
      saved: {
        fileName,
        type,
        subject,
        name,
        displayName,
        userId
      },
      audit: validated.audit || null
    };
  } catch (error) {
    return { ok: false, status: 500, errors: [error.message] };
  }
}

function parseRequestBody(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', chunk => {
      raw += chunk;
      if (raw.length > 10 * 1024 * 1024) {
        reject(new Error('请求体过大（>10MB）'));
        req.destroy();
      }
    });
    req.on('end', () => {
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch (err) {
        reject(new Error(`JSON 解析失败: ${err.message}`));
      }
    });
    req.on('error', reject);
  });
}

function resolveStaticPath(urlPath) {
  let pathname = decodeURIComponent(urlPath.split('?')[0]);
  if (pathname === '/') pathname = '/index.html';

  const absPath = path.normalize(path.join(ROOT, pathname));
  if (!absPath.startsWith(ROOT)) return null;
  return absPath;
}

function handleStatic(req, res) {
  const absPath = resolveStaticPath(req.url || '/');

  // 安全限制：禁止直接通过静态服务读 content 目录
  if (!absPath || absPath.startsWith(CONTENT_DIR)) {
    console.warn(`[Security] Blocked direct static access to content: ${req.url}`);
    res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Forbidden: 请使用 API 访问题库数据');
    return;
  }

  fs.stat(absPath, (err, stat) => {
    if (err || !stat.isFile()) {
      res.writeHead(404);
      res.end('Not Found');
      return;
    }

    const ext = path.extname(absPath).toLowerCase();
    res.writeHead(200, { 'Content-Type': MIME_TYPES[ext] || 'application/octet-stream' });
    fs.createReadStream(absPath).pipe(res);
  });
}

const server = http.createServer(async (req, res) => {
  if (!req.url) {
    res.writeHead(400);
    res.end('Bad Request');
    return;
  }

  // Health check
  if (req.method === 'GET' && req.url === '/api/health') {
    sendJson(res, 200, { ok: true, now: new Date().toISOString() });
    return;
  }

  // 1. List Users (Workspaces)
  if (req.method === 'GET' && req.url === '/api/users') {
    try {
      const users = fileStore.listUsers();
      sendJson(res, 200, users);
    } catch (e) {
      sendJson(res, 500, { ok: false, errors: ['无法读取用户列表'] });
    }
    return;
  }

  // 2. Create User (Workspace)
  if (req.method === 'POST' && req.url === '/api/create-user') {
    try {
      const { id, name } = await parseRequestBody(req);
      if (!id || !name) {
        sendJson(res, 400, { ok: false, errors: ['id 和 name 必填'] });
        return;
      }
      const userId = sanitizePart(id);
      const meta = fileStore.createWorkspace(userId, name);
      sendJson(res, 200, { ok: true, user: meta });
    } catch (error) {
      sendJson(res, 400, { ok: false, errors: [error.message] });
    }
    return;
  }

  // 2.5 Get User Context (Phase 3)
  if (req.method === 'GET' && req.url.startsWith('/api/users/') && req.url.endsWith('/context')) {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const parts = url.pathname.split('/');
    const userId = parts[3]; // /api/users/:userId/context

    if (!userId || !/^[a-z0-9_-]+$/.test(userId)) {
      sendJson(res, 400, { ok: false, errors: ['缺少用户 ID 或格式不合法'] });
      return;
    }

    try {
      const context = fileStore.getUserContext(userId);
      sendJson(res, 200, context);
    } catch (error) {
      // Return 404 for missing user/school, 400 for bad meta, 500 for parsing errors
      const status = error.status || 500;
      sendJson(res, status, { ok: false, errors: [error.message] });
    }
    return;
  }

  // 3. Workspace APIs
  if (req.method === 'GET' && req.url.startsWith('/api/workspaces/')) {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const pathname = url.pathname;
    const parts = pathname.split('/');
    // /api/workspaces/:userId/topics OR /api/workspaces/:userId/datasets/:fileName
    const userId = parts[3];
    const action = parts[4];

    // 严格解析并校验工作区上下文
    const workspace = resolveWorkspaceContext(userId);
    if (!workspace) {
      console.warn(`[API] Blocked request to unauthorized/invalid workspace: ${userId}`);
      sendJson(res, 403, { ok: false, errors: ['无权访问或工作区不存在'] });
      return;
    }

    console.log(`[API] Authorized Workspace Request: ${userId} -> ${action}`);

    if (action === 'topics') {
      const type = url.searchParams.get('type') || 'flashcard';

      // 严格校验题库类型
      if (!['flashcard', 'decoder', 'practice'].includes(type)) {
        console.warn(`[API] Invalid topic type requested: ${type}`);
        sendJson(res, 400, { ok: false, errors: [`不合法的题库类型 type: ${type}`] });
        return;
      }

      try {
        const meta = fileStore.listDatasetMeta(userId, type);
        sendJson(res, 200, meta);
      } catch (e) {
        sendJson(res, 404, { ok: false, errors: [e.message] });
      }
      return;
    }

    if (action === 'practice-topics-merged') {
      try {
        const mergedTopics = fileStore.getMergedPracticeTopics(userId);
        sendJson(res, 200, mergedTopics);
      } catch (e) {
        const status = e.status || 500;
        sendJson(res, status, { ok: false, errors: [e.message] });
      }
      return;
    }

    if (action === 'flashcard-topics-merged') {
      try {
        const mergedTopics = fileStore.getMergedFlashcardTopics(userId);
        sendJson(res, 200, mergedTopics);
      } catch (e) {
        const status = e.status || 500;
        sendJson(res, status, { ok: false, errors: [e.message] });
      }
      return;
    }

    if (action === 'decoder-topics-merged') {
      try {
        const mergedTopics = fileStore.getMergedDecoderTopics(userId);
        sendJson(res, 200, mergedTopics);
      } catch (e) {
        const status = e.status || 500;
        sendJson(res, status, { ok: false, errors: [e.message] });
      }
      return;
    }

    if (action === 'datasets') {
      const fileName = decodeURIComponent(parts[5] || '');
      // 安全补丁：支持中文、空格、短横线、下划线及各种括号，并强制 .json 后缀
      const pattern = /^[a-zA-Z0-9\u4e00-\u9fa5\s_\-\(\)（）\[\]【】\.]+\.json$/;
      const isValid = pattern.test(fileName);

      if (!isValid) {
        console.warn(`[API] Dataset Regex Failure: "${fileName}" for pattern ${pattern}`);
        sendJson(res, 400, { ok: false, errors: [`不合法的文件名格式: ${fileName}`] });
        return;
      }
      try {
        const content = fileStore.getDatasetContent(userId, fileName);
        if (content === null) {
          console.warn(`[API] Dataset found but content is NULL (invalid JSON): fileName="${fileName}"`);
          sendJson(res, 500, { ok: false, errors: ['数据读取失败 (内容为空或 JSON 格式错误)'] });
          return;
        }
        sendJson(res, 200, content);
      } catch (e) {
        console.error(`[API] Dataset Load Exception: "${fileName}"`, e);
        sendJson(res, 404, { ok: false, errors: [e.message] });
      }
      return;
    }

    console.warn(`[API] Unmatched workspace action: ${action} for URL: ${req.url}`);
  }

  // 5. Inbox Management API (Phase 9A, 9B, 9C)
  const reqUrlObj = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = reqUrlObj.pathname;

  if (pathname.startsWith('/api/inbox')) {
    const reqUser = reqUrlObj.searchParams.get('user');

    // A2: Lightweight access control
    if (!reqUser) {
      sendJson(res, 400, { ok: false, errors: ['需要提供 ?user= 参数以验证权限'] });
      return;
    }
    const workspace = resolveWorkspaceContext(reqUser);
    if (!workspace) {
      sendJson(res, 403, { ok: false, errors: ['无权访问或用户已停用'] });
      return;
    }

    // GET /api/inbox
    if (req.method === 'GET' && pathname === '/api/inbox') {
      try {
        const records = fileStore.getInboxRecords();
        sendJson(res, 200, records);
      } catch (e) {
        sendJson(res, 500, { ok: false, errors: [e.message] });
      }
      return;
    }

    // POST /api/inbox/:id/move-to-user (Phase 9C)
    const moveMatch = pathname.match(/^\/api\/inbox\/([^/]+)\/move-to-user$/);
    if (req.method === 'POST' && moveMatch) {
      const recordId = moveMatch[1];
      try {
        const records = fileStore.getInboxRecords();
        const recordIndex = records.findIndex(r => r.id === recordId);
        if (recordIndex === -1) {
          sendJson(res, 404, { ok: false, errors: ['找不到该 Inbox 记录'] });
          return;
        }

        const record = records[recordIndex];
        if (record.status !== 'pending') {
          sendJson(res, 400, { ok: false, errors: ['仅支持对 pending 状态的记录执行此操作'] });
          return;
        }

        // Phase 9C.1: Validate ownership
        if (reqUser !== record.userId) {
          sendJson(res, 403, { ok: false, errors: ['只能处理本人上传记录'] });
          return;
        }

        // Phase 9C.1: Validate file existence
        try {
          fileStore.getDatasetContent(record.userId, record.fileName);
        } catch (err) {
          sendJson(res, 404, { ok: false, errors: ['原始文件读取失败或已丢失，无法完成转移'] });
          return;
        }

        // B2: 记录状态流转
        record.status = 'moved_to_user';
        record.movedAt = new Date().toISOString();
        record.movedTarget = `user:${record.userId}`;

        // 保存更新后的 inbox index
        const inboxDir = path.join(fileStore.contentDir, 'inbox');
        const indexPath = path.join(inboxDir, 'index.json');
        fileStore.writeJsonAtomic(indexPath, records);

        sendJson(res, 200, { ok: true, record: record });
      } catch (e) {
        sendJson(res, 500, { ok: false, errors: [e.message] });
      }
      return;
    }

    // POST /api/inbox/:id/move-to-shared (Phase 9D)
    const shareMatch = pathname.match(/^\/api\/inbox\/([^/]+)\/move-to-shared$/);
    if (req.method === 'POST' && shareMatch) {
      const recordId = shareMatch[1];
      try {
        const records = fileStore.getInboxRecords();
        const recordIndex = records.findIndex(r => r.id === recordId);
        if (recordIndex === -1) {
          sendJson(res, 404, { ok: false, errors: ['找不到该 Inbox 记录'] });
          return;
        }

        const record = records[recordIndex];
        if (record.status !== 'pending') {
          sendJson(res, 400, { ok: false, errors: ['仅支持对 pending 状态的记录执行此操作'] });
          return;
        }

        // Phase 9D: Validate ownership
        if (reqUser !== record.userId) {
          sendJson(res, 403, { ok: false, errors: ['只能将本人上传的记录发布至共享库'] });
          return;
        }

        // Phase 9D: Validate essential fields
        if (!record.userId || !record.schoolId || !record.subject || !record.type || !record.fileName) {
          sendJson(res, 422, { ok: false, errors: ['记录缺少发布共享所需的关键字段'] });
          return;
        }

        // Phase 9D.1: Subject Normalization
        const schoolPath = path.join(fileStore.contentDir, 'shared', record.schoolId, 'school.json');
        let normalizedSubjectId = null;
        try {
          let schoolMeta = null;
          if (fs.existsSync(schoolPath)) {
            schoolMeta = fileStore.readJson(schoolPath);
          }
          if (schoolMeta && Array.isArray(schoolMeta.subjects)) {
            const matched = schoolMeta.subjects.find(s =>
              s.id === record.subject ||
              s.name === record.subject ||
              s.label === record.subject
            );
            if (matched) {
              normalizedSubjectId = matched.id;
            }
          }
        } catch (e) {
          console.error("Subject normalization err:", e);
        }

        if (!normalizedSubjectId) {
          sendJson(res, 422, { ok: false, errors: ['记录 subject 无法映射到学校课程配置'] });
          return;
        }

        // Update record state with canonical subjectId for correct downstream pathing
        record.subject = normalizedSubjectId;

        // Phase 9D: Validate file existence & read content
        let content;
        try {
          content = fileStore.getDatasetContent(record.userId, record.fileName);
        } catch (err) {
          sendJson(res, 404, { ok: false, errors: ['原始文件读取失败或已丢失，无法发布共享'] });
          return;
        }

        // B4: Publish to shared index and directory
        fileStore.publishToShared(record, content);

        // B5: Inbox state transition
        record.status = 'moved_to_shared';
        record.movedAt = new Date().toISOString();
        record.movedTarget = `shared:${record.schoolId}/${record.subject}`;

        // 保存更新后的 inbox index
        const inboxDir = path.join(fileStore.contentDir, 'inbox');
        const indexPath = path.join(inboxDir, 'index.json');
        fileStore.writeJsonAtomic(indexPath, records);

        sendJson(res, 200, { ok: true, record: record });
      } catch (e) {
        sendJson(res, 500, { ok: false, errors: [e.message] });
      }
      return;
    }

    // POST /api/inbox/:id/reject (Phase 9E)
    const rejectMatch = pathname.match(/^\/api\/inbox\/([^/]+)\/reject$/);
    if (req.method === 'POST' && rejectMatch) {
      const recordId = rejectMatch[1];
      try {
        const records = fileStore.getInboxRecords();
        const recordIndex = records.findIndex(r => r.id === recordId);
        if (recordIndex === -1) {
          sendJson(res, 404, { ok: false, errors: ['找不到该 Inbox 记录'] });
          return;
        }

        const record = records[recordIndex];
        if (record.status !== 'pending') {
          sendJson(res, 400, { ok: false, errors: ['仅支持对 pending 状态的记录执行此操作'] });
          return;
        }

        // Phase 9E: Validate ownership
        if (reqUser !== record.userId) {
          sendJson(res, 403, { ok: false, errors: ['只能驳回本人上传的记录'] });
          return;
        }

        // State transition
        record.status = 'rejected';
        record.rejectedAt = new Date().toISOString();
        record.rejectedBy = reqUser;

        // 保存更新后的 inbox index
        const inboxDir = path.join(fileStore.contentDir, 'inbox');
        const indexPath = path.join(inboxDir, 'index.json');
        fileStore.writeJsonAtomic(indexPath, records);

        sendJson(res, 200, { ok: true, record: record });
      } catch (e) {
        sendJson(res, 500, { ok: false, errors: [e.message] });
      }
      return;
    }

    // GET /api/inbox/:id
    const detailMatch = pathname.match(/^\/api\/inbox\/([^/]+)$/);
    if (req.method === 'GET' && detailMatch) {
      const recordId = detailMatch[1];
      try {
        const records = fileStore.getInboxRecords();
        const record = records.find(r => r.id === recordId);
        if (!record) {
          sendJson(res, 404, { ok: false, errors: ['找不到该 Inbox 记录'] });
          return;
        }

        // Phase 9D.1: 限制只有本人可以查看详情
        if (reqUser !== record.userId) {
          sendJson(res, 403, { ok: false, errors: ['只能查看本人上传的记录详情'] });
          return;
        }

        // Read actual file content
        const userId = record.userId;
        const fileName = record.fileName;
        try {
          const content = fileStore.getDatasetContent(userId, fileName);
          sendJson(res, 200, { record: record, data: content });
        } catch (err) {
          sendJson(res, 404, { ok: false, errors: [`原始文件读取失败或已丢失: ${err.message}`] });
        }
      } catch (e) {
        sendJson(res, 500, { ok: false, errors: [e.message] });
      }
      return;
    }
    // POST /api/inbox/:id/assign (Phase 11A)
    const assignMatch = pathname.match(/^\/api\/inbox\/([^/]+)\/assign$/);
    if (req.method === 'POST' && assignMatch) {
      const recordId = assignMatch[1];
      try {
        const payload = await parseRequestBody(req);
        const { targetScope, targetSchoolId, targetUserId, targetSubjectId, createSubjectIfMissing } = payload;

        // B1 & B2: Basic record and status check
        const records = fileStore.getInboxRecords();
        const recordIndex = records.findIndex(r => r.id === recordId);
        if (recordIndex === -1) {
          sendJson(res, 404, { ok: false, errors: ['找不到该 Inbox 记录'] });
          return;
        }
        const record = records[recordIndex];
        if (record.status !== 'pending') {
          sendJson(res, 400, { ok: false, errors: ['仅支持对 pending 状态的记录执行此操作'] });
          return;
        }

        // B1: Authorization check (for now, only allow owner)
        if (reqUser !== record.userId) {
          sendJson(res, 403, { ok: false, errors: ['只能处理本人上传的记录'] });
          return;
        }

        // B4: targetSubjectId validation
        if (!targetSubjectId || !/^[a-z0-9_-]+$/.test(targetSubjectId)) {
          sendJson(res, 400, { ok: false, errors: ['targetSubjectId 必填且必须为英文稳定 ID（a-z, 0-9, _, -）'] });
          return;
        }

        // B3: Scope exclusivity check
        if (!targetScope || !['shared', 'user'].includes(targetScope)) {
          sendJson(res, 400, { ok: false, errors: ['targetScope 必须为 shared 或 user'] });
          return;
        }

        if (targetScope === 'shared') {
          if (!targetSchoolId || targetUserId) {
            sendJson(res, 400, { ok: false, errors: ['分配到共享库时，必须提供 targetSchoolId 且不得提供 targetUserId'] });
            return;
          }

          // C2: shared path logic
          const schoolPath = path.join(fileStore.contentDir, 'shared', targetSchoolId, 'school.json');
          if (!fs.existsSync(schoolPath)) {
            sendJson(res, 404, { ok: false, errors: [`学校 ${targetSchoolId} 的配置未找到`] });
            return;
          }

          if (createSubjectIfMissing === true) {
            try {
              fileStore.ensureSchoolSubject(targetSchoolId, targetSubjectId);
            } catch (e) {
              sendJson(res, 400, { ok: false, errors: [`自动创建学校专业失败: ${e.message}`] });
              return;
            }
          } else {
            const schoolMeta = fileStore.readJson(schoolPath);
            const subjectExists = schoolMeta && Array.isArray(schoolMeta.subjects) && schoolMeta.subjects.some(s => s.id === targetSubjectId);
            if (!subjectExists) {
              sendJson(res, 422, { ok: false, errors: [`科目 ID ${targetSubjectId} 在学校 ${targetSchoolId} 中不存在，如需自动创建请开启 createSubjectIfMissing`] });
              return;
            }
          }

          // Read source file
          let content;
          try {
            content = fileStore.getDatasetContent(record.userId, record.fileName);
          } catch (err) {
            sendJson(res, 404, { ok: false, errors: ['原始文件读取失败或已丢失，无法完成分配'] });
            return;
          }

          // Overwrite record metadata with target values before publishing
          record.schoolId = targetSchoolId;
          record.subject = targetSubjectId;

          // Publish
          fileStore.publishToShared(record, content);

          // Update record status
          record.status = 'moved_to_shared';
          record.movedAt = new Date().toISOString();
          record.movedTarget = `shared:${targetSchoolId}/${targetSubjectId}`;
          record.assignedAt = record.movedAt;
          record.assignedBy = reqUser;

        } else {
          // targetScope === 'user'
          if (!targetUserId || targetSchoolId) {
            sendJson(res, 400, { ok: false, errors: ['分配到个人库时，必须提供 targetUserId 且不得提供 targetSchoolId'] });
            return;
          }
          if (targetUserId !== record.userId) {
            sendJson(res, 403, { ok: false, errors: ['本阶段仅支持分配给自己'] });
            return;
          }

          if (createSubjectIfMissing === true) {
            try {
              fileStore.ensureUserSubject(targetUserId, targetSubjectId);
            } catch (e) {
              sendJson(res, 400, { ok: false, errors: [`自动启用用户专业失败: ${e.message}`] });
              return;
            }
          }

          // Verify file existence
          try {
            fileStore.getDatasetContent(record.userId, record.fileName);
          } catch (err) {
            sendJson(res, 404, { ok: false, errors: ['原始文件读取失败或已丢失，无法完成分配'] });
            return;
          }

          // Note: targetSubjectId is stored in metadata but physical directory change is out of scope for now
          record.status = 'moved_to_user';
          record.movedAt = new Date().toISOString();
          record.movedTarget = `user:${targetUserId}`;
          record.assignedAt = record.movedAt;
          record.assignedBy = reqUser;
          record.subject = targetSubjectId; // record the choice
        }

        // Finalize index write
        const inboxDir = path.join(fileStore.contentDir, 'inbox');
        const indexPath = path.join(inboxDir, 'index.json');
        fileStore.writeJsonAtomic(indexPath, records);

        sendJson(res, 200, {
          ok: true,
          action: "assign",
          target: {
            scope: targetScope,
            owner: targetScope === 'shared' ? targetSchoolId : targetUserId,
            subjectId: targetSubjectId
          },
          recordStatus: record.status
        });

      } catch (e) {
        sendJson(res, e.status || 500, { ok: false, errors: [e.message] });
      }
      return;
    }

    // Default 404 for unhandled /api/inbox routes
    sendJson(res, 404, { ok: false, errors: ['Inbox 路由未找到'] });
    return;
  }

  // 6. Upload Dataset
  if (req.method === 'POST' && req.url === '/api/upload-dataset') {
    try {
      const body = await parseRequestBody(req);
      const result = saveDatasetToContent(body);
      if (!result.ok) {
        sendJson(res, result.status || 400, {
          ok: false,
          errors: result.errors || ['保存失败'],
          audit: result.audit || null
        });
        return;
      }

      sendJson(res, 200, {
        ok: true,
        saved: result.saved,
        audit: result.audit || null
      });
    } catch (error) {
      sendJson(res, 400, { ok: false, errors: [error.message] });
    }
    return;
  }

  handleStatic(req, res);
});

server.listen(PORT, HOST, () => {
  console.log(`DecipherStudy disk-mode server running at http://${HOST}:${PORT}`);
  console.log(`Serving root: ${ROOT}`);
});
