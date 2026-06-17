import { emit } from '../appEventBus.js';
import { resolveRepositoryCompanyId } from '../repositoryContext.js';
import { supabaseSelect, supabaseUpsert } from '../supabaseClient.js';
import { readState, writeState } from '../storage/local-state-adapter.js';

const PROFILE_FIELDS = [
  'name',
  'phone',
  'email',
  'billing_address',
  'preferred_service_day',
  'default_service_location',
  'default_service_frequency',
  'customer_notes',
  'billing_notes',
  'status',
  'updated_at'
];

const BILLING_FIELDS = [
  'billing_address',
  'billing_notes',
  'updated_at'
];

const CUSTOMER_FIELDS = [
  'customer_id',
  'company_id',
  'name',
  'phone',
  'email',
  'billing_address',
  'notes',
  'customer_notes',
  'billing_notes',
  'preferred_service_day',
  'default_service_location',
  'default_service_frequency',
  'status',
  'created_at',
  'updated_at'
];

const CUSTOMER_SELECT_FIELDS = CUSTOMER_FIELDS.join(',');
const clone = (value) => JSON.parse(JSON.stringify(value));

function cloneOrNull(value) {
  return value ? clone(value) : null;
}

function makeCustomerId() {
  return `cust_${crypto.randomUUID().slice(0, 8)}`;
}

function localCustomers() {
  return readState().customers || [];
}

function writeLocalCustomers(customers, metadata = {}) {
  const state = readState();
  const nextState = {
    ...state,
    customers
  };

  writeState(nextState, metadata);
  return customers;
}

async function ensureSupabaseCompany(state, companyId = state.company?.company_id) {
  const company = state.company;
  if (!companyId) return false;

  const response = await supabaseUpsert(
    'companies',
    {
      company_id: companyId,
      name: company.name || 'FieldCore',
      status: company.status || 'active',
      created_at: company.created_at
    },
    { onConflict: 'company_id' }
  );

  return response.configured && !response.error;
}

function pickAllowedFields(patch, allowedFields) {
  return allowedFields.reduce((nextPatch, field) => {
    if (Object.prototype.hasOwnProperty.call(patch, field)) {
      nextPatch[field] = patch[field];
    }
    return nextPatch;
  }, {});
}

function normalizeCustomerForSupabase(customer) {
  return CUSTOMER_FIELDS.reduce((record, field) => {
    if (Object.prototype.hasOwnProperty.call(customer, field)) {
      record[field] = customer[field] ?? null;
    }
    return record;
  }, {
    customer_id: customer.customer_id,
    company_id: customer.company_id,
    name: customer.name || '',
    status: customer.status || 'active'
  });
}

async function readSupabaseCustomers(companyId) {
  if (!companyId) return null;

  const response = await supabaseSelect('customers', {
    select: CUSTOMER_SELECT_FIELDS,
    company_id: `eq.${companyId}`,
    order: 'name.asc'
  });

  if (!response.configured || response.error || !Array.isArray(response.data)) return null;
  return clone(response.data);
}

async function readSupabaseCustomer(customerId) {
  const companyId = await resolveRepositoryCompanyId();
  if (!companyId) return null;

  const response = await supabaseSelect('customers', {
    select: CUSTOMER_SELECT_FIELDS,
    company_id: `eq.${companyId}`,
    customer_id: `eq.${customerId}`,
    limit: '1'
  });

  if (!response.configured || response.error || !Array.isArray(response.data)) return null;
  return cloneOrNull(response.data[0]);
}

async function writeSupabaseCustomer(customer) {
  const state = readState();
  const record = normalizeCustomerForSupabase(customer);
  if (!record.customer_id || !record.company_id) return null;

  const companyReady = await ensureSupabaseCompany(state, record.company_id);
  if (!companyReady) return null;

  const response = await supabaseUpsert('customers', record, {
    onConflict: 'customer_id'
  });

  if (!response.configured || response.error || !Array.isArray(response.data)) return null;
  return cloneOrNull(response.data[0]);
}

async function writeSupabaseCustomers(customers) {
  const state = readState();
  const records = customers.map(normalizeCustomerForSupabase).filter((customer) => (
    customer.customer_id && customer.company_id
  ));
  if (!records.length) return null;

  const companyReady = await ensureSupabaseCompany(state);
  if (!companyReady) return null;

  const response = await supabaseUpsert('customers', records, {
    onConflict: 'customer_id'
  });

  if (!response.configured || response.error || !Array.isArray(response.data)) return null;
  return clone(response.data);
}

