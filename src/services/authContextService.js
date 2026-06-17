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
  const isEmployee = role === 'employee';
  const hasOperationalRole = isOwner || isAdmin || isManager;
  const hasElevatedRole = isOwner || isAdmin;
  const hasEmployeeAssignmentContext = isEmployee && Boolean(diagnostics.employeeId);
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
    },
    customers: {
      canRead: hasOperationalRole,
      canCreate: hasOperationalRole,
      canUpdate: hasOperationalRole,
      canDeactivate: hasElevatedRole,
      canDelete: hasElevatedRole,
      reason: getBusinessDataAccessReason(diagnostics, {
        canRead: hasOperationalRole,
        canWrite: hasOperationalRole,
        canDeactivate: hasElevatedRole
      })
    },
    properties: {
      canRead: hasOperationalRole,
      canCreate: hasOperationalRole,
      canUpdate: hasOperationalRole,
      canDeactivate: hasElevatedRole,
      canDelete: hasElevatedRole,
      reason: getBusinessDataAccessReason(diagnostics, {
        canRead: hasOperationalRole,
        canWrite: hasOperationalRole,
        canDeactivate: hasElevatedRole
      })
    },
    routes: {
      canReadCompanyWide: hasOperationalRole,
      canCreate: hasOperationalRole,
      canUpdate: hasOperationalRole,
      canDelete: hasOperationalRole,
      canReadAssigned: isEmployee,
      canModifyAssigned: false,
      assignmentVisibility: getAssignmentVisibility(diagnostics),
      reason: getWorkflowAccessReason(diagnostics, {
        canReadCompanyWide: hasOperationalRole,
        canReadAssigned: isEmployee,
        canUpdateAssigned: false,
        hasEmployeeAssignmentContext
      })
    },
    visits: {
      canReadCompanyWide: hasOperationalRole,
      canCreate: hasOperationalRole,
      canUpdateCompanyWide: hasOperationalRole,
      canDelete: hasOperationalRole,
      canReadAssigned: isEmployee,
      canUpdateAssignedLifecycle: isEmployee,
      canModifyAssignedStructure: false,
      assignmentVisibility: getAssignmentVisibility(diagnostics),
      reason: getWorkflowAccessReason(diagnostics, {
        canReadCompanyWide: hasOperationalRole,
        canReadAssigned: isEmployee,
        canUpdateAssigned: isEmployee,
        hasEmployeeAssignmentContext
      })
    }
  };

  return {
    ready: Object.values(checks).every(Boolean),
    checks,
    customerAccess: operationalAccess.customers,
    propertyAccess: operationalAccess.properties,
    routeAccess: operationalAccess.routes,
    visitAccess: operationalAccess.visits,
    operationalAccess,
    diagnostics
  };
}

function getBusinessDataAccessReason(diagnostics, access) {
  if (!diagnostics.authenticated) return 'No authenticated Supabase user.';
  if (!diagnostics.transportAuthenticated) return 'Supabase transport is using the anon key.';
  if (!diagnostics.companyResolved) return 'No company could be resolved from membership or local state.';
  if (!diagnostics.membershipActive) return 'No active company membership was found.';
  if (!diagnostics.membershipUserLinked) return 'Active membership is not linked to the authenticated user.';
  if (!diagnostics.role) return 'Membership role is missing.';
  if (!access.canRead) return `Role "${diagnostics.role}" is not permitted for customer/property access in this phase.`;
  if (!access.canDeactivate) return `Role "${diagnostics.role}" can read and write active records but cannot deactivate or delete them.`;
  return `Role "${diagnostics.role}" has full customer/property access for this phase.`;
}

function getAssignmentVisibility(diagnostics) {
  return {
    employeeId: diagnostics.employeeId || null,
    supportsEmployeeIdAssignment: Boolean(diagnostics.employeeId),
    supportsAssignedWorkerText: Boolean(diagnostics.employeeId),
    note: diagnostics.employeeId
      ? 'Assigned access can use route.employee_id and the linked employee name text fields.'
      : 'Employee-scoped access requires a membership linked to an employee record.'
  };
}

function getWorkflowAccessReason(diagnostics, access) {
  if (!diagnostics.authenticated) return 'No authenticated Supabase user.';
  if (!diagnostics.transportAuthenticated) return 'Supabase transport is using the anon key.';
  if (!diagnostics.companyResolved) return 'No company could be resolved from membership or local state.';
  if (!diagnostics.membershipActive) return 'No active company membership was found.';
  if (!diagnostics.membershipUserLinked) return 'Active membership is not linked to the authenticated user.';
  if (!diagnostics.role) return 'Membership role is missing.';
  if (access.canReadCompanyWide) return `Role "${diagnostics.role}" has full company visit/route access.`;
  if (access.canReadAssigned && !access.hasEmployeeAssignmentContext) {
    return `Role "${diagnostics.role}" can use assigned visit/route access after the membership is linked to an employee.`;
  }
  if (access.canReadAssigned && access.canUpdateAssigned) {
    return `Role "${diagnostics.role}" can read assigned routes, read assigned visits, and update assigned visit lifecycle fields.`;
  }
  if (access.canReadAssigned) return `Role "${diagnostics.role}" can read assigned routes and visits only.`;
  return `Role "${diagnostics.role}" is not permitted for visit/route access in this phase.`;
}

export async function attachCurrentUserToOwnerMembership(metadata = {}) {
  const user = await getAuthenticatedUser();
  if (!user?.id) return null;

  return attachOwnerMembershipToUser(user.id, {
    ...metadata,
    action: metadata.action || 'auth-context:attach-owner-membership'
  });
}
