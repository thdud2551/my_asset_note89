// =========================================================
// [3. 정기 지출] 전용 모듈 (미반영/반영완료 사용자별 접이식 · 할부 월분할/자동표시 · 고정비 포함 이체)
// =========================================================
let atYear = todayObj.getFullYear();
let atMonth = todayObj.getMonth() + 1;
let atMasterFilter = 'active'; // 'all' | 'active' | 'paused' | 'ended'
let atFormOpen = false;
let atPendingExpandedUsers = {};
let atAppliedExpandedUsers = {};
let atMasterExpandedUsers = {};
let atSelectedPendingIds = new Set();
let atExecDrafts = {}; // key: `${ym}_${atId}` -> { date, amountStr, instMonths }
let atSelectedMonths = [];

function getAtTypeRank(typeName) {
    const idx = (db.txTypes || []).findIndex(t => t.name === typeName);
    return idx >= 0 ? idx : 999;
}

// 정렬 통일: 사용자 -> 구분 -> 분류(대분류 -> 소분류) -> 항목 이름순
function compareAutoTransferItems(a, b) {
    return (
        (getOwnerRank(a.user) - getOwnerRank(b.user)) ||
        (getAtTypeRank(a.type) - getAtTypeRank(b.type)) ||
        compareKorean(a.catMain || '', b.catMain || '') ||
        compareKorean(a.catSub || '', b.catSub || '') ||
        compareKorean(a.name || '', b.name || '')
    );
}

// 할부 회차별 월 금액 계산 (가계부·지출분석과 동일한 1회차 잔여원금 합산 방식)
function getAtInstallmentSliceAmount(totalAmount, months, instIndex = 1) {
    const total = Number(totalAmount) || 0;
    const m = Number(months) || 1;
    if (m <= 1) return total;
    const base = Math.floor(total / m);
    const rem = total - (base * m);
    return instIndex === 1 ? (base + rem) : base;
}

function getAtDraftKey(ym, atId) {
    return `${ym}_${atId}`;
}

function getAtDraftValues(at, sched, exp, ym) {
    const saved = atExecDrafts[getAtDraftKey(ym, at.id)] || {};
    return {
        date: saved.date !== undefined ? saved.date : sched.date,
        amountStr: saved.amountStr !== undefined ? saved.amountStr : (exp.amount !== null ? formatNumberToInput(exp.amount) : ''),
        instMonths: saved.instMonths !== undefined ? Number(saved.instMonths) : (Number(at.installmentMonths) || 1)
    };
}

function updateAtExecDraft(ym, atId, field, value) {
    const key = getAtDraftKey(ym, atId);
    if (!atExecDrafts[key]) atExecDrafts[key] = {};
    atExecDrafts[key][field] = value;
}

function clearAtDraftsForItem(atId) {
    Object.keys(atExecDrafts).forEach(k => {
        if (k.endsWith('_' + atId)) delete atExecDrafts[k];
    });
}

function groupEntriesByOwner(entries, getOwnerFn) {
    const map = {};
    const order = [];
    (db.users || []).forEach(u => { map[u] = []; order.push(u); });
    entries.forEach(entry => {
        const own = getOwnerFn(entry) || '미지정';
        if (!map[own]) { map[own] = []; order.push(own); }
        map[own].push(entry);
    });
    return order.filter(o => map[o].length > 0).map(o => ({ owner: o, items: map[o] }));
}

function adjustToNextBusinessDay(dateStr) {
    let cand = dateStr;
    for (let i = 0; i < 15; i++) {
        const y = Number(cand.slice(0, 4));
        const dow = getDowFromStr(cand);
        const hols = getKoreanHolidaysForYear(y);
        if (dow !== 0 && dow !== 6 && !hols[cand]) {
            return { date: cand, shifted: cand !== dateStr };
        }
        cand = shiftDateStr(cand, 1);
    }
    return { date: dateStr, shifted: false };
}

function getScheduledDateForAutoItem(at, year, month) {
    const baseDate = makeClampedDate(year, month, 0, at.dayOfMonth || 1);
    if (at.shiftBusinessDay) {
        return adjustToNextBusinessDay(baseDate);
    }
    return { date: baseDate, shifted: false };
}

function isAutoItemDueInMonth(at, year, month) {
    if (at.active === false) return false;
    const ym = formatYM(year, month);
    if (at.startYM && ym < at.startYM) return false;
    if (at.endYM && ym > at.endYM) return false;
    if (at.cycleType === 'specific') {
        return Array.isArray(at.months) && at.months.includes(month);
    }
    return true;
}

function findAppliedTxForAutoItem(atId, ym) {
    return db.transactions.find(t => t.autoTransferId === atId && t.autoTransferYM === ym) || null;
}

function findPrevYearAmountForAutoItem(atId, year, month) {
    const prevYM = formatYM(year - 1, month);
    const prevTx = db.transactions.find(t => t.autoTransferId === atId && t.autoTransferYM === prevYM);
    return prevTx ? Number(prevTx.amount) : null;
}

function getExpectedAmountForAutoItem(at, year, month) {
    const ym = formatYM(year, month);
    const applied = findAppliedTxForAutoItem(at.id, ym);
    if (applied) return { amount: Number(applied.amount), source: 'applied' };
    if (at.amountType === 'variable') {
        const prevAmt = findPrevYearAmountForAutoItem(at.id, year, month);
        if (prevAmt !== null) return { amount: prevAmt, source: 'prevYear' };
        return { amount: null, source: 'blank' };
    }
    return { amount: Number(at.amount) || 0, source: 'fixed' };
}

// 정기 지출에서 할부로 반영된 항목의 2회차~N회차 자동 표시 목록 (결제일 기준)
function getAutoInstallmentFollowupsForMonth(year, month, excludeTxIds) {
    const list = [];
    (db.transactions || []).forEach(t => {
        if (!t.fromAutoTransfer && !t.autoTransferId) return;
        if (!matchesGlobalUser(t.user)) return;
        if (getTypeBehavior(t.type) !== 'expense') return;
        if (!t.date || t.date.length < 10) return;

        const months = Number(t.installmentMonths) || 1;
        if (months <= 1) return;
        if (excludeTxIds && excludeTxIds.has(t.id)) return;

        const [txY, txM, txD] = t.date.split('-').map(Number);
        const diff = (year - txY) * 12 + (month - txM);
        if (diff >= 1 && diff < months) {
            const idx = diff + 1;
            const totalAmount = Number(t.amount) || 0;
            list.push({
                tx: t,
                instIndex: idx,
                instMonths: months,
                totalAmount,
                displayAmount: getAtInstallmentSliceAmount(totalAmount, months, idx),
                displayDate: makeClampedDate(txY, txM, diff, txD),
                originalDate: t.date,
                sortKey: {
                    user: t.user,
                    type: t.type,
                    catMain: t.catMain || '',
                    catSub: t.catSub || '',
                    name: t.memo || ''
                }
            });
        }
    });
    return list.sort((a, b) => compareAutoTransferItems(a.sortKey, b.sortKey));
}

function getSpecificPendingAutoItemsForMonth(year, month) {
    const ym = formatYM(year, month);
    const list = [];
    (db.autoTransfers || []).forEach(at => {
        if (at.cycleType !== 'specific') return;
        if (!isAutoItemDueInMonth(at, year, month)) return;
        if (!matchesGlobalUser(at.user)) return;
        if (findAppliedTxForAutoItem(at.id, ym)) return;
        const sched = getScheduledDateForAutoItem(at, year, month);
        const exp = getExpectedAmountForAutoItem(at, year, month);
        list.push({
            id: at.id,
            name: at.name,
            date: sched.date,
            shifted: sched.shifted,
            expectedAmount: exp.amount,
            source: exp.source,
            type: at.type
        });
    });
    return list.sort((a, b) => a.date.localeCompare(b.date) || compareKorean(a.name, b.name));
}

function getMonthlyFixedExpenseHint() {
    const nowY = todayObj.getFullYear();
    const nowM = todayObj.getMonth() + 1;
    const nowYM = formatYM(nowY, nowM);
    return (db.autoTransfers || [])
        .filter(at => at.active !== false && at.cycleType !== 'specific' && (getTypeBehavior(at.type) === 'expense' || !!at.includeInExpense))
        .filter(at => (!at.startYM || nowYM >= at.startYM) && (!at.endYM || nowYM <= at.endYM))
        .reduce((s, at) => {
            const exp = getExpectedAmountForAutoItem(at, nowY, nowM);
            const rawAmt = exp.amount || 0;
            const asset = findAsset(at.method);
            const isCredit = getTypeBehavior(at.type) === 'expense' && asset && asset.type === '신용카드';
            const instM = isCredit ? (Number(at.installmentMonths) || 1) : 1;
            return s + getAtInstallmentSliceAmount(rawAmt, instM, 1);
        }, 0);
}

function getAnnualSpecificExpenseTotal(year) {
    const yStr = String(year);
    let total = 0;
    (db.autoTransfers || []).forEach(at => {
        if (at.active === false || at.cycleType !== 'specific') return;
        if (getTypeBehavior(at.type) !== 'expense' && !at.includeInExpense) return;
        if (!matchesGlobalUser(at.user)) return;
        const months = Array.isArray(at.months) ? at.months : [];
        months.forEach(m => {
            const ym = formatYM(year, m);
            if (at.startYM && ym < at.startYM) return;
            if (at.endYM && ym > at.endYM) return;
            const exp = getExpectedAmountForAutoItem(at, year, m);
            if (exp.amount) {
                total += exp.amount;
            } else {
                const latest = db.transactions
                    .filter(t => t.autoTransferId === at.id && t.date.slice(0, 4) <= yStr)
                    .sort((a, b) => b.date.localeCompare(a.date))[0];
                if (latest) total += Number(latest.amount) || 0;
            }
        });
    });
    return total;
}