export async function syncCustomersFromSupabase() {
  const state = readState();
  const companyId = await resolveRepositoryCompanyId();
  const customers = await readSupabaseCustomers(companyId);
  if (!customers) return null;

  if (!customers.length && (state.customers || []).length) {
    const bootstrappedCustomers = await writeSupabaseCustomers(state.customers || []);
    if (!bootstrappedCustomers) return null;

    writeLocalCustomers(bootstrappedCustomers, {
      action: 'customers:bootstrap-supabase'
    });

    return clone(bootstrappedCustomers);
  }

  writeLocalCustomers(customers, {
    action: 'customers:sync-from-supabase'
  });

  return clone(customers);
}

export function listCustomers() {
  return clone(localCustomers());
}

export function getCustomer(customerId) {
  const customer = localCustomers().find((item) => item.customer_id === customerId);
  return cloneOrNull(customer);
}

export async function listCustomersAsync() {
  const customers = await readSupabaseCustomers(await resolveRepositoryCompanyId());
  return customers || listCustomers();
}

export async function getCustomerAsync(customerId) {
  const customer = await readSupabaseCustomer(customerId);
  return customer || getCustomer(customerId);
}

export async function createCustomer(customerInput = {}) {
  const state = readState();
  const companyId = await resolveRepositoryCompanyId();
  const customer = {
    customer_id: customerInput.customer_id || makeCustomerId(),
    company_id: customerInput.company_id || companyId,
    name: customerInput.name || '',
    phone: customerInput.phone || '',
    email: customerInput.email || '',
    billing_address: customerInput.billing_address || '',
    notes: customerInput.notes,
    customer_notes: customerInput.customer_notes,
    billing_notes: customerInput.billing_notes,
    preferred_service_day: customerInput.preferred_service_day,
    default_service_location: customerInput.default_service_location,
    default_service_frequency: customerInput.default_service_frequency,
    status: customerInput.status || 'active',
    created_at: customerInput.created_at || new Date().toISOString()
  };

  const customers = state.customers || [];
  if (customers.some((item) => item.customer_id === customer.customer_id)) return null;

  const persistedCustomer = (await writeSupabaseCustomer(customer)) || customer;
  writeLocalCustomers([...customers, persistedCustomer], {
    action: 'customer:create',
    customer_id: persistedCustomer.customer_id
  });

  emit('customers:changed', {
    action: 'create',
    customer_id: persistedCustomer.customer_id,
    customer: clone(persistedCustomer)
  });

  return clone(persistedCustomer);
}

export async function updateCustomer(customerId, patch = {}, metadata = {}) {
  const state = readState();
  let updatedCustomer = null;

  const customers = state.customers || [];
  const nextCustomers = customers.map((customer) => {
    if (customer.customer_id !== customerId) return customer;
    updatedCustomer = {
      ...customer,
      ...patch
    };
    return updatedCustomer;
  });

  if (!updatedCustomer) return null;
  const persistedCustomer = (await writeSupabaseCustomer(updatedCustomer)) || updatedCustomer;
  const persistedCustomers = nextCustomers.map((customer) => (
    customer.customer_id === customerId ? persistedCustomer : customer
  ));

  writeLocalCustomers(persistedCustomers, {
    ...metadata,
    action: metadata.action || 'customer:update',
    customer_id: customerId
  });

  emit('customers:changed', {
    action: metadata.eventAction || metadata.action || 'update',
    customer_id: customerId,
    customer: clone(persistedCustomer)
  });

  return clone(persistedCustomer);
}

export function deactivateCustomer(customerId, metadata = {}) {
  return updateCustomer(
    customerId,
    { status: 'inactive' },
    {
      ...metadata,
      action: metadata.action || 'customer:deactivate',
      eventAction: metadata.eventAction || 'deactivate'
    }
  );
}

export function updateCustomerProfile(customerId, patch = {}) {
  const profilePatch = pickAllowedFields(patch, PROFILE_FIELDS);
  return updateCustomer(customerId, profilePatch, { action: 'customer:update-profile' });
}

export function updateBillingInfo(customerId, patch = {}) {
  const billingPatch = pickAllowedFields(patch, BILLING_FIELDS);
  return updateCustomer(customerId, billingPatch, { action: 'customer:update-billing-info' });
}
