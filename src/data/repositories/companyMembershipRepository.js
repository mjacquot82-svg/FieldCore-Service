import { emit } from '../appEventBus.js';
import { supabaseSelect, supabaseUpsert } from '../supabaseClient.js';
import { readState, writeState } from '../storage/local-state-adapter.js';

const MEMBERSHIP_FIELDS = [
  'membership_id',
  'company_id',
  'user_id',
  'employee_id',
  'role',
  'status',
  'created_at',
  'updated_at'
];

const MEMBERSHIP_SELECT_FIELDS = MEMBERSHIP_FIELDS.join(',');
const clone = (value) => JSON.parse(JSON.stringify(value));

function localMemberships() {
  return readState().company_memberships || [];
}

function writeLocalMemberships(companyMemberships, metadata = {}) {
  const state = readState();
  const nextState = {
    ...state,
    company_memberships: companyMemberships
  };

  writeState(nextState, metadata);
  return companyMemberships;
}

function makeDefaultOwnerMembership(company) {
  if (!company?.company_id) return null;
  return {
    membership_id: `mbr_${company.company_id}_owner`,
    company_id: company.company_id,
    user_id: null,
    employee_id: null,
    role: 'owner',
    status: 'active',
    created_at: company.created_at || new Date().toISOString()
  };
}

function normalizeMembershipForSupabase(membership) {
  return MEMBERSHIP_FIELDS.reduce((record, field) => {
    if (Object.prototype.hasOwnProperty.call(membership, field)) {
      record[field] = membership[field] ?? null;
    }
    return record;
  }, {
    membership_id: membership.membership_id,
    company_id: membership.company_id,
    user_id: membership.user_id || null,
    employee_id: membership.employee_id || null,
    role: membership.role || 'employee',
    status: membership.status || 'active'
  });
}

async function ensureSupabaseCompany(state) {
  const company = state.company;
  if (!company?.company_id) return false;

  const response = await supabaseUpsert(
    'companies',
    {
      company_id: company.company_id,
      name: company.name || 'FieldCore',
      status: company.status || 'active',
      created_at: company.created_at
    },
    { onConflict: 'company_id' }
  );

  return response.configured && !response.error;
}

async function readSupabaseMemberships(companyId) {
  if (!companyId) return null;

  const response = await supabaseSelect('company_memberships', {
    select: MEMBERSHIP_SELECT_FIELDS,
    company_id: `eq.${companyId}`,
    order: 'created_at.asc'
  });

  if (!response.configured || response.error || !Array.isArray(response.data)) return null;
  return clone(response.data);
}

async function readSupabaseMembershipForUser(companyId, userId) {
  if (!companyId || !userId) return null;

  const response = await supabaseSelect('company_memberships', {
    select: MEMBERSHIP_SELECT_FIELDS,
    company_id: `eq.${companyId}`,
    user_id: `eq.${userId}`,
    status: 'eq.active',
    limit: '1'
  });

  if (!response.configured || response.error || !Array.isArray(response.data)) return null;
  return response.data[0] ? clone(response.data[0]) : null;
}

async function writeSupabaseMembership(membership) {
  const state = readState();
  const record = normalizeMembershipForSupabase(membership);
  if (!record.membership_id || !record.company_id) return null;

  const companyReady = await ensureSupabaseCompany(state);
  if (!companyReady) return null;

  const response = await supabaseUpsert('company_memberships', record, {
    onConflict: 'membership_id'
  });

  if (!response.configured || response.error || !Array.isArray(response.data)) return null;
  return clone(response.data[0]);
}

async function writeSupabaseMemberships(memberships) {
  const state = readState();
  const records = memberships.map(normalizeMembershipForSupabase).filter((membership) => (
    membership.membership_id && membership.company_id
  ));
  if (!records.length) return null;

  const companyReady = await ensureSupabaseCompany(state);
  if (!companyReady) return null;

  const response = await supabaseUpsert('company_memberships', records, {
    onConflict: 'membership_id'
  });

  if (!response.configured || response.error || !Array.isArray(response.data)) return null;
  return clone(response.data);
}

