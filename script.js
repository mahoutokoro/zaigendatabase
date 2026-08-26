'use strict';

const CONFIG = {
  API_URL: 'https://script.google.com/macros/s/AKfycbyXftSTcUrp1V7wGl2uXa7nplDbKtuSXot-IwoGlViDQoiw8RyzRxbFMIxKSGvi60VH/exec',
  SPREADSHEET_ID: '1B2JX2vPdMMxY8v-ZEkfnSxETpCc5A431qyi15CwLjbg',
  MASTER_SHEET: 'MASTER DATA',

  // Teller/staff credentials live in a separate public spreadsheet.
  STAFF_SPREADSHEET_ID: '1B-4musvQU1r--MpBk0O5wGpB9gGsAtogdTrV3Zb0ENw',
  STAFF_SHEET: 'LOGIN PASS',
  LOGO_FILE_ID: '155EMzz-V3xXlB73YO12TP7hPXA1i1jVN',
  DEFAULT_ROWS: 5,
  MAX_ROWS: 100,
  ROW_STEP: 5,
  CURRENCY: '両',
  GLOBAL_SYNC_INTERVAL_MS: 30000,
  TELLER_SESSION_KEY: 'zaigenOfficeTellerSession',
  BATCH_REQUEST_STORAGE_KEY: 'zaigenOfficePendingBatchRequests',
  BATCH_REQUEST_TTL_MS: 6 * 60 * 60 * 1000,

  // Batch writes use command + confirmation instead of trusting POST response.
  BATCH_STATUS_INTERVAL_MS: 350,
  BATCH_FIRST_CONFIRM_MS: 5500,
  BATCH_SECOND_CONFIRM_MS: 6500,
  BATCH_RECORDED_GRACE_MS: 900,

  // Kept for edit/delete requests that still use readable POST responses.
  POST_TIMEOUT_MS: 30000
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
  currentLedgerMonth: '',
  ledgerLoadToken: 0,
  ledgerLoading: false,
  reportRows: [],
  syncingSharedData: false,
  batchModes: {
    TRANSFER: 'STANDARD',
    SALARY: 'STANDARD',
    REWARD: 'STANDARD'
  },
  descriptionModes: {
    LAST_SALDO: 'MULTI',
    TRANSFER: 'MULTI',
    SALARY: 'MULTI',
    REWARD: 'MULTI'
  },
  amountModes: {
    LAST_SALDO: 'MULTI',
    TRANSFER: 'MULTI',
    SALARY: 'MULTI',
    REWARD: 'MULTI'
  },
  processingTypes: new Set()
};

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

const els = {};

document.addEventListener('DOMContentLoaded', async () => {
  cacheElements();
  setBrandAssets();
  installAmountModeControls();
  installCompactDateControls();
  installBatchUtilityControls();
  document.body.classList.add('home-view-active');
  updateMobilePublicNavigation('home');
  updateTellerSessionUi();
  bindGlobalEvents();
  initializeRowControls();
  setDefaultMonth();
  renderAllBatchGrids();
  ['TRANSFER','SALARY','REWARD'].forEach(applyBatchModeVisuals);
  ['LAST_SALDO','TRANSFER','SALARY','REWARD'].forEach(applyDescriptionModeVisuals);
  ['LAST_SALDO','TRANSFER','SALARY','REWARD'].forEach(applyAmountModeVisuals);

  try {
    await Promise.all([loadMasterData(), loadStaffDirectory()]);
    populateStaffSelectors();
    refreshProviderSelectOptions();
    refreshBulkProviderOptions();
    restoreTellerSession();
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
    'ledgerMonth','transactionLoading','transactionScrollWrap','ledgerScrollNav','ledgerScrollTop','ledgerScrollBottom',
    'tellerButton','tellerLoginModal','tellerLoginForm','tellerIdInput','tellerPasswordInput','tellerWorkspace',
    'loggedTellerName','loggedTellerId','tellerLogoutButton','closeWorkspaceButton','tellerNav',
    'loadingOverlay','loadingText','toastRegion','reportMonth','loadReportButton','reportSearchInput','reportSearchButton','exportPdfButton','exportPngButton',
    'reportMonthLabel','reportTableBody','reportEmpty','reportDocument','editTransactionModal','editTransactionForm',
    'editTransactionId','editTransactionDate','editTransactionAmount','editTransactionDescription','editTransactionStaff',
    'bankLogo','workspaceLogo','tellerLoginLogo','tellerPasswordToggle','allAccountSearch','allAccountStatusFilter','allAccountTableBody',
    'allAccountTotal','allAccountBalance','allAccountActive','allAccountFrozen','allAccountCountLabel',
    'mobileAppNav','mobileTellerLogoutButton'
  ].forEach(id => els[id] = document.getElementById(id));
}

function setBrandAssets() {
  const logo = `https://drive.google.com/thumbnail?id=${CONFIG.LOGO_FILE_ID}&sz=w1000`;
  els.bankLogo.src = logo;
  els.workspaceLogo.src = logo;
  if (els.tellerLoginLogo) els.tellerLoginLogo.src = logo;
}

function installAmountModeControls() {
  const configs = {
    LAST_SALDO: { panelId: 'lastBalancePanel', inputId: 'lastBalanceSingleAmount' },
    TRANSFER: { panelId: 'transferPanel', inputId: 'transferSingleAmount' },
    SALARY: { panelId: 'salaryPanel', inputId: 'salarySingleAmount' },
    REWARD: { panelId: 'rewardPanel', inputId: 'rewardSingleAmount' }
  };

  Object.entries(configs).forEach(([type, config]) => {
    const panel = document.getElementById(config.panelId);
    const controls = $('.panel-controls', panel);
    const grid = document.getElementById(batchConfig(type).gridId);
    if (!panel || !controls || !grid) return;

    if (!$(`[data-amount-type="${type}"]`, controls)) {
      const amountControl = document.createElement('div');
      amountControl.className = 'amount-mode-control';
      amountControl.innerHTML = `
        <span>Amount</span>
        <div class="mode-switch" role="group" aria-label="Amount mode">
          <button class="mode-option" data-amount-type="${type}" data-amount-mode="SINGLE" type="button">SINGLE AMOUNT</button>
          <button class="mode-option active" data-amount-type="${type}" data-amount-mode="MULTI" type="button">MULTI AMOUNT</button>
        </div>`;

      const rowControl = $('.row-count-control', controls);
      if (rowControl) controls.insertBefore(amountControl, rowControl);
      else controls.appendChild(amountControl);
    }

    if (!$(`[data-single-amount-config="${type}"]`, panel)) {
      const sharedBar = document.createElement('div');
      sharedBar.className = 'single-amount-config is-hidden';
      sharedBar.dataset.singleAmountConfig = type;
      sharedBar.innerHTML = `
        <div class="single-amount-copy">
          <span>SINGLE AMOUNT</span>
          <small>Use one amount for every active recipient row.</small>
        </div>
        <label class="single-amount-field">
          <span>Amount</span>
          <div class="currency-input single-amount-input-wrap">
            <span>${CONFIG.CURRENCY}</span>
            <input id="${config.inputId}" class="js-single-amount" data-amount-type="${type}" type="text" inputmode="numeric" placeholder="0" />
          </div>
        </label>`;
      grid.insertAdjacentElement('beforebegin', sharedBar);
    }
  });
}

function installCompactDateControls() {
  const configs = {
    TRANSFER: { panelId: 'transferPanel', inputId: 'transferCompactDate' },
    SALARY: { panelId: 'salaryPanel', inputId: 'salaryCompactDate' },
    REWARD: { panelId: 'rewardPanel', inputId: 'rewardCompactDate' }
  };

  Object.entries(configs).forEach(([type, config]) => {
    const panel = document.getElementById(config.panelId);
    const grid = document.getElementById(batchConfig(type).gridId);
    if (!panel || !grid || $(`[data-compact-date-config="${type}"]`, panel)) return;

    const sharedDate = document.createElement('div');
    sharedDate.className = 'compact-date-config is-hidden';
    sharedDate.dataset.compactDateConfig = type;
    sharedDate.innerHTML = `
      <div class="compact-date-copy">
        <span>SHARED DATE</span>
        <small>All recipients in this compact batch use the same transaction date.</small>
      </div>
      <label class="compact-date-field">
        <span>Date</span>
        <input id="${config.inputId}" class="batch-input js-compact-shared-date" data-compact-date-type="${type}" type="date" value="${dateInputValue(new Date())}" />
      </label>`;

    grid.insertAdjacentElement('beforebegin', sharedDate);
  });
}

function installBatchUtilityControls() {
  $$('.batch-row-actions').forEach(actions => {
    const addButton = $('[data-add-row]', actions);
    const type = addButton?.dataset.addRow;
    if (!type || $('[data-clear-all]', actions)) return;

    const utilityGroup = document.createElement('div');
    utilityGroup.className = 'batch-utility-actions';
    utilityGroup.innerHTML = `
      <button class="clear-all-button" data-clear-all="${type}" type="button">CLEAR ALL DATA</button>
      <button class="remove-row-button" data-remove-row="${type}" type="button"><span aria-hidden="true">−</span> REMOVE ROW</button>`;

    addButton.insertAdjacentElement('afterend', utilityGroup);
  });
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
    if (state.currentAccount) refreshCurrentAccountView();
  });

  els.ledgerMonth.addEventListener('change', () => {
    if (!state.currentAccount || !els.ledgerMonth.value) return;
    state.currentLedgerMonth = els.ledgerMonth.value;
    loadLedgerMonth(state.currentAccount, state.currentLedgerMonth);
  });

  els.ledgerScrollTop.addEventListener('click', () => {
    els.transactionScrollWrap.scrollTo({ top: 0, behavior: 'smooth' });
  });

  els.ledgerScrollBottom.addEventListener('click', () => {
    els.transactionScrollWrap.scrollTo({
      top: els.transactionScrollWrap.scrollHeight,
      behavior: 'smooth'
    });
  });

  els.transactionScrollWrap.addEventListener('scroll', updateLedgerScrollNavigation, { passive: true });

  $$('[data-home-logo]').forEach(logo => {
    logo.addEventListener('click', event => {
      event.preventDefault();
      goToHome();
    });

    logo.addEventListener('keydown', event => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        goToHome();
      }
    });
  });

  els.tellerButton.addEventListener('click', () => {
    if (state.teller) {
      openTellerWorkspace();
    } else {
      openModal('tellerLoginModal');
    }
  });

  if (els.mobileAppNav) {
    els.mobileAppNav.addEventListener('click', handleMobileAppNavigation);
  }

  if (els.mobileTellerLogoutButton) {
    els.mobileTellerLogoutButton.addEventListener('click', logoutTeller);
  }
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

  $$('.row-count-input').forEach(input => {
    input.addEventListener('change', () => updateBatchRowCountFromInput(input.id));
    input.addEventListener('blur', () => updateBatchRowCountFromInput(input.id));
  });

  $$('[data-add-row]').forEach(button => {
    button.addEventListener('click', () => addBatchRow(button.dataset.addRow));
  });

  $$('[data-mode-type][data-mode]').forEach(button => {
    button.addEventListener('click', () => setBatchMode(button.dataset.modeType, button.dataset.mode));
  });

  $$('[data-desc-type][data-desc-mode]').forEach(button => {
    button.addEventListener('click', () => setDescriptionMode(button.dataset.descType, button.dataset.descMode));
  });

  $$('[data-amount-type][data-amount-mode]').forEach(button => {
    button.addEventListener('click', () => setAmountMode(button.dataset.amountType, button.dataset.amountMode));
  });

  $$('.js-single-amount').forEach(input => {
    input.addEventListener('input', formatMoneyInput);
  });

  $$('.js-compact-shared-date').forEach(input => {
    input.addEventListener('change', () => {
      const type = input.dataset.compactDateType;
      syncCompactDateToRows(type);
      clearPendingBatchRequest(type);
    });
  });

  $$('[data-clear-all]').forEach(button => {
    button.addEventListener('click', () => clearAllBatchData(button.dataset.clearAll));
  });

  $$('[data-remove-row]').forEach(button => {
    button.addEventListener('click', () => removeLastBatchRow(button.dataset.removeRow));
  });

  const bulkSender = $('.js-bulk-sender-account');
  if (bulkSender) {
    bulkSender.addEventListener('input', () => resolveBulkSender());
    bulkSender.addEventListener('blur', () => resolveBulkSender());
  }

  $$('.js-bulk-provider-account').forEach(select => {
    select.addEventListener('change', () => validateBulkProvider(select.dataset.bulkProviderType));
  });

  $$('[data-process]').forEach(button => {
    button.addEventListener('click', () => processBatch(button.dataset.process, button));
  });

  els.loadReportButton.addEventListener('click', loadMonthlyReport);
  els.reportMonth.addEventListener('change', loadMonthlyReport);
  els.reportSearchButton.addEventListener('click', searchTransactionInputs);
  els.reportSearchInput.addEventListener('keydown', event => {
    if (event.key === 'Enter') {
      event.preventDefault();
      searchTransactionInputs();
    }
  });
  els.reportSearchInput.addEventListener('search', () => {
    if (!els.reportSearchInput.value.trim()) {
      renderMonthlyReport(state.reportRows, els.reportMonth.value);
    }
  });
  els.exportPdfButton.addEventListener('click', exportReportPdf);
  els.exportPngButton.addEventListener('click', exportReportPng);
  els.reportTableBody.addEventListener('click', handleReportAction);
  els.allAccountSearch.addEventListener('input', renderAllAccounts);
  els.allAccountStatusFilter.addEventListener('change', renderAllAccounts);
  document.addEventListener('click', handleLedgerNavigationClick);
  els.editTransactionForm.addEventListener('submit', saveTransactionRevision);
  els.editTransactionAmount.addEventListener('input', formatMoneyInput);

  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      $$('.modal-shell:not(.is-hidden)').forEach(modal => closeModal(modal.id));
    }
  });
}

