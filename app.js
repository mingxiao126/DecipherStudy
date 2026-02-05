// 闪卡应用主逻辑
class FlashCardApp {
    constructor() {
        this.topics = [];
        this.currentTopic = null;
        this.cards = [];
        this.originalCards = []; // 保存原始卡片数据（用于筛选）
        this.currentIndex = 0;
        this.isFlipped = false;
        this.timer = null;
        this.timerSeconds = 10;
        this.timerInterval = null;
        this.masteryData = this.loadMasteryData(); // 从 LocalStorage 加载掌握度数据

        this.init();
    }

    async init() {
        await this.loadTopics();
        this.setupEventListeners();
        this.createStars();
        this.updateStats();
        
        // 等待 KaTeX 库加载完成
        this.waitForKaTeX();
    }

    // 等待 KaTeX 库加载完成
    waitForKaTeX() {
        const checkKaTeX = () => {
            if (typeof renderMathInElement !== 'undefined') {
                console.log('KaTeX 库已加载完成');
                return true;
            }
            return false;
        };

        if (!checkKaTeX()) {
            // 每 100ms 检查一次，最多等待 5 秒
            let attempts = 0;
            const maxAttempts = 50;
            const interval = setInterval(() => {
                attempts++;
                if (checkKaTeX() || attempts >= maxAttempts) {
                    clearInterval(interval);
                }
            }, 100);
        }
    }

    // 从 LocalStorage 加载掌握度数据
    loadMasteryData() {
        try {
            const data = localStorage.getItem('flashcardMastery');
            return data ? JSON.parse(data) : {};
        } catch (error) {
            console.error('加载掌握度数据失败:', error);
            return {};
        }
    }

    // 保存掌握度数据到 LocalStorage
    saveMasteryData() {
        try {
            localStorage.setItem('flashcardMastery', JSON.stringify(this.masteryData));
        } catch (error) {
            console.error('保存掌握度数据失败:', error);
        }
    }

    // 获取卡片的唯一 ID
    getCardId(card, index) {
        // 优先使用卡片自带的 ID
        if (card.id) {
            return card.id;
        }
        // 使用主题文件名 + 原始索引作为 ID
        if (this.currentTopic) {
            // 在原始数组中查找索引
            const originalIndex = this.originalCards.findIndex(c => c === card);
            return `${this.currentTopic}_${originalIndex >= 0 ? originalIndex : index}`;
        }
        // 使用问题文本的前20个字符作为唯一标识
        return `card_${card.question.substring(0, 30).replace(/\s+/g, '_')}`;
    }

    // 加载主题列表
    async loadTopics() {
        try {
            // 添加时间戳避免缓存
            const timestamp = new Date().getTime();
            const response = await fetch(`/content/topics.json?t=${timestamp}`, {
                cache: 'no-cache'
            });
            if (!response.ok) throw new Error('无法加载主题列表');
            
            this.topics = await response.json();
            console.log('加载的主题列表:', this.topics);
            this.populateTopicSelector();
        } catch (error) {
            console.error('加载主题失败:', error);
            document.getElementById('topicSelector').innerHTML = 
                '<option value="">加载失败，请检查 topics.json 文件</option>';
        }
    }

    // 填充主题选择器
    populateTopicSelector() {
        const selector = document.getElementById('topicSelector');
        selector.innerHTML = '<option value="">请选择主题...</option>';
        
        console.log('填充主题选择器，主题数量:', this.topics.length);
        this.topics.forEach(topic => {
            const option = document.createElement('option');
            option.value = topic.file;
            option.textContent = topic.name;
            selector.appendChild(option);
            console.log('添加主题选项:', topic.name, topic.file);
        });
    }

