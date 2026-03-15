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

function collectTopicIndexTargets(indexFileName) {
  const targets = [];

  const legacyPath = path.join(contentDir, indexFileName);
  if (fs.existsSync(legacyPath)) {
    targets.push({
      topicsPath: legacyPath,
      dataBaseDir: contentDir,
      scopeLabel: `legacy/${indexFileName}`
    });
  }

  // Workspace-scoped indexes: content/<userId>/<indexFileName>
  for (const entry of fs.readdirSync(contentDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    if (entry.name === 'shared') continue;

    const dirPath = path.join(contentDir, entry.name);
    const metaPath = path.join(dirPath, 'meta.json');
    const indexPath = path.join(dirPath, indexFileName);
    if (fs.existsSync(metaPath) && fs.existsSync(indexPath)) {
      targets.push({
        topicsPath: indexPath,
        dataBaseDir: dirPath,
        scopeLabel: `workspace/${entry.name}/${indexFileName}`
      });
    }
  }

  // Shared subject-scoped indexes: content/shared/<schoolId>/<subjectId>/<indexFileName>
  const sharedRoot = path.join(contentDir, 'shared');
  if (fs.existsSync(sharedRoot)) {
    for (const school of fs.readdirSync(sharedRoot, { withFileTypes: true })) {
      if (!school.isDirectory()) continue;
      const schoolDir = path.join(sharedRoot, school.name);
      for (const subject of fs.readdirSync(schoolDir, { withFileTypes: true })) {
        if (!subject.isDirectory()) continue;
        const subjectDir = path.join(schoolDir, subject.name);
        const indexPath = path.join(subjectDir, indexFileName);
        if (fs.existsSync(indexPath)) {
          targets.push({
            topicsPath: indexPath,
            dataBaseDir: subjectDir,
            scopeLabel: `shared/${school.name}/${subject.name}/${indexFileName}`
          });
        }
      }
    }
  }

  return targets;
}

function validateFlashcards() {
  const targets = collectTopicIndexTargets('flashcard_topics.json');
  if (targets.length === 0) return { topicCount: 0, cardCount: 0 };

  let topicCount = 0;
  let cardCount = 0;

  targets.forEach(({ topicsPath, dataBaseDir, scopeLabel }) => {
    const topics = readJson(topicsPath);
    if (!Array.isArray(topics)) {
      fail(`${scopeLabel} must be an array.`);
      return;
    }

    topics.forEach((topic, topicIndex) => {
      topicCount += 1;
      const context = `${scopeLabel}[${topicIndex}]`;

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

      if (topic.file.startsWith('custom:')) return;

      const dataPath = path.join(dataBaseDir, topic.file);
      if (!fs.existsSync(dataPath)) {
        fail(`${context}.file not found: ${topic.file}`);
        return;
      }

      const raw = readJson(dataPath);
      const cards = Array.isArray(raw) ? raw : (Array.isArray(raw.cards) ? raw.cards : null);

      if (!cards) {
        fail(`${scopeLabel}:${topic.file} must be an array, or an object with a cards array.`);
        return;
      }

      cards.forEach((card, cardIndex) => {
        cardCount += 1;
        const cardCtx = `${scopeLabel}:${topic.file}[${cardIndex}]`;

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
  });

  return { topicCount, cardCount };
}

function validateDecoders() {
  const targets = collectTopicIndexTargets('decoder_topics.json');
  if (targets.length === 0) return { fileCount: 0, problemCount: 0 };

  const schema = require(decoderSchemaPath);
  const validateDecoderProblem = schema.validateDecoderProblem;
  const normalizeDecoderProblems = schema.normalizeDecoderProblems;

  if (typeof validateDecoderProblem !== 'function' || typeof normalizeDecoderProblems !== 'function') {
    fail('decoder-schema.js must export validateDecoderProblem and normalizeDecoderProblems.');
    return;
  }

  let fileCount = 0;
  let problemCount = 0;

  targets.forEach(({ topicsPath, dataBaseDir, scopeLabel }) => {
    const decoderTopics = readJson(topicsPath);
    if (!Array.isArray(decoderTopics)) {
      fail(`${scopeLabel} must be an array.`);
      return;
    }

    decoderTopics.forEach((topic, topicIndex) => {
      const context = `${scopeLabel}[${topicIndex}]`;

      if (!topic || typeof topic !== 'object') {
        fail(`${context} must be an object.`);
        return;
      }

      if (!topic.file || typeof topic.file !== 'string') {
        fail(`${context}.file is required and must be a string.`);
        return;
      }

      if (topic.file.startsWith('custom:')) return;

      const dataPath = path.join(dataBaseDir, topic.file);
      if (!fs.existsSync(dataPath)) {
        fail(`${context}.file not found: ${topic.file}`);
        return;
      }

      fileCount += 1;

      const raw = readJson(dataPath);
      const problems = normalizeDecoderProblems(raw);

      if (!Array.isArray(problems) || problems.length === 0) {
        fail(`${scopeLabel}:${topic.file} did not normalize to a non-empty problem list.`);
        return;
      }

      problems.forEach((problem, problemIndex) => {
        problemCount += 1;
        const result = validateDecoderProblem(problem);
        if (!result.valid) {
          fail(`${scopeLabel}:${topic.file}[${problemIndex}] schema errors: ${result.errors.join(' | ')}`);
        }
      });
    });
  });

  return { fileCount, problemCount };
}

function validatePractices() {
  const targets = collectTopicIndexTargets('practice_topics.json');
  if (targets.length === 0) return { fileCount: 0, questionCount: 0 };

  const { normalizePracticeQuestions, validatePracticeQuestion } = require(practiceSchemaPath);

  let fileCount = 0;
  let questionCount = 0;

  targets.forEach(({ topicsPath, dataBaseDir, scopeLabel }) => {
    const practiceTopics = readJson(topicsPath);
    if (!Array.isArray(practiceTopics)) {
      fail(`${scopeLabel} must be an array.`);
      return;
    }

    practiceTopics.forEach((topic, topicIndex) => {
      const context = `${scopeLabel}[${topicIndex}]`;
      if (!topic || typeof topic.file !== 'string') {
        fail(`${context}.file is required.`);
        return;
      }

      if (topic.file.startsWith('custom:')) return;

      const dataPath = path.join(dataBaseDir, topic.file);
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
          fail(`${scopeLabel}:${topic.file}[${qIndex}] schema errors: ${res.errors.join(' | ')}`);
        }
      });
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