function initializeRowControls() {
  $$('.row-count-input').forEach(input => {
    const current = Number.parseInt(input.value, 10);
    input.value = String(Number.isInteger(current) && current > 0 ? current : CONFIG.DEFAULT_ROWS);
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
  const rows = await fetchGvizSheet(
    CONFIG.STAFF_SHEET,
    'select A,B',
    1,
    CONFIG.STAFF_SPREADSHEET_ID
  );

  state.staff = rows
    .map(row => ({ id: cellText(row[0]), name: cellText(row[1]) }))
    .filter(x => x.id && x.name);
}

async function verifyTellerCredentials(id, password) {
  const escaped = gvizString(id);

  const rows = await fetchGvizSheet(
    CONFIG.STAFF_SHEET,
    `select A,B,E where A = '${escaped}'`,
    1,
    CONFIG.STAFF_SPREADSHEET_ID
  );

  const match = rows
    .map(row => ({ id: cellText(row[0]), name: cellText(row[1]), password: cellText(row[2]) }))
    .find(x => x.id === id);

  if (!match || !match.password || match.password !== password) return null;
  return { id: match.id, name: match.name };
}

async function fetchGvizSheet(sheet, query, headers = 1, spreadsheetId = CONFIG.SPREADSHEET_ID) {
  const sourceSpreadsheetId = String(spreadsheetId || CONFIG.SPREADSHEET_ID).trim();
  const url = `https://docs.google.com/spreadsheets/d/${sourceSpreadsheetId}/gviz/tq?sheet=${encodeURIComponent(sheet)}&headers=${headers}&tqx=out:json&tq=${encodeURIComponent(query)}&_=${Date.now()}`;
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
    refreshBulkProviderOptions();
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

    select.innerHTML = '<option value="">Select SOURCE</option>' + providers
      .map(item => `<option value="${escapeAttr(item.account)}">${escapeHtml(item.account)} — ${escapeHtml(item.name)}</option>`)
      .join('');

    if (providers.some(item => item.account === current)) {
      select.value = current;
    }
  });
}

function refreshBulkProviderOptions() {
  $$('.js-bulk-provider-account').forEach(select => {
    const type = select.dataset.bulkProviderType;
    const current = select.value;
    const providers = type === 'SALARY' ? state.providersOffice : state.providersReward;

    select.innerHTML = '<option value="">Select SOURCE</option>' + providers
      .map(item => `<option value="${escapeAttr(item.account)}">${escapeHtml(item.account)} — ${escapeHtml(item.name)}</option>`)
      .join('');

    if (providers.some(item => item.account === current)) select.value = current;
  });
}

