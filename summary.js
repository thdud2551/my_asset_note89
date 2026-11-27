// =========================================================
// [4. 지출 분석] 전용 모듈 (멀티 사용자 · 고정비 포함 이체 반영 · 빈 달 제외 추이)
// =========================================================
const DONUT_PALETTE = [
    '#FF8787', '#FFD43B', '#74C0FC', '#63E6BE', '#B197FC',
    '#FFA94D', '#F783AC', '#A9E34B', '#66D9E8', '#CED4DA'
];

let sum3Year = todayObj.getFullYear();
let sum3Month = todayObj.getMonth() + 1;
let sum3Mode = 'month';      // 'month' | 'year'
let sum3Basis = 'consume';   // 'consume' | 'cashflow'
let sum3Nature = 'all';      // 'all' | 'fixed' | 'variable'
let sum3ExpandedCats = {};
let sum3TrendMain = '';
let sum3TrendSub = '전체';

function formatGraphManWon(amt) {
    if (!amt || amt <= 0) return '0';
    const val = Math.round(amt / 1000) / 10;
    return `${val.toFixed(1)}만`;
}

// 지출형 거래 또는 '지출 분석(고정비)에 포함' 체크된 정기 이체·저축 거래인지 판별
function isTxIncludedInSummaryExpense(t) {
    if (!t) return false;
    if (getTypeBehavior(t.type) === 'expense') return true;
    if (typeof t.includeInExpense === 'boolean') return t.includeInExpense;
    if (t.autoTransferId && Array.isArray(db.autoTransfers)) {
        const at = db.autoTransfers.find(a => a.id === t.autoTransferId);
        if (at && at.includeInExpense) return true;
    }
    return false;
}

function getSum3FirstRecordYM(nowYM) {
    let minYM = null;
    (db.transactions || []).forEach(t => {
        if (t.date && t.date.length >= 7) {
            const ym = t.date.slice(0, 7);
            if (!minYM || ym < minYM) minYM = ym;
        }
    });
    (db.cardEvents || []).forEach(ev => {
        if (ev.date && ev.date.length >= 7) {
            const ym = ev.date.slice(0, 7);
            if (!minYM || ym < minYM) minYM = ym;
        }
    });
    if (!minYM || minYM > nowYM) return nowYM;
    return minYM;
}

function changeSum3Period(delta) {
    if (sum3Mode === 'year') sum3Year += delta;
    else {
        const next = addMonthToYM(sum3Year, sum3Month, delta);
        sum3Year = next.y; sum3Month = next.m;
    }
    renderTab3();
}

function goSum3Today() {
    const now = new Date();
    sum3Year = now.getFullYear(); sum3Month = now.getMonth() + 1;
    renderTab3();
}

function setSum3Mode(mode) {
    sum3Mode = mode;
    document.getElementById('sum3ModeMonth').className = mode === 'month' ? "px-2.5 sm:px-3 py-1 text-xs font-bold rounded-lg bg-white text-gray-800 shadow-sm whitespace-nowrap" : "px-2.5 sm:px-3 py-1 text-xs font-bold rounded-lg text-gray-500 whitespace-nowrap";
    document.getElementById('sum3ModeYear').className = mode === 'year' ? "px-2.5 sm:px-3 py-1 text-xs font-bold rounded-lg bg-white text-gray-800 shadow-sm whitespace-nowrap" : "px-2.5 sm:px-3 py-1 text-xs font-bold rounded-lg text-gray-500 whitespace-nowrap";
    document.getElementById('sum3TodayBtn').textContent = mode === 'year' ? '올해' : '이번 달';
    renderTab3();
}

function setSum3Basis(basis) {
    sum3Basis = basis;
    document.getElementById('sum3BasisConsume').className = basis === 'consume' ? "px-2.5 sm:px-3 py-1 text-xs font-bold rounded-lg bg-white text-gray-800 shadow-sm whitespace-nowrap" : "px-2.5 sm:px-3 py-1 text-xs font-bold rounded-lg text-gray-500 whitespace-nowrap";
    document.getElementById('sum3BasisCashflow').className = basis === 'cashflow' ? "px-2.5 sm:px-3 py-1 text-xs font-bold rounded-lg bg-white text-gray-800 shadow-sm whitespace-nowrap" : "px-2.5 sm:px-3 py-1 text-xs font-bold rounded-lg text-gray-500 whitespace-nowrap";
    renderTab3();
}

function setSum3Nature(nature) {
    sum3Nature = nature;
    ['all', 'fixed', 'variable'].forEach(n => {
        const el = document.getElementById('sum3Nature_' + n);
        if (!el) return;
        el.className = (n === nature)
            ? "px-2.5 sm:px-3 py-1 text-xs font-bold rounded-lg bg-white text-gray-800 shadow-sm whitespace-nowrap"
            : "px-2.5 sm:px-3 py-1 text-xs font-bold rounded-lg text-gray-500 whitespace-nowrap";
    });
    renderTab3();
}

