/**
 * 难题拆解器主逻辑（严格三态逻辑：点击逐行显示 + 暂停同步）
 * JSON 格式与交互流程见：docs/Decipher-JSON-转换规范.md
 * 类型与校验见：decoder-schema.js
 */
class LogicDecoder {
    constructor() {
        this.topics = [];  // 主题列表
        this.filteredTopics = [];  // 根据科目筛选后的主题
        this.currentSubject = null;  // 当前选择的科目
        this.currentWeekFile = null;  // 当前选择的周次文件
        this.problems = [];  // 当前加载的题目列表（从周次文件中加载）
        this.currentProblem = null;
        this.currentIndex = 0;  // 当前处理的片段索引
        this.isPausedForSync = false;  // 是否正在等待"同步数据"的点击
        this.highlightedSegments = [];  // 已高亮的片段（用于持久化）
        this.currentHighlightIndex = -1;  // 当前正在处理的高亮索引

        this.init();
    }

    async init() {
        await this.loadTopics();
        this.setupEventListeners();
        this.createStars();
    }

    // 加载主题列表
    getCustomDecoderTopics() {
        if (!window.DecipherCustomDatasets || typeof window.DecipherCustomDatasets.list !== 'function') {
            return [];
        }

        return window.DecipherCustomDatasets.list('decoder').map(item => ({
            subject: item.subject || '未分类',
            name: '[自定义] ' + item.name,
            file: 'custom:' + item.id,
            isCustom: true
        }));
    }

    // 加载主题列表
    async loadTopics() {
        const selector = document.getElementById('subjectSelector');
        const customTopics = this.getCustomDecoderTopics();

        try {
            let builtInTopics = [];
            const apiMode = await window.DecipherRuntime.ensureApiMode();

            if (apiMode && window.DecipherUser && window.DecipherUser.id) {
                try {
                    const res = await fetch(`/api/workspaces/${window.DecipherUser.id}/decoder-topics-merged`);
                    if (res.ok) {
                        builtInTopics = await res.json();
                    } else {
                        throw new Error('Merged API failed');
                    }
                } catch (e) {
                    console.warn('Fallback to standard fetchUserTopics', e);
                    builtInTopics = await window.fetchUserTopics('decoder');
                }
            } else {
                builtInTopics = await window.fetchUserTopics('decoder');
            }

            this.topics = [...builtInTopics, ...customTopics];

            // Infer missing subjects
            this.topics.forEach(t => {
                if (!t.subject && t.name) {
                    const match = t.name.match(/^([^-\s]+)\s*-/);
                    if (match) {
                        t.subject = match[1].trim();
                    } else if (t.name.includes('经济学') || t.file.includes('经济学')) {
                        t.subject = '经济学';
                    } else if (t.name.includes('统计学') || t.file.includes('统计学')) {
                        t.subject = '统计学';
                    } else {
                        t.subject = '未分类';
                    }
                }

                if (t.subject) {
                    t.subject = t.subject.replace(/\[.*?\]\s*/g, '').trim();
                }
            });

            this.populateSubjectSelector();
        } catch (error) {
            console.error('加载主题失败:', error);
            this.topics = [...customTopics];

            if (this.topics.length > 0) {
                this.populateSubjectSelector();
            } else if (selector) {
                selector.innerHTML = '<option value="">加载失败，请检查 decoder_topics.json 文件</option>';
            }
        }
    }

    // 填充科目选择器
    populateSubjectSelector() {
        const selector = document.getElementById('subjectSelector');
        selector.innerHTML = '<option value="">请选择科目...</option>';

        // 获取所有唯一的科目
        const subjects = [...new Set(this.topics.map(topic => topic.subject))];
        subjects.forEach(subject => {
            const option = document.createElement('option');
            option.value = subject;
            option.textContent = subject;
            selector.appendChild(option);
        });
    }

    // 填充周次选择器（根据选择的科目）
    populateWeekSelector() {
        const selector = document.getElementById('weekSelector');
        selector.innerHTML = '<option value="">请选择周次/综合大题...</option>';

        if (!this.currentSubject) {
            selector.disabled = true;
            return;
        }

        // 筛选当前科目的主题
        this.filteredTopics = this.topics.filter(topic => topic.subject === this.currentSubject);

        this.filteredTopics.forEach(topic => {
            const option = document.createElement('option');
            option.value = topic.file;

            let prefix = '';
            if (topic.source_scope === 'shared') prefix = '';
            else if (topic.source_scope === 'user') prefix = '[定制] ';

            option.textContent = prefix + topic.name;
            selector.appendChild(option);
        });

        selector.disabled = false;
    }