async function loadPublicAccountTransactions(account, month) {
  /*
    PERFORMANCE:
    The old ledger downloaded the entire TRANSACTION LOG before the account
    page could finish opening. The ledger now requests only the selected month.

    We intentionally query every transaction in that month (not only this
    account), because paired -D / -C rows are needed to resolve Sender /
    Recipient correctly. One month is still dramatically smaller than the
    complete historical log.
  */
  const target = normalizeAccount(account);
  const normalizedMonth = normalizeLedgerMonth(month);
  const { startDate, endDate } = ledgerMonthRange(normalizedMonth);

  let rows;

  try {
    rows = await fetchGvizSheet(
      'TRANSACTION LOG',
      `select A,B,C,D,E where B >= date '${startDate}' and B < date '${endDate}'`,
      1
    );
  } catch (dateQueryError) {
    /*
      Compatibility fallback for an older sheet where Date may have been stored
      as text. This fallback reads only the target account's history, then
      filters locally by month. Pair names may be unavailable for legacy rows,
      but the ledger remains usable instead of failing.
    */
    console.warn('Month-scoped TRANSACTION LOG query fallback:', dateQueryError);

    const escapedAccount = gvizString(target);
    rows = await fetchGvizSheet(
      'TRANSACTION LOG',
      `select A,B,C,D,E where C = '${escapedAccount}'`,
      1
    );
  }

  const allTransactions = rows
    .map(row => ({
      txId: cellText(row[0]),
      date: cellText(row[1]),
      accountNumber: cellText(row[2]),
      log: cellText(row[3]),
      description: cellText(row[4])
    }))
    .filter(row => row.accountNumber)
    .filter(row => transactionMatchesMonth(row, normalizedMonth));

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

function normalizeLedgerMonth(value) {
  if (/^\d{4}-\d{2}$/.test(String(value || ''))) {
    return String(value);
  }

  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

function ledgerMonthRange(month) {
  const normalized = normalizeLedgerMonth(month);
  const [year, monthNumber] = normalized.split('-').map(Number);

  const startDate = `${year}-${String(monthNumber).padStart(2, '0')}-01`;

  const next = new Date(year, monthNumber, 1);
  const endDate = [
    next.getFullYear(),
    String(next.getMonth() + 1).padStart(2, '0'),
    '01'
  ].join('-');

  return { startDate, endDate };
}

function transactionMatchesMonth(row, month) {
  const normalized = normalizeDateForInput(row.date);
  return Boolean(normalized && normalized.slice(0, 7) === month);
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
        <td>
          <button class="account-ledger-link account-number-link" type="button" data-open-ledger="${escapeAttr(item.account)}">
            ${escapeHtml(item.account)}
          </button>
        </td>
        <td>
          <button class="account-ledger-link account-name-link" type="button" data-open-ledger="${escapeAttr(item.account)}">
            ${escapeHtml(item.name || '—')}
          </button>
        </td>
        <td class="kanji-cell">${escapeHtml(item.kanji || '—')}</td>
        <td><span class="directory-status ${frozenAccount ? 'frozen' : ''}">${escapeHtml(item.status || '—')}</span></td>
        <td>${xUrl ? `<a href="${escapeAttr(xUrl)}" target="_blank" rel="noopener noreferrer">@${escapeHtml(xLabel)}</a>` : '—'}</td>
        <td class="money-col"><strong>${escapeHtml(formatCurrency(item.balance))}</strong></td>
        <td class="account-photo-cell">
          <img
            class="account-directory-photo"
            src="${escapeAttr(normalizeImageUrl(item.photo) || fallbackAvatar(item.name))}"
            data-account-photo-name="${escapeAttr(item.name || 'Account holder')}"
            alt="${escapeAttr(item.name || 'Account holder')}"
            loading="lazy"
          />
        </td>
      </tr>`;
  }).join('');

  $$('.account-directory-photo', els.allAccountTableBody).forEach(image => {
    image.addEventListener('error', () => {
      image.src = fallbackAvatar(image.dataset.accountPhotoName || 'Account holder');
    }, { once: true });
  });
}

function handleLedgerNavigationClick(event) {
  const trigger = event.target.closest('[data-open-ledger]');
  if (!trigger) return;

  const account = normalizeAccount(trigger.dataset.openLedger);
  if (!account) return;

  event.preventDefault();
  openLedgerFromLink(account);
}

function openLedgerFromLink(account) {
  account = normalizeAccount(account);
  if (!account) return;

  // Leaving the Teller Desk does not log the teller out.
  closeTellerWorkspace();
  $$('.modal-shell:not(.is-hidden)').forEach(modal => closeModal(modal.id));

  els.headerSearchInput.value = account;
  els.heroSearchInput.value = account;
  searchAccount(account);
}

function goToHome() {
  // Home navigation never logs the teller out.
  closeTellerWorkspace();
  $$('.modal-shell:not(.is-hidden)').forEach(modal => closeModal(modal.id));

  state.currentAccount = null;
  state.currentTransactions = [];
  state.ledgerLoadToken += 1;
  state.ledgerLoading = false;

  els.accountView.classList.add('is-hidden');
  els.welcomeView.classList.remove('is-hidden');
  document.body.classList.add('home-view-active');
  els.headerSearchInput.value = '';
  els.heroSearchInput.value = '';
  updateMobilePublicNavigation('home');

  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function handleMobileAppNavigation(event) {
  const button = event.target.closest('[data-mobile-action]');
  if (!button) return;

  const action = button.dataset.mobileAction;

  if (action === 'home') {
    goToHome();
    return;
  }

  if (action === 'account') {
    if (state.currentAccount && !els.accountView.classList.contains('is-hidden')) {
      updateMobilePublicNavigation('account');
      document.querySelector('.account-hero')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      return;
    }

    updateMobilePublicNavigation('account');
    const target = document.body.classList.contains('home-view-active')
      ? els.heroSearchInput
      : els.headerSearchInput;
    target?.focus({ preventScroll: false });
    target?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    return;
  }

  if (action === 'activity') {
    if (state.currentAccount && !els.accountView.classList.contains('is-hidden')) {
      updateMobilePublicNavigation('activity');
      document.querySelector('.ledger-section')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } else {
      updateMobilePublicNavigation('account');
      els.heroSearchInput?.focus({ preventScroll: false });
      els.heroSearchInput?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
    return;
  }

  if (action === 'teller') {
    updateMobilePublicNavigation('teller');
    if (state.teller) {
      openTellerWorkspace();
    } else {
      openModal('tellerLoginModal');
    }
  }
}

function updateMobilePublicNavigation(activeAction) {
  if (!els.mobileAppNav) return;

  $$('[data-mobile-action]', els.mobileAppNav).forEach(button => {
    const isActive = button.dataset.mobileAction === activeAction;
    button.classList.toggle('active', isActive);
    button.setAttribute('aria-current', isActive ? 'page' : 'false');
  });
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

  /*
    PROFILE-FIRST OPENING:
    MASTER DATA is already loaded for the website, so identity/balance can be
    rendered immediately without waiting for TRANSACTION LOG.
  */
  let record = state.masterMap.get(account);

  if (!record) {
    // MASTER DATA may still be refreshing. Retry one focused public-sheet read
    // before declaring the account missing.
    try {
      record = await loadSingleMasterAccount(account);
    } catch (error) {
      console.warn('Focused MASTER DATA lookup failed:', error);
    }
  }

  if (!record) {
    toast('Account not found.', 'error');
    return;
  }

  const openingNewAccount = state.currentAccount !== account;

  state.currentAccount = account;
  state.currentTransactions = [];
  state.ledgerLoadToken += 1;

  renderProfile(masterRecordToProfile(record));

  els.welcomeView.classList.add('is-hidden');
  els.accountView.classList.remove('is-hidden');
  document.body.classList.remove('home-view-active');
  updateMobilePublicNavigation('account');
  els.headerSearchInput.value = account;
  els.heroSearchInput.value = account;

  if (openingNewAccount || !state.currentLedgerMonth) {
    state.currentLedgerMonth = currentMonthValue();
  }

  els.ledgerMonth.value = state.currentLedgerMonth;

  // Identity is now visible. Transaction history loads independently below.
  if (!silent) {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  loadLedgerMonth(account, state.currentLedgerMonth);

  /*
    Refresh the exact MASTER record in the background. This can update a balance
    or photo after the instant local render, but it never delays page opening.
  */
  refreshVisibleAccountProfile(account);
}

async function loadSingleMasterAccount(account) {
  const rows = await fetchGvizSheet(
    CONFIG.MASTER_SHEET,
    'select B,C,D,E,F,G,H',
    1
  );

  const record = rows
    .map(row => ({
      status: cellText(row[0]),
      account: cellText(row[1]),
      name: cellText(row[2]),
      kanji: cellText(row[3]),
      x: cellText(row[4]),
      photo: cellText(row[5]),
      balance: cellText(row[6])
    }))
    .find(item => normalizeAccount(item.account) === normalizeAccount(account));

  if (record) {
    state.masterMap.set(normalizeAccount(record.account), record);

    const existingIndex = state.master.findIndex(
      item => normalizeAccount(item.account) === normalizeAccount(record.account)
    );

    if (existingIndex >= 0) {
      state.master[existingIndex] = record;
    } else {
      state.master.push(record);
    }
  }

  return record || null;
}

function masterRecordToProfile(record) {
  return {
    status: record.status || '—',
    accountNumber: record.account || '',
    name: record.name || '—',
    kanjiName: record.kanji || '—',
    xUsername: cleanXUsername(record.x),
    xUrl: xProfileUrl(record.x),
    photo: record.photo || '',
    balance: record.balance || 0
  };
}

async function refreshVisibleAccountProfile(account) {
  try {
    /*
      Use the existing shared MASTER refresh, but do not await it from the page
      opening path. If another global sync is already active, the current local
      profile remains visible.
    */
    await refreshSharedData();

    if (state.currentAccount !== account) return;

    const latest = state.masterMap.get(account);
    if (latest) {
      renderProfile(masterRecordToProfile(latest));
    }
  } catch (error) {
    console.warn('Background account profile refresh failed:', error);
  }
}

async function refreshCurrentAccountView() {
  if (!state.currentAccount) return;

  const account = state.currentAccount;
  const month = els.ledgerMonth.value || state.currentLedgerMonth || currentMonthValue();

  state.currentLedgerMonth = month;

  const latest = state.masterMap.get(account);
  if (latest) {
    renderProfile(masterRecordToProfile(latest));
  }

  // Both refreshes are background-friendly and the profile remains visible.
  refreshVisibleAccountProfile(account);
  loadLedgerMonth(account, month);
}

async function loadLedgerMonth(account, month) {
  account = normalizeAccount(account);
  month = normalizeLedgerMonth(month);

  if (!account || state.currentAccount !== account) return;

  const token = ++state.ledgerLoadToken;
  state.currentLedgerMonth = month;
  els.ledgerMonth.value = month;

  setLedgerLoading(true);

  try {
    const rows = await loadPublicAccountTransactions(account, month);

    if (
      token !== state.ledgerLoadToken ||
      state.currentAccount !== account ||
      state.currentLedgerMonth !== month
    ) {
      return;
    }

    state.currentTransactions = rows;
    renderTransactions(rows);

  } catch (error) {
    if (
      token !== state.ledgerLoadToken ||
      state.currentAccount !== account
    ) {
      return;
    }

    state.currentTransactions = [];
    renderTransactions([]);
    toast('Unable to load this month’s transaction history.', 'error');
    console.warn('Monthly ledger load failed:', error);

  } finally {
    if (token === state.ledgerLoadToken) {
      setLedgerLoading(false);
    }
  }
}

function setLedgerLoading(loading) {
  state.ledgerLoading = Boolean(loading);

  els.transactionLoading.classList.toggle('is-hidden', !loading);

  if (loading) {
    els.transactionTableBody.innerHTML = '';
    els.transactionCount.textContent = 'Loading…';
    els.transactionEmpty.classList.add('is-hidden');
    els.ledgerScrollNav.classList.add('is-hidden');
    els.transactionScrollWrap.scrollTop = 0;
  }

  els.transactionScrollWrap.classList.toggle('is-loading', loading);
}

function currentMonthValue() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

function updateLedgerScrollNavigation() {
  if (!els.transactionScrollWrap || !els.ledgerScrollNav) return;

  const hasOverflow =
    els.transactionScrollWrap.scrollHeight >
    els.transactionScrollWrap.clientHeight + 8;

  els.ledgerScrollNav.classList.toggle(
    'is-hidden',
    !hasOverflow || state.ledgerLoading
  );

  if (!hasOverflow) return;

  const atTop = els.transactionScrollWrap.scrollTop <= 6;
  const atBottom =
    els.transactionScrollWrap.scrollTop +
      els.transactionScrollWrap.clientHeight >=
    els.transactionScrollWrap.scrollHeight - 6;

  els.ledgerScrollTop.disabled = atTop;
  els.ledgerScrollBottom.disabled = atBottom;
}


function renderProfile(profile) {
  if (!profile) return;
  const status = profile.status || '—';
  const frozen = isFrozenStatus(status);
  els.profileName.textContent = profile.name || '—';
  els.profileKanji.textContent = profile.kanjiName || '—';
  els.profileAccount.textContent = profile.accountNumber || '—';

  const profileLedgerAccount = normalizeAccount(profile.accountNumber);
  els.profileName.dataset.openLedger = profileLedgerAccount;
  els.profileAccount.dataset.openLedger = profileLedgerAccount;

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

  const monthText = state.currentLedgerMonth
    ? monthLabel(state.currentLedgerMonth)
    : '';

  els.transactionCount.textContent = `${rows.length} record${rows.length === 1 ? '' : 's'}${monthText ? ` · ${monthText}` : ''}`;
  els.transactionEmpty.classList.toggle('is-hidden', rows.length !== 0);

  rows.forEach(row => {
    const amount = parseMoney(row.log);
    const counterparty = transactionCounterpartyHtml(row, amount);
    const tr = document.createElement('tr');
    tr.className = amount < 0 ? 'transaction-debit' : amount > 0 ? 'transaction-credit' : 'transaction-entry';
    tr.innerHTML = `
      <td>${escapeHtml(formatDateDisplay(row.date || row.transactionDate || ''))}</td>
      <td><span class="log-pill">${escapeHtml(transactionLabel(amount))}</span></td>
      <td>${counterparty}</td>
      <td>${escapeHtml(row.description || row.keterangan || '—')}</td>
      <td class="money-col ${amount < 0 ? 'amount-negative' : 'amount-positive'}">${escapeHtml(formatCurrency(amount, true))}</td>
    `;
    els.transactionTableBody.appendChild(tr);
  });

  window.requestAnimationFrame(updateLedgerScrollNavigation);
}

function transactionCounterpartyHtml(row, amount) {
  const role = row.counterpartyRole || (amount < 0 ? 'Recipient' : amount > 0 ? 'Sender' : '');
  const name = row.counterpartyName || '';
  const account = row.counterpartyAccount || '';

  if (!role) {
    return '<span class="counterparty-empty">—</span>';
  }

  if (!account) {
    return `
      <div class="counterparty-cell">
        <span>${escapeHtml(role)}</span>
        <strong>${escapeHtml(name || '—')}</strong>
      </div>
    `;
  }

  return `
    <div class="counterparty-cell">
      <span>${escapeHtml(role)}</span>
      <button class="ledger-inline-link ledger-name-link" type="button" data-open-ledger="${escapeAttr(account)}">${escapeHtml(name || '—')}</button>
      <button class="ledger-inline-link ledger-account-link" type="button" data-open-ledger="${escapeAttr(account)}">${escapeHtml(account)}</button>
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
    if (!teller) throw new Error('Teller login rejected. Staff ID or password does not match the LOGIN PASS sheet.');

    state.teller = teller;
    persistTellerSession(teller);
    updateTellerSessionUi();
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
  clearTellerSession();
  updateTellerSessionUi();
  closeTellerWorkspace();
  els.tellerIdInput.value = '';
  els.tellerPasswordInput.value = '';
  setTellerPasswordVisibility(false);
  toast('Teller session closed.');
}

function persistTellerSession(teller) {
  if (!teller?.id || !teller?.name) return;

  try {
    localStorage.setItem(
      CONFIG.TELLER_SESSION_KEY,
      JSON.stringify({
        id: teller.id,
        name: teller.name
      })
    );
  } catch (error) {
    console.warn('Unable to persist teller session:', error);
  }
}

function clearTellerSession() {
  try {
    localStorage.removeItem(CONFIG.TELLER_SESSION_KEY);
  } catch (error) {
    console.warn('Unable to clear teller session:', error);
  }
}

function restoreTellerSession() {
  let saved = null;

  try {
    const raw = localStorage.getItem(CONFIG.TELLER_SESSION_KEY);
    if (!raw) {
      updateTellerSessionUi();
      return;
    }
    saved = JSON.parse(raw);
  } catch (error) {
    clearTellerSession();
    updateTellerSessionUi();
    return;
  }

  const id = String(saved?.id || '').trim();
  const name = String(saved?.name || '').trim();

  if (!id || !name) {
    clearTellerSession();
    updateTellerSessionUi();
    return;
  }

  // Revalidate the saved identity against the current STAFF directory.
  // Passwords are never saved in localStorage.
  const currentStaff = state.staff.find(staff => staff.id === id && staff.name === name);

  if (!currentStaff) {
    clearTellerSession();
    updateTellerSessionUi();
    return;
  }

  state.teller = {
    id: currentStaff.id,
    name: currentStaff.name
  };

  updateTellerSessionUi();
}

function updateTellerSessionUi() {
  const loggedIn = Boolean(state.teller);

  if (els.loggedTellerName) {
    els.loggedTellerName.textContent = loggedIn ? state.teller.name : '—';
  }
  if (els.loggedTellerId) {
    els.loggedTellerId.textContent = loggedIn ? state.teller.id : '—';
  }

  if (els.tellerButton) {
    els.tellerButton.innerHTML = loggedIn
      ? '<span class="status-dot"></span> OPEN TELLER DESK'
      : '<span class="status-dot"></span> TELLER LOGIN';
  }

  $$('.process-staff-name').forEach(element => {
    element.textContent = loggedIn ? state.teller.name : '—';
  });

  $$('.process-staff-id').forEach(element => {
    element.textContent = loggedIn ? state.teller.id : '—';
  });

  $$('.mobile-logged-teller-name').forEach(element => {
    element.textContent = loggedIn ? state.teller.name : '—';
  });

  $$('.mobile-logged-teller-id').forEach(element => {
    element.textContent = loggedIn ? state.teller.id : '—';
  });

  const staffPhoto = loggedIn
    ? getTellerPhotoUrl(state.teller)
    : fallbackAvatar('Staff');

  $$('.mobile-teller-photo, .process-staff-photo').forEach(image => {
    image.src = staffPhoto;
    image.alt = loggedIn ? `${state.teller.name} photo` : 'Staff photo';
    image.onerror = () => {
      image.onerror = null;
      image.src = fallbackAvatar(loggedIn ? state.teller.name : 'Staff');
    };
  });
}

function getTellerPhotoUrl(teller) {
  if (!teller) return fallbackAvatar('Staff');

  const byAccount = state.masterMap.get(normalizeAccount(teller.id));
  const byName = state.master.find(item =>
    String(item.name || '').trim().toLowerCase() === String(teller.name || '').trim().toLowerCase()
  );
  const record = byAccount || byName;
  return normalizeImageUrl(record?.photo) || fallbackAvatar(teller.name || 'Staff');
}

function openTellerWorkspace() {
  if (!state.teller) return;
  els.tellerWorkspace.classList.remove('is-hidden');
  els.tellerWorkspace.setAttribute('aria-hidden', 'false');
  document.body.classList.add('teller-workspace-open');
  document.body.style.overflow = 'hidden';
  updateMobilePublicNavigation('teller');
}

function closeTellerWorkspace() {
  els.tellerWorkspace.classList.add('is-hidden');
  els.tellerWorkspace.setAttribute('aria-hidden', 'true');
  document.body.classList.remove('teller-workspace-open');
  document.body.style.overflow = '';
  updateMobilePublicNavigation(state.currentAccount ? 'account' : 'home');
}

function switchTellerPanel(panelId, button) {
  $$('.teller-panel').forEach(panel => panel.classList.toggle('active', panel.id === panelId));
  $$('#tellerNav button').forEach(btn => btn.classList.toggle('active', btn === button));

  if (panelId === 'reportsPanel') loadMonthlyReport();
  if (panelId === 'allAccountsPanel') {
    refreshSharedData().then(renderAllAccounts);
  }

  if (window.matchMedia('(max-width: 780px)').matches) {
    const content = $('.workspace-content');
    if (content) content.scrollTo({ top: 0, behavior: 'smooth' });
  }
}

function renderAllBatchGrids() {
  ensureBatchRowCount('LAST_SALDO', requestedRowCount('LAST_SALDO'));
  ensureBatchRowCount('TRANSFER', requestedRowCount('TRANSFER'));
  ensureBatchRowCount('SALARY', requestedRowCount('SALARY'));
  ensureBatchRowCount('REWARD', requestedRowCount('REWARD'));
}

function rowInputIdForType(type) {
  return {
    LAST_SALDO: 'lastBalanceRows',
    TRANSFER: 'transferRows',
    SALARY: 'salaryRows',
    REWARD: 'rewardRows'
  }[type];
}

function typeFromRowInputId(inputId) {
  return {
    lastBalanceRows: 'LAST_SALDO',
    transferRows: 'TRANSFER',
    salaryRows: 'SALARY',
    rewardRows: 'REWARD'
  }[inputId];
}

function requestedRowCount(type) {
  const input = document.getElementById(rowInputIdForType(type));
  const value = Number.parseInt(input?.value, 10);
  return Number.isInteger(value) && value > 0 ? value : CONFIG.DEFAULT_ROWS;
}

function updateBatchRowCountFromInput(inputId) {
  const type = typeFromRowInputId(inputId);
  if (!type) return;

  const input = document.getElementById(inputId);
  let target = Number.parseInt(input.value, 10);
  if (!Number.isInteger(target) || target < 1) target = 1;
  input.value = String(target);

  const actual = ensureBatchRowCount(type, target);
  input.value = String(actual);
}

function ensureBatchRowCount(type, targetCount) {
  const config = batchConfig(type);
  const container = document.getElementById(config.gridId);
  if (!container) return 0;

  targetCount = Math.max(1, Number.parseInt(targetCount, 10) || CONFIG.DEFAULT_ROWS);
  let rows = $$('.batch-row', container);

  if (rows.length < targetCount) {
    for (let i = rows.length; i < targetCount; i++) {
      appendBatchRow(type);
    }
  } else if (rows.length > targetCount) {
    // Remove only blank rows. Filled rows are never destroyed by a row-count change.
    for (let i = rows.length - 1; i >= 0 && rows.length > targetCount; i--) {
      if (isBatchRowPristine(type, rows[i])) {
        rows[i].remove();
        rows.splice(i, 1);
      }
    }
  }

  renumberBatchRows(type);
  const actual = $$('.batch-row', container).length;
  const input = document.getElementById(rowInputIdForType(type));
  if (input) input.value = String(actual);
  return actual;
}

function appendBatchRow(type) {
  const config = batchConfig(type);
  const container = document.getElementById(config.gridId);
  if (!container) return null;

  const number = $$('.batch-row', container).length + 1;
  const row = document.createElement('div');
  row.className = `batch-row ${config.className}`;
  row.dataset.type = type;
  row.dataset.index = String(number - 1);
  row.innerHTML = buildBatchRowHtml(type, number);
  container.appendChild(row);
  bindBatchRowEvents(row, type);
  applyBatchModeVisuals(type);
  applyDescriptionModeVisuals(type);
  applyAmountModeVisuals(type);
  applyCompactRecipientMode(type);
  return row;
}

function addBatchRow(type) {
  appendBatchRow(type);
  const config = batchConfig(type);
  const count = $$('.batch-row', document.getElementById(config.gridId)).length;
  const input = document.getElementById(rowInputIdForType(type));
  if (input) input.value = String(count);
  renumberBatchRows(type);
}

function renumberBatchRows(type) {
  const config = batchConfig(type);
  const container = document.getElementById(config.gridId);
  if (!container) return;
  $$('.batch-row', container).forEach((row, index) => {
    row.dataset.index = String(index);
    const badge = $('.batch-index', row);
    if (badge) badge.textContent = String(index + 1).padStart(2, '0');
  });
}

function isBatchRowPristine(type, row) {
  const amountRaw = $('.js-amount', row)?.dataset.rawValue || $('.js-amount', row)?.value.replace(/,/g, '') || '';
  const description = $('.js-description', row)?.value.trim() || '';
  const recipient = $('.js-recipient-account', row)?.value.trim() || '';
  const sender = $('.js-sender-account', row)?.value.trim() || '';
  const provider = $('.js-provider-account', row)?.value.trim() || '';
  const defaultDescription = type === 'LAST_SALDO' && description === 'Saldo akhir';

  return !recipient && !sender && !provider && !amountRaw && (!description || defaultDescription);
}

function resetBatchRows(type, count) {
  const config = batchConfig(type);
  const container = document.getElementById(config.gridId);
  if (!container) return;
  container.innerHTML = '';
  const target = Math.max(1, Number.parseInt(count, 10) || CONFIG.DEFAULT_ROWS);
  for (let i = 0; i < target; i++) appendBatchRow(type);
  const input = document.getElementById(rowInputIdForType(type));
  if (input) input.value = String(target);
  resetSingleDescription(type);
  resetSingleAmount(type);
  resetCompactSharedDate(type);
  applyDescriptionModeVisuals(type);
  applyAmountModeVisuals(type);
  applyCompactRecipientMode(type);
}

function setBatchMode(type, mode) {
  if (type === 'LAST_SALDO') return;

  mode = mode === 'BULK' ? 'BULK' : 'STANDARD';
  const previous = state.batchModes[type] || 'STANDARD';

  if (mode === 'BULK' && previous !== 'BULK') seedBulkSourceFromRows(type);
  if (mode === 'STANDARD' && previous === 'BULK') applyBulkSourceToEmptyRows(type);

  state.batchModes[type] = mode;
  applyBatchModeVisuals(type);
}

function applyBatchModeVisuals(type) {
  const config = batchConfig(type);
  const panel = document.getElementById(config.panelId);
  if (!panel) return;
  const mode = state.batchModes[type] || 'STANDARD';
  panel.classList.toggle('bulk-mode', mode === 'BULK');

  $$(`[data-mode-type="${type}"]`).forEach(button => {
    button.classList.toggle('active', button.dataset.mode === mode);
  });

  const bulkBar = $(`[data-bulk-config="${type}"]`);
  if (bulkBar) bulkBar.classList.toggle('is-hidden', mode !== 'BULK');
  applyCompactRecipientMode(type);
}

function isBulkMode(type) {
  if (type === 'LAST_SALDO') return false;
  return state.batchModes[type] === 'BULK';
}

function setDescriptionMode(type, mode) {
  mode = mode === 'SINGLE' ? 'SINGLE' : 'MULTI';
  const previous = state.descriptionModes[type] || 'MULTI';

  // When SINGLE is opened for the first time, use the first existing
  // row description as a convenience seed. Existing row descriptions
  // themselves are never changed or erased.
  if (mode === 'SINGLE' && previous !== 'SINGLE') {
    seedSingleDescriptionFromRows(type);
  }

  state.descriptionModes[type] = mode;
  applyDescriptionModeVisuals(type);
}

function applyDescriptionModeVisuals(type) {
  const config = batchConfig(type);
  const panel = document.getElementById(config?.panelId);
  if (!panel) return;

  const mode = state.descriptionModes[type] || 'MULTI';
  panel.classList.toggle('single-description-mode', mode === 'SINGLE');

  $$(`[data-desc-type="${type}"][data-desc-mode]`).forEach(button => {
    button.classList.toggle('active', button.dataset.descMode === mode);
  });

  const singleBar = $(`[data-single-desc-config="${type}"]`);
  if (singleBar) singleBar.classList.toggle('is-hidden', mode !== 'SINGLE');
  applyCompactRecipientMode(type);
}

function isSingleDescriptionMode(type) {
  return state.descriptionModes[type] === 'SINGLE';
}

function singleDescriptionInputForType(type) {
  const id = {
    LAST_SALDO: 'lastBalanceSingleDescription',
    TRANSFER: 'transferSingleDescription',
    SALARY: 'salarySingleDescription',
    REWARD: 'rewardSingleDescription'
  }[type];

  return id ? document.getElementById(id) : null;
}

function getSingleDescription(type) {
  return singleDescriptionInputForType(type)?.value.trim() || '';
}

function seedSingleDescriptionFromRows(type) {
  const sharedInput = singleDescriptionInputForType(type);
  if (!sharedInput || sharedInput.value.trim()) return;

  const config = batchConfig(type);
  const container = document.getElementById(config.gridId);
  if (!container) return;

  const firstFilled = $$('.js-description', container)
    .map(input => input.value.trim())
    .find(Boolean);

  if (firstFilled) {
    sharedInput.value = firstFilled;
    return;
  }

  if (type === 'LAST_SALDO') {
    sharedInput.value = 'Saldo akhir';
  }
}

function resetSingleDescription(type) {
  const input = singleDescriptionInputForType(type);
  if (!input) return;
  input.value = type === 'LAST_SALDO' ? 'Saldo akhir' : '';
}

function setAmountMode(type, mode) {
  mode = mode === 'SINGLE' ? 'SINGLE' : 'MULTI';
  const previous = state.amountModes[type] || 'MULTI';

  if (mode === 'SINGLE' && previous !== 'SINGLE') {
    seedSingleAmountFromRows(type);
  }

  state.amountModes[type] = mode;
  applyAmountModeVisuals(type);
}

function applyAmountModeVisuals(type) {
  const config = batchConfig(type);
  const panel = document.getElementById(config?.panelId);
  if (!panel) return;

  const mode = state.amountModes[type] || 'MULTI';
  panel.classList.toggle('single-amount-mode', mode === 'SINGLE');

  $$(`[data-amount-type="${type}"][data-amount-mode]`).forEach(button => {
    button.classList.toggle('active', button.dataset.amountMode === mode);
  });

  const singleBar = $(`[data-single-amount-config="${type}"]`);
  if (singleBar) singleBar.classList.toggle('is-hidden', mode !== 'SINGLE');
  applyCompactRecipientMode(type);
}

function isSingleAmountMode(type) {
  return state.amountModes[type] === 'SINGLE';
}

function singleAmountInputForType(type) {
  const id = {
    LAST_SALDO: 'lastBalanceSingleAmount',
    TRANSFER: 'transferSingleAmount',
    SALARY: 'salarySingleAmount',
    REWARD: 'rewardSingleAmount'
  }[type];

  return id ? document.getElementById(id) : null;
}

function getSingleAmountRaw(type) {
  const input = singleAmountInputForType(type);
  if (!input) return '';
  return input.dataset.rawValue || input.value.replace(/[^0-9]/g, '');
}

function seedSingleAmountFromRows(type) {
  const input = singleAmountInputForType(type);
  if (!input || getSingleAmountRaw(type)) return;

  const config = batchConfig(type);
  const container = document.getElementById(config.gridId);
  if (!container) return;

  const firstAmountInput = $$('.js-amount', container).find(amountInput => {
    const raw = amountInput.dataset.rawValue || amountInput.value.replace(/[^0-9]/g, '');
    return Boolean(raw);
  });

  if (!firstAmountInput) return;
  const raw = firstAmountInput.dataset.rawValue || firstAmountInput.value.replace(/[^0-9]/g, '');
  input.dataset.rawValue = raw;
  input.value = Number(raw).toLocaleString('en-US');
}

function resetSingleAmount(type) {
  const input = singleAmountInputForType(type);
  if (!input) return;
  input.value = '';
  delete input.dataset.rawValue;
}

function isCompactRecipientMode(type) {
  return ['TRANSFER', 'SALARY', 'REWARD'].includes(type) &&
    isBulkMode(type) &&
    isSingleDescriptionMode(type) &&
    isSingleAmountMode(type);
}

function compactDateInputForType(type) {
  const id = {
    TRANSFER: 'transferCompactDate',
    SALARY: 'salaryCompactDate',
    REWARD: 'rewardCompactDate'
  }[type];
  return id ? document.getElementById(id) : null;
}

function getCompactSharedDate(type) {
  const input = compactDateInputForType(type);
  return input?.value || '';
}

function seedCompactDateFromRows(type) {
  const input = compactDateInputForType(type);
  if (!input) return;

  const config = batchConfig(type);
  const container = document.getElementById(config?.gridId);
  const firstDate = container
    ? $$('.js-date', container).map(dateInput => dateInput.value).find(Boolean)
    : '';

  input.value = firstDate || dateInputValue(new Date());
}

function syncCompactDateToRows(type) {
  const input = compactDateInputForType(type);
  const config = batchConfig(type);
  const container = document.getElementById(config?.gridId);
  if (!input || !container) return;

  const date = input.value || dateInputValue(new Date());
  input.value = date;
  $$('.js-date', container).forEach(dateInput => {
    dateInput.value = date;
  });
}

function resetCompactSharedDate(type) {
  const input = compactDateInputForType(type);
  if (!input) return;
  input.value = dateInputValue(new Date());
}

function applyCompactRecipientMode(type) {
  const config = batchConfig(type);
  const panel = document.getElementById(config?.panelId);
  if (!panel) return;

  const compact = isCompactRecipientMode(type);
  const wasCompact = panel.classList.contains('compact-recipient-mode');
  panel.classList.toggle('compact-recipient-mode', compact);

  const dateBar = $(`[data-compact-date-config="${type}"]`, panel);
  if (dateBar) dateBar.classList.toggle('is-hidden', !compact);

  if (compact) {
    if (!wasCompact || !getCompactSharedDate(type)) seedCompactDateFromRows(type);
    syncCompactDateToRows(type);
  }
}

function seedBulkSourceFromRows(type) {
  const config = batchConfig(type);
  const container = document.getElementById(config.gridId);
  if (!container) return;

  if (type === 'TRANSFER') {
    const source = $$('.js-sender-account', container).find(input => input.value.trim());
    if (source && !$('#transferBulkSender').value.trim()) {
      $('#transferBulkSender').value = source.value.trim();
      resolveBulkSender();
    }
    return;
  }

  if (type === 'SALARY' || type === 'REWARD') {
    const source = $$('.js-provider-account', container).find(select => select.value);
    const bulkSelect = document.getElementById(type === 'SALARY' ? 'salaryBulkProvider' : 'rewardBulkProvider');
    if (source && bulkSelect && !bulkSelect.value) bulkSelect.value = source.value;
    validateBulkProvider(type);
  }
}

function applyBulkSourceToEmptyRows(type) {
  const config = batchConfig(type);
  const container = document.getElementById(config.gridId);
  if (!container) return;

  if (type === 'TRANSFER') {
    const shared = $('#transferBulkSender')?.value.trim() || '';
    if (!shared) return;
    $$('.batch-row', container).forEach(row => {
      const input = $('.js-sender-account', row);
      if (input && !input.value.trim()) {
        input.value = shared;
        resolveBatchAccount(row, input, type);
      }
    });
    return;
  }

  if (type === 'SALARY' || type === 'REWARD') {
    const bulkSelect = document.getElementById(type === 'SALARY' ? 'salaryBulkProvider' : 'rewardBulkProvider');
    const shared = bulkSelect?.value || '';
    if (!shared) return;
    $$('.batch-row', container).forEach(row => {
      const select = $('.js-provider-account', row);
      if (select && !select.value) select.value = shared;
      validateWholeBatchRow(row, type);
    });
  }
}

function resolveBulkSender() {
  const input = $('#transferBulkSender');
  const nameInput = $('#transferBulkSenderName');
  const warning = $('#transferBulkSenderWarning');
  if (!input || !nameInput || !warning) return;

  const account = normalizeAccount(input.value);
  warning.textContent = '';
  nameInput.value = '';
  if (!account) return;

  const record = state.masterMap.get(account);
  if (!record) {
    warning.textContent = 'Account not found';
    return;
  }

  nameInput.value = record.name || '';
  if (isFrozenStatus(record.status)) warning.textContent = 'FROZEN — transactions are prohibited';
}

function validateBulkProvider(type) {
  if (type !== 'SALARY' && type !== 'REWARD') return;
  const select = document.getElementById(type === 'SALARY' ? 'salaryBulkProvider' : 'rewardBulkProvider');
  const warning = document.getElementById(type === 'SALARY' ? 'salaryBulkProviderWarning' : 'rewardBulkProviderWarning');
  if (!select || !warning) return;
  warning.textContent = '';
  if (!select.value) return;

  const record = state.masterMap.get(normalizeAccount(select.value));
  if (!record) {
    warning.textContent = 'SOURCE account not found';
    return;
  }
  if (isFrozenStatus(record.status)) warning.textContent = 'FROZEN — transactions are prohibited';
}

function batchConfig(type) {
  return {
    LAST_SALDO: { panelId: 'lastBalancePanel', gridId: 'lastBalanceGrid', className: 'last-saldo' },
    TRANSFER: { panelId: 'transferPanel', gridId: 'transferGrid', className: 'transfer' },
    SALARY: { panelId: 'salaryPanel', gridId: 'salaryGrid', className: 'provider' },
    REWARD: { panelId: 'rewardPanel', gridId: 'rewardGrid', className: 'provider' }
  }[type];
}

function buildBatchRowHtml(type, number) {
  const today = dateInputValue(new Date());
  const index = `
    <div class="batch-row-leading">
      <div class="batch-index">${String(number).padStart(2, '0')}</div>
      <button class="row-clear-button" type="button" title="Clear this row">CLEAR</button>
    </div>`;
  const date = fieldHtml('Date', `<input class="batch-input js-date" type="date" value="${today}">`, 'date-field');
  const amount = fieldHtml('Amount', `<div class="currency-input"><span>${CONFIG.CURRENCY}</span><input class="js-amount" type="text" inputmode="numeric" placeholder="0"></div>`, 'amount-field');
  const description = fieldHtml('Description', `<input class="batch-input js-description" type="text" placeholder="Required">`, 'description-field');

  if (type === 'LAST_SALDO') {
    return [
      index,
      date,
      accountFieldHtml('Recipient account', 'js-recipient-account', 'recipient-account-field'),
      readonlyNameFieldHtml('Recipient name', 'js-recipient-name', 'recipient-name-field'),
      amount,
      fieldHtml('Description', `<input class="batch-input js-description" type="text" value="Saldo akhir" placeholder="Required">`, 'description-field')
    ].join('');
  }

  if (type === 'TRANSFER') {
    return [
      index,
      date,
      accountFieldHtml('Sender account', 'js-sender-account', 'bulk-source-field'),
      readonlyNameFieldHtml('Sender name', 'js-sender-name', 'bulk-source-field'),
      accountFieldHtml('Recipient account', 'js-recipient-account', 'recipient-account-field'),
      readonlyNameFieldHtml('Recipient name', 'js-recipient-name', 'recipient-name-field'),
      amount,
      description
    ].join('');
  }

  const providers = type === 'SALARY' ? state.providersOffice : state.providersReward;
  const providerOptions = ['<option value="">Select SOURCE</option>']
    .concat(providers.map(item => `<option value="${escapeAttr(item.account)}">${escapeHtml(item.account)} — ${escapeHtml(item.name)}</option>`))
    .join('');

  return [
    index,
    date,
    fieldHtml('SOURCE', `<select class="batch-select js-provider-account">${providerOptions}</select>`, 'bulk-source-field'),
    accountFieldHtml('Recipient account', 'js-recipient-account', 'recipient-account-field'),
    readonlyNameFieldHtml('Recipient name', 'js-recipient-name', 'recipient-name-field'),
    amount,
    description
  ].join('');
}

function fieldHtml(label, control, extraClass = '') {
  return `<div class="batch-field ${extraClass}"><label>${label}</label>${control}<div class="account-warning"></div></div>`;
}

function accountFieldHtml(label, className, extraClass = '') {
  return fieldHtml(label, `<input class="batch-input ${className}" type="text" autocomplete="off" placeholder="Account no.">`, extraClass);
}

function readonlyNameFieldHtml(label, className, extraClass = '') {
  return fieldHtml(label, `<input class="batch-input ${className}" type="text" value="" readonly placeholder="Auto-filled">`, extraClass);
}

function bindBatchRowEvents(row, type) {
  $$('.js-amount', row).forEach(input => input.addEventListener('input', formatMoneyInput));

  const clearButton = $('.row-clear-button', row);
  if (clearButton) {
    clearButton.addEventListener('click', () => clearBatchRow(type, row));
  }

  $$('.js-sender-account, .js-recipient-account', row).forEach(input => {
    input.addEventListener('input', () => resolveBatchAccount(row, input, type));
    input.addEventListener('blur', () => resolveBatchAccount(row, input, type));
  });

  // Spreadsheet-style multi-row paste is available on every row-based input:
  // Date, Sender/Recipient Account, Amount, and Description.
  $$('.js-date, .js-sender-account, .js-recipient-account, .js-amount, .js-description', row).forEach(input => {
    input.addEventListener('paste', event => handleMultiRowFieldPaste(event, row, input, type));
  });

  const provider = $('.js-provider-account', row);
  if (provider) provider.addEventListener('change', () => validateWholeBatchRow(row, type));
}

function clearBatchRow(type, row, showFeedback = true) {
  if (!row) return;

  const date = $('.js-date', row);
  if (date) date.value = isCompactRecipientMode(type)
    ? (getCompactSharedDate(type) || dateInputValue(new Date()))
    : dateInputValue(new Date());

  $$('.js-sender-account, .js-recipient-account', row).forEach(input => {
    input.value = '';
  });
  $$('.js-sender-name, .js-recipient-name', row).forEach(input => {
    input.value = '';
  });

  const provider = $('.js-provider-account', row);
  if (provider) provider.value = '';

  const amount = $('.js-amount', row);
  if (amount) {
    amount.value = '';
    delete amount.dataset.rawValue;
  }

  const description = $('.js-description', row);
  if (description) description.value = type === 'LAST_SALDO' ? 'Saldo akhir' : '';

  $$('.account-warning', row).forEach(warning => { warning.textContent = ''; });
  row.classList.remove('frozen');
  clearPendingBatchRequest(type);

  if (showFeedback) toast('Row data cleared.');
}

function clearAllBatchData(type) {
  const config = batchConfig(type);
  const container = document.getElementById(config?.gridId);
  if (!container) return;

  const ok = window.confirm('Clear all entered data in this transaction form? The current row count will be kept.');
  if (!ok) return;

  $$('.batch-row', container).forEach(row => clearBatchRow(type, row, false));

  if (type === 'TRANSFER') {
    const sender = $('#transferBulkSender');
    const senderName = $('#transferBulkSenderName');
    const warning = $('#transferBulkSenderWarning');
    if (sender) sender.value = '';
    if (senderName) senderName.value = '';
    if (warning) warning.textContent = '';
  }

  if (type === 'SALARY' || type === 'REWARD') {
    const select = document.getElementById(type === 'SALARY' ? 'salaryBulkProvider' : 'rewardBulkProvider');
    const warning = document.getElementById(type === 'SALARY' ? 'salaryBulkProviderWarning' : 'rewardBulkProviderWarning');
    if (select) select.value = '';
    if (warning) warning.textContent = '';
  }

  resetSingleDescription(type);
  resetSingleAmount(type);
  resetCompactSharedDate(type);
  syncCompactDateToRows(type);
  clearPendingBatchRequest(type);
  toast('All entered data cleared.', 'success');
}

function removeLastBatchRow(type) {
  const config = batchConfig(type);
  const container = document.getElementById(config?.gridId);
  if (!container) return;

  const rows = $$('.batch-row', container);
  if (rows.length <= 1) {
    toast('At least one transaction row must remain.', 'error');
    return;
  }

  const lastRow = rows[rows.length - 1];
  if (!isBatchRowPristine(type, lastRow)) {
    const ok = window.confirm('The last row contains data. Remove this row anyway?');
    if (!ok) return;
  }

  lastRow.remove();
  renumberBatchRows(type);
  const count = $$('.batch-row', container).length;
  const input = document.getElementById(rowInputIdForType(type));
  if (input) input.value = String(count);
  clearPendingBatchRequest(type);
  toast('Last row removed.');
}

/**
 * Spreadsheet-style multi-row paste for every editable transaction field.
 *
 * Example:
 *   1000
 *   2500
 *   3000
 *
 * Paste those values into Amount on row 02 and they automatically populate
 * Amount on rows 02, 03, and 04. The same behavior works for Date,
 * Sender/Recipient Account, and Description.
 *
 * If the grid is too short, missing rows are added automatically.
 * Existing values in unrelated fields are never cleared.
 */
function handleMultiRowFieldPaste(event, sourceRow, sourceInput, type) {
  const clipboardText = event.clipboardData?.getData('text') || '';
  const values = parsePastedRowValues(clipboardText);

  // Preserve normal browser paste behavior for a single value.
  if (values.length <= 1) return;

  const targetSelector = getBatchPasteTargetSelector(sourceInput);
  if (!targetSelector) return;

  event.preventDefault();

  const config = batchConfig(type);
  const container = document.getElementById(config.gridId);
  if (!container) return;

  let rows = $$('.batch-row', container);
  const startIndex = rows.indexOf(sourceRow);
  if (startIndex < 0) return;

  const requiredRowCount = startIndex + values.length;
  ensureBatchRowCount(type, requiredRowCount);

  // Re-read after the grid may have been expanded.
  rows = $$('.batch-row', container);

  let lastInput = null;
  let appliedCount = 0;
  let invalidDateCount = 0;

  values.forEach((value, offset) => {
    const row = rows[startIndex + offset];
    if (!row) return;

    const input = $(targetSelector, row);
    if (!input) return;

    // Blank source rows keep their position but do not erase existing data.
    if (String(value || '').trim() === '') {
      lastInput = input;
      return;
    }

    const result = applyPastedValueToBatchField(input, value, row, type);

    if (result === 'invalid-date') {
      invalidDateCount++;
    } else if (result) {
      appliedCount++;
    }

    lastInput = input;
  });

  renumberBatchRows(type);

  const rowCountInput = document.getElementById(rowInputIdForType(type));
  if (rowCountInput) rowCountInput.value = String(rows.length);

  if (lastInput) lastInput.focus();

  const fieldLabel = getBatchPasteFieldLabel(sourceInput);

  if (appliedCount) {
    toast(`${appliedCount} ${fieldLabel} value${appliedCount === 1 ? '' : 's'} pasted into consecutive rows.`, 'success');
  }

  if (invalidDateCount) {
    toast(`${invalidDateCount} pasted date${invalidDateCount === 1 ? '' : 's'} could not be recognized and were left unchanged.`, 'error');
  }
}

function getBatchPasteTargetSelector(input) {
  if (input.classList.contains('js-date')) return '.js-date';
  if (input.classList.contains('js-sender-account')) return '.js-sender-account';
  if (input.classList.contains('js-recipient-account')) return '.js-recipient-account';
  if (input.classList.contains('js-amount')) return '.js-amount';
  if (input.classList.contains('js-description')) return '.js-description';
  return '';
}

function getBatchPasteFieldLabel(input) {
  if (input.classList.contains('js-date')) return 'date';
  if (input.classList.contains('js-sender-account')) return 'sender account';
  if (input.classList.contains('js-recipient-account')) return 'recipient account';
  if (input.classList.contains('js-amount')) return 'amount';
  if (input.classList.contains('js-description')) return 'description';
  return 'field';
}

function applyPastedValueToBatchField(input, value, row, type) {
  const text = String(value ?? '').trim();

  if (input.classList.contains('js-date')) {
    const normalized = normalizePastedDateValue(text);
    if (!normalized) return 'invalid-date';
    input.value = normalized;
    return true;
  }

  if (input.classList.contains('js-amount')) {
    const raw = text.replace(/[^0-9]/g, '');
    if (!raw) return false;
    input.dataset.rawValue = raw;
    input.value = Number(raw).toLocaleString('en-US');
    return true;
  }

  if (
    input.classList.contains('js-sender-account') ||
    input.classList.contains('js-recipient-account')
  ) {
    input.value = text;
    resolveBatchAccount(row, input, type);
    return true;
  }

  if (input.classList.contains('js-description')) {
    input.value = text;
    return true;
  }

  input.value = text;
  return true;
}

/**
 * Copying one spreadsheet column normally produces one line per row.
 * Tabs are also accepted so a copied horizontal run still behaves as
 * a vertical paste, matching the site's row-by-row input model.
 *
 * Empty values in the middle are preserved as row positions and do
 * not erase existing form data.
 */
function parsePastedRowValues(text) {
  const normalized = String(text || '').replace(/\r/g, '');
  const values = normalized
    .split(/[\n\t]/)
    .map(value => value.trim());

  // Clipboard selections commonly end with a newline. Remove only trailing
  // empty cells so they do not create unnecessary extra transaction rows.
  while (values.length && values[values.length - 1] === '') {
    values.pop();
  }

  return values;
}

function normalizePastedDateValue(value) {
  const text = String(value || '').trim();
  if (!text) return '';

  // Native HTML date value.
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    return normalizeDateForInput(text);
  }

  // Indonesian / common spreadsheet style: DD/MM/YYYY or DD-MM-YYYY.
  const dayFirst = text.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})$/);
  if (dayFirst) {
    const day = Number(dayFirst[1]);
    const month = Number(dayFirst[2]);
    const year = Number(dayFirst[3]);

    const date = new Date(year, month - 1, day);
    if (
      date.getFullYear() === year &&
      date.getMonth() === month - 1 &&
      date.getDate() === day
    ) {
      return dateInputValue(date);
    }
  }

  // Fallback for formats such as "26 Aug 2026" or "August 26, 2026".
  const parsed = new Date(text);
  if (!Number.isNaN(parsed.getTime())) {
    return dateInputValue(parsed);
  }

  return '';
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
  if (type === 'TRANSFER') {
    const sender = isBulkMode(type) ? $('#transferBulkSender')?.value : $('.js-sender-account', row)?.value;
    accounts.push(sender, $('.js-recipient-account', row)?.value);
  }
  if (type === 'LAST_SALDO') accounts.push($('.js-recipient-account', row)?.value);
  if (type === 'SALARY' || type === 'REWARD') {
    const bulkSelect = document.getElementById(type === 'SALARY' ? 'salaryBulkProvider' : 'rewardBulkProvider');
    const provider = isBulkMode(type) ? bulkSelect?.value : $('.js-provider-account', row)?.value;
    accounts.push(provider, $('.js-recipient-account', row)?.value);
  }
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

  if (state.processingTypes.has(type)) {
    return;
  }

  const config = batchConfig(type);

  const inputStaff = {
    id: state.teller.id,
    name: state.teller.name
  };

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

  const pending = getOrCreatePendingBatchRequest(type, payload);
  payload.clientRequestId = pending.requestId;

  state.processingTypes.add(type);
  setProcessButtonState(button, true, entries.length);

  try {
    /*
      The POST is only the write command. Its redirected Apps Script response
      is intentionally NOT used as proof of success.

      Confirmation comes from GET batchStatus with the deterministic Request ID.
      This removes the false-failure case where the sheet write succeeded but
      the browser could not read the redirected POST response.
    */
    const result = await submitBatchAndConfirm(payload);

    clearPendingBatchRequest(type, payload.clientRequestId);

    if (result.duplicate || result.recovered) {
      toast('Transaction already existed. No duplicate was created.', 'success');
    } else {
      toast(`${result.processed || entries.length} input${entries.length > 1 ? 's' : ''} processed successfully.`, 'success');
    }

    resetBatchRows(type, rows.length);

    // Never block PROCESS on slow refresh work.
    window.setTimeout(() => {
      refreshSharedData()
        .then(() => {
          if (state.currentAccount) {
            return refreshCurrentAccountView();
          }
        })
        .catch(error => console.warn('Background refresh failed:', error));
    }, 50);

  } catch (error) {
    if (error?.transactionFailed) {
      clearPendingBatchRequest(type, payload.clientRequestId);
      toast(error.message || 'Transaction was rejected by the backend.', 'error');
    } else {
      /*
        Keep the Request ID. A retry with unchanged rows reuses the same ID,
        so the backend cannot write a second copy.
      */
      toast(
        'Confirmation is temporarily unavailable. This Request ID is protected against duplicates. Press PROCESS again with the same rows to re-check safely.',
        'error'
      );
    }
  } finally {
    state.processingTypes.delete(type);
    setProcessButtonState(button, false);
  }
}

