/**
 * Inbox Manager - Fetches and displays content/inbox/index.json records 
 * (Read-Only Phase 9A)
 */

class InboxManager {
    constructor() {
        this.records = [];
        this.tbody = document.getElementById('inboxTableBody');
        this.init();
    }

    async init() {
        await this.loadRecords();
        this.renderTable();
    }

    async loadRecords() {
        try {
            const apiMode = await window.DecipherRuntime.ensureApiMode();
            if (!apiMode) {
                const tr = document.createElement('tr');
                const td = document.createElement('td');
                td.colSpan = 8;
                td.className = 'px-4 py-8 text-center text-slate-400 bg-slate-800/50 rounded-lg';
                td.textContent = 'Inbox 管理界面仅支持在本地开发模式或 API 模式下运行。';
                tr.appendChild(td);
                this.tbody.innerHTML = '';
                this.tbody.appendChild(tr);
                return;
            }

            const reqUser = new URLSearchParams(window.location.search).get('user') || (window.DecipherUser ? window.DecipherUser.id : '');
            const res = await fetch(`/api/inbox?user=${reqUser}`);
            if (res.ok) {
                this.records = await res.json();
            } else {
                throw new Error('Failed to load inbox data');
            }
        } catch (e) {
            console.error(e);
            this.records = []; // Ensure it doesn't crash
            this.tbody.innerHTML = '';
            const tr = document.createElement('tr');
            const td = document.createElement('td');
            td.colSpan = 8;
            td.className = 'px-4 py-8 text-center text-red-400';
            td.textContent = `加载待处理记录失败: ${e.message}`;
            tr.appendChild(td);
            this.tbody.appendChild(tr);
        }
    }

    formatDate(isoStr) {
        if (!isoStr) return '-';
        const d = new Date(isoStr);
        return d.toLocaleDateString() + ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }

    renderTable() {
        if (!this.tbody) return;

        // If rendering logic hit an error beforehand, abort overwrite
        if (this.tbody.innerHTML.includes('text-red-400') || this.tbody.innerHTML.includes('不支持')) {
            return;
        }

        if (this.records.length === 0) {
            this.tbody.innerHTML = '<tr><td colspan="8" class="px-4 py-8 text-center text-slate-500 italic">暂无待处理 Inbox 记录</td></tr>';
            return;
        }

        // 默认按 createdAt 倒序（最新在前）
        const sortedRecords = [...this.records].sort((a, b) => {
            return new Date(b.createdAt || 0) - new Date(a.createdAt || 0);
        });

        this.tbody.innerHTML = '';
        sortedRecords.forEach(r => {
            const tr = document.createElement('tr');
            tr.className = 'table-row-hover text-slate-300';

            const statusColor = r.status === 'pending' ? 'text-yellow-400' :
                (r.status === 'rejected' ? 'text-rose-500' :
                    (r.status === 'moved_to_user' ? 'text-emerald-400' :
                        (r.status === 'moved_to_shared' ? 'text-purple-400' : 'text-slate-400')));

            // Cell: Status
            const tdStatus = document.createElement('td');
            tdStatus.className = 'px-4 py-3';
            const spanStatus = document.createElement('span');
            spanStatus.className = `font-medium ${statusColor}`;
            spanStatus.textContent = r.status || 'unknown';
            tdStatus.appendChild(spanStatus);

            // Cell: DisplayName
            const tdName = document.createElement('td');
            tdName.className = 'px-4 py-3 max-w-[200px] truncate';
            tdName.title = r.displayName || '-';
            tdName.textContent = r.displayName || '-';

            // Cell: Type
            const tdType = document.createElement('td');
            tdType.className = 'px-4 py-3';
            const spanType = document.createElement('span');
            spanType.className = 'px-2 py-1 bg-slate-800 rounded text-xs border border-slate-700';
            spanType.textContent = r.type || '-';
            tdType.appendChild(spanType);

            // Cell: Subject
            const tdSubj = document.createElement('td');
            tdSubj.className = 'px-4 py-3';
            tdSubj.textContent = r.subject || '-';

            // Cell: Uploader
            const tdUser = document.createElement('td');
            tdUser.className = 'px-4 py-3';
            const spanUser = document.createElement('span');
            spanUser.className = 'text-blue-300';
            spanUser.textContent = '@' + (r.userId || '-');
            tdUser.appendChild(spanUser);

            // Cell: School
            const tdSchool = document.createElement('td');
            tdSchool.className = 'px-4 py-3 text-slate-400 text-xs';
            tdSchool.textContent = r.schoolId || '-';

            // Cell: FileName
            const tdFile = document.createElement('td');
            tdFile.className = 'px-4 py-3 max-w-[200px] truncate text-xs text-slate-500 font-mono';
            tdFile.title = r.fileName || '-';
            tdFile.textContent = r.fileName || '-';

            // Cell: Date
            const tdDate = document.createElement('td');
            tdDate.className = 'px-4 py-3 text-xs text-slate-400';
            tdDate.textContent = this.formatDate(r.createdAt);

            // Cell: Actions
            const tdActions = document.createElement('td');
            tdActions.className = 'px-4 py-3 text-right flex gap-2 justify-end';

            if (r.status === 'pending') {
                const btnAssign = document.createElement('button');
                btnAssign.className = 'px-3 py-1 bg-indigo-600 hover:bg-indigo-500 rounded text-xs text-white font-bold transition-all shadow-lg shadow-indigo-900/20';
                btnAssign.textContent = '分配...';
                btnAssign.onclick = () => this.showAssignModal(r.id);
                tdActions.appendChild(btnAssign);

                const btnApproveUser = document.createElement('button');
                btnApproveUser.className = 'px-3 py-1 bg-green-600 hover:bg-green-500 rounded text-xs text-white transition-colors';
                btnApproveUser.textContent = '转移到个人库';
                btnApproveUser.onclick = () => this.approveToUser(r.id);
                tdActions.appendChild(btnApproveUser);

                const btnApproveShared = document.createElement('button');
                btnApproveShared.className = 'px-3 py-1 bg-purple-600 hover:bg-purple-500 rounded text-xs text-white transition-colors';
                btnApproveShared.textContent = '转移到共享库';
                btnApproveShared.onclick = () => this.approveToShared(r.id);
                tdActions.appendChild(btnApproveShared);

                const btnReject = document.createElement('button');
                btnReject.className = 'px-3 py-1 bg-red-600 hover:bg-red-500 rounded text-xs text-white transition-colors';
                btnReject.textContent = '驳回';
                btnReject.onclick = () => this.rejectRecord(r.id);
                tdActions.appendChild(btnReject);
            }

            const btnDetails = document.createElement('button');
            btnDetails.className = 'px-3 py-1 bg-slate-700 hover:bg-slate-600 rounded text-xs text-white transition-colors flex items-center gap-1';
            btnDetails.innerHTML = '<span>查看详情</span>';
            btnDetails.onclick = () => this.showDetails(r.id);
            tdActions.appendChild(btnDetails);

            if (r.status !== 'pending') {
                const badge = document.createElement('span');
                badge.className = 'ml-auto text-[10px] px-1.5 py-0.5 rounded-full bg-slate-800 text-slate-500 border border-slate-700 whitespace-nowrap';
                badge.textContent = '已处理';
                tdActions.appendChild(badge);
            }

            tr.appendChild(tdStatus);
            tr.appendChild(tdName);
            tr.appendChild(tdType);
            tr.appendChild(tdSubj);
            tr.appendChild(tdUser);
            tr.appendChild(tdSchool);
            tr.appendChild(tdFile);
            tr.appendChild(tdDate);
            tr.appendChild(tdActions);

            this.tbody.appendChild(tr);
        });
    }