function filterItemsByNature(items, nature) {
    if (nature === 'fixed') return items.filter(x => x.isFixed);
    if (nature === 'variable') return items.filter(x => !x.isFixed);
    return items;
}

function getSpendItemsForMonth(year, month, basis) {
    const monthStart = `${year}-${String(month).padStart(2, '0')}-01`;
    const monthEnd = `${year}-${String(month).padStart(2, '0')}-${String(new Date(year, month, 0).getDate()).padStart(2, '0')}`;
    const creditCardIds = new Set(db.assets.filter(a => a.group === 'card' && a.type === '신용카드').map(a => a.id));
    const items = [];

    if (basis === 'consume') {
        db.transactions.forEach(t => {
            if (!matchesGlobalUser(t.user)) return;
            if (!isTxIncludedInSummaryExpense(t)) return;
            if (t.date < monthStart || t.date > monthEnd) return;
            const mId = resolveToAssetId(t.method);
            items.push({
                amount: Number(t.amount) || 0,
                catMain: t.catMain || '미분류',
                catSub: t.catSub || '',
                methodId: mId,
                method: getAssetLabel(mId),
                isFixed: !!t.fromAutoTransfer || (getTypeBehavior(t.type) !== 'expense')
            });
        });
    } else {
        db.transactions.forEach(t => {
            if (!matchesGlobalUser(t.user)) return;
            if (!isTxIncludedInSummaryExpense(t)) return;
            const mId = resolveToAssetId(t.method);
            if (creditCardIds.has(mId)) return;
            if (t.date < monthStart || t.date > monthEnd) return;
            items.push({
                amount: Number(t.amount) || 0,
                catMain: t.catMain || '미분류',
                catSub: t.catSub || '',
                methodId: mId,
                method: getAssetLabel(mId),
                isFixed: !!t.fromAutoTransfer || (getTypeBehavior(t.type) !== 'expense')
            });
        });

        db.assets.filter(a => a.group === 'card' && a.type === '신용카드').forEach(card => {
            const bill = computeCardBillForMonth(card, year, month, true);
            bill.items.forEach(bi => {
                const orig = db.transactions.find(t => t.id === bi.txId);
                items.push({
                    amount: Number(bi.billAmount) || 0,
                    catMain: bi.catMain || '미분류',
                    catSub: bi.catSub || '',
                    methodId: card.id,
                    method: getAssetLabel(card.id),
                    isFixed: !!(orig && orig.fromAutoTransfer)
                });
            });
        });
    }
    return items;
}

function getSpendItemsForPeriod(year, month, mode, basis) {
    if (mode === 'month') return getSpendItemsForMonth(year, month, basis);
    let all = [];
    for (let m = 1; m <= 12; m++) all = all.concat(getSpendItemsForMonth(year, m, basis));
    return all;
}

function getEffectiveBudgetForMonth(year, month) {
    const ym = formatYM(year, month);
    const override = db.monthlyBudgets && db.monthlyBudgets[ym];
    if (override && typeof override.amount === 'number') {
        return { amount: override.amount, memo: override.memo || '', isCustom: true };
    }
    return { amount: Number(db.config.monthlyBudget) || 0, memo: '', isCustom: false };
}

