'use strict';

const CONFIG = {
  API_URL: 'https://script.google.com/macros/s/AKfycbyXftSTcUrp1V7wGl2uXa7nplDbKtuSXot-IwoGlViDQoiw8RyzRxbFMIxKSGvi60VH/exec',
  SPREADSHEET_ID: '1B2JX2vPdMMxY8v-ZEkfnSxETpCc5A431qyi15CwLjbg',
  MASTER_SHEET: 'MASTER DATA',
  STAFF_SHEET: 'STAFF',
  LOGO_FILE_ID: '155EMzz-V3xXlB73YO12TP7hPXA1i1jVN',
  DEFAULT_ROWS: 5,
  MAX_ROWS: 100,
  ROW_STEP: 5,
  CURRENCY: '両',
  GLOBAL_SYNC_INTERVAL_MS: 30000
};

const state = {
  master: [],
  masterMap: new Map(),
  staff: [],
  providersOffice: [],
  providersReward: [],
  teller: null,
  currentAccount: null,
  currentTransactions: [],
  reportRows: [],
  syncingSharedData: false
};

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

const els = {};

document.addEventListener('DOMContentLoaded', async () => {
  cacheElements();
  setBrandAssets();
  bindGlobalEvents();
  populateRowCountSelects();
  setDefaultMonth();
  renderAllBatchGrids();

  try {
    await Promise.all([loadMasterData(), loadStaffDirectory()]);
    populateStaffSelectors();
    renderAllBatchGrids();
  } catch (error) {
    console.error(error);
    toast('Public spreadsheet data could not be loaded. Check sharing permissions.', 'error');
  }

  startGlobalSync();
});

function cacheElements() {
  [
    'headerSearchForm','headerSearchInput','heroSearchForm','heroSearchInput','welcomeView','accountView',
    'profilePhoto','profileStatusBadge','profileName','profileKanji','profileAccount','profileX','profileBalance',
    'balanceStatusText','transactionTableBody','transactionCount','transactionEmpty','refreshAccountButton',
    'tellerButton','tellerLoginModal','tellerLoginForm','tellerIdInput','tellerPasswordInput','tellerWorkspace',
    'loggedTellerName','loggedTellerId','tellerLogoutButton','closeWorkspaceButton','tellerNav','workspaceTitle',
    'loadingOverlay','loadingText','toastRegion','reportMonth','loadReportButton','exportPdfButton','exportPngButton',
    'reportMonthLabel','reportTableBody','reportEmpty','reportDocument','editTransactionModal','editTransactionForm',
    'editTransactionId','editTransactionDate','editTransactionAmount','editTransactionDescription','editTransactionStaff',
    'bankLogo','workspaceLogo','tellerLoginLogo','tellerPasswordToggle','allAccountSearch','allAccountStatusFilter','allAccountTableBody',
    'allAccountTotal','allAccountBalance','allAccountActive','allAccountFrozen','allAccountCountLabel'
  ].forEach(id => els[id] = document.getElementById(id));
}

function setBrandAssets() {
  const logo = `https://drive.google.com/thumbnail?id=${CONFIG.LOGO_FILE_ID}&sz=w1000`;
  els.bankLogo.src = logo;
  els.workspaceLogo.src = logo;
  if (els.tellerLoginLogo) els.tellerLoginLogo.src = logo;
}

function bindGlobalEvents() {
  els.headerSearchForm.addEventListener('submit', e => {
    e.preventDefault();
    searchAccount(els.headerSearchInput.value);
  });

  els.heroSearchForm.addEventListener('submit', e => {
    e.preventDefault();
    const value = els.heroSearchInput.value.trim();
    els.headerSearchInput.value = value;
    searchAccount(value);
  });

  els.refreshAccountButton.addEventListener('click', () => {
    if (state.currentAccount) searchAccount(state.currentAccount, true);
  });

  els.tellerButton.addEventListener('click', () => openModal('tellerLoginModal'));
  els.tellerLoginForm.addEventListener('submit', loginTeller);
  if (els.tellerPasswordToggle) {
    els.tellerPasswordToggle.addEventListener('click', toggleTellerPasswordVisibility);
  }
  els.tellerLogoutButton.addEventListener('click', logoutTeller);
  els.closeWorkspaceButton.addEventListener('click', closeTellerWorkspace);

  $$('[data-close-modal]').forEach(el => {
    el.addEventListener('click', () => closeModal(el.dataset.closeModal));
  });

  els.tellerNav.addEventListener('click', event => {
    const button = event.target.closest('[data-panel]');
    if (!button) return;
    switchTellerPanel(button.dataset.panel, button);
  });

  $$('.row-count-select').forEach(select => {
    select.addEventListener('change', () => renderBatchGridFromSelect(select.id));
  });

  $$('[data-process]').forEach(button => {
    button.addEventListener('click', () => processBatch(button.dataset.process, button));
  });

  els.loadReportButton.addEventListener('click', loadMonthlyReport);
  els.reportMonth.addEventListener('change', loadMonthlyReport);
  els.exportPdfButton.addEventListener('click', exportReportPdf);
  els.exportPngButton.addEventListener('click', exportReportPng);
  els.reportTableBody.addEventListener('click', handleReportAction);
  els.allAccountSearch.addEventListener('input', renderAllAccounts);
  els.allAccountStatusFilter.addEventListener('change', renderAllAccounts);
  els.editTransactionForm.addEventListener('submit', saveTransactionRevision);
  els.editTransactionAmount.addEventListener('input', formatMoneyInput);

  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      $$('.modal-shell:not(.is-hidden)').forEach(modal => closeModal(modal.id));
    }
  });
}

function populateRowCountSelects() {
  $$('.row-count-select').forEach(select => {
    select.innerHTML = '';
    for (let i = CONFIG.ROW_STEP; i <= CONFIG.MAX_ROWS; i += CONFIG.ROW_STEP) {
      const option = document.createElement('option');
      option.value = String(i);
      option.textContent = String(i);
      if (i === CONFIG.DEFAULT_ROWS) option.selected = true;
      select.appendChild(option);
    }
  });
}