function setProcessButtonState(button, processing, count = 0) {
  if (!button) return;

  button.disabled = processing;
  button.classList.toggle('is-processing', processing);

  if (processing) {
    button.dataset.defaultLabel = button.dataset.defaultLabel || button.textContent.trim() || 'PROCESS';
    button.innerHTML = `<span class="process-spinner" aria-hidden="true"></span><span>PROCESSING${count > 1 ? ` ${count}` : ''}…</span>`;
    button.setAttribute('aria-busy', 'true');
  } else {
    button.textContent = button.dataset.defaultLabel || 'PROCESS';
    button.removeAttribute('aria-busy');
  }
}

async function submitBatchAndConfirm(payload) {
  const expectedRows = payload.type === 'LAST_SALDO'
    ? payload.entries.length
    : payload.entries.length * 2;

  payload.clientAttempt = 1;
  dispatchBatchCommand(payload);

  let confirmation = await waitForBatchConfirmation(
    payload.clientRequestId,
    expectedRows,
    CONFIG.BATCH_FIRST_CONFIRM_MS
  );

  if (confirmation) return confirmation;

  // Safe retry: same Request ID, never a new financial request.
  payload.clientAttempt = 2;
  dispatchBatchCommand(payload);

  confirmation = await waitForBatchConfirmation(
    payload.clientRequestId,
    expectedRows,
    CONFIG.BATCH_SECOND_CONFIRM_MS
  );

  if (confirmation) return confirmation;

  const error = new Error('Transaction confirmation timed out.');
  error.confirmationUnavailable = true;
  throw error;
}