    // 填充题目选择器（根据选择的周次文件）
    populateProblemSelector() {
        const selector = document.getElementById('problemSelector');
        selector.innerHTML = '<option value="">请选择具体题目...</option>';

        if (!this.problems || this.problems.length === 0) {
            selector.disabled = true;
            return;
        }

        // 显示该周次文件中的所有题目
        this.problems.forEach((problem, index) => {
            const option = document.createElement('option');
            option.value = index;  // 使用索引作为值
            option.textContent = problem.title || problem.id || '题目 ' + (index + 1);
            selector.appendChild(option);
        });

        selector.disabled = false;
    }

    // 加载选中的周次文件（显示题目列表）
    async loadWeekFile(fileName) {
        if (!fileName) return;

        try {
            this.currentWeekFile = fileName;
            let data = null;

            if (fileName.startsWith('custom:')) {
                const datasetId = fileName.replace('custom:', '');
                const dataset = window.DecipherCustomDatasets && window.DecipherCustomDatasets.get
                    ? window.DecipherCustomDatasets.get(datasetId)
                    : null;

                if (!dataset) throw new Error('未找到自定义难题题库');
                data = dataset.data;
            } else {
                data = await window.fetchUserDataset(fileName);
                this.currentTopic = fileName;
            }

            this.problems = (typeof window.normalizeDecoderProblems === 'function')
                ? window.normalizeDecoderProblems(data)
                : (Array.isArray(data) ? data : [data]);

            console.log('加载了 ' + this.problems.length + ' 道题目');

            // 填充题目选择器
            this.populateProblemSelector();

            // 清空当前题目，等待用户选择
            this.currentProblem = null;
            this.resetAll();
        } catch (error) {
            console.error('加载周次文件失败:', error);
            alert('加载周次文件失败，请检查文件是否存在或格式是否正确');
        }
    }

    // 加载选中的具体题目
    loadProblem(problemIndex) {
        if (problemIndex === null || problemIndex === undefined || problemIndex === '') return;

        const index = parseInt(problemIndex);
        if (isNaN(index) || index < 0 || index >= this.problems.length) {
            console.error('无效的题目索引:', problemIndex);
            return;
        }

        this.currentProblem = this.problems[index];
        // 可选：开发时校验题目符合 Decipher 规范
        if (typeof window.validateDecoderProblem === 'function') {
            const { valid, errors } = window.validateDecoderProblem(this.currentProblem);
            if (!valid) console.warn('题目校验未通过:', errors);
        }
        this.currentIndex = 0;
        this.isPausedForSync = false;
        this.highlightedSegments = [];
        this.currentHighlightIndex = -1;
        this.solutionStepIndex = 0;  // 详解步骤索引

        // 重置所有区域
        this.resetAll();

        // 显示原题
        this.displayOriginalQuestion();

        // 显示点击提示
        document.getElementById('clickHint').classList.remove('hidden');
    }

    // 重置所有区域
    resetAll() {
        document.getElementById('decodingSteps').innerHTML = '';
        document.getElementById('conditionsList').innerHTML = '<div class="placeholder">等待提取条件...</div>';
        document.getElementById('trapsList').innerHTML = '<div class="placeholder">暂无陷阱</div>';
        document.getElementById('solutionBox').classList.add('hidden');
        document.getElementById('detailedSolution').innerHTML = '';
    }

    // 显示原题
    displayOriginalQuestion() {
        const container = document.getElementById('originalQuestion');
        if (!this.currentProblem) return;

        this.originalText = this.currentProblem.original_question;
        container.innerHTML = this.renderWithKaTeX(this.originalText);

        // 延迟渲染 KaTeX
        setTimeout(() => this.renderKaTeX(container), 100);
    }

    // 处理点击事件（严格三态逻辑）
    handleClick() {
        if (!this.currentProblem) return;

        const segments = this.currentProblem.segments;
        const traps = this.currentProblem.traps || [];
        const solution = this.currentProblem.solution;

        if (!segments || segments.length === 0) {
            this.handleLegacyClick();
            return;
        }

        // 状态 A：处于暂停等待同步中
        if (this.isPausedForSync) {
            // 同步当前片段的信息到已知条件框
            const currentSegment = segments[this.currentIndex];
            if (currentSegment && currentSegment.has_info) {
                this.syncInformation(currentSegment);
            }

            // 切换状态：取消暂停，索引加1
            this.isPausedForSync = false;
            this.currentIndex++;

            // 不自动继续，等待用户再次点击
            return;
        }

        // 状态 B：处理新片段
        this.processNextSegment();
    }

