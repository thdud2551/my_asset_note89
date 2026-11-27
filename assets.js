// =========================================================
// [5. 자산 현황] 전용 모듈 (5개 자산 그룹 · 마통 자동전환 · 카드 일시불/할부 분리 관리)
// =========================================================
let asset5TrendMode = '6m'; // '6m' | 'year'
let asset5ExpandedBank = {}; // key: 'cash' | 'voucher' | 'saving' | 'invest' | 'real'
let asset5ExpandedDebt = {}; // key: 'loan' | 'card' | 'installment'

const ASSET_GROUP_META = {
    cash:    { label: '입출금·현금', short: '입출금·현금', color: '#74C0FC', types: ['입출금통장', '현금', '마이너스통장'] },
    voucher: { label: '선불·상품권', short: '선불·상품권', color: '#FFA94D', types: ['선불·상품권'] },
    saving:  { label: '예·적금', short: '예·적금', color: '#63E6BE', types: ['예·적금'] },
    invest:  { label: '투자 (주식·펀드·연금)', short: '투자', color: '#B197FC', types: ['투자'] },
    real:    { label: '실물자산 (부동산·보증금)', short: '실물자산', color: '#FFD43B', types: ['실물자산'] }
};
const ASSET_GROUP_ORDER = ['cash', 'voucher', 'saving', 'invest', 'real'];

function formatManWonRounded(amt) {
    const man = Math.round((Number(amt) || 0) / 10000);
    if (man === 0) return '0';
    return `${man.toLocaleString()}만`;
}

function getAssetFirstRecordYM(curYM) {
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
    if (!minYM || minYM > curYM) return curYM;
    return minYM;
}

// 특정 시점 기준 진행 중인 신용카드 할부 내역 및 회차별 상태 계산
function computeActiveInstallmentsAsOf(asOfDate, isLiveSnapshot) {
    const events = (db.cardEvents || []).filter(ev => {
        if (!ev.date) return false;
        if (ev.date > asOfDate && !isLiveSnapshot) return false;
        return true;
    });

    const items = [];
    const cardRemainMap = {};

    (db.transactions || []).forEach(t => {
        if (!t.date || t.date > asOfDate) return;
        if (getTypeBehavior(t.type) !== 'expense') return;
        const months = Number(t.installmentMonths) || 1;
        if (months <= 1) return;

        const card = findAsset(t.method);
        if (!card || card.group !== 'card' || card.type !== '신용카드') return;

        const totalAmt = Number(t.amount) || 0;
        if (totalAmt <= 0) return;

        const firstBill = findFirstBillingYMForTx(card, t.date);
        const base = Math.floor(totalAmt / months);
        const rem = totalAmt - (base * months);

        const schedule = [];
        let paidCount = 0;
        let remainCount = 0;
        let remainAmount = 0;
        let nextBillYM = '';
        let lastBillYM = '';

        for (let idx = 1; idx <= months; idx++) {
            const bm = addMonthToYM(firstBill.y, firstBill.m, idx - 1);
            const ym = formatYM(bm.y, bm.m);
            const instAmt = (idx === 1) ? (base + rem) : base;

            const prepaidEv = events.find(e =>
                e.type === 'prepay_item' &&
                e.txId === t.id &&
                (e.installmentIndex === idx || (Array.isArray(e.prepaidIndices) && e.prepaidIndices.includes(idx)))
            );
            const settledEv = events.find(e =>
                e.type === 'settlement' &&
                isCardEventMatch(e, card) &&
                e.billingYM === ym
            );

            let status = 'pending';
            if (prepaidEv) status = 'prepaid';
            else if (settledEv) status = 'settled';

            if (status === 'pending') {
                remainCount++;
                remainAmount += instAmt;
                if (!nextBillYM) nextBillYM = ym;
            } else {
                paidCount++;
            }
            lastBillYM = ym;
            schedule.push({ idx, ym, amount: instAmt, status });
        }

        if (remainCount > 0 && remainAmount > 0) {
            cardRemainMap[card.id] = (cardRemainMap[card.id] || 0) + remainAmount;
            const nextPending = schedule.find(s => s.status === 'pending');
            items.push({
                tx: t,
                card,
                months,
                totalAmount: totalAmt,
                monthlyAmount: nextPending ? nextPending.amount : base,
                paidCount,
                remainCount,
                remainAmount,
                nextBillYM,
                lastBillYM,
                schedule
            });
        }
    });

    items.sort((a, b) =>
        (getOwnerRank(a.card.owner) - getOwnerRank(b.card.owner)) ||
        a.lastBillYM.localeCompare(b.lastBillYM) ||
        compareKorean(a.card.name, b.card.name) ||
        compareKorean(a.tx.memo, b.tx.memo)
    );

    return { items, cardRemainMap };
}

function computeAssetSnapshotAsOf(asOfDate) {
    const todayStr = formatYMD(new Date());
    const isLiveSnapshot = (asOfDate >= todayStr);

    const bankCostMap = {};
    const debtBalMap = {};
    const cardUnpaidMap = {};

    (db.assets || []).forEach(a => {
        if (a.group === 'bank') {
            bankCostMap[a.id] = Number(a.initBalance) || 0;
        } else if (a.group === 'debt') {
            debtBalMap[a.id] = Number(a.initBalance) || 0;
        } else if (a.group === 'card' && a.type === '신용카드') {
            cardUnpaidMap[a.id] = Number(a.revolving) || 0;
        }
    });

    const getChkLinkedId = (id) => {
        const a = findAsset(id);
        return (a && a.type === '체크카드') ? (resolveToAssetId(a.linkedAccount) || a.id) : null;
    };

    const applyAccountDelta = (accId, delta) => {
        if (!accId || !delta) return;
        const a = findAsset(accId);
        if (!a) return;
        if (a.group === 'bank') {
            bankCostMap[a.id] = (bankCostMap[a.id] || 0) + delta;
        } else if (a.group === 'debt') {
            if (a.type === '마이너스통장') {
                debtBalMap[a.id] = (debtBalMap[a.id] || 0) - delta;
            } else {
                debtBalMap[a.id] = Math.max(0, (debtBalMap[a.id] || 0) - delta);
            }
        }
    };

    (db.transactions || []).forEach(t => {
        if (!t.date || t.date > asOfDate) return;
        const b = getTypeBehavior(t.type);
        const amt = Number(t.amount) || 0;
        if (amt <= 0) return;

        const mId = resolveToAssetId(t.method);
        const toId = resolveToAssetId(t.targetAsset);
        const mAsset = findAsset(mId);

        if (b === 'income') {
            applyAccountDelta(mId, amt);
        } else if (b === 'expense') {
            if (mAsset && mAsset.group === 'card' && mAsset.type === '신용카드') {
                cardUnpaidMap[mAsset.id] = (cardUnpaidMap[mAsset.id] || 0) + amt;
            } else {
                const chkLinked = getChkLinkedId(mId);
                applyAccountDelta(chkLinked || mId, -amt);
            }
        } else if (b === 'transfer' || b === 'voucher') {
            applyAccountDelta(mId, -amt);
            applyAccountDelta(toId, amt);
        }
    });

    (db.cardEvents || []).forEach(ev => {
        if (!ev.date) return;
        const isFutureEvent = ev.date > asOfDate;
        if (isFutureEvent && !isLiveSnapshot) return;

        const fromId = resolveToAssetId(ev.fromAccount);
        const card = findAsset(ev.cardId || ev.cardName);

        if (ev.type === 'settlement') {
            const actualAmt = Number(ev.actualAmount) || 0;
            const expectedAmt = Number(ev.expectedAmount) || 0;
            if (!isFutureEvent) {
                applyAccountDelta(fromId, -actualAmt);
            }
            if (card && card.type === '신용카드') {
                const revAmt = Number(ev.revolvingAmount) || 0;
                const cleared = Math.max(0, expectedAmt - revAmt);
                cardUnpaidMap[card.id] = Math.max(0, (cardUnpaidMap[card.id] || 0) - cleared);
            }
        } else if (ev.type === 'prepay_item' || ev.type === 'prepay_amount') {
            const amt = Number(ev.amount) || 0;
            if (!isFutureEvent) {
                applyAccountDelta(fromId, -amt);
            }
            if (card && card.type === '신용카드') {
                cardUnpaidMap[card.id] = Math.max(0, (cardUnpaidMap[card.id] || 0) - amt);
            }
        }
    });

    const instSummary = computeActiveInstallmentsAsOf(asOfDate, isLiveSnapshot);

    const sortByOwnerTypeName = (x, y) =>
        (getOwnerRank(x.asset.owner) - getOwnerRank(y.asset.owner)) ||
        (getAssetTypeRank(x.asset.type) - getAssetTypeRank(y.asset.type)) ||
        compareKorean(x.asset.name, y.asset.name);

    const bankItems = [];
    const debtItems = [];
    const cardDebtItems = [];

    let totalAssets = 0;
    let totalDebts = 0;
    const groupTotals = { cash: 0, voucher: 0, saving: 0, invest: 0, real: 0 };

    (db.assets || []).forEach(a => {
        if (!matchesGlobalUser(a.owner)) return;
        if (a.group === 'bank') {
            const costBasis = bankCostMap[a.id] || 0;
            const isValuable = (a.type === '투자' || a.type === '실물자산');
            const valOffset = isValuable ? (Number(a.valuationOffset) || 0) : 0;
            const currentVal = costBasis + valOffset;
            totalAssets += currentVal;

            let gKey = 'cash';
            if (a.type === '선불·상품권') gKey = 'voucher';
            else if (a.type === '예·적금') gKey = 'saving';
            else if (a.type === '투자') gKey = 'invest';
            else if (a.type === '실물자산') gKey = 'real';
            groupTotals[gKey] += Math.max(0, currentVal);

            bankItems.push({ asset: a, groupKey: gKey, costBasis, valOffset, currentVal, isMinusSurplus: false });
        } else if (a.group === 'debt') {
            const bal = debtBalMap[a.id] || 0;
            if (a.type === '마이너스통장' && bal < 0) {
                const surplusVal = -bal;
                totalAssets += surplusVal;
                groupTotals.cash += surplusVal;
                bankItems.push({
                    asset: a,
                    groupKey: 'cash',
                    costBasis: surplusVal,
                    valOffset: 0,
                    currentVal: surplusVal,
                    isMinusSurplus: true
                });
            } else {
                const debtVal = Math.max(0, bal);
                totalDebts += debtVal;
                debtItems.push({ asset: a, balance: debtVal });
            }
        } else if (a.group === 'card' && a.type === '신용카드') {
            const totalUnpaid = Math.max(0, cardUnpaidMap[a.id] || 0);
            const instRemain = instSummary.cardRemainMap[a.id] || 0;
            const lumpSumUnpaid = Math.max(0, totalUnpaid - instRemain);
            totalDebts += totalUnpaid;
            cardDebtItems.push({ asset: a, unpaid: totalUnpaid, lumpSumUnpaid, instRemain });
        }
    });

    const installmentItems = instSummary.items.filter(it => matchesGlobalUser(it.card.owner));

    bankItems.sort(sortByOwnerTypeName);
    debtItems.sort(sortByOwnerTypeName);
    cardDebtItems.sort(sortByOwnerTypeName);

    return {
        totalAssets,
        totalDebts,
        netWorth: totalAssets - totalDebts,
        groupTotals,
        bankItems,
        debtItems,
        cardDebtItems,
        installmentItems
    };
}

