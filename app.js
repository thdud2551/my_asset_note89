const BEHAVIOR_LABELS = {
    expense: { text: '지출형', badge: 'bg-rose-50 text-rose-700 border-rose-200' },
    income: { text: '수입형', badge: 'bg-blue-50 text-blue-700 border-blue-200' },
    transfer: { text: '이체형', badge: 'bg-purple-50 text-purple-700 border-purple-200' },
    voucher: { text: '상품권충전형', badge: 'bg-amber-50 text-amber-800 border-amber-200' }
};

function getDefaultDb() {
    return {
        config: {
            appTitle: '나만의 자산노트',
            theme: 'pastel',
            startDayOfWeek: 0,
            startDayOfMonth: 1,
            monthlyBudget: 1500000,
            savingsGoal: 1000000,
            defaultUser: '나',
            defaultType: '지출',
            defaultCatMain: '식비'
        },
        users: ['나', '가족', '공동'],
        txTypes: [
            { id: 'T1', name: '지출', behavior: 'expense' },
            { id: 'T2', name: '수입', behavior: 'income' },
            { id: 'T3', name: '이체·저축', behavior: 'transfer' },
            { id: 'T4', name: '선불·상품권 충전', behavior: 'voucher' }
        ],
        categories: {
            '지출': {
                '식비': ['식사(외식)', '카페(커피)', '배달', '장보기'],
                '주거·공과금': ['관리비', '전기·가스·수도', '월세·주거', '집관리·수리'],
                '통신·구독': ['휴대폰', '인터넷·TV', 'OTT·멤버십'],
                '생활·쇼핑': ['생필품', '의류·잡화', '미용', '헤어', '가전·가구'],
                '교통·차량': ['대중교통', '택시', '주유', '주차·통행료', '차량정비'],
                '의료·건강': ['병원', '약국', '영양제', '운동·헬스'],
                '보험·세금·금융': ['보장성보험', '자동차보험', '세금(재산·자동차세)', '이자·수수료'],
                '교육': ['강의·수강료', '자격증·응시료', '교재'],
                '문화·여가': ['여행·숙박', '나들이·공연', '취미', '도서'],
                '야구': ['티켓비', '굿즈', '교통비', '숙박비'],
                '경조·가족': ['경조사비', '부모님 용돈', '선물·기념일', '모임·회비', '기부·후원']
            },
            '수입': {
                '급여': ['월급', '상여·성과급', '수당'],
                '부수입·금융': ['이자·배당', '캐시백·포인트', '중고거래', '환급금'],
                '기타수입': ['용돈·지원금', '기타']
            },
            '이체·저축': {
                '저축·투자': ['예·적금', '청약', '주식·펀드', '연금·IRP'],
                '부채상환': ['대출 원금 상환', '마이너스통장 상환'],
                '계좌이동': ['생활비 이체', '용돈 이체', '내 계좌 이동']
            },
            '선불·상품권 충전': {
                '상품권 충전': ['온누리상품권', '지역사랑상품권', '기타 선불충전']
            }
        },
        assets: [
            { id: 'B1', group: 'bank', type: '입출금통장', name: '생활비통장', owner: '공동', initBalance: 2500000 },
            { id: 'B2', group: 'bank', type: '예·적금', name: '비상금적금', owner: '공동', initBalance: 3000000 },
            { id: 'B3', group: 'bank', type: '선불·상품권', name: '온누리상품권', owner: '나', initBalance: 150000 },
            { id: 'B4', group: 'bank', type: '선불·상품권', name: '지역사랑상품권', owner: '나', initBalance: 100000 },
            { id: 'C1', group: 'card', type: '신용카드', name: '신한카드', owner: '나', linkedAccount: 'B1', payDay: 14, startMonthType: '전월', startDay: 1, endMonthType: '전월', endDay: 31, targetSpend: 500000, perfBasis: 'calendar', revolving: 0 },
            { id: 'C2', group: 'card', type: '신용카드', name: '현대카드', owner: '가족', linkedAccount: 'B1', payDay: 25, startMonthType: '전월', startDay: 14, endMonthType: '당월', endDay: 13, targetSpend: 300000, perfBasis: 'calendar', revolving: 0 },
            { id: 'D1', group: 'debt', type: '일반대출', name: '주택담보대출', owner: '공동', linkedAccount: 'B1', initBalance: 50000000 },
            { id: 'D2', group: 'debt', type: '마이너스통장', name: '비상금마통', owner: '나', linkedAccount: 'B1', initBalance: 2000000 }
        ],
        anniversaries: [],
        monthlyBudgets: {},
        transactions: [],
        cardEvents: [],
        autoTransfers: []
    };
}

let db = JSON.parse(localStorage.getItem('custom_budget_v2')) || getDefaultDb();

// =========================================================
// 자산 고유 ID · 소유자 · 공용 정렬 헬퍼 및 마이그레이션
// =========================================================
function compareKorean(a, b) {
    return String(a || '').localeCompare(String(b || ''), 'ko');
}

function getOwnerRank(owner) {
    const idx = (db.users || []).indexOf(owner);
    return idx >= 0 ? idx : 999;
}

function getAssetTypeRank(type) {
    const order = ['신용카드', '체크카드', '입출금통장', '예·적금', '선불·상품권', '현금', '투자', '실물자산', '마이너스통장', '일반대출'];
    const idx = order.indexOf(type);
    return idx >= 0 ? idx : 99;
}

// 가나다순 -> 같은 이름이면 소유자순
function sortAssetsByName(list) {
    return [...list].sort((a, b) => compareKorean(a.name, b.name) || (getOwnerRank(a.owner) - getOwnerRank(b.owner)));
}

// 소유자순 -> 같은 소유자면 가나다순
function sortAssetsByOwnerThenName(list) {
    return [...list].sort((a, b) => (getOwnerRank(a.owner) - getOwnerRank(b.owner)) || compareKorean(a.name, b.name));
}

// 선택한 사용자 우선 -> 공동 -> 타인, 같은 그룹 내 종류별 + 가나다순
function sortAssetsForUser(list, targetUser) {
    const uRank = (a) => {
        if (targetUser && a.owner === targetUser) return 0;
        if (a.owner === '공동') return 1;
        return 2;
    };
    return [...list].sort((a, b) =>
        (uRank(a) - uRank(b)) ||
        (getAssetTypeRank(a.type) - getAssetTypeRank(b.type)) ||
        compareKorean(a.name, b.name) ||
        (getOwnerRank(a.owner) - getOwnerRank(b.owner))
    );
}

function findAsset(idOrName) {
    if (!idOrName) return null;
    return db.assets.find(a => a.id === idOrName) || db.assets.find(a => a.name === idOrName) || null;
}

function resolveToAssetId(val) {
    if (!val) return '';
    const byId = db.assets.find(a => a.id === val);
    if (byId) return byId.id;
    const byName = db.assets.find(a => a.name === val);
    return byName ? byName.id : val;
}

function getAssetLabel(idOrName, withOwner = true) {
    if (!idOrName) return '-';
    const a = findAsset(idOrName);
    if (!a) return idOrName;
    return (withOwner && a.owner) ? `[${a.owner}] ${a.name}` : a.name;
}

function getAssetOptionText(a) {
    return `[${a.type} · ${a.owner || '미지정'}] ${a.name}`;
}

function getOwnerBadgeHtml(owner) {
    if (!owner) return '';
    const cls = owner === '공동' ? 'bg-purple-50 text-purple-700' : 'bg-gray-100 text-gray-700';
    return `<span class="text-[10px] px-1.5 py-0.5 rounded font-bold whitespace-nowrap ${cls}">${escHtml(owner)}</span>`;
}

function migrateDbData() {
    if (!db.transactions) db.transactions = [];
    if (!db.cardEvents) db.cardEvents = [];
    if (!db.autoTransfers) db.autoTransfers = [];
    if (!db.anniversaries) db.anniversaries = [];
    if (!db.monthlyBudgets) db.monthlyBudgets = {};
    if (!db.txTypes || db.txTypes.length === 0) db.txTypes = getDefaultDb().txTypes;
    if (!db.config.theme) db.config.theme = 'pastel';
    if (db.config.appTitle === '포켓몬 자산노트') db.config.appTitle = '나만의 자산노트';

    const fallbackOwner = db.users[0] || '나';
    (db.assets || []).forEach(a => {
        if (!a.owner) a.owner = fallbackOwner;
        if (a.group === 'card' && !a.perfBasis) a.perfBasis = 'calendar';
    });
    (db.assets || []).forEach(a => {
        if (a.linkedAccount) a.linkedAccount = resolveToAssetId(a.linkedAccount);
    });
    db.transactions.forEach(t => {
        if (t.method) t.method = resolveToAssetId(t.method);
        if (t.targetAsset) t.targetAsset = resolveToAssetId(t.targetAsset);
    });
    db.cardEvents.forEach(e => {
        if (!e.cardId && e.cardName) e.cardId = resolveToAssetId(e.cardName);
        if (e.fromAccount) e.fromAccount = resolveToAssetId(e.fromAccount);
    });
    db.autoTransfers.forEach(at => {
        if (at.method) at.method = resolveToAssetId(at.method);
        if (at.targetAsset) at.targetAsset = resolveToAssetId(at.targetAsset);
    });
}
migrateDbData();

// =========================================================
// 한국 공휴일(제헌절 포함) & 음력 자동 변환 엔진
// =========================================================
const lunarYearCache = {};
const holidayYearCache = {};
let lunarFormatter = null;
try {
    lunarFormatter = new Intl.DateTimeFormat('en-US-u-ca-chinese', {
        month: 'numeric', day: 'numeric', timeZone: 'Asia/Seoul'
    });
} catch (e) { lunarFormatter = null; }

function getLunarMapForYear(year) {
    if (lunarYearCache[year]) return lunarYearCache[year];
    const map = {};
    if (lunarFormatter) {
        const cur = new Date(year, 0, 1), end = new Date(year, 11, 31);
        while (cur <= end) {
            const y = cur.getFullYear(), m = cur.getMonth() + 1, d = cur.getDate();
            const dStr = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
            const parts = lunarFormatter.formatToParts(new Date(Date.UTC(y, m - 1, d, 3, 0, 0)));
            const mVal = parts.find(p => p.type === 'month')?.value || '';
            const dVal = parts.find(p => p.type === 'day')?.value || '';
            const mNum = mVal.match(/\d+/), dNum = dVal.match(/\d+/);
            map[dStr] = {
                lm: mNum ? parseInt(mNum[0], 10) : 0,
                ld: dNum ? parseInt(dNum[0], 10) : 0,
                isLeap: /bis|윤|L/i.test(mVal)
            };
            cur.setDate(cur.getDate() + 1);
        }
    }
    lunarYearCache[year] = map;
    return map;
}

function shiftDateStr(dateStr, deltaDays) {
    const [y, m, d] = dateStr.split('-').map(Number);
    return formatYMD(new Date(y, m - 1, d + deltaDays));
}
function getDowFromStr(dateStr) {
    const [y, m, d] = dateStr.split('-').map(Number);
    return new Date(y, m - 1, d).getDay();
}

function getKoreanHolidaysForYear(year) {
    if (holidayYearCache[year]) return holidayYearCache[year];
    const hols = {};
    const addHol = (dStr, name) => {
        if (!hols[dStr]) hols[dStr] = [];
        if (!hols[dStr].includes(name)) hols[dStr].push(name);
    };
    const pad = (n) => String(n).padStart(2, '0');
    const singleSubTargets = [], groupSubTargets = [];

    const fixedList = [
        { m: 1, d: 1, name: '신정', sub: false },
        { m: 3, d: 1, name: '삼일절', sub: true },
        { m: 5, d: 5, name: '어린이날', sub: true },
        { m: 6, d: 6, name: '현충일', sub: false },
        { m: 8, d: 15, name: '광복절', sub: true },
        { m: 10, d: 3, name: '개천절', sub: true },
        { m: 10, d: 9, name: '한글날', sub: true },
        { m: 12, d: 25, name: '성탄절', sub: true }
    ];
    if (year >= 2026) fixedList.push({ m: 7, d: 17, name: '제헌절', sub: true });

    fixedList.forEach(h => {
        const dStr = `${year}-${pad(h.m)}-${pad(h.d)}`;
        addHol(dStr, h.name);
        if (h.sub) singleSubTargets.push(dStr);
    });

    const lunarMap = getLunarMapForYear(year);
    let seollalDay = null, buddhaDay = null, chuseokDay = null;
    Object.keys(lunarMap).forEach(dStr => {
        const info = lunarMap[dStr];
        if (info.isLeap) return;
        if (info.lm === 1 && info.ld === 1) seollalDay = dStr;
        if (info.lm === 4 && info.ld === 8) buddhaDay = dStr;
        if (info.lm === 8 && info.ld === 15) chuseokDay = dStr;
    });

    if (seollalDay) {
        const d1 = shiftDateStr(seollalDay, -1), d3 = shiftDateStr(seollalDay, 1);
        addHol(d1, '설날 연휴'); addHol(seollalDay, '설날'); addHol(d3, '설날 연휴');
        groupSubTargets.push([d1, seollalDay, d3]);
    }
    if (buddhaDay) { addHol(buddhaDay, '부처님오신날'); singleSubTargets.push(buddhaDay); }
    if (chuseokDay) {
        const d1 = shiftDateStr(chuseokDay, -1), d3 = shiftDateStr(chuseokDay, 1);
        addHol(d1, '추석 연휴'); addHol(chuseokDay, '추석'); addHol(d3, '추석 연휴');
        groupSubTargets.push([d1, chuseokDay, d3]);
    }

    const addNextWeekdaySub = (baseDateStr) => {
        let cand = shiftDateStr(baseDateStr, 1);
        for (let i = 0; i < 10; i++) {
            const dow = getDowFromStr(cand);
            if (dow !== 0 && dow !== 6 && !hols[cand]) { addHol(cand, '대체공휴일'); return; }
            cand = shiftDateStr(cand, 1);
        }
    };
    groupSubTargets.forEach(days => {
        if (days.some(d => getDowFromStr(d) === 0 || (hols[d] && hols[d].length > 1))) addNextWeekdaySub(days[days.length - 1]);
    });
    singleSubTargets.forEach(d => {
        const dow = getDowFromStr(d);
        if (dow === 0 || dow === 6 || (hols[d] && hols[d].length > 1)) addNextWeekdaySub(d);
    });

    holidayYearCache[year] = hols;
    return hols;
}

function getSolarDatesForAnniversaryInYear(anniv, year) {
    const m = Number(anniv.month), d = Number(anniv.day);
    if (anniv.calType === 'solar') {
        const clampedD = Math.min(d, new Date(year, m, 0).getDate());
        return [`${year}-${String(m).padStart(2, '0')}-${String(clampedD).padStart(2, '0')}`];
    }
    const lunarMap = getLunarMapForYear(year);
    const exact = [], fallback29 = [];
    Object.keys(lunarMap).forEach(dStr => {
        const info = lunarMap[dStr];
        if (info.isLeap) return;
        if (info.lm === m && info.ld === d) exact.push(dStr);
        if (d === 30 && info.lm === m && info.ld === 29) fallback29.push(dStr);
    });
    return exact.length > 0 ? exact : fallback29;
}

function getAnniversariesMapForYear(year) {
    const map = {};
    (db.anniversaries || []).forEach(a => {
        getSolarDatesForAnniversaryInYear(a, year).forEach(dStr => {
            if (!map[dStr]) map[dStr] = [];
            map[dStr].push(a);
        });
    });
    return map;
}

function getDaySpecialInfo(dateStr) {
    const year = Number(dateStr.slice(0, 4));
    return {
        hols: getKoreanHolidaysForYear(year)[dateStr] || [],
        annivs: getAnniversariesMapForYear(year)[dateStr] || []
    };
}

function getSpecificPendingDueListForRange(startStr, endStr) {
    if (typeof getSpecificPendingAutoItemsForMonth !== 'function') return [];
    const ymPairs = new Set([startStr.slice(0, 7), endStr.slice(0, 7)]);
    const result = [];
    ymPairs.forEach(ym => {
        const [y, m] = ym.split('-').map(Number);
        getSpecificPendingAutoItemsForMonth(y, m).forEach(item => {
            if (item.date >= startStr && item.date <= endStr) result.push(item);
        });
    });
    return result.sort((a, b) => a.date.localeCompare(b.date) || compareKorean(a.name, b.name));
}

function renderSpecificDueBanner(bannerId, dueList, targetY, targetM) {
    const el = document.getElementById(bannerId);
    if (!el) return;
    if (!dueList || dueList.length === 0) {
        el.classList.add('hidden'); el.innerHTML = ''; return;
    }
    el.classList.remove('hidden');
    const itemsText = dueList.map(it => {
        const mm = Number(it.date.slice(5, 7)), dd = Number(it.date.slice(8, 10));
        return `<span class="font-bold text-gray-800">${mm}/${dd} ${escHtml(it.name)}</span>`;
    }).join(' <span class="text-gray-400">·</span> ');

    el.innerHTML = `
        <div class="flex flex-wrap items-center gap-1.5">
            <span class="px-1.5 py-0.5 rounded bg-orange-100 text-orange-800 font-bold text-[10px] shrink-0">이번 달 납부 예정</span>
            <span class="text-gray-700">${itemsText}</span>
        </div>
        <button onclick="jumpToAutoTransferMonth(${targetY}, ${targetM})" class="text-[11px] font-bold text-orange-700 hover:underline shrink-0">정기 지출에서 반영 →</button>`;
}

function renderPendingDueCardsHtml(dayDues, targetY, targetM) {
    return dayDues.map(it => {
        const amtText = it.expectedAmount ? `예상 ${it.expectedAmount.toLocaleString()}원` : '금액 직접 입력';
        return `
            <div class="bg-orange-50/70 p-3 rounded-xl border border-orange-200 flex flex-wrap justify-between items-center gap-2 text-xs">
                <div class="space-y-0.5">
                    <div class="flex items-center gap-1.5 flex-wrap">
                        <span class="px-1.5 py-0.5 rounded bg-orange-100 text-orange-800 font-bold text-[10px]">납부 예정</span>
                        <span class="font-bold text-gray-800">${escHtml(it.name)}</span>
                        ${it.shifted ? '<span class="px-1.5 py-0.5 rounded bg-blue-50 text-blue-700 font-bold text-[10px]">영업일 보정</span>' : ''}
                    </div>
                    <div class="text-[11px] text-gray-500">특정 월 정기 납부 · ${amtText}</div>
                </div>
                <button onclick="jumpToAutoTransferMonth(${targetY}, ${targetM})" class="px-2.5 py-1 btn-orange rounded-lg font-bold text-[11px] ml-auto">반영하러 가기</button>
            </div>`;
    }).join('');
}

