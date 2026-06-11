import { emit } from '../appEventBus.js';
import { supabaseSelect } from '../supabaseClient.js';
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

const CUSTOMER_SELECT_FIELDS = [
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
].join(',');

const clone = (value) => JSON.parse(JSON.stringify(value));

function cloneOrNull(value) {
  return value ? clone(value) : null;
}

function pickAllowedFields(patch, allowedFields) {
  return allowedFields.reduce((nextPatch, field) => {
    if (Object.prototype.hasOwnProperty.call(patch, field)) {
      nextPatch[field] = patch[field];
    }
    return nextPatch;
  }, {});
}

function updateCustomer(customerId, patch, metadata) {
  const state = readState();
  let updatedCustomer = null;

  const nextState = {
    ...state,
    customers: (state.customers || []).map((customer) => {
      if (customer.customer_id !== customerId) return customer;
      updatedCustomer = {
        ...customer,
        ...patch
      };
      return updatedCustomer;
    })
  };

  if (!updatedCustomer) return null;

  writeState(nextState, {
    ...metadata,
    customer_id: customerId
  });

  emit('customers:changed', {
    action: metadata.action,
    customer_id: customerId,
    customer: clone(updatedCustomer)
  });

  return clone(updatedCustomer);
}

function listLocalCustomers() {
  return clone(readState().customers || []);
}

function getLocalCustomer(customerId) {
  const customer = (readState().customers || []).find((item) => item.customer_id === customerId);
  return cloneOrNull(customer);
}

async function listSupabaseCustomers() {
  const response = await supabaseSelect('customers', {
    select: CUSTOMER_SELECT_FIELDS,
    order: 'name.asc'
  });

  if (!response.configured || response.error || !Array.isArray(response.data)) return null;
  return clone(response.data);
}

async function getSupabaseCustomer(customerId) {
  const response = await supabaseSelect('customers', {
    select: CUSTOMER_SELECT_FIELDS,
    customer_id: `eq.${customerId}`,
    limit: '1'
  });

  if (!response.configured || response.error || !Array.isArray(response.data)) return null;
  return cloneOrNull(response.data[0]);
}

export function listCustomers() {
  return listLocalCustomers();
}

export function getCustomer(customerId) {
  return getLocalCustomer(customerId);
}

export async function listCustomersAsync() {
  const customers = await listSupabaseCustomers();
  return customers || listLocalCustomers();
}

export async function getCustomerAsync(customerId) {
  const customer = await getSupabaseCustomer(customerId);
  return customer || getLocalCustomer(customerId);
}

export function updateCustomerProfile(customerId, patch = {}) {
  const profilePatch = pickAllowedFields(patch, PROFILE_FIELDS);
  return updateCustomer(customerId, profilePatch, { action: 'customer:update-profile' });
}

export function updateBillingInfo(customerId, patch = {}) {
  const billingPatch = pickAllowedFields(patch, BILLING_FIELDS);
  return updateCustomer(customerId, billingPatch, { action: 'customer:update-billing-info' });
}
