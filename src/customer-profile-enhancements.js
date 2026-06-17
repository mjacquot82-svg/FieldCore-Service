import { on } from './data/appEventBus.js';
import {
  getCustomer,
  listCustomers,
  updateCustomerProfile
} from './data/repositories/customerRepository.js';
import { listProperties } from './data/repositories/propertyRepository.js';

const DAYS = ['No preference', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const CUSTOMER_EDITOR_ID = 'customer-profile-editor';

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function normalizeDay(value) {
  const day = String(value || '').trim();
  if (day === 'Unassigned') return 'No preference';
  return DAYS.includes(day) ? day : 'No preference';
}

function formatPreferredDay(value) {
  return normalizeDay(value || 'No preference');
}

function daySelectHtml(value = 'No preference') {
  const selectedDay = normalizeDay(value);
  return `
    <label class="preferred-service-day-field">Preferred Service Day
      <select name="preferred_service_day">
        ${DAYS.map((day) => `<option value="${day}" ${selectedDay === day ? 'selected' : ''}>${day}</option>`).join('')}
      </select>
    </label>
  `;
}

function textFieldHtml(label, name, value = '', placeholder = '') {
  return `<label>${label}<input name="${name}" value="${escapeHtml(value)}" placeholder="${escapeHtml(placeholder)}" /></label>`;
}

function textareaFieldHtml(label, name, value = '', placeholder = '') {
  return `<label>${label}<textarea name="${name}" rows="3" placeholder="${escapeHtml(placeholder)}">${escapeHtml(value)}</textarea></label>`;
}

function statusSelectHtml(value = 'active') {
  const selected = String(value || 'active').toLowerCase() === 'inactive' ? 'inactive' : 'active';
  return `<label>Status<select name="status"><option value="active" ${selected === 'active' ? 'selected' : ''}>Active</option><option value="inactive" ${selected === 'inactive' ? 'selected' : ''}>Inactive</option></select></label>`;
}

function serviceFrequencySelectHtml(value = '') {
  const selected = String(value || '').trim();
  const options = [
    ['', 'No default'],
    ['weekly', 'Weekly'],
    ['biweekly', 'Biweekly'],
    ['monthly', 'Monthly'],
    ['one-time', 'One-time / odd job']
  ];
  return `<label>Default Service Frequency<select name="default_service_frequency">${options.map(([optionValue, label]) => `<option value="${optionValue}" ${selected === optionValue ? 'selected' : ''}>${label}</option>`).join('')}</select></label>`;
}

function getCustomerDefaultServiceLocation(customer, properties) {
  return customer.default_service_location || properties[0]?.service_address || '';
}

function getCustomerDefaultServiceFrequency(customer, properties) {
  return customer.default_service_frequency || properties.find((property) => property.recurring_frequency)?.recurring_frequency || '';
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
    setTimeout(async () => {
      const customers = listCustomers();
      if (!customers.length) return;

      const newestCustomer = [...customers]
        .sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')))[0];
      if (!newestCustomer || newestCustomer.preferred_service_day) return;

      await updateCustomerProfile(newestCustomer.customer_id, { preferred_service_day: selectedDay });
    }, 0);
  }, true);
}

function enhanceCustomerCards() {
  const customerById = Object.fromEntries(listCustomers().map((customer) => [customer.customer_id, customer]));

  document.querySelectorAll('[data-customer-edit]').forEach((button) => {
    const customerId = button.dataset.customerEdit;
    const customer = customerById[customerId];
    const card = button.closest('.customer-card');
    if (!customer || !card || card.dataset.serviceDayShown === 'true') return;

    const overview = card.querySelector('.customer-overview');
    if (!overview) return;

    const preferredDay = formatPreferredDay(customer.preferred_service_day || customer.preferred_day);
    overview.insertAdjacentHTML('beforeend', `<div><span>Preferred Day</span><strong>${escapeHtml(preferredDay)}</strong></div>`);

    const addressLine = card.querySelector('.customer-card-header')?.nextElementSibling;
    if (addressLine && !card.querySelector('[data-customer-profile-notes]')) {
      const notes = [
        customer.customer_notes ? `Customer notes: ${customer.customer_notes}` : '',
        customer.billing_notes ? `Billing notes: ${customer.billing_notes}` : ''
      ].filter(Boolean).join(' · ');
      if (notes) addressLine.insertAdjacentHTML('afterend', `<p data-customer-profile-notes>${escapeHtml(notes)}</p>`);
    }

    card.dataset.serviceDayShown = 'true';
  });
}

function enhanceCustomerTimelineProfile() {
  const heading = document.querySelector('section h2');
  if (!heading || !heading.textContent.includes('Customer Activity')) return;

  const customerName = heading.textContent.replace(' Customer Activity', '').trim();
  const customer = listCustomers().find((item) => item.name === customerName);
  if (!customer || document.querySelector('[data-customer-profile-summary]')) return;

  const properties = listProperties().filter((property) => property.customer_id === customer.customer_id);
  const preferredDay = formatPreferredDay(customer.preferred_service_day || customer.preferred_day);
  const defaultLocation = getCustomerDefaultServiceLocation(customer, properties) || 'Not set';
  const defaultFrequency = getCustomerDefaultServiceFrequency(customer, properties) || 'Not set';

  heading.insertAdjacentHTML('afterend', `
    <article class="panel" data-customer-profile-summary>
      <h3>Customer Profile</h3>
      <div class="customer-overview">
        <div><span>Preferred Day</span><strong>${escapeHtml(preferredDay)}</strong></div>
        <div><span>Default Location</span><strong>${escapeHtml(defaultLocation)}</strong></div>
        <div><span>Default Frequency</span><strong>${escapeHtml(defaultFrequency)}</strong></div>
      </div>
      ${customer.customer_notes ? `<p><strong>Customer notes:</strong> ${escapeHtml(customer.customer_notes)}</p>` : ''}
      ${customer.billing_notes ? `<p><strong>Billing notes:</strong> ${escapeHtml(customer.billing_notes)}</p>` : ''}
    </article>
  `);
}

