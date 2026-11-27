// =========================================================
// Firebase 로그인 보안 · 실시간 동기화 · 월초/초기화 직전 자동백업 모듈
// =========================================================
const firebaseConfig = {
    apiKey: "AIzaSyCODomoDzVSHIZaiYvrAuq9jU_1nFBDfyw",
    authDomain: "my-asset-note.firebaseapp.com",
    projectId: "my-asset-note",
    storageBucket: "my-asset-note.firebasestorage.app",
    messagingSenderId: "343044314850",
    appId: "1:343044314850:web:d804d567f82ecd1ef770bb"
};

let fbApp = null;
let fbAuth = null;
let fbDb = null;
let fbUnsubscribe = null;
let fbIsApplyingRemote = false;
let fbInitialLoaded = false;
let fbBackupShowAll = false;
let fbCachedBackupDocs = [];
const fbSessionId = 'S_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);

function updateSyncBadge(status, text) {
    const badge = document.getElementById('syncStatusBadge');
    if (!badge) return;
    const styles = {
        synced: 'bg-green-50 text-green-700 border-green-200',
        syncing: 'bg-amber-50 text-amber-800 border-amber-200',
        offline: 'bg-gray-100 text-gray-600 border-gray-200',
        error: 'bg-rose-50 text-rose-700 border-rose-200'
    };
    badge.className = `text-[10px] sm:text-[11px] px-2 py-0.5 rounded-lg border font-bold whitespace-nowrap ${styles[status] || styles.offline}`;
    badge.textContent = text;
}

function setAppLocked(locked) {
    const overlay = document.getElementById('firebaseAuthOverlay');
    const nav = document.getElementById('mainNavBar');
    const main = document.getElementById('mainContentArea');
    const logoutBtn = document.getElementById('logoutBtn');
    if (overlay) overlay.classList.toggle('hidden', !locked);
    if (nav) nav.classList.toggle('hidden', locked);
    if (main) main.classList.toggle('hidden', locked);
    if (logoutBtn) logoutBtn.classList.toggle('hidden', locked);
}

function showLocalNoticeBox(titleText, descText) {
    const notice = document.getElementById('fileProtocolNotice');
    if (!notice) return;
    if (titleText) {
        const titleEl = notice.querySelector('.font-bold');
        if (titleEl) titleEl.textContent = titleText;
    }
    if (descText) {
        const descEl = notice.querySelector('p');
        if (descEl) descEl.textContent = descText;
    }
    notice.classList.remove('hidden');
}

function initFirebaseModule() {
    if (window.location.protocol === 'file:') {
        showLocalNoticeBox();
    }

    if (typeof firebase === 'undefined') {
        updateSyncBadge('offline', '오프라인 모드');
        showLocalNoticeBox(
            '클라우드 서버에 연결할 수 없습니다',
            '인터넷 연결이 꺼져 있거나 네트워크에서 차단된 상태입니다. 아래 버튼으로 이 기기에 저장된 오프라인 모드로 열 수 있습니다.'
        );
        return;
    }

    try {
        if (!firebase.apps.length) {
            fbApp = firebase.initializeApp(firebaseConfig);
        } else {
            fbApp = firebase.app();
        }
        fbAuth = firebase.auth();
        fbDb = firebase.firestore();

        fbAuth.onAuthStateChanged((user) => {
            if (user) {
                setAppLocked(false);
                updateSyncBadge('syncing', '동기화 연결 중...');
                startFirestoreSync(user);
            } else {
                if (fbUnsubscribe) {
                    fbUnsubscribe();
                    fbUnsubscribe = null;
                }
                fbInitialLoaded = false;
                fbCachedBackupDocs = [];
                setAppLocked(true);
                updateSyncBadge('offline', '잠금됨');
            }
        });
    } catch (err) {
        console.error('Firebase 초기화 오류:', err);
        updateSyncBadge('error', '초기화 오류');
        showLocalNoticeBox(
            '클라우드 초기화 중 오류가 발생했습니다',
            'GitHub 웹 주소(https://)로 접속했는지 확인하거나 아래 버튼으로 오프라인 미리보기를 이용해 주세요.'
        );
    }
}