// =========================================================
// 공용 유틸리티 및 테마 적용
// =========================================================
function formatCommaInput(el) {
    const raw = el.value.replace(/[^0-9]/g, '');
    el.value = raw ? Number(raw).toLocaleString() : '';
}
function parseCommaNumber(val) {
    const raw = String(val || '').replace(/[^0-9]/g, '');
    return raw ? Number(raw) : 0;
}
function formatNumberToInput(num, allowZero = false) {
    const n = Number(num) || 0;
    return n === 0 ? (allowZero ? '0' : '') : n.toLocaleString();
}
function escHtml(str) {
    return String(str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
function getTypeBehavior(typeName) {
    const found = db.txTypes.find(t => t.name === typeName);
    if (found) return found.behavior;
    if (typeName === '수입') return 'income';
    if (typeName === '이체·저축') return 'transfer';
    if (typeName === '선불·상품권 충전') return 'voucher';
    return 'expense';
}
function getTypeNameByBehavior(behavior) {
    const found = db.txTypes.find(t => t.behavior === behavior);
    return found ? found.name : (behavior === 'income' ? '수입' : '지출');
}

const todayObj = new Date();
const formatYMD = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const formatYM = (y, m) => `${y}-${String(m).padStart(2, '0')}`;

function addMonthToYM(y, m, offset) {
    const total = (y * 12 + (m - 1)) + offset;
    return { y: Math.floor(total / 12), m: (total % 12) + 1 };
}
function makeClampedDate(baseY, baseM, monthOffset, day) {
    const { y, m } = addMonthToYM(baseY, baseM, monthOffset);
    const lastDay = new Date(y, m, 0).getDate();
    const actualDay = (Number(day) === 31) ? lastDay : Math.min(Number(day) || 1, lastDay);
    return `${y}-${String(m).padStart(2, '0')}-${String(actualDay).padStart(2, '0')}`;
}

function applyTheme(themeName) {
    const t = themeName || 'pastel';
    document.documentElement.setAttribute('data-theme', t);
    const input = document.getElementById('cfgTheme');
    if (input) input.value = t;
    document.querySelectorAll('.theme-opt-btn').forEach(btn => {
        const isAct = btn.getAttribute('data-theme-btn') === t;
        btn.className = isAct
            ? 'theme-opt-btn p-3 rounded-xl border-2 border-amber-500 ring-2 ring-amber-200 bg-amber-50/40 text-left transition flex flex-col gap-1.5'
            : 'theme-opt-btn p-3 rounded-xl border-2 border-gray-200 hover:border-gray-300 bg-white text-left transition flex flex-col gap-1.5';
    });
}
function selectThemeOption(themeName) {
    db.config.theme = themeName;
    applyTheme(themeName);
    localStorage.setItem('custom_budget_v2', JSON.stringify(db));
    if (typeof syncDbToCloud === 'function') syncDbToCloud();
}

// 전역 상태
let activeMainTab = 'tab1';
let currentGlobalUser = '전체';
let viewYear = todayObj.getFullYear(), viewMonth = todayObj.getMonth() + 1;
let selectedDateStr = formatYMD(todayObj), txViewMode = 'calendar';
let cfYear = todayObj.getFullYear(), cfMonth = todayObj.getMonth() + 1;
let cfSelectedDate = formatYMD(todayObj), cfAccountFilter = '전체', cfViewMode = 'calendar';
let cfHideZeroCards = true;
let selectedCatType = db.txTypes[0] ? db.txTypes[0].name : '지출';
let selectedMainCat = '';

function saveDb() {
    localStorage.setItem('custom_budget_v2', JSON.stringify(db));
    renderAll();
    if (typeof syncDbToCloud === 'function') syncDbToCloud();
}

function getViewPeriodRange() {
    const startDay = Number(db.config.startDayOfMonth) || 1;
    const lastDayOfViewMonth = new Date(viewYear, viewMonth, 0).getDate();
    if (startDay === 1) {
        return {
            start: `${viewYear}-${String(viewMonth).padStart(2, '0')}-01`,
            end: `${viewYear}-${String(viewMonth).padStart(2, '0')}-${String(lastDayOfViewMonth).padStart(2, '0')}`
        };
    }
    const startDate = new Date(viewYear, viewMonth - 1, Math.min(startDay, lastDayOfViewMonth));
    const nextMonthDate = new Date(viewYear, viewMonth, Math.min(startDay, new Date(viewYear, viewMonth + 1, 0).getDate()));
    nextMonthDate.setDate(nextMonthDate.getDate() - 1);
    return { start: formatYMD(startDate), end: formatYMD(nextMonthDate) };
}

function initDropdowns() {
    const fillDays = (elId, includeEndText = false) => {
        const el = document.getElementById(elId);
        if (!el) return;
        el.innerHTML = '';
        for (let d = 1; d <= 31; d++) {
            const opt = document.createElement('option');
            opt.value = d;
            opt.textContent = (includeEndText && d === 31) ? '31일 (말일)' : `${d}일`;
            el.appendChild(opt);
        }
    };
    fillDays('cfgStartDayOfMonth');
    fillDays('cardPayDay');
    fillDays('cardStartDay');
    fillDays('cardEndDay', true);
    fillDays('annivDay');
    document.getElementById('cardPayDay').value = 25;
    document.getElementById('cardStartDay').value = 14;
    document.getElementById('cardEndDay').value = 13;

    const annivMonthSel = document.getElementById('annivMonth');
    annivMonthSel.innerHTML = '';
    for (let m = 1; m <= 12; m++) {
        const opt = document.createElement('option');
        opt.value = m; opt.textContent = `${m}월`;
        annivMonthSel.appendChild(opt);
    }

    const instSel = document.getElementById('txInstallmentMonths');
    instSel.innerHTML = '';
    for (let m = 2; m <= 36; m++) {
        const opt = document.createElement('option');
        opt.value = m; opt.textContent = `${m}개월`;
        if (m === 3) opt.selected = true;
        instSel.appendChild(opt);
    }

    const curYM = formatYM(todayObj.getFullYear(), todayObj.getMonth() + 1);
    const exS = document.getElementById('excelStartYM');
    const exE = document.getElementById('excelEndYM');
    if (exS && !exS.value) exS.value = curYM;
    if (exE && !exE.value) exE.value = curYM;
}

function switchMainTab(tabId) {
    activeMainTab = tabId;
    document.querySelectorAll('.main-tab-btn').forEach(b => {
        b.className = "main-tab-btn title-font py-2 sm:py-2.5 text-sm sm:text-base rounded-xl text-center text-gray-500 hover:bg-gray-50 transition whitespace-nowrap";
    });
    const activeBtn = document.getElementById('main-' + tabId);
    if (activeBtn) activeBtn.className = "main-tab-btn title-font py-2 sm:py-2.5 text-sm sm:text-base rounded-xl text-center main-tab-active shadow-sm transition whitespace-nowrap";

    ['tab1', 'tab2', 'tab3', 'tab4', 'tab5', 'tab6'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.classList.toggle('hidden', tabId !== id);
    });

    if (tabId === 'tab1') renderTab1();
    if (tabId === 'tab2') renderTab2();
    if (tabId === 'tab3' && typeof renderTab3 === 'function') renderTab3();
    if (tabId === 'tab4' && typeof renderTab4 === 'function') renderTab4();
    if (tabId === 'tab5' && typeof renderTab5 === 'function') renderTab5();
    if (tabId === 'tab6' && typeof renderCloudBackupList === 'function') renderCloudBackupList();
}

function onGlobalUserChange(val) {
    currentGlobalUser = val;
    renderTab1();
    renderTab2();
    if (typeof renderTab3 === 'function') renderTab3();
    if (typeof renderTab4 === 'function') renderTab4();
    if (typeof renderTab5 === 'function') renderTab5();
}

function renderAll() {
    applyTheme(db.config.theme);
    document.title = db.config.appTitle;
    document.getElementById('headerAppTitle').textContent = db.config.appTitle;

    const globalUserSel = document.getElementById('globalUserFilter');
    globalUserSel.innerHTML = `<option value="전체">전체 합산</option>` + db.users.map(u => `<option value="${escHtml(u)}">${escHtml(u)}</option>`).join('');
    if (currentGlobalUser !== '전체' && !db.users.includes(currentGlobalUser)) currentGlobalUser = '전체';
    globalUserSel.value = currentGlobalUser;

    const listTypeSel = document.getElementById('listTypeFilter');
    const prevListType = listTypeSel.value || '전체';
    listTypeSel.innerHTML = `<option value="전체">전체 구분</option>` + db.txTypes.map(t => `<option value="${escHtml(t.name)}">${escHtml(t.name)}</option>`).join('');
    listTypeSel.value = (prevListType === '전체' || db.txTypes.some(t => t.name === prevListType)) ? prevListType : '전체';

    renderAllSettings();
    syncTxFormOptions();
    renderTab1();
    renderTab2();
    if (typeof renderTab3 === 'function') renderTab3();
    if (typeof renderTab4 === 'function') renderTab4();
    if (typeof renderTab5 === 'function') renderTab5();
}

// =========================================================
// [1. 가계부] 로직
// =========================================================
function syncTxFormOptions() {
    const isEditing = !!document.getElementById('editTxId').value;
    const prevUser = document.getElementById('txUser').value;
    const prevType = document.getElementById('txType').value;

    const userSel = document.getElementById('txUser');
    userSel.innerHTML = db.users.map(u => `<option value="${escHtml(u)}">${escHtml(u)}</option>`).join('');
    if (!isEditing) userSel.value = db.users.includes(db.config.defaultUser) ? db.config.defaultUser : db.users[0];
    else if (db.users.includes(prevUser)) userSel.value = prevUser;

    const typeSel = document.getElementById('txType');
    typeSel.innerHTML = db.txTypes.map(t => `<option value="${escHtml(t.name)}">${escHtml(t.name)}</option>`).join('');
    if (!isEditing) {
        document.getElementById('txDate').value = selectedDateStr;
        typeSel.value = db.txTypes.some(t => t.name === db.config.defaultType) ? db.config.defaultType : (db.txTypes[0]?.name || '');
    } else if (db.txTypes.some(t => t.name === prevType)) {
        typeSel.value = prevType;
    }
    onTxTypeChange(isEditing);
}

function onTxUserChange() {
    onTxTypeChange(true);
}

function updateTxMemoPlaceholder(behavior) {
    const labelEl = document.getElementById('txMemoLabel');
    const memoEl = document.getElementById('txMemo');
    if (!memoEl) return;
    if (behavior === 'income') {
        if (labelEl) labelEl.textContent = '내용 (수입처)';
        memoEl.placeholder = '예: 월급, 배당금 입금, 중고거래';
    } else if (behavior === 'transfer') {
        if (labelEl) labelEl.textContent = '내용 (이체 사유)';
        memoEl.placeholder = '예: 적금 이체, 주식 매수, 대출 원금 상환';
    } else if (behavior === 'voucher') {
        if (labelEl) labelEl.textContent = '내용 (충전 내역)';
        memoEl.placeholder = '예: 온누리상품권 충전, 지역사랑상품권 충전';
    } else {
        if (labelEl) labelEl.textContent = '내용 (사용처)';
        memoEl.placeholder = '예: 마트 장보기, 점심 식사';
    }
}

function onTxTypeChange(keepSelection = false) {
    const type = document.getElementById('txType').value;
    const selectedUser = document.getElementById('txUser').value;
    const behavior = getTypeBehavior(type);
    const prevMain = document.getElementById('txCatMain').value;
    const prevSub = document.getElementById('txCatSub').value;

    updateTxMemoPlaceholder(behavior);

    const catMainSel = document.getElementById('txCatMain');
    const mains = Object.keys(db.categories[type] || {});
    catMainSel.innerHTML = mains.length ? mains.map(m => `<option value="${escHtml(m)}">${escHtml(m)}</option>`).join('') : '<option value="">카테고리 없음</option>';

    if (keepSelection && mains.includes(prevMain)) catMainSel.value = prevMain;
    else if (!keepSelection && type === db.config.defaultType && mains.includes(db.config.defaultCatMain)) catMainSel.value = db.config.defaultCatMain;
    updateTxSubCategories(keepSelection ? prevSub : '');

    const isTransfer = (behavior === 'transfer' || behavior === 'voucher');
    const isExpense = (behavior === 'expense');

    document.getElementById('methodSingleBox').classList.toggle('hidden', isTransfer);
    document.getElementById('methodTransferBox').classList.toggle('hidden', !isTransfer);
    document.getElementById('expenseOptionsBox').classList.toggle('hidden', !isExpense);

    const banksAll = db.assets.filter(a => a.group === 'bank' && a.type !== '실물자산');
    const banksNoVoucher = banksAll.filter(a => a.type !== '선불·상품권');
    const vouchersOnly = banksAll.filter(a => a.type === '선불·상품권');
    const cards = db.assets.filter(a => a.group === 'card');
    const minusAccounts = db.assets.filter(a => a.group === 'debt' && a.type === '마이너스통장');
    const generalLoans = db.assets.filter(a => a.group === 'debt' && a.type === '일반대출');

    if (isTransfer) {
        const fromSel = document.getElementById('txFromAccount');
        const toSel = document.getElementById('txToAccount');
        const prevFrom = fromSel.value, prevTo = toSel.value;
        const fromList = sortAssetsForUser([...banksNoVoucher, ...minusAccounts], selectedUser);
        const toList = sortAssetsForUser((behavior === 'voucher') ? vouchersOnly : [...banksNoVoucher, ...minusAccounts, ...generalLoans], selectedUser);

        document.getElementById('txToAccountLabel').textContent = (behavior === 'voucher') ? '입금 자산 (충전할 선불·상품권)' : '입금 자산 (통장·적금·투자·대출)';
        fromSel.innerHTML = fromList.length ? fromList.map(a => `<option value="${escHtml(a.id)}">${escHtml(getAssetOptionText(a))}</option>`).join('') : '<option value="">등록된 출금 계좌 없음</option>';
        toSel.innerHTML = toList.length ? toList.map(a => `<option value="${escHtml(a.id)}">${escHtml(getAssetOptionText(a))}</option>`).join('') : '<option value="">등록된 입금 자산 없음</option>';

        if (keepSelection && prevFrom && fromList.some(a => a.id === prevFrom)) fromSel.value = prevFrom;
        if (keepSelection && prevTo && toList.some(a => a.id === prevTo)) toSel.value = prevTo;
    } else {
        const methodSel = document.getElementById('txMethod');
        const prevMethod = methodSel.value;
        document.getElementById('txMethodLabel').textContent = isExpense ? '결제수단' : '입금 계좌 / 자산';
        const list = sortAssetsForUser(isExpense ? [...cards, ...banksAll, ...minusAccounts] : [...banksAll, ...minusAccounts], selectedUser);
        methodSel.innerHTML = list.length ? list.map(a => `<option value="${escHtml(a.id)}">${escHtml(getAssetOptionText(a))}</option>`).join('') : '<option value="">등록된 자산 없음</option>';
        if (keepSelection && prevMethod && list.some(a => a.id === prevMethod)) methodSel.value = prevMethod;
        onTxMethodChange();
    }
}

function updateTxSubCategories(preselect = '') {
    const type = document.getElementById('txType').value;
    const main = document.getElementById('txCatMain').value;
    const subSel = document.getElementById('txCatSub');
    const subs = (db.categories[type] && db.categories[type][main]) || [];
    subSel.innerHTML = '<option value="">(선택 안 함)</option>' + subs.map(s => `<option value="${escHtml(s)}">${escHtml(s)}</option>`).join('');
    if (preselect && subs.includes(preselect)) subSel.value = preselect;
}

function onTxMethodChange() {
    if (getTypeBehavior(document.getElementById('txType').value) !== 'expense') return;
    const asset = findAsset(document.getElementById('txMethod').value);
    const isCredit = asset && asset.type === '신용카드';
    const box = document.getElementById('expenseOptionsBox');
    const check = document.getElementById('txIsInstallment');
    if (!isCredit) { box.classList.add('hidden'); check.checked = false; toggleInstallmentMonths(false); }
    else box.classList.remove('hidden');
}

function toggleInstallmentMonths(checked) {
    document.getElementById('installmentMonthsBox').classList.toggle('hidden', !checked);
}

function handleTxSubmit(e) {
    e.preventDefault();
    const editId = document.getElementById('editTxId').value;
    const date = document.getElementById('txDate').value;
    const user = document.getElementById('txUser').value;
    const type = document.getElementById('txType').value;
    const behavior = getTypeBehavior(type);
    const catMain = document.getElementById('txCatMain').value;
    const catSub = document.getElementById('txCatSub').value;
    const memo = document.getElementById('txMemo').value.trim();
    const amount = parseCommaNumber(document.getElementById('txAmount').value);
    const isTransfer = (behavior === 'transfer' || behavior === 'voucher');

    if (amount <= 0) return alert('금액은 1원 이상 입력해 주세요.');
    let method = '', targetAsset = '';
    if (isTransfer) {
        method = document.getElementById('txFromAccount').value;
        targetAsset = document.getElementById('txToAccount').value;
        if (!method || !targetAsset) return alert('출금 계좌와 입금 자산을 모두 선택해 주세요.');
        if (method === targetAsset) return alert('출금 계좌와 입금 자산은 서로 다르게 선택해 주세요.');
    } else {
        method = document.getElementById('txMethod').value;
        if (!method) return alert('결제수단 또는 입금 계좌를 선택해 주세요.');
    }

    const asset = findAsset(method);
    const isInstallment = behavior === 'expense' && asset && asset.type === '신용카드' && document.getElementById('txIsInstallment').checked;
    const installmentMonths = isInstallment ? Number(document.getElementById('txInstallmentMonths').value) : 1;

    if (editId) {
        const target = db.transactions.find(t => t.id === editId);
        if (target) Object.assign(target, { date, user, type, catMain, catSub, method, targetAsset, memo, amount, installmentMonths });
    } else {
        db.transactions.push({ id: 'TX_' + Date.now(), date, user, type, catMain, catSub, method, targetAsset, memo, amount, installmentMonths });
    }
    selectedDateStr = date;
    resetTxForm();
    saveDb();
}

function startEditTx(id) {
    const t = db.transactions.find(x => x.id === id);
    if (!t) return;
    const txFormEl = document.getElementById('txForm');
    if (txFormEl && txFormEl.classList.contains('hidden')) txFormEl.classList.remove('hidden');

    const behavior = getTypeBehavior(t.type);
    document.getElementById('editTxId').value = t.id;
    document.getElementById('txFormTitle').textContent = '내역 수정 중';
    document.getElementById('txSubmitBtn').textContent = '수정 내용 저장';
    document.getElementById('txCancelEditBtn').classList.remove('hidden');
    document.getElementById('txDate').value = t.date;
    document.getElementById('txUser').value = t.user;
    document.getElementById('txType').value = t.type;
    onTxTypeChange(false);
    document.getElementById('txCatMain').value = t.catMain;
    updateTxSubCategories(t.catSub);
    if (behavior === 'transfer' || behavior === 'voucher') {
        document.getElementById('txFromAccount').value = resolveToAssetId(t.method);
        document.getElementById('txToAccount').value = resolveToAssetId(t.targetAsset);
    } else {
        document.getElementById('txMethod').value = resolveToAssetId(t.method);
        onTxMethodChange();
    }
    document.getElementById('txMemo').value = t.memo;
    document.getElementById('txAmount').value = formatNumberToInput(t.amount);
    const months = Number(t.installmentMonths) || 1;
    document.getElementById('txIsInstallment').checked = months > 1;
    toggleInstallmentMonths(months > 1);
    if (months > 1) document.getElementById('txInstallmentMonths').value = months;
    window.scrollTo({ top: 0, behavior: 'smooth' });
}

function resetTxForm() {
    document.getElementById('editTxId').value = '';
    document.getElementById('txFormTitle').textContent = '내역 입력';
    document.getElementById('txSubmitBtn').textContent = '내역 저장하기';
    document.getElementById('txCancelEditBtn').classList.add('hidden');
    document.getElementById('txMemo').value = '';
    document.getElementById('txAmount').value = '';
    document.getElementById('txIsInstallment').checked = false;
    toggleInstallmentMonths(false);
    syncTxFormOptions();
}

function deleteTx(id) {
    const t = db.transactions.find(x => x.id === id);
    if (t && confirm(`'${t.memo}' (${Number(t.amount).toLocaleString()}원) 내역을 삭제하시겠습니까?`)) {
        db.transactions = db.transactions.filter(x => x.id !== id);
        db.cardEvents = db.cardEvents.filter(e => e.txId !== id);
        if (document.getElementById('editTxId').value === id) resetTxForm();
        saveDb();
    }
}

function getFilteredPeriodTransactions() {
    const { start, end } = getViewPeriodRange();
    return db.transactions.filter(t => (currentGlobalUser === '전체' || t.user === currentGlobalUser) && t.date >= start && t.date <= end);
}

function renderTab1() {
    const period = getViewPeriodRange();
    const txs = getFilteredPeriodTransactions();
    let totalIn = 0, totalOut = 0, totalTransfer = 0;
    txs.forEach(t => {
        const amt = Number(t.amount) || 0, b = getTypeBehavior(t.type);
        if (b === 'income') totalIn += amt;
        else if (b === 'expense') totalOut += amt;
        else totalTransfer += amt;
    });
    document.getElementById('sumIncome').textContent = `+${totalIn.toLocaleString()}원`;
    document.getElementById('sumExpense').textContent = `-${totalOut.toLocaleString()}원`;
    const bal = totalIn - totalOut, balEl = document.getElementById('sumBalance');
    balEl.textContent = `${bal >= 0 ? '+' : ''}${bal.toLocaleString()}원`;
    balEl.className = `text-lg sm:text-xl font-bold mt-0.5 ${bal >= 0 ? 'text-gray-800' : 'text-rose-600'}`;
    document.getElementById('sumTransferInfo').textContent = `이체·충전 ${totalTransfer.toLocaleString()}원`;
    document.getElementById('calendarTitle').textContent = `${viewYear}년 ${viewMonth}월`;
    document.getElementById('calendarRangeLabel').textContent = Number(db.config.startDayOfMonth) > 1 ? `${period.start} ~ ${period.end}` : '';
    renderCalendarView(period, txs);
    renderListView();
}

function changeViewMonth(delta) {
    const next = addMonthToYM(viewYear, viewMonth, delta);
    viewYear = next.y; viewMonth = next.m;
    selectedDateStr = getViewPeriodRange().start;
    if (!document.getElementById('editTxId').value) document.getElementById('txDate').value = selectedDateStr;
    renderTab1();
}
function goToday() {
    const now = new Date();
    viewYear = now.getFullYear(); viewMonth = now.getMonth() + 1; selectedDateStr = formatYMD(now);
    if (!document.getElementById('editTxId').value) document.getElementById('txDate').value = selectedDateStr;
    renderTab1();
}
function switchTxViewMode(mode) {
    txViewMode = mode;
    document.getElementById('calendarViewContainer').classList.toggle('hidden', mode !== 'calendar');
    document.getElementById('listViewContainer').classList.toggle('hidden', mode !== 'list');
    document.getElementById('viewModeCal').className = mode === 'calendar' ? "px-2 sm:px-3 py-1 sm:py-1.5 text-[11px] sm:text-xs font-bold rounded-lg bg-white text-gray-800 shadow-sm whitespace-nowrap" : "px-2 sm:px-3 py-1 sm:py-1.5 text-[11px] sm:text-xs font-bold rounded-lg text-gray-500 whitespace-nowrap";
    document.getElementById('viewModeList').className = mode === 'list' ? "px-2 sm:px-3 py-1 sm:py-1.5 text-[11px] sm:text-xs font-bold rounded-lg bg-white text-gray-800 shadow-sm whitespace-nowrap" : "px-2 sm:px-3 py-1 sm:py-1.5 text-[11px] sm:text-xs font-bold rounded-lg text-gray-500 whitespace-nowrap";
}

function renderSpecialBadgesHtml(dateStr) {
    const { hols, annivs } = getDaySpecialInfo(dateStr);
    let html = '';
    hols.forEach(h => { html += `<span class="text-[10px] px-1.5 py-0.5 rounded bg-rose-100 text-rose-700 font-bold">${escHtml(h)}</span>`; });
    annivs.forEach(a => {
        const sub = a.calType === 'lunar' ? ` (음 ${a.month}.${a.day})` : '';
        html += `<span class="text-[10px] px-1.5 py-0.5 rounded bg-pink-100 text-pink-800 font-bold">${escHtml(a.name)}${sub}</span>`;
    });
    return html;
}

function renderCalendarView(period, periodTxs) {
    const startDow = Number(db.config.startDayOfWeek) || 0;
    const daysSun = [
        { label: '일', cls: 'text-rose-500' }, { label: '월', cls: '' }, { label: '화', cls: '' },
        { label: '수', cls: '' }, { label: '목', cls: '' }, { label: '금', cls: '' }, { label: '토', cls: 'text-blue-500' }
    ];
    const orderedDays = startDow === 1 ? [...daysSun.slice(1), daysSun[0]] : daysSun;
    document.getElementById('calendarWeekdays').innerHTML = orderedDays.map(d => `<div class="${d.cls}">${d.label}</div>`).join('');

    const pendingDues = getSpecificPendingDueListForRange(period.start, period.end);
    renderSpecificDueBanner('tab1SpecificDueBanner', pendingDues, viewYear, viewMonth);
    const dueByDate = {};
    pendingDues.forEach(it => {
        if (!dueByDate[it.date]) dueByDate[it.date] = [];
        dueByDate[it.date].push(it);
    });

    const dayMap = {};
    periodTxs.forEach(t => {
        if (!dayMap[t.date]) dayMap[t.date] = { in: 0, out: 0, tr: 0 };
        const amt = Number(t.amount) || 0, b = getTypeBehavior(t.type);
        if (b === 'income') dayMap[t.date].in += amt;
        else if (b === 'expense') dayMap[t.date].out += amt;
        else dayMap[t.date].tr += amt;
    });

    const grid = document.getElementById('calendarGrid');
    grid.innerHTML = '';
    const [sy, sm, sd] = period.start.split('-').map(Number);
    const [ey, em, ed] = period.end.split('-').map(Number);
    const cur = new Date(sy, sm - 1, sd), end = new Date(ey, em - 1, ed);
    for (let i = 0; i < (cur.getDay() - startDow + 7) % 7; i++) grid.appendChild(document.createElement('div'));

    const todayStr = formatYMD(new Date()), isCustomStart = Number(db.config.startDayOfMonth) > 1;
    while (cur <= end) {
        const dStr = formatYMD(cur), dayNum = cur.getDate(), monthNum = cur.getMonth() + 1, dow = cur.getDay();
        const info = dayMap[dStr], { hols, annivs } = getDaySpecialInfo(dStr), dues = dueByDate[dStr] || [];
        const isHoliday = hols.length > 0, isSelected = (dStr === selectedDateStr), isToday = (dStr === todayStr);
        const cell = document.createElement('div');
        cell.onclick = () => selectCalendarDate(dStr);
        cell.className = `p-1.5 rounded-xl border min-h-[86px] flex flex-col justify-between cursor-pointer transition ${
            isSelected ? 'bg-amber-100/80 border-amber-400 ring-2 ring-amber-300' : 'bg-white border-gray-100 hover:border-amber-300 hover:bg-amber-50/30'
        }`;
        const dayLabel = (isCustomStart && (dayNum === 1 || dStr === period.start)) ? `${monthNum}/${dayNum}` : `${dayNum}`;
        const dayColor = (dow === 0 || isHoliday) ? 'text-rose-500' : (dow === 6 ? 'text-blue-500' : 'text-gray-700');
        cell.innerHTML = `
            <div>
                <div class="flex justify-between items-center gap-1">
                    <span class="text-[11px] font-bold ${dayColor} shrink-0">${dayLabel}</span>
                    ${isToday ? '<span class="text-[9px] bg-amber-400 text-gray-900 px-1 rounded font-bold shrink-0">오늘</span>' : ''}
                    ${!isToday && isHoliday ? `<span class="text-[9px] text-rose-500 font-medium truncate">${escHtml(hols[0])}</span>` : ''}
                </div>
                ${isToday && isHoliday ? `<div class="text-[9px] text-rose-500 font-medium truncate leading-tight">${escHtml(hols[0])}</div>` : ''}
                ${annivs.length > 0 ? `<div class="mt-0.5 text-[9px] bg-pink-50 text-pink-700 px-1 rounded font-bold truncate">${escHtml(annivs.map(a => a.name).join(', '))}</div>` : ''}
                ${dues.length > 0 ? `<div class="mt-0.5 text-[9px] bg-orange-50 text-orange-700 px-1 rounded font-bold truncate">납부: ${escHtml(dues.map(d => d.name).join(', '))}</div>` : ''}
            </div>
            <div class="space-y-0.5 text-right leading-tight mt-1">
                ${info && info.in > 0 ? `<div class="text-[10px] text-blue-600 font-bold truncate">+${info.in.toLocaleString()}</div>` : ''}
                ${info && info.out > 0 ? `<div class="text-[10px] text-rose-500 font-bold truncate">-${info.out.toLocaleString()}</div>` : ''}
                ${info && info.tr > 0 ? `<div class="text-[10px] text-purple-600 font-bold truncate">${info.tr.toLocaleString()}</div>` : ''}
            </div>`;
        grid.appendChild(cell);
        cur.setDate(cur.getDate() + 1);
    }
    renderSelectedDayPanel(dueByDate[selectedDateStr] || []);
}

function selectCalendarDate(dateStr) {
    selectedDateStr = dateStr;
    if (!document.getElementById('editTxId').value) document.getElementById('txDate').value = dateStr;
    renderTab1();
}

function renderSelectedDayPanel(dayDues = []) {
    document.getElementById('selectedDayTitle').textContent = `${selectedDateStr} 상세 내역`;
    document.getElementById('selectedDayBadges').innerHTML = renderSpecialBadgesHtml(selectedDateStr);
    const dayTxs = db.transactions.filter(t => (currentGlobalUser === '전체' || t.user === currentGlobalUser) && t.date === selectedDateStr);
    const [sy, sm] = selectedDateStr.split('-').map(Number);

    document.getElementById('selectedDayCount').textContent = dayDues.length > 0
        ? `내역 ${dayTxs.length}건 · 납부예정 ${dayDues.length}건`
        : `총 ${dayTxs.length}건`;

    const listEl = document.getElementById('selectedDayList');
    if (dayTxs.length === 0 && dayDues.length === 0) {
        listEl.innerHTML = `<div class="text-xs text-gray-400 py-3 text-center bg-white rounded-xl border border-amber-100">이 날짜에 등록된 내역이 없습니다.</div>`;
        return;
    }

    const dueHtml = renderPendingDueCardsHtml(dayDues, sy, sm);
    const txHtml = dayTxs.map(t => {
        const b = getTypeBehavior(t.type), isTr = (b === 'transfer' || b === 'voucher');
        const amtColor = b === 'income' ? 'text-blue-600' : (b === 'expense' ? 'text-rose-500' : 'text-purple-600');
        const sign = b === 'income' ? '+' : (b === 'expense' ? '-' : '');
        const instBadge = (Number(t.installmentMonths) > 1) ? `<span class="px-1.5 py-0.5 rounded bg-pink-100 text-pink-800 font-bold text-[10px]">${t.installmentMonths}개월 할부</span>` : '';
        const autoBadge = t.fromAutoTransfer ? `<span class="px-1.5 py-0.5 rounded bg-orange-50 text-orange-700 font-bold text-[10px]">정기</span>` : '';
        const methodDisplay = isTr ? `${getAssetLabel(t.method)} → ${getAssetLabel(t.targetAsset)}` : getAssetLabel(t.method);
        return `
            <div class="bg-white p-3 rounded-xl border border-amber-100 flex flex-wrap justify-between items-center gap-2 text-xs">
                <div class="space-y-0.5">
                    <div class="flex items-center gap-1.5 flex-wrap">
                        <span class="px-1.5 py-0.5 rounded bg-gray-100 text-gray-600 font-bold text-[10px]">${escHtml(t.user)}</span>
                        <span class="font-bold text-amber-900">${escHtml(t.catMain)}${t.catSub ? ' · ' + escHtml(t.catSub) : ''}</span>
                        ${autoBadge}${instBadge}<span class="text-gray-800">${escHtml(t.memo)}</span>
                    </div>
                    <div class="text-[11px] text-gray-400">${escHtml(t.type)} | ${escHtml(methodDisplay)}</div>
                </div>
                <div class="flex items-center gap-2 ml-auto">
                    <span class="font-bold text-sm ${amtColor}">${sign}${Number(t.amount).toLocaleString()}원</span>
                    <button onclick="startEditTx('${t.id}')" class="px-2 py-1 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg font-bold text-[11px]">수정</button>
                    <button onclick="deleteTx('${t.id}')" class="px-2 py-1 bg-red-50 hover:bg-red-100 text-red-600 rounded-lg font-bold text-[11px]">삭제</button>
                </div>
            </div>`;
    }).join('');
    listEl.innerHTML = dueHtml + txHtml;
}

function renderListView() {
    const typeFilter = document.getElementById('listTypeFilter').value;
    const keyword = document.getElementById('listSearchInput').value.trim().toLowerCase();
    let txs = getFilteredPeriodTransactions();
    if (typeFilter !== '전체') txs = txs.filter(t => t.type === typeFilter);
    if (keyword) {
        txs = txs.filter(t => [t.memo, t.catMain, t.catSub, getAssetLabel(t.method), getAssetLabel(t.targetAsset)].some(v => (v || '').toLowerCase().includes(keyword)));
    }
    txs.sort((a, b) => b.date.localeCompare(a.date));

    const tbody = document.getElementById('transactionListTable');
    if (txs.length === 0) { tbody.innerHTML = `<tr><td colspan="7" class="py-10 text-center text-gray-400">조건에 맞는 내역이 없습니다.</td></tr>`; return; }
    tbody.innerHTML = txs.map(t => {
        const b = getTypeBehavior(t.type), isTr = (b === 'transfer' || b === 'voucher');
        const amtColor = b === 'income' ? 'text-blue-600' : (b === 'expense' ? 'text-rose-500' : 'text-purple-600');
        const sign = b === 'income' ? '+' : (b === 'expense' ? '-' : '');
        const instBadge = (Number(t.installmentMonths) > 1) ? `<span class="text-[10px] px-1.5 py-0.5 rounded bg-pink-100 text-pink-800 font-bold mr-1">${t.installmentMonths}개월 할부</span>` : '';
        const autoBadge = t.fromAutoTransfer ? `<span class="text-[10px] px-1.5 py-0.5 rounded bg-orange-50 text-orange-700 font-bold mr-1">정기</span>` : '';
        const methodDisplay = isTr ? `${getAssetLabel(t.method)} → ${getAssetLabel(t.targetAsset)}` : getAssetLabel(t.method);
        return `
            <tr class="hover:bg-amber-50/40">
                <td class="py-2.5 px-3 text-gray-500 whitespace-nowrap">${t.date}</td>
                <td class="py-2.5 px-3 font-bold text-gray-700 whitespace-nowrap">${escHtml(t.user)}</td>
                <td class="py-2.5 px-3 whitespace-nowrap"><span class="text-[10px] px-1.5 py-0.5 rounded bg-gray-100 text-gray-600 font-bold mr-1">${escHtml(t.type)}</span><span class="font-bold text-gray-800">${escHtml(t.catMain)}</span>${t.catSub ? `<span class="text-gray-400">/${escHtml(t.catSub)}</span>` : ''}</td>
                <td class="py-2.5 px-3 text-gray-800">${autoBadge}${instBadge}${escHtml(t.memo)}</td>
                <td class="py-2.5 px-3 text-gray-500 whitespace-nowrap">${escHtml(methodDisplay)}</td>
                <td class="py-2.5 px-3 text-right font-bold whitespace-nowrap ${amtColor}">${sign}${Number(t.amount).toLocaleString()}원</td>
                <td class="py-2.5 px-3 text-center whitespace-nowrap space-x-1">
                    <button onclick="startEditTx('${t.id}')" class="px-2 py-0.5 bg-gray-100 hover:bg-gray-200 rounded text-gray-700 font-bold">수정</button>
                    <button onclick="deleteTx('${t.id}')" class="px-2 py-0.5 bg-red-50 hover:bg-red-100 rounded text-red-600 font-bold">삭제</button>
                </td>
            </tr>`;
    }).join('');
}

// =========================================================
// [2. 결제·출금] 로직
// =========================================================
function getCardBillingPeriod(card, billY, billM) {
    const offsetMap = { '전전월': -2, '전월': -1, '당월': 0 };
    return {
        start: makeClampedDate(billY, billM, offsetMap[card.startMonthType] ?? -1, card.startDay || 1),
        end: makeClampedDate(billY, billM, offsetMap[card.endMonthType] ?? 0, card.endDay || 31)
    };
}
function findFirstBillingYMForTx(card, txDateStr) {
    const [ty, tm] = txDateStr.split('-').map(Number);
    for (let off = -1; off <= 3; off++) {
        const cand = addMonthToYM(ty, tm, off), p = getCardBillingPeriod(card, cand.y, cand.m);
        if (txDateStr >= p.start && txDateStr <= p.end) return cand;
    }
    return { y: ty, m: tm };
}
function isItemPrepaid(txId, instIdx) {
    return db.cardEvents.some(e => e.type === 'prepay_item' && e.txId === txId && (e.installmentIndex === instIdx || (Array.isArray(e.prepaidIndices) && e.prepaidIndices.includes(instIdx))));
}
function isCardEventMatch(ev, card) {
    return ev.cardId ? ev.cardId === card.id : ev.cardName === card.name;
}

function computeCardBillForMonth(card, billY, billM, filterByUser = false) {
    const billingYM = formatYM(billY, billM), period = getCardBillingPeriod(card, billY, billM), items = [];
    db.transactions.forEach(t => {
        if (filterByUser && currentGlobalUser !== '전체' && t.user !== currentGlobalUser) return;
        const mAsset = findAsset(t.method);
        if (!mAsset || mAsset.id !== card.id || getTypeBehavior(t.type) !== 'expense') return;
        const months = Number(t.installmentMonths) || 1, firstBill = findFirstBillingYMForTx(card, t.date);
        if (months === 1) {
            if (firstBill.y === billY && firstBill.m === billM) {
                items.push({ txId: t.id, user: t.user, date: t.date, memo: t.memo, catMain: t.catMain, catSub: t.catSub, totalAmount: Number(t.amount), billAmount: Number(t.amount), installmentMonths: 1, installmentIndex: 1, isPrepaid: isItemPrepaid(t.id, 1) });
            }
        } else {
            const diff = (billY - firstBill.y) * 12 + (billM - firstBill.m);
            if (diff >= 0 && diff < months) {
                const idx = diff + 1, base = Math.floor(Number(t.amount) / months), rem = Number(t.amount) - (base * months);
                items.push({ txId: t.id, user: t.user, date: t.date, memo: t.memo, catMain: t.catMain, catSub: t.catSub, totalAmount: Number(t.amount), billAmount: idx === 1 ? base + rem : base, installmentMonths: months, installmentIndex: idx, isPrepaid: isItemPrepaid(t.id, idx) });
            }
        }
    });
    items.sort((a, b) => a.date.localeCompare(b.date));
    const grossAmount = items.reduce((s, x) => s + x.billAmount, 0);
    const itemPrepaidSum = items.filter(x => x.isPrepaid).reduce((s, x) => s + x.billAmount, 0);
    const amountPrepaidSum = db.cardEvents.filter(e => e.type === 'prepay_amount' && isCardEventMatch(e, card) && e.billingYM === billingYM).reduce((s, e) => s + (Number(e.amount) || 0), 0);
    const settlement = db.cardEvents.find(e => e.type === 'settlement' && isCardEventMatch(e, card) && e.billingYM === billingYM);
    return { card, billingYM, period, payDate: makeClampedDate(billY, billM, 0, card.payDay || 25), items, grossAmount, itemPrepaidSum, amountPrepaidSum, remainingAmount: Math.max(0, grossAmount - itemPrepaidSum - amountPrepaidSum), settlement };
}

function getCashflowEntriesForMonth(year, month, ignoreUserAndAccount = false) {
    const monthStart = `${year}-${String(month).padStart(2, '0')}-01`;
    const monthEnd = `${year}-${String(month).padStart(2, '0')}-${String(new Date(year, month, 0).getDate()).padStart(2, '0')}`;
    const entries = [];
    const accFilter = ignoreUserAndAccount ? '전체' : cfAccountFilter;
    const isNonChecking = (id) => {
        const a = findAsset(id);
        return a && (a.type === '예·적금' || a.type === '선불·상품권' || a.type === '투자' || a.type === '실물자산' || a.type === '일반대출');
    };
    const isCC = (id) => { const a = findAsset(id); return a && a.type === '신용카드'; };
    const getChkLinkedId = (id) => { const a = findAsset(id); return (a && a.type === '체크카드') ? (resolveToAssetId(a.linkedAccount) || a.id) : null; };
    const matchUserAccount = (accId, fallbackUser) => {
        if (ignoreUserAndAccount || currentGlobalUser === '전체') return true;
        const a = findAsset(accId);
        return a ? a.owner === currentGlobalUser : fallbackUser === currentGlobalUser;
    };

    db.transactions.forEach(t => {
        if (t.date < monthStart || t.date > monthEnd) return;
        const b = getTypeBehavior(t.type), amt = Number(t.amount) || 0;
        const mId = resolveToAssetId(t.method), toId = resolveToAssetId(t.targetAsset);

        if (b === 'income') {
            if (isCC(mId) || !matchUserAccount(mId, t.user)) return;
            if ((accFilter !== '전체' && mId !== accFilter) || (accFilter === '전체' && isNonChecking(mId))) return;
            entries.push({ id: 'CF_TX_' + t.id, date: t.date, kind: 'in', accountId: mId, account: getAssetLabel(mId), title: `[${t.catMain}] ${t.memo}`, sub: t.type, amount: amt, sourceType: 'tx' });
        } else if (b === 'expense') {
            if (isCC(mId)) return;
            const chkLinked = getChkLinkedId(mId), accId = chkLinked || mId;
            if (!matchUserAccount(accId, t.user)) return;
            if (!chkLinked && isNonChecking(accId) && (accFilter === '전체' || accFilter !== accId)) return;
            if (accFilter !== '전체' && accId !== accFilter) return;
            entries.push({ id: 'CF_TX_' + t.id, date: t.date, kind: 'out', accountId: accId, account: getAssetLabel(accId), title: `[${t.catMain}] ${t.memo}`, sub: chkLinked ? `${getAssetLabel(mId, false)} (체크)` : t.type, amount: amt, sourceType: 'tx' });
        } else if (b === 'transfer' || b === 'voucher') {
            if (accFilter === '전체') {
                if (!isNonChecking(mId) && isNonChecking(toId) && matchUserAccount(mId, t.user)) {
                    const toAsset = findAsset(toId);
                    const subLabel = b === 'voucher' ? '상품권 충전' : (toAsset && toAsset.type === '일반대출' ? '대출 원금 상환' : '저축·투자');
                    entries.push({ id: 'CF_TR_' + t.id, date: t.date, kind: 'out', accountId: mId, account: getAssetLabel(mId), title: `${t.memo} (→ ${getAssetLabel(toId)})`, sub: subLabel, amount: amt, sourceType: 'tx' });
                } else if (isNonChecking(mId) && !isNonChecking(toId) && matchUserAccount(toId, t.user)) {
                    entries.push({ id: 'CF_TR_' + t.id, date: t.date, kind: 'in', accountId: toId, account: getAssetLabel(toId), title: `${t.memo} (${getAssetLabel(mId)} →)`, sub: '저축·투자 회수', amount: amt, sourceType: 'tx' });
                }
            } else {
                if (mId === accFilter) entries.push({ id: 'CF_TR_O_' + t.id, date: t.date, kind: 'out', accountId: mId, account: getAssetLabel(mId), title: `${t.memo} (→ ${getAssetLabel(toId)})`, sub: t.type, amount: amt, sourceType: 'tx' });
                else if (toId === accFilter) entries.push({ id: 'CF_TR_I_' + t.id, date: t.date, kind: 'in', accountId: toId, account: getAssetLabel(toId), title: `${t.memo} (${getAssetLabel(mId)} →)`, sub: t.type, amount: amt, sourceType: 'tx' });
            }
        }
    });

    db.cardEvents.forEach(ev => {
        if (ev.date < monthStart || ev.date > monthEnd) return;
        const fromId = resolveToAssetId(ev.fromAccount);
        if (!matchUserAccount(fromId, '')) return;
        if (accFilter !== '전체' && fromId !== accFilter) return;
        const amt = ev.type === 'settlement' ? Number(ev.actualAmount) : Number(ev.amount);
        if (amt <= 0) return;
        const sub = ev.type === 'settlement' ? '카드대금 정산' : (ev.type === 'prepay_item' ? '건별 선결제' : '카드 선결제');
        entries.push({ id: 'CF_EV_' + ev.id, eventId: ev.id, date: ev.date, kind: 'out', accountId: fromId, account: getAssetLabel(fromId), title: ev.memo, sub, amount: amt, sourceType: 'cardEvent' });
    });

    db.assets.filter(a => a.group === 'card' && a.type === '신용카드').forEach(card => {
        if (!ignoreUserAndAccount && currentGlobalUser !== '전체' && card.owner !== currentGlobalUser) return;
        const bill = computeCardBillForMonth(card, year, month, false);
        if (!bill.settlement && bill.remainingAmount > 0) {
            const linkedId = resolveToAssetId(card.linkedAccount);
            if (accFilter !== '전체' && linkedId !== accFilter) return;
            entries.push({
                id: `CF_S_${card.id}_${bill.billingYM}`, date: bill.payDate, kind: 'scheduled',
                accountId: linkedId, account: linkedId ? getAssetLabel(linkedId) : '계좌 미지정',
                title: `[청구 예정] ${getAssetLabel(card.id)} 카드대금`, sub: `결제일 ${month}월 ${card.payDay}일`,
                amount: bill.remainingAmount, sourceType: 'scheduled'
            });
        }
    });
    return entries.sort((a, b) => a.date.localeCompare(b.date));
}

function renderTab2() {
    document.getElementById('cfMonthTitle').textContent = `${cfYear}년 ${cfMonth}월`;
    const accSel = document.getElementById('cfAccountFilter');
    const accs = sortAssetsByOwnerThenName(db.assets.filter(a =>
        ((a.group === 'bank' && a.type !== '선불·상품권' && a.type !== '실물자산') || (a.group === 'debt' && a.type === '마이너스통장')) &&
        (currentGlobalUser === '전체' || a.owner === currentGlobalUser)
    ));
    accSel.innerHTML = `<option value="전체">전체 통장 (내부이체 제외)</option>` + accs.map(a => `<option value="${escHtml(a.id)}">${escHtml(getAssetOptionText(a))}</option>`).join('');
    if (cfAccountFilter !== '전체' && !accs.some(a => a.id === cfAccountFilter)) cfAccountFilter = '전체';
    accSel.value = cfAccountFilter;

    const entries = getCashflowEntriesForMonth(cfYear, cfMonth);
    let sIn = 0, sOut = 0, sSched = 0;
    entries.forEach(e => { if (e.kind === 'in') sIn += e.amount; else if (e.kind === 'out') sOut += e.amount; else sSched += e.amount; });
    const totOut = sOut + sSched, diff = sIn - totOut;
    document.getElementById('cfSumIn').textContent = `+${sIn.toLocaleString()}원`;
    document.getElementById('cfSumOut').textContent = `-${totOut.toLocaleString()}원`;
    document.getElementById('cfSumOutSub').textContent = `확정 ${sOut.toLocaleString()}원 · 카드예정 ${sSched.toLocaleString()}원`;
    const diffEl = document.getElementById('cfSumDiff');
    diffEl.textContent = `${diff >= 0 ? '+' : ''}${diff.toLocaleString()}원`;
    diffEl.className = `text-lg sm:text-xl font-bold mt-0.5 ${diff >= 0 ? 'text-gray-800' : 'text-rose-600'}`;
    document.getElementById('cfAccountBadge').textContent = cfAccountFilter === '전체'
        ? (currentGlobalUser === '전체' ? '전체 통장' : `${currentGlobalUser} 통장`)
        : getAssetLabel(cfAccountFilter);

    renderCfCardBillingBoxes();
    renderCfCalendarView(entries);
    renderCfListView(entries);
}

function toggleCfHideZeroCards(checked) {
    cfHideZeroCards = checked;
    renderCfCardBillingBoxes();
}

function renderCfCardBillingBoxes() {
    const grid = document.getElementById('cfCardBillingGrid');
    const chkEl = document.getElementById('cfHideZeroCardsChk');
    if (chkEl) chkEl.checked = cfHideZeroCards;

    const allCards = sortAssetsByName(db.assets.filter(a =>
        a.group === 'card' && a.type === '신용카드' &&
        (currentGlobalUser === '전체' || a.owner === currentGlobalUser)
    ));
    const bills = allCards.map(c => computeCardBillForMonth(c, cfYear, cfMonth, false));
    const visibleBills = cfHideZeroCards
        ? bills.filter(b => b.grossAmount > 0 || b.remainingAmount > 0 || !!b.settlement)
        : bills;
    const hiddenCount = bills.length - visibleBills.length;

    const hintEl = document.getElementById('cfHiddenZeroCount');
    if (hintEl) hintEl.textContent = hiddenCount > 0 ? `(0원 ${hiddenCount}장 숨김)` : '';

    if (allCards.length === 0) {
        grid.innerHTML = `<div class="bg-white p-6 rounded-2xl border border-pink-100 text-center text-xs text-gray-400">해당 사용자의 신용카드가 없습니다.</div>`;
        return;
    }
    if (visibleBills.length === 0) {
        grid.innerHTML = `<div class="bg-white p-6 rounded-2xl border border-pink-100 text-center text-xs text-gray-400">이번 달 청구 예정 금액이 있는 카드가 없습니다.<br><span class="text-[11px] text-gray-400">위 체크를 해제하면 0원 카드도 볼 수 있습니다.</span></div>`;
        return;
    }

    grid.innerHTML = visibleBills.map(bill => {
        const card = bill.card;
        const pre = bill.itemPrepaidSum + bill.amountPrepaidSum;
        const badge = bill.settlement
            ? `<span class="text-[10px] bg-green-100 text-green-800 px-1.5 py-0.5 rounded font-bold shrink-0">결제완료</span>`
            : `<span class="text-[10px] bg-pink-100 text-pink-800 px-1.5 py-0.5 rounded font-bold shrink-0">${cfMonth}월 ${card.payDay}일 결제</span>`;

        return `
            <div onclick="openCardDetailModal('${card.id}')" class="bg-white p-3.5 rounded-2xl border border-pink-200 hover:border-pink-400 hover:shadow-md cursor-pointer transition space-y-1.5">
                <div class="flex justify-between items-center gap-2">
                    <div class="flex items-center gap-1.5 min-w-0">
                        ${getOwnerBadgeHtml(card.owner)}
                        <span class="font-bold text-sm text-gray-800 truncate">${escHtml(card.name)}</span>
                    </div>
                    ${badge}
                </div>
                <div class="flex justify-between items-baseline">
                    <div class="text-[11px] text-gray-400 truncate pr-2">
                        ${bill.items.length}건${pre > 0 ? ` · 선결제 -${pre.toLocaleString()}` : ''}
                    </div>
                    <div class="flex items-center gap-1.5 shrink-0">
                        <span class="text-base font-bold ${bill.settlement ? 'text-gray-400 line-through' : 'text-pink-700'}">${bill.remainingAmount.toLocaleString()}원</span>
                        <span class="text-[11px] text-pink-500 font-bold">&gt;</span>
                    </div>
                </div>
            </div>`;
    }).join('');
}

function openCardDetailModal(cardId) {
    const card = db.assets.find(a => a.id === cardId);
    if (!card) return;
    const bill = computeCardBillForMonth(card, cfYear, cfMonth, false);
    const pre = bill.itemPrepaidSum + bill.amountPrepaidSum;

    const itemsHtml = bill.items.length === 0
        ? `<div class="text-xs text-gray-400 py-5 text-center bg-gray-50 rounded-xl">이번 달 청구 대상 내역이 없습니다.</div>`
        : `<div class="space-y-1.5 max-h-[260px] overflow-y-auto pr-1">${bill.items.map(it => `
            <div class="flex justify-between items-center p-2.5 rounded-xl border ${it.isPrepaid ? 'bg-gray-50 border-gray-200 opacity-60' : 'bg-pink-50/30 border-pink-100'} text-xs">
                <div class="min-w-0 pr-2">
                    <div class="font-bold text-gray-800 flex items-center gap-1 flex-wrap">
                        <span class="text-[10px] px-1 py-0.5 rounded bg-gray-100 text-gray-600">${escHtml(it.user)}</span>
                        <span class="truncate">${escHtml(it.memo)}</span>
                        ${it.installmentMonths > 1 ? `<span class="text-[10px] px-1.5 py-0.5 rounded bg-pink-100 text-pink-800">${it.installmentIndex}/${it.installmentMonths}회차</span>` : ''}
                    </div>
                    <div class="text-[10px] text-gray-400 mt-0.5">${it.date} · ${escHtml(it.catMain)}${it.installmentMonths > 1 ? ` (총 ${it.totalAmount.toLocaleString()}원)` : ''}</div>
                </div>
                <div class="flex items-center gap-2 shrink-0">
                    <span class="font-bold ${it.isPrepaid ? 'line-through text-gray-400' : 'text-gray-800'}">${it.billAmount.toLocaleString()}원</span>
                    ${it.isPrepaid
                        ? `<span class="text-[10px] bg-gray-200 text-gray-600 px-1.5 py-0.5 rounded font-bold">선결제됨</span>`
                        : (!bill.settlement ? `<button onclick="openItemPrepayModal('${card.id}', '${it.txId}', ${it.installmentIndex}, ${it.installmentMonths}, ${it.billAmount}, ${it.totalAmount})" class="px-2 py-1 bg-orange-400 hover:bg-orange-500 text-white rounded-lg text-[10px] font-bold">선결제</button>` : '')
                    }
                </div>
            </div>`).join('')}</div>`;

    openCustomModal(`
        <div class="flex justify-between items-start gap-2 border-b border-pink-100 pb-3">
            <div>
                <div class="flex items-center gap-1.5">
                    ${getOwnerBadgeHtml(card.owner)}
                    <h3 class="title-font text-xl text-pink-900">${escHtml(card.name)}</h3>
                </div>
                <div class="text-[11px] text-gray-500 mt-0.5">${cfYear}년 ${cfMonth}월 청구 · ${cfMonth}월 ${card.payDay}일 결제 · 출금: ${escHtml(getAssetLabel(card.linkedAccount))}</div>
            </div>
            <button onclick="closeCustomModal()" class="text-xs px-2.5 py-1 bg-gray-100 hover:bg-gray-200 rounded-lg font-bold text-gray-600">닫기</button>
        </div>

        <div class="bg-pink-50/50 p-3.5 rounded-2xl border border-pink-100 flex justify-between items-center">
            <div>
                <div class="text-[11px] text-gray-500">남은 청구 예정액</div>
                <div class="text-2xl font-bold ${bill.settlement ? 'text-gray-400 line-through' : 'text-pink-700'}">${bill.remainingAmount.toLocaleString()}원</div>
            </div>
            <div class="text-right text-[11px] text-gray-500 space-y-0.5">
                <div>총 청구원금 <b>${bill.grossAmount.toLocaleString()}원</b></div>
                ${pre > 0 ? `<div class="text-orange-600 font-bold">선결제 -${pre.toLocaleString()}원</div>` : ''}
                ${Number(card.revolving) > 0 ? `<div class="text-rose-600 font-bold">리볼빙 ${Number(card.revolving).toLocaleString()}원</div>` : ''}
                ${bill.settlement ? `<div class="text-green-700 font-bold">정산 완료 (${Number(bill.settlement.actualAmount).toLocaleString()}원)</div>` : ''}
            </div>
        </div>

        <div class="space-y-2">
            <div class="flex justify-between text-[11px] text-gray-500">
                <span class="font-bold">청구 포함 내역 (${bill.items.length}건 · 교차 사용 포함)</span>
                <span>${bill.period.start} ~ ${bill.period.end}</span>
            </div>
            ${itemsHtml}
        </div>

        <div class="flex gap-2 pt-2 border-t border-gray-100">
            ${bill.settlement
                ? `<button onclick="cancelCardEvent('${bill.settlement.id}'); closeCustomModal();" class="flex-1 py-2.5 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-xl text-xs font-bold">결제 정산 취소</button>`
                : `<button onclick="openAmountPrepayModal('${card.id}')" class="flex-1 py-2.5 btn-orange rounded-xl text-xs shadow-sm">금액 선결제</button>
                   <button onclick="openCardSettleModal('${card.id}')" class="flex-1 py-2.5 btn-pink rounded-xl text-xs shadow-sm">결제 완료 정산</button>`
            }
        </div>`);
}

function getBankAccountOptionsHtml(selectedAccId) {
    const selId = resolveToAssetId(selectedAccId);
    return sortAssetsByOwnerThenName(
        db.assets.filter(a => (a.group === 'bank' && a.type !== '선불·상품권' && a.type !== '실물자산') || (a.group === 'debt' && a.type === '마이너스통장'))
    ).map(b => `<option value="${escHtml(b.id)}" ${b.id === selId ? 'selected' : ''}>${escHtml(getAssetOptionText(b))}</option>`).join('');
}

function openItemPrepayModal(cardId, txId, instIdx, instTotal, billAmt, totalAmt) {
    const card = db.assets.find(a => a.id === cardId), tx = db.transactions.find(t => t.id === txId);
    if (!card || !tx) return;
    let remainIndices = [], remainSum = 0;
    const base = Math.floor(totalAmt / instTotal), rem = totalAmt - (base * instTotal);
    for (let i = instIdx; i <= instTotal; i++) {
        if (!isItemPrepaid(txId, i)) { remainIndices.push(i); remainSum += (i === 1 ? base + rem : base); }
    }
    const isMulti = instTotal > 1 && remainIndices.length > 1;
    openCustomModal(`
        <h3 class="title-font text-lg text-orange-800">건별 카드 선결제</h3>
        <p class="text-xs text-gray-600"><b>${escHtml(tx.memo)}</b> (${escHtml(getAssetLabel(card.id))})</p>
        <div class="space-y-3 text-xs pt-1">
            <div><label class="block font-bold text-gray-600 mb-1">선결제 출금일</label><input type="date" id="modalPrepayDate" value="${formatYMD(new Date())}" class="w-full p-2 border border-gray-300 rounded-xl font-bold"></div>
            <div><label class="block font-bold text-gray-600 mb-1">출금 계좌</label><select id="modalPrepayAcc" class="w-full p-2 border border-gray-300 rounded-xl bg-white">${getBankAccountOptionsHtml(card.linkedAccount)}</select></div>
            ${isMulti ? `<div class="bg-orange-50 p-3 rounded-xl border border-orange-200 space-y-2"><div class="font-bold text-orange-900">할부 선결제 범위 선택</div>
                <label class="flex items-center space-x-2 cursor-pointer"><input type="radio" name="itemPrepayScope" value="one" checked><span>이번 회차(${instIdx}회차)만 (<b>${billAmt.toLocaleString()}원</b>)</span></label>
                <label class="flex items-center space-x-2 cursor-pointer"><input type="radio" name="itemPrepayScope" value="all"><span>남은 ${remainIndices.length}회차 전체 완납 (<b>${remainSum.toLocaleString()}원</b>)</span></label></div>`
                : `<div class="bg-gray-50 p-3 rounded-xl font-bold text-gray-800">선결제 금액: ${billAmt.toLocaleString()}원</div>`}
        </div>
        <div class="flex justify-end gap-2 pt-2">
            <button onclick="openCardDetailModal('${cardId}')" class="px-4 py-2 bg-gray-100 text-gray-700 font-bold rounded-xl text-xs">뒤로</button>
            <button onclick="confirmItemPrepay('${cardId}', '${txId}', ${instIdx}, ${billAmt}, ${remainSum}, '${remainIndices.join(',')}')" class="px-4 py-2 btn-orange rounded-xl text-xs shadow-sm">선결제 확정</button>
        </div>`);
}

function confirmItemPrepay(cardId, txId, instIdx, oneAmt, allAmt, remainStr) {
    const card = db.assets.find(a => a.id === cardId), tx = db.transactions.find(t => t.id === txId);
    const scopeEl = document.querySelector('input[name="itemPrepayScope"]:checked'), isAll = scopeEl && scopeEl.value === 'all';
    db.cardEvents.push({
        id: 'EV_' + Date.now(), type: 'prepay_item', date: document.getElementById('modalPrepayDate').value,
        cardId: card.id, cardName: card.name, billingYM: formatYM(cfYear, cfMonth), txId, installmentIndex: instIdx,
        prepaidIndices: isAll ? remainStr.split(',').map(Number) : [instIdx],
        amount: isAll ? allAmt : oneAmt, fromAccount: document.getElementById('modalPrepayAcc').value,
        memo: `[선결제] ${getAssetLabel(card.id)} - ${tx.memo}${isAll ? ' (할부 완납)' : ''}`
    });
    closeCustomModal(); saveDb();
}

function openAmountPrepayModal(cardId) {
    const card = db.assets.find(a => a.id === cardId);
    if (!card) return;
    const bill = computeCardBillForMonth(card, cfYear, cfMonth, false);
    openCustomModal(`
        <h3 class="title-font text-lg text-orange-800">${escHtml(getAssetLabel(card.id))} 금액 선결제</h3>
        <p class="text-xs text-gray-500">${cfYear}년 ${cfMonth}월 남은 청구 예정액: <b>${bill.remainingAmount.toLocaleString()}원</b></p>
        <div class="space-y-3 text-xs pt-1">
            <div><label class="block font-bold text-gray-600 mb-1">선결제 출금일</label><input type="date" id="amtPrepayDate" value="${formatYMD(new Date())}" class="w-full p-2 border border-gray-300 rounded-xl font-bold"></div>
            <div><label class="block font-bold text-gray-600 mb-1">출금 계좌</label><select id="amtPrepayAcc" class="w-full p-2 border border-gray-300 rounded-xl bg-white">${getBankAccountOptionsHtml(card.linkedAccount)}</select></div>
            <div><label class="block font-bold text-gray-600 mb-1">선결제할 금액 (원)</label><input type="text" inputmode="numeric" id="amtPrepayVal" oninput="formatCommaInput(this)" value="${formatNumberToInput(bill.remainingAmount)}" class="w-full p-2 border border-orange-300 rounded-xl text-sm font-bold text-right"></div>
        </div>
        <div class="flex justify-end gap-2 pt-2">
            <button onclick="openCardDetailModal('${cardId}')" class="px-4 py-2 bg-gray-100 text-gray-700 font-bold rounded-xl text-xs">뒤로</button>
            <button onclick="confirmAmountPrepay('${cardId}')" class="px-4 py-2 btn-orange rounded-xl text-xs shadow-sm">선결제 반영</button>
        </div>`);
}

function confirmAmountPrepay(cardId) {
    const card = db.assets.find(a => a.id === cardId), amount = parseCommaNumber(document.getElementById('amtPrepayVal').value);
    if (amount <= 0) return alert('선결제 금액을 1원 이상 입력해 주세요.');
    db.cardEvents.push({
        id: 'EV_' + Date.now(), type: 'prepay_amount', date: document.getElementById('amtPrepayDate').value,
        cardId: card.id, cardName: card.name, billingYM: formatYM(cfYear, cfMonth), amount,
        fromAccount: document.getElementById('amtPrepayAcc').value, memo: `[선결제] ${getAssetLabel(card.id)} (${cfMonth}월 청구분)`
    });
    closeCustomModal(); saveDb();
}

function openCardSettleModal(cardId) {
    const card = db.assets.find(a => a.id === cardId);
    if (!card) return;
    const bill = computeCardBillForMonth(card, cfYear, cfMonth, false);
    openCustomModal(`
        <h3 class="title-font text-lg text-pink-900">${escHtml(getAssetLabel(card.id))} ${cfMonth}월 결제 정산</h3>
        <div class="bg-pink-50/60 p-3 rounded-xl border border-pink-100 text-xs flex justify-between items-center"><span class="text-gray-600">청구 예정 원금</span><span class="font-bold text-base text-pink-800">${bill.remainingAmount.toLocaleString()}원</span></div>
        <div class="space-y-3 text-xs">
            <div class="grid grid-cols-2 gap-2">
                <div><label class="block font-bold text-gray-600 mb-1">실제 결제일</label><input type="date" id="settleDate" value="${bill.payDate}" class="w-full p-2 border border-gray-300 rounded-xl font-bold"></div>
                <div><label class="block font-bold text-gray-600 mb-1">출금 계좌</label><select id="settleAcc" class="w-full p-2 border border-gray-300 rounded-xl bg-white">${getBankAccountOptionsHtml(card.linkedAccount)}</select></div>
            </div>
            <div><label class="block font-bold text-gray-600 mb-1">실제 통장 출금액 (원)</label>
                <input type="text" inputmode="numeric" id="settleActual" oninput="formatCommaInput(this); updateSettleDiffPreview(${bill.remainingAmount})" value="${formatNumberToInput(bill.remainingAmount, true)}" class="w-full p-2 border border-pink-300 rounded-xl text-sm font-bold text-right">
                <div id="settleDiffPreview" class="text-[11px] text-gray-500 mt-1">청구 원금과 동일합니다.</div>
            </div>
            <div class="bg-gray-50 p-3 rounded-xl border border-gray-200 space-y-2">
                <label class="flex items-center space-x-2 cursor-pointer"><input type="checkbox" id="settleUseRevolving" onchange="document.getElementById('settleRevBox').classList.toggle('hidden', !this.checked); updateSettleDiffPreview(${bill.remainingAmount})"><span class="font-bold text-gray-700">리볼빙(일부결제 이월) 적용</span></label>
                <div id="settleRevBox" class="hidden"><label class="block text-[11px] text-gray-500 mb-1">이월할 리볼빙 금액 (원)</label><input type="text" inputmode="numeric" id="settleRevAmt" oninput="formatCommaInput(this); updateSettleDiffPreview(${bill.remainingAmount})" value="0" class="w-full p-2 bg-white border border-gray-300 rounded-lg text-xs font-bold text-right"></div>
            </div>
        </div>
        <div class="flex justify-end gap-2 pt-2">
            <button onclick="openCardDetailModal('${cardId}')" class="px-4 py-2 bg-gray-100 text-gray-700 font-bold rounded-xl text-xs">뒤로</button>
            <button onclick="confirmCardSettle('${cardId}', ${bill.remainingAmount})" class="px-4 py-2 btn-pink rounded-xl text-xs shadow-sm">결제 완료 확정</button>
        </div>`);
}

function updateSettleDiffPreview(expectedAmt) {
    const actual = parseCommaNumber(document.getElementById('settleActual').value);
    const revAmt = document.getElementById('settleUseRevolving').checked ? parseCommaNumber(document.getElementById('settleRevAmt').value) : 0;
    const diff = (actual + revAmt) - expectedAmt, el = document.getElementById('settleDiffPreview');
    if (diff > 0) el.innerHTML = `<span class="text-rose-600 font-bold">+${diff.toLocaleString()}원 → 이자·수수료 지출 자동 기록</span>`;
    else if (diff < 0) el.innerHTML = `<span class="text-blue-600 font-bold">${diff.toLocaleString()}원 → 청구할인/캐시백 수입 자동 기록</span>`;
    else el.textContent = '청구 원금과 동일합니다.';
}

function confirmCardSettle(cardId, expectedAmt) {
    const card = db.assets.find(a => a.id === cardId), date = document.getElementById('settleDate').value;
    const fromAccount = document.getElementById('settleAcc').value, actualAmount = parseCommaNumber(document.getElementById('settleActual').value);
    const revolvingAmount = document.getElementById('settleUseRevolving').checked ? parseCommaNumber(document.getElementById('settleRevAmt').value) : 0;
    const diff = (actualAmount + revolvingAmount) - expectedAmt, eventId = 'EV_' + Date.now();
    let autoTxId = null;

    if (diff !== 0) {
        autoTxId = 'TX_DIFF_' + Date.now();
        const isFee = diff > 0;
        const txTypeName = getTypeNameByBehavior(isFee ? 'expense' : 'income');
        const catTree = db.categories[txTypeName] || {};
        const feeMain = catTree['보험·세금·금융'] ? '보험·세금·금융' : (catTree['고정비'] ? '고정비' : (Object.keys(catTree)[0] || '보험·세금·금융'));
        const incMain = catTree['부수입·금융'] ? '부수입·금융' : (catTree['부수입'] ? '부수입' : (Object.keys(catTree)[0] || '부수입·금융'));
        db.transactions.push({
            id: autoTxId, date, user: card.owner || db.config.defaultUser || db.users[0],
            type: txTypeName,
            catMain: isFee ? feeMain : incMain, catSub: isFee ? '이자·수수료' : '캐시백·포인트',
            method: fromAccount, targetAsset: '', memo: isFee ? `[카드수수료/이자] ${getAssetLabel(card.id)}` : `[카드청구할인] ${getAssetLabel(card.id)}`,
            amount: Math.abs(diff), installmentMonths: 1, linkedCardEventId: eventId
        });
    }
    if (revolvingAmount > 0) card.revolving = (Number(card.revolving) || 0) + revolvingAmount;
    db.cardEvents.push({
        id: eventId, type: 'settlement', date, cardId: card.id, cardName: card.name, billingYM: formatYM(cfYear, cfMonth),
        expectedAmount: expectedAmt, actualAmount, revolvingAmount, diffAmount: diff, autoTxId, fromAccount,
        memo: `[카드대금결제] ${getAssetLabel(card.id)} (${cfMonth}월분)`
    });
    closeCustomModal(); saveDb();
}

function cancelCardEvent(eventId) {
    const ev = db.cardEvents.find(e => e.id === eventId);
    if (!ev || !confirm(`'${ev.memo}' 기록을 취소하시겠습니까?`)) return;
    if (ev.type === 'settlement') {
        if (ev.revolvingAmount > 0) {
            const card = findAsset(ev.cardId || ev.cardName);
            if (card) card.revolving = Math.max(0, (Number(card.revolving) || 0) - ev.revolvingAmount);
        }
        if (ev.autoTxId) db.transactions = db.transactions.filter(t => t.id !== ev.autoTxId);
    }
    db.cardEvents = db.cardEvents.filter(e => e.id !== eventId);
    saveDb();
}

function changeCfMonth(delta) {
    const next = addMonthToYM(cfYear, cfMonth, delta);
    cfYear = next.y; cfMonth = next.m; cfSelectedDate = `${cfYear}-${String(cfMonth).padStart(2, '0')}-01`;
    renderTab2();
}
function goCfToday() {
    const now = new Date(); cfYear = now.getFullYear(); cfMonth = now.getMonth() + 1; cfSelectedDate = formatYMD(now); renderTab2();
}
function onCfAccountChange(val) { cfAccountFilter = val; renderTab2(); }
function switchCfViewMode(mode) {
    cfViewMode = mode;
    document.getElementById('cfCalendarContainer').classList.toggle('hidden', mode !== 'calendar');
    document.getElementById('cfListContainer').classList.toggle('hidden', mode !== 'list');
    document.getElementById('cfViewModeCal').className = mode === 'calendar' ? "px-2 sm:px-3 py-1 sm:py-1.5 text-[11px] sm:text-xs font-bold rounded-lg bg-white text-gray-800 shadow-sm whitespace-nowrap" : "px-2 sm:px-3 py-1 sm:py-1.5 text-[11px] sm:text-xs font-bold rounded-lg text-gray-500 whitespace-nowrap";
    document.getElementById('cfViewModeList').className = mode === 'list' ? "px-2 sm:px-3 py-1 sm:py-1.5 text-[11px] sm:text-xs font-bold rounded-lg bg-white text-gray-800 shadow-sm whitespace-nowrap" : "px-2 sm:px-3 py-1 sm:py-1.5 text-[11px] sm:text-xs font-bold rounded-lg text-gray-500 whitespace-nowrap";
}

function renderCfCalendarView(entries) {
    const startDow = Number(db.config.startDayOfWeek) || 0;
    const daysSun = [
        { label: '일', cls: 'text-rose-500' }, { label: '월', cls: '' }, { label: '화', cls: '' },
        { label: '수', cls: '' }, { label: '목', cls: '' }, { label: '금', cls: '' }, { label: '토', cls: 'text-blue-500' }
    ];
    document.getElementById('cfCalendarWeekdays').innerHTML = (startDow === 1 ? [...daysSun.slice(1), daysSun[0]] : daysSun).map(d => `<div class="${d.cls}">${d.label}</div>`).join('');

    const lastDay = new Date(cfYear, cfMonth, 0).getDate();
    const mStart = `${cfYear}-${String(cfMonth).padStart(2, '0')}-01`;
    const mEnd = `${cfYear}-${String(cfMonth).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
    const pendingDues = getSpecificPendingDueListForRange(mStart, mEnd);
    renderSpecificDueBanner('tab2SpecificDueBanner', pendingDues, cfYear, cfMonth);
    const dueByDate = {};
    pendingDues.forEach(it => {
        if (!dueByDate[it.date]) dueByDate[it.date] = [];
        dueByDate[it.date].push(it);
    });

    const dayMap = {};
    entries.forEach(e => {
        if (!dayMap[e.date]) dayMap[e.date] = { in: 0, out: 0, sched: 0 };
        if (e.kind === 'in') dayMap[e.date].in += e.amount;
        else if (e.kind === 'out') dayMap[e.date].out += e.amount;
        else dayMap[e.date].sched += e.amount;
    });

    const grid = document.getElementById('cfCalendarGrid'); grid.innerHTML = '';
    const firstDate = new Date(cfYear, cfMonth - 1, 1);
    for (let i = 0; i < (firstDate.getDay() - startDow + 7) % 7; i++) grid.appendChild(document.createElement('div'));
    const todayStr = formatYMD(new Date());

    for (let d = 1; d <= lastDay; d++) {
        const dStr = `${cfYear}-${String(cfMonth).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
        const dow = new Date(cfYear, cfMonth - 1, d).getDay(), info = dayMap[dStr], { hols, annivs } = getDaySpecialInfo(dStr), dues = dueByDate[dStr] || [];
        const isHol = hols.length > 0, isSel = (dStr === cfSelectedDate), isToday = (dStr === todayStr);
        const cell = document.createElement('div');
        cell.onclick = () => { cfSelectedDate = dStr; renderCfCalendarView(entries); };
        cell.className = `p-1.5 rounded-xl border min-h-[86px] flex flex-col justify-between cursor-pointer transition ${
            isSel ? 'bg-pink-100/70 border-pink-400 ring-2 ring-pink-200' : 'bg-white border-gray-100 hover:border-pink-300 hover:bg-pink-50/30'
        }`;
        const dayColor = (dow === 0 || isHol) ? 'text-rose-500' : (dow === 6 ? 'text-blue-500' : 'text-gray-700');
        cell.innerHTML = `
            <div>
                <div class="flex justify-between items-center gap-1">
                    <span class="text-[11px] font-bold ${dayColor} shrink-0">${d}</span>
                    ${isToday ? '<span class="text-[9px] bg-pink-400 text-white px-1 rounded font-bold shrink-0">오늘</span>' : ''}
                    ${!isToday && isHol ? `<span class="text-[9px] text-rose-500 font-medium truncate">${escHtml(hols[0])}</span>` : ''}
                </div>
                ${isToday && isHol ? `<div class="text-[9px] text-rose-500 font-medium truncate leading-tight">${escHtml(hols[0])}</div>` : ''}
                ${annivs.length > 0 ? `<div class="mt-0.5 text-[9px] bg-pink-50 text-pink-700 px-1 rounded font-bold truncate">${escHtml(annivs.map(a => a.name).join(', '))}</div>` : ''}
                ${dues.length > 0 ? `<div class="mt-0.5 text-[9px] bg-orange-50 text-orange-700 px-1 rounded font-bold truncate">납부: ${escHtml(dues.map(x => x.name).join(', '))}</div>` : ''}
            </div>
            <div class="space-y-0.5 text-right leading-tight mt-1">
                ${info && info.in > 0 ? `<div class="text-[10px] text-blue-600 font-bold truncate">+${info.in.toLocaleString()}</div>` : ''}
                ${info && info.out > 0 ? `<div class="text-[10px] text-rose-500 font-bold truncate">-${info.out.toLocaleString()}</div>` : ''}
                ${info && info.sched > 0 ? `<div class="text-[10px] text-orange-500 font-bold truncate">예정 -${info.sched.toLocaleString()}</div>` : ''}
            </div>`;
        grid.appendChild(cell);
    }
    renderCfSelectedDayPanel(entries, dueByDate[cfSelectedDate] || []);
}

function renderCfSelectedDayPanel(entries, dayDues = []) {
    document.getElementById('cfSelectedDayTitle').textContent = `${cfSelectedDate} 결제·출금 상세`;
    document.getElementById('cfSelectedDayBadges').innerHTML = renderSpecialBadgesHtml(cfSelectedDate);
    const dayEntries = entries.filter(e => e.date === cfSelectedDate);
    document.getElementById('cfSelectedDayCount').textContent = dayDues.length > 0
        ? `입출금 ${dayEntries.length}건 · 납부예정 ${dayDues.length}건`
        : `총 ${dayEntries.length}건`;

    const listEl = document.getElementById('cfSelectedDayList');
    if (dayEntries.length === 0 && dayDues.length === 0) {
        listEl.innerHTML = `<div class="text-xs text-gray-400 py-3 text-center bg-white rounded-xl border border-pink-100">이 날짜에 예정되거나 발생한 입출금이 없습니다.</div>`;
        return;
    }

    const dueHtml = renderPendingDueCardsHtml(dayDues, cfYear, cfMonth);
    const entryHtml = dayEntries.map(e => {
        const badge = e.kind === 'in' ? `<span class="px-1.5 py-0.5 rounded bg-blue-50 text-blue-700 font-bold text-[10px]">입금</span>` : (e.kind === 'out' ? `<span class="px-1.5 py-0.5 rounded bg-rose-50 text-rose-700 font-bold text-[10px]">출금</span>` : `<span class="px-1.5 py-0.5 rounded bg-orange-50 text-orange-700 font-bold text-[10px]">결제 예정</span>`);
        const amtColor = e.kind === 'in' ? 'text-blue-600' : (e.kind === 'out' ? 'text-rose-500' : 'text-orange-500');
        return `
            <div class="bg-white p-3 rounded-xl border border-pink-100 flex flex-wrap justify-between items-center gap-2 text-xs">
                <div class="space-y-0.5">
                    <div class="flex items-center gap-1.5 flex-wrap">${badge}<span class="font-bold text-gray-800">${escHtml(e.account)}</span><span class="text-gray-700">${escHtml(e.title)}</span></div>
                    <div class="text-[11px] text-gray-400">${escHtml(e.sub)}</div>
                </div>
                <div class="flex items-center gap-2 ml-auto">
                    <span class="font-bold text-sm ${amtColor}">${e.kind === 'in' ? '+' : '-'}${e.amount.toLocaleString()}원</span>
                    ${e.sourceType === 'cardEvent' ? `<button onclick="cancelCardEvent('${e.eventId}')" class="px-2 py-1 bg-red-50 hover:bg-red-100 text-red-600 rounded-lg font-bold text-[11px]">취소</button>` : ''}
                </div>
            </div>`;
    }).join('');
    listEl.innerHTML = dueHtml + entryHtml;
}

function renderCfListView(passedEntries) {
    const entries = passedEntries || getCashflowEntriesForMonth(cfYear, cfMonth);
    const statusFilter = document.getElementById('cfListStatusFilter').value;
    const keyword = document.getElementById('cfListSearchInput').value.trim().toLowerCase();
    let filtered = statusFilter === '전체' ? entries : entries.filter(e => e.kind === statusFilter);
    if (keyword) filtered = filtered.filter(e => [e.account, e.title, e.sub].some(v => (v || '').toLowerCase().includes(keyword)));

    const tbody = document.getElementById('cfListTableBody');
    if (filtered.length === 0) { tbody.innerHTML = `<tr><td colspan="6" class="py-10 text-center text-gray-400">조건에 맞는 입출금 내역이 없습니다.</td></tr>`; return; }
    tbody.innerHTML = filtered.map(e => {
        const badge = e.kind === 'in' ? `<span class="px-1.5 py-0.5 rounded bg-blue-50 text-blue-700 font-bold text-[10px]">입금</span>` : (e.kind === 'out' ? `<span class="px-1.5 py-0.5 rounded bg-rose-50 text-rose-700 font-bold text-[10px]">출금</span>` : `<span class="px-1.5 py-0.5 rounded bg-orange-50 text-orange-700 font-bold text-[10px]">예정</span>`);
        const amtColor = e.kind === 'in' ? 'text-blue-600' : (e.kind === 'out' ? 'text-rose-500' : 'text-orange-500');
        return `
            <tr class="hover:bg-pink-50/30">
                <td class="py-2.5 px-3 text-gray-500 whitespace-nowrap">${e.date}</td>
                <td class="py-2.5 px-3 whitespace-nowrap">${badge}</td>
                <td class="py-2.5 px-3 font-bold text-gray-700 whitespace-nowrap">${escHtml(e.account)}</td>
                <td class="py-2.5 px-3 text-gray-800">${escHtml(e.title)} <span class="text-[10px] text-gray-400 ml-1">${escHtml(e.sub)}</span></td>
                <td class="py-2.5 px-3 text-right font-bold whitespace-nowrap ${amtColor}">${e.kind === 'in' ? '+' : '-'}${e.amount.toLocaleString()}원</td>
                <td class="py-2.5 px-3 text-center whitespace-nowrap">${e.sourceType === 'cardEvent' ? `<button onclick="cancelCardEvent('${e.eventId}')" class="px-2 py-0.5 bg-red-50 hover:bg-red-100 rounded text-red-600 font-bold">취소</button>` : '<span class="text-gray-300">-</span>'}</td>
            </tr>`;
    }).join('');
}

function openCustomModal(html) { document.getElementById('customModalBody').innerHTML = html; document.getElementById('customModal').classList.remove('hidden'); }
function closeCustomModal() { document.getElementById('customModal').classList.add('hidden'); }

// =========================================================
// [6. 설정] 로직
// =========================================================
function switchSubTab(subId) {
    document.querySelectorAll('.sub-tab-content').forEach(el => el.classList.add('hidden'));
    document.getElementById(subId).classList.remove('hidden');
    document.querySelectorAll('.sub-tab-btn').forEach(btn => btn.className = "sub-tab-btn py-2 sm:py-2.5 px-2 rounded-xl text-xs font-bold text-gray-600 hover:bg-gray-100 transition whitespace-nowrap");
    document.getElementById('btn-' + subId).className = "sub-tab-btn py-2 sm:py-2.5 px-2 rounded-xl text-xs font-bold bg-amber-100 text-amber-900 border border-amber-300 transition whitespace-nowrap";
}

function renderAllSettings() {
    applyTheme(db.config.theme);
    document.getElementById('cfgAppTitle').value = db.config.appTitle;
    document.getElementById('cfgStartDayOfWeek').value = db.config.startDayOfWeek;
    document.getElementById('cfgStartDayOfMonth').value = db.config.startDayOfMonth;
    document.getElementById('cfgMonthlyBudget').value = formatNumberToInput(db.config.monthlyBudget, true);
    document.getElementById('cfgSavingsGoal').value = formatNumberToInput(db.config.savingsGoal, true);

    const fixedExpected = (typeof getMonthlyFixedExpenseHint === 'function')
        ? getMonthlyFixedExpenseHint()
        : (db.autoTransfers || []).filter(a => a.active !== false && a.cycleType !== 'specific' && getTypeBehavior(a.type) === 'expense').reduce((s, a) => s + (Number(a.amount) || 0), 0);
    const hintEl = document.getElementById('cfgFixedRefHint');
    if (hintEl) hintEl.textContent = `참고: 등록된 매월 예상 고정비 합계 ${fixedExpected.toLocaleString()}원`;

    const defUserSel = document.getElementById('cfgDefaultUser');
    defUserSel.innerHTML = db.users.map(u => `<option value="${escHtml(u)}">${escHtml(u)}</option>`).join('');
    defUserSel.value = db.users.includes(db.config.defaultUser) ? db.config.defaultUser : db.users[0];

    const defTypeSel = document.getElementById('cfgDefaultType');
    defTypeSel.innerHTML = db.txTypes.map(t => `<option value="${escHtml(t.name)}">${escHtml(t.name)}</option>`).join('');
    defTypeSel.value = db.txTypes.some(t => t.name === db.config.defaultType) ? db.config.defaultType : (db.txTypes[0]?.name || '');
    updateDefaultCatDropdown();
    if (db.config.defaultCatMain) document.getElementById('cfgDefaultCatMain').value = db.config.defaultCatMain;

    renderUsers(); renderCategories(); renderAssets(); renderAnniversaries();
}

function updateDefaultCatDropdown() {
    const mains = Object.keys(db.categories[document.getElementById('cfgDefaultType').value] || {});
    document.getElementById('cfgDefaultCatMain').innerHTML = mains.map(m => `<option value="${escHtml(m)}">${escHtml(m)}</option>`).join('');
}

function saveBasicSettings() {
    db.config.theme = document.getElementById('cfgTheme').value || 'pastel';
    db.config.appTitle = document.getElementById('cfgAppTitle').value.trim() || '나만의 자산노트';
    db.config.startDayOfWeek = Number(document.getElementById('cfgStartDayOfWeek').value);
    db.config.startDayOfMonth = Number(document.getElementById('cfgStartDayOfMonth').value);
    db.config.monthlyBudget = parseCommaNumber(document.getElementById('cfgMonthlyBudget').value);
    db.config.savingsGoal = parseCommaNumber(document.getElementById('cfgSavingsGoal').value);
    db.config.defaultUser = document.getElementById('cfgDefaultUser').value;
    db.config.defaultType = document.getElementById('cfgDefaultType').value;
    db.config.defaultCatMain = document.getElementById('cfgDefaultCatMain').value;
    saveDb();
    alert('기본 화면 설정 및 테마가 저장되었습니다.');
}

function renderUsers() {
    document.getElementById('userListTableBody').innerHTML = db.users.map((u, idx) => `
        <tr class="hover:bg-pink-50/40"><td class="py-3 px-4 font-bold text-gray-800">${escHtml(u)}</td>
        <td class="py-3 px-4 text-right space-x-1.5 whitespace-nowrap">
            <button onclick="editUser(${idx})" class="px-2.5 py-1 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg text-xs font-bold">수정</button>
            <button onclick="deleteUser(${idx})" class="px-2.5 py-1 bg-red-50 hover:bg-red-100 text-red-600 rounded-lg text-xs font-bold">삭제</button>
        </td></tr>`).join('');
}
function addUser() {
    const inp = document.getElementById('newUserName'), name = inp.value.trim();
    if (!name) return alert('사용자 이름을 입력해 주세요.');
    if (db.users.includes(name)) return alert('이미 등록된 이름입니다.');
    db.users.push(name); inp.value = ''; saveDb();
}
function editUser(idx) {
    const oldName = db.users[idx], newName = prompt(`'${oldName}' 사용자의 새 이름:`, oldName);
    if (newName && newName.trim() && newName.trim() !== oldName) {
        const trimmed = newName.trim();
        if (db.users.includes(trimmed)) return alert('이미 존재하는 이름입니다.');
        db.users[idx] = trimmed;
        if (db.config.defaultUser === oldName) db.config.defaultUser = trimmed;
        if (currentGlobalUser === oldName) currentGlobalUser = trimmed;
        db.transactions.forEach(t => { if (t.user === oldName) t.user = trimmed; });
        db.autoTransfers.forEach(a => { if (a.user === oldName) a.user = trimmed; });
        db.assets.forEach(a => { if (a.owner === oldName) a.owner = trimmed; });
        saveDb();
    }
}
function deleteUser(idx) {
    if (db.users.length <= 1) return alert('최소 1명의 사용자는 남아있어야 합니다.');
    if (confirm(`'${db.users[idx]}' 사용자를 삭제하시겠습니까?`)) { db.users.splice(idx, 1); saveDb(); }
}

function selectCatType(t) { selectedCatType = t; selectedMainCat = Object.keys(db.categories[t] || {})[0] || ''; renderCategories(); }
function selectMainCategory(m) { selectedMainCat = m; renderCategories(); }

function renderCategories() {
    if (!db.txTypes.some(t => t.name === selectedCatType)) selectedCatType = db.txTypes[0]?.name || '';
    document.getElementById('txTypeList').innerHTML = db.txTypes.map(t => {
        const isSel = t.name === selectedCatType, meta = BEHAVIOR_LABELS[t.behavior] || BEHAVIOR_LABELS.expense;
        return `<div onclick="selectCatType('${t.name.replace(/'/g, "\\'")}')" class="flex justify-between items-center p-2.5 rounded-xl border cursor-pointer transition ${isSel ? 'bg-amber-100 border-amber-400 font-bold text-amber-900' : 'bg-gray-50 border-gray-200 hover:bg-amber-50/50 text-gray-700'}">
            <div class="min-w-0 pr-1"><div class="text-xs truncate">${escHtml(t.name)}</div><span class="inline-block mt-0.5 text-[10px] px-1.5 rounded border ${meta.badge}">${meta.text}</span></div>
            <div class="space-x-1 shrink-0" onclick="event.stopPropagation()">
                <button onclick="openEditTypeModal('${t.id}')" class="px-2 py-0.5 bg-white border border-gray-300 rounded text-[11px]">수정</button>
                <button onclick="deleteTxType('${t.id}')" class="px-2 py-0.5 bg-white border border-red-200 rounded text-[11px] text-red-600">삭제</button>
            </div></div>`;
    }).join('');

    document.getElementById('currentCatTypeLabel').textContent = selectedCatType || '-';
    const mainObj = db.categories[selectedCatType] || {}, mains = Object.keys(mainObj);
    if (!mains.includes(selectedMainCat)) selectedMainCat = mains[0] || '';
    document.getElementById('mainCategoryList').innerHTML = mains.length === 0 ? `<div class="text-xs text-gray-400 py-8 text-center">등록된 대분류가 없습니다.</div>` : mains.map(m => {
        const isSel = m === selectedMainCat, escM = m.replace(/'/g, "\\'");
        return `<div onclick="selectMainCategory('${escM}')" class="flex justify-between items-center p-2.5 rounded-xl border cursor-pointer transition ${isSel ? 'bg-amber-100 border-amber-400 font-bold text-amber-900' : 'bg-gray-50 border-gray-200 hover:bg-amber-50/50 text-gray-700'}">
            <div class="flex items-center space-x-1.5 min-w-0 pr-1"><span class="text-xs truncate">${escHtml(m)}</span><span class="text-[10px] px-1.5 py-0.5 rounded-full shrink-0 ${isSel ? 'bg-amber-300 text-amber-900' : 'bg-gray-200 text-gray-600'}">${(mainObj[m] || []).length}</span></div>
            <div class="space-x-1 shrink-0" onclick="event.stopPropagation()">
                <button onclick="editMainCategory('${escM}')" class="px-2 py-0.5 bg-white border border-gray-300 rounded text-[11px]">수정</button>
                <button onclick="deleteMainCategory('${escM}')" class="px-2 py-0.5 bg-white border border-red-200 rounded text-[11px] text-red-600">삭제</button>
            </div></div>`;
    }).join('');

    document.getElementById('selectedMainCatBadge').textContent = selectedMainCat || '대분류 선택';
    const subEl = document.getElementById('subCategoryList');
    if (!selectedMainCat) { subEl.innerHTML = `<div class="text-xs text-gray-400 py-8 text-center">대분류를 먼저 선택해 주세요.</div>`; return; }
    const subs = mainObj[selectedMainCat] || [];
    subEl.innerHTML = subs.length === 0 ? `<div class="text-xs text-gray-400 py-8 text-center">등록된 소분류가 없습니다.</div>` : subs.map((s, idx) => `
        <div class="flex justify-between items-center p-2.5 rounded-xl bg-gray-50 border border-gray-200">
            <span class="text-xs font-medium text-gray-800 truncate pr-1">${escHtml(s)}</span>
            <div class="space-x-1 shrink-0"><button onclick="editSubCategory(${idx})" class="px-2 py-0.5 bg-white border border-gray-300 rounded text-[11px]">수정</button><button onclick="deleteSubCategory(${idx})" class="px-2 py-0.5 bg-white border border-red-200 rounded text-[11px] text-red-600">삭제</button></div>
        </div>`).join('');
}

function addTxType() {
    const inp = document.getElementById('newTxTypeName'), name = inp.value.trim();
    if (!name) return alert('구분 이름을 입력해 주세요.');
    if (db.txTypes.some(t => t.name === name)) return alert('이미 존재하는 이름입니다.');
    db.txTypes.push({ id: 'T_' + Date.now(), name, behavior: document.getElementById('newTxTypeBehavior').value });
    if (!db.categories[name]) db.categories[name] = {};
    selectedCatType = name; selectedMainCat = ''; inp.value = ''; saveDb();
}
function openEditTypeModal(id) {
    const item = db.txTypes.find(t => t.id === id); if (!item) return;
    document.getElementById('editTypeId').value = item.id;
    document.getElementById('editTypeNameInput').value = item.name;
    document.getElementById('editTypeBehaviorSelect').value = item.behavior;
    document.getElementById('editTypeModal').classList.remove('hidden');
}
function closeEditTypeModal() { document.getElementById('editTypeModal').classList.add('hidden'); }
function saveEditedTxType() {
    const id = document.getElementById('editTypeId').value, newName = document.getElementById('editTypeNameInput').value.trim();
    const item = db.txTypes.find(t => t.id === id); if (!item || !newName) return;
    const oldName = item.name;
    if (newName !== oldName && db.txTypes.some(t => t.name === newName)) return alert('이미 존재하는 이름입니다.');
    item.name = newName; item.behavior = document.getElementById('editTypeBehaviorSelect').value;
    if (newName !== oldName) {
        db.categories[newName] = db.categories[oldName] || {}; delete db.categories[oldName];
        if (db.config.defaultType === oldName) db.config.defaultType = newName;
        if (selectedCatType === oldName) selectedCatType = newName;
        db.transactions.forEach(t => { if (t.type === oldName) t.type = newName; });
        db.autoTransfers.forEach(a => { if (a.type === oldName) a.type = newName; });
    }
    closeEditTypeModal(); saveDb();
}
function deleteTxType(id) {
    if (db.txTypes.length <= 1) return alert('최소 1개의 구분은 남아있어야 합니다.');
    const item = db.txTypes.find(t => t.id === id);
    if (item && confirm(`'${item.name}' 구분을 삭제하시겠습니까?`)) {
        db.txTypes = db.txTypes.filter(t => t.id !== id); delete db.categories[item.name];
        if (selectedCatType === item.name) selectedCatType = db.txTypes[0].name;
        saveDb();
    }
}
function addMainCategory() {
    const inp = document.getElementById('newMainCatInput'), name = inp.value.trim();
    if (!selectedCatType || !name) return;
    if (!db.categories[selectedCatType]) db.categories[selectedCatType] = {};
    if (db.categories[selectedCatType][name]) return alert('이미 존재하는 대분류입니다.');
    db.categories[selectedCatType][name] = []; selectedMainCat = name; inp.value = ''; saveDb();
}
function editMainCategory(oldName) {
    const newName = prompt(`'${oldName}' 대분류의 새 이름:`, oldName);
    if (newName && newName.trim() && newName.trim() !== oldName) {
        const trimmed = newName.trim();
        if (db.categories[selectedCatType][trimmed]) return alert('이미 존재하는 이름입니다.');
        const updated = {};
        Object.keys(db.categories[selectedCatType]).forEach(k => { updated[k === oldName ? trimmed : k] = db.categories[selectedCatType][k]; });
        db.categories[selectedCatType] = updated;
        if (selectedMainCat === oldName) selectedMainCat = trimmed;
        if (db.config.defaultType === selectedCatType && db.config.defaultCatMain === oldName) db.config.defaultCatMain = trimmed;
        db.transactions.forEach(t => { if (t.type === selectedCatType && t.catMain === oldName) t.catMain = trimmed; });
        db.autoTransfers.forEach(a => { if (a.type === selectedCatType && a.catMain === oldName) a.catMain = trimmed; });
        saveDb();
    }
}
function deleteMainCategory(name) {
    if (confirm(`'${name}' 대분류를 삭제하시겠습니까?`)) { delete db.categories[selectedCatType][name]; saveDb(); }
}
function addSubCategory() {
    const inp = document.getElementById('newSubCatInput'), name = inp.value.trim();
    if (!selectedMainCat || !name) return;
    const subs = db.categories[selectedCatType][selectedMainCat];
    if (subs.includes(name)) return alert('이미 등록된 소분류입니다.');
    subs.push(name); inp.value = ''; saveDb();
}
function editSubCategory(idx) {
    const subs = db.categories[selectedCatType][selectedMainCat], oldName = subs[idx];
    const newName = prompt(`'${oldName}' 소분류의 새 이름:`, oldName);
    if (newName && newName.trim() && newName.trim() !== oldName) {
        const trimmed = newName.trim();
        if (subs.includes(trimmed)) return alert('이미 존재하는 이름입니다.');
        subs[idx] = trimmed;
        db.transactions.forEach(t => { if (t.type === selectedCatType && t.catMain === selectedMainCat && t.catSub === oldName) t.catSub = trimmed; });
        db.autoTransfers.forEach(a => { if (a.type === selectedCatType && a.catMain === selectedMainCat && a.catSub === oldName) a.catSub = trimmed; });
        saveDb();
    }
}
function deleteSubCategory(idx) {
    const subs = db.categories[selectedCatType][selectedMainCat];
    if (confirm(`'${subs[idx]}' 소분류를 삭제하시겠습니까?`)) { subs.splice(idx, 1); saveDb(); }
}

function selectAssetTab(tab) {
    ['bank', 'card', 'debt'].forEach(t => {
        document.getElementById('assetSection-' + t).classList.toggle('hidden', t !== tab);
        document.getElementById('assetTab-' + t).className = (t === tab)
            ? "asset-tab-btn px-2.5 sm:px-3 py-1.5 rounded-lg text-xs font-bold bg-blue-500 text-white whitespace-nowrap"
            : "asset-tab-btn px-2.5 sm:px-3 py-1.5 rounded-lg text-xs font-bold text-gray-600 whitespace-nowrap";
    });
}
function toggleCardFields() { document.getElementById('creditCardOnlyBox').classList.toggle('hidden', document.getElementById('cardType').value !== '신용카드'); }

function renderAssets() {
    const userOpts = db.users.map(u => `<option value="${escHtml(u)}">${escHtml(u)}</option>`).join('');
    ['bankOwner', 'cardOwner', 'debtOwner'].forEach(elId => {
        const el = document.getElementById(elId);
        if (!el) return;
        const prev = el.value;
        el.innerHTML = userOpts;
        el.value = db.users.includes(prev) ? prev : (db.config.defaultUser || db.users[0]);
    });

    const banks = sortAssetsByOwnerThenName(db.assets.filter(a => a.group === 'bank'));
    const cards = sortAssetsByOwnerThenName(db.assets.filter(a => a.group === 'card'));
    const debts = sortAssetsByOwnerThenName(db.assets.filter(a => a.group === 'debt'));
    const bankOpts = banks.filter(b => b.type !== '선불·상품권' && b.type !== '실물자산' && b.type !== '투자').map(b => `<option value="${escHtml(b.id)}">${escHtml(getAssetOptionText(b))}</option>`).join('') || '<option value="">통장 등록 필요</option>';
    document.getElementById('cardLinkedAccount').innerHTML = bankOpts;
    document.getElementById('debtLinkedAccount').innerHTML = bankOpts;

    // 1. 통장·투자·실물 (PC 표 + 모바일 카드)
    document.getElementById('bankListBody').innerHTML = banks.length === 0
        ? `<tr><td colspan="5" class="py-8 text-center text-gray-400">등록된 자산이 없습니다.</td></tr>`
        : banks.map(b => `
        <tr class="hover:bg-blue-50/30">
            <td class="py-3 px-4 whitespace-nowrap">${getOwnerBadgeHtml(b.owner)}</td>
            <td class="py-3 px-4 whitespace-nowrap"><span class="px-2 py-0.5 bg-blue-50 text-blue-800 rounded font-bold">${escHtml(b.type)}</span></td>
            <td class="py-3 px-4 font-bold text-gray-800 whitespace-nowrap">${escHtml(b.name)}</td>
            <td class="py-3 px-4 text-right font-bold whitespace-nowrap">${Number(b.initBalance).toLocaleString()}원</td>
            <td class="py-3 px-4 text-right space-x-1 whitespace-nowrap"><button onclick="startEditBank('${b.id}')" class="px-2.5 py-1 bg-gray-100 rounded font-bold">수정</button><button onclick="deleteAsset('${b.id}')" class="px-2.5 py-1 bg-red-50 text-red-600 rounded font-bold">삭제</button></td>
        </tr>`).join('');

    const bankCardEl = document.getElementById('bankCardList');
    if (bankCardEl) {
        bankCardEl.innerHTML = banks.length === 0
            ? `<div class="bg-white p-6 rounded-2xl border border-blue-200 text-center text-xs text-gray-400">등록된 자산이 없습니다.</div>`
            : banks.map(b => `
            <div class="bg-white p-3.5 rounded-2xl border border-blue-200 space-y-2 text-xs">
                <div class="flex justify-between items-center gap-2">
                    <div class="flex items-center gap-1.5 min-w-0 flex-wrap">
                        ${getOwnerBadgeHtml(b.owner)}
                        <span class="px-1.5 py-0.5 bg-blue-50 text-blue-800 rounded font-bold text-[10px] whitespace-nowrap">${escHtml(b.type)}</span>
                        <span class="font-bold text-sm text-gray-800 truncate">${escHtml(b.name)}</span>
                    </div>
                    <span class="font-bold text-sm text-gray-800 shrink-0">${Number(b.initBalance).toLocaleString()}원</span>
                </div>
                <div class="flex justify-end gap-1.5 pt-1.5 border-t border-gray-100">
                    <button onclick="startEditBank('${b.id}')" class="px-2.5 py-1 bg-gray-100 hover:bg-gray-200 rounded-lg font-bold text-[11px] text-gray-700">수정</button>
                    <button onclick="deleteAsset('${b.id}')" class="px-2.5 py-1 bg-red-50 hover:bg-red-100 rounded-lg font-bold text-[11px] text-red-600">삭제</button>
                </div>
            </div>`).join('');
    }

    // 2. 신용·체크카드 (PC 표 + 모바일 카드)
    document.getElementById('cardListBody').innerHTML = cards.length === 0
        ? `<tr><td colspan="8" class="py-8 text-center text-gray-400">등록된 카드가 없습니다.</td></tr>`
        : cards.map(c => {
        const perfText = (c.type === '신용카드' && c.perfBasis === 'billing') ? '이용기간 기준' : '1일~말일';
        return `
        <tr class="hover:bg-blue-50/30">
            <td class="py-3 px-4 whitespace-nowrap">${getOwnerBadgeHtml(c.owner)}</td>
            <td class="py-3 px-4 whitespace-nowrap"><span class="px-2 py-0.5 ${c.type==='신용카드'?'bg-pink-50 text-pink-800':'bg-green-50 text-green-800'} rounded font-bold">${escHtml(c.type)}</span></td>
            <td class="py-3 px-4 font-bold text-gray-800 whitespace-nowrap">${escHtml(c.name)}</td>
            <td class="py-3 px-4 text-gray-600 whitespace-nowrap">${escHtml(getAssetLabel(c.linkedAccount))}</td>
            <td class="py-3 px-4 font-bold text-blue-900 whitespace-nowrap">${c.type==='신용카드'?`매월 ${c.payDay}일`:'-'}</td>
            <td class="py-3 px-4 text-gray-700 whitespace-nowrap">${c.type==='신용카드'?`${c.startMonthType} ${c.startDay}일 ~ ${c.endMonthType} ${c.endDay===31?'말일':c.endDay+'일'}`:'사용 즉시 출금'}</td>
            <td class="py-3 px-4 text-right font-bold whitespace-nowrap">${Number(c.targetSpend||0).toLocaleString()}원 <span class="text-[10px] font-normal text-gray-400">(${perfText})</span></td>
            <td class="py-3 px-4 text-right space-x-1 whitespace-nowrap"><button onclick="startEditCard('${c.id}')" class="px-2.5 py-1 bg-gray-100 rounded font-bold">수정</button><button onclick="deleteAsset('${c.id}')" class="px-2.5 py-1 bg-red-50 text-red-600 rounded font-bold">삭제</button></td>
        </tr>`;
    }).join('');

    const cardCardEl = document.getElementById('cardCardList');
    if (cardCardEl) {
        cardCardEl.innerHTML = cards.length === 0
            ? `<div class="bg-white p-6 rounded-2xl border border-blue-200 text-center text-xs text-gray-400">등록된 카드가 없습니다.</div>`
            : cards.map(c => {
            const perfText = (c.type === '신용카드' && c.perfBasis === 'billing') ? '이용기간 기준' : '1일~말일';
            const periodTxt = c.type === '신용카드'
                ? `${c.startMonthType} ${c.startDay}일 ~ ${c.endMonthType} ${c.endDay === 31 ? '말일' : c.endDay + '일'}`
                : '사용 즉시 출금';
            return `
            <div class="bg-white p-3.5 rounded-2xl border border-blue-200 space-y-2 text-xs">
                <div class="flex justify-between items-center gap-2">
                    <div class="flex items-center gap-1.5 min-w-0 flex-wrap">
                        ${getOwnerBadgeHtml(c.owner)}
                        <span class="px-1.5 py-0.5 ${c.type==='신용카드'?'bg-pink-50 text-pink-800':'bg-green-50 text-green-800'} rounded font-bold text-[10px] whitespace-nowrap">${escHtml(c.type)}</span>
                        <span class="font-bold text-sm text-gray-800 truncate">${escHtml(c.name)}</span>
                    </div>
                    <span class="font-bold text-blue-900 text-[11px] shrink-0 whitespace-nowrap">${c.type==='신용카드'?`매월 ${c.payDay}일 결제`:'체크카드'}</span>
                </div>
                <div class="text-[11px] text-gray-500 space-y-0.5">
                    <div>출금: <b class="text-gray-700">${escHtml(getAssetLabel(c.linkedAccount))}</b> · ${periodTxt}</div>
                    <div>목표 실적: <b class="text-gray-700">${Number(c.targetSpend||0).toLocaleString()}원</b> <span class="text-gray-400">(${perfText})</span></div>
                </div>
                <div class="flex justify-end gap-1.5 pt-1.5 border-t border-gray-100">
                    <button onclick="startEditCard('${c.id}')" class="px-2.5 py-1 bg-gray-100 hover:bg-gray-200 rounded-lg font-bold text-[11px] text-gray-700">수정</button>
                    <button onclick="deleteAsset('${c.id}')" class="px-2.5 py-1 bg-red-50 hover:bg-red-100 rounded-lg font-bold text-[11px] text-red-600">삭제</button>
                </div>
            </div>`;
        }).join('');
    }

    // 3. 대출·마이너스통장 (PC 표 + 모바일 카드)
    document.getElementById('debtListBody').innerHTML = debts.length === 0
        ? `<tr><td colspan="6" class="py-8 text-center text-gray-400">등록된 부채가 없습니다.</td></tr>`
        : debts.map(d => `
        <tr class="hover:bg-blue-50/30">
            <td class="py-3 px-4 whitespace-nowrap">${getOwnerBadgeHtml(d.owner)}</td>
            <td class="py-3 px-4 whitespace-nowrap"><span class="px-2 py-0.5 bg-orange-50 text-orange-800 rounded font-bold">${escHtml(d.type)}</span></td>
            <td class="py-3 px-4 font-bold text-gray-800 whitespace-nowrap">${escHtml(d.name)}</td>
            <td class="py-3 px-4 text-gray-600 whitespace-nowrap">${escHtml(getAssetLabel(d.linkedAccount))}</td>
            <td class="py-3 px-4 text-right font-bold text-red-600 whitespace-nowrap">${Number(d.initBalance).toLocaleString()}원</td>
            <td class="py-3 px-4 text-right space-x-1 whitespace-nowrap"><button onclick="startEditDebt('${d.id}')" class="px-2.5 py-1 bg-gray-100 rounded font-bold">수정</button><button onclick="deleteAsset('${d.id}')" class="px-2.5 py-1 bg-red-50 text-red-600 rounded font-bold">삭제</button></td>
        </tr>`).join('');

    const debtCardEl = document.getElementById('debtCardList');
    if (debtCardEl) {
        debtCardEl.innerHTML = debts.length === 0
            ? `<div class="bg-white p-6 rounded-2xl border border-blue-200 text-center text-xs text-gray-400">등록된 부채가 없습니다.</div>`
            : debts.map(d => `
            <div class="bg-white p-3.5 rounded-2xl border border-blue-200 space-y-2 text-xs">
                <div class="flex justify-between items-center gap-2">
                    <div class="flex items-center gap-1.5 min-w-0 flex-wrap">
                        ${getOwnerBadgeHtml(d.owner)}
                        <span class="px-1.5 py-0.5 bg-orange-50 text-orange-800 rounded font-bold text-[10px] whitespace-nowrap">${escHtml(d.type)}</span>
                        <span class="font-bold text-sm text-gray-800 truncate">${escHtml(d.name)}</span>
                    </div>
                    <span class="font-bold text-sm text-red-600 shrink-0">${Number(d.initBalance).toLocaleString()}원</span>
                </div>
                <div class="flex justify-between items-center pt-1.5 border-t border-gray-100 gap-2">
                    <span class="text-[11px] text-gray-500 truncate">연결: <b class="text-gray-700">${escHtml(getAssetLabel(d.linkedAccount))}</b></span>
                    <div class="flex gap-1.5 shrink-0">
                        <button onclick="startEditDebt('${d.id}')" class="px-2.5 py-1 bg-gray-100 hover:bg-gray-200 rounded-lg font-bold text-[11px] text-gray-700">수정</button>
                        <button onclick="deleteAsset('${d.id}')" class="px-2.5 py-1 bg-red-50 hover:bg-red-100 rounded-lg font-bold text-[11px] text-red-600">삭제</button>
                    </div>
                </div>
            </div>`).join('');
    }
}

function saveBankAsset() {
    const editId = document.getElementById('editBankId').value, type = document.getElementById('bankType').value;
    const owner = document.getElementById('bankOwner')?.value || db.users[0];
    const name = document.getElementById('bankName').value.trim(), initBalance = parseCommaNumber(document.getElementById('bankInitBalance').value);
    if (!name) return alert('자산 이름을 입력해 주세요.');
    if (editId) {
        const item = db.assets.find(a => a.id === editId);
        if (item) Object.assign(item, { owner, type, name, initBalance });
    } else db.assets.push({ id: 'B_' + Date.now(), group: 'bank', owner, type, name, initBalance });
    resetBankForm(); saveDb();
}
function startEditBank(id) {
    const item = db.assets.find(a => a.id === id); if (!item) return;
    document.getElementById('editBankId').value = item.id;
    if (document.getElementById('bankOwner')) document.getElementById('bankOwner').value = item.owner || db.users[0];
    document.getElementById('bankType').value = item.type;
    document.getElementById('bankName').value = item.name; document.getElementById('bankInitBalance').value = formatNumberToInput(item.initBalance, true);
    document.getElementById('bankFormTitle').textContent = `[${item.owner || ''}] ${item.name} 수정 중`; document.getElementById('bankSubmitBtn').textContent = '수정 저장'; document.getElementById('bankCancelBtn').classList.remove('hidden');
}
function resetBankForm() {
    ['editBankId', 'bankName', 'bankInitBalance'].forEach(id => document.getElementById(id).value = '');
    document.getElementById('bankFormTitle').textContent = '통장 · 투자 · 실물자산 신규 등록'; document.getElementById('bankSubmitBtn').textContent = '저장하기'; document.getElementById('bankCancelBtn').classList.add('hidden');
}

function saveCardAsset() {
    const editId = document.getElementById('editCardId').value, name = document.getElementById('cardName').value.trim();
    const owner = document.getElementById('cardOwner')?.value || db.users[0];
    const perfBasis = document.getElementById('cardPerfBasis')?.value || 'calendar';
    if (!name) return alert('카드 이름을 입력해 주세요.');
    const payload = {
        id: editId || ('C_' + Date.now()), group: 'card', owner, type: document.getElementById('cardType').value, name,
        linkedAccount: document.getElementById('cardLinkedAccount').value, targetSpend: parseCommaNumber(document.getElementById('cardTargetSpend').value),
        perfBasis,
        payDay: Number(document.getElementById('cardPayDay').value) || 25, startMonthType: document.getElementById('cardStartMonthType').value,
        startDay: Number(document.getElementById('cardStartDay').value) || 1, endMonthType: document.getElementById('cardEndMonthType').value,
        endDay: Number(document.getElementById('cardEndDay').value) || 31, revolving: parseCommaNumber(document.getElementById('cardRevolving').value)
    };
    if (editId) {
        const idx = db.assets.findIndex(a => a.id === editId);
        if (idx > -1) db.assets[idx] = payload;
    } else db.assets.push(payload);
    resetCardForm(); saveDb();
}
function startEditCard(id) {
    const c = db.assets.find(a => a.id === id); if (!c) return;
    document.getElementById('editCardId').value = c.id;
    if (document.getElementById('cardOwner')) document.getElementById('cardOwner').value = c.owner || db.users[0];
    if (document.getElementById('cardPerfBasis')) document.getElementById('cardPerfBasis').value = c.perfBasis || 'calendar';
    document.getElementById('cardType').value = c.type; toggleCardFields();
    document.getElementById('cardName').value = c.name; document.getElementById('cardLinkedAccount').value = resolveToAssetId(c.linkedAccount);
    document.getElementById('cardTargetSpend').value = formatNumberToInput(c.targetSpend, true); document.getElementById('cardPayDay').value = c.payDay || 25;
    document.getElementById('cardStartMonthType').value = c.startMonthType || '전월'; document.getElementById('cardStartDay').value = c.startDay || 1;
    document.getElementById('cardEndMonthType').value = c.endMonthType || '당월'; document.getElementById('cardEndDay').value = c.endDay || 31;
    document.getElementById('cardRevolving').value = formatNumberToInput(c.revolving, true);
    document.getElementById('cardFormTitle').textContent = `[${c.owner || ''}] ${c.name} 수정 중`; document.getElementById('cardSubmitBtn').textContent = '카드 수정 저장'; document.getElementById('cardCancelBtn').classList.remove('hidden');
}
function resetCardForm() {
    ['editCardId', 'cardName', 'cardTargetSpend'].forEach(id => document.getElementById(id).value = '');
    if (document.getElementById('cardPerfBasis')) document.getElementById('cardPerfBasis').value = 'calendar';
    document.getElementById('cardRevolving').value = '0';
    document.getElementById('cardFormTitle').textContent = '신용 · 체크카드 신규 등록'; document.getElementById('cardSubmitBtn').textContent = '카드 설정 저장하기'; document.getElementById('cardCancelBtn').classList.add('hidden');
}

function saveDebtAsset() {
    const editId = document.getElementById('editDebtId').value, type = document.getElementById('debtType').value;
    const owner = document.getElementById('debtOwner')?.value || db.users[0];
    const name = document.getElementById('debtName').value.trim(), initBalance = parseCommaNumber(document.getElementById('debtInitBalance').value);
    const linkedAccount = document.getElementById('debtLinkedAccount').value;
    if (!name) return alert('부채 이름을 입력해 주세요.');
    if (editId) {
        const item = db.assets.find(a => a.id === editId);
        if (item) Object.assign(item, { owner, type, name, initBalance, linkedAccount });
    } else db.assets.push({ id: 'D_' + Date.now(), group: 'debt', owner, type, name, initBalance, linkedAccount });
    resetDebtForm(); saveDb();
}
function startEditDebt(id) {
    const d = db.assets.find(a => a.id === id); if (!d) return;
    document.getElementById('editDebtId').value = d.id;
    if (document.getElementById('debtOwner')) document.getElementById('debtOwner').value = d.owner || db.users[0];
    document.getElementById('debtType').value = d.type;
    document.getElementById('debtName').value = d.name; document.getElementById('debtInitBalance').value = formatNumberToInput(d.initBalance, true);
    document.getElementById('debtLinkedAccount').value = resolveToAssetId(d.linkedAccount);
    document.getElementById('debtFormTitle').textContent = `[${d.owner || ''}] ${d.name} 수정 중`; document.getElementById('debtSubmitBtn').textContent = '수정 저장'; document.getElementById('debtCancelBtn').classList.remove('hidden');
}
function resetDebtForm() {
    ['editDebtId', 'debtName', 'debtInitBalance'].forEach(id => document.getElementById(id).value = '');
    document.getElementById('debtFormTitle').textContent = '대출 · 마이너스통장 신규 등록'; document.getElementById('debtSubmitBtn').textContent = '부채 저장하기'; document.getElementById('debtCancelBtn').classList.add('hidden');
}
function deleteAsset(id) {
    const item = db.assets.find(a => a.id === id);
    if (item && confirm(`'[${item.owner || ''}] ${item.name}' 항목을 삭제하시겠습니까?`)) { db.assets = db.assets.filter(a => a.id !== id); saveDb(); }
}

function renderAnniversaries() {
    const tbody = document.getElementById('annivListBody');
    const cardEl = document.getElementById('annivCardList');
    if (!db.anniversaries || db.anniversaries.length === 0) {
        if (tbody) tbody.innerHTML = `<tr><td colspan="4" class="py-8 text-center text-gray-400">등록된 기념일이 없습니다.</td></tr>`;
        if (cardEl) cardEl.innerHTML = `<div class="bg-white p-6 rounded-2xl border border-pink-200 text-center text-xs text-gray-400">등록된 기념일이 없습니다.</div>`;
        return;
    }
    const sorted = [...db.anniversaries].sort((a, b) =>
        (Number(a.month) - Number(b.month)) || (Number(a.day) - Number(b.day)) || compareKorean(a.name, b.name)
    );
    if (tbody) {
        tbody.innerHTML = sorted.map(a => `
            <tr class="hover:bg-pink-50/30">
                <td class="py-3 px-4 whitespace-nowrap"><span class="px-2 py-0.5 ${a.calType==='lunar'?'bg-purple-50 text-purple-700':'bg-pink-50 text-pink-700'} rounded font-bold">${a.calType==='lunar'?'음력':'양력'}</span></td>
                <td class="py-3 px-4 font-bold text-gray-800 whitespace-nowrap">${escHtml(a.name)}</td>
                <td class="py-3 px-4 text-gray-600 whitespace-nowrap">${a.calType==='lunar'?'음력 ':'양력 '}${a.month}월 ${a.day}일</td>
                <td class="py-3 px-4 text-right space-x-1 whitespace-nowrap"><button onclick="startEditAnniv('${a.id}')" class="px-2.5 py-1 bg-gray-100 rounded font-bold">수정</button><button onclick="deleteAnniv('${a.id}')" class="px-2.5 py-1 bg-red-50 text-red-600 rounded font-bold">삭제</button></td>
            </tr>`).join('');
    }
    if (cardEl) {
        cardEl.innerHTML = sorted.map(a => `
            <div class="bg-white p-3 rounded-2xl border border-pink-200 flex justify-between items-center gap-2 text-xs">
                <div class="min-w-0 space-y-0.5">
                    <div class="flex items-center gap-1.5">
                        <span class="px-1.5 py-0.5 ${a.calType==='lunar'?'bg-purple-50 text-purple-700':'bg-pink-50 text-pink-700'} rounded font-bold text-[10px] shrink-0 whitespace-nowrap">${a.calType==='lunar'?'음력':'양력'}</span>
                        <span class="font-bold text-sm text-gray-800 truncate">${escHtml(a.name)}</span>
                    </div>
                    <div class="text-[11px] text-gray-500">${a.calType==='lunar'?'음력 ':'양력 '}${a.month}월 ${a.day}일</div>
                </div>
                <div class="flex gap-1.5 shrink-0">
                    <button onclick="startEditAnniv('${a.id}')" class="px-2.5 py-1 bg-gray-100 hover:bg-gray-200 rounded-lg font-bold text-[11px] text-gray-700 whitespace-nowrap">수정</button>
                    <button onclick="deleteAnniv('${a.id}')" class="px-2.5 py-1 bg-red-50 hover:bg-red-100 rounded-lg font-bold text-[11px] text-red-600 whitespace-nowrap">삭제</button>
                </div>
            </div>`).join('');
    }
}
function saveAnniversary() {
    const editId = document.getElementById('editAnnivId').value, name = document.getElementById('annivName').value.trim();
    const calType = document.getElementById('annivCalType').value, month = Number(document.getElementById('annivMonth').value), day = Number(document.getElementById('annivDay').value);
    if (!name) return alert('기념일 이름을 입력해 주세요.');
    if (calType === 'lunar' && day === 31) return alert('음력은 최대 30일까지 선택할 수 있습니다.');
    if (editId) { const item = db.anniversaries.find(a => a.id === editId); if (item) Object.assign(item, { name, calType, month, day }); }
    else db.anniversaries.push({ id: 'AN_' + Date.now(), name, calType, month, day });
    resetAnnivForm(); saveDb();
}
function startEditAnniv(id) {
    const a = db.anniversaries.find(x => x.id === id); if (!a) return;
    document.getElementById('editAnnivId').value = a.id; document.getElementById('annivName').value = a.name;
    document.getElementById('annivCalType').value = a.calType; document.getElementById('annivMonth').value = a.month; document.getElementById('annivDay').value = a.day;
    document.getElementById('annivFormTitle').textContent = `[${a.name}] 수정 중`; document.getElementById('annivSubmitBtn').textContent = '수정 저장'; document.getElementById('annivCancelBtn').classList.remove('hidden');
}
function resetAnnivForm() {
    document.getElementById('editAnnivId').value = ''; document.getElementById('annivName').value = '';
    document.getElementById('annivCalType').value = 'solar'; document.getElementById('annivMonth').value = '1'; document.getElementById('annivDay').value = '1';
    document.getElementById('annivFormTitle').textContent = '기념일 신규 등록'; document.getElementById('annivSubmitBtn').textContent = '기념일 저장'; document.getElementById('annivCancelBtn').classList.add('hidden');
}
function deleteAnniv(id) {
    const a = db.anniversaries.find(x => x.id === id);
    if (a && confirm(`'${a.name}' 기념일을 삭제하시겠습니까?`)) { db.anniversaries = db.anniversaries.filter(x => x.id !== id); saveDb(); }
}

// =========================================================
// 백업 (JSON) · 엑셀 다운로드 (.xlsx) · 초기화
// =========================================================
function exportBackupJson() {
    const todayStr = formatYMD(new Date());
    const a = document.createElement('a');
    a.setAttribute("href", "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(db, null, 2)));
    a.setAttribute("download", `${db.config.appTitle}_${todayStr}.json`);
    document.body.appendChild(a); a.click(); a.remove();
}

function importBackupJson(e) {
    const file = e.target.files[0]; if (!file) return;
    const reader = new FileReader();
    reader.onload = (evt) => {
        try {
            const loaded = JSON.parse(evt.target.result);
            if (loaded && loaded.config && loaded.categories) {
                db = loaded;
                migrateDbData();
                saveDb();
                alert('백업 파일이 성공적으로 복원되었습니다.');
            } else alert('올바른 가계부 백업 파일 형식이 아닙니다.');
        } catch (err) { alert('파일을 읽는 중 오류가 발생했습니다.'); }
    };
    reader.readAsText(file);
}

function toggleExcelRangeBox() {
    const mode = document.querySelector('input[name="excelPeriodType"]:checked')?.value || 'all';
    const wrap = document.getElementById('excelRangeWrap');
    if (wrap) wrap.classList.toggle('hidden', mode !== 'range');
}

function exportExcelXlsx() {
    if (typeof XLSX === 'undefined') {
        return alert('엑셀 변환 라이브러리를 불러오지 못했습니다. 인터넷 연결 상태를 확인해 주세요.');
    }

    const mode = document.querySelector('input[name="excelPeriodType"]:checked')?.value || 'all';
    let startDate = '0000-01-01', endDate = '9999-12-31';
    let periodTag = '전체';

    if (mode === 'range') {
        const sYM = document.getElementById('excelStartYM')?.value;
        const eYM = document.getElementById('excelEndYM')?.value;
        if (!sYM || !eYM) return alert('시작월과 종료월을 모두 선택해 주세요.');
        if (sYM > eYM) return alert('시작월은 종료월보다 같거나 이전이어야 합니다.');
        const [ey, em] = eYM.split('-').map(Number);
        const lastD = new Date(ey, em, 0).getDate();
        startDate = `${sYM}-01`;
        endDate = `${eYM}-${String(lastD).padStart(2, '0')}`;
        periodTag = (sYM === eYM) ? sYM : `${sYM}~${eYM}`;
    }

    const txRows = (db.transactions || [])
        .filter(t => t.date >= startDate && t.date <= endDate)
        .sort((a, b) => a.date.localeCompare(b.date))
        .map(t => {
            const b = getTypeBehavior(t.type);
            const isTr = (b === 'transfer' || b === 'voucher');
            return {
                '날짜': t.date,
                '사용자': t.user,
                '구분': t.type,
                '대분류': t.catMain || '',
                '소분류': t.catSub || '',
                '내용': t.memo || '',
                '결제수단/출금계좌': getAssetLabel(t.method),
                '입금자산': isTr ? getAssetLabel(t.targetAsset) : '',
                '금액': Number(t.amount) || 0,
                '할부개월': Number(t.installmentMonths) > 1 ? `${t.installmentMonths}개월` : '일시불',
                '정기지출': t.fromAutoTransfer ? 'Y' : ''
            };
        });

    const ymSet = new Set();
    if (mode === 'range') {
        let [cy, cm] = document.getElementById('excelStartYM').value.split('-').map(Number);
        const [ey, em] = document.getElementById('excelEndYM').value.split('-').map(Number);
        while (cy < ey || (cy === ey && cm <= em)) {
            ymSet.add(formatYM(cy, cm));
            const next = addMonthToYM(cy, cm, 1);
            cy = next.y; cm = next.m;
        }
    } else {
        (db.transactions || []).forEach(t => { if (t.date) ymSet.add(t.date.slice(0, 7)); });
        (db.cardEvents || []).forEach(e => { if (e.date) ymSet.add(e.date.slice(0, 7)); });
    }

    let cfAll = [];
    Array.from(ymSet).sort().forEach(ym => {
        const [y, m] = ym.split('-').map(Number);
        cfAll = cfAll.concat(getCashflowEntriesForMonth(y, m, true));
    });

    const kindMap = { in: '입금', out: '출금(확정)', scheduled: '결제 예정' };
    const cfRows = cfAll
        .filter(e => e.date >= startDate && e.date <= endDate)
        .sort((a, b) => a.date.localeCompare(b.date))
        .map(e => ({
            '날짜': e.date,
            '흐름': kindMap[e.kind] || e.kind,
            '통장/계좌': e.account,
            '항목/내용': e.title,
            '세부구분': e.sub,
            '금액': e.kind === 'in' ? e.amount : -e.amount
        }));

    const wb = XLSX.utils.book_new();
    const ws1 = XLSX.utils.json_to_sheet(txRows.length ? txRows : [{ '안내': '해당 기간에 등록된 가계부 내역이 없습니다.' }]);
    const ws2 = XLSX.utils.json_to_sheet(cfRows.length ? cfRows : [{ '안내': '해당 기간에 등록된 결제·출금 내역이 없습니다.' }]);
    XLSX.utils.book_append_sheet(wb, ws1, '가계부_수입지출');
    XLSX.utils.book_append_sheet(wb, ws2, '결제_출금');

    const todayStr = formatYMD(new Date());
    XLSX.writeFile(wb, `${db.config.appTitle}_내역_${periodTag}_${todayStr}.xlsx`);
}

function resetTransactionsOnly() {
    if (confirm('설정과 정기 항목 틀은 유지하고 입력된 가계부 내역과 정산 기록만 모두 초기화하시겠습니까?')) {
        db.transactions = []; db.cardEvents = []; saveDb(); alert('가계부 내역이 모두 초기화되었습니다.');
    }
}
function resetAllFactory() {
    if (confirm('경고: 모든 설정과 내역을 맨 처음 상태로 초기화(프로그램 초기화)하시겠습니까?')) {
        db = getDefaultDb(); saveDb(); alert('모든 설정과 내역이 초기 상태로 되돌아갔습니다.');
    }
}

window.addEventListener('DOMContentLoaded', () => {
    initDropdowns();
    renderAll();
});