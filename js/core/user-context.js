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
        flashcard: 'topics.json',
        decoder: 'decoder_topics.json',
        practice: 'practice_topics.json'
    };

    let apiModeCache = null; // true = local server API available, false = static fallback (e.g. Netlify)

    async function checkApiMode() {
        if (apiModeCache !== null) return apiModeCache;
        try {
            const res = await fetch('/api/health', { cache: 'no-store' });
            apiModeCache = !!res.ok;
        } catch (_e) {
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

    window.DecipherUser = {
        id: userId,
        name: userName,
        logout: function () {
            localStorage.removeItem('decipher_user_id');
            localStorage.removeItem('decipher_user_name');
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

    window.fetchUserTopics = async function (type) {
        const apiMode = await checkApiMode();
        try {
            return apiMode
                ? await fetchJson(window.DecipherUser.getTopicsUrl(type))
                : await fetchJson(window.DecipherUser.getStaticTopicsUrl(type));
        } catch (err) {
            // If API probe was a false positive or API unavailable on static host, fallback once.
            if (apiMode) {
                apiModeCache = false;
                return fetchJson(window.DecipherUser.getStaticTopicsUrl(type));
            }
            throw err;
        }
    };

    window.fetchUserDataset = async function (fileName) {
        const apiMode = await checkApiMode();
        try {
            return apiMode
                ? await fetchJson(window.DecipherUser.getDatasetUrl(fileName))
                : await fetchJson(window.DecipherUser.getStaticDatasetUrl(fileName));
        } catch (err) {
            if (apiMode) {
                apiModeCache = false;
                return fetchJson(window.DecipherUser.getStaticDatasetUrl(fileName));
            }
            throw err;
        }
    };
})();
