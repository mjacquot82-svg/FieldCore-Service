import { getAuthenticatedUser } from '../data/supabaseAuth.js';
import {
  attachOwnerMembershipToUser,
  getCompanyMembershipForUser
} from '../data/repositories/companyMembershipRepository.js';
import { readState } from '../data/storage/local-state-adapter.js';

const clone = (value) => JSON.parse(JSON.stringify(value));

export async function getCurrentAuthContext() {
  const state = readState();
  const user = await getAuthenticatedUser();
  const membership = user?.id
    ? await getCompanyMembershipForUser(user.id, state.company?.company_id)
    : null;

  return {
    authenticated: Boolean(user),
    user: user ? clone(user) : null,
    membership: membership ? clone(membership) : null,
    company: state.company ? clone(state.company) : null
  };
}

export async function attachCurrentUserToOwnerMembership(metadata = {}) {
  const user = await getAuthenticatedUser();
  if (!user?.id) return null;

  return attachOwnerMembershipToUser(user.id, {
    ...metadata,
    action: metadata.action || 'auth-context:attach-owner-membership'
  });
}
