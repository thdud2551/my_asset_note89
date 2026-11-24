// =========================================================
// [5. 자산 현황] 전용 모듈 (5개 자산 그룹 아코디언 · 멀티 사용자 · 빈 달 제외 추이)
// =========================================================
let asset5TrendMode = '6m'; // '6m' | 'year'
let asset5ExpandedBank = {}; // key: 'cash' | 'voucher' | 'saving' | 'invest' | 'real'
let asset5ExpandedDebt = {}; // key: 'loan' | 'card'

const ASSET_GROUP_META = {
    cash:    { label: '입출금·현금', short: '입출금·현금', color: '#74C0FC', types: ['입출금통장', '현금'] },
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

function computeAssetSnapshotAsOf(asOfDate) {
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
            debtBalMap[a.id] = Math.max(0, (debtBalMap[a.id] || 0) - delta);
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
        if (!ev.date || ev.date > asOfDate) return;
        const fromId = resolveToAssetId(ev.fromAccount);
        const card = findAsset(ev.cardId || ev.cardName);

        if (ev.type === 'settlement') {
            const actualAmt = Number(ev.actualAmount) || 0;
            const expectedAmt = Number(ev.expectedAmount) || 0;
            applyAccountDelta(fromId, -actualAmt);
            if (card && card.type === '신용카드') {
                const revAmt = Number(ev.revolvingAmount) || 0;
                const cleared = Math.max(0, expectedAmt - revAmt);
                cardUnpaidMap[card.id] = Math.max(0, (cardUnpaidMap[card.id] || 0) - cleared);
            }
        } else if (ev.type === 'prepay_item' || ev.type === 'prepay_amount') {
            const amt = Number(ev.amount) || 0;
            applyAccountDelta(fromId, -amt);
            if (card && card.type === '신용카드') {
                cardUnpaidMap[card.id] = Math.max(0, (cardUnpaidMap[card.id] || 0) - amt);
            }
        }
    });

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

            bankItems.push({ asset: a, groupKey: gKey, costBasis, valOffset, currentVal });
        } else if (a.group === 'debt') {
            const bal = debtBalMap[a.id] || 0;
            totalDebts += bal;
            debtItems.push({ asset: a, balance: bal });
        } else if (a.group === 'card' && a.type === '신용카드') {
            const unpaid = Math.max(0, cardUnpaidMap[a.id] || 0);
            totalDebts += unpaid;
            cardDebtItems.push({ asset: a, unpaid });
        }
    });

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
        cardDebtItems
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
    renderAsset5DebtList(snap.debtItems, snap.cardDebtItems);
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

        const rows = isOpen ? `<div class="pt-2.5 mt-2.5 border-t border-blue-100 space-y-2">${list.map(({ asset, costBasis, valOffset, currentVal }) => {
            const isValuable = (asset.type === '투자' || asset.type === '실물자산');
            let profitHtml = '';
            if (asset.type === '투자' && valOffset !== 0) {
                const pct = costBasis > 0 ? ((valOffset / costBasis) * 100).toFixed(1) : '0.0';
                const pCls = valOffset > 0 ? 'text-rose-500' : 'text-blue-600';
                profitHtml = `<div class="text-[11px] ${pCls} font-bold">원금 ${costBasis.toLocaleString()}원 · 손익 ${valOffset > 0 ? '+' : ''}${valOffset.toLocaleString()}원 (${valOffset > 0 ? '+' : ''}${pct}%)</div>`;
            } else if (asset.type === '실물자산' && valOffset !== 0) {
                profitHtml = `<div class="text-[11px] text-gray-400">취득가 ${costBasis.toLocaleString()}원 · 변동 ${valOffset > 0 ? '+' : ''}${valOffset.toLocaleString()}원</div>`;
            }

            const actionBtn = isValuable
                ? `<button onclick="event.stopPropagation(); openValuationModal('${asset.id}', ${costBasis}, ${currentVal})" class="px-2.5 py-1 bg-purple-50 hover:bg-purple-100 text-purple-700 rounded-lg text-[11px] font-bold whitespace-nowrap">평가액 갱신</button>`
                : `<button onclick="event.stopPropagation(); openBalanceAdjustModal('${asset.id}', ${currentVal})" class="px-2.5 py-1 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg text-[11px] font-bold whitespace-nowrap">잔액 보정</button>`;

            return `
                <div class="bg-blue-50/30 p-3 rounded-xl border border-blue-100 flex flex-wrap justify-between items-center gap-2 text-xs">
                    <div class="space-y-0.5 min-w-[140px]">
                        <div class="flex items-center gap-1.5 flex-wrap">
                            ${getOwnerBadgeHtml(asset.owner)}
                            <span class="px-1.5 py-0.5 rounded bg-white text-blue-700 border border-blue-100 font-bold text-[10px]">${escHtml(asset.type)}</span>
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