// =========================================================
// [5. 자산 현황] 화면 렌더링 & 아코디언 토글
// =========================================================
function toggleAsset5BankGroup(gKey) {
    asset5ExpandedBank[gKey] = !asset5ExpandedBank[gKey];
    renderTab5();
}

function toggleAllAsset5BankGroups() {
    const snap = computeAssetSnapshotAsOf(formatYMD(new Date()));
    const presentKeys = ASSET_GROUP_ORDER.filter(k => snap.bankItems.some(it => it.groupKey === k));
    const allOpen = presentKeys.length > 0 && presentKeys.every(k => !!asset5ExpandedBank[k]);
    presentKeys.forEach(k => { asset5ExpandedBank[k] = !allOpen; });
    renderTab5();
}

function toggleAsset5DebtGroup(dKey) {
    asset5ExpandedDebt[dKey] = !asset5ExpandedDebt[dKey];
    renderTab5();
}

function toggleAllAsset5DebtGroups() {
    const snap = computeAssetSnapshotAsOf(formatYMD(new Date()));
    const presentKeys = [];
    if (snap.debtItems.length > 0) presentKeys.push('loan');
    if (snap.cardDebtItems.length > 0) presentKeys.push('card');
    if (snap.installmentItems.length > 0) presentKeys.push('installment');
    const allOpen = presentKeys.length > 0 && presentKeys.every(k => !!asset5ExpandedDebt[k]);
    presentKeys.forEach(k => { asset5ExpandedDebt[k] = !allOpen; });
    renderTab5();
}

function setAsset5TrendMode(mode) {
    asset5TrendMode = mode;
    const b6 = document.getElementById('asset5Trend6m');
    const by = document.getElementById('asset5TrendYear');
    if (b6) b6.className = mode === '6m' ? "px-3 py-1 text-xs font-bold rounded-lg bg-white text-gray-800 shadow-sm whitespace-nowrap" : "px-3 py-1 text-xs font-bold rounded-lg text-gray-500 whitespace-nowrap";
    if (by) by.className = mode === 'year' ? "px-3 py-1 text-xs font-bold rounded-lg bg-white text-gray-800 shadow-sm whitespace-nowrap" : "px-3 py-1 text-xs font-bold rounded-lg text-gray-500 whitespace-nowrap";
    renderAsset5TrendChart();
}

function renderTab5() {
    if (!document.getElementById('asset5TotalAssets')) return;
    const todayStr = formatYMD(new Date());
    const snap = computeAssetSnapshotAsOf(todayStr);

    const prevYM = addMonthToYM(todayObj.getFullYear(), todayObj.getMonth() + 1, -1);
    const prevEndDay = new Date(prevYM.y, prevYM.m, 0).getDate();
    const prevEndStr = `${prevYM.y}-${String(prevYM.m).padStart(2, '0')}-${String(prevEndDay).padStart(2, '0')}`;
    const prevSnap = computeAssetSnapshotAsOf(prevEndStr);
    const netDiff = snap.netWorth - prevSnap.netWorth;

    document.getElementById('asset5TotalAssets').textContent = `${snap.totalAssets.toLocaleString()}원`;
    document.getElementById('asset5TotalDebts').textContent = `${snap.totalDebts.toLocaleString()}원`;
    const netEl = document.getElementById('asset5NetWorth');
    netEl.textContent = `${snap.netWorth.toLocaleString()}원`;
    netEl.className = `text-xl sm:text-2xl font-bold mt-1 ${snap.netWorth >= 0 ? 'text-gray-800' : 'text-rose-600'}`;

    const diffEl = document.getElementById('asset5NetDiff');
    if (netDiff > 0) diffEl.innerHTML = `<span class="text-blue-600 font-bold">전월 말 대비 +${netDiff.toLocaleString()}원 증가</span>`;
    else if (netDiff < 0) diffEl.innerHTML = `<span class="text-rose-500 font-bold">전월 말 대비 ${netDiff.toLocaleString()}원 감소</span>`;
    else diffEl.innerHTML = `<span class="text-gray-400">전월 말과 변동 없음</span>`;

    const ownerBadge = document.getElementById('asset5OwnerBadge');
    if (ownerBadge) {
        ownerBadge.textContent = isAllGlobalUsersSelected() ? '전체 자산 기준' : `${getGlobalUserShortLabel()} 소유 기준`;
    }

    renderAsset5BankList(snap.bankItems);
    renderAsset5DebtList(snap.debtItems, snap.cardDebtItems, snap.installmentItems);
    renderAsset5DonutChart(snap.groupTotals, snap.totalAssets);
    renderAsset5TrendChart();
}