    // 加载选中的主题卡片
    async loadTopicCards(fileName) {
        try {
            const response = await fetch(`/content/${fileName}`);
            if (!response.ok) throw new Error('无法加载卡片数据');
            
            const data = await response.json();
            this.originalCards = Array.isArray(data) ? data : data.cards || [];
            this.currentTopic = fileName.replace('.json', '');
            
            // 为每张卡片添加唯一 ID（如果还没有）
            this.originalCards.forEach((card, index) => {
                if (!card.id) {
                    card.id = `${this.currentTopic}_${index}`;
                }
            });
            
            this.applyFilter();
            this.updateCard();
            this.updateProgress();
            this.updateButtons();
            this.updateStats();
        } catch (error) {
            console.error('加载卡片失败:', error);
            this.showError('加载失败，请检查 JSON 文件格式');
        }
    }

    // 应用筛选（目前不使用筛选功能）
    applyFilter() {
        this.cards = [...this.originalCards];
        // 重置索引
        this.currentIndex = 0;
    }

    // 更新卡片显示
    updateCard() {
        if (this.cards.length === 0) {
            document.getElementById('cardQuestion').textContent = '暂无卡片数据';
            document.getElementById('cardAnswer').textContent = '';
            document.getElementById('cardCategory').textContent = '';
            return;
        }

        const card = this.cards[this.currentIndex];
        const flipCard = document.getElementById('flipCard');
        
        // 添加淡入淡出动画
        flipCard.classList.add('fade-slide-exit');
        
        setTimeout(() => {
            // 更新问题（支持 LaTeX）
            const questionEl = document.getElementById('cardQuestion');
            const questionText = card.question || '问题未设置';
            questionEl.innerHTML = this.renderWithKaTeX(questionText);
            
            // 更新答案（支持 LaTeX 和格式化）
            const answerEl = document.getElementById('cardAnswer');
            const answerText = this.formatAnswer(card.answer || '答案未设置');
            answerEl.innerHTML = this.renderWithKaTeX(answerText);
            
            // 如果答案包含列表，调整容器样式
            if (answerEl.querySelector('.answer-list')) {
                answerEl.style.textAlign = 'left';
            } else {
                answerEl.style.textAlign = 'center';
            }
            
            // 更新逻辑记忆点
            this.updateLogicMemo(card.logic_memo);
            
            // 更新分类
            document.getElementById('cardCategory').textContent = card.category || '未分类';
            
            // 更新题目类型标签
            const typeTag = document.getElementById('cardTypeTag');
            const glossaryBtn = document.getElementById('glossaryBtn');
            
            if (card.type) {
                typeTag.textContent = card.type;
                typeTag.style.display = 'block';
            } else {
                typeTag.style.display = 'none';
            }
            
            // 更新关键词高亮
            this.updateSignalTags(card.signals || []);
            
            // 更新分步逻辑
            this.updateLogicSteps(card.steps || []);
            
            // 更新内嵌词典
            this.updateGlossary(card.glossary || []);
            
            // 如果类型标签和生词按钮同时显示，调整生词按钮位置
            // 移除内联样式，让 CSS 规则控制位置
            if (card.type && card.glossary && card.glossary.length > 0) {
                // CSS 规则会自动处理两个标签同时存在的情况
                glossaryBtn.style.top = '';
            } else if (glossaryBtn.style.display !== 'none') {
                glossaryBtn.style.top = '1.5rem';
            }
            
            // 更新掌握度按钮状态
            this.updateMasteryButtons(card, this.currentIndex);
            
            // 渲染 KaTeX（延迟渲染以确保 DOM 已更新和 KaTeX 库加载完成）
            // 使用更长的延迟，确保所有 DOM 更新完成
            setTimeout(() => {
                this.renderKaTeX();
            }, 300);
            
            // 额外延迟渲染，确保动画完成后也能渲染
            setTimeout(() => {
                this.renderKaTeX();
            }, 600);
            
            // 重置翻转状态
            if (this.isFlipped) {
                flipCard.classList.remove('flipped');
                this.isFlipped = false;
            }
            
            // 添加进入动画
            flipCard.classList.remove('fade-slide-exit');
            flipCard.classList.add('fade-slide-enter');
            
            setTimeout(() => {
                flipCard.classList.remove('fade-slide-enter');
            }, 400);
        }, 200);
    }

