export function getCustomerMap(state) {
  return Object.fromEntries(state.customers.map((customer) => [customer.customer_id, customer]));
}

export function getPropertyMap(state) {
  return Object.fromEntries(state.properties.map((property) => [property.property_id, property]));
}

export function getDashboardMetrics(state) {
  const todayDate = new Date();
  const today = todayDate.toISOString().slice(0, 10);
  const monthStart = new Date(todayDate.getFullYear(), todayDate.getMonth(), 1).toISOString().slice(0, 10);
  const monthEnd = new Date(todayDate.getFullYear(), todayDate.getMonth() + 1, 0).toISOString().slice(0, 10);
  const next7Date = new Date(todayDate);
  next7Date.setDate(next7Date.getDate() + 7);
  const next7Days = next7Date.toISOString().slice(0, 10);

  const completedUnbilledVisits = state.visits.filter((visit) => visit.status === 'completed').length;
  const readyToBillVisits = state.visits.filter((visit) => visit.status === 'completed').length;
  const readyToBillAmount = state.visits
    .filter((visit) => visit.status === 'completed')
    .reduce((sum, visit) => sum + Number(visit.price || 0), 0);
  const todayScheduledVisits = state.visits.filter(
    (visit) => visit.visit_date === today && visit.status === 'scheduled'
  ).length;
  const todayCompletedVisits = state.visits.filter(
    (visit) => visit.visit_date === today && visit.status === 'completed'
  ).length;
  const todaySkippedVisits = state.visits.filter(
    (visit) => visit.visit_date === today && visit.status === 'skipped'
  ).length;
  const upcomingScheduledVisits = state.visits.filter(
    (visit) => visit.status === 'scheduled' && visit.visit_date >= today && visit.visit_date <= next7Days
  ).length;
  const paidThisMonth = (state.payments || [])
    .filter((payment) => payment.payment_date >= monthStart && payment.payment_date <= monthEnd)
    .reduce((sum, payment) => sum + Number(payment.amount || 0), 0);
  const draftInvoices = state.invoices.filter((invoice) => invoice.payment_status === 'draft').length;
  const unpaidInvoices = state.invoices.filter((invoice) => ['sent', 'partial', 'overdue', 'draft'].includes(invoice.payment_status)).length;
  const overdueInvoices = state.invoices.filter((invoice) => invoice.payment_status === 'overdue' || (invoice.payment_status !== 'paid' && invoice.due_date < today)).length;
  const overdueAmount = state.invoices
    .filter((invoice) => invoice.payment_status === 'overdue' || (invoice.payment_status !== 'paid' && invoice.due_date < today))
    .reduce((sum, invoice) => sum + (invoice.total - (invoice.amount_paid || 0)), 0);
  const totalOutstanding = state.invoices
    .filter((invoice) => invoice.payment_status !== 'paid')
    .reduce((sum, invoice) => sum + (invoice.total - (invoice.amount_paid || 0)), 0);

  return {
    completedUnbilledVisits,
    readyToBillVisits,
    readyToBillAmount: Number(readyToBillAmount.toFixed(2)),
    todayScheduledVisits,
    todayCompletedVisits,
    todaySkippedVisits,
    upcomingScheduledVisits,
    paidThisMonth: Number(paidThisMonth.toFixed(2)),
    draftInvoices,
    unpaidInvoices,
    overdueInvoices,
    overdueAmount: Number(overdueAmount.toFixed(2)),
    totalOutstanding: Number(totalOutstanding.toFixed(2))
  };
}