function renderAsset5BankList(bankItems) {
    const container = document.getElementById('asset5BankSections');
    const toggleBtn = document.getElementById('asset5BankToggleAllBtn');
    if (!container) return;

    if (bankItems.length === 0) {
        if (toggleBtn) toggleBtn.classList.add('hidden');
        container.innerHTML = `<div class="bg-white p-8 rounded-2xl border border-blue-100 text-center text-xs text-gray-400">표시할 자산이 없습니다. [설정]에서 자산을 등록해 보세요.</div>`;
        return;
    }

    const presentKeys = ASSET_GROUP_ORDER.filter(k => bankItems.some(it => it.groupKey === k));
    if (toggleBtn) {
        toggleBtn.classList.remove('hidden');
        const allOpen = presentKeys.every(k => !!asset5ExpandedBank[k]);
        toggleBtn.textContent = allOpen ? '모두 접기' : '모두 펼치기';
    }

    container.innerHTML = presentKeys.map(gKey => {
        const list = bankItems.filter(it => it.groupKey === gKey);
        const meta = ASSET_GROUP_META[gKey];
        const subTotal = list.reduce((s, x) => s + x.currentVal, 0);
        const isOpen = !!asset5ExpandedBank[gKey];

        const rows = isOpen ? `<div class="pt-2.5 mt-2.5 border-t border-blue-100 space-y-2">${list.map(({ asset, costBasis, valOffset, currentVal, isMinusSurplus }) => {
            const isValuable = (asset.type === '투자' || asset.type === '실물자산');
            let profitHtml = '';
            if (asset.type === '투자' && valOffset !== 0) {
                const pct = costBasis > 0 ? ((valOffset / costBasis) * 100).toFixed(1) : '0.0';
                const pCls = valOffset > 0 ? 'text-rose-500' : 'text-blue-600';
                profitHtml = `<div class="text-[11px] ${pCls} font-bold">원금 ${costBasis.toLocaleString()}원 · 손익 ${valOffset > 0 ? '+' : ''}${valOffset.toLocaleString()}원 (${valOffset > 0 ? '+' : ''}${pct}%)</div>`;
            } else if (asset.type === '실물자산' && valOffset !== 0) {
                profitHtml = `<div class="text-[11px] text-gray-400">취득가 ${costBasis.toLocaleString()}원 · 변동 ${valOffset > 0 ? '+' : ''}${valOffset.toLocaleString()}원</div>`;
            }

            const typeBadge = isMinusSurplus
                ? `<span class="px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-700 border border-emerald-200 font-bold text-[10px]">마이너스통장 (예치)</span>`
                : `<span class="px-1.5 py-0.5 rounded bg-white text-blue-700 border border-blue-100 font-bold text-[10px]">${escHtml(asset.type)}</span>`;

            const actionBtn = isValuable
                ? `<button onclick="event.stopPropagation(); openValuationModal('${asset.id}', ${costBasis}, ${currentVal})" class="px-2.5 py-1 bg-purple-50 hover:bg-purple-100 text-purple-700 rounded-lg text-[11px] font-bold whitespace-nowrap">평가액 갱신</button>`
                : `<button onclick="event.stopPropagation(); openBalanceAdjustModal('${asset.id}', ${currentVal})" class="px-2.5 py-1 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg text-[11px] font-bold whitespace-nowrap">잔액 보정</button>`;

            return `
                <div class="bg-blue-50/30 p-3 rounded-xl border border-blue-100 flex flex-wrap justify-between items-center gap-2 text-xs">
                    <div class="space-y-0.5 min-w-[140px]">
                        <div class="flex items-center gap-1.5 flex-wrap">
                            ${getOwnerBadgeHtml(asset.owner)}
                            ${typeBadge}
                            <span class="font-bold text-gray-800 text-sm">${escHtml(asset.name)}</span>
                        </div>
                        ${profitHtml}
                    </div>
                    <div class="flex items-center gap-2 ml-auto">
                        <span class="font-bold text-sm text-gray-800 whitespace-nowrap">${currentVal.toLocaleString()}원</span>
                        ${actionBtn}
                    </div>
                </div>`;
        }).join('')}</div>` : '';

        return `
            <div class="bg-white p-3.5 rounded-2xl border border-blue-100 shadow-sm">
                <div onclick="toggleAsset5BankGroup('${gKey}')" class="flex justify-between items-center gap-2 cursor-pointer select-none">
                    <div class="flex items-center gap-2 min-w-0">
                        <span class="w-3 h-3 rounded-full shrink-0" style="background-color:${meta.color}"></span>
                        <span class="font-bold text-sm text-blue-900 truncate">${meta.label}</span>
                        <span class="text-[10px] px-1.5 py-0.5 rounded-full bg-blue-50 text-blue-700 font-bold shrink-0">${list.length}건</span>
                    </div>
                    <div class="flex items-center gap-2 shrink-0">
                        <span class="font-bold text-sm text-gray-800 whitespace-nowrap">${subTotal.toLocaleString()}원</span>
                        <span class="text-[11px] text-blue-500 font-bold">${isOpen ? '▲' : '▼'}</span>
                    </div>
                </div>
                ${rows}
            </div>`;
    }).join('');
}