function closeCustomerEditor() {
  document.querySelector(`#${CUSTOMER_EDITOR_ID}`)?.remove();
}

function openFullCustomerEditor(customerId) {
  const customer = getCustomer(customerId);
  if (!customer) return;

  const properties = listProperties().filter((property) => property.customer_id === customerId);
  const card = document.querySelector(`[data-customer-edit="${CSS.escape(customerId)}"]`)?.closest('.customer-card');
  closeCustomerEditor();

  const editorHtml = `
    <form id="${CUSTOMER_EDITOR_ID}" class="panel service-form customer-profile-editor" data-editing-customer-id="${escapeHtml(customerId)}">
      <div class="customer-card-header">
        <div>
          <h3>Edit Customer Profile</h3>
          <p>Update the full profile without losing existing customer history.</p>
        </div>
        <button type="button" data-customer-edit-cancel>Cancel</button>
      </div>
      ${textFieldHtml('Name', 'name', customer.name, 'Customer or business name')}
      ${textFieldHtml('Phone', 'phone', customer.phone, '555-123-4567')}
      ${textFieldHtml('Email', 'email', customer.email, 'customer@example.com')}
      ${textFieldHtml('Billing Address', 'billing_address', customer.billing_address, 'Billing address')}
      ${daySelectHtml(customer.preferred_service_day || customer.preferred_day)}
      ${textFieldHtml('Default Service Location', 'default_service_location', getCustomerDefaultServiceLocation(customer, properties), 'Primary service address or area')}
      ${serviceFrequencySelectHtml(getCustomerDefaultServiceFrequency(customer, properties))}
      ${textareaFieldHtml('Customer Notes', 'customer_notes', customer.customer_notes || customer.notes || '', 'Gate code, access, preferences, contact notes')}
      ${textareaFieldHtml('Billing Notes', 'billing_notes', customer.billing_notes || '', 'Billing contact, payment preference, invoice notes')}
      ${statusSelectHtml(customer.status)}
      <div class="actions">
        <button class="primary" type="submit">Save Customer Profile</button>
        <button type="button" data-customer-edit-cancel>Cancel</button>
      </div>
    </form>
  `;

  if (card) {
    card.insertAdjacentHTML('afterend', editorHtml);
  } else {
    document.querySelector('main.content section')?.insertAdjacentHTML('afterbegin', editorHtml);
  }

  document.querySelector(`#${CUSTOMER_EDITOR_ID}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function bindCustomerEditorForm() {
  const editor = document.querySelector(`#${CUSTOMER_EDITOR_ID}`);
  if (!editor || editor.dataset.bound === 'true') return;
  editor.dataset.bound = 'true';

  editor.querySelectorAll('[data-customer-edit-cancel]').forEach((button) => {
    button.addEventListener('click', closeCustomerEditor);
  });

  editor.addEventListener('submit', async (event) => {
    event.preventDefault();

    const formData = new FormData(editor);
    const customerId = editor.dataset.editingCustomerId;
    const name = String(formData.get('name') || '').trim();
    if (!name) return;

    await updateCustomerProfile(customerId, {
      name,
      phone: String(formData.get('phone') || '').trim(),
      email: String(formData.get('email') || '').trim(),
      billing_address: String(formData.get('billing_address') || '').trim(),
      preferred_service_day: normalizeDay(formData.get('preferred_service_day')),
      default_service_location: String(formData.get('default_service_location') || '').trim(),
      default_service_frequency: String(formData.get('default_service_frequency') || '').trim(),
      customer_notes: String(formData.get('customer_notes') || '').trim(),
      billing_notes: String(formData.get('billing_notes') || '').trim(),
      status: String(formData.get('status') || 'active').trim() || 'active',
      updated_at: new Date().toISOString()
    });

    closeCustomerEditor();
    document.querySelector('[data-nav="customers"]')?.click();
  });
}

function bindFullCustomerEdit() {
  document.querySelectorAll('[data-customer-edit]').forEach((button) => {
    if (button.dataset.fullEditBound === 'true') return;

    const cleanButton = button.cloneNode(true);
    cleanButton.dataset.fullEditBound = 'true';
    cleanButton.textContent = 'Edit Customer';
    button.replaceWith(cleanButton);

    cleanButton.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      openFullCustomerEditor(cleanButton.dataset.customerEdit);
    });
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
    enhanceCustomerTimelineProfile();
    bindFullCustomerEdit();
    bindCustomerEditorForm();
  });
}

const app = document.querySelector('#app');
if (app) {
  const observer = new MutationObserver(scheduleEnhancements);
  observer.observe(app, { childList: true, subtree: true });
}

on('customers:changed', scheduleEnhancements);
scheduleEnhancements();
