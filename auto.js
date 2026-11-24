// =========================================================
// [3. 정기 지출] 전용 모듈 (멀티 사용자 · 모바일 목록 접기 · 카드형 관리)
// =========================================================
let atYear = todayObj.getFullYear();
let atMonth = todayObj.getMonth() + 1;
let atMasterFilter = 'active'; // 'all' | 'active' | 'paused' | 'ended'
let atFormOpen = false;
let atSelectedMonths = [];

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
    const nowYM = formatYM(todayObj.getFullYear(), todayObj.getMonth() + 1);
    return (db.autoTransfers || [])
        .filter(at => at.active !== false && at.cycleType !== 'specific' && getTypeBehavior(at.type) === 'expense')
        .filter(at => (!at.startYM || nowYM >= at.startYM) && (!at.endYM || nowYM <= at.endYM))
        .reduce((s, at) => {
            const exp = getExpectedAmountForAutoItem(at, todayObj.getFullYear(), todayObj.getMonth() + 1);
            return s + (exp.amount || 0);
        }, 0);
}

function getAnnualSpecificExpenseTotal(year) {
    const yStr = String(year);
    let total = 0;
    (db.autoTransfers || []).forEach(at => {
        if (at.active === false || at.cycleType !== 'specific') return;
        if (getTypeBehavior(at.type) !== 'expense') return;
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
// [3. 정기 지출] 화면 렌더링
// =========================================================
function changeAtMonth(delta) {
    const next = addMonthToYM(atYear, atMonth, delta);
    atYear = next.y; atMonth = next.m;
    renderTab4();
}

function goAtToday() {
    const now = new Date();
    atYear = now.getFullYear(); atMonth = now.getMonth() + 1;
    renderTab4();
}

function jumpToAutoTransferMonth(year, month) {
    atYear = year; atMonth = month;
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

function renderTab4() {
    if (!document.getElementById('atMonthTitle')) return;
    const ym = formatYM(atYear, atMonth);
    const nextYMObj = addMonthToYM(atYear, atMonth, 1);
    const nextYM = formatYM(nextYMObj.y, nextYMObj.m);

    document.getElementById('atMonthTitle').textContent = `${atYear}년 ${atMonth}월 정기 지출`;

    const dueItems = (db.autoTransfers || []).filter(at => {
        if (!matchesGlobalUser(at.user)) return false;
        return isAutoItemDueInMonth(at, atYear, atMonth);
    }).map(at => {
        const sched = getScheduledDateForAutoItem(at, atYear, atMonth);
        const applied = findAppliedTxForAutoItem(at.id, ym);
        const exp = getExpectedAmountForAutoItem(at, atYear, atMonth);
        return { at, sched, applied, exp };
    }).sort((a, b) => a.sched.date.localeCompare(b.sched.date) || compareKorean(a.at.name, b.at.name));

    let sumFixedExp = 0, sumTransfer = 0, doneCount = 0;
    dueItems.forEach(({ at, applied, exp }) => {
        const b = getTypeBehavior(at.type);
        const amt = applied ? Number(applied.amount) : (exp.amount || 0);
        if (b === 'expense') sumFixedExp += amt;
        else if (b === 'transfer' || b === 'voucher') sumTransfer += amt;
        if (applied) doneCount++;
    });

    const annualSpec = getAnnualSpecificExpenseTotal(atYear);
    document.getElementById('atSumExpense').textContent = `${sumFixedExp.toLocaleString()}원`;
    document.getElementById('atSumAnnualHint').textContent = annualSpec > 0
        ? `연간 세금·보험 ${annualSpec.toLocaleString()}원 (월 환산 ${Math.round(annualSpec / 12).toLocaleString()}원)`
        : '등록된 연간 세금·보험 없음';
    document.getElementById('atSumTransfer').textContent = `${sumTransfer.toLocaleString()}원`;
    document.getElementById('atSumStatus').textContent = `${doneCount} / ${dueItems.length}건 완료`;
    document.getElementById('atSumStatusSub').textContent = dueItems.length > doneCount
        ? `반영 대기 ${dueItems.length - doneCount}건`
        : (dueItems.length > 0 ? '이번 달 모든 항목 반영 완료' : '이번 달 예정 항목 없음');

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

    renderAtMonthlyExecutionList(dueItems, ym);
    syncAtFormOptions();
    renderAtMasterList();
}

function renderAtMonthlyExecutionList(dueItems, ym) {
    const container = document.getElementById('atExecutionList');
    const selectAllWrap = document.getElementById('atSelectAllWrap');
    const pendingCount = dueItems.filter(x => !x.applied).length;

    if (selectAllWrap) selectAllWrap.classList.toggle('hidden', pendingCount === 0);
    const selectAllChk = document.getElementById('atSelectAllChk');
    if (selectAllChk) selectAllChk.checked = false;

    if (dueItems.length === 0) {
        container.innerHTML = `<div class="bg-white p-8 rounded-2xl border border-orange-100 text-center text-xs text-gray-400">이번 달에 예정된 정기 지출·이체 항목이 없습니다. 아래에서 새 항목을 등록해 보세요.</div>`;
        return;
    }

    container.innerHTML = dueItems.map(({ at, sched, applied, exp }) => {
        const b = getTypeBehavior(at.type);
        const isTr = (b === 'transfer' || b === 'voucher');
        const methodText = isTr ? `${getAssetLabel(at.method)} → ${getAssetLabel(at.targetAsset)}` : getAssetLabel(at.method);
        const isEndingThisMonth = (at.endYM === ym);
        const isSpecific = (at.cycleType === 'specific');

        const badges = [
            isSpecific
                ? `<span class="text-[10px] px-1.5 py-0.5 rounded bg-orange-100 text-orange-800 font-bold">특정월</span>`
                : `<span class="text-[10px] px-1.5 py-0.5 rounded bg-gray-100 text-gray-600 font-bold">매월</span>`,
            sched.shifted ? `<span class="text-[10px] px-1.5 py-0.5 rounded bg-blue-50 text-blue-700 font-bold">영업일 보정</span>` : '',
            (!applied && exp.source === 'prevYear') ? `<span class="text-[10px] px-1.5 py-0.5 rounded bg-purple-50 text-purple-700 font-bold">전년 동월 기준</span>` : '',
            (!applied && exp.source === 'blank') ? `<span class="text-[10px] px-1.5 py-0.5 rounded bg-amber-50 text-amber-800 font-bold">변동 · 직접 입력</span>` : '',
            (Number(at.installmentMonths) > 1) ? `<span class="text-[10px] px-1.5 py-0.5 rounded bg-pink-100 text-pink-800 font-bold">${at.installmentMonths}개월 할부</span>` : '',
            isEndingThisMonth ? `<span class="text-[10px] px-1.5 py-0.5 rounded bg-rose-100 text-rose-700 font-bold">이번 달 종료</span>` : ''
        ].filter(Boolean).join(' ');

        if (applied) {
            return `
                <div class="bg-gray-50/80 p-3.5 rounded-2xl border border-gray-200 flex flex-wrap justify-between items-center gap-3 text-xs">
                    <div class="space-y-1 min-w-[200px] flex-1">
                        <div class="flex items-center gap-1.5 flex-wrap">
                            <span class="px-2 py-0.5 rounded-lg bg-green-100 text-green-800 font-bold text-[10px]">반영 완료</span>
                            <span class="font-bold text-gray-800 text-sm">${escHtml(at.name)}</span>
                            ${badges}
                        </div>
                        <div class="text-[11px] text-gray-500">
                            ${applied.date} · ${escHtml(at.user)} · ${escHtml(at.type)} (${escHtml(at.catMain)}${at.catSub ? '/' + escHtml(at.catSub) : ''}) · ${escHtml(methodText)}
                        </div>
                    </div>
                    <div class="flex items-center gap-2.5 ml-auto">
                        <span class="font-bold text-sm text-gray-800">${Number(applied.amount).toLocaleString()}원</span>
                        <button onclick="cancelAutoTransferApply('${applied.id}')" class="px-2.5 py-1.5 bg-white border border-red-200 hover:bg-red-50 text-red-600 rounded-xl text-[11px] font-bold">반영 취소</button>
                    </div>
                </div>`;
        }

        const initVal = exp.amount !== null ? formatNumberToInput(exp.amount) : '';
        return `
            <div class="bg-white p-3.5 rounded-2xl border border-orange-200 flex flex-wrap justify-between items-center gap-3 text-xs shadow-sm">
                <div class="flex items-start gap-2.5 min-w-[210px] flex-1">
                    <input type="checkbox" class="at-bulk-chk mt-1 rounded accent-orange-500" value="${at.id}">
                    <div class="space-y-1">
                        <div class="flex items-center gap-1.5 flex-wrap">
                            <span class="font-bold text-gray-800 text-sm">${escHtml(at.name)}</span>
                            ${badges}
                        </div>
                        <div class="text-[11px] text-gray-500">
                            ${escHtml(at.user)} · ${escHtml(at.type)} (${escHtml(at.catMain)}${at.catSub ? '/' + escHtml(at.catSub) : ''}) · ${escHtml(methodText)}
                        </div>
                    </div>
                </div>
                <div class="flex flex-wrap items-center gap-2 ml-auto">
                    <input type="date" id="atExecDate_${at.id}" value="${sched.date}" class="p-1.5 bg-gray-50 border border-gray-200 rounded-xl text-xs font-bold">
                    <input type="text" inputmode="numeric" id="atExecAmt_${at.id}" oninput="formatCommaInput(this)" value="${initVal}" placeholder="금액 입력" class="w-28 p-1.5 bg-white border border-orange-300 rounded-xl text-xs font-bold text-right">
                    <button onclick="applySingleAutoTransfer('${at.id}')" class="px-3.5 py-1.5 btn-orange rounded-xl text-xs shadow-sm whitespace-nowrap">반영</button>
                </div>
            </div>`;
    }).join('');
}

function toggleSelectAllAt(checked) {
    document.querySelectorAll('.at-bulk-chk').forEach(chk => { chk.checked = checked; });
}

function pushAutoTransferToTransactions(at, date, amount, ym) {
    const b = getTypeBehavior(at.type);
    const isTr = (b === 'transfer' || b === 'voucher');
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
        installmentMonths: (b === 'expense' ? (Number(at.installmentMonths) || 1) : 1),
        fromAutoTransfer: true,
        autoTransferId: at.id,
        autoTransferYM: ym
    });
}

function applySingleAutoTransfer(atId) {
    const at = db.autoTransfers.find(a => a.id === atId);
    if (!at) return;
    const ym = formatYM(atYear, atMonth);
    if (findAppliedTxForAutoItem(atId, ym)) return alert('이미 이번 달에 반영된 항목입니다.');

    const date = document.getElementById('atExecDate_' + atId)?.value;
    const amount = parseCommaNumber(document.getElementById('atExecAmt_' + atId)?.value);
    if (!date) return alert('반영할 날짜를 확인해 주세요.');
    if (amount <= 0) return alert('금액을 1원 이상 입력해 주세요.');

    pushAutoTransferToTransactions(at, date, amount, ym);
    saveDb();
}

function applySelectedAutoTransfers() {
    const checked = Array.from(document.querySelectorAll('.at-bulk-chk:checked')).map(el => el.value);
    if (checked.length === 0) return alert('일괄 반영할 항목을 먼저 체크해 주세요.');

    const ym = formatYM(atYear, atMonth);
    let appliedCount = 0;
    const skippedNames = [];

    checked.forEach(atId => {
        const at = db.autoTransfers.find(a => a.id === atId);
        if (!at || findAppliedTxForAutoItem(atId, ym)) return;
        const date = document.getElementById('atExecDate_' + atId)?.value;
        const amount = parseCommaNumber(document.getElementById('atExecAmt_' + atId)?.value);
        if (!date || amount <= 0) {
            skippedNames.push(at.name);
            return;
        }
        pushAutoTransferToTransactions(at, date, amount, ym);
        appliedCount++;
    });

    if (appliedCount > 0) saveDb();
    if (skippedNames.length > 0) {
        alert(`${appliedCount}건 반영 완료.\n금액이 비어 있는 항목(${skippedNames.join(', ')})은 건너뛰었습니다.`);
    }
}

function cancelAutoTransferApply(txId) {
    const tx = db.transactions.find(t => t.id === txId);
    if (!tx) return;
    if (!confirm(`'${tx.memo}' (${Number(tx.amount).toLocaleString()}원) 반영을 취소하고 가계부 내역에서 삭제하시겠습니까?`)) return;
    db.transactions = db.transactions.filter(t => t.id !== txId);
    db.cardEvents = db.cardEvents.filter(e => e.txId !== txId);
    saveDb();
}

// =========================================================
// 정기 항목 등록 · 수정 · 관리 (모바일 접기/펼치기 연동)
// =========================================================
function openAtFormFromHeader() {
    const secBody = document.getElementById('atMasterSectionBody');
    const isMobileHidden = secBody && secBody.classList.contains('hidden') && window.innerWidth < 768;
    if (isMobileHidden) {
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
        const opt1 = document.createElement('option');
        opt1.value = 1; opt1.textContent = '일시불';
        instSel.appendChild(opt1);
        for (let m = 2; m <= 36; m++) {
            const opt = document.createElement('option');
            opt.value = m; opt.textContent = `${m}개월 할부`;
            instSel.appendChild(opt);
        }
    }
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
        document.getElementById('atInstallmentWrap').classList.add('hidden');
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
    document.getElementById('atInstallmentWrap').classList.toggle('hidden', !isCredit);
    if (!isCredit) document.getElementById('atInstallmentMonths').value = '1';
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
    let method = '', targetAsset = '', installmentMonths = 1;
    if (isTr) {
        method = document.getElementById('atFromAccount').value;
        targetAsset = document.getElementById('atToAccount').value;
        if (!method || !targetAsset || method === targetAsset) return alert('출금 계좌와 입금 자산을 서로 다르게 선택해 주세요.');
    } else {
        method = document.getElementById('atMethod').value;
        if (!method) return alert('결제수단 또는 계좌를 선택해 주세요.');
        const asset = findAsset(method);
        if (behavior === 'expense' && asset && asset.type === '신용카드') {
            installmentMonths = Number(document.getElementById('atInstallmentMonths').value) || 1;
        }
    }

    const payload = {
        id: editId || ('AT_' + Date.now()),
        name, user, type, catMain, catSub, method, targetAsset, installmentMonths,
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
    } else {
        db.autoTransfers.push(payload);
    }

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
    if (b === 'transfer' || b === 'voucher') {
        document.getElementById('atFromAccount').value = resolveToAssetId(at.method);
        document.getElementById('atToAccount').value = resolveToAssetId(at.targetAsset);
    } else {
        document.getElementById('atMethod').value = resolveToAssetId(at.method);
        onAtMethodChange();
        document.getElementById('atInstallmentMonths').value = at.installmentMonths || 1;
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
    document.getElementById('atInstallmentMonths').value = '1';
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
        saveDb();
    }
}

function renderAtMasterList() {
    const tbody = document.getElementById('atMasterTableBody');
    const cardList = document.getElementById('atMasterCardList');
    if (!tbody && !cardList) return;
    const nowYM = formatYM(todayObj.getFullYear(), todayObj.getMonth() + 1);

    const allUserItems = (db.autoTransfers || []).filter(at => matchesGlobalUser(at.user));
    const badgeEl = document.getElementById('atMasterTotalBadge');
    if (badgeEl) badgeEl.textContent = `${allUserItems.length}건`;

    let list = allUserItems.filter(at => {
        const isEnded = !!(at.endYM && at.endYM < nowYM);
        const isPaused = (at.active === false);
        if (atMasterFilter === 'active') return !isPaused && !isEnded;
        if (atMasterFilter === 'paused') return isPaused;
        if (atMasterFilter === 'ended') return isEnded;
        return true;
    });

    // 매월(날짜순) 먼저 -> 특정월(월·날짜순) -> 같은 날이면 가나다순
    list.sort((a, b) => {
        const aSpec = a.cycleType === 'specific' ? 1 : 0;
        const bSpec = b.cycleType === 'specific' ? 1 : 0;
        if (aSpec !== bSpec) return aSpec - bSpec;
        if (aSpec === 1) {
            const aFirstM = Array.isArray(a.months) && a.months.length ? Math.min(...a.months) : 99;
            const bFirstM = Array.isArray(b.months) && b.months.length ? Math.min(...b.months) : 99;
            if (aFirstM !== bFirstM) return aFirstM - bFirstM;
        }
        const dayDiff = (Number(a.dayOfMonth) || 1) - (Number(b.dayOfMonth) || 1);
        if (dayDiff !== 0) return dayDiff;
        return compareKorean(a.name, b.name);
    });

    if (list.length === 0) {
        if (tbody) tbody.innerHTML = `<tr><td colspan="6" class="py-8 text-center text-gray-400">해당 조건의 정기 항목이 없습니다.</td></tr>`;
        if (cardList) cardList.innerHTML = `<div class="bg-gray-50 p-6 rounded-2xl border border-gray-100 text-center text-xs text-gray-400">해당 조건의 정기 항목이 없습니다.</div>`;
        return;
    }

    if (tbody) {
        tbody.innerHTML = list.map(at => {
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

            return `
                <tr class="hover:bg-orange-50/30 ${isPaused || isEnded ? 'opacity-60' : ''}">
                    <td class="py-2.5 px-3 whitespace-nowrap">${statusBadge}</td>
                    <td class="py-2.5 px-3">
                        <div class="font-bold text-gray-800">${escHtml(at.name)} ${Number(at.installmentMonths) > 1 ? `<span class="text-[10px] px-1 rounded bg-pink-100 text-pink-800">${at.installmentMonths}개월</span>` : ''}</div>
                        <div class="text-[10px] text-gray-400">${escHtml(at.user)} · ${escHtml(at.type)} (${escHtml(at.catMain)}${at.catSub ? '/' + escHtml(at.catSub) : ''})</div>
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
        }).join('');
    }

    if (cardList) {
        cardList.innerHTML = list.map(at => {
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
                        </div>
                        <div class="shrink-0">${amtHtml}</div>
                    </div>
                    <div class="text-[11px] text-gray-500 space-y-0.5">
                        <div>${escHtml(at.user)} · ${escHtml(at.type)} (${escHtml(at.catMain)}${at.catSub ? '/' + escHtml(at.catSub) : ''})</div>
                        <div><b class="text-gray-700">${cycleLabel}</b> · ${at.startYM || '-'} ~ ${at.endYM || '무기한'}${at.shiftBusinessDay ? ' · 영업일' : ''}</div>
                        <div class="truncate">수단: ${escHtml(methodDisplay)}</div>
                    </div>
                    <div class="flex justify-end gap-1.5 pt-2 border-t border-gray-100">
                        <button onclick="toggleAtActive('${at.id}')" class="px-2.5 py-1 bg-amber-50 hover:bg-amber-100 rounded-lg text-amber-800 font-bold text-[11px] whitespace-nowrap">${isPaused ? '재개' : '중지'}</button>
                        <button onclick="startEditAt('${at.id}')" class="px-2.5 py-1 bg-gray-100 hover:bg-gray-200 rounded-lg text-gray-700 font-bold text-[11px] whitespace-nowrap">수정</button>
                        <button onclick="deleteAt('${at.id}')" class="px-2.5 py-1 bg-red-50 hover:bg-red-100 rounded-lg text-red-600 font-bold text-[11px] whitespace-nowrap">삭제</button>
                    </div>
                </div>`;
        }).join('');
    }
}