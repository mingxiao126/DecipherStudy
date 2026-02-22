#!/usr/bin/env node

const http = require('http');
const fs = require('fs');
const path = require('path');
const { normalizeDecoderProblems, validateDecoderProblem } = require('./js/core/decoder-schema.js');
const { auditProblems } = require('./js/core/qa-auditor.js');
const { normalizePracticeQuestions, validatePracticeQuestion } = require('./js/core/practice-schema.js');
const { auditQuestions: auditPracticeQuestions } = require('./js/core/practice-auditor.js');

const HOST = '127.0.0.1';
const PORT = Number(process.env.PORT || 8000);
const ROOT = __dirname;
const CONTENT_DIR = path.join(ROOT, 'content');

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

function readJsonFile(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function writeJsonFile(filePath, data) {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
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

function updateTopicsFile(fileName, displayName) {
  const topicsPath = path.join(CONTENT_DIR, 'topics.json');
  const topics = readJsonFile(topicsPath);
  const next = Array.isArray(topics) ? topics : [];

  const index = next.findIndex(item => item && item.file === fileName);
  const entry = { name: displayName, file: fileName };

  if (index >= 0) {
    next[index] = entry;
  } else {
    next.push(entry);
  }

  writeJsonFile(topicsPath, next);
}

function updateDecoderTopicsFile(fileName, subject, displayName) {
  const decoderTopicsPath = path.join(CONTENT_DIR, 'decoder_topics.json');
  const topics = readJsonFile(decoderTopicsPath);
  const next = Array.isArray(topics) ? topics : [];

  const index = next.findIndex(item => item && item.file === fileName);
  const entry = { subject, name: displayName, file: fileName };

  if (index >= 0) {
    next[index] = entry;
  } else {
    next.push(entry);
  }

  writeJsonFile(decoderTopicsPath, next);
}

function updatePracticeTopicsFile(fileName, displayName) {
  const practiceTopicsPath = path.join(CONTENT_DIR, 'practice_topics.json');
  const topics = readJsonFile(practiceTopicsPath);
  const next = Array.isArray(topics) ? topics : [];

  const index = next.findIndex(item => item && item.file === fileName);
  const entry = { name: displayName, file: fileName };

  if (index >= 0) {
    next[index] = entry;
  } else {
    next.push(entry);
  }

  writeJsonFile(practiceTopicsPath, next);
}

function saveDatasetToContent(payload) {
  const type = payload.type;
  const subject = normalizeSubject(payload.subject);
  const name = String(payload.name || '').trim();
  const data = normalizeLatexPayload(payload.data);

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
  const filePath = path.join(CONTENT_DIR, fileName);

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

  writeJsonFile(filePath, validated.normalized);

  const displayName = `[自定义] ${subject} - ${name}`;
  if (type === 'flashcard') {
    updateTopicsFile(fileName, displayName);
  } else if (type === 'decoder') {
    updateDecoderTopicsFile(fileName, subject, displayName);
  } else {
    updatePracticeTopicsFile(fileName, displayName);
  }

  return {
    ok: true,
    status: 200,
    saved: {
      fileName,
      filePath,
      type,
      subject,
      name,
      displayName
    },
    audit: validated.audit || null
  };
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
  if (!absPath) {
    res.writeHead(403);
    res.end('Forbidden');
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

  if (req.method === 'GET' && req.url.startsWith('/api/health')) {
    sendJson(res, 200, {
      ok: true,
      mode: 'disk',
      contentDir: CONTENT_DIR,
      now: new Date().toISOString()
    });
    return;
  }

  if (req.method === 'POST' && req.url.startsWith('/api/upload-dataset')) {
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