    // 处理下一个片段
    processNextSegment() {
        const segments = this.currentProblem.segments;
        const traps = this.currentProblem.traps || [];
        const solution = this.currentProblem.solution;

        // 检查是否所有片段都已处理完
        if (this.currentIndex >= segments.length) {
            // 先显示陷阱
            if (traps.length > 0 && !document.getElementById('trapsList').querySelector('.trap-item')) {
                this.showTraps(traps);
                return;
            }

            // 然后逐条显示详解步骤
            if (solution) {
                if (Array.isArray(solution)) {
                    // 新格式：分步显示
                    if (!this.solutionStepIndex) {
                        this.solutionStepIndex = 0;
                    }
                    if (this.solutionStepIndex < solution.length) {
                        this.showSolutionStep(solution[this.solutionStepIndex], this.solutionStepIndex);
                        this.solutionStepIndex++;
                        return;
                    } else {
                        // 所有步骤显示完
                        document.getElementById('clickHint').classList.add('hidden');
                        return;
                    }
                } else {
                    // 旧格式：一次性显示
                    if (document.getElementById('solutionBox').classList.contains('hidden')) {
                        this.showSolution(solution);
                        document.getElementById('clickHint').classList.add('hidden');
                        return;
                    }
                }
            }
            return;
        }

        // 取出当前片段
        const currentSegment = segments[this.currentIndex];

        // 在"解读题目"框显示文本（追加模式）
        this.showSegmentText(currentSegment);

        // 判断是否有信息
        if (currentSegment.has_info) {
            // 触发高亮
            this.highlightText(currentSegment.highlight_text, currentSegment.highlight_color || 'yellow');

            // 设置暂停状态，等待下次点击同步
            this.isPausedForSync = true;
            // 索引不增加，等待同步后再增加
        } else {
            // 纯描述文本，索引加1，继续处理下一个片段（递归）
            this.currentIndex++;
            this.processNextSegment();
        }
    }

    // 显示片段文本（追加模式，不清空之前的内容 + 同步高亮）
    showSegmentText(segment) {
        const container = document.getElementById('decodingSteps');

        const textEl = document.createElement('div');
        textEl.className = 'fade-in mb-2';
        textEl.dataset.segmentIndex = this.currentIndex;  // 保存索引用于后续更新

        // 根据是否有信息和是否为陷阱设置不同的样式
        let textClass = 'text-slate-300 text-sm leading-relaxed';
        let wrapperClass = '';

        if (segment.has_info) {
            textClass = 'text-slate-200 leading-relaxed font-medium';
            // 当前信息高亮（等待同步）
            wrapperClass = 'current-info-highlight';
        }

        // 如果是陷阱，文字变红加粗，并添加抖动动画
        if (segment.is_trap) {
            textClass = 'text-red-500 leading-relaxed font-bold animate-pulse';
            wrapperClass = 'current-info-highlight trap-highlight';
        }

        // 构建HTML，如果有信息则包裹在高亮div中
        let innerHTML = this.renderWithKaTeX(segment.text);
        if (wrapperClass) {
            innerHTML = `<div class="inline-block ${wrapperClass} bg-yellow-400/30 px-1 rounded">${innerHTML}</div>`;
        }

        textEl.innerHTML = `
            <div class="${textClass}">
                ${innerHTML}
            </div>
        `;

        container.appendChild(textEl);

        // 立即渲染 KaTeX（修复公式渲染问题）
        setTimeout(() => {
            this.renderKaTeX(textEl);
        }, 50);
    }

