const STORAGE_KEY = 'servicebatch_invoice_mvp_v1';
const DAYS = ['Unassigned', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

function loadState() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY));
  } catch {
    return null;
  }
}

function saveState(state) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function normalizeDay(value) {
  const day = String(value || '').trim();
  return DAYS.includes(day) ? day : 'Unassigned';
}

function daySelectHtml(value = 'Unassigned') {
  const selectedDay = normalizeDay(value);
  return `
    <label class="preferred-service-day-field">Preferred Service Day
      <select name="preferred_service_day">
        ${DAYS.map((day) => `<option value="${day}" ${selectedDay === day ? 'selected' : ''}>${day}</option>`).join('')}
      </select>
    </label>
  `;
}

function enhanceCustomerCreateForm() {
  const form = document.querySelector('#customer-form');
  if (!form || form.dataset.serviceDayEnhanced === 'true') return;

  const billingField = form.querySelector('input[name="billing_address"]')?.closest('label');
  if (billingField) {
    billingField.insertAdjacentHTML('afterend', daySelectHtml());
  }

  form.dataset.serviceDayEnhanced = 'true';

  form.addEventListener('submit', () => {
    const selectedDay = normalizeDay(form.querySelector('[name="preferred_service_day"]')?.value);
    setTimeout(() => {
      const state = loadState();
      if (!state?.customers?.length) return;

      const newestCustomer = [...state.customers]
        .sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')))[0];
      if (!newestCustomer || newestCustomer.preferred_service_day) return;

      state.customers = state.customers.map((customer) =>
        customer.customer_id === newestCustomer.customer_id
          ? { ...customer, preferred_service_day: selectedDay }
          : customer
      );
      saveState(state);
      window.dispatchEvent(new Event('storage'));
    }, 0);
  }, true);
}

function enhanceCustomerCards() {
  const state = loadState();
  if (!state) return;

  const customerById = Object.fromEntries((state.customers || []).map((customer) => [customer.customer_id, customer]));

  document.querySelectorAll('[data-customer-edit]').forEach((button) => {
    const customerId = button.dataset.customerEdit;
    const customer = customerById[customerId];
    const card = button.closest('.customer-card');
    if (!customer || !card || card.dataset.serviceDayShown === 'true') return;

    const overview = card.querySelector('.customer-overview');
    if (!overview) return;

    const preferredDay = normalizeDay(customer.preferred_service_day || customer.preferred_day);
    overview.insertAdjacentHTML('beforeend', `<div><span>Preferred Day</span><strong>${preferredDay}</strong></div>`);
    card.dataset.serviceDayShown = 'true';
  });
}

function bindFullCustomerEdit() {
  document.querySelectorAll('[data-customer-edit]').forEach((button) => {
    if (button.dataset.fullEditBound === 'true') return;
    button.dataset.fullEditBound = 'true';

    button.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopImmediatePropagation();
      event.stopPropagation();

      const state = loadState();
      if (!state) return;

      const customerId = button.dataset.customerEdit;
      const customer = (state.customers || []).find((item) => item.customer_id === customerId);
      if (!customer) return;

      const name = window.prompt('Customer name:', customer.name || '');
      if (name === null || !name.trim()) return;

      const phone = window.prompt('Phone:', customer.phone || '');
      if (phone === null) return;

      const email = window.prompt('Email:', customer.email || '');
      if (email === null) return;

      const billingAddress = window.prompt('Billing address:', customer.billing_address || '');
      if (billingAddress === null) return;

      const preferredDay = window.prompt('Preferred service day (Unassigned, Monday, Tuesday, Wednesday, Thursday, Friday, Saturday, Sunday):', normalizeDay(customer.preferred_service_day || customer.preferred_day));
      if (preferredDay === null) return;

      const status = window.prompt('Status (active or inactive):', customer.status || 'active');
      if (status === null || !status.trim()) return;

      state.customers = state.customers.map((item) =>
        item.customer_id === customerId
          ? {
              ...item,
              name: name.trim(),
              phone,
              email,
              billing_address: billingAddress,
              preferred_service_day: normalizeDay(preferredDay),
              status: status.trim()
            }
          : item
      );

      saveState(state);
      window.dispatchEvent(new Event('storage'));
      document.querySelector('[data-nav="customers"]')?.click();
    }, true);
  });
}

let scheduled = false;
function scheduleEnhancements() {
  if (scheduled) return;
  scheduled = true;
  window.requestAnimationFrame(() => {
    scheduled = false;
    enhanceCustomerCreateForm();
    enhanceCustomerCards();
    bindFullCustomerEdit();
  });
}

const app = document.querySelector('#app');
if (app) {
  const observer = new MutationObserver(scheduleEnhancements);
  observer.observe(app, { childList: true, subtree: true });
}

scheduleEnhancements();
