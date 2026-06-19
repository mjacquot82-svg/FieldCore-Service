import { isProductionMode } from './appMode.js';
import { syncEmployeesFromSupabase } from './repositories/employeeRepository.js';
import { syncCompanyMembershipsFromSupabase } from './repositories/companyMembershipRepository.js';
import { syncCustomersFromSupabase } from './repositories/customerRepository.js';
import { syncInvoicesFromSupabase } from './repositories/invoiceRepository.js';
import { syncPaymentsFromSupabase } from './repositories/paymentRepository.js';
import { syncPropertiesFromSupabase } from './repositories/propertyRepository.js';
import { syncRouteStopsFromSupabase } from './repositories/routeStopRepository.js';
import { syncRoutesFromSupabase } from './repositories/routeRepository.js';
import { syncSettingsFromSupabase } from './repositories/settingsRepository.js';
import { syncShiftsFromSupabase } from './repositories/shiftRepository.js';
import { syncVisitsFromSupabase } from './repositories/visitRepository.js';
import { resolveRepositoryCompanyContext } from './repositoryContext.js';
import { isSupabaseConfigured } from './supabaseClient.js';
import { logOperationalError, logOperationalEvent } from '../services/operationalLogger.js';

function requireProductionSync(value, label) {
  if (value !== null || !isProductionMode()) {
    logOperationalEvent({
      category: 'synchronization',
      severity: 'info',
      action: `sync:${label}`,
      message: `Supabase sync completed for ${label}.`,
      details: { label, synced: Boolean(value) }
    });
    return value;
  }
  const error = new Error(`Production Supabase sync failed for ${label}.`);
  logOperationalError(
    'synchronization',
    `sync:${label}`,
    error,
    { label },
    'Production data could not be synchronized.'
  );
  throw error;
}

export async function syncFoundationFromSupabase() {
  if (!isSupabaseConfigured()) {
    logOperationalEvent({
      category: 'startup',
      severity: isProductionMode() ? 'critical' : 'warning',
      action: 'sync-skipped-unconfigured',
      message: 'Supabase foundation sync skipped because Supabase is not configured.',
      userMessage: 'Supabase is not configured.'
    });
    return { configured: false, synced: false };
  }

  logOperationalEvent({
    category: 'startup',
    severity: 'info',
    action: 'sync-foundation-start',
    message: 'Starting Supabase foundation sync.'
  });
  const initialAuthContext = await resolveRepositoryCompanyContext();
  const companyMemberships = requireProductionSync(
    await syncCompanyMembershipsFromSupabase(),
    'company memberships'
  );
  const authContext = await resolveRepositoryCompanyContext();
  const [settings, employees] = await Promise.all([
    syncSettingsFromSupabase().then((value) => requireProductionSync(value, 'settings')),
    syncEmployeesFromSupabase().then((value) => requireProductionSync(value, 'employees'))
  ]);
  const customers = requireProductionSync(await syncCustomersFromSupabase(), 'customers');
  const properties = requireProductionSync(await syncPropertiesFromSupabase(), 'properties');
  const visits = requireProductionSync(await syncVisitsFromSupabase(), 'visits');
  const routes = requireProductionSync(await syncRoutesFromSupabase(), 'routes');
  const routeStops = requireProductionSync(await syncRouteStopsFromSupabase(), 'route stops');
  const invoices = requireProductionSync(await syncInvoicesFromSupabase(), 'invoices');
  const payments = requireProductionSync(await syncPaymentsFromSupabase(), 'payments');
  const shifts = requireProductionSync(await syncShiftsFromSupabase(), 'shifts');

  const summary = {
    configured: true,
    synced: Boolean(settings || employees || companyMemberships || customers || properties || visits || routes || routeStops || invoices || payments || shifts),
    settings: Boolean(settings),
    employees: Boolean(employees),
    companyMemberships: Boolean(companyMemberships),
    authContext: Boolean(authContext?.companyId || initialAuthContext?.companyId),
    customers: Boolean(customers),
    properties: Boolean(properties),
    visits: Boolean(visits),
    routes: Boolean(routes),
    routeStops: Boolean(routeStops),
    invoices: Boolean(invoices),
    payments: Boolean(payments),
    shifts: Boolean(shifts)
  };

  logOperationalEvent({
    category: 'startup',
    severity: 'info',
    action: 'sync-foundation-complete',
    message: 'Supabase foundation sync completed.',
    details: summary
  });

  return summary;
}