// =========================================================
// [3. 정기 지출] 월별 데이터 계산 · 화면 렌더링
// =========================================================
function getDueItemsForAtMonth(year, month) {
    const ym = formatYM(year, month);
    return (db.autoTransfers || []).filter(at => {
        if (!matchesGlobalUser(at.user)) return false;
        return isAutoItemDueInMonth(at, year, month);
    }).map(at => {
        const sched = getScheduledDateForAutoItem(at, year, month);
        const applied = findAppliedTxForAutoItem(at.id, ym);
        const exp = getExpectedAmountForAutoItem(at, year, month);
        const b = getTypeBehavior(at.type);
        const asset = findAsset(at.method);
        const isCredit = (b === 'expense' && asset && asset.type === '신용카드');

        let displayAmount = 0;
        let totalAmount = 0;
        let instMonths = 1;

        if (applied) {
            totalAmount = Number(applied.amount) || 0;
            instMonths = (b === 'expense') ? (Number(applied.installmentMonths) || 1) : 1;
            displayAmount = getAtInstallmentSliceAmount(totalAmount, instMonths, 1);
        } else {
            const draft = getAtDraftValues(at, sched, exp, ym);
            totalAmount = draft.amountStr ? parseCommaNumber(draft.amountStr) : 0;
            instMonths = isCredit ? (Number(draft.instMonths) || 1) : 1;
            displayAmount = totalAmount > 0 ? getAtInstallmentSliceAmount(totalAmount, instMonths, 1) : 0;
        }

        return { at, sched, applied, exp, isCredit, displayAmount, totalAmount, instMonths };
    }).sort((a, b) => compareAutoTransferItems(a.at, b.at));
}

function changeAtMonth(delta) {
    const next = addMonthToYM(atYear, atMonth, delta);
    atYear = next.y; atMonth = next.m;
    atSelectedPendingIds.clear();
    renderTab4();
}

function goAtToday() {
    const now = new Date();
    atYear = now.getFullYear(); atMonth = now.getMonth() + 1;
    atSelectedPendingIds.clear();
    renderTab4();
}

function jumpToAutoTransferMonth(year, month) {
    atYear = year; atMonth = month;
    atSelectedPendingIds.clear();
    switchMainTab('tab4');
}

function setAtMasterFilter(filter) {
    atMasterFilter = filter;
    ['all', 'active', 'paused', 'ended'].forEach(f => {
        const el = document.getElementById('atFilter-' + f);
        if (!el) return;
        el.className = (f === filter)
            ? "px-2.5 py-1 rounded-lg text-xs font-bold bg-white text-gray-800 shadow-sm"
            : "px-2.5 py-1 rounded-lg text-xs font-bold text-gray-500";
    });
    renderAtMasterList();
}

function toggleAtPendingUserGroup(owner) {
    atPendingExpandedUsers[owner] = !atPendingExpandedUsers[owner];
    renderTab4();
}

function toggleAllAtPendingUserGroups() {
    const dueItems = getDueItemsForAtMonth(atYear, atMonth);
    const groups = groupEntriesByOwner(dueItems.filter(x => !x.applied), x => x.at.user);
    if (groups.length === 0) return;
    const allOpen = groups.every(g => !!atPendingExpandedUsers[g.owner]);
    groups.forEach(g => { atPendingExpandedUsers[g.owner] = !allOpen; });
    renderTab4();
}

function toggleAtAppliedUserGroup(owner) {
    atAppliedExpandedUsers[owner] = !atAppliedExpandedUsers[owner];
    renderTab4();
}

function toggleAllAtAppliedUserGroups() {
    const dueItems = getDueItemsForAtMonth(atYear, atMonth);
    const appliedDue = dueItems.filter(x => !!x.applied);
    const appliedTxIds = new Set(appliedDue.map(x => x.applied.id));
    const instFollowups = getAutoInstallmentFollowupsForMonth(atYear, atMonth, appliedTxIds);
    const owners = new Set([
        ...appliedDue.map(x => x.at.user || '미지정'),
        ...instFollowups.map(f => f.tx.user || '미지정')
    ]);
    if (owners.size === 0) return;
    const ownerArr = Array.from(owners);
    const allOpen = ownerArr.every(o => !!atAppliedExpandedUsers[o]);
    ownerArr.forEach(o => { atAppliedExpandedUsers[o] = !allOpen; });
    renderTab4();
}

function togglePendingUserSelect(owner, checked) {
    const pendingItems = getDueItemsForAtMonth(atYear, atMonth).filter(x => !x.applied);
    pendingItems.forEach(x => {
        if ((x.at.user || '미지정') === owner) {
            if (checked) atSelectedPendingIds.add(x.at.id);
            else atSelectedPendingIds.delete(x.at.id);
        }
    });
    renderTab4();
}

function togglePendingItemSelect(atId, checked) {
    if (checked) atSelectedPendingIds.add(atId);
    else atSelectedPendingIds.delete(atId);
    renderTab4();
}

function renderTab4() {
    if (!document.getElementById('atMonthTitle')) return;
    const ym = formatYM(atYear, atMonth);
    const nextYMObj = addMonthToYM(atYear, atMonth, 1);
    const nextYM = formatYM(nextYMObj.y, nextYMObj.m);

    document.getElementById('atMonthTitle').textContent = `${atYear}년 ${atMonth}월 정기 지출`;

    const dueItems = getDueItemsForAtMonth(atYear, atMonth);
    const appliedTxIds = new Set(dueItems.filter(x => x.applied).map(x => x.applied.id));
    const instFollowups = getAutoInstallmentFollowupsForMonth(atYear, atMonth, appliedTxIds);

    let sumFixedExp = 0, sumTransfer = 0, sumIncludedTransfer = 0, doneCount = 0;
    dueItems.forEach(({ at, applied, displayAmount }) => {
        const b = getTypeBehavior(at.type);
        if (b === 'expense') {
            sumFixedExp += displayAmount;
        } else if (b === 'transfer' || b === 'voucher') {
            sumTransfer += displayAmount;
            if (at.includeInExpense) {
                sumFixedExp += displayAmount;
                sumIncludedTransfer += displayAmount;
            }
        }
        if (applied) doneCount++;
    });

    // 2회차~N회차 정기 할부 자동 표시 항목도 월 고정비 및 완료 건수에 포함
    instFollowups.forEach(it => {
        sumFixedExp += it.displayAmount;
        doneCount++;
    });

    const totalItemCount = dueItems.length + instFollowups.length;
    const annualSpec = getAnnualSpecificExpenseTotal(atYear);
    document.getElementById('atSumExpense').textContent = `${sumFixedExp.toLocaleString()}원`;
    const hintParts = [];
    if (sumIncludedTransfer > 0) hintParts.push(`고정비 포함 이체 ${sumIncludedTransfer.toLocaleString()}원 포함`);
    if (annualSpec > 0) hintParts.push(`연간 세금·보험 ${annualSpec.toLocaleString()}원 (월 ${Math.round(annualSpec / 12).toLocaleString()}원)`);
    document.getElementById('atSumAnnualHint').textContent = hintParts.length > 0 ? hintParts.join(' · ') : '등록된 연간 세금·보험 없음';

    document.getElementById('atSumTransfer').textContent = `${sumTransfer.toLocaleString()}원`;
    document.getElementById('atSumStatus').textContent = `${doneCount} / ${totalItemCount}건 완료`;
    document.getElementById('atSumStatusSub').textContent = totalItemCount > doneCount
        ? `반영 대기 ${totalItemCount - doneCount}건`
        : (totalItemCount > 0 ? '이번 달 모든 항목 반영 완료' : '이번 달 예정 항목 없음');

    const endingItems = (db.autoTransfers || []).filter(at => {
        if (at.active === false || !at.endYM) return false;
        if (!matchesGlobalUser(at.user)) return false;
        return at.endYM === ym || at.endYM === nextYM;
    });
    const alertBox = document.getElementById('atEndingAlertBanner');
    if (endingItems.length > 0) {
        alertBox.classList.remove('hidden');
        document.getElementById('atEndingAlertText').innerHTML = endingItems.map(at => {
            const label = at.endYM === ym ? '이번 달 종료' : '다음 달 종료 예정';
            const badgeCls = at.endYM === ym ? 'bg-rose-100 text-rose-700' : 'bg-amber-100 text-amber-800';
            return `<span class="inline-flex items-center gap-1 mr-2"><b>${escHtml(at.name)}</b><span class="text-[10px] px-1.5 py-0.5 rounded font-bold ${badgeCls}">${label}</span></span>`;
        }).join('');
    } else {
        alertBox.classList.add('hidden');
    }

    renderAtMonthlyExecutionList(dueItems, instFollowups, ym);
    syncAtFormOptions();
    renderAtMasterList();
}

