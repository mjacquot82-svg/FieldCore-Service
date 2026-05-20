const STORAGE_KEY = 'servicebatch_invoice_mvp_v1';
const AR_DASHBOARD_ID = 'ar-dashboard';

const currency = (amount) => new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD'
}).format(amount || 0);

function loadState() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY));
  } catch {
    return null;
  }
}

function customerMap(state) {
  return Object.fromEntries((state.customers || []).map((customer) => [customer.customer_id, customer]));
}

function todayString() {
  return new Date().toISOString().slice(0, 10);
}

function daysBetween(start, end) {
  const startDate = new Date(`${start}T00:00:00`);
  const endDate = new Date(`${end}T00:00:00`);
  if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) return 0;
  return Math.max(0, Math.floor((endDate - startDate) / 86400000));
}

function invoiceBalance(invoice) {
  return Math.max(0, Number((Number(invoice.total || 0) - Number(invoice.amount_paid || 0)).toFixed(2)));
}

function invoiceAge(invoice, today = todayString()) {
  if (!invoice.due_date || invoice.due_date >= today) return 0;
  return daysBetween(invoice.due_date, today);
}

function agingBucket(invoice, today = todayString()) {
  const balance = invoiceBalance(invoice);
  if (balance <= 0 || (invoice.payment_status || '') === 'paid') return 'paid';
  if (!invoice.due_date || invoice.due_date >= today) return 'current';

  const age = invoiceAge(invoice, today);
  if (age <= 7) return '1-7';
  if (age <= 30) return '8-30';
  if (age <= 60) return '31-60';
  if (age <= 90) return '61-90';
  return '90+';
}

function getOpenInvoices(state) {
  const today = todayString();
  return (state.invoices || [])
    .filter((invoice) => invoiceBalance(invoice) > 0 && (invoice.payment_status || '') !== 'paid')
    .map((invoice) => ({ ...invoice, ar_bucket: agingBucket(invoice, today), days_overdue: invoiceAge(invoice, today), balance: invoiceBalance(invoice) }))
    .sort((a, b) => {
      const bucketWeight = { '90+': 5, '61-90': 4, '31-60': 3, '8-30': 2, '1-7': 1, current: 0 };
      const diff = (bucketWeight[b.ar_bucket] || 0) - (bucketWeight[a.ar_bucket] || 0);
      if (diff) return diff;
      return Number(b.balance || 0) - Number(a.balance || 0);
    });
}

function summarizeAging(openInvoices) {
  const summary = {
    current: 0,
    '1-7': 0,
    '8-30': 0,
    '31-60': 0,
    '61-90': 0,
    '90+': 0
  };

  openInvoices.forEach((invoice) => {
    if (summary[invoice.ar_bucket] === undefined) summary[invoice.ar_bucket] = 0;
    summary[invoice.ar_bucket] += Number(invoice.balance || 0);
  });

  return summary;
}

function summarizeCustomers(openInvoices, customers) {
  const grouped = new Map();
  openInvoices.forEach((invoice) => {
    const key = invoice.customer_id || invoice.customer_name || 'unknown';
    if (!grouped.has(key)) {
      grouped.set(key, {
        customer_id: invoice.customer_id,
        name: customers[invoice.customer_id]?.name || invoice.customer_name || 'Unknown customer',
        invoices: [],
        total: 0,
        oldestDays: 0,
        overdueTotal: 0
      });
    }

    const group = grouped.get(key);
    group.invoices.push(invoice);
    group.total += Number(invoice.balance || 0);
    group.oldestDays = Math.max(group.oldestDays, invoice.days_overdue || 0);
    if (invoice.ar_bucket !== 'current') group.overdueTotal += Number(invoice.balance || 0);
  });

  return [...grouped.values()].sort((a, b) => {
    if (b.overdueTotal !== a.overdueTotal) return b.overdueTotal - a.overdueTotal;
    return b.total - a.total;
  });
}

function addArDashboardNav() {
  document.querySelectorAll('nav').forEach((nav) => {
    if (nav.querySelector(`[data-enhanced-nav="${AR_DASHBOARD_ID}"]`)) return;

    const button = document.createElement('button');
    button.className = 'nav-btn';
    button.dataset.enhancedNav = AR_DASHBOARD_ID;
    button.textContent = 'AR Dashboard';

    const paymentsButton = nav.querySelector('[data-nav="payments"]');
    if (paymentsButton) {
      paymentsButton.insertAdjacentElement('afterend', button);
    } else {
      nav.appendChild(button);
    }
  });
}

