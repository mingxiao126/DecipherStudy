#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const projectRoot = path.resolve(__dirname, '..');
const contentDir = path.join(projectRoot, 'content');
const decoderSchemaPath = path.join(projectRoot, 'js', 'core', 'decoder-schema.js');
const practiceSchemaPath = path.join(projectRoot, 'js', 'core', 'practice-schema.js');

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function fail(message) {
  console.error(`ERROR: ${message}`);
  process.exitCode = 1;
}

function validateFlashcards() {
  const topicsPath = path.join(contentDir, 'topics.json');
  const topics = readJson(topicsPath);

  if (!Array.isArray(topics)) {
    fail('content/topics.json must be an array.');
    return;
  }

  let cardCount = 0;

  topics.forEach((topic, topicIndex) => {
    const context = `topics[${topicIndex}]`;

    if (!topic || typeof topic !== 'object') {
      fail(`${context} must be an object.`);
      return;
    }

    if (!topic.name || typeof topic.name !== 'string') {
      fail(`${context}.name is required and must be a string.`);
    }

    if (!topic.file || typeof topic.file !== 'string') {
      fail(`${context}.file is required and must be a string.`);
      return;
    }

    // 跳过自定义题库（localStorage），不校验文件存在
    if (topic.file.startsWith('custom:')) return;

    const dataPath = path.join(contentDir, topic.file);
    if (!fs.existsSync(dataPath)) {
      fail(`${context}.file not found: ${topic.file}`);
      return;
    }

    const raw = readJson(dataPath);
    const cards = Array.isArray(raw) ? raw : (Array.isArray(raw.cards) ? raw.cards : null);

    if (!cards) {
      fail(`${topic.file} must be an array, or an object with a cards array.`);
      return;
    }

    cards.forEach((card, cardIndex) => {
      cardCount += 1;
      const cardCtx = `${topic.file}[${cardIndex}]`;

      if (!card || typeof card !== 'object') {
        fail(`${cardCtx} must be an object.`);
        return;
      }

      if (!card.question || typeof card.question !== 'string') {
        fail(`${cardCtx}.question is required and must be a string.`);
      }

      const answerType = typeof card.answer;
      const hasAnswerObject = answerType === 'object' && card.answer !== null;
      const hasAnswerString = answerType === 'string';

      if (!hasAnswerObject && !hasAnswerString) {
        fail(`${cardCtx}.answer must be a string or a non-null object.`);
      }
    });
  });

  return { topicCount: topics.length, cardCount };
}

function validateDecoders() {
  const decoderTopicsPath = path.join(contentDir, 'decoder_topics.json');
  const decoderTopics = readJson(decoderTopicsPath);

  if (!Array.isArray(decoderTopics)) {
    fail('content/decoder_topics.json must be an array.');
    return;
  }

  const schema = require(decoderSchemaPath);
  const validateDecoderProblem = schema.validateDecoderProblem;
  const normalizeDecoderProblems = schema.normalizeDecoderProblems;

  if (typeof validateDecoderProblem !== 'function' || typeof normalizeDecoderProblems !== 'function') {
    fail('decoder-schema.js must export validateDecoderProblem and normalizeDecoderProblems.');
    return;
  }

  let fileCount = 0;
  let problemCount = 0;

  decoderTopics.forEach((topic, topicIndex) => {
    const context = `decoder_topics[${topicIndex}]`;

    if (!topic || typeof topic !== 'object') {
      fail(`${context} must be an object.`);
      return;
    }

    if (!topic.file || typeof topic.file !== 'string') {
      fail(`${context}.file is required and must be a string.`);
      return;
    }

    // 跳过自定义题库（localStorage）
    if (topic.file.startsWith('custom:')) return;

    const dataPath = path.join(contentDir, topic.file);
    if (!fs.existsSync(dataPath)) {
      fail(`${context}.file not found: ${topic.file}`);
      return;
    }

    fileCount += 1;

    const raw = readJson(dataPath);
    const problems = normalizeDecoderProblems(raw);

    if (!Array.isArray(problems) || problems.length === 0) {
      fail(`${topic.file} did not normalize to a non-empty problem list.`);
      return;
    }

    problems.forEach((problem, problemIndex) => {
      problemCount += 1;
      const result = validateDecoderProblem(problem);
      if (!result.valid) {
        fail(`${topic.file}[${problemIndex}] schema errors: ${result.errors.join(' | ')}`);
      }
    });
  });

  return { fileCount, problemCount };
}

function validatePractices() {
  const practiceTopicsPath = path.join(contentDir, 'practice_topics.json');
  if (!fs.existsSync(practiceTopicsPath)) return { fileCount: 0, questionCount: 0 };

  const practiceTopics = readJson(practiceTopicsPath);
  if (!Array.isArray(practiceTopics)) {
    fail('content/practice_topics.json must be an array.');
    return;
  }

  const { normalizePracticeQuestions, validatePracticeQuestion } = require(practiceSchemaPath);

  let fileCount = 0;
  let questionCount = 0;

  practiceTopics.forEach((topic, topicIndex) => {
    const context = `practice_topics[${topicIndex}]`;
    if (!topic || typeof topic.file !== 'string') {
      fail(`${context}.file is required.`);
      return;
    }

    const dataPath = path.join(contentDir, topic.file);
    if (!fs.existsSync(dataPath)) {
      fail(`${context}.file not found: ${topic.file}`);
      return;
    }

    fileCount += 1;
    const raw = readJson(dataPath);
    const questions = normalizePracticeQuestions(raw);

    questions.forEach((q, qIndex) => {
      questionCount += 1;
      const res = validatePracticeQuestion(q);
      if (!res.valid) {
        fail(`${topic.file}[${qIndex}] schema errors: ${res.errors.join(' | ')}`);
      }
    });
  });

  return { fileCount, questionCount };
}

function main() {
  console.log('Running content validation...');

  const flashcard = validateFlashcards();
  const decoder = validateDecoders();
  const practice = validatePractices();

  if (process.exitCode && process.exitCode !== 0) {
    console.error('Validation finished with errors.');
    process.exit(process.exitCode);
  }

  console.log(`OK: flashcard topics=${flashcard.topicCount}, cards=${flashcard.cardCount}`);
  console.log(`OK: decoder files=${decoder.fileCount}, problems=${decoder.problemCount}`);
  console.log(`OK: practice files=${practice.fileCount}, questions=${practice.questionCount}`);
  console.log('All content checks passed.');
}

main();