function setDefaultMonth() {
  const now = new Date();
  els.reportMonth.value = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

async function loadMasterData() {
  const rows = await fetchGvizSheet(CONFIG.MASTER_SHEET, 'select B,C,D,E,F,G,H', 1);
  state.master = rows
    .map(row => ({
      status: cellText(row[0]),
      account: cellText(row[1]),
      name: cellText(row[2]),
      kanji: cellText(row[3]),
      x: cellText(row[4]),
      photo: cellText(row[5]),
      balance: cellText(row[6])
    }))
    .filter(x => x.account);

  state.masterMap = new Map(state.master.map(item => [normalizeAccount(item.account), item]));
  state.providersOffice = state.master.filter(item => normalizeStatus(item.status).includes('OFFICE/SHOP'));
  state.providersReward = state.master.filter(item => {
    const status = normalizeStatus(item.status);
    return status.includes('OFFICE/SHOP') || status.includes('STAFF');
  });

  populateAllAccountStatusFilter();
  renderAllAccounts();
}

async function loadStaffDirectory() {
  const rows = await fetchGvizSheet(CONFIG.STAFF_SHEET, 'select A,B', 1);
  state.staff = rows
    .map(row => ({ id: cellText(row[0]), name: cellText(row[1]) }))
    .filter(x => x.id && x.name);
}

async function verifyTellerCredentials(id, password) {
  const escaped = gvizString(id);
  const rows = await fetchGvizSheet(CONFIG.STAFF_SHEET, `select A,B,E where A = '${escaped}'`, 1);
  const match = rows
    .map(row => ({ id: cellText(row[0]), name: cellText(row[1]), password: cellText(row[2]) }))
    .find(x => x.id === id);

  if (!match || !match.password || match.password !== password) return null;
  return { id: match.id, name: match.name };
}

async function fetchGvizSheet(sheet, query, headers = 1) {
  const url = `https://docs.google.com/spreadsheets/d/${CONFIG.SPREADSHEET_ID}/gviz/tq?sheet=${encodeURIComponent(sheet)}&headers=${headers}&tqx=out:json&tq=${encodeURIComponent(query)}&_=${Date.now()}`;
  const response = await fetch(url, { redirect: 'follow', cache: 'no-store' });
  if (!response.ok) throw new Error(`Sheet request failed (${response.status})`);
  const text = await response.text();
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end < 0) throw new Error('Invalid spreadsheet response');
  const json = JSON.parse(text.slice(start, end + 1));
  return (json.table?.rows || []).map(row => (row.c || []).map(cell => cell));
}

function cellText(cell) {
  if (!cell) return '';
  if (cell.f !== undefined && cell.f !== null) return String(cell.f).trim();
  if (cell.v !== undefined && cell.v !== null) return String(cell.v).trim();
  return '';
}

async function refreshSharedData() {
  if (state.syncingSharedData) return;
  state.syncingSharedData = true;

  try {
    await Promise.all([loadMasterData(), loadStaffDirectory()]);
    populateStaffSelectors();
    refreshProviderSelectOptions();
  } catch (error) {
    console.warn('ZAIGEN global sync failed:', error);
  } finally {
    state.syncingSharedData = false;
  }
}

function startGlobalSync() {
  // Every write is already sent to the shared Apps Script backend.
  // These refresh hooks make open devices re-read shared spreadsheet state
  // instead of relying on a device-local snapshot.
  window.addEventListener('focus', refreshSharedData);

  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) refreshSharedData();
  });

  window.setInterval(() => {
    if (!document.hidden) refreshSharedData();
  }, CONFIG.GLOBAL_SYNC_INTERVAL_MS);
}

function refreshProviderSelectOptions() {
  $$('.batch-row').forEach(row => {
    const select = $('.js-provider-account', row);
    if (!select) return;

    const current = select.value;
    const providers = row.dataset.type === 'SALARY'
      ? state.providersOffice
      : state.providersReward;

    select.innerHTML = '<option value="">Select provider</option>' + providers
      .map(item => `<option value="${escapeAttr(item.account)}">${escapeHtml(item.account)} — ${escapeHtml(item.name)}</option>`)
      .join('');

    if (providers.some(item => item.account === current)) {
      select.value = current;
    }
  });
}

async function loadPublicAccountTransactions(account) {
  // Read A:E so paired transaction IDs (-D / -C) can be matched.
  // This lets the public ledger show who sent a credit and who received a debit.
  const rows = await fetchGvizSheet('TRANSACTION LOG', 'select A,B,C,D,E', 1);
  const target = normalizeAccount(account);

  const allTransactions = rows
    .map(row => ({
      txId: cellText(row[0]),
      date: cellText(row[1]),
      accountNumber: cellText(row[2]),
      log: cellText(row[3]),
      description: cellText(row[4])
    }))
    .filter(row => row.accountNumber);

  const byTxId = new Map(
    allTransactions
      .filter(row => row.txId)
      .map(row => [row.txId, row])
  );

  return allTransactions
    .filter(row => normalizeAccount(row.accountNumber) === target)
    .map(row => ({
      ...row,
      ...resolveTransactionCounterparty(row, byTxId)
    }))
    .reverse();
}

function resolveTransactionCounterparty(row, byTxId) {
  const txId = String(row.txId || '').trim();
  const amount = parseMoney(row.log);

  let role = amount < 0 ? 'Recipient' : amount > 0 ? 'Sender' : '';
  let counterpart = null;

  if (txId && /-D$/i.test(txId)) {
    role = 'Recipient';
    counterpart = byTxId.get(txId.replace(/-D$/i, '-C')) || null;
  } else if (txId && /-C$/i.test(txId)) {
    role = 'Sender';
    counterpart = byTxId.get(txId.replace(/-C$/i, '-D')) || null;
  }

  const counterpartyAccount = counterpart
    ? normalizeAccount(counterpart.accountNumber)
    : '';

  const masterRecord = counterpartyAccount
    ? state.masterMap.get(counterpartyAccount)
    : null;

  return {
    counterpartyRole: role,
    counterpartyAccount,
    counterpartyName: masterRecord?.name || ''
  };
}