function renderArStat(label, value, helper = '') {
  return `
    <article class="route-stat ar-stat-card">
      <span>${label}</span>
      <strong>${value}</strong>
      ${helper ? `<p>${helper}</p>` : ''}
    </article>
  `;
}

function renderAgingBucket(label, amount, total) {
  const percent = total > 0 ? Math.round((amount / total) * 100) : 0;
  return `
    <article class="panel ar-aging-bucket">
      <div class="customer-card-header">
        <div>
          <span>${label}</span>
          <strong>${currency(amount)}</strong>
        </div>
        <span class="badge ${amount > 0 ? 'outstanding' : 'paid-up'}">${percent}%</span>
      </div>
      <div class="ar-aging-bar"><span style="width: ${Math.min(100, percent)}%"></span></div>
    </article>
  `;
}

function renderCustomerCollectionRow(customer) {
  const status = customer.oldestDays > 60 ? 'High priority' : customer.oldestDays > 30 ? 'Follow up' : customer.overdueTotal > 0 ? 'Watch' : 'Current';
  const badgeClass = customer.oldestDays > 60 ? 'overdue' : customer.overdueTotal > 0 ? 'outstanding' : 'paid-up';

  return `
    <article class="panel ar-customer-row">
      <div class="customer-card-header">
        <div>
          <h3>${customer.name}</h3>
          <p>${customer.invoices.length} open invoice${customer.invoices.length === 1 ? '' : 's'} · oldest ${customer.oldestDays} day${customer.oldestDays === 1 ? '' : 's'} overdue</p>
        </div>
        <span class="badge ${badgeClass}">${status}</span>
      </div>
      <div class="customer-overview">
        <div><span>Total AR</span><strong>${currency(customer.total)}</strong></div>
        <div><span>Overdue</span><strong>${currency(customer.overdueTotal)}</strong></div>
        <div><span>Oldest</span><strong>${customer.oldestDays} days</strong></div>
      </div>
      <div class="actions">
        <button type="button" data-ar-open-invoices>Open Invoices</button>
        <button type="button" data-ar-record-payment>Record Payment</button>
      </div>
    </article>
  `;
}

function renderInvoiceRiskRow(invoice, customers) {
  const customerName = customers[invoice.customer_id]?.name || invoice.customer_name || 'Unknown customer';
  const isOverdue = invoice.ar_bucket !== 'current';
  return `
    <tr>
      <td><strong>${invoice.invoice_number || 'Invoice'}</strong><br><span>${customerName}</span></td>
      <td>${invoice.due_date || 'n/a'}</td>
      <td>${isOverdue ? `${invoice.days_overdue} days` : 'Current'}</td>
      <td>${invoice.ar_bucket}</td>
      <td><strong>${currency(invoice.balance)}</strong></td>
    </tr>
  `;
}

