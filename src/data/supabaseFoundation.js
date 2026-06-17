import { syncEmployeesFromSupabase } from './repositories/employeeRepository.js';
import { syncSettingsFromSupabase } from './repositories/settingsRepository.js';
import { isSupabaseConfigured } from './supabaseClient.js';

export async function syncFoundationFromSupabase() {
  if (!isSupabaseConfigured()) return { configured: false, synced: false };

  const [settings, employees] = await Promise.all([
    syncSettingsFromSupabase(),
    syncEmployeesFromSupabase()
  ]);

  return {
    configured: true,
    synced: Boolean(settings || employees),
    settings: Boolean(settings),
    employees: Boolean(employees)
  };
}