function buildAtItemBadgesHtml(at, sched, applied, exp, ym) {
    const isEndingThisMonth = (at.endYM === ym);
    const isSpecific = (at.cycleType === 'specific');
    const appliedInst = applied ? (Number(applied.installmentMonths) || 1) : 1;
    const b = getTypeBehavior(at.type);
    const isIncTransfer = (b === 'transfer' || b === 'voucher') && !!at.includeInExpense;

    return [
        isSpecific
            ? `<span class="text-[10px] px-1.5 py-0.5 rounded bg-orange-100 text-orange-800 font-bold">특정월</span>`
            : `<span class="text-[10px] px-1.5 py-0.5 rounded bg-gray-100 text-gray-600 font-bold">매월</span>`,
        isIncTransfer ? `<span class="text-[10px] px-1.5 py-0.5 rounded bg-purple-100 text-purple-700 font-bold">고정비 포함</span>` : '',
        sched.shifted ? `<span class="text-[10px] px-1.5 py-0.5 rounded bg-blue-50 text-blue-700 font-bold">영업일 보정</span>` : '',
        (!applied && exp.source === 'prevYear') ? `<span class="text-[10px] px-1.5 py-0.5 rounded bg-purple-50 text-purple-700 font-bold">전년 동월 기준</span>` : '',
        (!applied && exp.source === 'blank') ? `<span class="text-[10px] px-1.5 py-0.5 rounded bg-amber-50 text-amber-800 font-bold">변동 · 직접 입력</span>` : '',
        (applied && appliedInst > 1) ? `<span class="text-[10px] px-1.5 py-0.5 rounded bg-pink-100 text-pink-800 font-bold">1/${appliedInst}회차</span>` : '',
        isEndingThisMonth ? `<span class="text-[10px] px-1.5 py-0.5 rounded bg-rose-100 text-rose-700 font-bold">이번 달 종료</span>` : ''
    ].filter(Boolean).join(' ');
}

function buildAtExecInstSelectHtml(at, selectedInstMonths, ym) {
    const b = getTypeBehavior(at.type);
    const asset = findAsset(at.method);
    if (b !== 'expense' || !asset || asset.type !== '신용카드') return '';
    const curM = Number(selectedInstMonths) || 1;
    let opts = `<option value="1" ${curM === 1 ? 'selected' : ''}>일시불</option>`;
    for (let m = 2; m <= 36; m++) {
        opts += `<option value="${m}" ${curM === m ? 'selected' : ''}>${m}개월</option>`;
    }
    return `<select id="atExecInst_${at.id}" onchange="updateAtExecDraft('${ym}', '${at.id}', 'instMonths', Number(this.value))" title="신용카드 할부 개월 수" class="p-1.5 bg-pink-50/50 border border-pink-200 rounded-xl text-xs font-bold text-pink-900">${opts}</select>`;
}