function dispatchBatchCommand(payload) {
  const url = new URL(CONFIG.API_URL);
  url.searchParams.set('action', 'batchTransaction');
  url.searchParams.set('_', Date.now());

  const body = new URLSearchParams();
  body.set('action', 'batchTransaction');
  body.set('payload', JSON.stringify(payload));

  /*
    no-cors is intentional. The write command can reach Apps Script without
    requiring the browser to read the redirected ContentService POST response.
    The independent GET batchStatus endpoint is the source of truth.
  */
  fetch(url.toString(), {
    method: 'POST',
    mode: 'no-cors',
    redirect: 'follow',
    cache: 'no-store',
    body
  }).catch(error => {
    console.warn('Batch command transport warning:', error);
  });
}

async function waitForBatchConfirmation(requestId, expectedRows, timeoutMs) {
  const startedAt = Date.now();
  let recordedSince = 0;

  while (Date.now() - startedAt < timeoutMs) {
    try {
      const status = await apiGet({
        action: 'batchStatus',
        requestId,
        expectedRows
      });

      if (status?.success) {
        if (status.state === 'COMPLETED') {
          return status.result || {
            success: true,
            processed: 0,
            clientRequestId: requestId
          };
        }

        if (status.state === 'FAILED') {
          const error = new Error(status.message || 'Transaction was rejected by the backend.');
          error.transactionFailed = true;
          throw error;
        }

        if (status.state === 'RECORDED') {
          if (!recordedSince) recordedSince = Date.now();

          // The log rows themselves are deterministic proof that the same
          // request has reached the ledger. Give completion receipt a short
          // grace period, then accept the recorded state rather than falsely
          // telling the teller it failed.
          if (Date.now() - recordedSince >= CONFIG.BATCH_RECORDED_GRACE_MS) {
            return {
              success: true,
              processed: status.processed || 0,
              ledgerRowsWritten: status.existingRows || expectedRows,
              clientRequestId: requestId,
              recordedConfirmation: true
            };
          }
        } else {
          recordedSince = 0;
        }
      }
    } catch (error) {
      if (error?.transactionFailed) throw error;
      console.warn('Batch confirmation check warning:', error);
    }

    await delay(CONFIG.BATCH_STATUS_INTERVAL_MS);
  }

  return null;
}