async function handleFirebaseLogin(e) {
    e.preventDefault();
    const email = document.getElementById('loginEmail').value.trim();
    const password = document.getElementById('loginPassword').value;
    const remember = document.getElementById('loginRememberChk')?.checked ?? true;
    const errEl = document.getElementById('loginErrorMsg');
    const btn = document.getElementById('loginSubmitBtn');

    if (!fbAuth) {
        errEl.textContent = '클라우드 서버에 연결되지 않았습니다. 인터넷 연결을 확인하거나 오프라인 모드를 이용해 주세요.';
        errEl.classList.remove('hidden');
        return;
    }

    errEl.classList.add('hidden');
    btn.disabled = true;
    btn.textContent = '로그인 확인 중...';

    try {
        const persistence = remember
            ? firebase.auth.Auth.Persistence.LOCAL
            : firebase.auth.Auth.Persistence.SESSION;
        await fbAuth.setPersistence(persistence);
        await fbAuth.signInWithEmailAndPassword(email, password);
        document.getElementById('loginPassword').value = '';
    } catch (err) {
        let msg = '로그인에 실패했습니다. 이메일과 비밀번호를 확인해 주세요.';
        if (err.code === 'auth/invalid-credential' || err.code === 'auth/wrong-password' || err.code === 'auth/user-not-found') {
            msg = '등록되지 않은 이메일이거나 비밀번호가 일치하지 않습니다.';
        } else if (err.code === 'auth/too-many-requests') {
            msg = '로그인 시도가 너무 많습니다. 잠시 후 다시 시도해 주세요.';
        } else if (err.code === 'auth/network-request-failed') {
            msg = '인터넷 연결을 확인해 주세요.';
        } else if (err.code === 'auth/operation-not-supported-in-this-environment') {
            msg = '내 컴퓨터 폴더(file://)에서는 로그인이 제한됩니다. GitHub 웹 주소(https://)로 접속하거나 위 오프라인 모드로 열기를 이용해 주세요.';
        }
        errEl.textContent = msg;
        errEl.classList.remove('hidden');
    } finally {
        btn.disabled = false;
        btn.textContent = '가계부 열기';
    }
}

function bypassLoginForLocalPreview() {
    setAppLocked(false);
    updateSyncBadge('offline', '로컬 미리보기');
}

async function logoutFirebase() {
    if (!fbAuth) return;
    if (confirm('로그아웃하고 가계부를 잠그시겠습니까?')) {
        await fbAuth.signOut();
    }
}

function startFirestoreSync(user) {
    if (!fbDb) return;
    if (fbUnsubscribe) fbUnsubscribe();

    const docRef = fbDb.collection('users_data').doc('main_budget');
    fbUnsubscribe = docRef.onSnapshot(async (snap) => {
        if (!snap.exists) {
            fbInitialLoaded = true;
            await syncDbToCloud(true);
            await checkAndRunMonthlyAutoBackup(user);
            renderCloudBackupList();
            return;
        }

        const data = snap.data();
        if (data.sessionId === fbSessionId && fbInitialLoaded) {
            updateSyncBadge('synced', '동기화 완료');
            return;
        }

        if (data.payload) {
            try {
                const parsed = JSON.parse(data.payload);
                if (parsed && parsed.config && parsed.categories) {
                    fbIsApplyingRemote = true;
                    db = parsed;
                    if (typeof migrateDbData === 'function') migrateDbData();
                    localStorage.setItem('custom_budget_v2', JSON.stringify(db));
                    if (typeof renderAll === 'function') renderAll();
                    fbIsApplyingRemote = false;
                }
            } catch (err) {
                fbIsApplyingRemote = false;
                console.error('클라우드 데이터 파싱 오류:', err);
            }
        }

        const firstRun = !fbInitialLoaded;
        fbInitialLoaded = true;
        updateSyncBadge('synced', '동기화 완료');

        if (firstRun) {
            await checkAndRunMonthlyAutoBackup(user);
            renderCloudBackupList();
        }
    }, (err) => {
        console.error('Firestore 동기화 오류:', err);
        if (err.code === 'permission-denied') {
            updateSyncBadge('error', '접근 권한 없음');
            alert('Firestore 보안 규칙에 등록되지 않은 이메일입니다. Firebase 규칙(Rules)에 현재 로그인한 이메일을 추가해 주세요.');
        } else {
            updateSyncBadge('error', '동기화 오류');
        }
    });
}

async function syncDbToCloud(force = false) {
    if (!fbDb || !fbAuth || !fbAuth.currentUser) return;
    if (fbIsApplyingRemote && !force) return;
    if (!fbInitialLoaded && !force) return;

    updateSyncBadge('syncing', '저장 중...');
    try {
        const docRef = fbDb.collection('users_data').doc('main_budget');
        await docRef.set({
            payload: JSON.stringify(db),
            updatedAt: new Date().toISOString(),
            updatedBy: fbAuth.currentUser.email || '',
            sessionId: fbSessionId
        });
        updateSyncBadge('synced', '동기화 완료');
    } catch (err) {
        console.error('클라우드 저장 실패:', err);
        updateSyncBadge('error', '저장 실패');
    }
}

