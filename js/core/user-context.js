(function () {
    const urlParams = new URLSearchParams(window.location.search);
    let userId = urlParams.get('user');
    let userName = localStorage.getItem(`decipher_user_name_${userId}`) || userId;

    // LocalStorage fallback if no URL param
    if (!userId) {
        userId = localStorage.getItem('decipher_user_id');
        userName = localStorage.getItem('decipher_user_name');
    }

    const isSelectorPage = window.location.pathname === '/' || window.location.pathname.endsWith('index.html');

    if (!userId && !isSelectorPage) {
        window.location.href = '/index.html';
        return;
    }

    // Persist to localStorage
    if (userId) {
        localStorage.setItem('decipher_user_id', userId);
        localStorage.setItem('decipher_user_name', userName);
    }

    const TOPIC_INDEX_MAP = {
        flashcard: 'flashcard_topics.json',
        decoder: 'decoder_topics.json',
        practice: 'practice_topics.json'
    };

    let apiModeCache = null; // true = local server API available, false = static fallback (e.g. Netlify)

    async function checkApiMode() {
        if (apiModeCache !== null) return apiModeCache;

        // Eagerly assume API mode if running on localhost or 127.0.0.1
        const isLocalHost = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';

        try {
            // First attempt
            const res = await fetch('/api/health', { cache: 'no-store' });
            if (res.ok) {
                apiModeCache = true;
                return true;
            }
        } catch (_e) {
            // Silence initial error
        }

        // Only fallback to static if local dev server probe absolutely fails after a short retry
        if (isLocalHost) {
            try {
                await new Promise(r => setTimeout(r, 500)); // wait a bit for server if it's lagging
                const res = await fetch('/api/health', { cache: 'no-store' });
                apiModeCache = !!res.ok;
            } catch (_e) {
                apiModeCache = false;
            }
        } else {
            apiModeCache = false;
        }

        return apiModeCache;
    }

    async function fetchJson(url) {
        const res = await fetch(url, { cache: 'no-store' });
        if (!res.ok) {
            throw new Error(`HTTP ${res.status}: ${url}`);
        }
        return res.json();
    }

    // Phase 4: Fetch and cache user context
    async function loadAndCacheUserContext() {
        if (!userId) return;

        const cachedId = sessionStorage.getItem('decipher_current_user_id');
        const cachedCtxStr = sessionStorage.getItem('decipher_current_user_context');

        if (cachedId === userId && cachedCtxStr) {
            try {
                window.DecipherUser.context = JSON.parse(cachedCtxStr);
                return;
            } catch (e) {
                console.warn('Context cache parse failed, refetching...');
            }
        }

        sessionStorage.removeItem('decipher_current_user_id');
        sessionStorage.removeItem('decipher_current_user_context');

        try {
            const apiMode = await checkApiMode();
            if (!apiMode) return; // skip in static mode

            const res = await fetch(`/api/users/${userId}/context`);
            const data = await res.json();

            if (!res.ok) {
                throw new Error((data.errors && data.errors[0]) || `错误码 ${res.status}`);
            }

            sessionStorage.setItem('decipher_current_user_id', userId);
            sessionStorage.setItem('decipher_current_user_context', JSON.stringify(data));
            window.DecipherUser.context = data;

        } catch (error) {
            console.error('Failed to load user context:', error);
            alert(`无法加载用户配置 (${userId})：\n${error.message}\n请联系管理员或切换回有效用户。`);
        }
    }

    window.DecipherUser = {
        id: userId,
        name: userName,
        context: null, // Will be populated
        logout: function () {
            localStorage.removeItem('decipher_user_id');
            localStorage.removeItem('decipher_user_name');
            sessionStorage.removeItem('decipher_current_user_id');
            sessionStorage.removeItem('decipher_current_user_context');
            window.location.href = '/index.html';
        },
        // Database-ready API helpers
        getDatasetUrl: function (fileName) {
            return `/api/workspaces/${userId}/datasets/${encodeURIComponent(fileName)}`;
        },
        getTopicsUrl: function (type = 'flashcard') {
            return `/api/workspaces/${userId}/topics?type=${type}`;
        },
        // Static fallback helpers (Netlify)
        getStaticDatasetUrl: function (fileName) {
            return `/content/${userId}/${encodeURIComponent(fileName)}`;
        },
        getStaticTopicsUrl: function (type = 'flashcard') {
            const file = TOPIC_INDEX_MAP[type] || TOPIC_INDEX_MAP.flashcard;
            return `/content/${userId}/${file}`;
        },
        // Helper to append user suffix to any URL
        withContext: function (url) {
            if (!userId) return url;
            const separator = url.includes('?') ? '&' : '?';
            return `${url}${separator}user=${userId}`;
        }
    };

    // Phase 4: Fire eagerly after DecipherUser object is defined
    if (userId) {
        loadAndCacheUserContext();
    }

    // Auto-update all navigation links to include user context
    const updateLinksWithContext = () => {
        if (!userId) return;
        document.querySelectorAll('a[href]').forEach(a => {
            const href = a.getAttribute('href');
            if (href && !href.startsWith('http') && !href.startsWith('#') && !href.includes('user=')) {
                a.href = window.DecipherUser.withContext(href);
            }
        });
    };

    // Auto-inject user info into UI (Securely)
    document.addEventListener('DOMContentLoaded', () => {
        updateLinksWithContext();

        if (userId && !isSelectorPage) {
            const userInfo = document.createElement('div');
            userInfo.className = 'fixed top-4 right-4 z-[100] flex items-center gap-3 glass-card px-4 py-2 rounded-full border border-slate-700/50 text-sm shadow-xl';
            userInfo.style.background = 'rgba(15, 23, 42, 0.8)';
            userInfo.style.backdropFilter = 'blur(8px)';
            userInfo.style.color = 'rgb(148, 163, 184)';

            // Use textContent instead of innerHTML for user-provided data
            const iconGroup = document.createElement('span');
            iconGroup.className = 'flex items-center gap-2';

            const dot = document.createElement('span');
            dot.className = 'w-2 h-2 rounded-full bg-emerald-500 animate-pulse';

            const nameLbl = document.createElement('span');
            nameLbl.className = 'font-medium text-slate-200';
            nameLbl.textContent = userName;

            iconGroup.append(dot, nameLbl);

            const sep = document.createElement('span');
            sep.className = 'w-px h-4 bg-slate-700';

            const btn = document.createElement('button');
            btn.className = 'hover:text-indigo-400 transition-colors';
            btn.textContent = '切换工作区';
            btn.onclick = () => window.DecipherUser.logout();

            userInfo.append(iconGroup, sep, btn);
            document.body.appendChild(userInfo);
        }
    });

    window.DecipherRuntime = {
        ensureApiMode: checkApiMode,
        isApiModeSync: function () { return apiModeCache; }
    };

    // Unified data helpers: prefer API, fallback to static content for Netlify static hosting
    window.fetchUsersList = async function () {
        const apiMode = await checkApiMode();
        if (apiMode) {
            return fetchJson('/api/users');
        }
        const users = await fetchJson('/content/users.json');
        return (Array.isArray(users) ? users : []).filter(u => u && u.status === 'active' && !u.isSystem);
    };

    window.createUserWorkspace = async function (payload) {
        const apiMode = await checkApiMode();
        if (!apiMode) {
            throw new Error('当前为静态部署模式（Netlify），不支持创建工作区。请在本地运行 node server.js。');
        }
        const res = await fetch('/api/create-user', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload || {})
        });
        const result = await res.json().catch(() => ({}));
        if (!res.ok || !result.ok) {
            const msg = Array.isArray(result.errors) && result.errors[0] ? result.errors[0] : `HTTP ${res.status}`;
            throw new Error(msg);
        }
        return result;
    };

    // 静态模式下合并共享 + 个人 topics（复刻 server 端 _getMergedTopics 逻辑）
    const TOPIC_INDEX_FILES = {
        flashcard: 'flashcard_topics.json',
        decoder: 'decoder_topics.json',
        practice: 'practice_topics.json'
    };

    async function mergeTopicsStatic(type) {
        const indexFile = TOPIC_INDEX_FILES[type] || TOPIC_INDEX_FILES.flashcard;
        const mergedMap = new Map();

        // 1. 尝试读取用户 meta.json 获取 schoolId 和 enabledSubjects
        try {
            const meta = await fetchJson(`/content/${userId}/meta.json`);
            if (meta && meta.schoolId && Array.isArray(meta.enabledSubjects)) {
                // 2. 加载每个 subject 的共享 topics
                for (const subjectId of meta.enabledSubjects) {
                    try {
                        const sharedTopics = await fetchJson(
                            `/content/shared/${meta.schoolId}/${subjectId}/${indexFile}`
                        );
                        if (Array.isArray(sharedTopics)) {
                            sharedTopics.forEach(t => {
                                if (t && t.file) {
                                    mergedMap.set(t.file, { ...t, source_scope: 'shared' });
                                }
                            });
                        }
                    } catch (e) {
                        // 该科目可能没有此类型的 topics，跳过
                    }
                }
            }
        } catch (e) {
            console.warn('Static merge: meta.json 读取失败，仅返回个人 topics');
        }

        // 3. 加载个人 topics（覆盖共享，优先级更高）
        try {
            const userTopics = await fetchJson(`/content/${userId}/${indexFile}`);
            if (Array.isArray(userTopics)) {
                userTopics.forEach(t => {
                    if (t && t.file) {
                        mergedMap.set(t.file, { ...t, source_scope: 'user' });
                    }
                });
            }
        } catch (e) {
            // 个人 topics 文件可能不存在
        }

        return Array.from(mergedMap.values());
    }

    window.fetchUserTopics = async function (type) {
        const apiMode = await checkApiMode();
        if (apiMode) {
            try {
                return await fetchJson(window.DecipherUser.getTopicsUrl(type));
            } catch (err) {
                // API 失败，尝试静态合并
                return mergeTopicsStatic(type);
            }
        }
        // 静态模式：合并共享 + 个人
        return mergeTopicsStatic(type);
    };

    window.fetchUserDataset = async function (fileName) {
        const apiMode = await checkApiMode();
        if (apiMode) {
            try {
                return await fetchJson(window.DecipherUser.getDatasetUrl(fileName));
            } catch (err) {
                // API 失败，尝试静态 fallback
                return fetchDatasetStatic(fileName);
            }
        }
        return fetchDatasetStatic(fileName);
    };

    // 静态模式下按优先级尝试：个人目录 → 共享目录
    async function fetchDatasetStatic(fileName) {
        // 1. 先尝试个人目录
        try {
            return await fetchJson(`/content/${userId}/${encodeURIComponent(fileName)}`);
        } catch (e) {
            // 个人目录没有，继续尝试共享目录
        }

        // 2. 尝试从 meta.json 获取学校信息，遍历共享目录
        try {
            const meta = await fetchJson(`/content/${userId}/meta.json`);
            if (meta && meta.schoolId && Array.isArray(meta.enabledSubjects)) {
                for (const subjectId of meta.enabledSubjects) {
                    try {
                        return await fetchJson(
                            `/content/shared/${meta.schoolId}/${subjectId}/${encodeURIComponent(fileName)}`
                        );
                    } catch (e) {
                        // 此 subject 下没有该文件，继续
                    }
                }
            }
        } catch (e) {
            // meta.json 读取失败
        }

        throw new Error(`Dataset not found: ${fileName}`);
    }
})();