function renderAtMonthlyExecutionList(dueItems, instFollowups, ym) {
    const container = document.getElementById('atExecutionList');
    const selectAllWrap = document.getElementById('atSelectAllWrap');
    const pendingItems = dueItems.filter(x => !x.applied);
    const appliedDueItems = dueItems.filter(x => !!x.applied);

    // 현재 표시되는 미반영 항목에 없는 선택 ID 정리
    const validPendingSet = new Set(pendingItems.map(x => x.at.id));
    Array.from(atSelectedPendingIds).forEach(id => {
        if (!validPendingSet.has(id)) atSelectedPendingIds.delete(id);
    });

    // 상단 [대기 전체 선택] 체크박스 & [선택 일괄 반영] 버튼 상태 갱신
    if (selectAllWrap) {
        selectAllWrap.classList.toggle('hidden', pendingItems.length === 0);
        const bulkBtn = selectAllWrap.querySelector('button');
        if (bulkBtn) {
            bulkBtn.textContent = atSelectedPendingIds.size > 0
                ? `선택 일괄 반영 (${atSelectedPendingIds.size}건)`
                : '선택 일괄 반영';
        }
    }
    const selectAllChk = document.getElementById('atSelectAllChk');
    if (selectAllChk) {
        const allSel = pendingItems.length > 0 && pendingItems.every(x => atSelectedPendingIds.has(x.at.id));
        const someSel = atSelectedPendingIds.size > 0 && !allSel;
        selectAllChk.checked = allSel;
        selectAllChk.indeterminate = someSel;
    }

    // 1회차 반영 완료 항목 + 2~N회차 할부 자동표시 항목 통합 정렬
    const appliedEntries = [
        ...appliedDueItems.map(item => ({
            isFollowup: false,
            sortKey: item.at,
            item
        })),
        ...(instFollowups || []).map(f => ({
            isFollowup: true,
            sortKey: f.sortKey,
            followup: f
        }))
    ].sort((a, b) => compareAutoTransferItems(a.sortKey, b.sortKey));

    if (pendingItems.length === 0 && appliedEntries.length === 0) {
        container.innerHTML = `<div class="bg-white p-8 rounded-2xl border border-orange-100 text-center text-xs text-gray-400">이번 달에 예정된 정기 지출·이체 항목이 없습니다. 아래에서 새 항목을 등록해 보세요.</div>`;
        return;
    }

    // ---------------------------------------------------------
    // 1) 미반영 목록 (사용자별 기본 접힘 + 헤더 체크박스 · 예상 합계 · 미입력/특정월 배지)
    // ---------------------------------------------------------
    let pendingHtml = '';
    const indeterminateUserChkIds = [];

    if (pendingItems.length === 0) {
        pendingHtml = `
            <div class="bg-green-50 p-5 rounded-2xl border border-green-200 text-center text-xs font-bold text-green-800">
                이번 달 예정된 정기 지출·이체를 모두 반영했습니다.
            </div>`;
    } else {
        const pendingGroups = groupEntriesByOwner(pendingItems, x => x.at.user);
        const allPendingOpen = pendingGroups.every(g => !!atPendingExpandedUsers[g.owner]);
        const pendingTotalSum = pendingItems.reduce((s, x) => s + x.displayAmount, 0);

        const groupCardsHtml = pendingGroups.map((g, gIdx) => {
            const isOpen = !!atPendingExpandedUsers[g.owner];
            const escOwner = g.owner.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
            const groupSum = g.items.reduce((s, x) => s + x.displayAmount, 0);
            const blankCount = g.items.filter(x => x.totalAmount <= 0).length;
            const specificCount = g.items.filter(x => x.at.cycleType === 'specific').length;
            const selCount = g.items.filter(x => atSelectedPendingIds.has(x.at.id)).length;
            const allGroupSel = g.items.length > 0 && selCount === g.items.length;
            const chkId = `atPendingUserChk_${gIdx}`;
            if (selCount > 0 && !allGroupSel) indeterminateUserChkIds.push(chkId);

            const bodyHtml = isOpen ? `
                <div class="border-t border-orange-100 p-2.5 sm:p-3 space-y-2 bg-orange-50/30">
                    ${g.items.map(({ at, sched, applied, exp }) => {
                        const b = getTypeBehavior(at.type);
                        const isTr = (b === 'transfer' || b === 'voucher');
                        const methodText = isTr ? `${getAssetLabel(at.method)} → ${getAssetLabel(at.targetAsset)}` : getAssetLabel(at.method);
                        const badges = buildAtItemBadgesHtml(at, sched, applied, exp, ym);
                        const draft = getAtDraftValues(at, sched, exp, ym);
                        const instSelectHtml = buildAtExecInstSelectHtml(at, draft.instMonths, ym);
                        const isChecked = atSelectedPendingIds.has(at.id);

                        return `
                            <div class="bg-white p-3 rounded-xl border border-orange-200 flex flex-wrap justify-between items-center gap-2.5 text-xs shadow-sm">
                                <div class="flex items-start gap-2 min-w-[200px] flex-1">
                                    <input type="checkbox" class="at-bulk-chk mt-1 rounded accent-orange-500" value="${at.id}" ${isChecked ? 'checked' : ''} onchange="togglePendingItemSelect('${at.id}', this.checked)">
                                    <div class="space-y-1 min-w-0">
                                        <div class="flex items-center gap-1.5 flex-wrap">
                                            <span class="font-bold text-gray-800 text-sm">${escHtml(at.name)}</span>
                                            ${badges}
                                        </div>
                                        <div class="text-[11px] text-gray-500">
                                            ${escHtml(at.type)} (${escHtml(at.catMain)}${at.catSub ? '/' + escHtml(at.catSub) : ''}) · ${escHtml(methodText)}
                                        </div>
                                    </div>
                                </div>
                                <div class="flex flex-wrap items-center gap-1.5 sm:gap-2 ml-auto">
                                    <input type="date" id="atExecDate_${at.id}" value="${draft.date}" onchange="updateAtExecDraft('${ym}', '${at.id}', 'date', this.value)" class="p-1.5 bg-gray-50 border border-gray-200 rounded-xl text-xs font-bold">
                                    ${instSelectHtml}
                                    <input type="text" inputmode="numeric" id="atExecAmt_${at.id}" onfocus="if(this.value==='0') { this.value=''; updateAtExecDraft('${ym}', '${at.id}', 'amountStr', ''); }" oninput="formatCommaInput(this); updateAtExecDraft('${ym}', '${at.id}', 'amountStr', this.value)" value="${draft.amountStr}" placeholder="금액 입력" class="w-28 p-1.5 bg-white border border-orange-300 rounded-xl text-xs font-bold text-right">
                                    <button onclick="applySingleAutoTransfer('${at.id}')" class="px-3 py-1.5 btn-orange rounded-xl text-xs shadow-sm whitespace-nowrap">반영</button>
                                </div>
                            </div>`;
                    }).join('')}
                </div>` : '';

            return `
                <div class="bg-white rounded-2xl border border-orange-200 overflow-hidden shadow-sm">
                    <div onclick="toggleAtPendingUserGroup('${escOwner}')" class="px-3.5 py-3 flex flex-wrap justify-between items-center gap-2 cursor-pointer hover:bg-orange-50/40 select-none transition">
                        <div class="flex items-center gap-2 min-w-0 flex-wrap">
                            <input type="checkbox" id="${chkId}" ${allGroupSel ? 'checked' : ''} onclick="event.stopPropagation()" onchange="togglePendingUserSelect('${escOwner}', this.checked)" title="${escHtml(g.owner)} 미반영 전체 선택" class="rounded accent-orange-500 shrink-0">
                            ${getOwnerBadgeHtml(g.owner)}
                            <span class="font-bold text-sm text-orange-900 truncate">${escHtml(g.owner)}</span>
                            <span class="text-[11px] px-2 py-0.5 rounded-full bg-orange-50 text-orange-800 font-bold shrink-0 whitespace-nowrap">${g.items.length}건</span>
                            ${blankCount > 0 ? `<span class="text-[10px] px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 font-bold shrink-0 whitespace-nowrap">미입력 ${blankCount}건</span>` : ''}
                            ${specificCount > 0 ? `<span class="text-[10px] px-1.5 py-0.5 rounded bg-orange-100 text-orange-800 font-bold shrink-0 whitespace-nowrap">특정월 ${specificCount}건</span>` : ''}
                            ${selCount > 0 ? `<span class="text-[10px] px-1.5 py-0.5 rounded bg-orange-500 text-white font-bold shrink-0 whitespace-nowrap">${selCount}건 선택</span>` : ''}
                        </div>
                        <div class="flex items-center gap-2 ml-auto shrink-0">
                            <span class="text-xs font-bold text-gray-800 whitespace-nowrap">예상 ${groupSum.toLocaleString()}원</span>
                            <span class="text-[11px] text-orange-600 font-bold">${isOpen ? '▲' : '▼'}</span>
                        </div>
                    </div>
                    ${bodyHtml}
                </div>`;
        }).join('');

        pendingHtml = `
            <div class="space-y-2.5">
                <div class="flex flex-wrap items-center justify-between gap-2 px-1">
                    <div class="flex items-center gap-2 min-w-0">
                        <span class="text-xs font-bold text-orange-900 whitespace-nowrap">미반영 목록</span>
                        <span class="px-1.5 py-0.5 rounded-full bg-orange-100 text-orange-800 text-[10px] font-bold whitespace-nowrap">${pendingItems.length}건</span>
                        <span class="text-[11px] text-gray-500 truncate">예상 합계 ${pendingTotalSum.toLocaleString()}원</span>
                    </div>
                    <button type="button" onclick="toggleAllAtPendingUserGroups()" class="px-2.5 py-1 bg-white hover:bg-orange-50 border border-orange-200 text-orange-800 rounded-lg text-[11px] font-bold whitespace-nowrap shrink-0">${allPendingOpen ? '모두 접기 ▲' : '모두 펼치기 ▼'}</button>
                </div>
                ${groupCardsHtml}
            </div>`;
    }

    // ---------------------------------------------------------
    // 2) 반영완료 목록 (1단계 접기: 사용자별 접이식 카드 바로 노출 · 기본 접힘)
    // ---------------------------------------------------------
    let appliedHtml = '';
    if (appliedEntries.length > 0) {
        const appliedGroups = groupEntriesByOwner(appliedEntries, entry => entry.sortKey.user);
        const allAppliedOpen = appliedGroups.every(g => !!atAppliedExpandedUsers[g.owner]);
        const appliedSum = appliedEntries.reduce((s, entry) => {
            return s + (entry.isFollowup ? entry.followup.displayAmount : entry.item.displayAmount);
        }, 0);

        const appliedGroupCardsHtml = appliedGroups.map(g => {
            const isOpen = !!atAppliedExpandedUsers[g.owner];
            const escOwner = g.owner.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
            const groupSum = g.items.reduce((s, entry) => {
                return s + (entry.isFollowup ? entry.followup.displayAmount : entry.item.displayAmount);
            }, 0);

            const bodyHtml = isOpen ? `
                <div class="border-t border-gray-200 p-2.5 sm:p-3 space-y-2 bg-gray-50/70">
                    ${g.items.map(entry => {
                        if (entry.isFollowup) {
                            const f = entry.followup;
                            const t = f.tx;
                            const shortOrig = f.originalDate ? f.originalDate.slice(2).replace(/-/g, '.') : '';
                            return `
                                <div class="at-applied-card bg-white p-3 rounded-xl border border-pink-200 flex flex-wrap justify-between items-center gap-2.5 text-xs opacity-90 hover:opacity-100 transition">
                                    <div class="space-y-1 min-w-[200px] flex-1">
                                        <div class="flex items-center gap-1.5 flex-wrap">
                                            <span class="px-2 py-0.5 rounded-lg bg-green-100 text-green-800 font-bold text-[10px]">반영 완료</span>
                                            <span class="font-bold text-gray-800 text-sm">${escHtml(t.memo)}</span>
                                            <span class="text-[10px] px-1.5 py-0.5 rounded bg-pink-100 text-pink-800 font-bold">${f.instIndex}/${f.instMonths}회차</span>
                                            <span class="text-[10px] px-1.5 py-0.5 rounded bg-purple-50 text-purple-700 font-bold">할부 자동반영</span>
                                        </div>
                                        <div class="text-[11px] text-gray-500">
                                            ${f.displayDate} · ${escHtml(t.type)} (${escHtml(t.catMain)}${t.catSub ? '/' + escHtml(t.catSub) : ''}) · ${escHtml(getAssetLabel(t.method))} · 원결제 ${shortOrig}
                                        </div>
                                    </div>
                                    <div class="flex items-center gap-2.5 ml-auto text-right">
                                        <div>
                                            <div class="font-bold text-sm text-gray-800 whitespace-nowrap">${f.displayAmount.toLocaleString()}원</div>
                                            <div class="text-[10px] text-gray-400 whitespace-nowrap">총 ${f.totalAmount.toLocaleString()}원</div>
                                        </div>
                                    </div>
                                </div>`;
                        }

                        const { at, sched, applied, exp, displayAmount, totalAmount, instMonths } = entry.item;
                        const b = getTypeBehavior(at.type);
                        const isTr = (b === 'transfer' || b === 'voucher');
                        const methodText = isTr ? `${getAssetLabel(at.method)} → ${getAssetLabel(at.targetAsset)}` : getAssetLabel(at.method);
                        const badges = buildAtItemBadgesHtml(at, sched, applied, exp, ym);

                        return `
                            <div class="at-applied-card bg-white p-3 rounded-xl border border-gray-200 flex flex-wrap justify-between items-center gap-2.5 text-xs opacity-90 hover:opacity-100 transition">
                                <div class="space-y-1 min-w-[200px] flex-1">
                                    <div class="flex items-center gap-1.5 flex-wrap">
                                        <span class="px-2 py-0.5 rounded-lg bg-green-100 text-green-800 font-bold text-[10px]">반영 완료</span>
                                        <span class="font-bold text-gray-800 text-sm">${escHtml(at.name)}</span>
                                        ${badges}
                                    </div>
                                    <div class="text-[11px] text-gray-500">
                                        ${applied.date} · ${escHtml(at.type)} (${escHtml(at.catMain)}${at.catSub ? '/' + escHtml(at.catSub) : ''}) · ${escHtml(methodText)}
                                    </div>
                                </div>
                                <div class="flex items-center gap-2.5 ml-auto">
                                    <div class="text-right">
                                        <div class="font-bold text-sm text-gray-800 whitespace-nowrap">${displayAmount.toLocaleString()}원</div>
                                        ${instMonths > 1 ? `<div class="text-[10px] text-gray-400 whitespace-nowrap">총 ${totalAmount.toLocaleString()}원</div>` : ''}
                                    </div>
                                    <button onclick="cancelAutoTransferApply('${applied.id}')" class="px-2.5 py-1.5 bg-white border border-red-200 hover:bg-red-50 text-red-600 rounded-xl text-[11px] font-bold whitespace-nowrap">반영 취소</button>
                                </div>
                            </div>`;
                    }).join('')}
                </div>` : '';

            return `
                <div class="bg-white rounded-2xl border border-gray-200 overflow-hidden shadow-sm">
                    <div onclick="toggleAtAppliedUserGroup('${escOwner}')" class="at-applied-header px-3.5 py-3 flex justify-between items-center gap-2 cursor-pointer hover:bg-gray-50 select-none transition">
                        <div class="flex items-center gap-2 min-w-0">
                            ${getOwnerBadgeHtml(g.owner)}
                            <span class="font-bold text-sm text-gray-800 truncate">${escHtml(g.owner)}</span>
                            <span class="text-[11px] px-2 py-0.5 rounded-full bg-green-50 text-green-800 font-bold shrink-0 whitespace-nowrap">${g.items.length}건</span>
                        </div>
                        <div class="flex items-center gap-2 shrink-0">
                            <span class="text-xs font-bold text-gray-700 whitespace-nowrap">합계 ${groupSum.toLocaleString()}원</span>
                            <span class="text-[11px] text-gray-500 font-bold">${isOpen ? '▲' : '▼'}</span>
                        </div>
                    </div>
                    ${bodyHtml}
                </div>`;
        }).join('');

        appliedHtml = `
            <div class="pt-3 border-t border-orange-200 space-y-2.5">
                <div class="flex flex-wrap items-center justify-between gap-2 px-1">
                    <div class="flex items-center gap-2 min-w-0">
                        <span class="px-2 py-0.5 rounded-lg bg-green-100 text-green-800 font-bold text-[11px] shrink-0">반영완료</span>
                        <span class="text-xs font-bold text-gray-700 whitespace-nowrap">${appliedEntries.length}건</span>
                        <span class="text-[11px] text-gray-500 truncate">합계 ${appliedSum.toLocaleString()}원</span>
                    </div>
                    <button type="button" onclick="toggleAllAtAppliedUserGroups()" class="px-2.5 py-1 bg-white hover:bg-gray-50 border border-gray-200 text-gray-700 rounded-lg text-[11px] font-bold whitespace-nowrap shrink-0">${allAppliedOpen ? '모두 접기 ▲' : '모두 펼치기 ▼'}</button>
                </div>
                ${appliedGroupCardsHtml}
            </div>`;
    }

    container.innerHTML = `<div class="space-y-4">${pendingHtml}${appliedHtml}</div>`;

    // 일부만 선택된 사용자 그룹 체크박스의 중간 상태(indeterminate) 반영
    indeterminateUserChkIds.forEach(chkId => {
        const el = document.getElementById(chkId);
        if (el) el.indeterminate = true;
    });
}

