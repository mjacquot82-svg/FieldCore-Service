#!/usr/bin/env node

import fs from 'node:fs/promises';

const VALID_STATUSES = new Set(['active', 'inactive']);
const CUSTOMER_COLUMNS = [
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

function parseArgs(argv) {
  const args = {
    dryRun: true,
    import: false,
    stateFile: process.env.FIELDCORE_STATE_FILE || '',
    supabaseUrl: process.env.SUPABASE_URL || '',
    serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY || ''
  };

  argv.forEach((arg) => {
    if (arg === '--dry-run') {
      args.dryRun = true;
      args.import = false;
      return;
    }

    if (arg === '--import') {
      args.import = true;
      args.dryRun = false;
      return;
    }

    if (arg.startsWith('--state-file=')) {
      args.stateFile = arg.slice('--state-file='.length);
    }
  });

  return args;
}

function normalizeUrl(value) {
  return String(value || '').replace(/\/+$/, '');
}

async function readState(stateFile) {
  if (!stateFile) {
    throw new Error('Missing state file. Set FIELDCORE_STATE_FILE or pass --state-file=path/to/state.json.');
  }

  const raw = await fs.readFile(stateFile, 'utf8');
  const state = JSON.parse(raw);

  if (!state || !Array.isArray(state.customers)) {
    throw new Error('State file must be the FieldCore local-state JSON object with a customers array.');
  }

  return state;
}

function normalizeCustomer(customer) {
  const record = {
    customer_id: customer.customer_id || '',
    company_id: customer.company_id || '',
    name: customer.name || '',
    phone: customer.phone ?? null,
    email: customer.email ?? null,
    billing_address: customer.billing_address ?? null,
    notes: customer.notes ?? null,
    customer_notes: customer.customer_notes ?? null,
    billing_notes: customer.billing_notes ?? null,
    preferred_service_day: customer.preferred_service_day ?? null,
    default_service_location: customer.default_service_location ?? null,
    default_service_frequency: customer.default_service_frequency ?? null,
    status: customer.status || 'active'
  };

  if (customer.created_at) record.created_at = customer.created_at;
  if (customer.updated_at) record.updated_at = customer.updated_at;

  return record;
}

function validateCustomers(customers) {
  const idCounts = new Map();
  customers.forEach((customer) => {
    const customerId = customer.customer_id || '';
    if (!customerId) return;
    idCounts.set(customerId, (idCounts.get(customerId) || 0) + 1);
  });

  const duplicateCustomerIds = [...idCounts.entries()]
    .filter(([, count]) => count > 1)
    .map(([customerId, count]) => ({ customer_id: customerId, count }));

  const invalidRecords = [];
  const validRecords = [];
  const statusValidationIssues = [];
  const missingCompanyIdRecords = [];
  const duplicateCustomerIdSet = new Set(duplicateCustomerIds.map((item) => item.customer_id));

  customers.forEach((customer, index) => {
    const record = normalizeCustomer(customer);
    const issues = [];

    if (!record.customer_id) issues.push('missing customer_id');
    if (!record.company_id) {
      issues.push('missing company_id');
      missingCompanyIdRecords.push({ index, customer_id: record.customer_id, name: record.name });
    }
    if (!record.name) issues.push('missing name');
    if (!VALID_STATUSES.has(record.status)) {
      issues.push(`invalid status "${record.status}"`);
      statusValidationIssues.push({
        index,
        customer_id: record.customer_id,
        name: record.name,
        status: record.status
      });
    }
    if (duplicateCustomerIdSet.has(record.customer_id)) {
      issues.push(`duplicate customer_id "${record.customer_id}"`);
    }

    if (issues.length) {
      invalidRecords.push({
        index,
        customer_id: record.customer_id || '(missing)',
        name: record.name || '(missing)',
        issues
      });
      return;
    }

    validRecords.push(record);
  });

  return {
    localCustomerCount: customers.length,
    validRecords,
    invalidRecords,
    missingCompanyIdRecords,
    statusValidationIssues,
    duplicateCustomerIds
  };
}

function requireSupabaseConfig(args) {
  const supabaseUrl = normalizeUrl(args.supabaseUrl);
  const serviceRoleKey = String(args.serviceRoleKey || '').trim();

  if (!supabaseUrl) throw new Error('Missing SUPABASE_URL.');
  if (!serviceRoleKey) throw new Error('Missing SUPABASE_SERVICE_ROLE_KEY.');

  return { supabaseUrl, serviceRoleKey };
}

async function supabaseRequest(config, path, options = {}) {
  const response = await fetch(`${config.supabaseUrl}/rest/v1/${path}`, {
    ...options,
    headers: {
      apikey: config.serviceRoleKey,
      Authorization: `Bearer ${config.serviceRoleKey}`,
      Accept: 'application/json',
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...(options.headers || {})
    }
  });

  if (!response.ok) {
    throw new Error(`Supabase request failed: ${response.status} ${await response.text()}`);
  }

  if (response.status === 204) return null;
  return response.json();
}

function chunks(values, size = 100) {
  const result = [];
  for (let index = 0; index < values.length; index += size) {
    result.push(values.slice(index, index + size));
  }
  return result;
}

async function fetchCustomersByIds(config, customerIds) {
  const rows = [];

  for (const batch of chunks(customerIds)) {
    if (!batch.length) continue;
    const params = new URLSearchParams({
      select: CUSTOMER_COLUMNS.join(','),
      customer_id: `in.(${batch.join(',')})`
    });
    const batchRows = await supabaseRequest(config, `customers?${params.toString()}`);
    rows.push(...batchRows);
  }

  return rows;
}

async function upsertCustomers(config, records) {
  if (!records.length) return [];

  return supabaseRequest(config, 'customers?on_conflict=customer_id', {
    method: 'POST',
    headers: {
      Prefer: 'resolution=merge-duplicates,return=representation'
    },
    body: JSON.stringify(records)
  });
}

function compareRecords(localRecords, supabaseRows) {
  const supabaseById = new Map(supabaseRows.map((row) => [row.customer_id, row]));
  const missingInSupabase = [];
  const fieldMismatches = [];

  localRecords.forEach((localRecord) => {
    const remoteRecord = supabaseById.get(localRecord.customer_id);
    if (!remoteRecord) {
      missingInSupabase.push(localRecord.customer_id);
      return;
    }

    CUSTOMER_COLUMNS.forEach((column) => {
      if (!(column in localRecord)) return;
      const localValue = localRecord[column] ?? null;
      const remoteValue = remoteRecord[column] ?? null;
      if (String(localValue) !== String(remoteValue)) {
        fieldMismatches.push({
          customer_id: localRecord.customer_id,
          field: column,
          local: localValue,
          supabase: remoteValue
        });
      }
    });
  });

  return {
    localCustomerCount: localRecords.length,
    supabaseCustomerCount: supabaseRows.length,
    missingInSupabase,
    extraInSupabase: supabaseRows
      .filter((row) => !localRecords.some((record) => record.customer_id === row.customer_id))
      .map((row) => row.customer_id),
    fieldMismatches
  };
}

function printList(title, records, formatter) {
  console.log(`${title}: ${records.length}`);
  records.forEach((record) => console.log(`  ${formatter(record)}`));
}

function printValidationReport(validation) {
  console.log('Migration Readiness Report');
  console.log('--------------------------');
  console.log(`Local customer count: ${validation.localCustomerCount}`);
  console.log(`Valid customer count: ${validation.validRecords.length}`);
  console.log(`Invalid customer count: ${validation.invalidRecords.length}`);
  console.log(`Missing company_id count: ${validation.missingCompanyIdRecords.length}`);
  console.log(`Status validation issues: ${validation.statusValidationIssues.length}`);
  console.log(`Duplicate customer_id issues: ${validation.duplicateCustomerIds.length}`);
  console.log(`Ready for import: ${validation.invalidRecords.length === 0 ? 'yes' : 'no'}`);
  console.log('');

  printList(
    'Invalid records',
    validation.invalidRecords,
    (record) => `${record.customer_id} ${record.name}: ${record.issues.join(', ')}`
  );
  printList(
    'Status validation issue records',
    validation.statusValidationIssues,
    (record) => `${record.customer_id || '(missing)'} ${record.name || '(missing)'}: ${record.status}`
  );
  printList(
    'Duplicate customer_id records',
    validation.duplicateCustomerIds,
    (record) => `${record.customer_id}: ${record.count} occurrences`
  );
  console.log('');
}

function printImportSummary(summary) {
  console.log('Import Summary');
  console.log('--------------');
  console.log(`Imported: ${summary.imported.length}`);
  summary.imported.forEach((record) => console.log(`  + ${record.customer_id} ${record.name}`));
  console.log(`Updated: ${summary.updated.length}`);
  summary.updated.forEach((record) => console.log(`  ~ ${record.customer_id} ${record.name}`));
  console.log(`Skipped: ${summary.skipped.length}`);
  summary.skipped.forEach((record) => console.log(`  - ${record.customer_id} ${record.name}: ${record.issues.join(', ')}`));
  console.log('');
}

function printComparisonReport(comparison) {
  console.log('Post-Import Comparison');
  console.log('----------------------');
  console.log(`Final local customer count: ${comparison.localCustomerCount}`);
  console.log(`Final Supabase customer count: ${comparison.supabaseCustomerCount}`);
  console.log(`Missing in Supabase: ${comparison.missingInSupabase.length}`);
  comparison.missingInSupabase.forEach((customerId) => console.log(`  - ${customerId}`));
  console.log(`Extra in Supabase for imported id set: ${comparison.extraInSupabase.length}`);
  comparison.extraInSupabase.forEach((customerId) => console.log(`  + ${customerId}`));
  console.log(`Field mismatches: ${comparison.fieldMismatches.length}`);
  comparison.fieldMismatches.forEach((mismatch) => {
    console.log(`  ! ${mismatch.customer_id}.${mismatch.field}: local=${mismatch.local} supabase=${mismatch.supabase}`);
  });
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const state = await readState(args.stateFile);
  const validation = validateCustomers(state.customers);

  printValidationReport(validation);

  if (validation.invalidRecords.length > 0) {
    console.log('Import skipped because validation failed.');
    return;
  }

  if (args.dryRun) {
    console.log('Dry run complete. No Supabase records were written.');
    return;
  }

  const config = requireSupabaseConfig(args);
  const validCustomerIds = validation.validRecords.map((record) => record.customer_id);
  const beforeRows = await fetchCustomersByIds(config, validCustomerIds);
  const existingIds = new Set(beforeRows.map((row) => row.customer_id));

  const imported = validation.validRecords.filter((record) => !existingIds.has(record.customer_id));
  const updated = validation.validRecords.filter((record) => existingIds.has(record.customer_id));

  await upsertCustomers(config, validation.validRecords);
  const afterRows = await fetchCustomersByIds(config, validCustomerIds);
  const comparison = compareRecords(validation.validRecords, afterRows);

  printImportSummary({
    imported,
    updated,
    skipped: validation.invalidRecords
  });
  printComparisonReport(comparison);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
