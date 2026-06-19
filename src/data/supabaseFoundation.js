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

function requireProductionSync(value, label) {
  if (value !== null || !isProductionMode()) return value;
  throw new Error(`Production Supabase sync failed for ${label}.`);
}

export async function syncFoundationFromSupabase() {
  if (!isSupabaseConfigured()) return { configured: false, synced: false };

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

  return {
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
}
