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
    const displayName = `[自定义] ${subject} - ${name}`;
    fileStore.saveDataset(userId, {
      type,
      subject,
      name: displayName,
      data: validated.normalized,
      fileName
    });

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

  // 3. Workspace APIs
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

    if (action === 'datasets') {
      const fileName = decodeURIComponent(parts[5] || '');
      // 安全补丁：放宽正则以支持中文、短横线、下划线及圆括号，并强制 .json 后缀
      if (!/^[a-zA-Z0-9\u4e00-\u9fa5_\-()（）]+\.json$/.test(fileName)) {
        sendJson(res, 400, { ok: false, errors: ['不合法的文件名格式'] });
        return;
      }
      try {
        const content = fileStore.getDatasetContent(userId, fileName);
        sendJson(res, 200, content);
      } catch (e) {
        sendJson(res, 404, { ok: false, errors: [e.message] });
      }
      return;
    }

    console.warn(`[API] Unmatched workspace action: ${action} for URL: ${req.url}`);
  }

  // 5. Upload Dataset
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
