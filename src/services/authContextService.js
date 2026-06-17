import { getAuthenticatedUser } from '../data/supabaseAuth.js';
import {
  attachOwnerMembershipToUser
} from '../data/repositories/companyMembershipRepository.js';
import { resolveRepositoryCompanyContext } from '../data/repositoryContext.js';

export async function getCurrentAuthContext() {
  return resolveRepositoryCompanyContext();
}

export async function attachCurrentUserToOwnerMembership(metadata = {}) {
  const user = await getAuthenticatedUser();
  if (!user?.id) return null;

  return attachOwnerMembershipToUser(user.id, {
    ...metadata,
    action: metadata.action || 'auth-context:attach-owner-membership'
  });
}
