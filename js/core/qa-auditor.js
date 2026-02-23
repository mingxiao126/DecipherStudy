(function () {
  const REQUIRED_TOP_KEYS = ['id', 'title', 'original_question', 'segments', 'traps', 'solution'];
  const ALLOWED_TOP_KEYS = [...REQUIRED_TOP_KEYS, 'question_table'];
  const ALLOWED_HIGHLIGHT_COLORS = ['green', 'yellow', 'red', 'blue'];
  const ALLOWED_SOURCE_TYPES = ['prompt_info', 'external_knowledge'];

  function makeIssue(severity, module, ruleId, location, description, fixSuggestion) {
    return {
      severity,
      module,
      rule_id: ruleId,
      location,
      description,
      fix_suggestion: fixSuggestion
    };
  }

  function isNonEmptyString(value) {
    return typeof value === 'string' && value.trim().length > 0;
  }

  function getSeverityPenalty(severity) {
    if (severity === 'Blocker') return 25;
    if (severity === 'Major') return 10;
    return 3;
  }

  function getTeachingPenalty(severity) {
    if (severity === 'Blocker') return 20;
    if (severity === 'Major') return 8;
    return 3;
  }

  function hasForbiddenToken(text) {
    if (!isNonEmptyString(text)) return false;
    return /(^|\n)\s*#\s|\/\*|\*\/|(^|\s)\/\/|\[\^\d+\]/.test(text);
  }

  // 仅将「不安全」的反斜杠判为问题：
  // \ 后若不是常见 LaTeX 合法后继（命令字母、{}、()、[]、另一个 \ 等），则报错。
  function hasUnsafeBackslash(text) {
    if (!isNonEmptyString(text)) return false;
    // 允许：\frac \sum \hat, \{ \}, \( \), \[ \], \\ 等
    return /(^|[^\\])\\(?![a-zA-Z0-9_{}()[\]\\])/.test(text);
  }

  function hasPercentInMath(text) {
    if (!isNonEmptyString(text)) return false;
    return /\$[^$]*%[^$]*\$/.test(text);
  }

  // 检测同一字符串中“货币 $数字”与“LaTeX 公式 $...$”混用。
  // 例如：Expected income is $120 \times ... = 240$.
  function hasMoneyMathDollarMix(text) {
    if (!isNonEmptyString(text)) return false;
    const hasCurrencyDollar = /\$\d/.test(text);
    const hasMathDollarPair = /\$[^$]*\$/.test(text);
    const hasLatexSignal = /\\(times|cdot|sum|frac|sqrt|left|right|hat|sigma|mu|in|le|ge)\b/.test(text);
    return hasCurrencyDollar && hasMathDollarPair && hasLatexSignal;
  }

  function collectAllStrings(obj, bucket) {
    if (obj == null) return;
    if (typeof obj === 'string') {
      bucket.push(obj);
      return;
    }
    if (Array.isArray(obj)) {
      obj.forEach(item => collectAllStrings(item, bucket));
      return;
    }
    if (typeof obj === 'object') {
      Object.keys(obj).forEach(key => collectAllStrings(obj[key], bucket));
    }
  }

  function includesAny(text, keywords) {
    const target = String(text || '').toLowerCase();
    return keywords.some(k => target.includes(k));
  }

  function addIssue(issues, severity, module, ruleId, location, description, fixSuggestion) {
    issues.push(makeIssue(severity, module, ruleId, location, description, fixSuggestion));
  }

  function auditProblem(problem, index, issues) {
    const loc = `problems[${index}]`;

    if (!problem || typeof problem !== 'object' || Array.isArray(problem)) {
      addIssue(issues, 'Blocker', 'structure', 'QA_STRUCT_002', loc, 'Problem 必须是对象。', '确保每道题是一个 JSON 对象。');
      return;
    }

    const keys = Object.keys(problem);

    REQUIRED_TOP_KEYS.forEach((k) => {
      const value = problem[k];
      const missing = value === undefined || value === null || (typeof value === 'string' && value.trim() === '');
      if (missing) {
        addIssue(issues, 'Blocker', 'structure', 'QA_STRUCT_002', `${loc}.${k}`, `缺少必填字段: ${k}`, `补齐 ${k} 字段并提供非空值。`);
      }
    });

    const extraKeys = keys.filter(k => !ALLOWED_TOP_KEYS.includes(k));
    if (extraKeys.length > 0) {
      addIssue(issues, 'Blocker', 'structure', 'QA_STRUCT_001', loc, `存在未允许的顶层字段: ${extraKeys.join(', ')}`, '仅保留允许的顶层字段。');
    }

    if (problem.question_table) {
      const qt = problem.question_table;
      const qtLoc = `${loc}.question_table`;
      if (typeof qt !== 'object' || Array.isArray(qt)) {
        addIssue(issues, 'Blocker', 'structure', 'QA_TABLE_001', qtLoc, 'question_table 必须是对象。', '使用对象结构 {columns, rows}。');
      } else {
        if (!Array.isArray(qt.columns) || qt.columns.length === 0) {
          addIssue(issues, 'Blocker', 'structure', 'QA_TABLE_001', `${qtLoc}.columns`, 'columns 必须是非空数组。', '提供表格列名数组。');
        }
        if (!Array.isArray(qt.rows)) {
          addIssue(issues, 'Blocker', 'structure', 'QA_TABLE_001', `${qtLoc}.rows`, 'rows 必须是数组（二维）。', '提供行数据数组。');
        } else if (Array.isArray(qt.columns)) {
          const expectedCols = qt.columns.length;
          qt.rows.forEach((row, rIdx) => {
            if (!Array.isArray(row)) {
              addIssue(issues, 'Blocker', 'structure', 'QA_TABLE_001', `${qtLoc}.rows[${rIdx}]`, '每一行必须是数组。', '使用数组表示行数据。');
            } else if (row.length !== expectedCols) {
              addIssue(issues, 'Blocker', 'structure', 'QA_TABLE_001', `${qtLoc}.rows[${rIdx}]`, `该行列数为 ${row.length}，与 columns 列数 (${expectedCols}) 不等。`, '对齐每行的列数。');
            }
          });
        }
      }
    }

    const originalQuestion = problem.original_question;

    if (!Array.isArray(problem.segments) || problem.segments.length === 0) {
      addIssue(issues, 'Blocker', 'segments', 'QA_SEG_001', `${loc}.segments`, 'segments 必须为非空数组。', '按阅读顺序提供 segments 数组。');
    } else {
      let hasNarrativeSignal = false;
      let hasBlueGoal = false;

      problem.segments.forEach((seg, segIndex) => {
        const segLoc = `${loc}.segments[${segIndex}]`;

        if (!seg || typeof seg !== 'object' || Array.isArray(seg)) {
          addIssue(issues, 'Blocker', 'segments', 'QA_SEG_002', segLoc, 'segment 必须是对象。', '每个 segment 使用对象结构。');
          return;
        }

        if (!isNonEmptyString(seg.text)) {
          addIssue(issues, 'Blocker', 'segments', 'QA_SEG_002', `${segLoc}.text`, 'text 必须为非空字符串。', '补充 segment.text。');
        }

        if (typeof seg.has_info !== 'boolean') {
          addIssue(issues, 'Blocker', 'segments', 'QA_SEG_002', `${segLoc}.has_info`, 'has_info 必须为 boolean。', '显式标记 true/false。');
        }

        if (seg.has_info === true) {
          ['highlight_text', 'condition', 'knowledge', 'explanation', 'highlight_color'].forEach((field) => {
            if (!isNonEmptyString(seg[field])) {
              addIssue(issues, 'Blocker', 'segments', 'QA_SEG_003', `${segLoc}.${field}`, `has_info=true 时缺少 ${field}`, `补齐 ${field} 字段。`);
            }
          });

          if (isNonEmptyString(seg.highlight_text) && isNonEmptyString(originalQuestion) && !originalQuestion.includes(seg.highlight_text)) {
            addIssue(issues, 'Blocker', 'segments', 'QA_SEG_004', `${segLoc}.highlight_text`, 'highlight_text 不是 original_question 的连续子串。', '使用原题中的连续原文片段。');
          }

          if (isNonEmptyString(seg.highlight_color) && !ALLOWED_HIGHLIGHT_COLORS.includes(seg.highlight_color)) {
            addIssue(issues, 'Blocker', 'segments', 'QA_SEG_005', `${segLoc}.highlight_color`, `highlight_color 仅允许: ${ALLOWED_HIGHLIGHT_COLORS.join(', ')}`, '修改为 green/yellow/red/blue。');
          }

          if (seg.is_trap === true && seg.highlight_color !== 'red') {
            addIssue(issues, 'Major', 'segments', 'QA_SEG_006', `${segLoc}.highlight_color`, 'is_trap=true 时 highlight_color 应为 red。', '将 trap 段颜色设置为 red。');
          }

          if (seg.is_trap === true && includesAny(`${seg.condition} ${seg.knowledge}`, ['goal', 'decision', 'target', '结论', '目标'])) {
            addIssue(issues, 'Major', 'segments', 'QA_SEG_007', segLoc, '疑似将核心决策信息误标为 trap。', '仅将误导或无关信息标记为 trap。');
          }

          if (seg.is_trap === true && seg.highlight_color === 'blue') {
            addIssue(issues, 'Major', 'segments', 'QA_SEG_009', segLoc, 'trap 段不应使用决策目标色（blue）。', 'trap 使用 red，决策目标使用 blue。');
          }

          if (seg.highlight_color === 'blue') {
            hasBlueGoal = true;
            if (!includesAny(`${seg.text} ${seg.condition} ${seg.knowledge}`, ['goal', 'decision', 'target', 'what', 'should', '结论', '目标', '应', '多少'])) {
              addIssue(issues, 'Major', 'logic', 'QA_LOGIC_004', `${segLoc}.highlight_color`, 'blue 语义应对应决策目标/推断目标。', '将真正的决策目标段标为 blue。');
            }
          }

          if (seg.highlight_color === 'green' && !includesAny(`${seg.text} ${seg.knowledge}`, ['sample', 'population', 'structure', 'design', 'option', 'alternative', '样本', '总体', '结构', '设计'])) {
            addIssue(
              issues,
              'Major',
              'logic',
              'QA_LOGIC_004',
              `${segLoc}.highlight_color`,
              'green 语义通常用于结构/样本/设计信息。',
              `将 ${segLoc}.highlight_color 从 green 改为 yellow；若该段确为结构信息，请把 knowledge 改为含 sample/population/design/structure 的表述。`
            );
          }

          if (seg.text && seg.text.length > 220) {
            addIssue(issues, 'Minor', 'flow', 'QA_FLOW_002', segLoc, '单个 segment 过长，可能影响逐步阅读节奏。', '拆分为更细粒度的段落。');
          }
        }

        if (isNonEmptyString(seg.text) && isNonEmptyString(originalQuestion) && originalQuestion.includes(seg.text.slice(0, Math.min(seg.text.length, 12)))) {
          hasNarrativeSignal = true;
        }

        if (segIndex > 0 && isNonEmptyString(seg.text) && seg.text === problem.segments[segIndex - 1].text) {
          addIssue(issues, 'Major', 'flow', 'QA_FLOW_001', segLoc, '相邻 segments 文本重复，存在阅读流跳跃/冗余风险。', '去重并保证逻辑连续。');
        }
      });

      if (!hasNarrativeSignal) {
        addIssue(issues, 'Blocker', 'segments', 'QA_SEG_008', `${loc}.segments`, 'segments 未覆盖题干叙述上下文。', '加入场景或决策设置句。');
      }

      if (!hasBlueGoal) {
        addIssue(issues, 'Major', 'flow', 'QA_FLOW_001', `${loc}.segments`, '未检测到决策目标段（blue）。', '至少标记一个决策目标段为 blue。');
      }
    }

    if (!Array.isArray(problem.traps) || problem.traps.length === 0) {
      addIssue(issues, 'Blocker', 'traps', 'QA_TRAP_001', `${loc}.traps`, 'traps 至少需要一个条目。', '补充至少一个真实误区陷阱。');
    } else {
      problem.traps.forEach((trap, trapIndex) => {
        const trapLoc = `${loc}.traps[${trapIndex}]`;
        if (!trap || typeof trap !== 'object' || Array.isArray(trap)) {
          addIssue(issues, 'Blocker', 'traps', 'QA_STRUCT_002', trapLoc, 'trap 必须是对象。', '使用 {title, description}。');
          return;
        }
        if (!isNonEmptyString(trap.title) || !isNonEmptyString(trap.description)) {
          addIssue(issues, 'Major', 'traps', 'QA_TRAP_002', trapLoc, 'trap 需包含 title 和 description。', '补全陷阱标题与误区解释。');
        } else if (trap.description.trim().length < 18) {
          addIssue(issues, 'Major', 'traps', 'QA_TRAP_002', trapLoc, 'trap 描述过短，误区不够真实。', '增加学生可能误判路径。');
        }
      });
    }

    if (!Array.isArray(problem.solution)) {
      addIssue(issues, 'Blocker', 'solution', 'QA_SOL_001', `${loc}.solution`, 'solution 必须为数组。', '使用步骤数组输出 solution。');
    } else if (problem.solution.length < 2) {
      addIssue(issues, 'Major', 'solution', 'QA_SOL_004', `${loc}.solution`, 'solution 建议至少 2 步以保持教学连贯。', '补充中间推理步骤和最终结论步骤。');
    } else {
      problem.solution.forEach((step, stepIndex) => {
        const stepLoc = `${loc}.solution[${stepIndex}]`;
        if (!step || typeof step !== 'object' || Array.isArray(step)) {
          addIssue(issues, 'Blocker', 'solution', 'QA_SOL_002', stepLoc, 'solution step 必须是对象。', '每步使用对象并补齐字段。');
          return;
        }

        ['step_desc', 'content', 'source_type', 'source_label'].forEach((f) => {
          if (!isNonEmptyString(step[f])) {
            addIssue(issues, 'Blocker', 'solution', 'QA_SOL_002', `${stepLoc}.${f}`, `缺少 ${f}`, `补齐 ${f} 字段。`);
          }
        });

        if (isNonEmptyString(step.source_type) && !ALLOWED_SOURCE_TYPES.includes(step.source_type)) {
          addIssue(issues, 'Blocker', 'solution', 'QA_SOL_003', `${stepLoc}.source_type`, `source_type 仅允许: ${ALLOWED_SOURCE_TYPES.join(', ')}`, '修正为 prompt_info 或 external_knowledge。');
        }
      });

      const lastStep = problem.solution[problem.solution.length - 1] || {};
      const finalText = `${lastStep.step_desc || ''} ${lastStep.content || ''}`;
      if (!includesAny(finalText, ['final', 'answer', 'therefore', 'thus', '结果', '结论', '应', 'should', '='])) {
        addIssue(issues, 'Major', 'solution', 'QA_SOL_004', `${loc}.solution[${problem.solution.length - 1}]`, '最后一步未明确给出最终结论/结果。', '在最后一步写出明确答案或决策结论。');
      }
    }

    const textBlob = `${problem.original_question || ''} ${JSON.stringify(problem.solution || [])}`.toLowerCase();

    if (textBlob.includes('opportunity cost') && !includesAny(textBlob, ['next best', 'best alternative', '次优', '下一个最佳'])) {
      addIssue(issues, 'Major', 'logic', 'QA_LOGIC_001', loc, '机会成本未体现“次优替代项”原则。', '在解法中明确仅取 next-best alternative。');
    }

    if ((textBlob.includes('sunk cost') || textBlob.includes('cannot be refunded')) && !includesAny(textBlob, ['ignore', 'excluded', '不计入', '忽略'])) {
      addIssue(issues, 'Major', 'logic', 'QA_LOGIC_002', loc, '沉没成本未明确排除。', '在解法中明确沉没成本不纳入当前决策成本。');
    }

    if ((textBlob.includes('marginal benefit') || textBlob.includes('mb')) && (textBlob.includes('marginal cost') || textBlob.includes('mc')) && !includesAny(textBlob, ['mb >= mc', 'mb > mc', 'mb=mc', '边际收益', '边际成本'])) {
      addIssue(issues, 'Major', 'logic', 'QA_LOGIC_003', loc, '边际分析规则表达不清。', '明确写出 MB 与 MC 的比较规则。');
    }

    const strings = [];
    collectAllStrings(problem, strings);

    strings.forEach((s, sIndex) => {
      const strLoc = `${loc}.strings[${sIndex}]`;
      if (hasUnsafeBackslash(s)) {
        addIssue(
          issues,
          'Blocker',
          'latex',
          'QA_LATEX_001',
          strLoc,
          '检测到不安全反斜杠转义。',
          '仅保留合法 LaTeX 写法（如 \\\\frac、\\\\hat、\\\\{、\\\\}、\\\\(、\\\\)）。'
        );
      }
      if (hasPercentInMath(s)) {
        addIssue(issues, 'Minor', 'latex', 'QA_LATEX_002', strLoc, '百分号不应放在 LaTeX 数学环境中。', '将 $98%$ 改为 98%。');
      }
      if (hasMoneyMathDollarMix(s)) {
        addIssue(
          issues,
          'Major',
          'latex',
          'QA_LATEX_003',
          strLoc,
          '检测到货币 $ 与公式 $...$ 混用，可能导致公式解析错位。',
          '将金额写为纯文本（如 120 dollars），并改用 \\(...\\) 或独立 $...$ 承载公式。'
        );
      }
      if (hasForbiddenToken(s)) {
        addIssue(issues, 'Blocker', 'json_safety', 'QA_JSON_002', strLoc, '检测到禁用 token（标题/注释/引用标记）。', '移除 Markdown 头、注释符或引用 token。');
      }
    });
  }

  function buildSuggestions(issues) {
    const rules = new Set(issues.map(i => i.rule_id));
    const suggestions = [];

    if (rules.has('QA_STRUCT_001') || rules.has('QA_STRUCT_002')) {
      suggestions.push('仅保留协议允许字段，并保证顶层与子结构必填字段完整。');
    }
    if (rules.has('QA_SEG_003') || rules.has('QA_SEG_004') || rules.has('QA_SEG_005')) {
      suggestions.push('对 has_info=true 的 segment 强制补齐字段，并确保 highlight_text 来自原题连续子串。');
    }
    if (rules.has('QA_TRAP_001') || rules.has('QA_TRAP_002')) {
      suggestions.push('至少添加一个真实学生误区陷阱，并写明误判路径。');
    }
    if (rules.has('QA_SOL_002') || rules.has('QA_SOL_003') || rules.has('QA_SOL_004')) {
      suggestions.push('solution 每步补齐来源归因，最后一步明确结论。');
    }
    if (rules.has('QA_LATEX_001') || rules.has('QA_LATEX_002') || rules.has('QA_LATEX_003')) {
      suggestions.push('统一进行 LaTeX 安全清洗：反斜杠双转义、百分号不进入 $...$。');
    }
    if (rules.has('QA_LATEX_003')) {
      suggestions.push('避免在同一字符串里同时使用货币 $120 与公式 $...$；金额改为文本，公式改用 \\(...\\)。');
    }

    if (suggestions.length === 0) {
      suggestions.push('当前内容已通过协议审计，可进入上传与展示流程。');
    }

    return suggestions;
  }

  function auditProblems(input) {
    const issues = [];

    if (!Array.isArray(input)) {
      addIssue(
        issues,
        'Blocker',
        'json_safety',
        'QA_JSON_001',
        'input',
        '输入必须为 JSON 数组（Array<Problem>）。',
        '即使只有一道题，也请使用数组包裹。'
      );
    } else {
      input.forEach((problem, index) => auditProblem(problem, index, issues));
    }

    let protocolScore = 100;
    let teachingScore = 100;

    issues.forEach((issue) => {
      protocolScore -= getSeverityPenalty(issue.severity);
      teachingScore -= getTeachingPenalty(issue.severity);
    });

    if (protocolScore < 0) protocolScore = 0;
    if (teachingScore < 0) teachingScore = 0;

    const hasBlocker = issues.some(i => i.severity === 'Blocker');

    return {
      overall_pass: !hasBlocker,
      protocol_score: protocolScore,
      teaching_score: teachingScore,
      issues,
      improvement_suggestions: buildSuggestions(issues)
    };
  }

  if (typeof window !== 'undefined') {
    window.DecipherQAAuditor = {
      auditProblems
    };
  }

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
      auditProblems
    };
  }
})();