function renderTab3() {
    const isYear = (sum3Mode === 'year');
    const natureLabelMap = { all: '전체', fixed: '고정비(정기)', variable: '변동비' };
    const natureLabel = natureLabelMap[sum3Nature] || '전체';

    document.getElementById('sum3PeriodTitle').textContent = isYear
        ? `${sum3Year}년 연간 지출 분석`
        : `${sum3Year}년 ${sum3Month}월 지출 분석`;
    document.getElementById('sum3TotalLabel').textContent = isYear
        ? `${sum3Year}년 ${natureLabel} 지출`
        : `이번 달 ${natureLabel} 지출`;
    document.getElementById('sum3BasisBadge').textContent = `${sum3Basis === 'consume' ? '소비' : '결제·출금'} · ${natureLabel}`;
    document.getElementById('sum3EditBudgetBtn').classList.toggle('hidden', isYear);

    const allItems = getSpendItemsForPeriod(sum3Year, sum3Month, sum3Mode, sum3Basis);
    const allTotal = allItems.reduce((s, x) => s + x.amount, 0);
    const items = filterItemsByNature(allItems, sum3Nature);
    const totalSpend = items.reduce((s, x) => s + x.amount, 0);

    let prevTotal = 0;
    if (isYear) {
        prevTotal = filterItemsByNature(getSpendItemsForPeriod(sum3Year - 1, 1, 'year', sum3Basis), sum3Nature).reduce((s, x) => s + x.amount, 0);
    } else {
        const prevYM = addMonthToYM(sum3Year, sum3Month, -1);
        prevTotal = filterItemsByNature(getSpendItemsForMonth(prevYM.y, prevYM.m, sum3Basis), sum3Nature).reduce((s, x) => s + x.amount, 0);
    }

    document.getElementById('sum3TotalSpend').textContent = `${totalSpend.toLocaleString()}원`;
    const diff = totalSpend - prevTotal;
    const prevLabel = isYear ? '전년 대비' : '전월 대비';
    const diffEl = document.getElementById('sum3DiffBadge');
    if (prevTotal === 0 && totalSpend === 0) diffEl.innerHTML = `<span class="text-gray-400">${prevLabel} 지출 내역 없음</span>`;
    else if (diff > 0) diffEl.innerHTML = `<span class="text-rose-500 font-bold">${prevLabel} +${diff.toLocaleString()}원 증가</span>`;
    else if (diff < 0) diffEl.innerHTML = `<span class="text-blue-600 font-bold">${prevLabel} ${diff.toLocaleString()}원 절약</span>`;
    else diffEl.innerHTML = `<span class="text-gray-500">${prevLabel} 동일</span>`;

    let budgetAmt = 0, budgetMemo = '';
    if (isYear) {
        for (let m = 1; m <= 12; m++) budgetAmt += getEffectiveBudgetForMonth(sum3Year, m).amount;
    } else {
        const bInfo = getEffectiveBudgetForMonth(sum3Year, sum3Month);
        budgetAmt = bInfo.amount;
        budgetMemo = bInfo.isCustom ? (bInfo.memo || '월별 개별 목표 적용') : '';
    }

    const pct = budgetAmt > 0 ? Math.round((totalSpend / budgetAmt) * 100) : 0;
    const remain = budgetAmt - totalSpend;
    document.getElementById('sum3BudgetPct').textContent = `${pct}%`;
    document.getElementById('sum3BudgetText').textContent = `목표 ${budgetAmt.toLocaleString()}원`;
    const barEl = document.getElementById('sum3BudgetBar');
    barEl.style.width = `${Math.min(100, pct)}%`;
    barEl.className = `h-full rounded-full transition-all ${pct > 100 ? 'bg-rose-500' : (pct >= 80 ? 'bg-orange-400' : 'bg-amber-400')}`;
    const remEl = document.getElementById('sum3BudgetRemain');
    remEl.textContent = remain >= 0 ? `남은 예산 ${remain.toLocaleString()}원` : `예산 초과 +${Math.abs(remain).toLocaleString()}원`;
    remEl.className = `font-bold ${remain >= 0 ? 'text-gray-600' : 'text-rose-600'}`;
    document.getElementById('sum3BudgetMemo').textContent = budgetMemo;

    const fixedAmt = allItems.filter(x => x.isFixed).reduce((s, x) => s + x.amount, 0);
    const varAmt = allTotal - fixedAmt;
    const fixedPct = allTotal > 0 ? Math.round((fixedAmt / allTotal) * 100) : 0;
    const varPct = allTotal > 0 ? (100 - fixedPct) : 0;
    document.getElementById('sum3FixedAmt').textContent = `${fixedAmt.toLocaleString()}원`;
    document.getElementById('sum3FixedPct').textContent = `${fixedPct}%`;
    document.getElementById('sum3VarAmt').textContent = `${varAmt.toLocaleString()}원`;
    document.getElementById('sum3VarPct').textContent = `${varPct}%`;
    document.getElementById('sum3FixedBar').style.width = `${fixedPct}%`;

    renderSum3CategoryChart(items, totalSpend);
    syncSum3CatTrendDropdowns(items);
    renderSum3CatTrendChart();
    renderSum3MethodBars(items, totalSpend);
    renderSum3CardPerf();
    renderSum3TrendChart();
}

