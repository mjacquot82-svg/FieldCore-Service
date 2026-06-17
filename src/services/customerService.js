import { deactivateCustomer } from '../data/repositories/customerRepository.js';
import { deactivatePropertiesByCustomer } from '../data/repositories/propertyRepository.js';

export function deactivateCustomerAndProperties(customerId, metadata = {}) {
  const customer = deactivateCustomer(customerId, {
    ...metadata,
    action: metadata.action || 'customer:deactivate-with-properties',
    eventAction: metadata.eventAction || 'deactivate'
  });

  if (!customer) return null;

  const properties = deactivatePropertiesByCustomer(customerId, {
    ...metadata,
    action: 'property:deactivate-by-customer',
    eventAction: 'deactivate-by-customer'
  });

  return {
    customer,
    properties
  };
}
