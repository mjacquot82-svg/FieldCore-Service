import { getAuthenticatedUser } from '../data/supabaseAuth.js';
import {
  attachOwnerMembershipToUser
} from '../data/repositories/companyMembershipRepository.js';
import {
  resolveRepositoryCompanyContext,
  validateRepositoryAuthContext
} from '../data/repositoryContext.js';

export async function getCurrentAuthContext() {
  return resolveRepositoryCompanyContext();
}

export async function getAuthMembershipDiagnostics() {
  return validateRepositoryAuthContext();
}

export async function getRlsFoundationPreflight() {
  const diagnostics = await validateRepositoryAuthContext();
  const role = diagnostics.role;
  const isOwner = role === 'owner';
  const isAdmin = role === 'admin';
  const isManager = role === 'manager';
  const checks = {
    authenticatedUser: diagnostics.authenticated,
    authenticatedTransport: diagnostics.transportAuthenticated,
    activeMembership: diagnostics.membershipActive,
    membershipLinkedToUser: diagnostics.membershipUserLinked,
    companyResolved: diagnostics.companyResolved,
    roleResolved: Boolean(diagnostics.role)
  };
  const operationalAccess = {
    settings: {
      canRead: isOwner || isAdmin || isManager,
      canWrite: isOwner || isAdmin
    },
    employees: {
      canRead: isOwner || isAdmin || isManager,
      canWrite: isOwner || isAdmin
    },
    servicePlans: {
      canRead: isOwner || isAdmin || isManager,
      canWrite: isOwner || isAdmin || isManager
    }
  };

  return {
    ready: Object.values(checks).every(Boolean),
    checks,
    operationalAccess,
    diagnostics
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