function renderSum3CategoryChart(items, totalSpend) {
    document.getElementById('sum3DonutCenter').textContent = `${totalSpend.toLocaleString()}원`;
    const catMap = {};
    items.forEach(it => {
        if (!catMap[it.catMain]) catMap[it.catMain] = { total: 0, subs: {} };
        catMap[it.catMain].total += it.amount;
        const subKey = it.catSub || '__NONE__';
        catMap[it.catMain].subs[subKey] = (catMap[it.catMain].subs[subKey] || 0) + it.amount;
    });

    const sorted = Object.entries(catMap).sort((a, b) => b[1].total - a[1].total);
    const donutEl = document.getElementById('sum3DonutChart');
    const listEl = document.getElementById('sum3CategoryList');

    if (sorted.length === 0 || totalSpend === 0) {
        donutEl.style.background = '#E5E7EB';
        listEl.innerHTML = `<div class="text-xs text-gray-400 py-8 text-center bg-white rounded-2xl border border-amber-100">표시할 지출 내역이 없습니다.</div>`;
        return;
    }

    let accDeg = 0;
    const stops = sorted.map(([name, obj], idx) => {
        const color = DONUT_PALETTE[idx % DONUT_PALETTE.length];
        const deg = (obj.total / totalSpend) * 360;
        const seg = `${color} ${accDeg.toFixed(1)}deg ${(accDeg + deg).toFixed(1)}deg`;
        accDeg += deg;
        return seg;
    });
    donutEl.style.background = `conic-gradient(${stops.join(', ')})`;

    listEl.innerHTML = sorted.map(([catName, obj], idx) => {
        const color = DONUT_PALETTE[idx % DONUT_PALETTE.length];
        const pct = ((obj.total / totalSpend) * 100).toFixed(1);
        const isExp = !!sum3ExpandedCats[catName];
        const escCat = catName.replace(/'/g, "\\'");

        const subHtml = isExp ? `
            <div class="mt-2 pt-2 border-t border-gray-100 space-y-1 pl-3">
                ${Object.entries(obj.subs).sort((a, b) => b[1] - a[1]).map(([subKey, subAmt]) => {
                    const subLabel = subKey === '__NONE__' ? '(소분류 없음)' : subKey;
                    const subPct = ((subAmt / obj.total) * 100).toFixed(0);
                    const escSub = subKey.replace(/'/g, "\\'");
                    const isSel = (sum3TrendMain === catName && sum3TrendSub === subKey);
                    return `<div onclick="event.stopPropagation(); selectSum3TrendCategory('${escCat}', '${escSub}')"
                        class="flex justify-between items-center text-[11px] px-1.5 py-1 rounded-lg cursor-pointer transition ${isSel ? 'bg-amber-100 text-amber-900 font-bold' : 'text-gray-600 hover:bg-amber-50'}">
                        <span>└ ${escHtml(subLabel)} <span class="text-gray-400 font-normal">(${subPct}%)</span></span>
                        <span class="font-bold text-gray-700">${subAmt.toLocaleString()}원</span>
                    </div>`;
                }).join('')}
            </div>` : '';

        return `
            <div onclick="toggleSum3Cat('${escCat}')" class="bg-white p-2.5 rounded-xl border border-amber-100 cursor-pointer hover:border-amber-300 transition">
                <div class="flex justify-between items-center text-xs">
                    <div class="flex items-center space-x-2 min-w-0">
                        <span class="w-3 h-3 rounded-full shrink-0" style="background-color:${color}"></span>
                        <span class="font-bold text-gray-800 truncate">${escHtml(catName)}</span>
                        <span class="text-[11px] text-gray-400">${pct}%</span>
                    </div>
                    <div class="flex items-center gap-1.5 shrink-0">
                        <span class="font-bold text-gray-800">${obj.total.toLocaleString()}원</span>
                        <span class="text-[10px] text-gray-400">${isExp ? '▲' : '▼'}</span>
                    </div>
                </div>
                ${subHtml}
            </div>`;
    }).join('');
}

function toggleSum3Cat(catName) {
    sum3ExpandedCats[catName] = !sum3ExpandedCats[catName];
    sum3TrendMain = catName; sum3TrendSub = '전체';
    renderTab3();
}
function selectSum3TrendCategory(mainCat, subKey) {
    sum3TrendMain = mainCat; sum3TrendSub = subKey;
    renderTab3();
}

function getAllExpenseCategoryTree() {
    const tree = {};
    db.txTypes.filter(t => t.behavior === 'expense').forEach(t => {
        const cats = db.categories[t.name] || {};
        Object.keys(cats).forEach(m => {
            if (!tree[m]) tree[m] = new Set();
            (cats[m] || []).forEach(s => tree[m].add(s));
        });
    });
    (db.autoTransfers || []).forEach(at => {
        if (!at.includeInExpense) return;
        const m = at.catMain || '미분류';
        if (!tree[m]) tree[m] = new Set();
        if (at.catSub) tree[m].add(at.catSub);
    });
    db.transactions.forEach(t => {
        if (!isTxIncludedInSummaryExpense(t)) return;
        const m = t.catMain || '미분류';
        if (!tree[m]) tree[m] = new Set();
        if (t.catSub) tree[m].add(t.catSub);
    });
    return tree;
}

function syncSum3CatTrendDropdowns(currentItems) {
    const mainSel = document.getElementById('sum3TrendMainCat');
    const subSel = document.getElementById('sum3TrendSubCat');
    if (!mainSel || !subSel) return;

    const tree = getAllExpenseCategoryTree();
    const mains = Object.keys(tree);
    if (mains.length === 0) {
        mainSel.innerHTML = '<option value="">대분류 없음</option>';
        subSel.innerHTML = '<option value="전체">소분류 전체</option>';
        sum3TrendMain = ''; sum3TrendSub = '전체'; return;
    }

    if (!sum3TrendMain || !mains.includes(sum3TrendMain)) {
        const counts = {};
        (currentItems || []).forEach(it => { counts[it.catMain] = (counts[it.catMain] || 0) + it.amount; });
        const topMain = Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0];
        sum3TrendMain = (topMain && mains.includes(topMain)) ? topMain : mains[0];
        sum3TrendSub = '전체';
    }

    mainSel.innerHTML = mains.map(m => `<option value="${escHtml(m)}">대분류: ${escHtml(m)}</option>`).join('');
    mainSel.value = sum3TrendMain;

    const subs = Array.from(tree[sum3TrendMain] || []);
    const hasNoneSub = db.transactions.some(t => isTxIncludedInSummaryExpense(t) && (t.catMain || '미분류') === sum3TrendMain && !t.catSub);
    let subHtml = `<option value="전체">소분류 전체 (합계)</option>` + subs.map(s => `<option value="${escHtml(s)}">${escHtml(s)}</option>`).join('');
    if (hasNoneSub) subHtml += `<option value="__NONE__">(소분류 없음)</option>`;
    subSel.innerHTML = subHtml;

    const validSubs = new Set(['전체', ...subs, ...(hasNoneSub ? ['__NONE__'] : [])]);
    if (!validSubs.has(sum3TrendSub)) sum3TrendSub = '전체';
    subSel.value = sum3TrendSub;
}