function getOrCreatePendingBatchRequest(type, payload) {
  const fingerprint = batchRequestFingerprint(payload);
  const store = readPendingBatchRequests();
  const current = store[type];
  const now = Date.now();

  if (
    current &&
    current.requestId &&
    current.fingerprint === fingerprint &&
    now - Number(current.createdAt || 0) <= CONFIG.BATCH_REQUEST_TTL_MS
  ) {
    return current;
  }

  const next = {
    requestId: createClientRequestId(),
    fingerprint,
    createdAt: now
  };

  store[type] = next;
  writePendingBatchRequests(store);
  return next;
}

function clearPendingBatchRequest(type, requestId) {
  const store = readPendingBatchRequests();
  if (!store[type]) return;
  if (requestId && store[type].requestId !== requestId) return;
  delete store[type];
  writePendingBatchRequests(store);
}

function readPendingBatchRequests() {
  try {
    const raw = localStorage.getItem(CONFIG.BATCH_REQUEST_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch (error) {
    return {};
  }
}

function writePendingBatchRequests(store) {
  try {
    localStorage.setItem(CONFIG.BATCH_REQUEST_STORAGE_KEY, JSON.stringify(store || {}));
  } catch (error) {
    console.warn('Unable to persist batch request state:', error);
  }
}

function batchRequestFingerprint(payload) {
  return JSON.stringify({
    type: payload.type,
    tellerId: payload.tellerId,
    inputStaffId: payload.inputStaffId,
    entries: payload.entries
  });
}

function createClientRequestId() {
  const randomPart = (window.crypto && typeof window.crypto.randomUUID === 'function')
    ? window.crypto.randomUUID().replace(/-/g, '')
    : `${Math.random().toString(36).slice(2)}${Math.random().toString(36).slice(2)}`;

  return `Z${Date.now().toString(36).toUpperCase()}${randomPart.slice(0, 18).toUpperCase()}`;
}

function delay(ms) {
  return new Promise(resolve => window.setTimeout(resolve, ms));
}

function extractBatchRow(type, row) {
  const compactRecipientMode = isCompactRecipientMode(type);
  const date = compactRecipientMode
    ? getCompactSharedDate(type)
    : ($('.js-date', row)?.value || '');
  const rowAmountRaw = $('.js-amount', row)?.dataset.rawValue || $('.js-amount', row)?.value.replace(/,/g, '') || '';
  const singleAmount = isSingleAmountMode(type);
  const amountRaw = singleAmount ? getSingleAmountRaw(type) : rowAmountRaw;
  const amount = Number(amountRaw);
  const rowDescription = $('.js-description', row)?.value.trim() || '';
  const singleDescription = isSingleDescriptionMode(type);
  const description = singleDescription ? getSingleDescription(type) : rowDescription;
  const bulk = isBulkMode(type);

  const recipientValue = $('.js-recipient-account', row)?.value.trim() || '';
  const rowSenderValue = $('.js-sender-account', row)?.value.trim() || '';
  const rowProviderValue = $('.js-provider-account', row)?.value.trim() || '';

  const sourceValue = type === 'TRANSFER'
    ? (bulk ? ($('#transferBulkSender')?.value.trim() || '') : rowSenderValue)
    : (type === 'SALARY' || type === 'REWARD')
      ? (bulk
          ? (document.getElementById(type === 'SALARY' ? 'salaryBulkProvider' : 'rewardBulkProvider')?.value || '')
          : rowProviderValue)
      : '';

  // A shared SINGLE DESCRIPTION must not make every blank row active.
  // In MULTI mode, a manually entered per-row description still counts as row activity.
  const rowDescriptionIsMeaningful = !singleDescription &&
    Boolean(rowDescription && !(type === 'LAST_SALDO' && rowDescription === 'Saldo akhir'));

  const rowAmountIsMeaningful = !singleAmount && Boolean(rowAmountRaw);

  const meaningful = Boolean(
    recipientValue ||
    rowAmountIsMeaningful ||
    rowDescriptionIsMeaningful ||
    (!bulk && sourceValue)
  );

  if (!meaningful) return null;

  if (!date) throw new Error('Every used row must have a date.');
  if (!amountRaw || !Number.isFinite(amount) || amount <= 0) throw new Error('Every used row must contain an amount greater than zero.');
  if (!description) throw new Error('Description is mandatory for every transaction.');

  if (type === 'LAST_SALDO') {
    const recipient = requireValidAccount(recipientValue, 'recipient');
    return { date, recipient: recipient.account, amount, description };
  }

  if (type === 'TRANSFER') {
    const sender = requireValidAccount(sourceValue, bulk ? 'bulk sender' : 'sender');
    const recipient = requireValidAccount(recipientValue, 'recipient');
    if (sender.account === recipient.account) throw new Error(`Sender and recipient cannot be the same account (${sender.account}).`);
    return { date, sender: sender.account, recipient: recipient.account, amount, description };
  }

  const provider = requireValidAccount(sourceValue, bulk ? 'bulk SOURCE' : 'SOURCE');
  const recipient = requireValidAccount(recipientValue, 'recipient');
  if (provider.account === recipient.account) throw new Error(`SOURCE and recipient cannot be the same account (${provider.account}).`);

  if (type === 'SALARY' && !normalizeStatus(provider.status).includes('OFFICE/SHOP')) {
    throw new Error(`SOURCE ${provider.account} is not an OFFICE/SHOP account.`);
  }
  if (type === 'REWARD') {
    const status = normalizeStatus(provider.status);
    if (!status.includes('OFFICE/SHOP') && !status.includes('STAFF')) {
      throw new Error(`SOURCE ${provider.account} is not eligible for Rewards.`);
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

    if (els.reportSearchInput?.value.trim()) {
      searchTransactionInputs();
    } else {
      renderMonthlyReport(state.reportRows, els.reportMonth.value);
    }
  } catch (error) {
    toast(error.message, 'error');
  } finally {
    hideLoading();
  }
}

function reportTransactionKey(row, index = 0) {
  const txId = String(row?.txId || '').trim();
  if (!txId) return `UNPAIRED-${index}`;
  return txId.replace(/-(?:D|C)$/i, '');
}

function groupReportTransactions(rows) {
  const grouped = new Map();

  (rows || []).forEach((row, index) => {
    const key = reportTransactionKey(row, index);
    if (!grouped.has(key)) grouped.set(key, { key, rows: [] });
    grouped.get(key).rows.push(row);
  });

  return [...grouped.values()].map(group => {
    const members = group.rows;
    const debit = members.find(row => /-D$/i.test(String(row.txId || ''))) || members.find(row => parseMoney(row.log) < 0) || null;
    const credit = members.find(row => /-C$/i.test(String(row.txId || ''))) || members.find(row => parseMoney(row.log) > 0 && row !== debit) || null;
    const paired = Boolean(debit && credit && debit !== credit);
    const anchor = debit || credit || members[0] || {};

    const sourceRow = paired ? debit : (parseMoney(anchor.log) < 0 ? anchor : null);
    const recipientRow = paired ? credit : (parseMoney(anchor.log) >= 0 ? anchor : null);
    const amountRow = debit || credit || anchor;
    const amount = Math.abs(parseMoney(amountRow.log));
    const txIds = members.map(row => String(row.txId || '').trim()).filter(Boolean);
    const canEdit = members.length > 0 && members.every(row => Boolean(row.canEdit && row.txId));

    return {
      key: group.key,
      displayId: paired ? group.key : (txIds[0] || group.key),
      txIds,
      rows: members,
      paired,
      date: anchor.date || '',
      description: anchor.description || '',
      staffId: anchor.staffId || '',
      staffName: anchor.staffName || '',
      amount,
      canEdit,
      source: sourceRow ? {
        account: normalizeAccount(sourceRow.accountNumber),
        displayAccount: sourceRow.accountNumber || '',
        name: sourceRow.name || ''
      } : null,
      recipient: recipientRow ? {
        account: normalizeAccount(recipientRow.accountNumber),
        displayAccount: recipientRow.accountNumber || '',
        name: recipientRow.name || ''
      } : null
    };
  });
}

function findReportTransactionGroup(groupKey) {
  return groupReportTransactions(state.reportRows).find(group => group.key === groupKey || group.displayId === groupKey) || null;
}

function searchTransactionInputs() {
  const query = String(els.reportSearchInput?.value || '').trim().toLowerCase();

  if (!query) {
    renderMonthlyReport(state.reportRows, els.reportMonth.value);
    return;
  }

  const groups = groupReportTransactions(state.reportRows);
  const matches = groups.filter(group => {
    const idHaystack = [group.displayId, ...group.txIds].join(' ').toLowerCase();
    return idHaystack.includes(query);
  });

  renderMonthlyReportGroups(matches, els.reportMonth.value);

  if (!matches.length) {
    toast(`No Transaction ID matching "${els.reportSearchInput.value.trim()}" was found in this month.`, 'error');
  } else {
    toast(`${matches.length} matching transaction${matches.length === 1 ? '' : 's'} found.`, 'success');
  }
}

function renderMonthlyReport(rows, month) {
  renderMonthlyReportGroups(groupReportTransactions(rows), month);
}

function renderMonthlyReportGroups(groups, month) {
  els.reportTableBody.innerHTML = '';
  els.reportMonthLabel.textContent = monthLabel(month);
  els.reportEmpty.classList.toggle('is-hidden', groups.length !== 0);

  groups.forEach(group => {
    const tr = document.createElement('tr');
    tr.className = group.paired ? 'report-transaction-paired' : 'report-transaction-single';

    const routeStatus = group.paired ? '<span class="report-pair-badge">PAIRED</span>' : '<span class="report-pair-badge single">SINGLE-SIDED</span>';
    const staffLine = group.staffName ? `Input by ${escapeHtml(group.staffName)}` : 'Input staff —';

    tr.innerHTML = `
      <td>${escapeHtml(formatDateDisplay(group.date))}</td>
      <td>
        <div class="report-transaction-meta">
          <strong>${escapeHtml(group.displayId || '—')}</strong>
          <small>${staffLine}</small>
          ${routeStatus}
        </div>
      </td>
      <td>${reportPartyHtml(group.source, 'No sender / source')}</td>
      <td>${reportPartyHtml(group.recipient, 'No recipient')}</td>
      <td>${escapeHtml(group.description || '—')}</td>
      <td class="money-col amount-positive">${escapeHtml(formatCurrency(group.amount, false))}</td>
      <td class="report-action-col">
        <div class="action-buttons">
          <button type="button" data-edit-report-group="${escapeAttr(group.key)}" ${group.canEdit ? '' : 'disabled'}>EDIT</button>
          <button type="button" class="danger" data-delete-report-group="${escapeAttr(group.key)}" ${group.canEdit ? '' : 'disabled'}>DELETE</button>
        </div>
      </td>
    `;
    els.reportTableBody.appendChild(tr);
  });
}

function reportPartyHtml(party, emptyLabel) {
  if (!party?.account) {
    return `<span class="report-party-empty">${escapeHtml(emptyLabel)}</span>`;
  }

  return `
    <div class="report-party">
      <button class="ledger-inline-link ledger-name-link" type="button" data-open-ledger="${escapeAttr(party.account)}">${escapeHtml(party.name || '—')}</button>
      <button class="ledger-inline-link ledger-account-link" type="button" data-open-ledger="${escapeAttr(party.account)}">${escapeHtml(party.displayAccount || party.account)}</button>
    </div>
  `;
}

function handleReportAction(event) {
  const edit = event.target.closest('[data-edit-report-group]');
  const del = event.target.closest('[data-delete-report-group]');
  if (edit && !edit.disabled) openEditTransaction(edit.dataset.editReportGroup);
  if (del && !del.disabled) deleteTransaction(del.dataset.deleteReportGroup);
}

function openEditTransaction(groupKey) {
  const group = findReportTransactionGroup(groupKey);
  if (!group) return;

  els.editTransactionId.value = group.key;
  els.editTransactionDate.value = normalizeDateForInput(group.date);
  els.editTransactionAmount.dataset.rawValue = String(group.amount);
  els.editTransactionAmount.value = Number(group.amount || 0).toLocaleString('en-US');
  delete els.editTransactionAmount.dataset.sign;
  els.editTransactionDescription.value = group.description || '';
  els.editTransactionStaff.value = group.staffId || '';

  const route = document.getElementById('editTransactionRoute');
  if (route) {
    const source = group.source
      ? `${escapeHtml(group.source.name || '—')}<small>${escapeHtml(group.source.displayAccount || group.source.account)}</small>`
      : `Single-sided<small>No sender / source</small>`;
    const recipient = group.recipient
      ? `${escapeHtml(group.recipient.name || '—')}<small>${escapeHtml(group.recipient.displayAccount || group.recipient.account)}</small>`
      : `Single-sided<small>No recipient</small>`;

    route.innerHTML = `
      <div class="edit-route-id">
        <span>TRANSACTION</span>
        <strong>${escapeHtml(group.displayId || '—')}</strong>
        <small>${group.paired ? 'Sender and recipient log rows will stay synchronized.' : 'Single-sided ledger entry.'}</small>
      </div>
      <div class="edit-route-party">
        <span>FROM</span>
        <strong>${source}</strong>
      </div>
      <div class="edit-route-arrow" aria-hidden="true">→</div>
      <div class="edit-route-party">
        <span>TO</span>
        <strong>${recipient}</strong>
      </div>`;
  }

  openModal('editTransactionModal');
}

async function saveTransactionRevision(event) {
  event.preventDefault();
  const groupKey = els.editTransactionId.value;
  const group = findReportTransactionGroup(groupKey);
  const staff = state.staff.find(x => x.id === els.editTransactionStaff.value);
  const raw = els.editTransactionAmount.dataset.rawValue || els.editTransactionAmount.value.replace(/,/g, '');
  const amount = Number(raw);

  if (!group) return toast('Transaction group could not be found. Reload the month and try again.', 'error');
  if (!staff) return toast('Select the input staff.', 'error');
  if (!els.editTransactionDescription.value.trim()) return toast('Description is mandatory.', 'error');
  if (!amount || amount <= 0) return toast('Amount must be greater than zero.', 'error');

  showLoading(group.paired ? 'Saving paired transaction revision…' : 'Saving revision…');
  try {
    for (const original of group.rows) {
      const signedAmount = parseMoney(original.log) < 0 ? -amount : amount;
      const result = await apiPost('updateTransaction', {
        txId: original.txId,
        date: els.editTransactionDate.value,
        log: signedAmount,
        description: els.editTransactionDescription.value.trim(),
        inputStaffId: staff.id,
        inputStaffName: staff.name,
        tellerId: state.teller.id,
        tellerName: state.teller.name
      });
      if (!result.success) throw new Error(result.message || `Revision failed for ${original.txId}`);
    }

    closeModal('editTransactionModal');
    toast(group.paired ? 'Transaction pair revised together.' : 'Transaction revised.', 'success');
    await refreshSharedData();
    await loadMonthlyReport();
    if (state.currentAccount) await refreshCurrentAccountView();
  } catch (error) {
    toast(error.message, 'error');
  } finally {
    hideLoading();
  }
}

async function deleteTransaction(groupKey) {
  const group = findReportTransactionGroup(groupKey);
  if (!group) return;

  const scopeText = group.paired
    ? `Delete transaction ${group.displayId}? Both sender and recipient log rows will be deleted together.`
    : `Delete transaction ${group.displayId}? This is only permitted within one month of creation.`;
  const ok = window.confirm(scopeText);
  if (!ok) return;

  showLoading(group.paired ? 'Deleting paired transaction…' : 'Deleting transaction…');
  try {
    for (const row of group.rows) {
      const result = await apiPost('deleteTransaction', {
        txId: row.txId,
        tellerId: state.teller.id,
        tellerName: state.teller.name
      });
      if (!result.success) throw new Error(result.message || `Delete failed for ${row.txId}`);
    }

    toast(group.paired ? 'Transaction pair deleted.' : 'Transaction deleted.', 'success');
    await refreshSharedData();
    await loadMonthlyReport();
    if (state.currentAccount) await refreshCurrentAccountView();
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

async function apiPost(action, payload, options = {}) {
  // Put the action in BOTH the query string and POST body. Apps Script normally
  // exposes either one through e.parameter, but duplicating it makes the request
  // resilient to redirects / deployment quirks and prevents a blank action.
  const url = new URL(CONFIG.API_URL);
  url.searchParams.set('action', action);
  url.searchParams.set('_', Date.now());

  const body = new URLSearchParams();
  body.set('action', action);
  body.set('payload', JSON.stringify(payload));

  const timeoutMs = Number(options.timeoutMs) > 0
    ? Number(options.timeoutMs)
    : CONFIG.POST_TIMEOUT_MS;

  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), timeoutMs);

  let response;

  try {
    response = await fetch(url.toString(), {
      method: 'POST',
      redirect: 'follow',
      cache: 'no-store',
      body,
      signal: controller.signal
    });
  } catch (error) {
    const wrapped = new Error(
      error?.name === 'AbortError'
        ? 'The backend took too long to answer.'
        : 'The connection to the backend was interrupted.'
    );
    wrapped.ambiguous = true;
    wrapped.cause = error;
    throw wrapped;
  } finally {
    window.clearTimeout(timer);
  }

  if (!response.ok) {
    const wrapped = new Error(`API request failed (${response.status})`);

    // A gateway/server failure can occur after Apps Script has already accepted
    // the POST, so retry only with the SAME clientRequestId.
    wrapped.ambiguous = response.status === 408 ||
      response.status === 429 ||
      response.status >= 500;

    throw wrapped;
  }

  let result;
  try {
    result = await response.json();
  } catch (error) {
    const wrapped = new Error('Backend returned an unreadable response.');
    wrapped.ambiguous = true;
    wrapped.cause = error;
    throw wrapped;
  }

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

  if (id === 'tellerLoginModal' && !state.teller) {
    updateMobilePublicNavigation(state.currentAccount ? 'account' : 'home');
  }
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
