import { syncEmployeesFromSupabase } from './repositories/employeeRepository.js';
import { syncCompanyMembershipsFromSupabase } from './repositories/companyMembershipRepository.js';
import { syncCustomersFromSupabase } from './repositories/customerRepository.js';
import { syncInvoicesFromSupabase } from './repositories/invoiceRepository.js';
import { syncPaymentsFromSupabase } from './repositories/paymentRepository.js';
import { syncPropertiesFromSupabase } from './repositories/propertyRepository.js';
import { syncRoutesFromSupabase } from './repositories/routeRepository.js';
import { syncSettingsFromSupabase } from './repositories/settingsRepository.js';
import { syncShiftsFromSupabase } from './repositories/shiftRepository.js';
import { syncVisitsFromSupabase } from './repositories/visitRepository.js';
import { resolveRepositoryCompanyContext } from './repositoryContext.js';
import { isSupabaseConfigured } from './supabaseClient.js';

export async function syncFoundationFromSupabase() {
  if (!isSupabaseConfigured()) return { configured: false, synced: false };

  const initialAuthContext = await resolveRepositoryCompanyContext();
  const companyMemberships = await syncCompanyMembershipsFromSupabase();
  const authContext = await resolveRepositoryCompanyContext();
  const [settings, employees] = await Promise.all([
    syncSettingsFromSupabase(),
    syncEmployeesFromSupabase()
  ]);
  const customers = await syncCustomersFromSupabase();
  const properties = await syncPropertiesFromSupabase();
  const visits = await syncVisitsFromSupabase();
  const routes = await syncRoutesFromSupabase();
  const invoices = await syncInvoicesFromSupabase();
  const payments = await syncPaymentsFromSupabase();
  const shifts = await syncShiftsFromSupabase();

  return {
    configured: true,
    synced: Boolean(settings || employees || companyMemberships || customers || properties || visits || routes || invoices || payments || shifts),
    settings: Boolean(settings),
    employees: Boolean(employees),
    companyMemberships: Boolean(companyMemberships),
    authContext: Boolean(authContext?.companyId || initialAuthContext?.companyId),
    customers: Boolean(customers),
    properties: Boolean(properties),
    visits: Boolean(visits),
    routes: Boolean(routes),
    invoices: Boolean(invoices),
    payments: Boolean(payments),
    shifts: Boolean(shifts)
  };
}