function onSum3TrendMainChange() { sum3TrendMain = document.getElementById('sum3TrendMainCat').value; sum3TrendSub = '전체'; renderTab3(); }
function onSum3TrendSubChange() { sum3TrendSub = document.getElementById('sum3TrendSubCat').value; renderTab3(); }

function renderSum3CatTrendChart() {
    const chartEl = document.getElementById('sum3CatTrendChart');
    const titleEl = document.getElementById('sum3CatTrendTitle');
    const statsEl = document.getElementById('sum3CatTrendStats');
    if (!chartEl) return;

    const isYear = (sum3Mode === 'year');
    const nowYM = formatYM(todayObj.getFullYear(), todayObj.getMonth() + 1);
    const firstYM = getSum3FirstRecordYM(nowYM);
    const subLabel = sum3TrendSub === '전체' ? '전체' : (sum3TrendSub === '__NONE__' ? '소분류 없음' : sum3TrendSub);
    const targetName = sum3TrendMain ? `${sum3TrendMain}${sum3TrendSub !== '전체' ? ' · ' + subLabel : ''}` : '분류 미선택';
    titleEl.textContent = isYear ? `${sum3Year}년 [${targetName}] 추이` : `최근 6개월 [${targetName}] 추이`;

    if (!sum3TrendMain) {
        statsEl.textContent = '합계 0원 · 월평균 0원';
        chartEl.style.minWidth = '';
        chartEl.innerHTML = `<div class="col-span-6 text-xs text-gray-400 text-center py-10">선택 가능한 카테고리가 없습니다.</div>`; return;
    }

    const filterFn = (it) => {
        if (it.catMain !== sum3TrendMain) return false;
        if (sum3TrendSub === '전체') return true;
        if (sum3TrendSub === '__NONE__') return !it.catSub;
        return it.catSub === sum3TrendSub;
    };

    const points = [];
    if (isYear) {
        for (let m = 1; m <= 12; m++) {
            const ymStr = formatYM(sum3Year, m);
            const amt = filterItemsByNature(getSpendItemsForMonth(sum3Year, m, sum3Basis), sum3Nature).filter(filterFn).reduce((s, x) => s + x.amount, 0);
            const isEmpty = (ymStr < firstYM || ymStr > nowYM) && amt === 0;
            points.push({ label: `${m}월`, amt, active: (m === sum3Month && sum3Year === todayObj.getFullYear()), isEmpty });
        }
    } else {
        for (let off = -5; off <= 0; off++) {
            const ym = addMonthToYM(sum3Year, sum3Month, off);
            const ymStr = formatYM(ym.y, ym.m);
            const amt = filterItemsByNature(getSpendItemsForMonth(ym.y, ym.m, sum3Basis), sum3Nature).filter(filterFn).reduce((s, x) => s + x.amount, 0);
            const isEmpty = (ymStr < firstYM || ymStr > nowYM) && amt === 0;
            points.push({ label: `${ym.m}월`, amt, active: off === 0, isEmpty });
        }
    }

    const activePts = points.filter(p => !p.isEmpty);
    const total = points.reduce((s, p) => s + p.amt, 0);
    const avgAmt = activePts.length > 0 ? Math.round(total / activePts.length) : 0;
    statsEl.textContent = `합계 ${total.toLocaleString()}원 · 월평균 ${avgAmt.toLocaleString()}원`;
    const maxAmt = Math.max(...activePts.map(p => p.amt), 1);
    chartEl.style.gridTemplateColumns = `repeat(${points.length}, minmax(0, 1fr))`;
    chartEl.style.minWidth = isYear ? '580px' : '';

    chartEl.innerHTML = points.map(p => {
        if (p.isEmpty) {
            return `
                <div class="flex flex-col items-center justify-end h-full gap-1" title="${p.label}: 입력 내역 없음">
                    <span class="text-[10px] font-bold whitespace-nowrap text-transparent select-none">0</span>
                    <div class="w-full ${isYear ? 'max-w-[26px]' : 'max-w-[32px]'} h-28"></div>
                    <span class="text-[11px] font-bold whitespace-nowrap text-gray-300">${p.label}</span>
                </div>`;
        }
        const hPct = p.amt > 0 ? Math.max(8, Math.round((p.amt / maxAmt) * 100)) : 0;
        return `
            <div class="flex flex-col items-center justify-end h-full gap-1" title="${p.label}: ${p.amt.toLocaleString()}원">
                <span class="text-[10px] font-bold whitespace-nowrap ${p.active ? 'text-rose-500' : 'text-gray-500'}">${formatGraphManWon(p.amt)}</span>
                <div class="w-full ${isYear ? 'max-w-[26px]' : 'max-w-[32px]'} h-28 bg-gray-50 rounded-t-lg flex items-end overflow-hidden border border-gray-100">
                    ${hPct > 0 ? `<div class="w-full rounded-t-md transition-all ${p.active ? 'bg-pink-400' : 'bg-blue-300'}" style="height:${hPct}%"></div>` : ''}
                </div>
                <span class="text-[11px] font-bold whitespace-nowrap ${p.active ? 'text-gray-900' : 'text-gray-500'}">${p.label}</span>
            </div>`;
    }).join('');
}

