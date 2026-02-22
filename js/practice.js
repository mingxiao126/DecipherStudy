class PracticeApp {
    constructor() {
        this.topics = [];
        this.questions = [];
        this.currentTopic = null;
        this.userAnswers = {}; // { qIdx: answer }

        this.container = document.getElementById('questionsContainer');
        this.modal = document.getElementById('analysisModal');
        this.modalBody = document.getElementById('modalBody');
        this.topicSelector = document.getElementById('topicSelector');
        this.closeModalBtn = document.getElementById('closeModal');
    }

    async init() {
        await this.loadTopics();
        this.setupEventListeners();
    }

    async loadTopics() {
        try {
            const builtInTopics = await window.fetchUserTopics('practice');
            this.topics = builtInTopics;

            this.topicSelector.innerHTML = '<option value="">选择习题集...</option>';
            this.topics.forEach(topic => {
                const opt = document.createElement('option');
                opt.value = topic.file;
                opt.textContent = topic.name;
                this.topicSelector.appendChild(opt);
            });
        } catch (error) {
            console.error('Error loading topics:', error);
            this.container.innerHTML = `<div class="text-red-400 py-10 text-center">加载题库列表失败: ${error.message}</div>`;
        }
    }

    async loadQuestions(file) {
        if (!file) {
            this.container.innerHTML = '<div class="text-center py-20 text-slate-500 italic">请选择左上角的习题集开始练习</div>';
            return;
        }

        try {
            this.container.innerHTML = '<div class="text-center py-20 text-slate-400">正在加载题目...</div>';
            const data = await window.fetchUserDataset(file);
            this.questions = typeof window.normalizePracticeQuestions === 'function'
                ? window.normalizePracticeQuestions(data)
                : (Array.isArray(data) ? data : []);

            this.userAnswers = {};
            this.renderQuestions();
        } catch (error) {
            console.error('Error loading questions:', error);
            this.container.innerHTML = `<div class="text-red-400 py-10 text-center">加载题目失败: ${error.message}</div>`;
        }
    }

    renderQuestions() {
        if (this.questions.length === 0) {
            this.container.innerHTML = '<div class="text-center py-20 text-slate-500 italic">该题库暂无题目</div>';
            return;
        }

        this.container.innerHTML = '';
        this.questions.forEach((q, index) => {
            const qEl = document.createElement('div');
            qEl.className = 'question-item';
            qEl.id = `q-item-${index}`;

            let html = `
                <div class="flex justify-between items-start mb-4">
                    <span class="text-purple-400 font-bold text-sm uppercase tracking-wider">${this.getTypeLabel(q.type)}</span>
                    <span class="text-slate-500 text-xs"># ${index + 1}</span>
                </div>
                <div class="text-lg text-white mb-6 leading-relaxed">${this.preprocessMath(q.question)}</div>
            `;

            if (q.type === 'choice') {
                html += `<div class="options-list grid gap-3" data-q-idx="${index}">
                    ${q.options.map((opt, i) => {
                    const label = String.fromCharCode(65 + i);
                    return `
                            <div class="option-item" data-val="${label}">
                                <span class="option-label">${label}</span>
                                <span class="option-text">${this.preprocessMath(opt)}</span>
                            </div>
                        `;
                }).join('')}
                </div>`;
            } else if (q.type === 'bool') {
                html += `<div class="options-list flex gap-4" data-q-idx="${index}">
                        <div class="option-item flex-1 justify-center" data-val="true">正确</div>
                        <div class="option-item flex-1 justify-center" data-val="false">错误</div>
                </div>`;
            } else {
                html += `<div class="mt-4 p-4 rounded-lg bg-slate-800/50 border border-slate-700 italic text-slate-400 text-sm">此题为问答大题，请思考后点击下方查看详解</div>`;
            }

            html += `
                <div class="mt-6 flex justify-end">
                    <button class="analysis-trigger text-sm" data-idx="${index}">
                        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"></path></svg>
                        <span>查看详解 & 拆解步骤</span>
                    </button>
                </div>
            `;

            qEl.innerHTML = html;
            this.container.appendChild(qEl);
        });

        this.applyMath();
    }

    getTypeLabel(type) {
        switch (type) {
            case 'choice': return '选择题';
            case 'bool': return '判断题';
            case 'essay': return '大题';
            default: return '未知题型';
        }
    }

    preprocessMath(text) {
        if (!text) return '';
        return text.replace(/\\/g, '\\\\');
    }

    applyMath(element = this.container) {
        if (window.renderMathInElement) {
            window.renderMathInElement(element, {
                delimiters: [
                    { left: '$$', right: '$$', display: true },
                    { left: '$', right: '$', display: false }
                ],
                throwOnError: false
            });
        }
    }

    setupEventListeners() {
        this.topicSelector.addEventListener('change', (e) => {
            this.loadQuestions(e.target.value);
        });

        this.container.addEventListener('click', (e) => {
            const option = e.target.closest('.option-item');
            if (option) {
                const list = option.parentElement;
                const qIdx = parseInt(list.dataset.qIdx);
                const val = option.dataset.val;
                this.handleAnswer(qIdx, val, list);
                return;
            }

            const trigger = e.target.closest('.analysis-trigger');
            if (trigger) {
                const idx = parseInt(trigger.dataset.idx);
                this.showAnalysis(idx);
            }
        });

        this.closeModalBtn.addEventListener('click', () => {
            this.modal.classList.remove('show');
        });

        this.modal.addEventListener('click', (e) => {
            if (e.target === this.modal) this.modal.classList.remove('show');
        });
    }

    handleAnswer(qIdx, selectedValue, listElement) {
        if (this.userAnswers[qIdx] !== undefined) return; // 禁用重复点击

        const q = this.questions[qIdx];
        const correctAnswer = String(q.answer);
        const selectedStr = String(selectedValue);

        this.userAnswers[qIdx] = selectedStr;

        const options = listElement.querySelectorAll('.option-item');
        options.forEach(opt => {
            const val = opt.dataset.val;
            if (val === correctAnswer) {
                opt.classList.add('correct-highlight');
            } else if (val === selectedStr) {
                opt.classList.add('wrong-highlight');
            }
            opt.style.cursor = 'default';
        });
    }

    showAnalysis(idx) {
        const q = this.questions[idx];
        if (!q) return;

        let html = `
            <div class="mb-8">
                <div class="flex items-center justify-between mb-6 border-b border-slate-700 pb-4">
                    <div class="flex items-center gap-3">
                        <span class="px-3 py-1 rounded-full bg-indigo-500/20 text-indigo-400 text-xs font-bold uppercase tracking-widest">${this.getTypeLabel(q.type)}</span>
                        <h2 class="text-2xl font-bold text-white tracking-tight">题目详解 & 逻辑拆解</h2>
                    </div>
                    <div class="text-slate-500 text-sm">Question ID: ${q.id}</div>
                </div>
        `;

        // 1. 解读题目 (Decoding Section)
        if (q.analysis.decoding && Array.isArray(q.analysis.decoding)) {
            html += `
                <div class="analysis-section">
                    <div class="section-header">
                        <svg class="w-5 h-5 text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"></path></svg>
                        <span>【解读题目】</span>
                    </div>
                    <div class="box-blue p-5 space-y-4">
                        <div class="text-slate-400 text-sm mb-4 leading-relaxed italic border-b border-blue-500/10 pb-3">
                            “${this.preprocessMath(q.question)}”
                        </div>
                        <div class="grid gap-3">
                            ${q.analysis.decoding.map(seg => `
                                <div class="decode-segment border-l-2 border-blue-500/40 pl-3">
                                    <div class="flex items-start gap-3">
                                        <span class="text-blue-400 text-xs mt-1">💡</span>
                                        <div class="text-slate-200 text-sm leading-relaxed">${this.preprocessMath(seg)}</div>
                                    </div>
                                </div>
                            `).join('')}
                        </div>
                    </div>
                </div>
            `;
        }

        // 2. 已知条件 & 知识点 (Known Conditions)
        if (q.analysis.conditions && Array.isArray(q.analysis.conditions)) {
            html += `
                <div class="analysis-section">
                    <div class="section-header">
                        <svg class="w-5 h-5 text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"></path></svg>
                        <span>【已知条件 & 知识点】</span>
                    </div>
                    <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                        ${q.analysis.conditions.map(cond => `
                            <div class="box-green p-4 flex flex-col h-full">
                                <div class="text-green-400 font-bold text-sm mb-2">${this.preprocessMath(cond.title)}</div>
                                <div class="text-white text-md font-mono mb-2">${this.preprocessMath(cond.content)}</div>
                                ${cond.description ? `<div class="text-slate-400 text-xs italic mt-auto">${this.preprocessMath(cond.description)}</div>` : ''}
                            </div>
                        `).join('')}
                    </div>
                </div>
            `;
        }

        // 3. 题目陷阱 (Traps Section)
        if (q.analysis.traps && Array.isArray(q.analysis.traps)) {
            html += `
                <div class="analysis-section">
                    <div class="section-header">
                        <svg class="w-5 h-5 text-rose-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"></path></svg>
                        <span>【题目陷阱】</span>
                    </div>
                    <div class="space-y-3">
                        ${q.analysis.traps.map(trap => `
                            <div class="box-red p-4 border-l-4 border-rose-500">
                                <div class="text-rose-400 font-bold text-sm mb-1">⚠️ ${this.preprocessMath(trap.title)}</div>
                                <div class="text-slate-400 text-sm leading-relaxed">${this.preprocessMath(trap.description)}</div>
                            </div>
                        `).join('')}
                    </div>
                </div>
            `;
        }

        // 4. 详细解答 (Steps Section)
        if (q.analysis.steps && Array.isArray(q.analysis.steps)) {
            html += `
                <div class="analysis-section">
                    <div class="section-header">
                        <svg class="w-5 h-5 text-indigo-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path d="M13 10V3L4 14h7v7l9-11h-7z"></path></svg>
                        <span>【详细解答】</span>
                    </div>
                    <div class="space-y-4">
                        ${q.analysis.steps.map((step, i) => `
                            <div class="step-card">
                                <div class="flex flex-col gap-2">
                                    <div class="text-slate-100 font-bold">${this.preprocessMath(step.title)}</div>
                                    <div class="text-slate-300 text-sm leading-relaxed mb-3">${this.preprocessMath(step.content)}</div>
                                    <div class="flex">
                                        <span class="segment-tag tag-purple">
                                            <svg class="w-3 h-3 mr-1" fill="currentColor" viewBox="0 0 20 20"><path d="M7 3a1 1 0 000 2h6a1 1 0 100-2H7zM4 7a1 1 0 011-1h10a1 1 0 110 2H5a1 1 0 01-1-1zM2 11a2 2 0 012-2h12a2 2 0 012 2v4a2 2 0 01-2 2H4a2 2 0 01-2-2v-4z"></path></svg>
                                            ${step.tag || 'Calculation Step ' + (i + 1)}
                                        </span>
                                    </div>
                                </div>
                            </div>
                        `).join('')}
                    </div>
                </div>
            `;
        } else if (q.analysis.solution) {
            // Fallback to simple solution if steps are missing
            html += `
                <div class="analysis-section">
                    <div class="section-header">【解题逻辑】</div>
                    <div class="text-slate-200 leading-relaxed bg-slate-900/40 p-5 rounded-2xl border border-slate-700/50">
                        ${this.preprocessMath(q.analysis.solution)}
                    </div>
                </div>
            `;
        }

        // 5. 选项解析 (仅限选择题)
        if (q.type === 'choice' && q.analysis.option_analysis && Array.isArray(q.analysis.option_analysis)) {
            html += `
                <div class="analysis-section">
                    <div class="section-header">【选项解析】</div>
                    <div class="grid gap-3">
                        ${q.analysis.option_analysis.map(item => `
                            <div class="p-3 rounded-lg bg-rose-950/10 border border-rose-500/20 text-sm">
                                <strong class="text-rose-400 mr-2">${item.label} 选项:</strong>
                                <span class="text-slate-400">${this.preprocessMath(item.reason)}</span>
                            </div>
                        `).join('')}
                    </div>
                </div>
            `;
        }

        const kpList = Array.isArray(q.analysis.knowledge_points) ? q.analysis.knowledge_points : (Array.isArray(q.knowledge_points) ? q.knowledge_points : []);
        const sourceText = q.analysis.source || q.source || '';

        html += `
            <div class="grid grid-cols-1 md:grid-cols-2 gap-6 mt-10 pt-8 border-t border-slate-700/50">
                ${kpList.length > 0 ? `
                <div>
                    <div class="text-emerald-400 font-bold mb-3 text-sm uppercase tracking-wider">考察知识点</div>
                    <div class="flex flex-wrap gap-2">
                        ${kpList.map(kp => `<span class="px-2.5 py-1 rounded-md bg-emerald-500/10 border border-emerald-500/20 text-emerald-300 text-xs font-semibold">${kp}</span>`).join('')}
                    </div>
                </div>
                ` : '<div></div>'}
                ${sourceText ? `
                <div class="md:text-right">
                    <div class="text-orange-400 font-bold mb-3 text-sm uppercase tracking-wider">题目出处</div>
                    <div class="text-slate-400 text-sm italic">“${sourceText}”</div>
                </div>
                ` : ''}
            </div>
            
            <div class="mt-10 p-6 rounded-2xl bg-emerald-500/5 border border-emerald-500/20 text-center">
                <span class="text-slate-400 text-sm mr-2">参考答案:</span>
                <span class="text-emerald-400 text-xl font-black">${q.answer === true ? '正确' : (q.answer === false ? '错误' : q.answer)}</span>
            </div>
        `;

        this.modalBody.innerHTML = html;
        this.modal.classList.add('show');
        this.applyMath(this.modalBody);
    }
}

document.addEventListener('DOMContentLoaded', () => {
    const app = new PracticeApp();
    app.init();
});