    // 同步信息到已知条件框（状态 A - 使用 ul 列表 + 更新解读框高亮）
    syncInformation(segment) {
        if (!segment || !segment.has_info) return;

        const container = document.getElementById('conditionsList');

        // 移除占位符
        const placeholder = container.querySelector('.placeholder');
        if (placeholder) {
            placeholder.remove();
        }

        // 确保使用 ul 列表结构
        let listEl = container.querySelector('ul');
        if (!listEl) {
            listEl = document.createElement('ul');
            listEl.className = 'space-y-2';
            container.appendChild(listEl);
        }

        // 创建列表项（逐条添加，追加模式）
        const itemEl = document.createElement('li');
        itemEl.className = 'condition-item fade-in';
        itemEl.dataset.conditionId = `condition-${this.currentIndex}`;  // 用于联动闪烁
        itemEl.innerHTML = `
            <div class="font-semibold text-green-300 mb-1">
                ${this.renderWithKaTeX(segment.condition || '')}
            </div>
            <div class="text-sm text-slate-300 mb-1">
                ${segment.knowledge || ''}
            </div>
            ${segment.explanation ? `
                <div class="text-xs text-slate-400 italic">
                    ${this.renderWithKaTeX(segment.explanation)}
                </div>
            ` : ''}
        `;

        listEl.appendChild(itemEl);

        // 更新解读框中的高亮：从 current-info-highlight 变为 permanent-info-highlight
        const decodingContainer = document.getElementById('decodingSteps');
        const segmentEl = decodingContainer.querySelector(`[data-segment-index="${this.currentIndex}"]`);
        if (segmentEl) {
            const highlightSpan = segmentEl.querySelector('.current-info-highlight');
            if (highlightSpan) {
                highlightSpan.classList.remove('current-info-highlight', 'bg-yellow-400/30');
                highlightSpan.classList.add('permanent-info-highlight', 'bg-yellow-400/15');
            }
        }

        // 如果是陷阱，同步到陷阱框
        if (segment.is_trap) {
            this.syncTrap(segment);
        }

        // 添加同步动画效果（绿色边框闪烁）
        const conditionsBox = container.closest('.conditions-box');
        if (conditionsBox) {
            conditionsBox.classList.add('sync-animation');
            setTimeout(() => {
                conditionsBox.classList.remove('sync-animation');
            }, 600);
        }

        // 立即渲染 KaTeX（确保公式正确显示）
        setTimeout(() => {
            this.renderKaTeX(itemEl);
        }, 100);

        // 滚动到底部
        container.scrollTop = container.scrollHeight;
    }

    // 同步陷阱到陷阱框
    syncTrap(segment) {
        const container = document.getElementById('trapsList');

        // 移除占位符
        const placeholder = container.querySelector('.placeholder');
        if (placeholder) {
            placeholder.remove();
        }

        const trapEl = document.createElement('div');
        trapEl.className = 'trap-item fade-in';
        trapEl.innerHTML = `
            <div class="font-semibold text-red-300 mb-2">
                ⚠️ ${segment.knowledge || '陷阱'}
            </div>
            <div class="text-sm text-slate-300">
                ${this.renderWithKaTeX(segment.explanation || '')}
            </div>
        `;

        container.appendChild(trapEl);

        // 立即渲染 KaTeX
        setTimeout(() => {
            this.renderKaTeX(trapEl);
        }, 100);
    }

    // 继续到下一段
    continueToNextSegment() {
        this.currentSegmentIndex++;

        // 继续读取纯描述文本段
        this.continueReadingDescriptiveSegments();
    }

    // 高亮文本（持久化高亮 + 排他性 + 使用 mark 标签）
    highlightText(text, color = 'yellow') {
        if (!text || !this.originalText) return;

        // 更新当前高亮索引
        this.currentHighlightIndex = this.highlightedSegments.length;

        // 保存高亮信息（避免重复）
        if (!this.highlightedSegments.find(h => h.text === text)) {
            this.highlightedSegments.push({ text, color });
        }

        // 从原始文本重新构建，应用所有高亮（确保已高亮部分保持高亮）
        let html = this.originalText;

        // 按顺序应用所有高亮
        this.highlightedSegments.forEach((h, index) => {
            const escaped = h.text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            let highlightClass = 'highlight';

            // 根据颜色设置不同的高亮样式
            if (h.color === 'red' || h.color === 'trap') {
                highlightClass = 'highlight trap';
            } else if (h.color === 'blue') {
                highlightClass = 'highlight active';
            } else if (h.color === 'orange') {
                highlightClass = 'highlight orange';
            } else if (h.color === 'green') {
                highlightClass = 'highlight active';
            } else {
                highlightClass = 'highlight';
            }

            // 排他性：当前高亮用亮色，旧高亮用淡色
            if (index < this.currentHighlightIndex) {
                highlightClass += ' past';  // 旧高亮添加 past 类
            } else if (index === this.currentHighlightIndex) {
                highlightClass += ' current';  // 当前高亮添加 current 类
            }

            // 使用 mark 标签包裹高亮文本
            const highlightTag = `<mark class="${highlightClass}">`;

            // 使用函数替换，避免替换已经高亮的文本
            html = html.replace(
                new RegExp(escaped.replace(/\\\$/g, '\\$'), 'gi'),
                (match, offset, string) => {
                    // 检查这个位置是否已经在高亮标签内
                    const before = string.substring(0, offset);

                    // 如果前后已经有高亮标签，跳过
                    const lastHighlightStart = before.lastIndexOf('<mark class="highlight');
                    if (lastHighlightStart >= 0) {
                        const lastHighlightEnd = before.indexOf('</mark>', lastHighlightStart);
                        if (lastHighlightEnd < 0 || lastHighlightEnd > offset) {
                            return match; // 已经在高亮内，保持原有高亮
                        }
                    }

                    // 也检查 span 标签
                    const lastSpanStart = before.lastIndexOf('<span class="highlight');
                    if (lastSpanStart >= 0) {
                        const lastSpanEnd = before.indexOf('</span>', lastSpanStart);
                        if (lastSpanEnd < 0 || lastSpanEnd > offset) {
                            return match;
                        }
                    }

                    return `${highlightTag}${match}</mark>`;
                }
            );
        });

        const container = document.getElementById('originalQuestion');
        container.innerHTML = this.renderWithKaTeX(html);

        // 立即渲染 KaTeX（修复公式渲染问题）
        setTimeout(() => {
            this.renderKaTeX(container);
        }, 100);
    }