function renderAsset5DebtList(debtItems, cardDebtItems, installmentItems = []) {
    const container = document.getElementById('asset5DebtSections');
    const toggleBtn = document.getElementById('asset5DebtToggleAllBtn');
    if (!container) return;

    const loanTotal = debtItems.reduce((s, x) => s + x.balance, 0);
    const lumpSumTotal = cardDebtItems.reduce((s, x) => s + x.lumpSumUnpaid, 0);
    const instTotal = installmentItems.reduce((s, x) => s + x.remainAmount, 0);

    if (debtItems.length === 0 && cardDebtItems.length === 0 && installmentItems.length === 0) {
        if (toggleBtn) toggleBtn.classList.add('hidden');
        container.innerHTML = `<div class="bg-white p-8 rounded-2xl border border-pink-100 text-center text-xs text-gray-400">등록된 부채나 신용카드가 없습니다.</div>`;
        return;
    }

    const presentKeys = [];
    if (debtItems.length > 0) presentKeys.push('loan');
    if (cardDebtItems.length > 0) presentKeys.push('card');
    if (installmentItems.length > 0) presentKeys.push('installment');

    if (toggleBtn) {
        toggleBtn.classList.remove('hidden');
        const allOpen = presentKeys.every(k => !!asset5ExpandedDebt[k]);
        toggleBtn.textContent = allOpen ? '모두 접기' : '모두 펼치기';
    }

    let html = '';

    // 1. 대출 · 마이너스통장
    if (debtItems.length > 0) {
        const isOpen = !!asset5ExpandedDebt.loan;
        const rows = isOpen ? `<div class="pt-2.5 mt-2.5 border-t border-pink-100 space-y-2">${debtItems.map(({ asset, balance }) => {
            const adjustArg = (asset.type === '마이너스통장') ? -balance : balance;
            return `
            <div class="bg-pink-50/30 p-3 rounded-xl border border-pink-100 flex flex-wrap justify-between items-center gap-2 text-xs">
                <div class="flex items-center gap-1.5 flex-wrap">
                    ${getOwnerBadgeHtml(asset.owner)}
                    <span class="px-1.5 py-0.5 rounded bg-orange-50 text-orange-800 font-bold text-[10px]">${escHtml(asset.type)}</span>
                    <span class="font-bold text-gray-800 text-sm">${escHtml(asset.name)}</span>
                </div>
                <div class="flex items-center gap-2 ml-auto">
                    <span class="font-bold text-sm whitespace-nowrap ${balance > 0 ? 'text-rose-600' : 'text-gray-400'}">${balance.toLocaleString()}원</span>
                    <button onclick="event.stopPropagation(); openBalanceAdjustModal('${asset.id}', ${adjustArg})" class="px-2.5 py-1 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg text-[11px] font-bold whitespace-nowrap">잔액 보정</button>
                </div>
            </div>`;
        }).join('')}</div>` : '';

        html += `
            <div class="bg-white p-3.5 rounded-2xl border border-pink-100 shadow-sm">
                <div onclick="toggleAsset5DebtGroup('loan')" class="flex justify-between items-center gap-2 cursor-pointer select-none">
                    <div class="flex items-center gap-2 min-w-0">
                        <span class="w-3 h-3 rounded-full shrink-0 bg-orange-400"></span>
                        <span class="font-bold text-sm text-pink-900 truncate">대출 · 마이너스통장</span>
                        <span class="text-[10px] px-1.5 py-0.5 rounded-full bg-pink-50 text-pink-700 font-bold shrink-0">${debtItems.length}건</span>
                    </div>
                    <div class="flex items-center gap-2 shrink-0">
                        <span class="font-bold text-sm text-rose-600 whitespace-nowrap">${loanTotal.toLocaleString()}원</span>
                        <span class="text-[11px] text-pink-500 font-bold">${isOpen ? '▲' : '▼'}</span>
                    </div>
                </div>
                ${rows}
            </div>`;
    }

    // 2. 신용카드 일시불 미결제
    if (cardDebtItems.length > 0) {
        const isOpen = !!asset5ExpandedDebt.card;
        const rows = isOpen ? `<div class="pt-2.5 mt-2.5 border-t border-pink-100 space-y-2">${cardDebtItems.map(({ asset, lumpSumUnpaid, instRemain }) => `
            <div onclick="openCardUnpaidDetailModal('${asset.id}')" class="bg-pink-50/30 hover:border-pink-300 p-3 rounded-xl border border-pink-100 flex flex-wrap justify-between items-center gap-2 text-xs cursor-pointer transition">
                <div class="space-y-0.5 min-w-0">
                    <div class="flex items-center gap-1.5 flex-wrap">
                        ${getOwnerBadgeHtml(asset.owner)}
                        <span class="px-1.5 py-0.5 rounded bg-pink-100 text-pink-800 font-bold text-[10px]">신용카드</span>
                        <span class="font-bold text-gray-800 text-sm">${escHtml(asset.name)}</span>
                    </div>
                    ${instRemain > 0 ? `<div class="text-[10px] text-purple-600 font-bold">별도 진행 할부 잔액 ${instRemain.toLocaleString()}원</div>` : ''}
                </div>
                <div class="flex items-center gap-1.5 ml-auto">
                    <span class="font-bold text-sm whitespace-nowrap ${lumpSumUnpaid > 0 ? 'text-rose-600' : 'text-gray-400'}">${lumpSumUnpaid.toLocaleString()}원</span>
                    <button onclick="event.stopPropagation(); openCardUnpaidDetailModal('${asset.id}')" class="px-2 py-1 bg-pink-100 hover:bg-pink-200 text-pink-900 rounded-lg text-[10px] font-bold whitespace-nowrap">상세</button>
                    <button onclick="event.stopPropagation(); switchMainTab('tab2')" class="px-2 py-1 bg-white border border-pink-200 hover:bg-pink-50 text-pink-700 rounded-lg text-[10px] font-bold whitespace-nowrap">결제·출금</button>
                </div>
            </div>`).join('')}</div>` : '';

        html += `
            <div class="bg-white p-3.5 rounded-2xl border border-pink-100 shadow-sm">
                <div onclick="toggleAsset5DebtGroup('card')" class="flex justify-between items-center gap-2 cursor-pointer select-none">
                    <div class="flex items-center gap-2 min-w-0">
                        <span class="w-3 h-3 rounded-full shrink-0 bg-pink-400"></span>
                        <span class="font-bold text-sm text-pink-900 truncate">신용카드 일시불 미결제</span>
                        <span class="text-[10px] px-1.5 py-0.5 rounded-full bg-pink-50 text-pink-700 font-bold shrink-0">${cardDebtItems.length}건</span>
                    </div>
                    <div class="flex items-center gap-2 shrink-0">
                        <span class="font-bold text-sm text-rose-600 whitespace-nowrap">${lumpSumTotal.toLocaleString()}원</span>
                        <span class="text-[11px] text-pink-500 font-bold">${isOpen ? '▲' : '▼'}</span>
                    </div>
                </div>
                ${rows}
            </div>`;
    }

    // 3. 신용카드 할부 잔액 (건별 상세 관리)
    if (installmentItems.length > 0) {
        const isOpen = !!asset5ExpandedDebt.installment;
        const rows = isOpen ? `<div class="pt-2.5 mt-2.5 border-t border-purple-100 space-y-2">${installmentItems.map(it => {
            const pct = Math.round((it.paidCount / it.months) * 100);
            const [ly, lm] = it.lastBillYM.split('-');
            return `
            <div onclick="openInstallmentDetailModal('${it.tx.id}')" class="bg-purple-50/40 hover:border-purple-300 p-3 rounded-xl border border-purple-200 space-y-2 text-xs cursor-pointer transition">
                <div class="flex justify-between items-start gap-2">
                    <div class="min-w-0 space-y-0.5">
                        <div class="flex items-center gap-1.5 flex-wrap">
                            ${getOwnerBadgeHtml(it.card.owner)}
                            <span class="px-1.5 py-0.5 rounded bg-purple-100 text-purple-800 font-bold text-[10px] whitespace-nowrap">${escHtml(it.card.name)}</span>
                            <span class="font-bold text-sm text-gray-800 truncate">${escHtml(it.tx.memo)}</span>
                        </div>
                        <div class="text-[11px] text-gray-500">
                            총 ${it.totalAmount.toLocaleString()}원 (${it.months}개월) · 월 ${it.monthlyAmount.toLocaleString()}원
                        </div>
                    </div>
                    <div class="text-right shrink-0">
                        <div class="font-bold text-sm text-rose-600 whitespace-nowrap">${it.remainAmount.toLocaleString()}원</div>
                        <div class="text-[10px] font-bold text-purple-700 whitespace-nowrap">남은 ${it.remainCount}회 / ${it.months}회</div>
                    </div>
                </div>
                <div class="space-y-1">
                    <div class="w-full h-1.5 bg-gray-200 rounded-full overflow-hidden">
                        <div class="h-full bg-purple-500 rounded-full transition-all" style="width:${pct}%"></div>
                    </div>
                    <div class="flex justify-between items-center text-[10px] text-gray-500">
                        <span>결제일 ${it.tx.date} · ${it.paidCount}회 납부 완료 (${pct}%)</span>
                        <span class="font-bold text-gray-600">완납 예정 ${ly}.${lm}</span>
                    </div>
                </div>
            </div>`;
        }).join('')}</div>` : '';

        html += `
            <div class="bg-white p-3.5 rounded-2xl border border-purple-200 shadow-sm">
                <div onclick="toggleAsset5DebtGroup('installment')" class="flex justify-between items-center gap-2 cursor-pointer select-none">
                    <div class="flex items-center gap-2 min-w-0">
                        <span class="w-3 h-3 rounded-full shrink-0 bg-purple-400"></span>
                        <span class="font-bold text-sm text-purple-900 truncate">신용카드 할부 잔액</span>
                        <span class="text-[10px] px-1.5 py-0.5 rounded-full bg-purple-50 text-purple-700 font-bold shrink-0">${installmentItems.length}건</span>
                    </div>
                    <div class="flex items-center gap-2 shrink-0">
                        <span class="font-bold text-sm text-rose-600 whitespace-nowrap">${instTotal.toLocaleString()}원</span>
                        <span class="text-[11px] text-purple-500 font-bold">${isOpen ? '▲' : '▼'}</span>
                    </div>
                </div>
                ${rows}
            </div>`;
    }

    container.innerHTML = html;
}