function renderSum3MethodBars(items, totalSpend) {
    const map = {};
    items.forEach(it => {
        const key = it.methodId || it.method;
        if (!map[key]) map[key] = { label: getAssetLabel(key), amt: 0 };
        map[key].amt += it.amount;
    });
    const sorted = Object.values(map).sort((a, b) => b.amt - a.amt);
    const el = document.getElementById('sum3MethodList');
    if (sorted.length === 0) { el.innerHTML = `<div class="text-xs text-gray-400 py-5 text-center">지출 내역이 없습니다.</div>`; return; }
    const maxAmt = sorted[0].amt || 1;
    el.innerHTML = sorted.map(obj => {
        const pct = totalSpend > 0 ? ((obj.amt / totalSpend) * 100).toFixed(1) : '0.0';
        const barW = Math.max(4, Math.round((obj.amt / maxAmt) * 100));
        return `
            <div class="space-y-1 text-xs">
                <div class="flex justify-between items-center">
                    <span class="font-bold text-gray-700">${escHtml(obj.label)} <span class="text-[11px] font-normal text-gray-400">(${pct}%)</span></span>
                    <span class="font-bold text-gray-800">${obj.amt.toLocaleString()}원</span>
                </div>
                <div class="w-full h-2 bg-gray-100 rounded-full overflow-hidden"><div class="h-full bg-amber-400 rounded-full" style="width:${barW}%"></div></div>
            </div>`;
    }).join('');
}