    // 显示陷阱
    showTraps(traps) {
        const container = document.getElementById('trapsList');
        container.innerHTML = '';

        traps.forEach((trap, index) => {
            const trapEl = document.createElement('div');
            trapEl.className = 'trap-item fade-in';
            trapEl.style.animationDelay = `${index * 0.2}s`;
            trapEl.innerHTML = `
                <div class="font-semibold text-red-300 mb-2">
                    ⚠️ ${trap.title || trap.text || ''}
                </div>
                <div class="text-sm text-slate-300">
                    ${this.renderWithKaTeX(trap.description || '')}
                </div>
            `;
            container.appendChild(trapEl);
        });

        // 立即渲染 KaTeX（修复公式渲染问题）
        setTimeout(() => {
            this.renderKaTeX(container);
        }, 100);
    }

    // 显示详解步骤（逐条显示 + 来源标注 + 联动闪烁）
    showSolutionStep(step, index) {
        const solutionBox = document.getElementById('solutionBox');
        const container = document.getElementById('detailedSolution');

        solutionBox.classList.remove('hidden');

        // 如果是第一步，清空容器
        if (index === 0) {
            container.innerHTML = '';
        }

        const stepEl = document.createElement('div');
        stepEl.className = 'solution-step fade-in mb-4';

        // 构建步骤内容
        let stepContent = `
            <div class="text-slate-200 font-semibold mb-2">
                ${step.step || step.step_desc || `步骤 ${index + 1}`}
            </div>
        `;

        // 公式或内容
        if (step.formula || step.content) {
            stepContent += `
                <div class="text-slate-200 text-lg mb-2">
                    ${this.renderWithKaTeX(step.formula || step.content || '')}
                </div>
            `;
        }

        // 来源标注（Badge）
        if (step.source_type) {
            let badgeClass = '';
            let badgeIcon = '';
            let badgeText = '';

            if (step.source_type === 'prompt_info') {
                badgeClass = 'bg-blue-500/20 text-blue-300 border-blue-500/50';
                badgeIcon = '📍';
                badgeText = step.source_label || '本题已知条件';
            } else if (step.source_type === 'external_knowledge') {
                badgeClass = 'bg-purple-500/20 text-purple-300 border-purple-500/50';
                badgeIcon = '💡';
                badgeText = step.source_label || '外部核心知识点';
            }

            stepContent += `
                <div class="inline-block ${badgeClass} border px-3 py-1 rounded-full text-xs font-semibold mt-2 mb-2">
                    ${badgeIcon} ${badgeText}
                </div>
            `;
        }

        // 兼容旧格式
        if (step.note && !step.source_type) {
            stepContent += `
                <div class="text-slate-300 text-sm mb-1">
                    💡 ${this.renderWithKaTeX(step.note)}
                </div>
            `;
        }

        if (step.external_info && !step.source_type) {
            stepContent += `
                <div class="text-blue-300 text-sm italic border-l-2 border-blue-500 pl-3 mt-2">
                    💡 <strong>核心知识点：</strong>${this.renderWithKaTeX(step.external_info)}
                </div>
            `;
        }

        stepEl.innerHTML = stepContent;
        container.appendChild(stepEl);

        // 联动效果：如果引用了已知条件，让对应项闪烁
        if (step.source_type === 'prompt_info' && step.source_refs) {
            this.highlightReferencedConditions(step.source_refs);
        }

        // 立即渲染 KaTeX（修复公式渲染问题）
        setTimeout(() => {
            this.renderKaTeX(stepEl);
        }, 100);

        // 滚动到详解区
        setTimeout(() => {
            solutionBox.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }, 150);
    }