function renderArDashboard() {
  const state = loadState();
  const main = document.querySelector('main.content');
  if (!state || !main) return;

  const customers = customerMap(state);
  const openInvoices = getOpenInvoices(state);
  const aging = summarizeAging(openInvoices);
  const customerSummaries = summarizeCustomers(openInvoices, customers);
  const totalAr = openInvoices.reduce((sum, invoice) => sum + Number(invoice.balance || 0), 0);
  const overdueAr = openInvoices.filter((invoice) => invoice.ar_bucket !== 'current').reduce((sum, invoice) => sum + Number(invoice.balance || 0), 0);
  const highPriority = customerSummaries.filter((customer) => customer.oldestDays > 60 || customer.overdueTotal > 0).length;
  const oldestInvoice = openInvoices.reduce((oldest, invoice) => Math.max(oldest, invoice.days_overdue || 0), 0);
  const recentPayments = [...(state.payments || [])]
    .sort((a, b) => String(b.payment_date || b.created_at || '').localeCompare(String(a.payment_date || a.created_at || '')))
    .slice(0, 5);

  main.innerHTML = `
    <section class="ar-dashboard-view">
      <div class="page-header-v1">
        <div>
          <h2>Accounts Receivable Dashboard</h2>
          <p>Track outstanding balances, aging buckets, overdue exposure, and collection priorities.</p>
        </div>
        <div class="actions">
          <button type="button" data-ar-open-invoices>Open Invoices</button>
          <button type="button" data-ar-record-payment>Record Payment</button>
        </div>
      </div>

      <div class="invoice-summary-grid ar-summary-grid">
        ${renderArStat('Total AR', currency(totalAr), `${openInvoices.length} open invoices`)}
        ${renderArStat('Overdue AR', currency(overdueAr), overdueAr > 0 ? 'Needs follow-up' : 'No overdue balance')}
        ${renderArStat('Collection priorities', highPriority, 'Customers needing attention')}
        ${renderArStat('Oldest invoice', `${oldestInvoice} days`, 'Past due age')}
      </div>

      <div class="ar-dashboard-layout">
        <section class="ar-main-column">
          <div class="route-section-header">
            <h3>AR Aging</h3>
            <span>${currency(totalAr)} outstanding</span>
          </div>
          <div class="ar-aging-grid">
            ${renderAgingBucket('Current', aging.current, totalAr)}
            ${renderAgingBucket('1–7 days', aging['1-7'], totalAr)}
            ${renderAgingBucket('8–30 days', aging['8-30'], totalAr)}
            ${renderAgingBucket('31–60 days', aging['31-60'], totalAr)}
            ${renderAgingBucket('61–90 days', aging['61-90'], totalAr)}
            ${renderAgingBucket('90+ days', aging['90+'], totalAr)}
          </div>

          <div class="route-section-header">
            <h3>Customer Collection Queue</h3>
            <span>${customerSummaries.length} customers with open balances</span>
          </div>
          <div class="stack ar-customer-stack">
            ${customerSummaries.length ? customerSummaries.map(renderCustomerCollectionRow).join('') : '<article class="panel"><p>No open receivables. Everything is paid up.</p></article>'}
          </div>
        </section>

        <aside class="ar-side-column">
          <section class="panel">
            <h3>Highest-Risk Invoices</h3>
            <table class="ar-risk-table">
              <thead><tr><th>Invoice</th><th>Due</th><th>Age</th><th>Bucket</th><th>Balance</th></tr></thead>
              <tbody>${openInvoices.slice(0, 8).map((invoice) => renderInvoiceRiskRow(invoice, customers)).join('') || '<tr><td colspan="5">No open invoices.</td></tr>'}</tbody>
            </table>
          </section>

          <section class="panel">
            <h3>Recent Payments</h3>
            <div class="stack">
              ${recentPayments.length ? recentPayments.map((payment) => `<article class="ar-payment-row"><strong>${currency(payment.amount)}</strong><span>${payment.payment_date || payment.created_at?.slice(0, 10) || 'No date'} · ${payment.method || 'Payment'}</span></article>`).join('') : '<p>No payments recorded yet.</p>'}
            </div>
          </section>
        </aside>
      </div>
    </section>
  `;

  bindArDashboardActions();
}

function setActiveArButton() {
  document.querySelectorAll('.nav-btn').forEach((button) => button.classList.remove('active'));
  document.querySelectorAll(`[data-enhanced-nav="${AR_DASHBOARD_ID}"]`).forEach((button) => button.classList.add('active'));
}

function bindArDashboardActions() {
  document.querySelectorAll('[data-ar-open-invoices]').forEach((button) => {
    button.addEventListener('click', () => document.querySelector('[data-nav="invoices"]')?.click());
  });

  document.querySelectorAll('[data-ar-record-payment]').forEach((button) => {
    button.addEventListener('click', () => document.querySelector('[data-nav="payments"]')?.click());
  });
}

document.addEventListener('click', (event) => {
  const arButton = event.target.closest(`[data-enhanced-nav="${AR_DASHBOARD_ID}"]`);
  if (!arButton) return;

  event.preventDefault();
  setActiveArButton();
  renderArDashboard();
});

const app = document.querySelector('#app');
if (app) {
  const observer = new MutationObserver(addArDashboardNav);
  observer.observe(app, { childList: true, subtree: true });
}

addArDashboardNav();
