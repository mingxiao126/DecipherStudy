(function () {
    const MODE = 'disk';
    let pendingUpload = null;
    let canUploadToServer = null;

    function normalizeSubject(subject) {
        if (!subject) return '未分类';
        if (subject === 'econ') return '经济学';
        if (subject === 'stat') return '统计学';
        return subject;
    }

    function normalizeFlashcardArray(data) {
        if (Array.isArray(data)) return data;
        if (data && Array.isArray(data.cards)) return data.cards;
        return null;
    }

    function validateFlashcardData(data) {
        const cards = normalizeFlashcardArray(data);
        if (!cards || cards.length === 0) {
            return { valid: false, errors: ['闪卡 JSON 必须是数组，或对象内含 cards 数组，且不能为空'] };
        }

        const errors = [];
        cards.forEach((card, index) => {
            if (!card || typeof card !== 'object') {
                errors.push(`第 ${index + 1} 题必须是对象`);
                return;
            }
            if (!card.question || typeof card.question !== 'string') {
                errors.push(`第 ${index + 1} 题缺少 question 字符串`);
            }
            const answerType = typeof card.answer;
            const hasValidAnswer = (answerType === 'string') || (answerType === 'object' && card.answer !== null);
            if (!hasValidAnswer) {
                errors.push(`第 ${index + 1} 题缺少 answer（需为字符串或对象）`);
            }
        });

        return { valid: errors.length === 0, errors, normalized: cards };
    }

    function validateDecoderData(data) {
        const hasSchema = typeof window.normalizeDecoderProblems === 'function';
        const problems = hasSchema
            ? window.normalizeDecoderProblems(data)
            : (Array.isArray(data) ? data : (data && typeof data === 'object' ? [data] : []));

        if (!Array.isArray(problems) || problems.length === 0) {
            return { valid: false, errors: ['难题 JSON 不能为空，且应为单题对象或题目数组'] };
        }

        if (window.DecipherQAAuditor && typeof window.DecipherQAAuditor.auditProblems === 'function') {
            const audit = window.DecipherQAAuditor.auditProblems(problems);
            if (!audit.overall_pass) {
                const allIssues = (audit.issues || []).map(issue => {
                    const fix = issue.fix_suggestion ? ` 建议：${issue.fix_suggestion}` : '';
                    const where = issue.location ? ` 位置：${issue.location}` : '';
                    return `【${issue.rule_id}】${issue.description}${where}${fix}`;
                });
                return {
                    valid: false,
                    errors: allIssues.length > 0 ? allIssues : ['难题 JSON 未通过 QA 审计'],
                    normalized: problems,
                    audit
                };
            }
            return { valid: true, errors: [], normalized: problems, audit };
        }

        return { valid: true, errors: [], normalized: problems };
    }

    function validatePracticeData(data) {
        const questions = typeof window.normalizePracticeQuestions === 'function'
            ? window.normalizePracticeQuestions(data)
            : (Array.isArray(data) ? data : []);

        if (!Array.isArray(questions) || questions.length === 0) {
            return { valid: false, errors: ['考题 JSON 不能为空'] };
        }

        const errors = [];
        questions.forEach((q, index) => {
            const res = typeof window.validatePracticeQuestion === 'function'
                ? window.validatePracticeQuestion(q)
                : { valid: true, errors: [] };
            if (!res.valid) {
                errors.push(`[Schema] 第 ${index + 1} 题: ${res.errors.join(', ')}`);
            }
        });

        if (window.DecipherPracticeAuditor && typeof window.DecipherPracticeAuditor.auditQuestions === 'function') {
            const audit = window.DecipherPracticeAuditor.auditQuestions(questions);
            if (!audit.overall_pass) {
                const auditIssues = (audit.issues || []).map(issue => {
                    const fix = issue.fix_suggestion ? ` 建议：${issue.fix_suggestion}` : '';
                    const where = issue.location ? ` 位置：${issue.location}` : '';
                    return `【${issue.rule_id}】${issue.description}${where}${fix}`;
                });
                return {
                    valid: false,
                    errors: [...errors, ...auditIssues],
                    normalized: questions,
                    audit
                };
            }
            return { valid: errors.length === 0, errors, normalized: questions, audit };
        }

        return { valid: errors.length === 0, errors, normalized: questions };
    }

    function statusText(element, message, isError) {
        if (!element) return;
        element.textContent = message;
        element.className = isError ? 'text-red-400 text-sm mt-3' : 'text-emerald-400 text-sm mt-3';
    }

    function getOrCreateRepairPanel() {
        let panel = document.getElementById('jsonRepairPanel');
        if (panel) return panel;

        const statusEl = document.getElementById('uploadStatus');
        if (!statusEl || !statusEl.parentElement || !statusEl.parentElement.parentElement) return null;

        panel = document.createElement('div');
        panel.id = 'jsonRepairPanel';
        panel.className = 'mt-4 hidden';
        panel.innerHTML = [
            '<label class="block text-slate-300 mb-2 text-sm">修复后 JSON（可复制）</label>',
            '<textarea id="repairedJsonOutput" rows="8" class="w-full px-3 py-2 rounded-xl bg-slate-800/50 border border-slate-700 text-slate-200 font-mono text-sm"></textarea>',
            '<div class="mt-3 flex items-center gap-3">',
            '<button id="copyRepairedJsonBtn" class="btn-primary px-4 py-2 rounded-xl font-semibold" type="button">复制修复版</button>',
            '<button id="useRepairedJsonBtn" class="btn-primary px-4 py-2 rounded-xl font-semibold" type="button">使用修复版重新校验</button>',
            '</div>'
        ].join('');

        statusEl.parentElement.parentElement.appendChild(panel);

        const copyBtn = panel.querySelector('#copyRepairedJsonBtn');
        const useBtn = panel.querySelector('#useRepairedJsonBtn');
        const outputEl = panel.querySelector('#repairedJsonOutput');

        if (copyBtn && outputEl) {
            copyBtn.addEventListener('click', async () => {
                try {
                    await navigator.clipboard.writeText(outputEl.value || '');
                    copyBtn.textContent = '已复制';
                    setTimeout(() => { copyBtn.textContent = '复制修复版'; }, 1200);
                } catch (_e) {
                    outputEl.select();
                    document.execCommand('copy');
                    copyBtn.textContent = '已复制';
                    setTimeout(() => { copyBtn.textContent = '复制修复版'; }, 1200);
                }
            });
        }

        if (useBtn && outputEl) {
            useBtn.addEventListener('click', () => {
                const textEl = document.getElementById('datasetJsonText');
                if (textEl) textEl.value = outputEl.value || '';
                const validateBtn = document.getElementById('datasetUploadBtn');
                if (validateBtn) validateBtn.click();
            });
        }

        return panel;
    }

    function showRepairPanel(jsonText) {
        const panel = getOrCreateRepairPanel();
        if (!panel) return;
        const outputEl = panel.querySelector('#repairedJsonOutput');
        if (outputEl) outputEl.value = jsonText || '';
        panel.classList.remove('hidden');
    }

    function hideRepairPanel() {
        const panel = document.getElementById('jsonRepairPanel');
        if (panel) panel.classList.add('hidden');
    }

    function getOrCreateIssuesPanel() {
        let panel = document.getElementById('validationIssuesPanel');
        if (panel) return panel;

        const statusEl = document.getElementById('uploadStatus');
        if (!statusEl || !statusEl.parentElement || !statusEl.parentElement.parentElement) return null;

        panel = document.createElement('div');
        panel.id = 'validationIssuesPanel';
        panel.className = 'mt-4 hidden';
        panel.innerHTML = [
            '<label class="block text-slate-300 mb-2 text-sm">校验问题清单（全部）</label>',
            '<div id="validationIssuesList" class="w-full max-h-80 overflow-auto px-3 py-2 rounded-xl bg-slate-900/40 border border-slate-700 text-slate-200 text-sm font-mono whitespace-pre-wrap"></div>'
        ].join('');

        statusEl.parentElement.parentElement.appendChild(panel);
        return panel;
    }

    function showIssuesPanel(lines) {
        const panel = getOrCreateIssuesPanel();
        if (!panel) return;
        const list = panel.querySelector('#validationIssuesList');
        if (list) {
            const normalized = Array.isArray(lines) ? lines : [];
            list.textContent = normalized.map((line, idx) => `${idx + 1}. ${line}`).join('\n');
        }
        panel.classList.remove('hidden');
    }

    function hideIssuesPanel() {
        const panel = document.getElementById('validationIssuesPanel');
        if (panel) panel.classList.add('hidden');
        const smartPanel = document.getElementById('smartFixPanel');
        if (smartPanel) smartPanel.classList.add('hidden');
    }

    function performAutoFix(data) {
        if (!data) return data;

        const traverse = (obj) => {
            if (typeof obj === 'string') {
                let fixed = obj;
                // 1. 修复所有不安全的单反斜杠 (针对 PRAC_LAT_001)
                // 规则：只要反斜杠后面不是安全的 LaTeX 字符集或另一个反斜杠，就补齐为双反斜杠
                fixed = fixed.replace(/(^|[^\\])\\([^a-zA-Z0-9_{}()[\]\\]|$)/g, '$1\\\\$2');

                // 2. 修复 $ 环境内的百分号 (针对 PRAC_LAT_002)
                fixed = fixed.replace(/\$([^$]*%[^$]*)\$/g, (match, p1) => {
                    return p1.replace(/%/g, '') + '%';
                });

                // 3. 修复货币 $ 冲突 (针对 PRAC_LAT_003 启发式)
                fixed = fixed.replace(/\$([0-9.,]+)(?!\$)/g, '$1 $');

                return fixed;
            }
            if (Array.isArray(obj)) return obj.map(traverse);
            if (obj && typeof obj === 'object') {
                const out = {};
                Object.keys(obj).forEach(k => { out[k] = traverse(obj[k]); });
                return out;
            }
            return obj;
        };

        return traverse(data);
    }

    function getOrCreateSmartFixPanel() {
        let panel = document.getElementById('smartFixPanel');
        if (panel) return panel;

        const statusEl = document.getElementById('uploadStatus');
        if (!statusEl || !statusEl.parentElement || !statusEl.parentElement.parentElement) return null;

        panel = document.createElement('div');
        panel.id = 'smartFixPanel';
        panel.className = 'mt-4 hidden';
        panel.innerHTML = [
            '<div class="flex items-center gap-2 p-3 rounded-xl bg-purple-500/10 border border-purple-500/20">',
            '<div class="flex-1">',
            '<p class="text-purple-200 text-sm font-semibold">检测到可自动修复的问题</p>',
            '<p class="text-purple-400/80 text-xs">点击下方按钮将自动修正 LaTeX 语法、反斜杠及符号冲突。</p>',
            '</div>',
            '<button id="runSmartFixBtn" class="bg-purple-600 hover:bg-purple-500 text-white px-4 py-2 rounded-lg text-sm font-bold shadow-lg transition-all shrink-0">立即自动修复</button>',
            '</div>'
        ].join('');

        statusEl.parentElement.parentElement.appendChild(panel);
        return panel;
    }

    function showSmartFixPanel(data) {
        const panel = getOrCreateSmartFixPanel();
        if (!panel) return;

        const btn = panel.querySelector('#runSmartFixBtn');
        btn.onclick = (e) => {
            e.preventDefault();
            console.log('[Uploader] Running Smart Fix on data...');
            const fixedData = performAutoFix(data);
            const textEl = document.getElementById('datasetJsonText');
            if (textEl) {
                const newJson = JSON.stringify(fixedData, null, 2);
                if (textEl.value === newJson) {
                    console.warn('[Uploader] Smart Fix made no changes. Broadening search...');
                    // 如果普通修复没变，尝试进一步全量反斜杠转义
                    const finalData = forceEscapeAllBackslashes(data);
                    textEl.value = JSON.stringify(finalData, null, 2);
                } else {
                    textEl.value = newJson;
                }

                // UI 反馈
                const originalText = btn.textContent;
                btn.textContent = '已修复并重新校验...';
                btn.classList.replace('bg-purple-600', 'bg-emerald-600');

                setTimeout(() => {
                    const validateBtn = document.getElementById('datasetUploadBtn');
                    if (validateBtn) validateBtn.click();
                    btn.textContent = originalText;
                    btn.classList.replace('bg-emerald-600', 'bg-purple-600');
                }, 500);
            }
        };
        panel.classList.remove('hidden');
    }

    // 最后的保底方案：将所有单独的反斜杠（且不是转义字符的）都双倍化
    function forceEscapeAllBackslashes(data) {
        const traverse = (obj) => {
            if (typeof obj === 'string') {
                return obj.replace(/(^|[^\\])\\(?!\\)/g, '$1\\\\');
            }
            if (Array.isArray(obj)) return obj.map(traverse);
            if (obj && typeof obj === 'object') {
                const out = {};
                Object.keys(obj).forEach(k => { out[k] = traverse(obj[k]); });
                return out;
            }
            return obj;
        };
        return traverse(data);
    }

    function smartCleanup(text) {
        return String(text || '')
            .replace(/[\u201C\u201D]/g, '"')
            .replace(/[\u2018\u2019]/g, "'")
            .replace(/\[cite_start\]/g, '')
            .replace(/\[cite:\s*[^\]]+\]/g, '')
            .replace(/,\s*([}\]])/g, '$1');
    }

    // 修复常见 LaTeX 转义错误：将 \frac/\hat/\sum 等单反斜杠补为双反斜杠
    function normalizeLikelyLatexEscapes(text) {
        return String(text || '')
            // 常见 LaTeX 命令
            .replace(/(^|[^\\])\\([A-Za-z]+)/g, '$1\\\\$2')
            // 花括号转义
            .replace(/(^|[^\\])\\([{}])/g, '$1\\\\$2');
    }

    function nextNonSpace(str, start) {
        for (let i = start; i < str.length; i++) {
            if (!/\s/.test(str[i])) return str[i];
        }
        return '';
    }

    function escapeLikelyJsonStringIssues(input) {
        const str = normalizeLikelyLatexEscapes(smartCleanup(input));
        let out = '';
        let inString = false;
        let escaped = false;

        for (let i = 0; i < str.length; i++) {
            const ch = str[i];
            const next = str[i + 1] || '';

            if (!inString) {
                if (ch === '"') {
                    inString = true;
                }
                out += ch;
                continue;
            }

            if (escaped) {
                out += ch;
                escaped = false;
                continue;
            }

            if (ch === '\\') {
                const validEscape = ['"', '\\', '/', 'b', 'f', 'n', 'r', 't', 'u'];
                if (!validEscape.includes(next)) {
                    out += '\\\\';
                } else {
                    out += ch;
                }
                escaped = true;
                continue;
            }

            if (ch === '"') {
                const nextChar = nextNonSpace(str, i + 1);
                const looksLikeClosing = [',', '}', ']', ':'].includes(nextChar) || nextChar === '';
                if (looksLikeClosing) {
                    inString = false;
                    out += ch;
                } else {
                    out += '\\"';
                }
                continue;
            }

            out += ch;
        }

        return out;
    }

    function attemptRepairJson(rawText) {
        try {
            const cleaned = escapeLikelyJsonStringIssues(rawText);
            const parsed = JSON.parse(cleaned);
            return {
                ok: true,
                parsed,
                repairedText: JSON.stringify(parsed, null, 2)
            };
        } catch (e) {
            return {
                ok: false,
                error: e.message,
                repairedText: escapeLikelyJsonStringIssues(rawText)
            };
        }
    }

    async function readInputJsonText(fileEl, textEl) {
        const pastedText = textEl && typeof textEl.value === 'string' ? textEl.value.trim() : '';
        if (pastedText) {
            return { source: 'text', rawText: pastedText };
        }

        const file = fileEl && fileEl.files ? fileEl.files[0] : null;
        if (!file) {
            throw new Error('请先选择 JSON 文件，或在文本框粘贴 JSON');
        }

        const rawText = await file.text();
        return { source: 'file', rawText };
    }

    async function uploadToDiskApi(payload) {
        if (window.DecipherRuntime && typeof window.DecipherRuntime.ensureApiMode === 'function') {
            const apiMode = await window.DecipherRuntime.ensureApiMode();
            if (!apiMode) {
                throw new Error('当前为静态部署模式（Netlify），不支持落盘上传。请在本地运行 node server.js。');
            }
        }

        const response = await fetch('/api/upload-dataset', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(payload)
        });

        const result = await response.json().catch(() => ({}));

        if (!response.ok || !result.ok) {
            const firstError = Array.isArray(result.errors) && result.errors.length > 0
                ? result.errors[0]
                : `HTTP ${response.status}`;
            throw new Error(firstError);
        }

        return result;
    }

    function getOrCreateConfirmUploadBtn() {
        let btn = document.getElementById('datasetConfirmUploadBtn');
        if (btn) return btn;

        const validateBtn = document.getElementById('datasetUploadBtn');
        if (!validateBtn || !validateBtn.parentElement) return null;

        btn = document.createElement('button');
        btn.id = 'datasetConfirmUploadBtn';
        btn.type = 'button';
        btn.textContent = '确认上传';
        btn.className = 'btn-primary px-5 py-2 rounded-xl font-semibold hidden';
        validateBtn.parentElement.insertBefore(btn, validateBtn.nextSibling);
        return btn;
    }

    function clearPendingUpload() {
        pendingUpload = null;
        const confirmBtn = getOrCreateConfirmUploadBtn();
        if (confirmBtn) confirmBtn.classList.add('hidden');
    }

    async function prepareValidation() {
        const typeEl = document.getElementById('datasetType');
        const subjectEl = document.getElementById('datasetSubject');
        const nameEl = document.getElementById('datasetName');
        const fileEl = document.getElementById('datasetFile');
        const textEl = document.getElementById('datasetJsonText');
        const statusEl = document.getElementById('uploadStatus');
        const confirmBtn = getOrCreateConfirmUploadBtn();

        if (!typeEl || !subjectEl || !nameEl || !fileEl) return;

        clearPendingUpload();
        hideRepairPanel();
        hideIssuesPanel();

        const type = typeEl.value;
        const subject = normalizeSubject(subjectEl.value);
        const name = (nameEl.value || '').trim();
        const file = fileEl.files && fileEl.files[0];

        const finalName = name || (file ? file.name.replace(/\.json$/i, '') : '') || '未命名题库';

        let rawText = '';
        let inputSource = 'file';
        try {
            const payload = await readInputJsonText(fileEl, textEl);
            rawText = payload.rawText;
            inputSource = payload.source;
        } catch (error) {
            statusText(statusEl, error.message, true);
            return;
        }

        let data = null;
        try {
            data = JSON.parse(rawText);
        } catch (error) {
            // 解析失败时，我们尝试“修复版”仅供参考，不应自动应用于原始流程
            const repaired = attemptRepairJson(rawText);
            if (repaired.ok) {
                showRepairPanel(repaired.repairedText);
                statusText(statusEl, `JSON 解析失败：${error.message}。已生成可复制修复版。`, true);
            } else {
                showRepairPanel(repaired.repairedText || rawText);
                statusText(statusEl, `JSON 解析失败：${error.message}。修复建议生成失败：${repaired.error}`, true);
            }
            return;
        }

        let result;
        if (type === 'flashcard') {
            result = validateFlashcardData(data);
        } else if (type === 'decoder') {
            result = validateDecoderData(data);
        } else {
            result = validatePracticeData(data);
        }

        // 如果存在审计结果，哪怕不是 Blocker（即 valid 为 true），也显示警告面板
        const hasAuditIssues = !!(result.audit && result.audit.issues && result.audit.issues.length > 0);

        if (hasAuditIssues) {
            const issues = (result.audit.issues || []).map(issue => {
                const fix = issue.fix_suggestion ? ` 建议：${issue.fix_suggestion}` : '';
                const where = issue.location ? ` 位置：${issue.location}` : '';
                return `【${issue.rule_id}】${issue.description}${where}${fix}`;
            });
            showIssuesPanel(issues);

            // 如果存在可自动修复的 LaTeX/语法问题，显示智能修复面板
            const fixable = issues.some(msg => msg.includes('PRAC_LAT_001') || msg.includes('PRAC_LAT_002'));
            if (fixable) {
                showSmartFixPanel(data);
            }

            if (!result.valid) {
                statusText(statusEl, `校验失败：共 ${issues.length} 项。请参考下方清单或使用“立即自动修复”进行调整。`, true);
                return;
            } else {
                statusText(statusEl, `注意：通过严重错误校验，但存在 ${issues.length} 项优化建议（警告）。`, false);
            }
        } else if (!result.valid) {
            const lines = Array.isArray(result.errors) ? result.errors : ['未知校验错误'];
            showIssuesPanel(lines);
            statusText(statusEl, `校验失败：共 ${lines.length} 项。`, true);
            return;
        }

        pendingUpload = {
            type,
            subject,
            name: finalName,
            data: result.normalized,
            userId: window.DecipherUser ? window.DecipherUser.id : null,
            schoolId: (window.DecipherUser && window.DecipherUser.context && window.DecipherUser.context.user) ? window.DecipherUser.context.user.schoolId : null,
            inputSource: inputSource
        };

        if (confirmBtn) {
            if (canUploadToServer === false) {
                confirmBtn.classList.add('hidden');
                statusText(statusEl, '校验通过：当前为静态部署模式（Netlify），仅支持校验与复制，不支持上传落盘。', false);
            } else {
                confirmBtn.classList.remove('hidden');
            }
        }
        if (!hasAuditIssues) hideIssuesPanel();
        if (!hasAuditIssues && canUploadToServer !== false) {
            statusText(statusEl, `校验通过（来源：${inputSource === 'text' ? '文本框' : '文件'}）：你可以点击“确认上传”，或手动复制到已有文件后再提交。`, false);
        }
    }

    async function confirmUpload() {
        const statusEl = document.getElementById('uploadStatus');
        const fileEl = document.getElementById('datasetFile');
        const textEl = document.getElementById('datasetJsonText');

        if (!pendingUpload) {
            statusText(statusEl, '请先点击“先校验”，校验通过后再上传。', true);
            return;
        }

        try {
            const saved = await uploadToDiskApi(pendingUpload);
            if (fileEl) fileEl.value = '';
            if (textEl) textEl.value = '';
            const userParam = window.DecipherUser && window.DecipherUser.id ? `?user=${window.DecipherUser.id}` : '';
            statusText(statusEl, ``, false);
            statusEl.innerHTML = `上传成功并落盘：${saved.saved.fileName} <a href="/inbox-manager.html${userParam}" class="ml-2 text-indigo-400 underline hover:text-indigo-300">去审批池处理 &rarr;</a>`;
            clearPendingUpload();
            hideRepairPanel();
            hideIssuesPanel();
            window.dispatchEvent(new CustomEvent('decipher:datasets-updated'));
        } catch (error) {
            const msg = String(error && error.message ? error.message : '未知错误');
            const hint = /(Failed to fetch|NetworkError|ECONNREFUSED|HTTP 50\d|HTTP 404|HTTP 0)/i.test(msg)
                ? '（请先运行 node server.js）'
                : '';
            statusText(statusEl, `落盘失败：${msg}${hint}`, true);
        }
    }

    function initUploadPanel() {
        const validateBtn = document.getElementById('datasetUploadBtn');
        if (!validateBtn) return;

        validateBtn.textContent = '先校验';

        const confirmBtn = getOrCreateConfirmUploadBtn();

        validateBtn.addEventListener('click', (e) => {
            e.preventDefault();
            prepareValidation();
        });

        if (confirmBtn) {
            confirmBtn.addEventListener('click', (e) => {
                e.preventDefault();
                confirmUpload();
            });
        }

        if (window.DecipherRuntime && typeof window.DecipherRuntime.ensureApiMode === 'function') {
            window.DecipherRuntime.ensureApiMode()
                .then((apiMode) => {
                    canUploadToServer = !!apiMode;
                    if (!apiMode) {
                        const statusEl = document.getElementById('uploadStatus');
                        const confirmBtnLocal = getOrCreateConfirmUploadBtn();
                        if (confirmBtnLocal) confirmBtnLocal.classList.add('hidden');
                        statusText(statusEl, '静态部署模式（Netlify）：支持校验与修复，不支持创建/上传到服务器。', false);
                    }
                })
                .catch(() => {
                    canUploadToServer = false;
                });
        }

        ['datasetType', 'datasetSubject', 'datasetName', 'datasetFile', 'datasetJsonText'].forEach((id) => {
            const el = document.getElementById(id);
            if (!el) return;
            const eventName = id === 'datasetFile' ? 'change' : 'input';
            el.addEventListener(eventName, () => {
                clearPendingUpload();
                hideRepairPanel();
                hideIssuesPanel();
            });
            if (id !== 'datasetFile') {
                el.addEventListener('change', () => {
                    clearPendingUpload();
                    hideRepairPanel();
                    hideIssuesPanel();
                });
            }
        });
    }

    window.DecipherCustomDatasets = {
        mode: MODE,
        list: function () { return []; },
        get: function () { return null; },
        validateFlashcardData,
        validateDecoderData,
        validatePracticeData
    };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initUploadPanel);
    } else {
        initUploadPanel();
    }
})();
