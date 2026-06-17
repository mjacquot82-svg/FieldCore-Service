import { getAuthenticatedUser } from './supabaseAuth.js';
import { getCompanyMembershipForUser } from './repositories/companyMembershipRepository.js';
import { readState } from './storage/local-state-adapter.js';

const clone = (value) => JSON.parse(JSON.stringify(value));

let activeRepositoryContext = null;

function cloneOrNull(value) {
  return value ? clone(value) : null;
}

function getLocalCompany(state = readState()) {
  return state.company || null;
}

function buildCompanyContext(companyId, localCompany) {
  if (!companyId) return null;
  if (localCompany?.company_id === companyId) return clone(localCompany);

  return {
    ...(localCompany || {}),
    company_id: companyId
  };
}

export function getActiveRepositoryContext() {
  return cloneOrNull(activeRepositoryContext);
}

export async function resolveRepositoryCompanyContext() {
  const state = readState();
  const localCompany = getLocalCompany(state);
  const localCompanyId = localCompany?.company_id || null;
  const user = await getAuthenticatedUser();
  const membership = user?.id
    ? await getCompanyMembershipForUser(user.id, localCompanyId)
    : null;
  const companyId = membership?.company_id || localCompanyId;

  activeRepositoryContext = {
    authenticated: Boolean(user),
    user: cloneOrNull(user),
    membership: cloneOrNull(membership),
    company: buildCompanyContext(companyId, localCompany),
    companyId,
    source: membership?.company_id ? 'authenticated-membership' : 'local-state'
  };

  return getActiveRepositoryContext();
}

export async function resolveRepositoryCompanyId() {
  const context = await resolveRepositoryCompanyContext();
  return context?.companyId || null;
}

export async function resolveRepositoryCompany() {
  const context = await resolveRepositoryCompanyContext();
  return context?.company || null;
}