    // 渲染 KaTeX 公式（保留原始 $...$ 格式，让 KaTeX 处理）
    renderWithKaTeX(text) {
        if (!text) return '';
        // 处理 Markdown 加粗格式：**文本** 转换为红色加粗
        // 先处理加粗，避免影响 LaTeX 公式
        let processed = text.replace(/\*\*(.*?)\*\*/g, '<strong style="color: #ef4444;">$1</strong>');
        // 返回处理后的文本，保留 $...$ 格式，由 KaTeX 的 renderMathInElement 处理
        return processed;
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
        processed = processed.replace(/\$(\d+(?:\.\d+)?)/g, (match, number, offset) => {
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
        
        percentPlaceholders.forEach(({ placeholder, original }) => {
            restored = restored.replace(placeholder, original);
        });
        
        currencyPlaceholders.forEach(({ placeholder, original }) => {
            restored = restored.replace(placeholder, original);
        });
        
        return restored;
    }

    // 执行 KaTeX 渲染（带预处理）
    renderKaTeX() {
        // 等待 KaTeX 库加载完成
        if (typeof renderMathInElement === 'undefined') {
            if (!this.katexRetryCount) this.katexRetryCount = 0;
            if (this.katexRetryCount < 10) {
                this.katexRetryCount++;
                setTimeout(() => this.renderKaTeX(), 200);
            } else {
                console.warn('KaTeX 库加载超时，公式可能无法正常显示');
            }
            return;
        }

        this.katexRetryCount = 0;

        try {
            const questionEl = document.getElementById('cardQuestion');
            const answerEl = document.getElementById('cardAnswer');
            const logicMemoEl = document.getElementById('logicMemo');
            const logicStepsEl = document.getElementById('logicSteps');
            
            // 渲染配置（优化版）
            const renderOptions = {
                delimiters: [
                    {left: '$$', right: '$$', display: true},   // 块级公式
                    {left: '\\(', right: '\\)', display: false}, // 行内公式 (推荐 JSON 用这个)
                    {left: '$', right: '$', display: false}      // 兼容旧的 $ 格式
                ],
                ignoredClasses: ['no-math'],
                throwOnError: false
            };
            
            // 渲染问题中的公式（带预处理）
            if (questionEl) {
                const questionHTML = questionEl.innerHTML;
                if (questionHTML.includes('$') && !questionHTML.includes('katex') && !questionHTML.includes('katex-display')) {
                    try {
                        const preprocessed = this.preprocessMathText(questionHTML);
                        
                        if (preprocessed.processed !== questionHTML) {
                            questionEl.innerHTML = preprocessed.processed;
                        }
                        
                        renderMathInElement(questionEl, renderOptions);
                        
                        if (preprocessed.currencyPlaceholders.length > 0 || preprocessed.percentPlaceholders.length > 0) {
                            const renderedHTML = questionEl.innerHTML;
                            const restoredHTML = this.restorePlaceholders(
                                renderedHTML,
                                preprocessed.currencyPlaceholders,
                                preprocessed.percentPlaceholders
                            );
                            questionEl.innerHTML = restoredHTML;
                        }
                    } catch (e) {
                        console.warn('问题公式渲染失败:', e);
                    }
                }
            }
            
            // 渲染答案中的公式（带预处理）
            if (answerEl) {
                const answerHTML = answerEl.innerHTML;
                if (answerHTML.includes('$') && !answerHTML.includes('katex') && !answerHTML.includes('katex-display')) {
                    try {
                        const preprocessed = this.preprocessMathText(answerHTML);
                        
                        if (preprocessed.processed !== answerHTML) {
                            answerEl.innerHTML = preprocessed.processed;
                        }
                        
                        renderMathInElement(answerEl, renderOptions);
                        
                        if (preprocessed.currencyPlaceholders.length > 0 || preprocessed.percentPlaceholders.length > 0) {
                            const renderedHTML = answerEl.innerHTML;
                            const restoredHTML = this.restorePlaceholders(
                                renderedHTML,
                                preprocessed.currencyPlaceholders,
                                preprocessed.percentPlaceholders
                            );
                            answerEl.innerHTML = restoredHTML;
                        }
                    } catch (e) {
                        console.warn('答案公式渲染失败:', e);
                    }
                }
            }
            
            // 渲染逻辑记忆点中的公式（带预处理）
            if (logicMemoEl && logicMemoEl.style.display !== 'none') {
                const memoHTML = logicMemoEl.innerHTML;
                if (memoHTML.includes('$') && !memoHTML.includes('katex') && !memoHTML.includes('katex-display')) {
                    try {
                        const preprocessed = this.preprocessMathText(memoHTML);
                        
                        if (preprocessed.processed !== memoHTML) {
                            logicMemoEl.innerHTML = preprocessed.processed;
                        }
                        
                        renderMathInElement(logicMemoEl, renderOptions);
                        
                        if (preprocessed.currencyPlaceholders.length > 0 || preprocessed.percentPlaceholders.length > 0) {
                            const renderedHTML = logicMemoEl.innerHTML;
                            const restoredHTML = this.restorePlaceholders(
                                renderedHTML,
                                preprocessed.currencyPlaceholders,
                                preprocessed.percentPlaceholders
                            );
                            logicMemoEl.innerHTML = restoredHTML;
                        }
                    } catch (e) {
                        console.warn('逻辑记忆点公式渲染失败:', e);
                    }
                }
            }
            
            // 渲染分步逻辑中的公式（带预处理）
            if (logicStepsEl && logicStepsEl.style.display !== 'none') {
                const stepsHTML = logicStepsEl.innerHTML;
                if (stepsHTML.includes('$') && !stepsHTML.includes('katex') && !stepsHTML.includes('katex-display')) {
                    try {
                        const preprocessed = this.preprocessMathText(stepsHTML);
                        
                        if (preprocessed.processed !== stepsHTML) {
                            logicStepsEl.innerHTML = preprocessed.processed;
                        }
                        
                        renderMathInElement(logicStepsEl, renderOptions);
                        
                        if (preprocessed.currencyPlaceholders.length > 0 || preprocessed.percentPlaceholders.length > 0) {
                            const renderedHTML = logicStepsEl.innerHTML;
                            const restoredHTML = this.restorePlaceholders(
                                renderedHTML,
                                preprocessed.currencyPlaceholders,
                                preprocessed.percentPlaceholders
                            );
                            logicStepsEl.innerHTML = restoredHTML;
                        }
                    } catch (e) {
                        console.warn('分步逻辑公式渲染失败:', e);
                    }
                }
            }
        } catch (error) {
            console.error('KaTeX 渲染错误:', error);
            console.error('错误详情:', error.stack);
        }
    }

    // 格式化答案（支持加粗、列表等格式，但不影响 LaTeX）
    formatAnswer(answer) {
        if (!answer) return '';
        
        let formatted = answer;
        
        // 1. 先处理 "例子：" 段落（在列表处理之前，避免干扰）
        formatted = formatted.replace(/(例子[：:]\s*)(.+?)(?=\s+\d+\.|$)/g, '<div class="answer-example"><span class="example-label">$1</span><span class="example-content">$2</span></div>');
        
        // 2. 处理 Markdown 加粗：**文本** 转换为红色加粗
        formatted = formatted.replace(/\*\*(.*?)\*\*/g, '<strong style="color: #ef4444;">$1</strong>');
        
        // 3. 检测并格式化编号列表（格式：1. ... 2. ... 3. ...）
        // 匹配模式：数字 + 点 + 空格 + 内容（直到下一个数字点或结尾）
        const numberedListPattern = /(\d+)\.\s+([^0-9]+?)(?=\s+\d+\.|$)/g;
        const hasNumberedList = numberedListPattern.test(formatted);
        
        if (hasNumberedList) {
            // 重置正则表达式
            numberedListPattern.lastIndex = 0;
            
            // 将编号列表转换为 HTML 列表
            formatted = formatted.replace(numberedListPattern, (match, num, content) => {
                content = content.trim();
                
                // 检查是否包含冒号（定义格式：术语: 定义）
                if (content.includes(':')) {
                    const colonIndex = content.indexOf(':');
                    const term = content.substring(0, colonIndex).trim();
                    const definition = content.substring(colonIndex + 1).trim();
                    return `<div class="answer-list-item"><span class="answer-list-number">${num}.</span><span class="answer-list-term">${term}:</span> <span class="answer-list-def">${definition}</span></div>`;
                } else {
                    return `<div class="answer-list-item"><span class="answer-list-number">${num}.</span><span class="answer-list-content">${content}</span></div>`;
                }
            });
            
            // 包装在列表容器中
            formatted = `<div class="answer-list">${formatted}</div>`;
        }
        
        return formatted;
    }

    // 更新关键词高亮（Signal Tags）
    updateSignalTags(signals) {
        const container = document.getElementById('signalTags');
        container.innerHTML = '';
        
        if (signals && signals.length > 0) {
            signals.forEach(signal => {
                const tag = document.createElement('span');
                tag.className = 'signal-tag';
                tag.textContent = signal;
                container.appendChild(tag);
            });
        }
    }

    // 更新逻辑记忆点显示
    updateLogicMemo(logicMemo) {
        const container = document.getElementById('logicMemo');
        
        if (logicMemo && logicMemo.trim()) {
            container.innerHTML = this.renderWithKaTeX(logicMemo);
            container.style.display = 'block';
            
            // 延迟渲染 KaTeX（确保 DOM 已更新）
            setTimeout(() => {
                this.renderKaTeX();
            }, 250);
        } else {
            container.style.display = 'none';
        }
    }

    // 更新分步逻辑显示
    updateLogicSteps(steps) {
        const container = document.getElementById('logicSteps');
        
        if (steps && steps.length > 0) {
            container.innerHTML = '';
            steps.forEach(step => {
                const stepEl = document.createElement('div');
                stepEl.className = 'logic-step';
                stepEl.innerHTML = this.renderWithKaTeX(step);
                container.appendChild(stepEl);
            });
            container.style.display = 'block';
            
            // 延迟渲染 KaTeX（确保 DOM 已更新）
            setTimeout(() => {
                this.renderKaTeX();
            }, 250);
        } else {
            container.style.display = 'none';
        }
    }

    // 更新内嵌词典
    updateGlossary(glossary) {
        const btn = document.getElementById('glossaryBtn');
        const popup = document.getElementById('glossaryPopup');
        
        if (glossary && glossary.length > 0) {
            btn.style.display = 'block';
            popup.innerHTML = '';
            
            glossary.forEach(item => {
                const itemEl = document.createElement('div');
                itemEl.className = 'glossary-item';
                itemEl.innerHTML = `
                    <div class="glossary-term">${item.term}</div>
                    <div class="glossary-def">${item.definition}</div>
                `;
                popup.appendChild(itemEl);
            });
        } else {
            btn.style.display = 'none';
            popup.classList.remove('show');
        }
    }

    // 更新掌握度按钮状态
    updateMasteryButtons(card, index) {
        const cardId = this.getCardId(card, index);
        const status = this.masteryData[cardId] || null;
        
        const buttons = document.querySelectorAll('.mastery-btn');
        buttons.forEach(btn => {
            const btnStatus = btn.getAttribute('data-status');
            if (btnStatus === status) {
                btn.style.opacity = '1';
                btn.style.transform = 'scale(1.1)';
            } else {
                btn.style.opacity = '0.7';
                btn.style.transform = 'scale(1)';
            }
        });
    }

    // 设置掌握度
    setMastery(status) {
        if (this.cards.length === 0) return;
        
        const card = this.cards[this.currentIndex];
        const cardId = this.getCardId(card, this.currentIndex);
        
        if (status === null) {
            delete this.masteryData[cardId];
        } else {
            this.masteryData[cardId] = status;
        }
        
        this.saveMasteryData();
        this.updateMasteryButtons(card, this.currentIndex);
        this.updateStats();
    }

    // 更新错题统计
    updateStats() {
        let redCount = 0;
        
        // 统计所有主题中的需重练题目
        Object.keys(this.masteryData).forEach(key => {
            if (this.masteryData[key] === 'red') {
                redCount++;
            }
        });
        
        const statsBadge = document.getElementById('statsBadge');
        const redCountEl = document.getElementById('redCount');
        
        if (redCount > 0) {
            statsBadge.classList.remove('hidden');
            redCountEl.textContent = redCount;
        } else {
            statsBadge.classList.add('hidden');
        }
    }

    // 翻转卡片
    flipCard() {
        const flipCard = document.getElementById('flipCard');
        this.isFlipped = !this.isFlipped;
        flipCard.classList.toggle('flipped', this.isFlipped);
    }

    // 上一题
    prevCard() {
        if (this.cards.length === 0) return;
        this.currentIndex = (this.currentIndex - 1 + this.cards.length) % this.cards.length;
        this.updateCard();
        this.updateProgress();
    }

    // 下一题
    nextCard() {
        if (this.cards.length === 0) return;
        this.currentIndex = (this.currentIndex + 1) % this.cards.length;
        this.updateCard();
        this.updateProgress();
    }

    // 随机乱序
    shuffleCards() {
        if (this.cards.length === 0) return;
        
        // Fisher-Yates 洗牌算法
        for (let i = this.cards.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [this.cards[i], this.cards[j]] = [this.cards[j], this.cards[i]];
        }
        
        this.currentIndex = 0;
        this.updateCard();
        this.updateProgress();
        
        // 视觉反馈
        const shuffleBtn = document.getElementById('shuffleBtn');
        shuffleBtn.style.transform = 'rotate(360deg)';
        setTimeout(() => {
            shuffleBtn.style.transform = '';
        }, 500);
    }

    // 更新进度显示
    updateProgress() {
        const progressText = document.getElementById('progressText');
        progressText.textContent = `${this.currentIndex + 1} / ${this.cards.length}`;
    }

    // 更新按钮状态
    updateButtons() {
        const prevBtn = document.getElementById('prevBtn');
        const nextBtn = document.getElementById('nextBtn');
        
        prevBtn.disabled = this.cards.length === 0;
        nextBtn.disabled = this.cards.length === 0;
    }

    // 开始/停止计时器
    toggleTimer() {
        const timerDisplay = document.getElementById('timerDisplay');
        const timerBtn = document.getElementById('timerBtn');
        
        if (this.timerInterval) {
            // 停止计时
            clearInterval(this.timerInterval);
            this.timerInterval = null;
            timerDisplay.classList.add('hidden');
            timerBtn.textContent = '⏱️ 开始计时';
            this.timerSeconds = 10;
        } else {
            // 开始计时
            timerDisplay.classList.remove('hidden');
            timerBtn.textContent = '⏱️ 停止计时';
            this.timerSeconds = 10;
            this.updateTimerDisplay();
            
            this.timerInterval = setInterval(() => {
                this.timerSeconds--;
                this.updateTimerDisplay();
                
                if (this.timerSeconds <= 0) {
                    this.stopTimer();
                    // 自动翻转到下一题
                    this.nextCard();
                }
            }, 1000);
        }
    }

    // 停止计时器
    stopTimer() {
        if (this.timerInterval) {
            clearInterval(this.timerInterval);
            this.timerInterval = null;
        }
        const timerDisplay = document.getElementById('timerDisplay');
        const timerBtn = document.getElementById('timerBtn');
        timerDisplay.classList.add('hidden');
        timerBtn.textContent = '⏱️ 开始计时';
        this.timerSeconds = 10;
    }

    // 更新计时器显示
    updateTimerDisplay() {
        const timerValue = document.getElementById('timerValue');
        timerValue.textContent = this.timerSeconds;
        
        if (this.timerSeconds <= 3) {
            timerValue.classList.add('timer-warning');
        } else {
            timerValue.classList.remove('timer-warning');
        }
    }

    // 设置事件监听器
    setupEventListeners() {
        // 主题选择
        document.getElementById('topicSelector').addEventListener('change', (e) => {
            if (e.target.value) {
                this.loadTopicCards(e.target.value);
            }
        });


        // 卡片翻转（点击卡片主体，但不包括按钮）
        document.getElementById('flipCard').addEventListener('click', (e) => {
            // 如果点击的是按钮或交互元素，不翻转
            if (e.target.closest('.mastery-btn') || 
                e.target.closest('.glossary-btn') || 
                e.target.closest('.glossary-popup')) {
                return;
            }
            // 允许点击卡片任何地方来翻转（标签有 pointer-events: none，会穿透）
            this.flipCard();
        });

        // 掌握度按钮
        document.querySelectorAll('.mastery-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const status = btn.getAttribute('data-status');
                // 如果再次点击已选中的按钮，则取消标记
                const card = this.cards[this.currentIndex];
                const cardId = this.getCardId(card, this.currentIndex);
                if (this.masteryData[cardId] === status) {
                    this.setMastery(null);
                } else {
                    this.setMastery(status);
                }
            });
        });

