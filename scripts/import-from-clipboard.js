#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { auditProblems } = require('../js/core/qa-auditor.js');
const { normalizeDecoderProblems } = require('../js/core/decoder-schema.js');

const PROJECT_ROOT = path.resolve(__dirname, '..');
const OUTPUT_DIR = path.join(PROJECT_ROOT, 'content', 'inbox');

function usage() {
  console.log('Usage: node scripts/import-from-clipboard.js <decoder|flashcard> <economics|statistics|econ|stat> <display_name> [--file <path>]');
  console.log('Example: node scripts/import-from-clipboard.js decoder economics econ_week4_q1');
  console.log('Example: node scripts/import-from-clipboard.js decoder economics econ_week4_q1 --file content/decoders_econ_w1.json');
}

function normalizeType(raw) {
  const value = String(raw || '').toLowerCase();
  if (value === 'decoder' || value === 'dec') return 'decoder';
  if (value === 'flashcard' || value === 'flash' || value === 'card') return 'flashcard';
  return null;
}

function normalizeSubject(raw) {
  const value = String(raw || '').toLowerCase();
  if (['economics', 'econ', '经济', '经济学'].includes(value)) return 'economics';
  if (['statistics', 'stat', '统计', '统计学'].includes(value)) return 'statistics';
  return value.replace(/\s+/g, '_') || 'general';
}

function sanitizeName(name) {
  const cleaned = String(name || 'untitled')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5_-]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '');
  return cleaned || 'untitled';
}

function readClipboard() {
  const commands = [
    ['pbpaste'],
    ['wl-paste', '-n'],
    ['xclip', '-selection', 'clipboard', '-o']
  ];

  for (const cmd of commands) {
    try {
      const text = execSync(cmd.join(' '), { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
      if (text && text.trim()) return text;
    } catch (_e) {
      // Try next clipboard command
    }
  }

  throw new Error('无法读取剪贴板。可改用 --file <path> 参数。');
}

function readInputText(fileArg) {
  if (fileArg) {
    const resolved = path.resolve(process.cwd(), fileArg);
    if (!fs.existsSync(resolved)) {
      throw new Error(`输入文件不存在: ${resolved}`);
    }
    return fs.readFileSync(resolved, 'utf8');
  }
  return readClipboard();
}

function validateFlashcards(data) {
  const cards = Array.isArray(data) ? data : (data && Array.isArray(data.cards) ? data.cards : null);
  const errors = [];

  if (!cards || cards.length === 0) {
    errors.push('闪卡 JSON 必须是非空数组，或对象内包含非空 cards 数组。');
    return { ok: false, errors };
  }

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
  const normalized = normalizeDecoderProblems(data);
  const report = auditProblems(normalized);
  return {
    ok: report.overall_pass,
    errors: report.issues.map(i => `【${i.rule_id}】${i.description}`),
    normalized,
    report
  };
}

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function parseOptionalFileArg(args) {
  const idx = args.indexOf('--file');
  if (idx === -1) return null;
  const value = args[idx + 1];
  if (!value) throw new Error('--file 后必须提供路径');
  return value;
}

function main() {
  const type = normalizeType(process.argv[2]);
  const subject = normalizeSubject(process.argv[3]);
  const displayNameRaw = process.argv[4];

  if (!type || !displayNameRaw) {
    usage();
    process.exit(1);
  }

  let sourceFile = null;
  try {
    sourceFile = parseOptionalFileArg(process.argv.slice(5));
  } catch (error) {
    console.error(`ERROR: ${error.message}`);
    process.exit(1);
  }

  const displayName = sanitizeName(displayNameRaw);
  const timestamp = new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14);

  let text;
  try {
    text = readInputText(sourceFile);
  } catch (error) {
    console.error(`ERROR: ${error.message}`);
    process.exit(1);
  }

  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    console.error(`ERROR: 输入内容不是合法 JSON: ${error.message}`);
    process.exit(1);
  }

  const validation = type === 'decoder' ? validateDecoders(parsed) : validateFlashcards(parsed);

  ensureDir(OUTPUT_DIR);
  const base = `${timestamp}_${type}_${subject}_${displayName}`;
  const jsonPath = path.join(OUTPUT_DIR, `${base}.json`);
  fs.writeFileSync(jsonPath, JSON.stringify(type === 'decoder' ? validation.normalized : parsed, null, 2));

  if (type === 'decoder') {
    const reportPath = path.join(OUTPUT_DIR, `${base}.qa-report.json`);
    fs.writeFileSync(reportPath, JSON.stringify(validation.report, null, 2));
    console.log(`QA report: ${reportPath}`);
  }

  if (!validation.ok) {
    console.error('FINAL VALIDATION: FAILED');
    console.error(`Saved JSON: ${jsonPath}`);
    validation.errors.slice(0, 5).forEach((e, i) => console.error(`${i + 1}. ${e}`));
    process.exit(1);
  }

  console.log('FINAL VALIDATION: PASSED');
  console.log(`Saved JSON: ${jsonPath}`);
  if (sourceFile) {
    console.log(`Source: ${path.resolve(process.cwd(), sourceFile)}`);
  } else {
    console.log('Source: clipboard');
  }
  console.log('Next: 在页面上传该 JSON 文件。');
}

main();