    // 高亮引用的已知条件（联动闪烁效果）
    highlightReferencedConditions(sourceRefs) {
        if (!sourceRefs || !Array.isArray(sourceRefs)) return;

        sourceRefs.forEach(ref => {
            const conditionEl = document.querySelector(`[data-condition-id="${ref}"]`);
            if (conditionEl) {
                // 添加闪烁动画
                conditionEl.classList.add('condition-flash');
                setTimeout(() => {
                    conditionEl.classList.remove('condition-flash');
                }, 1000);
            }
        });
    }

    // 显示详解（支持分步详解）
    showSolution(solution) {
        const solutionBox = document.getElementById('solutionBox');
        const container = document.getElementById('detailedSolution');

        solutionBox.classList.remove('hidden');

        // 检查是字符串还是数组格式
        if (typeof solution === 'string') {
            // 旧格式：直接显示字符串
            let html = `
                <div class="solution-step fade-in">
                    <div class="text-slate-200 text-lg font-semibold mb-2">最终答案：</div>
                    <div class="text-slate-200 text-xl">
                        ${this.renderWithKaTeX(solution)}
                    </div>
                </div>
            `;
            container.innerHTML = html;
        } else if (Array.isArray(solution)) {
            // 新格式：分步详解数组
            let html = '';
            solution.forEach((step, index) => {
                html += `
                    <div class="solution-step fade-in mb-4" style="animation-delay: ${index * 0.2}s">
                        <div class="text-slate-200 font-semibold mb-2">
                            ${step.step || `步骤 ${index + 1}`}
                        </div>
                        ${step.formula ? `
                            <div class="text-slate-200 text-lg mb-2">
                                ${this.renderWithKaTeX(step.formula)}
                            </div>
                        ` : ''}
                        ${step.note ? `
                            <div class="text-slate-300 text-sm mb-1">
                                💡 ${step.note}
                            </div>
                        ` : ''}
                        ${step.external_info ? `
                            <div class="text-blue-300 text-sm italic border-l-2 border-blue-500 pl-3 mt-2">
                                💡 <strong>核心知识点：</strong>${step.external_info}
                            </div>
                        ` : ''}
                    </div>
                `;
            });
            container.innerHTML = html;
        }

        // 立即渲染 KaTeX（修复公式渲染问题）
        setTimeout(() => {
            this.renderKaTeX(container);
        }, 100);

        // 滚动到详解区
        setTimeout(() => {
            solutionBox.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }, 200);
    }

    // 兼容旧结构的点击处理
    handleLegacyClick() {
        // 这里可以保留旧的逻辑，或者提示用户更新 JSON 格式
        console.warn('检测到旧格式的 JSON，请更新为 segments 格式');
    }