// =========================================================
// 할부 건별 회차 상세 스케줄 팝업
// =========================================================
function openInstallmentDetailModal(txId) {
    const todayStr = formatYMD(new Date());
    const snap = computeActiveInstallmentsAsOf(todayStr, true);
    const it = snap.items.find(x => x.tx.id === txId);
    if (!it) return;

    const [ly, lm] = it.lastBillYM.split('-');
    const rowsHtml = it.schedule.map(s => {
        const [sy, sm] = s.ym.split('-').map(Number);
        const badge = s.status === 'settled'
            ? `<span class="text-[10px] px-1.5 py-0.5 rounded bg-green-100 text-green-800 font-bold">정산완료</span>`
            : (s.status === 'prepaid'
                ? `<span class="text-[10px] px-1.5 py-0.5 rounded bg-orange-100 text-orange-800 font-bold">선결제됨</span>`
                : `<span class="text-[10px] px-1.5 py-0.5 rounded bg-purple-100 text-purple-800 font-bold">청구예정</span>`);
        const isDone = s.status !== 'pending';
        return `
            <div class="flex justify-between items-center p-2.5 rounded-xl border ${isDone ? 'bg-gray-50 border-gray-200 opacity-70' : 'bg-white border-purple-100'} text-xs">
                <div class="flex items-center gap-2">
                    <span class="font-bold text-purple-900 w-12">${s.idx}/${it.months}회차</span>
                    <span class="text-gray-600">${sy}년 ${sm}월 청구</span>
                    ${badge}
                </div>
                <span class="font-bold ${isDone ? 'line-through text-gray-400' : 'text-gray-800'}">${s.amount.toLocaleString()}원</span>
            </div>`;
    }).join('');

    openCustomModal(`
        <div class="flex justify-between items-start gap-2 border-b border-purple-100 pb-3">
            <div>
                <div class="flex items-center gap-1.5 flex-wrap">
                    ${getOwnerBadgeHtml(it.card.owner)}
                    <span class="text-[10px] px-1.5 py-0.5 rounded bg-purple-100 text-purple-800 font-bold">${escHtml(it.card.name)}</span>
                    <h3 class="title-font text-xl text-purple-900">${escHtml(it.tx.memo)}</h3>
                </div>
                <div class="text-[11px] text-gray-500 mt-0.5">결제일 ${it.tx.date} · ${escHtml(it.tx.catMain)}${it.tx.catSub ? '/' + escHtml(it.tx.catSub) : ''} · 완납 예정 ${ly}년 ${Number(lm)}월</div>
            </div>
            <button onclick="closeCustomModal()" class="text-xs px-2.5 py-1 bg-gray-100 hover:bg-gray-200 rounded-lg font-bold text-gray-600">닫기</button>
        </div>

        <div class="bg-purple-50 p-3.5 rounded-2xl border border-purple-200 grid grid-cols-3 gap-2 text-center text-xs">
            <div>
                <div class="text-[10px] text-gray-500">총 결제금액</div>
                <div class="font-bold text-gray-800 mt-0.5">${it.totalAmount.toLocaleString()}원</div>
            </div>
            <div>
                <div class="text-[10px] text-gray-500">남은 회차</div>
                <div class="font-bold text-purple-700 mt-0.5">${it.remainCount}회 / ${it.months}회</div>
            </div>
            <div>
                <div class="text-[10px] text-gray-500">남은 금액</div>
                <div class="font-bold text-rose-600 mt-0.5">${it.remainAmount.toLocaleString()}원</div>
            </div>
        </div>

        <div class="space-y-1.5">
            <div class="flex justify-between items-center text-xs">
                <span class="font-bold text-gray-700">회차별 청구 · 납부 현황</span>
                <span class="text-[10px] text-gray-400">결제 대금 정산·선결제 시 자동 반영</span>
            </div>
            <div class="space-y-1.5 max-h-[260px] overflow-y-auto pr-1">${rowsHtml}</div>
        </div>

        <div class="flex gap-2 pt-2 border-t border-gray-100">
            <button onclick="closeCustomModal(); switchMainTab('tab2');" class="flex-1 py-2.5 btn-pink rounded-xl text-xs shadow-sm">결제·출금에서 선결제/정산</button>
            <button onclick="closeCustomModal()" class="px-5 py-2.5 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-xl text-xs font-bold">닫기</button>
        </div>`);
}

