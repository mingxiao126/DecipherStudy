(function () {
    function makeIssue(severity, module, ruleId, location, description, fixSuggestion) {
        return { severity, module, rule_id: ruleId, location, description, fix_suggestion: fixSuggestion };
    }

    function isNonEmptyString(value) {
        return typeof value === 'string' && value.trim().length > 0;
    }

    function getSeverityPenalty(severity) {
        if (severity === 'Blocker') return 25;
        if (severity === 'Major') return 10;
        return 3;
    }

    function hasUnsafeBackslash(text) {
        if (!isNonEmptyString(text)) return false;
        return /(^|[^\\])\\(?![a-zA-Z0-9_{}()[\]\\])/.test(text);
    }

    function hasPercentInMath(text) {
        if (!isNonEmptyString(text)) return false;
        return /\$[^$]*%[^$]*\$/.test(text);
    }

    function hasMoneyMathDollarMix(text) {
        if (!isNonEmptyString(text)) return false;
        const hasCurrencyDollar = /\$\d/.test(text);
        const hasMathDollarPair = /\$[^$]*\$/.test(text);
        const hasLatexSignal = /\\(times|cdot|sum|frac|sqrt|left|right|hat|sigma|mu|in|le|ge)\b/.test(text);
        return hasCurrencyDollar && hasMathDollarPair && hasLatexSignal;
    }

    function collectAllStrings(obj, bucket) {
        if (obj == null) return;
        if (typeof obj === 'string') { bucket.push(obj); return; }
        if (Array.isArray(obj)) { obj.forEach(item => collectAllStrings(item, bucket)); return; }
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

    function auditQuestion(q, index, issues) {
        const loc = `questions[${index}]`;

        // 1. 基本结构校验
        if (!q || typeof q !== 'object') {
            addIssue(issues, 'Blocker', 'struct', 'PRAC_STR_001', loc, '题目必须是对象。', '确保 JSON 格式正确。');
            return;
        }

        ['id', 'type', 'question', 'analysis'].forEach(field => {
            if (!q[field]) {
                addIssue(issues, 'Blocker', 'struct', 'PRAC_STR_002', `${loc}.${field}`, `缺少必填字段: ${field}`, `请补齐 ${field} 字段。`);
            }
        });

        const hasAnswer = q.answer !== undefined && q.answer !== null && q.answer !== '';
        if (!hasAnswer) {
            addIssue(issues, 'Blocker', 'struct', 'PRAC_STR_002', `${loc}.answer`, '缺少答案或答案为空。', '补齐 answer 字段。');
        }

        if (q.type === 'choice' && (!Array.isArray(q.options) || q.options.length < 2)) {
            addIssue(issues, 'Blocker', 'struct', 'PRAC_STR_003', `${loc}.options`, '选择题缺少选项。', '提供至少两个选项。');
        }

        // 2. 详解深度审计 (High-Fidelity)
        const analysis = q.analysis || {};

        // Decoding
        if (!Array.isArray(analysis.decoding) || analysis.decoding.length === 0) {
            addIssue(issues, 'Major', 'pedagogy', 'PRAC_PED_001', `${loc}.analysis.decoding`, '建议提供题目基础解读。', '将题干分段解读以助理解。');
        }

        // Conditions/Knowledge Points
        if (!Array.isArray(analysis.conditions) || analysis.conditions.length === 0) {
            const sev = q.type === 'essay' ? 'Major' : 'Minor';
            addIssue(issues, sev, 'pedagogy', 'PRAC_PED_002', `${loc}.analysis.conditions`, '建议提供已知条件或核心知识点。', '列出解题所需的公式或背景知识。');
        }

        // Traps
        if (q.type === 'essay' && (!Array.isArray(analysis.traps) || analysis.traps.length === 0)) {
            addIssue(issues, 'Major', 'pedagogy', 'PRAC_PED_003', `${loc}.analysis.traps`, '大题建议提供常见陷阱分析。', '挖掘学生易错点。');
        }

        // Steps
        if (!Array.isArray(analysis.steps) || analysis.steps.length < 2) {
            const sev = q.type === 'essay' ? 'Major' : 'Minor';
            addIssue(issues, sev, 'pedagogy', 'PRAC_PED_004', `${loc}.analysis.steps`, '解答步骤不足（教学建议至少2步）。', '分步骤拆解推导过程。');
        }

        // Option Analysis (Only for choice)
        if (q.type === 'choice' && (!Array.isArray(analysis.option_analysis) || analysis.option_analysis.length === 0)) {
            addIssue(issues, 'Major', 'pedagogy', 'PRAC_PED_005', `${loc}.analysis.option_analysis`, '选择题建议提供选项解析。', '应对错误选项说明原因。');
        }

        // 3. 技术审计 (LaTeX)
        const strings = [];
        collectAllStrings(q, strings);
        strings.forEach((s, sIdx) => {
            const sLoc = `${loc}.str[${sIdx}]`;
            if (hasUnsafeBackslash(s)) {
                addIssue(issues, 'Blocker', 'latex', 'PRAC_LAT_001', sLoc, '检测到不安全反斜杠。', '使用 \\\\ 写法或检查 LaTeX 语法。');
            }
            if (hasPercentInMath(s)) {
                addIssue(issues, 'Minor', 'latex', 'PRAC_LAT_002', sLoc, '百分号不应在 $ 环境内。', '将 $98%$ 改为 98%。');
            }
            if (hasMoneyMathDollarMix(s)) {
                addIssue(issues, 'Major', 'latex', 'PRAC_LAT_003', sLoc, '检测到货币 $ 与公式 $ 混用。', '金额使用文本，公式使用 LaTeX。');
            }
        });

        // 4. 逻辑审计 (关键词)
        const textBlob = JSON.stringify(q).toLowerCase();
        if (textBlob.includes('opportunity cost') && !includesAny(textBlob, ['next best', 'alternative', '次优'])) {
            addIssue(issues, 'Major', 'logic', 'PRAC_LOG_001', loc, '机会成本未体现“次优替代”原则。', '明确“放弃的最高价值”。');
        }
    }

    function auditQuestions(questions) {
        const issues = [];
        if (!Array.isArray(questions)) {
            addIssue(issues, 'Blocker', 'struct', 'PRAC_STR_000', 'input', '输入必须是数组。', '使用 [] 包裹题目列表。');
        } else {
            questions.forEach((q, i) => auditQuestion(q, i, issues));
        }

        let protocolScore = 100;
        let teachingScore = 100;
        issues.forEach(issue => {
            protocolScore -= getSeverityPenalty(issue.severity);
            teachingScore -= (issue.module === 'pedagogy' ? 10 : 5);
        });

        return {
            overall_pass: !issues.some(i => i.severity === 'Blocker'),
            protocol_score: Math.max(0, protocolScore),
            teaching_score: Math.max(0, teachingScore),
            issues,
            improvement_suggestions: issues.length > 0 ? ['补齐详解字段', '优化 LaTeX 语法', '深化逻辑拆解'] : ['题目质量优秀']
        };
    }

    if (typeof window !== 'undefined') window.DecipherPracticeAuditor = { auditQuestions };
    if (typeof module !== 'undefined' && module.exports) module.exports = { auditQuestions };
})();
