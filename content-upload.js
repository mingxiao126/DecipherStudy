(function () {
    const MODE = 'disk';
    let pendingUpload = null;

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
        const gptPanel = document.getElementById('gptPromptPanel');
        if (gptPanel) gptPanel.classList.add('hidden');
    }

    function generateGptPrompt(audit) {
        if (!audit || !audit.issues || audit.issues.length === 0) return '';

        const issuesText = audit.issues.map((issue, idx) => {
            const loc = issue.location ? ` (位置: ${issue.location})` : '';
            const fix = issue.fix_suggestion ? ` 建议: ${issue.fix_suggestion}` : '';
            return `${idx + 1}. [${issue.rule_id}] ${issue.description}${loc}${fix}`;
        }).join('\n');

        return [
            '你之前提供的 JSON 存在以下协议违规项，请严格根据建议修正后，重新输出完整的、符合 Decipher 协议的 JSON。',
            '不要解释，输出纯 JSON（不要 Markdown 代码块，不要前后缀文本）：',
            '',
            issuesText
        ].join('\n');
    }

    function getOrCreateGptPromptPanel() {
        let panel = document.getElementById('gptPromptPanel');
        if (panel) return panel;

        const statusEl = document.getElementById('uploadStatus');
        if (!statusEl || !statusEl.parentElement || !statusEl.parentElement.parentElement) return null;

        panel = document.createElement('div');
        panel.id = 'gptPromptPanel';
        panel.className = 'mt-4 hidden';
        panel.innerHTML = [
            '<label class="block text-slate-300 mb-2 text-sm">AI 修正指令（发送给 ChatGPT）</label>',
            '<div class="flex gap-2 mb-2">',
            '<button id="copyGptPromptBtn" class="btn-primary px-4 py-2 rounded-xl text-xs font-semibold" type="button">复制修正指令</button>',
            '</div>',
            '<div id="gptPromptText" class="w-full max-h-40 overflow-auto px-3 py-2 rounded-xl bg-purple-900/20 border border-purple-500/30 text-purple-200 text-xs font-mono whitespace-pre-wrap"></div>'
        ].join('');

        statusEl.parentElement.parentElement.appendChild(panel);

        const btn = panel.querySelector('#copyGptPromptBtn');
        const textEl = panel.querySelector('#gptPromptText');
        if (btn && textEl) {
            btn.addEventListener('click', async () => {
                try {
                    await navigator.clipboard.writeText(textEl.textContent || '');
                    btn.textContent = '已复制 Prompt';
                    setTimeout(() => { btn.textContent = '复制修正指令'; }, 1500);
                } catch (e) {
                    console.error('复制失败', e);
                }
            });
        }
        return panel;
    }

    function showGptPromptPanel(prompt) {
        const panel = getOrCreateGptPromptPanel();
        if (!panel) return;
        const textEl = panel.querySelector('#gptPromptText');
        if (textEl) textEl.textContent = prompt || '';
        panel.classList.remove('hidden');
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

        const result = type === 'flashcard' ? validateFlashcardData(data) : validateDecoderData(data);

        // 如果存在审计结果，哪怕不是 Blocker（即 valid 为 true），也显示警告面板
        const hasAuditIssues = !!(result.audit && result.audit.issues && result.audit.issues.length > 0);

        if (hasAuditIssues) {
            const issues = (result.audit.issues || []).map(issue => {
                const fix = issue.fix_suggestion ? ` 建议：${issue.fix_suggestion}` : '';
                const where = issue.location ? ` 位置：${issue.location}` : '';
                return `【${issue.rule_id}】${issue.description}${where}${fix}`;
            });
            showIssuesPanel(issues);

            const prompt = generateGptPrompt(result.audit);
            showGptPromptPanel(prompt);

            if (!result.valid) {
                statusText(statusEl, `校验失败：共 ${issues.length} 项。请按下方清单或使用 AI 修正指令进行调整。`, true);
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
            data: result.normalized
        };

        if (confirmBtn) confirmBtn.classList.remove('hidden');
        if (!hasAuditIssues) hideIssuesPanel();
        if (!hasAuditIssues) {
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
            statusText(statusEl, `上传成功并落盘：${saved.saved.fileName}`, false);
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
        validateDecoderData
    };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initUploadPanel);
    } else {
        initUploadPanel();
    }
})();