function populateAllAccountStatusFilter() {
  if (!els.allAccountStatusFilter) return;
  const current = els.allAccountStatusFilter.value;
  const statuses = [...new Set(state.master.map(item => item.status).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b));
  els.allAccountStatusFilter.innerHTML = '<option value="">All statuses</option>' + statuses
    .map(status => `<option value="${escapeAttr(status)}">${escapeHtml(status)}</option>`)
    .join('');
  if (statuses.includes(current)) els.allAccountStatusFilter.value = current;
}

function renderAllAccounts() {
  if (!els.allAccountTableBody) return;

  const query = String(els.allAccountSearch?.value || '').trim().toLowerCase();
  const statusFilter = String(els.allAccountStatusFilter?.value || '').trim();
  const filtered = state.master.filter(item => {
    const haystack = `${item.account} ${item.name} ${item.kanji} ${item.status} ${item.x}`.toLowerCase();
    const matchesQuery = !query || haystack.includes(query);
    const matchesStatus = !statusFilter || item.status === statusFilter;
    return matchesQuery && matchesStatus;
  });

  const totalBalance = state.master.reduce((sum, item) => sum + parseMoney(item.balance), 0);
  const frozen = state.master.filter(item => isFrozenStatus(item.status)).length;
  const active = state.master.length - frozen;

  els.allAccountTotal.textContent = state.master.length.toLocaleString('en-US');
  els.allAccountBalance.textContent = formatCurrency(totalBalance);
  els.allAccountActive.textContent = active.toLocaleString('en-US');
  els.allAccountFrozen.textContent = frozen.toLocaleString('en-US');
  els.allAccountCountLabel.textContent = `${filtered.length.toLocaleString('en-US')} account${filtered.length === 1 ? '' : 's'}`;

  els.allAccountTableBody.innerHTML = filtered.map(item => {
    const frozenAccount = isFrozenStatus(item.status);
    const xUrl = xProfileUrl(item.x);
    const xLabel = cleanXUsername(item.x);
    return `
      <tr class="${frozenAccount ? 'account-row-frozen' : ''}">
        <td><strong>${escapeHtml(item.account)}</strong></td>
        <td>${escapeHtml(item.name || '—')}</td>
        <td class="kanji-cell">${escapeHtml(item.kanji || '—')}</td>
        <td><span class="directory-status ${frozenAccount ? 'frozen' : ''}">${escapeHtml(item.status || '—')}</span></td>
        <td>${xUrl ? `<a href="${escapeAttr(xUrl)}" target="_blank" rel="noopener noreferrer">@${escapeHtml(xLabel)}</a>` : '—'}</td>
        <td class="money-col"><strong>${escapeHtml(formatCurrency(item.balance))}</strong></td>
      </tr>`;
  }).join('');
}