        // 内嵌词典按钮
        document.getElementById('glossaryBtn').addEventListener('click', (e) => {
            e.stopPropagation();
            const popup = document.getElementById('glossaryPopup');
            popup.classList.toggle('show');
        });

        // 点击外部关闭词典
        document.addEventListener('click', (e) => {
            const popup = document.getElementById('glossaryPopup');
            const btn = document.getElementById('glossaryBtn');
            if (!popup.contains(e.target) && !btn.contains(e.target)) {
                popup.classList.remove('show');
            }
        });

        // 错题统计点击（已移除筛选功能）
        document.getElementById('statsBadge').addEventListener('click', () => {
            // 可以在这里添加其他功能，比如显示错题详情
        });

        // 导航按钮
        document.getElementById('prevBtn').addEventListener('click', () => {
            this.prevCard();
        });

        document.getElementById('nextBtn').addEventListener('click', () => {
            this.nextCard();
        });

        // 随机乱序
        document.getElementById('shuffleBtn').addEventListener('click', () => {
            this.shuffleCards();
        });

        // 计时器
        document.getElementById('timerBtn').addEventListener('click', () => {
            this.toggleTimer();
        });

        document.getElementById('stopTimerBtn').addEventListener('click', () => {
            this.stopTimer();
        });

        // 快捷键
        document.addEventListener('keydown', (e) => {
            // 忽略在输入框中的按键
            if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT' || e.target.tagName === 'TEXTAREA') {
                return;
            }

            switch(e.key) {
                case ' ':
                    e.preventDefault();
                    this.flipCard();
                    break;
                case 'ArrowLeft':
                    e.preventDefault();
                    this.prevCard();
                    break;
                case 'ArrowRight':
                    e.preventDefault();
                    this.nextCard();
                    break;
                case 's':
                case 'S':
                    e.preventDefault();
                    this.shuffleCards();
                    break;
            }
        });
    }

    // 创建星空背景
    createStars() {
        const starsContainer = document.getElementById('stars');
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

    // 显示错误信息
    showError(message) {
        document.getElementById('cardQuestion').textContent = message;
        document.getElementById('cardAnswer').textContent = '';
        document.getElementById('cardCategory').textContent = '';
    }
}

// 初始化应用（确保 KaTeX 加载完成）
function initApp() {
    // 检查 KaTeX 是否已加载
    if (typeof renderMathInElement !== 'undefined' || window.katexLoaded) {
        new FlashCardApp();
    } else {
        // 如果还没加载，等待一下再试
        setTimeout(initApp, 100);
    }
}

// 等待 DOM 和 KaTeX 都加载完成
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initApp);
} else {
    initApp();
}
