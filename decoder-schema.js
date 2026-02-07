/**
 * 难题拆解器 Decipher JSON 结构与校验
 * 规范见：docs/Decipher-JSON-转换规范.md
 *
 * @typedef {Object} Segment
 * @property {string} text - 解读框逐行显示的句子/短语
 * @property {boolean} has_info - 是否包含需同步的关键信息（true=暂停等待同步）
 * @property {string} [highlight_text] - 原题中要高亮的连续子串
 * @property {string} [highlight_color] - green|yellow|red|blue|orange|trap
 * @property {string} [condition] - 同步到「已知条件」的标题/变量
 * @property {string} [knowledge] - 知识点标签
 * @property {string} [explanation] - 已知条件解释文案
 * @property {boolean} [is_trap] - 是否为干扰项
 *
 * @typedef {Object} Trap
 * @property {string} [title] - 陷阱标题
 * @property {string} [description] - 陷阱说明
 * @property {string} [text] - 旧版兼容
 *
 * @typedef {Object} SolutionStep
 * @property {string} [step_desc] - 步骤标题
 * @property {string} [step] - 步骤标题（兼容）
 * @property {string} [content] - 步骤内容/公式
 * @property {string} [formula] - 兼容
 * @property {string} [source_type] - prompt_info|external_knowledge
 * @property {string} [source_label] - 来源说明
 * @property {string[]} [source_refs] - 联动已知条件 id 列表
 *
 * @typedef {Object} Problem
 * @property {string} [id] - 题目唯一标识
 * @property {string} [title] - 题目标题
 * @property {string} original_question - 原题全文
 * @property {Segment[]} segments - 阅读流片段
 * @property {Trap[]} [traps] - 陷阱总结
 * @property {SolutionStep[]|string} [solution] - 详解步骤或字符串
 */

/**
 * 校验单道题是否符合 Decipher 规范（最小必填 + 类型）
 * @param {Problem} problem - 题目对象
 * @returns {{ valid: boolean, errors: string[] }}
 */
function validateDecoderProblem(problem) {
  const errors = [];

  if (!problem || typeof problem !== 'object') {
    return { valid: false, errors: ['problem 必须为非空对象'] };
  }

  if (typeof problem.original_question !== 'string' || !problem.original_question.trim()) {
    errors.push('original_question 必填且为非空字符串');
  }

  if (!Array.isArray(problem.segments)) {
    errors.push('segments 必填且为数组');
  } else {
    problem.segments.forEach((seg, i) => {
      if (!seg || typeof seg !== 'object') {
        errors.push(`segments[${i}] 必须为对象`);
        return;
      }
      if (typeof seg.text !== 'string' || !seg.text.trim()) {
        errors.push(`segments[${i}].text 必填且为非空字符串`);
      }
      if (typeof seg.has_info !== 'boolean') {
        errors.push(`segments[${i}].has_info 必填且为 boolean`);
      }
      if (seg.has_info && seg.highlight_text && typeof seg.highlight_text !== 'string') {
        errors.push(`segments[${i}].highlight_text 应为字符串（原题子串）`);
      }
      const allowedColors = ['green', 'yellow', 'red', 'blue', 'orange', 'trap'];
      if (seg.highlight_color != null && !allowedColors.includes(seg.highlight_color)) {
        errors.push(`segments[${i}].highlight_color 允许值: ${allowedColors.join(', ')}`);
      }
    });
  }

  if (problem.traps != null && !Array.isArray(problem.traps)) {
    errors.push('traps 应为数组');
  } else if (Array.isArray(problem.traps)) {
    problem.traps.forEach((t, i) => {
      if (t != null && typeof t !== 'object') {
        errors.push(`traps[${i}] 应为对象 { title?, description? }`);
      }
    });
  }

  if (problem.solution != null) {
    if (typeof problem.solution === 'string') {
      // 旧版字符串格式允许
    } else if (!Array.isArray(problem.solution)) {
      errors.push('solution 应为步骤数组或字符串');
    } else {
      problem.solution.forEach((step, i) => {
        if (step == null || typeof step !== 'object') {
          errors.push(`solution[${i}] 必须为对象`);
        }
        const st = step;
        if (st.source_type != null && !['prompt_info', 'external_knowledge'].includes(st.source_type)) {
          errors.push(`solution[${i}].source_type 允许值: prompt_info, external_knowledge`);
        }
      });
    }
  }

  return {
    valid: errors.length === 0,
    errors
  };
}

/**
 * 将题目文件解析为题目数组（兼容单题对象）
 * @param {Problem[]|Problem} data - 从 JSON 解析出的数据
 * @returns {Problem[]}
 */
function normalizeDecoderProblems(data) {
  if (Array.isArray(data)) return data;
  if (data && typeof data === 'object' && data.original_question) return [data];
  return [];
}

// 导出供控制台或 decoder 使用
if (typeof window !== 'undefined') {
  window.validateDecoderProblem = validateDecoderProblem;
  window.normalizeDecoderProblems = normalizeDecoderProblems;
}
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { validateDecoderProblem, normalizeDecoderProblems };
}