// =========================================================
// 신용카드 미결제 상세내역 진단 팝업
// =========================================================
function openCardUnpaidDetailModal(cardId) {
    const card = findAsset(cardId);
    if (!card) return;

    const todayStr = formatYMD(new Date());
    const curY = todayObj.getFullYear();
    const curM = todayObj.getMonth() + 1;
    const curYM = formatYM(curY, curM);

    const cardTxs = (db.transactions || []).filter(t => {
        if (getTypeBehavior(t.type) !== 'expense') return false;
        const mAsset = findAsset(t.method);
        return mAsset && mAsset.id === card.id;
    });
    const pastAndTodayTxs = cardTxs.filter(t => t.date && t.date <= todayStr);
    const futureTxs = cardTxs.filter(t => t.date && t.date > todayStr).sort((a, b) => a.date.localeCompare(b.date));

    const cardEvents = (db.cardEvents || []).filter(ev => isCardEventMatch(ev, card));
    const settlements = cardEvents.filter(ev => ev.type === 'settlement');
    const prepays = cardEvents.filter(ev => ev.type === 'prepay_item' || ev.type === 'prepay_amount');

    const revolvingInit = Number(card.revolving) || 0;
    const totalUsedToToday = pastAndTodayTxs.reduce((s, t) => s + (Number(t.amount) || 0), 0);
    const totalSettledCleared = settlements.reduce((s, ev) => s + Math.max(0, (Number(ev.expectedAmount) || 0) - (Number(ev.revolvingAmount) || 0)), 0);
    const totalPrepaid = prepays.reduce((s, ev) => s + (Number(ev.amount) || 0), 0);
    const finalUnpaid = Math.max(0, revolvingInit + totalUsedToToday - totalSettledCleared - totalPrepaid);

    const instSummary = computeActiveInstallmentsAsOf(todayStr, true);
    const instRemain = instSummary.cardRemainMap[card.id] || 0;
    const lumpSumUnpaid = Math.max(0, finalUnpaid - instRemain);

    const earlySettlements = settlements.filter(ev => ev.date && ev.date > todayStr);

    const ymSet = new Set([curYM, formatYM(addMonthToYM(curY, curM, 1).y, addMonthToYM(curY, curM, 1).m)]);
    cardTxs.forEach(t => {
        if (!t.date) return;
        const firstBill = findFirstBillingYMForTx(card, t.date);
        const months = Number(t.installmentMonths) || 1;
        for (let i = 0; i < months; i++) {
            const bm = addMonthToYM(firstBill.y, firstBill.m, i);
            ymSet.add(formatYM(bm.y, bm.m));
        }
    });
    cardEvents.forEach(ev => {
        if (ev.billingYM) ymSet.add(ev.billingYM);
    });

    const sortedYMs = Array.from(ymSet).sort();
    const unsettledBills = [];
    const postSettleDiffs = [];
    const unsettledItemsToToday = [];

    sortedYMs.forEach(ym => {
        const [y, m] = ym.split('-').map(Number);
        const bill = computeCardBillForMonth(card, y, m, false);

        if (bill.settlement) {
            const curNetExpected = Math.max(0, bill.grossAmount - bill.itemPrepaidSum - bill.amountPrepaidSum);
            const settledExpected = Number(bill.settlement.expectedAmount) || 0;
            const diff = curNetExpected - settledExpected;
            if (diff !== 0) {
                postSettleDiffs.push({ ym, y, m, diff, curNetExpected, settledExpected });
            }
        } else {
            const todayItems = bill.items.filter(it => !it.isPrepaid && it.date <= todayStr);
            const todayItemsSum = todayItems.reduce((s, x) => s + x.billAmount, 0);
            const todayRemain = Math.max(0, todayItemsSum - bill.amountPrepaidSum);
            const futureItemsSum = bill.items.filter(it => !it.isPrepaid && it.date > todayStr).reduce((s, x) => s + x.billAmount, 0);

            if (todayRemain > 0 || bill.remainingAmount > 0) {
                unsettledBills.push({
                    ym, y, m, bill,
                    todayRemain,
                    futureItemsSum,
                    todayCount: todayItems.length,
                    instCount: todayItems.filter(it => it.installmentMonths > 1).length,
                    isPastMonth: ym < curYM
                });
                todayItems.forEach(it => {
                    unsettledItemsToToday.push({ ...it, billingYM: ym });
                });
            }
        }
    });

    let noticesHtml = '';
    if (earlySettlements.length > 0) {
        const txt = earlySettlements.map(ev => `${ev.billingYM}분(${ev.date} 결제 예정, ${Number(ev.expectedAmount).toLocaleString()}원)`).join(', ');
        noticesHtml += `
            <div class="bg-blue-50 border border-blue-200 rounded-xl p-2.5 text-[11px] text-blue-900">
                <b>미리 정산 즉시 차감 적용:</b> ${escHtml(txt)}이 미결제 금액에서 바로 차감되었습니다. <span class="text-blue-700">(통장 잔액 출금은 결제일에 반영)</span>
            </div>`;
    }
    if (postSettleDiffs.length > 0) {
        noticesHtml += postSettleDiffs.map(d => `
            <div class="bg-amber-50 border border-amber-300 rounded-xl p-2.5 text-[11px] text-amber-900">
                <b>정산 후 내역 변경 감지 (${d.y}년 ${d.m}월 청구분):</b> 정산 당시 원금(${d.settledExpected.toLocaleString()}원)과 현재 청구 원금(${d.curNetExpected.toLocaleString()}원)에 <b>${d.diff > 0 ? '+' : ''}${d.diff.toLocaleString()}원</b> 차이가 있습니다. [결제·출금]에서 대금 정산 취소 후 다시 정산해 주세요.
            </div>`).join('');
    }
    if (futureTxs.length > 0) {
        const fSum = futureTxs.reduce((s, t) => s + (Number(t.amount) || 0), 0);
        noticesHtml += `
            <div class="bg-gray-50 border border-gray-200 rounded-xl p-2.5 text-[11px] text-gray-600">
                <b>오늘(${todayStr}) 이후 미래 날짜 지출 ${futureTxs.length}건 (${fSum.toLocaleString()}원):</b> 아직 결제일이 도래하지 않은 미래 입력 내역이므로 현재 미결제 금액에는 포함되지 않았습니다.
            </div>`;
    }

    const monthsHtml = unsettledBills.length === 0
        ? `<div class="text-xs text-gray-400 py-4 text-center bg-gray-50 rounded-xl">미정산 청구 예정 내역이 없습니다.</div>`
        : `<div class="space-y-1.5">${unsettledBills.map(u => {
            const tag = u.isPastMonth
                ? `<span class="text-[10px] px-1.5 py-0.5 rounded bg-rose-100 text-rose-700 font-bold">미정산 과거월</span>`
                : (u.instCount > 0
                    ? `<span class="text-[10px] px-1.5 py-0.5 rounded bg-pink-100 text-pink-800 font-bold">할부 ${u.instCount}건 포함</span>`
                    : `<span class="text-[10px] px-1.5 py-0.5 rounded bg-gray-100 text-gray-600 font-bold">청구 예정</span>`);
            return `
                <div class="p-2.5 rounded-xl border ${u.isPastMonth ? 'border-rose-200 bg-rose-50' : 'border-pink-100 bg-white'} flex justify-between items-center gap-2 text-xs">
                    <div class="min-w-0">
                        <div class="flex items-center gap-1.5 flex-wrap">
                            <span class="font-bold text-gray-800">${u.y}년 ${u.m}월 청구</span>
                            ${tag}
                        </div>
                        <div class="text-[10px] text-gray-400 mt-0.5">이용기간 ${u.bill.period.start} ~ ${u.bill.period.end} · 오늘까지 ${u.todayCount}건${u.futureItemsSum > 0 ? ` (미래 +${u.futureItemsSum.toLocaleString()}원 별도)` : ''}</div>
                    </div>
                    <span class="font-bold text-sm ${u.isPastMonth ? 'text-rose-600' : 'text-pink-700'} shrink-0 whitespace-nowrap">${u.todayRemain.toLocaleString()}원</span>
                </div>`;
        }).join('')}</div>`;

    unsettledItemsToToday.sort((a, b) => a.billingYM.localeCompare(b.billingYM) || b.date.localeCompare(a.date));
    const itemsHtml = unsettledItemsToToday.length === 0
        ? `<div class="text-xs text-gray-400 py-4 text-center bg-gray-50 rounded-xl">표시할 미결제 지출 내역이 없습니다.</div>`
        : `<div class="space-y-1.5 max-h-[210px] overflow-y-auto pr-1">${unsettledItemsToToday.map(it => `
            <div class="p-2.5 rounded-xl border border-gray-200 bg-white flex justify-between items-center gap-2 text-xs">
                <div class="min-w-0 pr-2">
                    <div class="flex items-center gap-1 flex-wrap font-bold text-gray-800">
                        <span class="text-[10px] px-1.5 py-0.5 rounded bg-pink-50 text-pink-800 whitespace-nowrap">${it.billingYM.slice(5)}월 청구</span>
                        <span class="text-[10px] px-1 py-0.5 rounded bg-gray-100 text-gray-600">${escHtml(it.user)}</span>
                        <span class="truncate">${escHtml(it.memo)}</span>
                        ${it.installmentMonths > 1 ? `<span class="text-[10px] px-1.5 py-0.5 rounded bg-purple-50 text-purple-700 whitespace-nowrap">${it.installmentIndex}/${it.installmentMonths}회차</span>` : ''}
                    </div>
                    <div class="text-[10px] text-gray-400 mt-0.5">${it.date} · ${escHtml(it.catMain)}${it.catSub ? '/' + escHtml(it.catSub) : ''}</div>
                </div>
                <span class="font-bold text-gray-800 shrink-0 whitespace-nowrap">${it.billAmount.toLocaleString()}원</span>
            </div>`).join('')}</div>`;

    openCustomModal(`
        <div class="flex justify-between items-start gap-2 border-b border-pink-100 pb-3">
            <div>
                <div class="flex items-center gap-1.5">
                    ${getOwnerBadgeHtml(card.owner)}
                    <h3 class="title-font text-xl text-pink-900">${escHtml(card.name)} 미결제 상세</h3>
                </div>
                <div class="text-[11px] text-gray-500 mt-0.5">${todayStr} 기준 · 매월 ${card.payDay}일 결제 · 출금: ${escHtml(getAssetLabel(card.linkedAccount))}</div>
            </div>
            <button onclick="closeCustomModal()" class="text-xs px-2.5 py-1 bg-gray-100 hover:bg-gray-200 rounded-lg font-bold text-gray-600">닫기</button>
        </div>

        <div class="bg-pink-50 p-3.5 rounded-2xl border border-pink-200 space-y-2 text-xs">
            <div class="flex justify-between items-baseline">
                <span class="font-bold text-pink-900">카드 전체 미결제 총액</span>
                <span class="text-2xl font-bold text-rose-600">${finalUnpaid.toLocaleString()}원</span>
            </div>
            <div class="grid grid-cols-2 gap-2 pt-1 text-[11px]">
                <div class="bg-white p-2 rounded-xl border border-pink-100 flex justify-between"><span class="text-gray-500">일시불 미결제</span><span class="font-bold text-gray-800">${lumpSumUnpaid.toLocaleString()}원</span></div>
                <div class="bg-white p-2 rounded-xl border border-purple-100 flex justify-between"><span class="text-purple-700">할부 잔액</span><span class="font-bold text-purple-800">${instRemain.toLocaleString()}원</span></div>
            </div>
            <div class="border-t border-pink-200 pt-2 space-y-1 text-[11px] text-gray-600">
                <div class="flex justify-between"><span>오늘까지 누적 사용액 (${pastAndTodayTxs.length}건)</span><span class="font-bold text-gray-800">+${totalUsedToToday.toLocaleString()}원</span></div>
                ${revolvingInit > 0 ? `<div class="flex justify-between"><span>초기·리볼빙 이월잔액</span><span class="font-bold text-rose-600">+${revolvingInit.toLocaleString()}원</span></div>` : ''}
                ${totalSettledCleared > 0 ? `<div class="flex justify-between"><span>결제 대금 정산 차감 (${settlements.length}건)</span><span class="font-bold text-blue-600">-${totalSettledCleared.toLocaleString()}원</span></div>` : ''}
                ${totalPrepaid > 0 ? `<div class="flex justify-between"><span>선결제 차감 (${prepays.length}건)</span><span class="font-bold text-orange-600">-${totalPrepaid.toLocaleString()}원</span></div>` : ''}
            </div>
        </div>

        ${noticesHtml ? `<div class="space-y-1.5">${noticesHtml}</div>` : ''}

        <div class="space-y-1.5">
            <div class="text-xs font-bold text-gray-700">청구월별 미결제 구성</div>
            ${monthsHtml}
        </div>

        <div class="space-y-1.5">
            <div class="flex justify-between items-center text-xs">
                <span class="font-bold text-gray-700">미결제 포함 지출 내역 (${unsettledItemsToToday.length}건)</span>
                <span class="text-[10px] text-gray-400">할부 잔여 회차 포함</span>
            </div>
            ${itemsHtml}
        </div>

        <div class="flex gap-2 pt-2 border-t border-gray-100">
            <button onclick="closeCustomModal(); switchMainTab('tab2');" class="flex-1 py-2.5 btn-pink rounded-xl text-xs shadow-sm">결제·출금 탭에서 대금 정산</button>
            <button onclick="closeCustomModal()" class="px-5 py-2.5 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-xl text-xs font-bold">닫기</button>
        </div>`);
}

