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

    // Unified API fetch helpers
    window.fetchUserTopics = function (type) {
        return fetch(window.DecipherUser.getTopicsUrl(type)).then(r => r.json());
    };
    window.fetchUserDataset = function (fileName) {
        return fetch(window.DecipherUser.getDatasetUrl(fileName)).then(r => r.json());
    };
})();