// =========================================================
// 월초 자동백업 · 초기화 직전 안전백업 · 백업 목록(최근 3건 + 더보기)
// =========================================================
async function checkAndRunMonthlyAutoBackup(user) {
    if (!fbDb || !user) return;
    const now = new Date();
    const curYM = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const backupDocId = `backup_${curYM}`;

    try {
        const backupRef = fbDb.collection('monthly_backups').doc(backupDocId);
        const snap = await backupRef.get();
        if (!snap.exists) {
            await backupRef.set({
                ym: curYM,
                label: `${now.getFullYear()}년 ${now.getMonth() + 1}월 월초 자동백업`,
                createdAt: new Date().toISOString(),
                createdBy: user.email || '',
                txCount: Array.isArray(db.transactions) ? db.transactions.length : 0,
                payload: JSON.stringify(db)
            });
            await pruneOldCloudBackups();
        }
    } catch (err) {
        console.error('월초 자동백업 확인 오류:', err);
    }
}

async function createManualCloudBackup() {
    if (!fbDb || !fbAuth || !fbAuth.currentUser) {
        return alert('클라우드에 로그인된 상태에서만 사용할 수 있습니다.');
    }
    const now = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    const stamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}`;
    const docId = `manual_${stamp}`;

    try {
        await fbDb.collection('monthly_backups').doc(docId).set({
            ym: `${now.getFullYear()}-${pad(now.getMonth() + 1)}`,
            label: `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())} 수동백업`,
            createdAt: now.toISOString(),
            createdBy: fbAuth.currentUser.email || '',
            txCount: Array.isArray(db.transactions) ? db.transactions.length : 0,
            payload: JSON.stringify(db)
        });
        await pruneOldCloudBackups();
        await renderCloudBackupList();
        alert('현재 가계부 상태가 클라우드 백업함에 저장되었습니다.');
    } catch (err) {
        alert('클라우드 백업 중 오류가 발생했습니다: ' + err.message);
    }
}

// 초기화 실행 직전 자동 안전 백업 (실패 시 초기화 중단)
async function createPreResetCloudBackup(reasonLabel) {
    if (!fbDb || !fbAuth || !fbAuth.currentUser) {
        return {
            ok: false,
            error: '클라우드에 로그인·연결된 상태가 아닙니다.\n데이터 유실 방지를 위해 오프라인 상태에서는 초기화를 중단합니다.'
        };
    }
    const now = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    const stamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
    const docId = `prereset_${stamp}`;
    const label = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())} ${reasonLabel} 직전 자동백업`;

    try {
        await fbDb.collection('monthly_backups').doc(docId).set({
            ym: `${now.getFullYear()}-${pad(now.getMonth() + 1)}`,
            label,
            isSafetyBackup: true,
            createdAt: now.toISOString(),
            createdBy: fbAuth.currentUser.email || '',
            txCount: Array.isArray(db.transactions) ? db.transactions.length : 0,
            payload: JSON.stringify(db)
        });
        await pruneOldCloudBackups();
        await renderCloudBackupList();
        return { ok: true, label };
    } catch (err) {
        return {
            ok: false,
            error: `초기화 직전 클라우드 자동백업 저장에 실패해 초기화를 중단했습니다.\n(${err.message})`
        };
    }
}

async function pruneOldCloudBackups() {
    if (!fbDb) return;
    try {
        const snap = await fbDb.collection('monthly_backups').orderBy('createdAt', 'desc').get();
        if (snap.size > 24) {
            const toDelete = snap.docs.slice(24);
            for (const d of toDelete) {
                await d.ref.delete();
            }
        }
    } catch (err) {
        console.error('오래된 백업 정리 오류:', err);
    }
}

function toggleCloudBackupShowAll() {
    fbBackupShowAll = !fbBackupShowAll;
    drawCloudBackupListFromCache();
}