function toggleSelectAllAt(checked) {
    const pendingItems = getDueItemsForAtMonth(atYear, atMonth).filter(x => !x.applied);
    if (checked) {
        pendingItems.forEach(x => atSelectedPendingIds.add(x.at.id));
    } else {
        atSelectedPendingIds.clear();
    }
    renderTab4();
}

function pushAutoTransferToTransactions(at, date, amount, ym, overrideInstMonths) {
    const b = getTypeBehavior(at.type);
    const isTr = (b === 'transfer' || b === 'voucher');
    const asset = findAsset(at.method);
    const isCredit = (b === 'expense' && asset && asset.type === '신용카드');
    const instVal = isCredit
        ? (Number(overrideInstMonths) || Number(at.installmentMonths) || 1)
        : 1;

    db.transactions.push({
        id: 'TX_AT_' + Date.now() + '_' + Math.floor(Math.random() * 1000),
        date,
        user: at.user,
        type: at.type,
        catMain: at.catMain,
        catSub: at.catSub || '',
        method: resolveToAssetId(at.method),
        targetAsset: isTr ? resolveToAssetId(at.targetAsset) : '',
        memo: at.name,
        amount,
        installmentMonths: instVal,
        includeInExpense: isTr ? !!at.includeInExpense : false,
        fromAutoTransfer: true,
        autoTransferId: at.id,
        autoTransferYM: ym
    });
}

function resolveExecInputValues(at, ym) {
    const sched = getScheduledDateForAutoItem(at, atYear, atMonth);
    const exp = getExpectedAmountForAutoItem(at, atYear, atMonth);
    const draft = getAtDraftValues(at, sched, exp, ym);

    const dateEl = document.getElementById('atExecDate_' + at.id);
    const amtEl = document.getElementById('atExecAmt_' + at.id);
    const instEl = document.getElementById('atExecInst_' + at.id);

    const date = dateEl ? dateEl.value : draft.date;
    const amount = amtEl ? parseCommaNumber(amtEl.value) : parseCommaNumber(draft.amountStr);
    const instMonths = instEl ? Number(instEl.value) : draft.instMonths;

    return { date, amount, instMonths };
}

function applySingleAutoTransfer(atId) {
    const at = db.autoTransfers.find(a => a.id === atId);
    if (!at) return;
    const ym = formatYM(atYear, atMonth);
    if (findAppliedTxForAutoItem(atId, ym)) return alert('이미 이번 달에 반영된 항목입니다.');

    const { date, amount, instMonths } = resolveExecInputValues(at, ym);

    if (!date) return alert('반영할 날짜를 확인해 주세요.');
    if (amount <= 0) return alert('금액을 1원 이상 입력해 주세요.');

    pushAutoTransferToTransactions(at, date, amount, ym, instMonths);
    atSelectedPendingIds.delete(atId);
    delete atExecDrafts[getAtDraftKey(ym, atId)];
    saveDb();
}

function applySelectedAutoTransfers() {
    if (atSelectedPendingIds.size === 0) return alert('일괄 반영할 항목을 먼저 체크해 주세요.');

    const ym = formatYM(atYear, atMonth);
    let appliedCount = 0;
    const skippedNames = [];

    Array.from(atSelectedPendingIds).forEach(atId => {
        const at = db.autoTransfers.find(a => a.id === atId);
        if (!at || !isAutoItemDueInMonth(at, atYear, atMonth) || !matchesGlobalUser(at.user)) {
            atSelectedPendingIds.delete(atId);
            return;
        }
        if (findAppliedTxForAutoItem(atId, ym)) {
            atSelectedPendingIds.delete(atId);
            return;
        }

        const { date, amount, instMonths } = resolveExecInputValues(at, ym);
        if (!date || amount <= 0) {
            skippedNames.push(at.name);
            return;
        }

        pushAutoTransferToTransactions(at, date, amount, ym, instMonths);
        atSelectedPendingIds.delete(atId);
        delete atExecDrafts[getAtDraftKey(ym, atId)];
        appliedCount++;
    });

    if (appliedCount > 0) saveDb();
    if (skippedNames.length > 0) {
        if (appliedCount > 0) {
            alert(`${appliedCount}건 반영 완료.\n금액이 비어 있는 항목(${skippedNames.join(', ')})은 건너뛰었습니다.`);
        } else {
            alert(`금액이 비어 있는 항목(${skippedNames.join(', ')})은 해당 사용자를 펼쳐 금액을 입력한 뒤 반영해 주세요.`);
        }
    }
}

function cancelAutoTransferApply(txId) {
    const tx = db.transactions.find(t => t.id === txId);
    if (!tx) return;
    const months = Number(tx.installmentMonths) || 1;
    const msg = months > 1
        ? `'${tx.memo}' (${months}개월 할부 · 총 ${Number(tx.amount).toLocaleString()}원) 반영을 취소하고 가계부 내역에서 모든 할부 회차를 삭제하시겠습니까?`
        : `'${tx.memo}' (${Number(tx.amount).toLocaleString()}원) 반영을 취소하고 가계부 내역에서 삭제하시겠습니까?`;
    if (!confirm(msg)) return;
    db.transactions = db.transactions.filter(t => t.id !== txId);
    db.cardEvents = db.cardEvents.filter(e => e.txId !== txId);
    saveDb();
}

// =========================================================
// 정기 항목 등록 · 수정 · 관리 (PC·모바일 아코디언 + 사용자별 그룹 접기/펼치기)
// =========================================================
function openAtFormFromHeader() {
    const secBody = document.getElementById('atMasterSectionBody');
    if (secBody && secBody.classList.contains('hidden')) {
        openCollapsibleSection('atMasterSectionBody', 'atMasterCollapseBtn', '접기 ▲');
        toggleAtForm(true);
    } else {
        toggleAtForm();
    }
}

function toggleAtForm(forceState) {
    atFormOpen = (typeof forceState === 'boolean') ? forceState : !atFormOpen;
    const wrap = document.getElementById('atFormCollapse');
    const btn = document.getElementById('atToggleFormBtn');
    if (wrap) wrap.classList.toggle('hidden', !atFormOpen);
    if (btn) btn.textContent = atFormOpen ? '등록 폼 접기 ▲' : '+ 새 정기 항목';
    if (atFormOpen) syncAtFormOptions();
}

function initAtFormMonthButtons() {
    const wrap = document.getElementById('atSpecificMonthsGrid');
    if (!wrap || wrap.children.length > 0) return;
    let html = '';
    for (let m = 1; m <= 12; m++) {
        html += `<button type="button" onclick="toggleAtSpecificMonth(${m})" id="atMonthBtn_${m}" class="py-1.5 rounded-lg text-xs font-bold border border-gray-200 bg-white text-gray-600 transition">${m}월</button>`;
    }
    wrap.innerHTML = html;

    const daySel = document.getElementById('atDayOfMonth');
    if (daySel && daySel.children.length === 0) {
        for (let d = 1; d <= 31; d++) {
            const opt = document.createElement('option');
            opt.value = d;
            opt.textContent = d === 31 ? '31일 (말일)' : `${d}일`;
            daySel.appendChild(opt);
        }
        daySel.value = 25;
    }

    const instSel = document.getElementById('atInstallmentMonths');
    if (instSel && instSel.children.length === 0) {
        for (let m = 2; m <= 36; m++) {
            const opt = document.createElement('option');
            opt.value = m; opt.textContent = `${m}개월`;
            if (m === 3) opt.selected = true;
            instSel.appendChild(opt);
        }
    }
}

function toggleAtInstallmentMonths(checked) {
    const box = document.getElementById('atInstallmentMonthsBox');
    if (box) box.classList.toggle('hidden', !checked);
}

function toggleAtSpecificMonth(m) {
    if (atSelectedMonths.includes(m)) atSelectedMonths = atSelectedMonths.filter(x => x !== m);
    else atSelectedMonths.push(m);
    atSelectedMonths.sort((a, b) => a - b);
    renderAtSpecificMonthButtons();
}