    // 渲染 KaTeX 公式，并处理基础 Markdown 列表与货币符号
    renderWithKaTeX(text) {
        if (!text) return '';
        let processed = String(text);

        // 1. 保护作为货币使用的 $ 符号，防止其被误认为 LaTeX 界定符
        processed = processed.replace(/(\d+(?:,\d+)*(?:\.\d+)?)\s*\$(?!\S)/g, '$1 &#36;');
        processed = processed.replace(/(^|\s)\$(\d+(?:,\d+)*(?:\.\d+)?)/g, '$1&#36;$2');

        // 2. 修复双重转义的 LaTeX 命令 (例如 \\frac -> \frac)
        // 这是因为 JSON 文件中常出现 "\\\\frac" ，被 JS 解析为 "\\frac" 
        processed = processed.replace(/\\\\(?=[a-zA-Z])/g, '\\');

        // 2.5 启发式识别：如果文本中包含 LaTeX 命令但没有界定符，自动包裹它
        // 匹配逻辑：包含 \frac, \text, \sqrt, \sum, \mu, \sigma, \alpha 等典型指令但整段没有 $ 或 \(
        const hasRawLatex = /\\(frac|text|sqrt|sum|mu|sigma|alpha|beta|gamma|delta|epsilon|phi|theta|lambda|pi|rho|tau|omega|cdot|times|le|ge|in|notin|neq|approx|iff|implies|Delta|nabla)\{?/.test(processed);
        const hasDelimiters = processed.includes('$') || processed.includes('\\(') || processed.includes('\\[') || processed.includes('$$');

        if (hasRawLatex && !hasDelimiters) {
            // 如果整行看起来就是一个公式，或者包含明显的 LaTeX 指令且没有被保护
            // 我们尝试将其包裹在行内公式中
            processed = `\\(${processed}\\)`;
        }

        // 3. 处理由分号隔开的内联列表 (如 "1. A; 2. B")
        processed = processed.replace(/;\s+(?=\d+\.\s)/g, '\n');

        // 4. 修复被 JS 误解析的特殊 LaTeX 指令 (当原 JSON 使用 \notin 而不是 \\notin 时，会被解析成真实的换行符 + otin)
        // 并且为了防止下一步的 \\n 匹配规则把真正的 \\notin 中的 \\n 给匹配切分掉，先临时替换
        processed = processed.replace(/\notin/g, '\\notin');
        processed = processed.replace(/\neq/g, '\\neq');
        processed = processed.replace(/\\\\notin/g, '__NOTIN__');

        // 5. 将 \n 转换为列表或换行（忽略已被转义的 \\n）
        // 使用负向预查 (?![a-zA-Z]) 来防止切断类似 \\neq, \\nabla 这样的 LaTeX 指令
        let lines = processed.split(/(?<!\\\\)\\\\n(?![a-zA-Z])|\n/);

        let html = '';
        let inUl = false;
        let inOl = false;

        for (let i = 0; i < lines.length; i++) {
            let line = lines[i].trim();
            if (!line) continue;

            if (line.match(/^- /)) {
                if (inOl) { html += '</ol>'; inOl = false; }
                if (!inUl) { html += '<ul class="list-disc pl-6 my-2 space-y-1 text-slate-200 text-left">'; inUl = true; }
                html += '<li>' + line.substring(2) + '</li>';
            } else if (line.match(/^\d+\.\s/)) {
                if (inUl) { html += '</ul>'; inUl = false; }
                if (!inOl) { html += '<ol class="list-decimal pl-6 my-2 space-y-1 text-slate-200 text-left">'; inOl = true; }
                html += '<li>' + line.replace(/^\d+\.\s+/, '') + '</li>';
            } else {
                if (inUl) { html += '</ul>'; inUl = false; }
                if (inOl) { html += '</ol>'; inOl = false; }
                html += '<div>' + line + '</div>';
            }
        }

        if (inUl) html += '</ul>';
        if (inOl) html += '</ol>';

        html = html.replace(/__NOTIN__/g, "\\\\notin");
        return html;
    }

    // 预处理文本：保护货币符号和百分比符号，并修复多余的转义
    preprocessMathText(text) {
        if (!text) return { processed: text, currencyPlaceholders: [], percentPlaceholders: [] };

        let processed = text;

        // 自动修复多余的转义：将 \\% 替换为 %
        processed = processed.replace(/\\%/g, '%');

        const currencyPlaceholders = [];
        const percentPlaceholders = [];

        // 第一步：保护百分比符号（在公式外的）
        let percentIndex = 0;
        processed = processed.replace(/(\d+(?:\.\d+)?)%/g, (match, number, offset) => {
            const before = processed.substring(0, offset);
            const dollarCount = (before.match(/\$/g) || []).length;

            // 如果 $ 数量是奇数，说明在公式内，不保护
            if (dollarCount % 2 === 1) {
                return match;
            }

            const placeholder = `__PERCENT_${percentIndex}__`;
            percentPlaceholders.push({ placeholder, original: match });
            percentIndex++;
            return placeholder;
        });

        // 第二步：保护货币符号（单个 $ 后跟数字）
        let currencyIndex = 0;
        processed = processed.replace(/\$(\d+(?:\.\d+)?)(?=(?:\s|$|[,.!?;:，。！？；：]))/g, (match, number, offset) => {
            const before = processed.substring(0, offset);
            const dollarCount = (before.match(/\$/g) || []).length;

            // 如果 $ 数量是偶数，说明不在公式内，这是货币符号
            if (dollarCount % 2 === 0) {
                const placeholder = `__CURRENCY_${currencyIndex}__`;
                currencyPlaceholders.push({ placeholder, original: match });
                currencyIndex++;
                return placeholder;
            }

            return match; // 在公式内，不处理
        });

        return {
            processed,
            currencyPlaceholders,
            percentPlaceholders
        };
    }

    // 恢复占位符为原始文本
    restorePlaceholders(text, currencyPlaceholders, percentPlaceholders) {
        let restored = text;

        // 恢复百分比占位符
        percentPlaceholders.forEach(({ placeholder, original }) => {
            restored = restored.replace(placeholder, original);
        });

        // 恢复货币占位符
        currencyPlaceholders.forEach(({ placeholder, original }) => {
            restored = restored.replace(placeholder, original);
        });

        return restored;
    }

    // 执行 KaTeX 渲染（带预处理）
    renderKaTeX(element) {
        if (typeof renderMathInElement === 'undefined') {
            setTimeout(() => this.renderKaTeX(element), 100);
            return;
        }

        try {
            if (typeof element === 'string') {
                element = document.querySelector(element);
            }

            if (!element) return;

            // 预处理：保护货币和百分比符号
            const originalHTML = element.innerHTML;
            const preprocessed = this.preprocessMathText(originalHTML);

            // 临时替换 HTML 内容
            if (preprocessed.processed !== originalHTML) {
                element.innerHTML = preprocessed.processed;
            }

            // 渲染 KaTeX（优化配置）
            renderMathInElement(element, {
                delimiters: [
                    { left: '$$', right: '$$', display: true },   // 块级公式
                    { left: '\\(', right: '\\)', display: false }, // 行内公式 (推荐 JSON 用这个)
                    { left: '$', right: '$', display: false }      // 兼容旧的 $ 格式
                ],
                ignoredClasses: ['no-math'],
                throwOnError: false
            });

            // 恢复占位符（在 KaTeX 渲染后）
            if (preprocessed.currencyPlaceholders.length > 0 || preprocessed.percentPlaceholders.length > 0) {
                const renderedHTML = element.innerHTML;
                const restoredHTML = this.restorePlaceholders(
                    renderedHTML,
                    preprocessed.currencyPlaceholders,
                    preprocessed.percentPlaceholders
                );
                element.innerHTML = restoredHTML;
            }
        } catch (error) {
            console.error('KaTeX 渲染错误:', error);
        }
    }

    // 设置事件监听器
    setupEventListeners() {
        // 科目选择器
        document.getElementById('subjectSelector').addEventListener('change', (e) => {
            this.currentSubject = e.target.value;
            this.populateWeekSelector();
            // 清空周次和题目
            this.currentWeekFile = null;
            this.problems = [];
            this.currentProblem = null;
            document.getElementById('problemSelector').innerHTML = '<option value="">请先选择周次...</option>';
            document.getElementById('problemSelector').disabled = true;
            this.resetAll();
        });

        // 周次选择器
        document.getElementById('weekSelector').addEventListener('change', (e) => {
            if (e.target.value) {
                this.loadWeekFile(e.target.value);
            } else {
                this.problems = [];
                this.currentProblem = null;
                document.getElementById('problemSelector').innerHTML = '<option value="">请先选择周次...</option>';
                document.getElementById('problemSelector').disabled = true;
                this.resetAll();
            }
        });

        // 题目选择器
        document.getElementById('problemSelector').addEventListener('change', (e) => {
            if (e.target.value !== '') {
                this.loadProblem(e.target.value);
            }
        });

        // 点击事件（推进步骤）
        document.addEventListener('click', (e) => {
            // 排除选择器和按钮的点击
            if (e.target.tagName === 'SELECT' ||
                e.target.tagName === 'BUTTON' ||
                e.target.closest('select') ||
                e.target.closest('button')) {
                return;
            }

            this.handleClick();
        });

        // 键盘事件（空格键推进）
        document.addEventListener('keydown', (e) => {
            if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT' || e.target.tagName === 'TEXTAREA') {
                return;
            }

            if (e.key === ' ' || e.key === 'Enter') {
                e.preventDefault();
                this.handleClick();
            }
        });

        window.addEventListener("decipher:datasets-updated", () => {
            this.currentSubject = null;
            this.currentWeekFile = null;
            this.problems = [];
            this.currentProblem = null;
            this.loadTopics();
            this.resetAll();
            document.getElementById('weekSelector').innerHTML = '<option value="">请先选择科目...</option>';
            document.getElementById('weekSelector').disabled = true;
            document.getElementById('problemSelector').innerHTML = '<option value="">请先选择周次...</option>';
            document.getElementById("problemSelector").disabled = true;
        });
    }

    // 创建星空背景
    createStars() {
        const starsContainer = document.getElementById('stars');
        if (!starsContainer) return;

        const starCount = 100;

        for (let i = 0; i < starCount; i++) {
            const star = document.createElement('div');
            star.className = 'star';
            star.style.left = Math.random() * 100 + '%';
            star.style.top = Math.random() * 100 + '%';
            star.style.animationDelay = Math.random() * 3 + 's';
            star.style.animationDuration = (Math.random() * 2 + 2) + 's';
            starsContainer.appendChild(star);
        }
    }
}

// 初始化应用
function initDecoder() {
    if (typeof renderMathInElement !== 'undefined' || window.katexLoaded) {
        new LogicDecoder();
    } else {
        setTimeout(initDecoder, 100);
    }
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initDecoder);
} else {
    initDecoder();
}