function drawCloudBackupListFromCache() {
    const listEl = document.getElementById('cloudBackupList');
    if (!listEl) return;

    if (!fbCachedBackupDocs || fbCachedBackupDocs.length === 0) {
        listEl.innerHTML = `<div class="text-xs text-gray-400 py-4 text-center">저장된 클라우드 백업이 아직 없습니다.</div>`;
        return;
    }

    const visibleDocs = fbBackupShowAll ? fbCachedBackupDocs : fbCachedBackupDocs.slice(0, 3);
    const hiddenCount = fbCachedBackupDocs.length - 3;

    const cardsHtml = visibleDocs.map(({ id, data: d }) => {
        const dt = d.createdAt ? d.createdAt.slice(0, 10) : '';
        const safeLabel = String(d.label || id).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
        const isSafety = !!d.isSafetyBackup || id.startsWith('prereset_');
        const safetyBadge = isSafety
            ? `<span class="text-[10px] px-1.5 py-0.5 rounded bg-orange-100 text-orange-800 font-bold shrink-0 whitespace-nowrap">초기화 직전</span>`
            : '';
        return `
            <div class="flex flex-wrap justify-between items-center gap-2 p-2.5 rounded-xl bg-blue-50/40 border border-blue-100 text-xs">
                <div class="min-w-0 flex-1">
                    <div class="flex items-center gap-1.5 flex-wrap">
                        ${safetyBadge}
                        <span class="font-bold text-gray-800 truncate">${escHtml(d.label || id)}</span>
                    </div>
                    <div class="text-[11px] text-gray-400 mt-0.5">생성일 ${dt} · 내역 ${d.txCount || 0}건</div>
                </div>
                <div class="flex gap-1.5 shrink-0">
                    <button onclick="downloadCloudBackupJson('${id}')" class="px-2.5 py-1 bg-white border border-gray-300 hover:bg-gray-50 text-gray-700 rounded-lg font-bold text-[11px]">다운로드</button>
                    <button onclick="restoreFromCloudBackup('${id}', '${safeLabel}')" class="px-2.5 py-1 bg-blue-500 hover:bg-blue-600 text-white rounded-lg font-bold text-[11px]">복원</button>
                </div>
            </div>`;
    }).join('');

    const toggleHtml = hiddenCount > 0 ? `
        <button type="button" onclick="toggleCloudBackupShowAll()" class="w-full py-2 mt-1 bg-gray-100 hover:bg-gray-200 border border-gray-200 text-gray-700 font-bold rounded-xl text-[11px] transition">
            ${fbBackupShowAll ? '최근 3건만 보기 ▲' : `이전 백업 더보기 (${hiddenCount}건) ▼`}
        </button>` : '';

    listEl.innerHTML = cardsHtml + toggleHtml;
}

async function renderCloudBackupList() {
    const listEl = document.getElementById('cloudBackupList');
    if (!listEl) return;
    if (!fbDb || !fbAuth || !fbAuth.currentUser) {
        listEl.innerHTML = `<div class="text-xs text-gray-400 py-4 text-center">로그인 후 클라우드 자동백업 목록을 확인할 수 있습니다.</div>`;
        return;
    }

    try {
        const snap = await fbDb.collection('monthly_backups').orderBy('createdAt', 'desc').limit(24).get();
        fbCachedBackupDocs = snap.docs.map(doc => ({ id: doc.id, data: doc.data() }));
        drawCloudBackupListFromCache();
    } catch (err) {
        listEl.innerHTML = `<div class="text-xs text-rose-500 py-3 text-center">백업 목록을 불러오지 못했습니다.</div>`;
    }
}

async function restoreFromCloudBackup(docId, label) {
    if (!fbDb) return;

    try {
        const snap = await fbDb.collection('monthly_backups').doc(docId).get();
        if (!snap.exists || !snap.data().payload) return alert('백업 데이터를 찾을 수 없습니다.');
        const parsed = JSON.parse(snap.data().payload);
        if (!parsed || !parsed.config || !parsed.categories) {
            return alert('올바른 가계부 백업 데이터 형식이 아닙니다.');
        }

        const applyRestore = async () => {
            db = parsed;
            if (typeof migrateDbData === 'function') migrateDbData();
            localStorage.setItem('custom_budget_v2', JSON.stringify(db));
            if (typeof renderAll === 'function') renderAll();
            await syncDbToCloud(true);
            alert('선택한 백업 시점으로 복원이 완료되었습니다.');
        };

        if (typeof openRestorePreviewModal === 'function') {
            openRestorePreviewModal(parsed, label, applyRestore);
        } else if (confirm(`'${label}' 시점으로 가계부를 복원하시겠습니까?\n현재 데이터는 해당 백업 시점의 데이터로 덮어씌워집니다.`)) {
            await applyRestore();
        }
    } catch (err) {
        alert('백업 데이터를 불러오는 중 오류가 발생했습니다: ' + err.message);
    }
}

async function downloadCloudBackupJson(docId) {
    if (!fbDb) return;
    try {
        const snap = await fbDb.collection('monthly_backups').doc(docId).get();
        if (!snap.exists || !snap.data().payload) return alert('백업 데이터를 찾을 수 없습니다.');
        const d = snap.data();
        const a = document.createElement('a');
        a.setAttribute("href", "data:text/json;charset=utf-8," + encodeURIComponent(d.payload));
        a.setAttribute("download", `${db.config.appTitle}_${d.ym || docId}.json`);
        document.body.appendChild(a);
        a.click();
        a.remove();
    } catch (err) {
        alert('다운로드 중 오류가 발생했습니다.');
    }
}

window.addEventListener('DOMContentLoaded', () => {
    initFirebaseModule();
});