function renderAtSpecificMonthButtons() {
    for (let m = 1; m <= 12; m++) {
        const btn = document.getElementById('atMonthBtn_' + m);
        if (!btn) continue;
        const active = atSelectedMonths.includes(m);
        btn.className = active
            ? 'py-1.5 rounded-lg text-xs font-bold border border-orange-400 bg-orange-400 text-white shadow-sm transition'
            : 'py-1.5 rounded-lg text-xs font-bold border border-gray-200 bg-white text-gray-600 hover:bg-orange-50 transition';
    }
}

function onAtCycleTypeChange() {
    const isSpec = document.getElementById('atCycleType').value === 'specific';
    document.getElementById('atSpecificMonthsWrap').classList.toggle('hidden', !isSpec);
    if (isSpec) {
        const daySel = document.getElementById('atDayOfMonth');
        if (daySel) daySel.value = '1';
    }
    renderAtSpecificMonthButtons();
}

function onAtAmountTypeChange() {
    const isVar = document.getElementById('atAmountType').value === 'variable';
    document.getElementById('atFixedAmountWrap').classList.toggle('hidden', isVar);
    document.getElementById('atVariableHintBox').classList.toggle('hidden', !isVar);
}

function onAtUserChange() {
    onAtTypeChange(true);
}

function syncAtFormOptions() {
    initAtFormMonthButtons();
    const isEditing = !!document.getElementById('editAtId').value;
    const userSel = document.getElementById('atUser');
    const typeSel = document.getElementById('atType');
    if (!userSel || !typeSel) return;

    const prevUser = userSel.value, prevType = typeSel.value;
    userSel.innerHTML = db.users.map(u => `<option value="${escHtml(u)}">${escHtml(u)}</option>`).join('');
    if (!isEditing) userSel.value = db.users.includes(db.config.defaultUser) ? db.config.defaultUser : db.users[0];
    else if (db.users.includes(prevUser)) userSel.value = prevUser;

    typeSel.innerHTML = db.txTypes.map(t => `<option value="${escHtml(t.name)}">${escHtml(t.name)}</option>`).join('');
    if (!isEditing) {
        typeSel.value = db.txTypes.some(t => t.name === db.config.defaultType) ? db.config.defaultType : (db.txTypes[0]?.name || '');
        if (!document.getElementById('atStartYM').value) {
            document.getElementById('atStartYM').value = formatYM(atYear, atMonth);
        }
    } else if (db.txTypes.some(t => t.name === prevType)) {
        typeSel.value = prevType;
    }
    onAtTypeChange(isEditing);
}

function onAtTypeChange(keepSelection = false) {
    const type = document.getElementById('atType').value;
    const selectedUser = document.getElementById('atUser').value;
    const behavior = getTypeBehavior(type);
    const prevMain = document.getElementById('atCatMain').value;
    const prevSub = document.getElementById('atCatSub').value;

    const mainSel = document.getElementById('atCatMain');
    const mains = Object.keys(db.categories[type] || {});
    mainSel.innerHTML = mains.length ? mains.map(m => `<option value="${escHtml(m)}">${escHtml(m)}</option>`).join('') : '<option value="">카테고리 없음</option>';
    if (keepSelection && mains.includes(prevMain)) mainSel.value = prevMain;
    else if (!keepSelection && mains.includes('주거·공과금')) mainSel.value = '주거·공과금';
    else if (!keepSelection && mains.includes('고정비')) mainSel.value = '고정비';
    updateAtSubCategories(keepSelection ? prevSub : '');

    const isTr = (behavior === 'transfer' || behavior === 'voucher');
    const isExp = (behavior === 'expense');
    document.getElementById('atMethodSingleWrap').classList.toggle('hidden', isTr);
    document.getElementById('atMethodTransferWrap').classList.toggle('hidden', !isTr);

    const incWrap = document.getElementById('atIncludeExpenseWrap');
    if (incWrap) incWrap.classList.toggle('hidden', !isTr);

    const banksAll = db.assets.filter(a => a.group === 'bank' && a.type !== '실물자산');
    const banksNoV = banksAll.filter(a => a.type !== '선불·상품권');
    const vouchers = banksAll.filter(a => a.type === '선불·상품권');
    const cards = db.assets.filter(a => a.group === 'card');
    const minus = db.assets.filter(a => a.group === 'debt' && a.type === '마이너스통장');
    const generalLoans = db.assets.filter(a => a.group === 'debt' && a.type === '일반대출');

    if (isTr) {
        const fromSel = document.getElementById('atFromAccount');
        const toSel = document.getElementById('atToAccount');
        const prevFrom = fromSel.value, prevTo = toSel.value;
        const fromList = sortAssetsForUser([...banksNoV, ...minus], selectedUser);
        const toList = sortAssetsForUser((behavior === 'voucher') ? vouchers : [...banksNoV, ...minus, ...generalLoans], selectedUser);
        fromSel.innerHTML = fromList.map(a => `<option value="${escHtml(a.id)}">${escHtml(getAssetOptionText(a))}</option>`).join('') || '<option value="">계좌 없음</option>';
        toSel.innerHTML = toList.map(a => `<option value="${escHtml(a.id)}">${escHtml(getAssetOptionText(a))}</option>`).join('') || '<option value="">자산 없음</option>';
        if (keepSelection && fromList.some(a => a.id === prevFrom)) fromSel.value = prevFrom;
        if (keepSelection && toList.some(a => a.id === prevTo)) toSel.value = prevTo;

        const instWrap = document.getElementById('atInstallmentWrap');
        const instChk = document.getElementById('atIsInstallment');
        if (instWrap) instWrap.classList.add('hidden');
        if (instChk) instChk.checked = false;
        toggleAtInstallmentMonths(false);
    } else {
        const mSel = document.getElementById('atMethod');
        const prevM = mSel.value;
        document.getElementById('atMethodLabel').textContent = isExp ? '결제수단' : '입금 계좌';
        const list = sortAssetsForUser(isExp ? [...cards, ...banksAll, ...minus] : [...banksAll, ...minus], selectedUser);
        mSel.innerHTML = list.map(a => `<option value="${escHtml(a.id)}">${escHtml(getAssetOptionText(a))}</option>`).join('') || '<option value="">자산 없음</option>';
        if (keepSelection && list.some(a => a.id === prevM)) mSel.value = prevM;
        onAtMethodChange();
    }
}

function updateAtSubCategories(preselect = '') {
    const type = document.getElementById('atType').value;
    const main = document.getElementById('atCatMain').value;
    const subSel = document.getElementById('atCatSub');
    const subs = (db.categories[type] && db.categories[type][main]) || [];
    subSel.innerHTML = '<option value="">(선택 안 함)</option>' + subs.map(s => `<option value="${escHtml(s)}">${escHtml(s)}</option>`).join('');
    if (preselect && subs.includes(preselect)) subSel.value = preselect;
}

function onAtMethodChange() {
    const isExp = getTypeBehavior(document.getElementById('atType').value) === 'expense';
    const asset = findAsset(document.getElementById('atMethod').value);
    const isCredit = isExp && asset && asset.type === '신용카드';
    const wrap = document.getElementById('atInstallmentWrap');
    const chk = document.getElementById('atIsInstallment');
    if (wrap) wrap.classList.toggle('hidden', !isCredit);
    if (!isCredit) {
        if (chk) chk.checked = false;
        toggleAtInstallmentMonths(false);
    }
}

function handleAtSubmit(e) {
    e.preventDefault();
    const editId = document.getElementById('editAtId').value;
    const name = document.getElementById('atName').value.trim();
    const user = document.getElementById('atUser').value;
    const type = document.getElementById('atType').value;
    const behavior = getTypeBehavior(type);
    const catMain = document.getElementById('atCatMain').value;
    const catSub = document.getElementById('atCatSub').value;
    const cycleType = document.getElementById('atCycleType').value;
    const dayOfMonth = Number(document.getElementById('atDayOfMonth').value) || 1;
    const shiftBusinessDay = document.getElementById('atShiftBusinessDay').checked;
    const amountType = document.getElementById('atAmountType').value;
    const amount = amountType === 'fixed' ? parseCommaNumber(document.getElementById('atAmount').value) : 0;
    const startYM = document.getElementById('atStartYM').value || formatYM(atYear, atMonth);
    const endYM = document.getElementById('atEndYM').value || '';

    if (!name) return alert('항목 이름을 입력해 주세요.');
    if (cycleType === 'specific' && atSelectedMonths.length === 0) return alert('납부할 특정 월을 1개 이상 선택해 주세요.');
    if (amountType === 'fixed' && amount <= 0) return alert('고정 금액은 1원 이상 입력해 주세요.');
    if (endYM && endYM < startYM) return alert('종료월은 시작월보다 같거나 이후여야 합니다.');

    const isTr = (behavior === 'transfer' || behavior === 'voucher');
    const includeInExpense = isTr ? !!document.getElementById('atIncludeInExpense')?.checked : false;
    let method = '', targetAsset = '', installmentMonths = 1;
    if (isTr) {
        method = document.getElementById('atFromAccount').value;
        targetAsset = document.getElementById('atToAccount').value;
        if (!method || !targetAsset || method === targetAsset) return alert('출금 계좌와 입금 자산을 서로 다르게 선택해 주세요.');
    } else {
        method = document.getElementById('atMethod').value;
        if (!method) return alert('결제수단 또는 계좌를 선택해 주세요.');
        const asset = findAsset(method);
        const isInstChecked = !!document.getElementById('atIsInstallment')?.checked;
        if (behavior === 'expense' && asset && asset.type === '신용카드' && isInstChecked) {
            installmentMonths = Number(document.getElementById('atInstallmentMonths').value) || 2;
        }
    }

    const payload = {
        id: editId || ('AT_' + Date.now()),
        name, user, type, catMain, catSub, method, targetAsset, installmentMonths,
        includeInExpense,
        cycleType, months: cycleType === 'specific' ? [...atSelectedMonths] : [],
        dayOfMonth, shiftBusinessDay, amountType, amount, startYM, endYM,
        active: true
    };

    if (editId) {
        const idx = db.autoTransfers.findIndex(a => a.id === editId);
        if (idx > -1) {
            payload.active = db.autoTransfers[idx].active !== false;
            db.autoTransfers[idx] = payload;
        }
        // 이미 가계부에 반영된 이 항목의 거래내역에도 지출 분석 포함 여부를 즉시 동기화
        db.transactions.forEach(t => {
            if (t.autoTransferId === editId) {
                t.includeInExpense = includeInExpense;
            }
        });
        // 수정된 금액·날짜·할부 기본값이 미반영 목록에 바로 반영되도록 이전 임시 입력값 정리
        clearAtDraftsForItem(editId);
    } else {
        db.autoTransfers.push(payload);
    }

    atMasterExpandedUsers[user] = true;
    resetAtForm();
    toggleAtForm(false);
    saveDb();
}