function renderSum3CardPerf() {
    const cards = db.assets
        .filter(a => a.group === 'card' && a.trackPerf !== false && matchesGlobalUser(a.owner))
        .sort((a, b) => (getOwnerRank(a.owner) - getOwnerRank(b.owner)) || compareKorean(a.name, b.name));
    const el = document.getElementById('sum3CardPerfList');
    const isYear = (sum3Mode === 'year');
    document.getElementById('sum3CardPerfPeriod').textContent = isYear ? `${sum3Year}년 연간 누적 기준` : '실적 관리 카드 기준';
    if (cards.length === 0) {
        el.innerHTML = `<div class="text-xs text-gray-400 py-4 text-center bg-white rounded-xl">실적 달성률을 표시할 카드가 없습니다.<br><span class="text-[11px]">[설정 → 4. 자산·카드·부채]에서 카드별 표시 여부를 설정할 수 있습니다.</span></div>`;
        return;
    }

    el.innerHTML = cards.map(c => {
        let periodStart, periodEnd, periodLabel;
        if (isYear) {
            periodStart = `${sum3Year}-01-01`;
            periodEnd = `${sum3Year}-12-31`;
            periodLabel = `${sum3Year}년 전체`;
        } else if (c.type === '신용카드' && c.perfBasis === 'billing') {
            const p = getCardBillingPeriod(c, sum3Year, sum3Month);
            periodStart = p.start;
            periodEnd = p.end;
            periodLabel = `${Number(p.start.slice(5, 7))}/${Number(p.start.slice(8, 10))}~${Number(p.end.slice(5, 7))}/${Number(p.end.slice(8, 10))}`;
        } else {
            periodStart = `${sum3Year}-${String(sum3Month).padStart(2, '0')}-01`;
            periodEnd = `${sum3Year}-${String(sum3Month).padStart(2, '0')}-${String(new Date(sum3Year, sum3Month, 0).getDate()).padStart(2, '0')}`;
            periodLabel = `${sum3Month}/1~말일`;
        }

        const spent = db.transactions
            .filter(t => getTypeBehavior(t.type) === 'expense' && resolveToAssetId(t.method) === c.id && t.date >= periodStart && t.date <= periodEnd)
            .reduce((s, t) => s + (Number(t.amount) || 0), 0);
        const target = (Number(c.targetSpend) || 0) * (isYear ? 12 : 1);
        const pct = target > 0 ? Math.min(100, Math.round((spent / target) * 100)) : 0;
        const remain = Math.max(0, target - spent), achieved = target > 0 && spent >= target;

        return `
            <div class="bg-white p-3 rounded-xl border border-blue-100 space-y-1.5 text-xs">
                <div class="flex justify-between items-center gap-2">
                    <span class="font-bold text-gray-800 flex items-center gap-1 flex-wrap">
                        ${getOwnerBadgeHtml(c.owner)}
                        <span>${escHtml(c.name)}</span>
                        <span class="text-[10px] px-1.5 py-0.5 rounded bg-blue-50 text-blue-700 whitespace-nowrap">${periodLabel}</span>
                    </span>
                    <span class="font-bold shrink-0 whitespace-nowrap ${achieved ? 'text-green-600' : 'text-blue-700'}">${target > 0 ? (achieved ? '실적 달성 완료' : `${remain.toLocaleString()}원 남음`) : '목표 실적 미설정'}</span>
                </div>
                <div class="w-full h-2 bg-gray-100 rounded-full overflow-hidden"><div class="h-full ${achieved ? 'bg-green-400' : 'bg-blue-400'} rounded-full transition-all" style="width:${pct}%"></div></div>
                <div class="flex justify-between text-[11px] text-gray-500"><span>누적 사용 ${spent.toLocaleString()}원</span><span>목표 ${target.toLocaleString()}원 (${pct}%)</span></div>
            </div>`;
    }).join('');
}

