/**
 * @typedef {Object} PracticeQuestion
 * @property {string} id - 题目唯一 ID
 * @property {('choice'|'bool'|'essay')} type - 题目类型：选择题、判断题、大题
 * @property {string} question - 题目内容
 * @property {string[]} [options] - 选项列表（仅限选择题）
 * @property {string|number|boolean} answer - 正确答案
 * @property {Object} analysis - 详解信息
 * @property {string} analysis.solution - 总体结论/摘要
 * @property {string[]} [analysis.decoding] - 解读题目（拆解后的片段）
 * @property {Object[]} [analysis.conditions] - 已知条件 & 知识点
 * @property {string} analysis.conditions[].title - 条件/知识点标题
 * @property {string} analysis.conditions[].content - 具体内容/公式
 * @property {string} [analysis.conditions[].description] - 补充说明
 * @property {Object[]} [analysis.traps] - 题目陷阱
 * @property {string} analysis.traps[].title - 陷阱标题
 * @property {string} analysis.traps[].description - 陷阱说明
 * @property {Object[]} [analysis.steps] - 详细解答步骤
 * @property {string} analysis.steps[].title - 步骤标题
 * @property {string} analysis.steps[].content - 步骤具体内容
 * @property {string} [analysis.steps[].tag] - 步骤标签（如 "Calculations", "Logic"）
 * @property {Object[]} [analysis.option_analysis] - 选项错误分析（仅限选择题）
 * @property {string} analysis.option_analysis[].label - 选项标签（如 A, B）
 * @property {string} analysis.option_analysis[].reason - 错误原因
 * @property {string[]} analysis.knowledge_points - 考察知识点
 * @property {string} [analysis.source] - 出处
 */

function validatePracticeQuestion(q) {
    const errors = [];
    if (!q.id) errors.push('缺少 id');
    if (!['choice', 'bool', 'essay'].includes(q.type)) errors.push('无效的 type');
    if (!q.question) errors.push('缺少 question');

    if (q.type === 'choice') {
        if (!Array.isArray(q.options) || q.options.length < 2) errors.push('选择题必须包含选项');
    }

    if (!q.analysis) {
        errors.push('缺少 analysis');
    } else {
        if (!q.analysis.solution && !q.analysis.steps) errors.push('analysis 缺少 solution 或 steps');
    }

    return {
        valid: errors.length === 0,
        errors
    };
}

function normalizePracticeQuestions(data) {
    if (Array.isArray(data)) return data;
    if (data && Array.isArray(data.questions)) return data.questions;
    if (data && typeof data === 'object') return [data];
    return [];
}

if (typeof module !== 'undefined') {
    module.exports = {
        validatePracticeQuestion,
        normalizePracticeQuestions
    };
}

if (typeof window !== 'undefined') {
    window.validatePracticeQuestion = validatePracticeQuestion;
    window.normalizePracticeQuestions = normalizePracticeQuestions;
}