    async showDetails(recordId) {
        const modal = document.getElementById('detailsModal');
        const modalRecordName = document.getElementById('modalRecordName');
        const modalMetaGrid = document.getElementById('modalMetaGrid');
        const modalJsonContent = document.getElementById('modalJsonContent');
        const overlay = document.getElementById('modalLoadingOverlay');

        // Initial setup and show modal
        modalRecordName.textContent = `记录详情 #${recordId.split('_').pop()}`;
        modalMetaGrid.innerHTML = '';
        modalJsonContent.textContent = '';
        overlay.classList.remove('hidden');
        modal.classList.remove('hidden');
        document.body.style.overflow = 'hidden'; // prevent background scrolling

        try {
            const reqUser = new URLSearchParams(window.location.search).get('user') || (window.DecipherUser ? window.DecipherUser.id : '');
            const res = await fetch(`/api/inbox/${recordId}?user=${reqUser}`);
            if (!res.ok) {
                let errText = 'Failed to fetch details';
                try {
                    const errData = await res.json();
                    if (errData.errors) errText = errData.errors.join('; ');
                } catch (e) { }
                modalJsonContent.textContent = `Error: ${res.status}\n\n${errText}`;
                modalJsonContent.className = 'absolute inset-0 p-4 overflow-auto text-xs font-mono text-red-400 custom-scrollbar leading-relaxed text-left whitespace-pre-wrap word-break-all';
                overlay.classList.add('hidden');
                return;
            }

            const payload = await res.json();
            const record = payload.record;
            const data = payload.data;

            // Render Safe Meta Grid
            modalRecordName.textContent = record.displayName || record.fileName;

            const metaItems = [
                { label: '状态', value: record.status },
                { label: '类型', value: record.type },
                { label: '学科', value: record.subject },
                { label: '发起人', value: record.userId },
                { label: '学院', value: record.schoolId },
                { label: '原始录入', value: record.originalInputMode || '-' },
                { label: '归属倾向', value: record.sourceScopeHint || '-' },
                { label: '文件名', value: record.fileName },
                { label: '提报时间', value: this.formatDate(record.createdAt) }
            ];

            metaItems.forEach(item => {
                const div = document.createElement('div');
                div.className = 'flex flex-col';
                const lbl = document.createElement('span');
                lbl.className = 'text-slate-500 text-xs mb-1';
                lbl.textContent = item.label;
                const val = document.createElement('span');
                val.className = 'text-slate-200 truncate pr-2';
                val.title = item.value || '';
                val.textContent = item.value || '-';
                div.appendChild(lbl);
                div.appendChild(val);
                modalMetaGrid.appendChild(div);
            });

            // Render JSON safely
            modalJsonContent.className = 'absolute inset-0 p-4 overflow-auto text-xs font-mono text-green-300 custom-scrollbar leading-relaxed text-left whitespace-pre-wrap word-break-all';
            modalJsonContent.textContent = JSON.stringify(data, null, 2);

        } catch (e) {
            console.error('Fetch details error:', e);
            modalJsonContent.textContent = `网络或解析错误: \n${e.message}`;
            modalJsonContent.className = 'absolute inset-0 p-4 overflow-auto text-xs font-mono text-red-400 custom-scrollbar leading-relaxed text-left whitespace-pre-wrap word-break-all';
        } finally {
            overlay.classList.add('hidden');
        }
    }