function renderAsset5DonutChart(groupTotals, totalAssets) {
    const donutEl = document.getElementById('asset5DonutChart');
    const centerEl = document.getElementById('asset5DonutCenter');
    const legendEl = document.getElementById('asset5DonutLegend');
    if (!donutEl) return;

    const sumPos = Object.values(groupTotals).reduce((s, v) => s + v, 0);
    centerEl.textContent = `${totalAssets.toLocaleString()}원`;

    if (sumPos <= 0) {
        donutEl.style.background = '#E5E7EB';
        legendEl.innerHTML = `<div class="text-xs text-gray-400 py-4 text-center">자산 내역이 없습니다.</div>`;
        return;
    }

    const entries = ASSET_GROUP_ORDER
        .map(k => ({ key: k, ...ASSET_GROUP_META[k], val: groupTotals[k] || 0 }))
        .filter(x => x.val > 0);

    let accDeg = 0;
    const stops = entries.map(e => {
        const deg = (e.val / sumPos) * 360;
        const seg = `${e.color} ${accDeg.toFixed(1)}deg ${(accDeg + deg).toFixed(1)}deg`;
        accDeg += deg;
        return seg;
    });
    donutEl.style.background = `conic-gradient(${stops.join(', ')})`;

    legendEl.innerHTML = entries.map(e => {
        const pct = ((e.val / sumPos) * 100).toFixed(1);
        return `
            <div class="flex justify-between items-center text-xs bg-white p-2 rounded-xl border border-amber-100">
                <div class="flex items-center gap-2 min-w-0">
                    <span class="w-3 h-3 rounded-full shrink-0" style="background-color:${e.color}"></span>
                    <span class="font-bold text-gray-700 truncate">${e.short}</span>
                    <span class="text-[11px] text-gray-400">${pct}%</span>
                </div>
                <span class="font-bold text-gray-800 shrink-0">${e.val.toLocaleString()}원</span>
            </div>`;
    }).join('');
}

function renderAsset5TrendChart() {
    const chartEl = document.getElementById('asset5TrendChart');
    const titleEl = document.getElementById('asset5TrendTitle');
    if (!chartEl) return;

    const isYear = (asset5TrendMode === 'year');
    const curY = todayObj.getFullYear(), curM = todayObj.getMonth() + 1;
    const curYM = formatYM(curY, curM);
    const firstYM = getAssetFirstRecordYM(curYM);
    titleEl.textContent = isYear ? `${curY}년 월별 순자산 추이` : '최근 6개월 순자산 추이';

    const points = [];
    if (isYear) {
        for (let m = 1; m <= 12; m++) {
            const ymStr = formatYM(curY, m);
            const isEmpty = (ymStr < firstYM || ymStr > curYM);
            let amt = 0;
            if (!isEmpty) {
                const lastD = new Date(curY, m, 0).getDate();
                const dStr = (m === curM) ? formatYMD(new Date()) : `${curY}-${String(m).padStart(2, '0')}-${String(lastD).padStart(2, '0')}`;
                amt = computeAssetSnapshotAsOf(dStr).netWorth;
            }
            points.push({ label: `${m}월`, amt, active: m === curM, isEmpty });
        }
    } else {
        for (let off = -5; off <= 0; off++) {
            const ym = addMonthToYM(curY, curM, off);
            const ymStr = formatYM(ym.y, ym.m);
            const isEmpty = (ymStr < firstYM || ymStr > curYM);
            let amt = 0;
            if (!isEmpty) {
                const lastD = new Date(ym.y, ym.m, 0).getDate();
                const dStr = off === 0 ? formatYMD(new Date()) : `${ym.y}-${String(ym.m).padStart(2, '0')}-${String(lastD).padStart(2, '0')}`;
                amt = computeAssetSnapshotAsOf(dStr).netWorth;
            }
            points.push({ label: `${ym.m}월`, amt, active: off === 0, isEmpty });
        }
    }

    const activePts = points.filter(p => !p.isEmpty);
    const maxAbs = Math.max(...activePts.map(p => Math.abs(p.amt)), 1);
    chartEl.style.gridTemplateColumns = `repeat(${points.length}, minmax(0, 1fr))`;
    chartEl.style.minWidth = isYear ? '640px' : '';

    chartEl.innerHTML = points.map(p => {
        if (p.isEmpty) {
            return `
                <div class="flex flex-col items-center h-full px-0.5" title="${p.label}: 입력 내역 없음">
                    <div class="w-full h-20"></div>
                    <div class="w-full border-t border-gray-300"></div>
                    <div class="w-full h-20"></div>
                    <span class="text-[11px] font-bold whitespace-nowrap mt-1 text-gray-300">${p.label}</span>
                </div>`;
        }

        const isPos = p.amt > 0;
        const isNeg = p.amt < 0;
        const hPct = p.amt !== 0 ? Math.max(10, Math.round((Math.abs(p.amt) / maxAbs) * 76)) : 0;
        const txt = formatManWonRounded(p.amt);
        const barW = isYear ? 'max-w-[24px]' : 'max-w-[32px]';
        const posColor = p.active ? 'bg-blue-500' : 'bg-blue-300';
        const negColor = p.active ? 'bg-rose-500' : 'bg-rose-300';

        return `
            <div class="flex flex-col items-center h-full px-0.5" title="${p.label}: ${p.amt.toLocaleString()}원">
                <div class="w-full h-20 flex flex-col justify-end items-center gap-0.5 pb-0.5">
                    ${isPos ? `<span class="text-[10px] font-bold whitespace-nowrap ${p.active ? 'text-blue-700' : 'text-blue-500'}">${txt}</span>
                               <div class="w-full ${barW} rounded-t-md transition-all ${posColor}" style="height:${hPct}%"></div>` : ''}
                    ${!isPos && !isNeg ? `<span class="text-[10px] font-bold text-gray-400">0</span>` : ''}
                </div>
                <div class="w-full border-t border-gray-300"></div>
                <div class="w-full h-20 flex flex-col justify-start items-center gap-0.5 pt-0.5">
                    ${isNeg ? `<div class="w-full ${barW} rounded-b-md transition-all ${negColor}" style="height:${hPct}%"></div>
                               <span class="text-[10px] font-bold whitespace-nowrap ${p.active ? 'text-rose-600' : 'text-rose-400'}">${txt}</span>` : ''}
                </div>
                <span class="text-[11px] font-bold whitespace-nowrap mt-1 ${p.active ? 'text-gray-900' : 'text-gray-500'}">${p.label}</span>
            </div>`;
    }).join('');
}