export async function syncCompanyMembershipsFromSupabase() {
  const state = readState();
  const memberships = await readSupabaseMemberships(state.company?.company_id);
  if (!memberships) return null;

  if (!memberships.length) {
    const local = localMemberships();
    const bootstrapMemberships = local.length
      ? local
      : [makeDefaultOwnerMembership(state.company)].filter(Boolean);
    const bootstrappedMemberships = await writeSupabaseMemberships(bootstrapMemberships);
    if (!bootstrappedMemberships) return null;

    writeLocalMemberships(bootstrappedMemberships, {
      action: 'company-memberships:bootstrap-supabase'
    });

    return clone(bootstrappedMemberships);
  }

  writeLocalMemberships(memberships, {
    action: 'company-memberships:sync-from-supabase'
  });

  return clone(memberships);
}

export function listCompanyMemberships() {
  return clone(localMemberships());
}

export async function getCompanyMembershipForUser(userId, companyId = readState().company?.company_id) {
  const remoteMembership = await readSupabaseMembershipForUser(companyId, userId);
  if (remoteMembership) return remoteMembership;

  const localMembership = localMemberships().find((membership) =>
    membership.company_id === companyId &&
    membership.user_id === userId &&
    membership.status === 'active'
  );

  return localMembership ? clone(localMembership) : null;
}

export async function ensureDefaultOwnerMembership(metadata = {}) {
  const state = readState();
  const existingOwner = localMemberships().find((membership) =>
    membership.company_id === state.company?.company_id &&
    membership.role === 'owner' &&
    membership.status === 'active'
  );
  if (existingOwner) return clone(existingOwner);

  const membership = makeDefaultOwnerMembership(state.company);
  if (!membership) return null;

  const persistedMembership = (await writeSupabaseMembership(membership)) || membership;
  writeLocalMemberships([...localMemberships(), persistedMembership], {
    ...metadata,
    action: metadata.action || 'company-membership:ensure-default-owner',
    membership_id: persistedMembership.membership_id
  });

  emit('company-memberships:changed', {
    action: 'ensure-default-owner',
    membership_id: persistedMembership.membership_id,
    membership: clone(persistedMembership),
    metadata: clone(metadata)
  });

  return clone(persistedMembership);
}

export async function attachOwnerMembershipToUser(userId, metadata = {}) {
  if (!userId) return null;

  const state = readState();
  const companyId = state.company?.company_id;
  if (!companyId) return null;

  const existingUserMembership = await getCompanyMembershipForUser(userId, companyId);
  if (existingUserMembership) return existingUserMembership;

  const ownerMembership = localMemberships().find((membership) =>
    membership.company_id === companyId &&
    membership.role === 'owner' &&
    membership.status === 'active' &&
    !membership.user_id
  ) || await ensureDefaultOwnerMembership({
    ...metadata,
    action: 'company-membership:ensure-owner-for-auth-link'
  });

  if (!ownerMembership) return null;

  const linkedMembership = {
    ...ownerMembership,
    user_id: userId
  };
  const persistedMembership = (await writeSupabaseMembership(linkedMembership)) || linkedMembership;
  const memberships = localMemberships();
  const nextMemberships = memberships.some((membership) => membership.membership_id === persistedMembership.membership_id)
    ? memberships.map((membership) => (
        membership.membership_id === persistedMembership.membership_id ? persistedMembership : membership
      ))
    : [...memberships, persistedMembership];

  writeLocalMemberships(nextMemberships, {
    ...metadata,
    action: metadata.action || 'company-membership:attach-owner-user',
    membership_id: persistedMembership.membership_id,
    user_id: userId
  });

  emit('company-memberships:changed', {
    action: 'attach-owner-user',
    membership_id: persistedMembership.membership_id,
    membership: clone(persistedMembership),
    metadata: clone(metadata)
  });

  return clone(persistedMembership);
}
