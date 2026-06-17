import { syncEmployeesFromSupabase } from './repositories/employeeRepository.js';
import { syncCustomersFromSupabase } from './repositories/customerRepository.js';
import { syncPropertiesFromSupabase } from './repositories/propertyRepository.js';
import { syncSettingsFromSupabase } from './repositories/settingsRepository.js';
import { syncVisitsFromSupabase } from './repositories/visitRepository.js';
import { isSupabaseConfigured } from './supabaseClient.js';

export async function syncFoundationFromSupabase() {
  if (!isSupabaseConfigured()) return { configured: false, synced: false };

  const [settings, employees] = await Promise.all([
    syncSettingsFromSupabase(),
    syncEmployeesFromSupabase()
  ]);
  const customers = await syncCustomersFromSupabase();
  const properties = await syncPropertiesFromSupabase();
  const visits = await syncVisitsFromSupabase();

  return {
    configured: true,
    synced: Boolean(settings || employees || customers || properties || visits),
    settings: Boolean(settings),
    employees: Boolean(employees),
    customers: Boolean(customers),
    properties: Boolean(properties),
    visits: Boolean(visits)
  };
}