function cleanXUsername(value) {
  let username = String(value || '').trim();
  if (!username) return '';
  username = username.replace(/^@/, '');
  username = username
    .replace(/^https?:\/\/(www\.)?x\.com\//i, '')
    .replace(/^https?:\/\/(www\.)?twitter\.com\//i, '');
  return username.split(/[/?#]/)[0];
}

function xProfileUrl(value) {
  const username = cleanXUsername(value);
  return username ? `https://x.com/${encodeURIComponent(username)}` : '';
}

async function searchAccount(rawAccount, silent = false) {
  const account = normalizeAccount(rawAccount);
  if (!account) {
    toast('Enter an account number first.', 'error');
    return;
  }

  showLoading('Opening ledger…');
  try {
    const result = await apiGet({ action: 'account', account });
    if (!result.success) throw new Error(result.message || 'Account not found');

    state.currentAccount = account;
    let ledgerRows = null;
    try {
      ledgerRows = await loadPublicAccountTransactions(account);
    } catch (ledgerError) {
      console.warn('Public TRANSACTION LOG fallback failed:', ledgerError);
    }
    state.currentTransactions = ledgerRows !== null ? ledgerRows : (result.transactions || []);
    renderProfile(result.profile);
    renderTransactions(state.currentTransactions);

    els.welcomeView.classList.add('is-hidden');
    els.accountView.classList.remove('is-hidden');
    els.headerSearchInput.value = account;
    els.heroSearchInput.value = account;
    if (!silent) window.scrollTo({ top: 0, behavior: 'smooth' });
  } catch (error) {
    toast(error.message || 'Unable to open account.', 'error');
  } finally {
    hideLoading();
  }
}

function renderProfile(profile) {
  if (!profile) return;
  const status = profile.status || '—';
  const frozen = isFrozenStatus(status);
  els.profileName.textContent = profile.name || '—';
  els.profileKanji.textContent = profile.kanjiName || '—';
  els.profileAccount.textContent = profile.accountNumber || '—';
  els.profileStatusBadge.textContent = status;
  els.profilePhoto.src = normalizeImageUrl(profile.photo);
  els.profilePhoto.onerror = () => { els.profilePhoto.src = fallbackAvatar(profile.name); };
  els.profileBalance.textContent = formatCurrency(profile.balance);
  els.balanceStatusText.textContent = frozen ? 'FROZEN ACCOUNT' : 'ACTIVE LEDGER';
  els.balanceStatusText.style.color = frozen ? '#e5837c' : '';

  if (profile.xUrl) {
    els.profileX.href = profile.xUrl;
    els.profileX.textContent = profile.xUsername ? `@${profile.xUsername}` : 'Open X profile';
  } else {
    els.profileX.removeAttribute('href');
    els.profileX.textContent = '—';
  }
}

function renderTransactions(rows) {
  els.transactionTableBody.innerHTML = '';
  els.transactionCount.textContent = `${rows.length} record${rows.length === 1 ? '' : 's'}`;
  els.transactionEmpty.classList.toggle('is-hidden', rows.length !== 0);

  rows.forEach(row => {
    const amount = parseMoney(row.log);
    const counterparty = transactionCounterpartyHtml(row, amount);
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${escapeHtml(formatDateDisplay(row.date || row.transactionDate || ''))}</td>
      <td><span class="log-pill">${escapeHtml(transactionLabel(amount))}</span></td>
      <td>${counterparty}</td>
      <td>${escapeHtml(row.description || row.keterangan || '—')}</td>
      <td class="money-col ${amount < 0 ? 'amount-negative' : 'amount-positive'}">${escapeHtml(formatCurrency(amount, true))}</td>
    `;
    els.transactionTableBody.appendChild(tr);
  });
}

function transactionCounterpartyHtml(row, amount) {
  const role = row.counterpartyRole || (amount < 0 ? 'Recipient' : amount > 0 ? 'Sender' : '');
  const name = row.counterpartyName || '';
  const account = row.counterpartyAccount || '';

  if (!role) {
    return '<span class="counterparty-empty">—</span>';
  }

  return `
    <div class="counterparty-cell">
      <span>${escapeHtml(role)}</span>
      <strong>${escapeHtml(name || '—')}</strong>
      ${account ? `<small>${escapeHtml(account)}</small>` : ''}
    </div>
  `;
}

function transactionLabel(amount) {
  if (amount < 0) return 'DEBIT';
  if (amount > 0) return 'CREDIT';
  return 'ENTRY';
}

function toggleTellerPasswordVisibility() {
  const makeVisible = els.tellerPasswordInput.type === 'password';
  setTellerPasswordVisibility(makeVisible);
}

function setTellerPasswordVisibility(visible) {
  els.tellerPasswordInput.type = visible ? 'text' : 'password';

  if (!els.tellerPasswordToggle) return;
  els.tellerPasswordToggle.classList.toggle('is-visible', visible);
  els.tellerPasswordToggle.setAttribute('aria-pressed', String(visible));
  els.tellerPasswordToggle.setAttribute('aria-label', visible ? 'Hide password' : 'Show password');
}

async function loginTeller(event) {
  event.preventDefault();
  const id = els.tellerIdInput.value.trim();
  const password = els.tellerPasswordInput.value;
  if (!id || !password) return;

  showLoading('Verifying teller access…');
  try {
    const teller = await verifyTellerCredentials(id, password);
    if (!teller) throw new Error('Teller login rejected. Staff ID or password does not match the STAFF sheet.');

    state.teller = teller;
    els.loggedTellerName.textContent = teller.name;
    els.loggedTellerId.textContent = teller.id;
    closeModal('tellerLoginModal');
    openTellerWorkspace();
    toast(`Teller access granted to ${teller.name}.`, 'success');
  } catch (error) {
    toast(error.message, 'error');
  } finally {
    hideLoading();
    els.tellerPasswordInput.value = '';
    setTellerPasswordVisibility(false);
  }
}

function logoutTeller() {
  state.teller = null;
  closeTellerWorkspace();
  els.tellerIdInput.value = '';
  els.tellerPasswordInput.value = '';
  setTellerPasswordVisibility(false);
  toast('Teller session closed.');
}

function openTellerWorkspace() {
  if (!state.teller) return;
  els.tellerWorkspace.classList.remove('is-hidden');
  els.tellerWorkspace.setAttribute('aria-hidden', 'false');
  document.body.style.overflow = 'hidden';
}

function closeTellerWorkspace() {
  els.tellerWorkspace.classList.add('is-hidden');
  els.tellerWorkspace.setAttribute('aria-hidden', 'true');
  document.body.style.overflow = '';
}

function switchTellerPanel(panelId, button) {
  $$('.teller-panel').forEach(panel => panel.classList.toggle('active', panel.id === panelId));
  $$('#tellerNav button').forEach(btn => btn.classList.toggle('active', btn === button));
  const titleMap = {
    lastBalancePanel: 'Last Saldo Input',
    transferPanel: 'Personal Transfer',
    salaryPanel: 'Shop & Office Salary / Royalty',
    rewardPanel: 'Reward',
    reportsPanel: 'Transaction Inputs',
    allAccountsPanel: 'All Accounts'
  };
  els.workspaceTitle.textContent = titleMap[panelId] || 'Teller Desk';
  if (panelId === 'reportsPanel') loadMonthlyReport();
  if (panelId === 'allAccountsPanel') {
    refreshSharedData().then(renderAllAccounts);
  }
}

function renderAllBatchGrids() {
  renderBatchGrid('LAST_SALDO', Number($('#lastBalanceRows')?.value || CONFIG.DEFAULT_ROWS));
  renderBatchGrid('TRANSFER', Number($('#transferRows')?.value || CONFIG.DEFAULT_ROWS));
  renderBatchGrid('SALARY', Number($('#salaryRows')?.value || CONFIG.DEFAULT_ROWS));
  renderBatchGrid('REWARD', Number($('#rewardRows')?.value || CONFIG.DEFAULT_ROWS));
}

function renderBatchGridFromSelect(selectId) {
  const map = {
    lastBalanceRows: 'LAST_SALDO',
    transferRows: 'TRANSFER',
    salaryRows: 'SALARY',
    rewardRows: 'REWARD'
  };
  const select = document.getElementById(selectId);
  renderBatchGrid(map[selectId], Number(select.value));
}

function renderBatchGrid(type, count) {
  const config = batchConfig(type);
  const container = document.getElementById(config.gridId);
  if (!container) return;
  container.innerHTML = '';

  for (let i = 0; i < count; i++) {
    const row = document.createElement('div');
    row.className = `batch-row ${config.className}`;
    row.dataset.type = type;
    row.dataset.index = String(i);
    row.innerHTML = buildBatchRowHtml(type, i + 1);
    container.appendChild(row);
    bindBatchRowEvents(row, type);
  }
}

function batchConfig(type) {
  return {
    LAST_SALDO: { gridId: 'lastBalanceGrid', staffId: 'lastBalanceStaff', className: 'last-saldo' },
    TRANSFER: { gridId: 'transferGrid', staffId: 'transferStaff', className: 'transfer' },
    SALARY: { gridId: 'salaryGrid', staffId: 'salaryStaff', className: 'provider' },
    REWARD: { gridId: 'rewardGrid', staffId: 'rewardStaff', className: 'provider' }
  }[type];
}

function buildBatchRowHtml(type, number) {
  const today = dateInputValue(new Date());
  const index = `<div class="batch-index">${String(number).padStart(2, '0')}</div>`;
  const date = fieldHtml('Date', `<input class="batch-input js-date" type="date" value="${today}">`);
  const amount = fieldHtml('Amount', `<div class="currency-input"><span>${CONFIG.CURRENCY}</span><input class="js-amount" type="text" inputmode="numeric" placeholder="0"></div>`);
  const description = fieldHtml('Description', `<input class="batch-input js-description" type="text" placeholder="Required">`);

  if (type === 'LAST_SALDO') {
    return [
      index,
      date,
      accountFieldHtml('Recipient account', 'js-recipient-account'),
      readonlyNameFieldHtml('Recipient name', 'js-recipient-name'),
      amount,
      fieldHtml('Description', `<input class="batch-input js-description" type="text" value="Saldo akhir" placeholder="Required">`)
    ].join('');
  }

  if (type === 'TRANSFER') {
    return [
      index,
      date,
      accountFieldHtml('Sender account', 'js-sender-account'),
      readonlyNameFieldHtml('Sender name', 'js-sender-name'),
      accountFieldHtml('Recipient account', 'js-recipient-account'),
      readonlyNameFieldHtml('Recipient name', 'js-recipient-name'),
      amount,
      description
    ].join('');
  }

  const providers = type === 'SALARY' ? state.providersOffice : state.providersReward;
  const providerOptions = ['<option value="">Select provider</option>']
    .concat(providers.map(item => `<option value="${escapeAttr(item.account)}">${escapeHtml(item.account)} — ${escapeHtml(item.name)}</option>`))
    .join('');

  return [
    index,
    date,
    fieldHtml('Provider', `<select class="batch-select js-provider-account">${providerOptions}</select>`),
    accountFieldHtml('Recipient account', 'js-recipient-account'),
    readonlyNameFieldHtml('Recipient name', 'js-recipient-name'),
    amount,
    description
  ].join('');
}

function fieldHtml(label, control) {
  return `<div class="batch-field"><label>${label}</label>${control}<div class="account-warning"></div></div>`;
}

function accountFieldHtml(label, className) {
  return fieldHtml(label, `<input class="batch-input ${className}" type="text" autocomplete="off" placeholder="Account no.">`);
}

function readonlyNameFieldHtml(label, className) {
  return fieldHtml(label, `<input class="batch-input ${className}" type="text" value="" readonly placeholder="Auto-filled">`);
}

function bindBatchRowEvents(row, type) {
  $$('.js-amount', row).forEach(input => input.addEventListener('input', formatMoneyInput));
  $$('.js-sender-account, .js-recipient-account', row).forEach(input => {
    input.addEventListener('input', () => resolveBatchAccount(row, input, type));
    input.addEventListener('blur', () => resolveBatchAccount(row, input, type));
  });
  const provider = $('.js-provider-account', row);
  if (provider) provider.addEventListener('change', () => validateWholeBatchRow(row, type));
}

function resolveBatchAccount(row, input, type) {
  const account = normalizeAccount(input.value);
  const isSender = input.classList.contains('js-sender-account');
  const nameInput = isSender ? $('.js-sender-name', row) : $('.js-recipient-name', row);
  const field = input.closest('.batch-field');
  const warning = $('.account-warning', field);
  warning.textContent = '';
  row.classList.remove('frozen');

  if (!account) {
    if (nameInput) nameInput.value = '';
    return;
  }

  const record = state.masterMap.get(account);
  if (!record) {
    if (nameInput) nameInput.value = '';
    warning.textContent = 'Account not found';
    return;
  }

  if (nameInput) nameInput.value = record.name || '';
  if (isFrozenStatus(record.status)) {
    warning.textContent = 'FROZEN — transactions are prohibited';
    row.classList.add('frozen');
  }

  validateWholeBatchRow(row, type);
}

function validateWholeBatchRow(row, type) {
  const accounts = [];
  if (type === 'TRANSFER') accounts.push($('.js-sender-account', row)?.value, $('.js-recipient-account', row)?.value);
  if (type === 'LAST_SALDO') accounts.push($('.js-recipient-account', row)?.value);
  if (type === 'SALARY' || type === 'REWARD') accounts.push($('.js-provider-account', row)?.value, $('.js-recipient-account', row)?.value);
  const frozen = accounts.filter(Boolean).some(account => {
    const record = state.masterMap.get(normalizeAccount(account));
    return record && isFrozenStatus(record.status);
  });
  row.classList.toggle('frozen', frozen);
}

function formatMoneyInput(event) {
  const input = event.target;
  const raw = input.value.replace(/[^0-9]/g, '');
  input.dataset.rawValue = raw;
  input.value = raw ? Number(raw).toLocaleString('en-US') : '';
}

function populateStaffSelectors() {
  $$('.staff-select').forEach(select => {
    const current = select.value;
    select.innerHTML = '<option value="">Select staff</option>' + state.staff
      .map(staff => `<option value="${escapeAttr(staff.id)}">${escapeHtml(staff.name)} — ${escapeHtml(staff.id)}</option>`)
      .join('');
    if (state.staff.some(s => s.id === current)) select.value = current;
  });
}

async function processBatch(type, button) {
  if (!state.teller) {
    toast('Teller session is required.', 'error');
    return;
  }

  const config = batchConfig(type);
  const staffSelect = document.getElementById(config.staffId);
  const inputStaffId = staffSelect.value;
  const inputStaff = state.staff.find(x => x.id === inputStaffId);
  if (!inputStaff) {
    toast('Select the staff member responsible for this input.', 'error');
    staffSelect.focus();
    return;
  }

  const rows = $$('.batch-row', document.getElementById(config.gridId));
  const entries = [];

  try {
    rows.forEach(row => {
      const entry = extractBatchRow(type, row);
      if (entry) entries.push(entry);
    });
  } catch (error) {
    toast(error.message, 'error');
    return;
  }

  if (!entries.length) {
    toast('There are no completed transaction rows to process.', 'error');
    return;
  }

  const payload = {
    type,
    tellerId: state.teller.id,
    tellerName: state.teller.name,
    inputStaffId: inputStaff.id,
    inputStaffName: inputStaff.name,
    entries
  };

  button.disabled = true;
  showLoading(`Processing ${entries.length} transaction input${entries.length > 1 ? 's' : ''}…`);
  try {
    const result = await apiPost('batchTransaction', payload);
    if (!result.success) throw new Error(result.message || 'Transaction batch failed');
    toast(`${result.processed || entries.length} input${entries.length > 1 ? 's' : ''} processed successfully.`, 'success');
    await refreshSharedData();
    renderBatchGrid(type, rows.length);
    if (state.currentAccount) await searchAccount(state.currentAccount, true);
    if ($('#reportsPanel').classList.contains('active')) await loadMonthlyReport();
  } catch (error) {
    toast(error.message || 'Transaction batch failed.', 'error');
  } finally {
    button.disabled = false;
    hideLoading();
  }
}

function extractBatchRow(type, row) {
  const date = $('.js-date', row)?.value || '';
  const amountRaw = $('.js-amount', row)?.dataset.rawValue || $('.js-amount', row)?.value.replace(/,/g, '') || '';
  const amount = Number(amountRaw);
  const description = $('.js-description', row)?.value.trim() || '';

  const values = [...$$('input:not([readonly]), select', row)].map(el => String(el.value || '').trim());
  const hasAny = values.some(Boolean);
  const accountsOnly = type === 'LAST_SALDO'
    ? $('.js-recipient-account', row)?.value.trim()
    : type === 'TRANSFER'
      ? `${$('.js-sender-account', row)?.value.trim() || ''}${$('.js-recipient-account', row)?.value.trim() || ''}`
      : `${$('.js-provider-account', row)?.value.trim() || ''}${$('.js-recipient-account', row)?.value.trim() || ''}`;

  // A pristine row contains a default date, so date alone must not count as "filled".
  const meaningful = Boolean(accountsOnly || amountRaw || description && !(type === 'LAST_SALDO' && description === 'Saldo akhir'));
  if (!meaningful && hasAny) return null;
  if (!meaningful) return null;

  if (!date) throw new Error('Every used row must have a date.');
  if (!amountRaw || !Number.isFinite(amount) || amount <= 0) throw new Error('Every used row must contain an amount greater than zero.');
  if (!description) throw new Error('Description is mandatory for every transaction.');

  if (type === 'LAST_SALDO') {
    const recipient = requireValidAccount($('.js-recipient-account', row)?.value, 'recipient');
    return { date, recipient: recipient.account, amount, description };
  }

  if (type === 'TRANSFER') {
    const sender = requireValidAccount($('.js-sender-account', row)?.value, 'sender');
    const recipient = requireValidAccount($('.js-recipient-account', row)?.value, 'recipient');
    if (sender.account === recipient.account) throw new Error(`Sender and recipient cannot be the same account (${sender.account}).`);
    return { date, sender: sender.account, recipient: recipient.account, amount, description };
  }

  const providerValue = $('.js-provider-account', row)?.value;
  const provider = requireValidAccount(providerValue, 'provider');
  const recipient = requireValidAccount($('.js-recipient-account', row)?.value, 'recipient');
  if (provider.account === recipient.account) throw new Error(`Provider and recipient cannot be the same account (${provider.account}).`);

  if (type === 'SALARY' && !normalizeStatus(provider.status).includes('OFFICE/SHOP')) {
    throw new Error(`Provider ${provider.account} is not an OFFICE/SHOP account.`);
  }
  if (type === 'REWARD') {
    const status = normalizeStatus(provider.status);
    if (!status.includes('OFFICE/SHOP') && !status.includes('STAFF')) {
      throw new Error(`Provider ${provider.account} is not eligible for Reward.`);
    }
  }
  return { date, provider: provider.account, recipient: recipient.account, amount, description };
}

function requireValidAccount(raw, role) {
  const account = normalizeAccount(raw);
  if (!account) throw new Error(`A ${role} account is required.`);
  const record = state.masterMap.get(account);
  if (!record) throw new Error(`${roleLabel(role)} account ${account} was not found.`);
  if (isFrozenStatus(record.status)) throw new Error(`${roleLabel(role)} account ${account} is frozen (${record.status}) and cannot transact.`);
  return record;
}

function roleLabel(role) {
  return role.charAt(0).toUpperCase() + role.slice(1);
}

async function loadMonthlyReport() {
  if (!state.teller || !els.reportMonth.value) return;
  showLoading('Loading monthly register…');
  try {
    const result = await apiGet({ action: 'monthlyLog', month: els.reportMonth.value });
    if (!result.success) throw new Error(result.message || 'Unable to load report');
    state.reportRows = result.data || [];
    renderMonthlyReport(state.reportRows, els.reportMonth.value);
  } catch (error) {
    toast(error.message, 'error');
  } finally {
    hideLoading();
  }
}

function renderMonthlyReport(rows, month) {
  els.reportTableBody.innerHTML = '';
  els.reportMonthLabel.textContent = monthLabel(month);
  els.reportEmpty.classList.toggle('is-hidden', rows.length !== 0);

  rows.forEach(row => {
    const amount = parseMoney(row.log);
    const canEdit = Boolean(row.canEdit && row.txId);
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${escapeHtml(formatDateDisplay(row.date))}</td>
      <td>${escapeHtml(row.accountNumber || '')}</td>
      <td>${escapeHtml(row.name || '—')}</td>
      <td>${escapeHtml(row.description || '—')}</td>
      <td>${escapeHtml(row.staffName || '—')}</td>
      <td class="money-col ${amount < 0 ? 'amount-negative' : 'amount-positive'}">${escapeHtml(formatCurrency(amount, true))}</td>
      <td class="report-action-col">
        <div class="action-buttons">
          <button type="button" data-edit-tx="${escapeAttr(row.txId || '')}" ${canEdit ? '' : 'disabled'}>EDIT</button>
          <button type="button" class="danger" data-delete-tx="${escapeAttr(row.txId || '')}" ${canEdit ? '' : 'disabled'}>DELETE</button>
        </div>
      </td>
    `;
    els.reportTableBody.appendChild(tr);
  });
}

function handleReportAction(event) {
  const edit = event.target.closest('[data-edit-tx]');
  const del = event.target.closest('[data-delete-tx]');
  if (edit && !edit.disabled) openEditTransaction(edit.dataset.editTx);
  if (del && !del.disabled) deleteTransaction(del.dataset.deleteTx);
}

function openEditTransaction(txId) {
  const row = state.reportRows.find(x => x.txId === txId);
  if (!row) return;
  els.editTransactionId.value = txId;
  els.editTransactionDate.value = normalizeDateForInput(row.date);
  els.editTransactionAmount.dataset.rawValue = String(Math.abs(parseMoney(row.log)));
  els.editTransactionAmount.value = Math.abs(parseMoney(row.log)).toLocaleString('en-US');
  els.editTransactionAmount.dataset.sign = parseMoney(row.log) < 0 ? '-' : '+';
  els.editTransactionDescription.value = row.description || '';
  els.editTransactionStaff.value = row.staffId || '';
  openModal('editTransactionModal');
}

async function saveTransactionRevision(event) {
  event.preventDefault();
  const txId = els.editTransactionId.value;
  const staff = state.staff.find(x => x.id === els.editTransactionStaff.value);
  const raw = els.editTransactionAmount.dataset.rawValue || els.editTransactionAmount.value.replace(/,/g, '');
  const amount = Number(raw);
  if (!staff) return toast('Select the input staff.', 'error');
  if (!els.editTransactionDescription.value.trim()) return toast('Description is mandatory.', 'error');
  if (!amount || amount <= 0) return toast('Amount must be greater than zero.', 'error');

  const original = state.reportRows.find(x => x.txId === txId);
  if (!original) return;
  const signedAmount = parseMoney(original.log) < 0 ? -amount : amount;

  showLoading('Saving revision…');
  try {
    const result = await apiPost('updateTransaction', {
      txId,
      date: els.editTransactionDate.value,
      log: signedAmount,
      description: els.editTransactionDescription.value.trim(),
      inputStaffId: staff.id,
      inputStaffName: staff.name,
      tellerId: state.teller.id,
      tellerName: state.teller.name
    });
    if (!result.success) throw new Error(result.message || 'Revision failed');
    closeModal('editTransactionModal');
    toast('Transaction revised.', 'success');
    await refreshSharedData();
    await loadMonthlyReport();
    if (state.currentAccount) await searchAccount(state.currentAccount, true);
  } catch (error) {
    toast(error.message, 'error');
  } finally {
    hideLoading();
  }
}

async function deleteTransaction(txId) {
  const row = state.reportRows.find(x => x.txId === txId);
  if (!row) return;
  const ok = window.confirm(`Delete transaction ${txId}? This is only permitted within one month of creation.`);
  if (!ok) return;

  showLoading('Deleting transaction…');
  try {
    const result = await apiPost('deleteTransaction', {
      txId,
      tellerId: state.teller.id,
      tellerName: state.teller.name
    });
    if (!result.success) throw new Error(result.message || 'Delete failed');
    toast('Transaction deleted.', 'success');
    await refreshSharedData();
    await loadMonthlyReport();
    if (state.currentAccount) await searchAccount(state.currentAccount, true);
  } catch (error) {
    toast(error.message, 'error');
  } finally {
    hideLoading();
  }
}

async function exportReportPng() {
  if (!state.reportRows.length) return toast('Load a month with transaction records first.', 'error');
  showLoading('Rendering PNG…');
  try {
    const clone = prepareReportForExport();
    document.body.appendChild(clone);
    const canvas = await html2canvas(clone, { scale: 2, backgroundColor: '#ffffff', useCORS: true });
    clone.remove();
    const link = document.createElement('a');
    link.download = `transaction-inputs-${els.reportMonth.value}.png`;
    link.href = canvas.toDataURL('image/png');
    link.click();
  } catch (error) {
    toast('PNG export failed.', 'error');
  } finally {
    hideLoading();
  }
}

async function exportReportPdf() {
  if (!state.reportRows.length) return toast('Load a month with transaction records first.', 'error');
  showLoading('Rendering PDF…');
  try {
    const clone = prepareReportForExport();
    document.body.appendChild(clone);
    const canvas = await html2canvas(clone, { scale: 2, backgroundColor: '#ffffff', useCORS: true });
    clone.remove();
    const { jsPDF } = window.jspdf;
    const pdf = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
    const pageWidth = pdf.internal.pageSize.getWidth();
    const pageHeight = pdf.internal.pageSize.getHeight();
    const margin = 8;
    const imgWidth = pageWidth - margin * 2;
    const imgHeight = canvas.height * imgWidth / canvas.width;
    const img = canvas.toDataURL('image/png');

    let heightLeft = imgHeight;
    let position = margin;
    pdf.addImage(img, 'PNG', margin, position, imgWidth, imgHeight);
    heightLeft -= pageHeight - margin * 2;
    while (heightLeft > 0) {
      position = margin - (imgHeight - heightLeft);
      pdf.addPage();
      pdf.addImage(img, 'PNG', margin, position, imgWidth, imgHeight);
      heightLeft -= pageHeight - margin * 2;
    }
    pdf.save(`transaction-inputs-${els.reportMonth.value}.pdf`);
  } catch (error) {
    console.error(error);
    toast('PDF export failed.', 'error');
  } finally {
    hideLoading();
  }
}

function prepareReportForExport() {
  const clone = els.reportDocument.cloneNode(true);
  clone.style.position = 'fixed';
  clone.style.left = '-10000px';
  clone.style.top = '0';
  clone.style.width = '1250px';
  clone.style.maxWidth = 'none';
  clone.querySelectorAll('.report-action-col').forEach(el => el.remove());
  clone.querySelectorAll('.is-hidden').forEach(el => el.style.display = 'none');
  return clone;
}

async function apiGet(params) {
  const url = new URL(CONFIG.API_URL);
  Object.entries(params).forEach(([key, value]) => url.searchParams.set(key, value));
  url.searchParams.set('_', Date.now());
  const response = await fetch(url.toString(), { method: 'GET', redirect: 'follow', cache: 'no-store' });
  if (!response.ok) throw new Error(`API request failed (${response.status})`);
  return response.json();
}

async function apiPost(action, payload) {
  // Put the action in BOTH the query string and POST body. Apps Script normally
  // exposes either one through e.parameter, but duplicating it makes the request
  // resilient to redirects / deployment quirks and prevents a blank action.
  const url = new URL(CONFIG.API_URL);
  url.searchParams.set('action', action);
  url.searchParams.set('_', Date.now());

  const body = new URLSearchParams();
  body.set('action', action);
  body.set('payload', JSON.stringify(payload));

  const response = await fetch(url.toString(), {
    method: 'POST',
    redirect: 'follow',
    cache: 'no-store',
    body
  });

  if (!response.ok) throw new Error(`API request failed (${response.status})`);

  const result = await response.json();
  if (result && result.success === false && /action tidak valid/i.test(String(result.message || ''))) {
    result.message = `Backend ZAIGEN belum mengenali action "${action}". Deploy ulang Code.gs terbaru: Manage deployments → Edit → New version → Deploy.`;
  }
  return result;
}

function normalizeAccount(value) {
  return String(value ?? '').trim();
}

function normalizeStatus(value) {
  return String(value ?? '').trim().toUpperCase();
}

function isFrozenStatus(status) {
  return /(?:^|[\s-])F\s*$/i.test(String(status || '').trim());
}

function parseMoney(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  const cleaned = String(value ?? '')
    .replace(/両/g, '')
    .replace(/,/g, '')
    .replace(/[^0-9.-]/g, '');
  const num = Number(cleaned);
  return Number.isFinite(num) ? num : 0;
}

function formatCurrency(value, signed = false) {
  const number = parseMoney(value);
  const sign = signed && number > 0 ? '+' : '';
  return `${sign}${CONFIG.CURRENCY} ${number.toLocaleString('en-US')}`;
}

function normalizeImageUrl(url) {
  const value = String(url || '').trim();
  if (!value) return fallbackAvatar('');
  const driveMatch = value.match(/(?:\/d\/|id=)([-\w]{20,})/);
  if (driveMatch) return `https://drive.google.com/thumbnail?id=${driveMatch[1]}&sz=w1000`;
  return value;
}

function fallbackAvatar(name) {
  const initial = encodeURIComponent((name || '両').trim().charAt(0).toUpperCase() || '両');
  return `https://dummyimage.com/800x800/e8dfcf/6f5c3a&text=${initial}`;
}

function formatDateDisplay(value) {
  if (!value) return '—';
  const normalized = normalizeDateForInput(value);
  if (!normalized) return String(value);
  const [y,m,d] = normalized.split('-').map(Number);
  return new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }).format(new Date(y, m - 1, d));
}

function normalizeDateForInput(value) {
  if (!value) return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(String(value))) return String(value);
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return dateInputValue(date);
}

function dateInputValue(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function monthLabel(month) {
  if (!/^\d{4}-\d{2}$/.test(month)) return month || '—';
  const [y,m] = month.split('-').map(Number);
  return new Intl.DateTimeFormat('en-US', { month: 'long', year: 'numeric' }).format(new Date(y, m - 1, 1));
}

function gvizString(value) {
  return String(value ?? '').replace(/'/g, "''");
}

function openModal(id) {
  const modal = document.getElementById(id);
  if (!modal) return;
  modal.classList.remove('is-hidden');
  modal.setAttribute('aria-hidden', 'false');
}

function closeModal(id) {
  const modal = document.getElementById(id);
  if (!modal) return;
  modal.classList.add('is-hidden');
  modal.setAttribute('aria-hidden', 'true');
}

function showLoading(text = 'Loading…') {
  els.loadingText.textContent = text;
  els.loadingOverlay.classList.remove('is-hidden');
}

function hideLoading() {
  els.loadingOverlay.classList.add('is-hidden');
}

function toast(message, type = '') {
  const div = document.createElement('div');
  div.className = `toast ${type}`.trim();
  div.textContent = message;
  els.toastRegion.appendChild(div);
  window.setTimeout(() => div.remove(), 5200);
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function escapeAttr(value) {
  return escapeHtml(value).replace(/`/g, '&#096;');
}
