#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { auditProblems } = require('../qa-auditor.js');
const { normalizeDecoderProblems } = require('../decoder-schema.js');

function usage() {
  console.error('Usage: node scripts/audit-decoder-json.js <path-to-json>');
}

function main() {
  const target = process.argv[2];
  if (!target) {
    usage();
    process.exit(1);
  }

  const fullPath = path.resolve(process.cwd(), target);
  if (!fs.existsSync(fullPath)) {
    console.error(`File not found: ${fullPath}`);
    process.exit(1);
  }

  let raw;
  try {
    raw = JSON.parse(fs.readFileSync(fullPath, 'utf8'));
  } catch (error) {
    console.error(JSON.stringify({
      overall_pass: false,
      protocol_score: 0,
      teaching_score: 0,
      issues: [{
        severity: 'Blocker',
        module: 'json_safety',
        rule_id: 'QA_JSON_001',
        location: 'input',
        description: `JSON parse failed: ${error.message}`,
        fix_suggestion: '修复 JSON 语法后重试。'
      }],
      improvement_suggestions: ['先通过 JSON 语法检查。']
    }, null, 2));
    process.exit(1);
  }

  const normalized = normalizeDecoderProblems(raw);
  const report = auditProblems(normalized);
  console.log(JSON.stringify(report, null, 2));

  if (!report.overall_pass) {
    process.exit(1);
  }
}

main();
