import { updateRecurringSchedule } from '../data/repositories/propertyRepository.js';
import { bulkCreateVisits } from '../data/repositories/visitRepository.js';

export function saveRecurringSchedule(propertyId, recurringSchedule, metadata = {}) {
  return updateRecurringSchedule(propertyId, recurringSchedule, metadata);
}

export function createRecurringGeneratedVisits(visits = [], metadata = {}) {
  return bulkCreateVisits(visits, {
    ...metadata,
    action: metadata.action || 'visit:create-recurring-generated',
    eventAction: metadata.eventAction || 'recurring-generated'
  });
}