    async approveToUser(recordId) {
        const reqUser = new URLSearchParams(window.location.search).get('user') || (window.DecipherUser ? window.DecipherUser.id : '');
        try {
            const res = await fetch(`/api/inbox/${recordId}/move-to-user?user=${reqUser}`, { method: 'POST' });
            if (!res.ok) {
                let errText = '操作失败';
                try {
                    const errData = await res.json();
                    if (errData.errors) errText = errData.errors.join('; ');
                } catch (e) { }
                alert(`转移失败: ${errText}`);
                return;
            }
            alert('成功转移到个人库！');
            await this.init(); // Reload
        } catch (e) {
            alert(`请求报错: ${e.message}`);
        }
    }

    async approveToShared(recordId) {
        const reqUser = new URLSearchParams(window.location.search).get('user') || (window.DecipherUser ? window.DecipherUser.id : '');
        try {
            const res = await fetch(`/api/inbox/${recordId}/move-to-shared?user=${reqUser}`, { method: 'POST' });
            if (!res.ok) {
                let errText = '操作失败';
                try {
                    const errData = await res.json();
                    if (errData.errors) errText = errData.errors.join('; ');
                } catch (e) { }
                alert(`转移至共享库失败: ${errText}`);
                return;
            }
            alert('成功转移到共享库！');
            await this.init(); // Reload
        } catch (e) {
            alert(`请求报错: ${e.message}`);
        }
    }

    async rejectRecord(recordId) {
        if (!confirm('确定要驳回此记录吗？（将会保留归档但不再流转）')) return;

        const reqUser = new URLSearchParams(window.location.search).get('user') || (window.DecipherUser ? window.DecipherUser.id : '');
        try {
            const res = await fetch(`/api/inbox/${recordId}/reject?user=${reqUser}`, { method: 'POST' });
            if (!res.ok) {
                let errText = '操作失败';
                try {
                    const errData = await res.json();
                    if (errData.errors) errText = errData.errors.join('; ');
                } catch (e) { }
                alert(`驳回记录失败: ${errText}`);
                return;
            }
            alert('成功驳回！');
            await this.init(); // Reload
        } catch (e) {
            alert(`请求报错: ${e.message}`);
        }
    }

    closeDetails() {
        const modal = document.getElementById('detailsModal');
        modal.classList.add('hidden');
        document.body.style.overflow = '';
    }

    // --- Phase 11B: Assignment Modal Logic ---

    async showAssignModal(recordId) {
        this.currentRecordId = recordId;
        const record = this.records.find(r => r.id === recordId);
        if (!record) return;

        const modal = document.getElementById('assignModal');
        const ownerSelect = document.getElementById('targetOwner');
        const subjectDropdown = document.getElementById('subjectDropdown');
        const subjectInput = document.getElementById('subjectInput');

        // Reset inputs
        subjectInput.value = '';
        document.getElementById('createSubjectIfMissing').checked = false;

        // Populate Owners (Schools/Users) & Subjects
        await this.prepareAssignData(record);

        modal.classList.remove('hidden');
        document.body.style.overflow = 'hidden';
        this.onScopeChange(); // Initialize view
    }