function renderAsset5DebtList(debtItems, cardDebtItems) {
    const container = document.getElementById('asset5DebtSections');
    const toggleBtn = document.getElementById('asset5DebtToggleAllBtn');
    if (!container) return;

    const loanTotal = debtItems.reduce((s, x) => s + x.balance, 0);
    const cardTotal = cardDebtItems.reduce((s, x) => s + x.unpaid, 0);

    if (debtItems.length === 0 && cardDebtItems.length === 0) {
        if (toggleBtn) toggleBtn.classList.add('hidden');
        container.innerHTML = `<div class="bg-white p-8 rounded-2xl border border-pink-100 text-center text-xs text-gray-400">등록된 부채나 신용카드가 없습니다.</div>`;
        return;
    }

    const presentKeys = [];
    if (debtItems.length > 0) presentKeys.push('loan');
    if (cardDebtItems.length > 0) presentKeys.push('card');
    if (toggleBtn) {
        toggleBtn.classList.remove('hidden');
        const allOpen = presentKeys.every(k => !!asset5ExpandedDebt[k]);
        toggleBtn.textContent = allOpen ? '모두 접기' : '모두 펼치기';
    }

    let html = '';
    if (debtItems.length > 0) {
        const isOpen = !!asset5ExpandedDebt.loan;
        const rows = isOpen ? `<div class="pt-2.5 mt-2.5 border-t border-pink-100 space-y-2">${debtItems.map(({ asset, balance }) => `
            <div class="bg-pink-50/30 p-3 rounded-xl border border-pink-100 flex flex-wrap justify-between items-center gap-2 text-xs">
                <div class="flex items-center gap-1.5 flex-wrap">
                    ${getOwnerBadgeHtml(asset.owner)}
                    <span class="px-1.5 py-0.5 rounded bg-orange-50 text-orange-800 font-bold text-[10px]">${escHtml(asset.type)}</span>
                    <span class="font-bold text-gray-800 text-sm">${escHtml(asset.name)}</span>
                </div>
                <div class="flex items-center gap-2 ml-auto">
                    <span class="font-bold text-sm text-rose-600 whitespace-nowrap">${balance.toLocaleString()}원</span>
                    <button onclick="event.stopPropagation(); openBalanceAdjustModal('${asset.id}', ${balance})" class="px-2.5 py-1 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg text-[11px] font-bold whitespace-nowrap">잔액 보정</button>
                </div>
            </div>`).join('')}</div>` : '';

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

    if (cardDebtItems.length > 0) {
        const isOpen = !!asset5ExpandedDebt.card;
        const rows = isOpen ? `<div class="pt-2.5 mt-2.5 border-t border-pink-100 space-y-2">${cardDebtItems.map(({ asset, unpaid }) => `
            <div class="bg-pink-50/30 p-3 rounded-xl border border-pink-100 flex flex-wrap justify-between items-center gap-2 text-xs">
                <div class="flex items-center gap-1.5 flex-wrap">
                    ${getOwnerBadgeHtml(asset.owner)}
                    <span class="px-1.5 py-0.5 rounded bg-pink-100 text-pink-800 font-bold text-[10px]">신용카드</span>
                    <span class="font-bold text-gray-800 text-sm">${escHtml(asset.name)}</span>
                </div>
                <div class="flex items-center gap-2 ml-auto">
                    <span class="font-bold text-sm whitespace-nowrap ${unpaid > 0 ? 'text-rose-600' : 'text-gray-400'}">${unpaid.toLocaleString()}원</span>
                    <button onclick="event.stopPropagation(); switchMainTab('tab2')" class="px-2 py-1 bg-white border border-pink-200 hover:bg-pink-50 text-pink-700 rounded-lg text-[10px] font-bold whitespace-nowrap">결제·출금</button>
                </div>
            </div>`).join('')}</div>` : '';

        html += `
            <div class="bg-white p-3.5 rounded-2xl border border-pink-100 shadow-sm">
                <div onclick="toggleAsset5DebtGroup('card')" class="flex justify-between items-center gap-2 cursor-pointer select-none">
                    <div class="flex items-center gap-2 min-w-0">
                        <span class="w-3 h-3 rounded-full shrink-0 bg-pink-400"></span>
                        <span class="font-bold text-sm text-pink-900 truncate">신용카드 미결제 금액</span>
                        <span class="text-[10px] px-1.5 py-0.5 rounded-full bg-pink-50 text-pink-700 font-bold shrink-0">${cardDebtItems.length}건</span>
                    </div>
                    <div class="flex items-center gap-2 shrink-0">
                        <span class="font-bold text-sm text-rose-600 whitespace-nowrap">${cardTotal.toLocaleString()}원</span>
                        <span class="text-[11px] text-pink-500 font-bold">${isOpen ? '▲' : '▼'}</span>
                    </div>
                </div>
                ${rows}
            </div>`;
    }

    container.innerHTML = html;
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
    openCustomModal(`
        <h3 class="title-font text-lg text-blue-900">${escHtml(getAssetLabel(a.id))} 잔액 보정</h3>
        <p class="text-xs text-gray-500">실제 은행 앱 잔액과 차이가 날 때 지출·수입 통계에 영향을 주지 않고 현재 잔액을 바로 맞춥니다.</p>
        <div class="bg-blue-50/50 p-3 rounded-xl text-xs flex justify-between items-center">
            <span class="text-gray-600">현재 계산된 잔액</span>
            <span class="font-bold text-sm text-gray-800">${currentVal.toLocaleString()}원</span>
        </div>
        <div class="space-y-2 text-xs">
            <label class="block font-bold text-gray-600">실제 확인된 현재 잔액 (원)</label>
            <input type="text" inputmode="numeric" id="modalAdjustBalanceVal" oninput="formatCommaInput(this)" value="${formatNumberToInput(currentVal, true)}" class="w-full p-2.5 border border-blue-300 rounded-xl text-sm font-bold text-right">
        </div>
        <div class="flex justify-end gap-2 pt-2">
            <button onclick="closeCustomModal()" class="px-4 py-2 bg-gray-100 text-gray-700 font-bold rounded-xl text-xs">취소</button>
            <button onclick="saveBalanceAdjust('${a.id}', ${currentVal})" class="px-4 py-2 bg-blue-500 hover:bg-blue-600 text-white font-bold rounded-xl text-xs shadow-sm">잔액 맞추기</button>
        </div>`);
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
        <div class="bg-purple-50/50 p-3 rounded-xl text-xs space-y-1">
            <div class="flex justify-between"><span class="text-gray-600">누적 투자 원금 (이체 합계)</span><span class="font-bold text-gray-800">${costBasis.toLocaleString()}원</span></div>
            <div class="flex justify-between"><span class="text-gray-600">직전 반영된 평가액</span><span class="font-bold text-purple-800">${currentVal.toLocaleString()}원</span></div>
        </div>
        <div class="space-y-2 text-xs">
            <label class="block font-bold text-gray-600">현재 평가금액 (원)</label>
            <input type="text" inputmode="numeric" id="modalValuationVal" oninput="formatCommaInput(this)" value="${formatNumberToInput(currentVal, true)}" class="w-full p-2.5 border border-purple-300 rounded-xl text-sm font-bold text-right">
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