function renderSum3TrendChart() {
    const isYear = (sum3Mode === 'year');
    const nowYM = formatYM(todayObj.getFullYear(), todayObj.getMonth() + 1);
    const firstYM = getSum3FirstRecordYM(nowYM);
    const nLabel = { all: '전체', fixed: '고정비', variable: '변동비' }[sum3Nature] || '전체';
    document.getElementById('sum3TrendTitle').textContent = isYear ? `${sum3Year}년 월별 ${nLabel} 지출 추이` : `최근 6개월 ${nLabel} 지출 추이`;

    const points = [];
    if (isYear) {
        for (let m = 1; m <= 12; m++) {
            const ymStr = formatYM(sum3Year, m);
            const amt = filterItemsByNature(getSpendItemsForMonth(sum3Year, m, sum3Basis), sum3Nature).reduce((s, x) => s + x.amount, 0);
            const isEmpty = (ymStr < firstYM || ymStr > nowYM) && amt === 0;
            points.push({ label: `${m}월`, amt, active: (m === sum3Month && sum3Year === todayObj.getFullYear()), isEmpty });
        }
    } else {
        for (let off = -5; off <= 0; off++) {
            const ym = addMonthToYM(sum3Year, sum3Month, off);
            const ymStr = formatYM(ym.y, ym.m);
            const amt = filterItemsByNature(getSpendItemsForMonth(ym.y, ym.m, sum3Basis), sum3Nature).reduce((s, x) => s + x.amount, 0);
            const isEmpty = (ymStr < firstYM || ymStr > nowYM) && amt === 0;
            points.push({ label: `${ym.m}월`, amt, active: off === 0, isEmpty });
        }
    }

    const activePts = points.filter(p => !p.isEmpty);
    const maxAmt = Math.max(...activePts.map(p => p.amt), 1);
    const chartEl = document.getElementById('sum3TrendChart');
    chartEl.style.gridTemplateColumns = `repeat(${points.length}, minmax(0, 1fr))`;
    chartEl.style.minWidth = isYear ? '600px' : '';

    chartEl.innerHTML = points.map(p => {
        if (p.isEmpty) {
            return `
                <div class="flex flex-col items-center justify-end h-full gap-1" title="${p.label}: 입력 내역 없음">
                    <span class="text-[10px] font-bold whitespace-nowrap text-transparent select-none">0</span>
                    <div class="w-full max-w-[36px] h-32"></div>
                    <span class="text-[11px] font-bold whitespace-nowrap text-gray-300">${p.label}</span>
                </div>`;
        }
        const hPct = p.amt > 0 ? Math.max(8, Math.round((p.amt / maxAmt) * 100)) : 0;
        return `
            <div class="flex flex-col items-center justify-end h-full gap-1" title="${p.label}: ${p.amt.toLocaleString()}원">
                <span class="text-[10px] font-bold whitespace-nowrap ${p.active ? 'text-rose-500' : 'text-gray-500'}">${formatGraphManWon(p.amt)}</span>
                <div class="w-full max-w-[36px] h-32 bg-gray-50 rounded-t-xl flex items-end overflow-hidden border border-gray-100">
                    ${hPct > 0 ? `<div class="w-full rounded-t-lg transition-all ${p.active ? 'bg-rose-400' : 'bg-amber-300'}" style="height:${hPct}%"></div>` : ''}
                </div>
                <span class="text-[11px] font-bold whitespace-nowrap ${p.active ? 'text-gray-900' : 'text-gray-500'}">${p.label}</span>
            </div>`;
    }).join('');
}

function openMonthlyBudgetModal() {
    const ym = formatYM(sum3Year, sum3Month), cur = getEffectiveBudgetForMonth(sum3Year, sum3Month);
    const defaultAmt = Number(db.config.monthlyBudget) || 0;
    openCustomModal(`
        <h3 class="title-font text-lg text-amber-900">${sum3Year}년 ${sum3Month}월 목표 예산 수정</h3>
        <p class="text-xs text-gray-500">이 달에만 예산을 다르게 잡고 싶을 때 사용합니다. (기본 월 예산: ${defaultAmt.toLocaleString()}원)</p>
        <div class="space-y-3 text-xs pt-1">
            <div><label class="block font-bold text-gray-600 mb-1">${sum3Month}월 목표 지출 예산 (원)</label>
                <input type="text" inputmode="numeric" id="modalMonthBudgetAmt" onfocus="if(this.value==='0') this.value='';" oninput="formatCommaInput(this)" value="${formatNumberToInput(cur.amount, true)}" class="w-full p-2.5 border border-amber-300 rounded-xl text-sm font-bold text-right"></div>
            <div><label class="block font-bold text-gray-600 mb-1">메모 (선택)</label>
                <input type="text" id="modalMonthBudgetMemo" lang="ko" autocapitalize="off" autocorrect="off" spellcheck="false" style="ime-mode:active;" value="${escHtml(cur.memo)}" placeholder="예: 부모님 용돈 50만 원 포함" class="w-full p-2.5 border border-gray-300 rounded-xl text-xs"></div>
        </div>
        <div class="flex justify-between items-center pt-2">
            ${cur.isCustom ? `<button onclick="resetMonthlyBudgetOverride('${ym}')" class="text-xs text-gray-500 underline font-bold">기본 예산으로 되돌리기</button>` : `<span></span>`}
            <div class="flex gap-2">
                <button onclick="closeCustomModal()" class="px-4 py-2 bg-gray-100 text-gray-700 font-bold rounded-xl text-xs">취소</button>
                <button onclick="saveMonthlyBudgetOverride('${ym}')" class="px-4 py-2 btn-yellow rounded-xl text-xs shadow-sm">이 달에 적용</button>
            </div>
        </div>`);
}

function saveMonthlyBudgetOverride(ym) {
    if (!db.monthlyBudgets) db.monthlyBudgets = {};
    db.monthlyBudgets[ym] = {
        amount: parseCommaNumber(document.getElementById('modalMonthBudgetAmt').value),
        memo: document.getElementById('modalMonthBudgetMemo').value.trim()
    };
    closeCustomModal(); saveDb();
}
function resetMonthlyBudgetOverride(ym) {
    if (db.monthlyBudgets && db.monthlyBudgets[ym]) delete db.monthlyBudgets[ym];
    closeCustomModal(); saveDb();
}