    async prepareAssignData(record) {
        const ownerSelect = document.getElementById('targetOwner');
        const subjectDropdown = document.getElementById('subjectDropdown');

        // 1. Fetch Users List
        try {
            this.usersList = await window.fetchUsersList();
        } catch (e) {
            console.warn('Failed to load users list:', e);
            this.usersList = [];
        }

        // 2. Initial Setup based on Scope
        this.updateAssignPreview();
    }

    onScopeChange() {
        const scope = document.querySelector('input[name="targetScope"]:checked').value;
        const ownerLabel = document.getElementById('ownerLabel');
        const ownerSelect = document.getElementById('targetOwner');
        const subjectDropdown = document.getElementById('subjectDropdown');
        const record = this.records.find(r => r.id === this.currentRecordId);

        ownerSelect.innerHTML = '';
        subjectDropdown.innerHTML = '<option value="">-- 请选择或手动输入 --</option>';

        if (scope === 'shared') {
            ownerLabel.textContent = '目标大学';
            // Current school only for now
            const option = document.createElement('option');
            option.value = record.schoolId || 'ualberta';
            option.textContent = record.schoolId || 'ualberta';
            ownerSelect.appendChild(option);

            // Load subjects from context if matching
            if (window.DecipherUser.context && window.DecipherUser.context.school) {
                const subjects = window.DecipherUser.context.school.subjects || [];
                subjects.forEach(s => {
                    const opt = document.createElement('option');
                    opt.value = s.id;
                    opt.textContent = s.label || s.id;
                    subjectDropdown.appendChild(opt);
                });
            }
        } else {
            ownerLabel.textContent = '目标用户';
            this.usersList.forEach(u => {
                const option = document.createElement('option');
                option.value = u.id;
                option.textContent = `${u.displayName || u.id} (@${u.id})`;
                if (u.id === record.userId) option.selected = true;
                ownerSelect.appendChild(option);
            });

            // Load accessible subjects as candidates
            const subjects = (window.DecipherUser.context && window.DecipherUser.context.accessibleSubjects) || [];
            subjects.forEach(s => {
                const opt = document.createElement('option');
                opt.value = s;
                opt.textContent = s;
                subjectDropdown.appendChild(opt);
            });
        }

        this.updateAssignPreview();
    }

    syncSubjectInput() {
        const dropdown = document.getElementById('subjectDropdown');
        const input = document.getElementById('subjectInput');
        if (dropdown.value) {
            input.value = dropdown.value;
        }
        this.updateAssignPreview();
    }

    updateAssignPreview() {
        const preview = document.getElementById('assignPreview');
        const scope = document.querySelector('input[name="targetScope"]:checked').value;
        const owner = document.getElementById('targetOwner').value || '?';
        const subject = document.getElementById('subjectInput').value || document.getElementById('subjectDropdown').value || '?';

        preview.textContent = `Target: ${scope} / ${owner} / ${subject}`;
    }

    async submitAssign() {
        if (!this.currentRecordId) return;
        const scope = document.querySelector('input[name="targetScope"]:checked').value;
        const owner = document.getElementById('targetOwner').value;
        const subjectId = document.getElementById('subjectInput').value.trim();
        const createIfMissing = document.getElementById('createSubjectIfMissing').checked;

        if (!subjectId) {
            alert('请提供目标专业 ID');
            return;
        }

        if (!/^[a-z0-9_-]+$/.test(subjectId)) {
            alert('专业 ID 格式不合法：仅限小写英文、数字、下划线和短横线。');
            return;
        }

        const payload = {
            targetScope: scope,
            targetSubjectId: subjectId,
            createSubjectIfMissing: createIfMissing
        };

        if (scope === 'shared') {
            payload.targetSchoolId = owner;
        } else {
            payload.targetUserId = owner;
        }

        const btn = document.getElementById('confirmAssignBtn');
        const oldText = btn.textContent;
        btn.disabled = true;
        btn.textContent = '分配中...';

        try {
            const reqUser = new URLSearchParams(window.location.search).get('user') || (window.DecipherUser ? window.DecipherUser.id : '');
            const res = await fetch(`/api/inbox/${this.currentRecordId}/assign?user=${reqUser}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });

            const result = await res.json();
            if (res.ok) {
                alert('分配成功！');
                this.closeAssignModal();
                await this.init();
            } else {
                const msg = (result.errors && result.errors[0]) || '分配失败';
                if (res.status === 501) {
                    alert(`暂不支持操作：${msg}`);
                } else {
                    alert(`操作失败：${msg}`);
                }
            }
        } catch (e) {
            alert(`网络请求失败: ${e.message}`);
        } finally {
            btn.disabled = false;
            btn.textContent = oldText;
        }
    }

    closeAssignModal() {
        const modal = document.getElementById('assignModal');
        modal.classList.add('hidden');
        document.body.style.overflow = '';
        this.currentRecordId = null;
    }
}

document.addEventListener('DOMContentLoaded', () => {
    window.inboxManagerApp = new InboxManager();
});