// =========================================================
// 잔액 보정 & 투자·실물 평가액 갱신 모달
// =========================================================
function openBalanceAdjustModal(assetId, currentVal) {
    const a = findAsset(assetId);
    if (!a) return;

    if (a.group === 'debt' && a.type === '마이너스통장') {
        const absVal = Math.abs(currentVal);
        const isNeg = currentVal < 0;
        const curText = currentVal > 0
            ? `<span class="font-bold text-sm text-blue-600">+${currentVal.toLocaleString()}원 (예치 · 자산)</span>`
            : (currentVal < 0
                ? `<span class="font-bold text-sm text-rose-600">-${absVal.toLocaleString()}원 (마이너스 · 부채)</span>`
                : `<span class="font-bold text-sm text-gray-800">0원</span>`);

        openCustomModal(`
            <h3 class="title-font text-lg text-blue-900">${escHtml(getAssetLabel(a.id))} 잔액 보정</h3>
            <p class="text-xs text-gray-500">플러스(+) 잔액은 보유 자산으로, 마이너스(-) 사용액은 부채로 자동 반영됩니다.</p>
            <div class="bg-blue-50 p-3 rounded-xl text-xs flex justify-between items-center">
                <span class="text-gray-600">현재 계산된 잔액</span>
                ${curText}
            </div>
            <div class="space-y-2.5 text-xs">
                <label class="block font-bold text-gray-600">실제 통장 잔액 상태</label>
                <div class="grid grid-cols-2 gap-2">
                    <label class="flex items-center justify-center gap-1.5 p-2.5 rounded-xl border border-blue-200 bg-blue-50 cursor-pointer font-bold text-blue-800">
                        <input type="radio" name="modalMinusSign" value="plus" ${!isNeg ? 'checked' : ''} class="accent-blue-500">
                        <span>+ 플러스 (예치)</span>
                    </label>
                    <label class="flex items-center justify-center gap-1.5 p-2.5 rounded-xl border border-rose-200 bg-rose-50 cursor-pointer font-bold text-rose-700">
                        <input type="radio" name="modalMinusSign" value="minus" ${isNeg ? 'checked' : ''} class="accent-rose-500">
                        <span>- 마이너스 (부채)</span>
                    </label>
                </div>
                <div>
                    <label class="block font-bold text-gray-600 mb-1">실제 확인된 금액 (원)</label>
                    <div class="relative">
                        <input type="text" inputmode="numeric" id="modalAdjustBalanceVal" oninput="formatCommaInput(this)" value="${formatNumberToInput(absVal, true)}" placeholder="금액 입력" class="w-full p-2.5 pr-8 border border-blue-300 rounded-xl text-sm font-bold text-right">
                        <button type="button" onclick="clearNumericInput('modalAdjustBalanceVal')" title="금액 지우기" class="absolute right-2 top-1/2 -translate-y-1/2 w-5 h-5 flex items-center justify-center rounded-full bg-gray-100 hover:bg-gray-200 text-gray-500 text-xs font-bold">×</button>
                    </div>
                </div>
            </div>
            <div class="flex justify-end gap-2 pt-2">
                <button onclick="closeCustomModal()" class="px-4 py-2 bg-gray-100 text-gray-700 font-bold rounded-xl text-xs">취소</button>
                <button onclick="saveMinusBalanceAdjust('${a.id}', ${currentVal})" class="px-4 py-2 bg-blue-500 hover:bg-blue-600 text-white font-bold rounded-xl text-xs shadow-sm">잔액 맞추기</button>
            </div>`);
        return;
    }

    openCustomModal(`
        <h3 class="title-font text-lg text-blue-900">${escHtml(getAssetLabel(a.id))} 잔액 보정</h3>
        <p class="text-xs text-gray-500">실제 은행 앱 잔액과 차이가 날 때 지출·수입 통계에 영향을 주지 않고 현재 잔액을 바로 맞춥니다.</p>
        <div class="bg-blue-50 p-3 rounded-xl text-xs flex justify-between items-center">
            <span class="text-gray-600">현재 계산된 잔액</span>
            <span class="font-bold text-sm text-gray-800">${currentVal.toLocaleString()}원</span>
        </div>
        <div class="space-y-2 text-xs">
            <label class="block font-bold text-gray-600">실제 확인된 현재 잔액 (원)</label>
            <div class="relative">
                <input type="text" inputmode="numeric" id="modalAdjustBalanceVal" oninput="formatCommaInput(this)" value="${formatNumberToInput(currentVal, true)}" placeholder="금액 입력" class="w-full p-2.5 pr-8 border border-blue-300 rounded-xl text-sm font-bold text-right">
                <button type="button" onclick="clearNumericInput('modalAdjustBalanceVal')" title="금액 지우기" class="absolute right-2 top-1/2 -translate-y-1/2 w-5 h-5 flex items-center justify-center rounded-full bg-gray-100 hover:bg-gray-200 text-gray-500 text-xs font-bold">×</button>
            </div>
        </div>
        <div class="flex justify-end gap-2 pt-2">
            <button onclick="closeCustomModal()" class="px-4 py-2 bg-gray-100 text-gray-700 font-bold rounded-xl text-xs">취소</button>
            <button onclick="saveBalanceAdjust('${a.id}', ${currentVal})" class="px-4 py-2 bg-blue-500 hover:bg-blue-600 text-white font-bold rounded-xl text-xs shadow-sm">잔액 맞추기</button>
        </div>`);
}

function saveMinusBalanceAdjust(assetId, currentSignedCash) {
    const a = findAsset(assetId);
    if (!a) return;
    const sign = document.querySelector('input[name="modalMinusSign"]:checked')?.value || 'minus';
    const absAmt = parseCommaNumber(document.getElementById('modalAdjustBalanceVal').value);
    const targetSignedCash = (sign === 'minus') ? -absAmt : absAmt;
    const targetDebtBal = -targetSignedCash;
    const currentDebtBal = -currentSignedCash;
    const diffDebt = targetDebtBal - currentDebtBal;
    a.initBalance = (Number(a.initBalance) || 0) + diffDebt;
    closeCustomModal();
    saveDb();
}

function saveBalanceAdjust(assetId, currentVal) {
    const a = findAsset(assetId);
    if (!a) return;
    const targetVal = parseCommaNumber(document.getElementById('modalAdjustBalanceVal').value);
    const diff = targetVal - currentVal;
    a.initBalance = (Number(a.initBalance) || 0) + diff;
    closeCustomModal();
    saveDb();
}

function openValuationModal(assetId, costBasis, currentVal) {
    const a = findAsset(assetId);
    if (!a) return;
    openCustomModal(`
        <h3 class="title-font text-lg text-purple-900">${escHtml(getAssetLabel(a.id))} 평가액 갱신</h3>
        <p class="text-xs text-gray-500">증권사 앱이나 시세에서 확인한 현재 평가금액을 입력해 주세요. 이후 새로 매수(이체)하는 금액은 이 평가액에 자동으로 더해집니다.</p>
        <div class="bg-purple-50 p-3 rounded-xl text-xs space-y-1">
            <div class="flex justify-between"><span class="text-gray-600">누적 투자 원금 (이체 합계)</span><span class="font-bold text-gray-800">${costBasis.toLocaleString()}원</span></div>
            <div class="flex justify-between"><span class="text-gray-600">직전 반영된 평가액</span><span class="font-bold text-purple-800">${currentVal.toLocaleString()}원</span></div>
        </div>
        <div class="space-y-2 text-xs">
            <label class="block font-bold text-gray-600">현재 평가금액 (원)</label>
            <div class="relative">
                <input type="text" inputmode="numeric" id="modalValuationVal" oninput="formatCommaInput(this)" value="${formatNumberToInput(currentVal, true)}" placeholder="금액 입력" class="w-full p-2.5 pr-8 border border-purple-300 rounded-xl text-sm font-bold text-right">
                <button type="button" onclick="clearNumericInput('modalValuationVal')" title="금액 지우기" class="absolute right-2 top-1/2 -translate-y-1/2 w-5 h-5 flex items-center justify-center rounded-full bg-gray-100 hover:bg-gray-200 text-gray-500 text-xs font-bold">×</button>
            </div>
        </div>
        <div class="flex justify-between items-center pt-2">
            <button onclick="resetValuationOffset('${a.id}')" class="text-xs text-gray-500 underline font-bold">원금 기준으로 초기화</button>
            <div class="flex gap-2">
                <button onclick="closeCustomModal()" class="px-4 py-2 bg-gray-100 text-gray-700 font-bold rounded-xl text-xs">취소</button>
                <button onclick="saveValuationUpdate('${a.id}', ${costBasis})" class="px-4 py-2 bg-purple-600 hover:bg-purple-700 text-white font-bold rounded-xl text-xs shadow-sm">평가액 저장</button>
            </div>
        </div>`);
}

function saveValuationUpdate(assetId, costBasis) {
    const a = findAsset(assetId);
    if (!a) return;
    const targetVal = parseCommaNumber(document.getElementById('modalValuationVal').value);
    a.valuationOffset = targetVal - costBasis;
    closeCustomModal();
    saveDb();
}

function resetValuationOffset(assetId) {
    const a = findAsset(assetId);
    if (!a) return;
    a.valuationOffset = 0;
    closeCustomModal();
    saveDb();
}