function startEditAt(id) {
    const at = db.autoTransfers.find(a => a.id === id);
    if (!at) return;
    openCollapsibleSection('atMasterSectionBody', 'atMasterCollapseBtn', '접기 ▲');
    toggleAtForm(true);

    document.getElementById('editAtId').value = at.id;
    document.getElementById('atFormTitle').textContent = `[${at.name}] 정기 항목 수정 중`;
    document.getElementById('atSubmitBtn').textContent = '수정 내용 저장';
    document.getElementById('atCancelEditBtn').classList.remove('hidden');

    document.getElementById('atName').value = at.name;
    document.getElementById('atUser').value = at.user;
    document.getElementById('atType').value = at.type;
    onAtTypeChange(false);
    document.getElementById('atCatMain').value = at.catMain;
    updateAtSubCategories(at.catSub);

    const b = getTypeBehavior(at.type);
    const incChk = document.getElementById('atIncludeInExpense');
    if (b === 'transfer' || b === 'voucher') {
        document.getElementById('atFromAccount').value = resolveToAssetId(at.method);
        document.getElementById('atToAccount').value = resolveToAssetId(at.targetAsset);
        if (incChk) incChk.checked = !!at.includeInExpense;
    } else {
        if (incChk) incChk.checked = false;
        document.getElementById('atMethod').value = resolveToAssetId(at.method);
        onAtMethodChange();
        const months = Number(at.installmentMonths) || 1;
        const isInst = months > 1;
        const instChk = document.getElementById('atIsInstallment');
        if (instChk) instChk.checked = isInst;
        toggleAtInstallmentMonths(isInst);
        if (isInst) document.getElementById('atInstallmentMonths').value = months;
    }

    document.getElementById('atCycleType').value = at.cycleType || 'monthly';
    atSelectedMonths = Array.isArray(at.months) ? [...at.months] : [];
    onAtCycleTypeChange();
    document.getElementById('atDayOfMonth').value = at.dayOfMonth || 25;
    document.getElementById('atShiftBusinessDay').checked = !!at.shiftBusinessDay;
    document.getElementById('atAmountType').value = at.amountType || 'fixed';
    onAtAmountTypeChange();
    document.getElementById('atAmount').value = formatNumberToInput(at.amount);
    document.getElementById('atStartYM').value = at.startYM || formatYM(atYear, atMonth);
    document.getElementById('atEndYM').value = at.endYM || '';

    const formWrap = document.getElementById('atFormCollapse');
    if (formWrap) formWrap.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function resetAtForm() {
    document.getElementById('editAtId').value = '';
    document.getElementById('atFormTitle').textContent = '새 정기 항목 등록';
    document.getElementById('atSubmitBtn').textContent = '정기 항목 저장';
    document.getElementById('atCancelEditBtn').classList.add('hidden');
    document.getElementById('atName').value = '';
    document.getElementById('atCycleType').value = 'monthly';
    atSelectedMonths = [];
    onAtCycleTypeChange();
    document.getElementById('atDayOfMonth').value = '25';
    document.getElementById('atShiftBusinessDay').checked = true;
    document.getElementById('atAmountType').value = 'fixed';
    onAtAmountTypeChange();
    document.getElementById('atAmount').value = '';
    document.getElementById('atStartYM').value = formatYM(atYear, atMonth);
    document.getElementById('atEndYM').value = '';

    const incChk = document.getElementById('atIncludeInExpense');
    if (incChk) incChk.checked = false;
    const instChk = document.getElementById('atIsInstallment');
    if (instChk) instChk.checked = false;
    toggleAtInstallmentMonths(false);
    const instSel = document.getElementById('atInstallmentMonths');
    if (instSel) instSel.value = '3';
    syncAtFormOptions();
}

function toggleAtActive(id) {
    const at = db.autoTransfers.find(a => a.id === id);
    if (!at) return;
    at.active = (at.active === false);
    saveDb();
}

function deleteAt(id) {
    const at = db.autoTransfers.find(a => a.id === id);
    if (!at) return;
    if (confirm(`'${at.name}' 정기 항목을 삭제하시겠습니까?\n(이미 가계부에 반영된 과거 내역은 삭제되지 않고 유지됩니다.)`)) {
        db.autoTransfers = db.autoTransfers.filter(a => a.id !== id);
        atSelectedPendingIds.delete(id);
        clearAtDraftsForItem(id);
        saveDb();
    }
}

function getFilteredAtMasterList() {
    const nowYM = formatYM(todayObj.getFullYear(), todayObj.getMonth() + 1);
    const allUserItems = (db.autoTransfers || []).filter(at => matchesGlobalUser(at.user));
    let list = allUserItems.filter(at => {
        const isEnded = !!(at.endYM && at.endYM < nowYM);
        const isPaused = (at.active === false);
        if (atMasterFilter === 'active') return !isPaused && !isEnded;
        if (atMasterFilter === 'paused') return isPaused;
        if (atMasterFilter === 'ended') return isEnded;
        return true;
    });
    list.sort(compareAutoTransferItems);
    return { allUserItems, list, nowYM };
}

function groupAutoItemsByOwner(sortedList) {
    return groupEntriesByOwner(sortedList, item => item.user);
}

function toggleAtMasterUserGroup(owner) {
    atMasterExpandedUsers[owner] = !atMasterExpandedUsers[owner];
    renderAtMasterList();
}

function toggleAllAtMasterUserGroups() {
    const { list } = getFilteredAtMasterList();
    const groups = groupAutoItemsByOwner(list);
    if (groups.length === 0) return;
    const allOpen = groups.every(g => !!atMasterExpandedUsers[g.owner]);
    groups.forEach(g => { atMasterExpandedUsers[g.owner] = !allOpen; });
    renderAtMasterList();
}

function renderAtMasterList() {
    const groupedWrap = document.getElementById('atMasterGroupedList');
    const toggleAllBtn = document.getElementById('atMasterToggleAllBtn');
    if (!groupedWrap) return;

    const { allUserItems, list, nowYM } = getFilteredAtMasterList();
    const badgeEl = document.getElementById('atMasterTotalBadge');
    if (badgeEl) badgeEl.textContent = `${allUserItems.length}건`;

    const groups = groupAutoItemsByOwner(list);
    if (groups.length === 0) {
        if (toggleAllBtn) toggleAllBtn.classList.add('hidden');
        groupedWrap.innerHTML = `<div class="bg-gray-50 p-6 rounded-2xl border border-gray-200 text-center text-xs text-gray-400">해당 조건의 정기 항목이 없습니다.</div>`;
        return;
    }

    if (toggleAllBtn) {
        toggleAllBtn.classList.remove('hidden');
        const allOpen = groups.every(g => !!atMasterExpandedUsers[g.owner]);
        toggleAllBtn.textContent = allOpen ? '모두 접기' : '모두 펼치기';
    }

    groupedWrap.innerHTML = groups.map(g => {
        const isOpen = !!atMasterExpandedUsers[g.owner];
        const escOwner = g.owner.replace(/\\/g, '\\\\').replace(/'/g, "\\'");

        const expCnt = g.items.filter(x => getTypeBehavior(x.type) === 'expense').length;
        const trCnt = g.items.filter(x => {
            const b = getTypeBehavior(x.type);
            return b === 'transfer' || b === 'voucher';
        }).length;
        const incCnt = g.items.filter(x => getTypeBehavior(x.type) === 'income').length;
        const summaryParts = [];
        if (expCnt > 0) summaryParts.push(`지출 ${expCnt}`);
        if (trCnt > 0) summaryParts.push(`이체 ${trCnt}`);
        if (incCnt > 0) summaryParts.push(`수입 ${incCnt}`);
        const summaryText = summaryParts.join(' · ');

        const bodyHtml = isOpen ? `
            <div class="hidden md:block border-t border-gray-200 overflow-x-auto">
                <table class="w-full text-left border-collapse text-xs">
                    <thead class="bg-gray-50 text-gray-500 border-b border-gray-200">
                        <tr>
                            <th class="py-2.5 px-3">상태</th>
                            <th class="py-2.5 px-3">항목 / 분류</th>
                            <th class="py-2.5 px-3">주기 / 기간</th>
                            <th class="py-2.5 px-3">결제수단 / 계좌</th>
                            <th class="py-2.5 px-3 text-right">금액 기준</th>
                            <th class="py-2.5 px-3 text-center">관리</th>
                        </tr>
                    </thead>
                    <tbody class="divide-y divide-gray-100">
                        ${g.items.map(at => {
                            const isEnded = !!(at.endYM && at.endYM < nowYM);
                            const isPaused = (at.active === false);
                            const b = getTypeBehavior(at.type);
                            const isTr = (b === 'transfer' || b === 'voucher');
                            const methodDisplay = isTr ? `${getAssetLabel(at.method)} → ${getAssetLabel(at.targetAsset)}` : getAssetLabel(at.method);
                            const cycleLabel = at.cycleType === 'specific'
                                ? `${(at.months || []).map(m => m + '월').join(', ')} (${at.dayOfMonth}일)`
                                : `매월 ${at.dayOfMonth === 31 ? '말일' : at.dayOfMonth + '일'}`;
                            const statusBadge = isEnded
                                ? `<span class="px-1.5 py-0.5 rounded bg-gray-200 text-gray-600 font-bold text-[10px]">종료됨</span>`
                                : (isPaused
                                    ? `<span class="px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 font-bold text-[10px]">일시중지</span>`
                                    : `<span class="px-1.5 py-0.5 rounded bg-green-100 text-green-800 font-bold text-[10px]">사용 중</span>`);
                            const incBadge = (isTr && at.includeInExpense)
                                ? `<span class="text-[10px] px-1.5 py-0.5 rounded bg-purple-100 text-purple-700 font-bold">고정비 포함</span>` : '';

                            return `
                                <tr class="hover:bg-orange-50/30 ${isPaused || isEnded ? 'opacity-60' : ''}">
                                    <td class="py-2.5 px-3 whitespace-nowrap">${statusBadge}</td>
                                    <td class="py-2.5 px-3">
                                        <div class="flex items-center gap-1.5 flex-wrap">
                                            <span class="font-bold text-gray-800">${escHtml(at.name)}</span>
                                            ${Number(at.installmentMonths) > 1 ? `<span class="text-[10px] px-1 rounded bg-pink-100 text-pink-800 font-bold">${at.installmentMonths}개월</span>` : ''}
                                            ${incBadge}
                                        </div>
                                        <div class="text-[10px] text-gray-400 mt-0.5">${escHtml(at.type)} (${escHtml(at.catMain)}${at.catSub ? '/' + escHtml(at.catSub) : ''})</div>
                                    </td>
                                    <td class="py-2.5 px-3 text-gray-600 whitespace-nowrap">
                                        <div>${cycleLabel}</div>
                                        <div class="text-[10px] text-gray-400">${at.startYM || '-'} ~ ${at.endYM || '무기한'}${at.shiftBusinessDay ? ' · 영업일' : ''}</div>
                                    </td>
                                    <td class="py-2.5 px-3 text-gray-600 whitespace-nowrap">${escHtml(methodDisplay)}</td>
                                    <td class="py-2.5 px-3 text-right font-bold whitespace-nowrap">
                                        ${at.amountType === 'variable' ? `<span class="text-purple-700">변동 (전년동월)</span>` : `${Number(at.amount).toLocaleString()}원`}
                                    </td>
                                    <td class="py-2.5 px-3 text-center whitespace-nowrap space-x-1">
                                        <button onclick="toggleAtActive('${at.id}')" class="px-2 py-0.5 bg-amber-50 hover:bg-amber-100 rounded text-amber-800 font-bold">${isPaused ? '재개' : '중지'}</button>
                                        <button onclick="startEditAt('${at.id}')" class="px-2 py-0.5 bg-gray-100 hover:bg-gray-200 rounded text-gray-700 font-bold">수정</button>
                                        <button onclick="deleteAt('${at.id}')" class="px-2 py-0.5 bg-red-50 hover:bg-red-100 rounded text-red-600 font-bold">삭제</button>
                                    </td>
                                </tr>`;
                        }).join('')}
                    </tbody>
                </table>
            </div>
            <div class="md:hidden border-t border-gray-200 p-3 space-y-2 bg-gray-50">
                ${g.items.map(at => {
                    const isEnded = !!(at.endYM && at.endYM < nowYM);
                    const isPaused = (at.active === false);
                    const b = getTypeBehavior(at.type);
                    const isTr = (b === 'transfer' || b === 'voucher');
                    const methodDisplay = isTr ? `${getAssetLabel(at.method)} → ${getAssetLabel(at.targetAsset)}` : getAssetLabel(at.method);
                    const cycleLabel = at.cycleType === 'specific'
                        ? `${(at.months || []).map(m => m + '월').join(', ')} (${at.dayOfMonth}일)`
                        : `매월 ${at.dayOfMonth === 31 ? '말일' : at.dayOfMonth + '일'}`;
                    const statusBadge = isEnded
                        ? `<span class="px-1.5 py-0.5 rounded bg-gray-200 text-gray-600 font-bold text-[10px] shrink-0 whitespace-nowrap">종료됨</span>`
                        : (isPaused
                            ? `<span class="px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 font-bold text-[10px] shrink-0 whitespace-nowrap">일시중지</span>`
                            : `<span class="px-1.5 py-0.5 rounded bg-green-100 text-green-800 font-bold text-[10px] shrink-0 whitespace-nowrap">사용 중</span>`);
                    const incBadge = (isTr && at.includeInExpense)
                        ? `<span class="text-[10px] px-1.5 py-0.5 rounded bg-purple-100 text-purple-700 font-bold whitespace-nowrap">고정비 포함</span>` : '';
                    const amtHtml = at.amountType === 'variable'
                        ? `<span class="text-purple-700 font-bold text-xs whitespace-nowrap">변동 (전년동월)</span>`
                        : `<span class="font-bold text-sm text-gray-800 whitespace-nowrap">${Number(at.amount).toLocaleString()}원</span>`;

                    return `
                        <div class="bg-white p-3.5 rounded-2xl border border-gray-200 space-y-2 text-xs ${isPaused || isEnded ? 'opacity-60' : ''}">
                            <div class="flex justify-between items-start gap-2">
                                <div class="flex items-center gap-1.5 min-w-0 flex-wrap">
                                    ${statusBadge}
                                    <span class="font-bold text-sm text-gray-800 truncate">${escHtml(at.name)}</span>
                                    ${Number(at.installmentMonths) > 1 ? `<span class="text-[10px] px-1.5 py-0.5 rounded bg-pink-100 text-pink-800 font-bold whitespace-nowrap">${at.installmentMonths}개월</span>` : ''}
                                    ${incBadge}
                                </div>
                                <div class="shrink-0">${amtHtml}</div>
                            </div>
                            <div class="text-[11px] text-gray-500 space-y-0.5">
                                <div>${escHtml(at.type)} (${escHtml(at.catMain)}${at.catSub ? '/' + escHtml(at.catSub) : ''})</div>
                                <div><b class="text-gray-700">${cycleLabel}</b> · ${at.startYM || '-'} ~ ${at.endYM || '무기한'}${at.shiftBusinessDay ? ' · 영업일' : ''}</div>
                                <div class="truncate">수단: ${escHtml(methodDisplay)}</div>
                            </div>
                            <div class="flex justify-end gap-1.5 pt-2 border-t border-gray-100">
                                <button onclick="toggleAtActive('${at.id}')" class="px-2.5 py-1 bg-amber-50 hover:bg-amber-100 rounded-lg text-amber-800 font-bold text-[11px] whitespace-nowrap">${isPaused ? '재개' : '중지'}</button>
                                <button onclick="startEditAt('${at.id}')" class="px-2.5 py-1 bg-gray-100 hover:bg-gray-200 rounded-lg text-gray-700 font-bold text-[11px] whitespace-nowrap">수정</button>
                                <button onclick="deleteAt('${at.id}')" class="px-2.5 py-1 bg-red-50 hover:bg-red-100 rounded-lg text-red-600 font-bold text-[11px] whitespace-nowrap">삭제</button>
                            </div>
                        </div>`;
                }).join('')}
            </div>` : '';

        return `
            <div class="bg-white rounded-2xl border border-gray-200 overflow-hidden shadow-sm">
                <div onclick="toggleAtMasterUserGroup('${escOwner}')" class="px-4 py-3 flex justify-between items-center gap-2 cursor-pointer hover:bg-gray-50 select-none">
                    <div class="flex items-center gap-2 min-w-0">
                        ${getOwnerBadgeHtml(g.owner)}
                        <span class="font-bold text-sm text-gray-800 truncate">${escHtml(g.owner)}</span>
                        <span class="text-[11px] px-2 py-0.5 rounded-full bg-orange-50 text-orange-800 font-bold shrink-0">${g.items.length}건</span>
                    </div>
                    <div class="flex items-center gap-2 shrink-0">
                        <span class="text-[11px] text-gray-500 font-bold whitespace-nowrap">${summaryText}</span>
                        <span class="text-[11px] text-gray-500 font-bold">${isOpen ? '▲' : '▼'}</span>
                    </div>
                </div>
                ${bodyHtml}
            </div>`;
    }).join('');
}