import { readState, resetState } from '../data/storage/local-state-adapter.js';
import {
  getCustomerMap,
  getDashboardMetrics,
  getPropertyMap
} from '../data/selectors/dashboardSelectors.js';
import {
  generateInvoicesForDateRange,
  generateInvoicesForVisits
} from '../services/billingService.js';
import { updateInvoicePaymentStatus as updateInvoicePaymentStatusService } from '../services/paymentService.js';

export function loadState() {
  return readState();
}

export function resetSeed() {
  return resetState();
}

export { getCustomerMap, getPropertyMap };

export function generateBatchInvoices(state, startDate, endDate) {
  return generateInvoicesForDateRange(startDate, endDate, {
    source: 'store-compat'
  });
}

export function generateSelectedVisitInvoices(state, visitIds) {
  return generateInvoicesForVisits(visitIds, {
    source: 'store-compat'
  });
}

export function updateInvoicePaymentStatus(state, invoiceId, nextStatus) {
  const updatedInvoice = updateInvoicePaymentStatusService(invoiceId, nextStatus, {
    source: 'store-compat'
  });

  if (!updatedInvoice) return;

  return updatedInvoice;
}

export function computeDashboard(state) {
  return getDashboardMetrics(state);
}
