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
                const topIssues = (audit.issues || []).slice(0, 3).map(issue => `【${issue.rule_id}】${issue.description}`);
                return {
                    valid: false,
                    errors: topIssues.length > 0 ? topIssues : ['难题 JSON 未通过 QA 审计'],
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
        const statusEl = document.getElementById('uploadStatus');
        const confirmBtn = getOrCreateConfirmUploadBtn();

        if (!typeEl || !subjectEl || !nameEl || !fileEl) return;

        clearPendingUpload();

        const type = typeEl.value;
        const subject = normalizeSubject(subjectEl.value);
        const name = (nameEl.value || '').trim();
        const file = fileEl.files && fileEl.files[0];

        if (!file) {
            statusText(statusEl, '请先选择 JSON 文件', true);
            return;
        }

        const finalName = name || file.name.replace(/\.json$/i, '') || '未命名题库';

        let rawText = '';
        try {
            rawText = await file.text();
        } catch (error) {
            statusText(statusEl, `读取文件失败: ${error.message}`, true);
            return;
        }

        let data = null;
        try {
            data = JSON.parse(rawText);
        } catch (error) {
            statusText(statusEl, `JSON 解析失败: ${error.message}`, true);
            return;
        }

        const result = type === 'flashcard' ? validateFlashcardData(data) : validateDecoderData(data);

        if (!result.valid) {
            statusText(statusEl, `校验失败：${result.errors[0]}`, true);
            return;
        }

        pendingUpload = {
            type,
            subject,
            name: finalName,
            data: result.normalized
        };

        if (confirmBtn) confirmBtn.classList.remove('hidden');
        statusText(statusEl, '校验通过：你可以点击“确认上传”，或手动复制到已有文件后再提交。', false);
    }

    async function confirmUpload() {
        const statusEl = document.getElementById('uploadStatus');
        const fileEl = document.getElementById('datasetFile');

        if (!pendingUpload) {
            statusText(statusEl, '请先点击“先校验”，校验通过后再上传。', true);
            return;
        }

        try {
            const saved = await uploadToDiskApi(pendingUpload);
            if (fileEl) fileEl.value = '';
            statusText(statusEl, `上传成功并落盘：${saved.saved.fileName}`, false);
            clearPendingUpload();
            window.dispatchEvent(new CustomEvent('decipher:datasets-updated'));
        } catch (error) {
            statusText(statusEl, `落盘失败：${error.message}（请先运行 node server.js）`, true);
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

        // 任何输入变更都清空待上传状态，避免“旧校验结果”误上传。
        ['datasetType', 'datasetSubject', 'datasetName', 'datasetFile'].forEach((id) => {
            const el = document.getElementById(id);
            if (!el) return;
            const eventName = id === 'datasetFile' ? 'change' : 'input';
            el.addEventListener(eventName, clearPendingUpload);
            if (id !== 'datasetFile') el.addEventListener('change', clearPendingUpload);
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
