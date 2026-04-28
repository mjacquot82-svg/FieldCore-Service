const STORAGE_KEY = 'servicebatch_invoice_mvp_v1';
const originalSetItem = localStorage.setItem.bind(localStorage);

function today() {
  return new Date().toISOString().slice(0, 10);
}

function withActualCompletionTracking(nextState) {
  const rawPreviousState = localStorage.getItem(STORAGE_KEY);
  if (!rawPreviousState) return nextState;

  let previousState;
  try {
    previousState = JSON.parse(rawPreviousState);
  } catch {
    return nextState;
  }

  const previousVisitsById = new Map(
    (previousState.visits || []).map((visit) => [visit.visit_id, visit])
  );
  const completedAt = new Date().toISOString();
  const completedDate = today();

  return {
    ...nextState,
    visits: (nextState.visits || []).map((visit) => {
      const previousVisit = previousVisitsById.get(visit.visit_id);
      const justCompleted = visit.status === 'completed' && previousVisit?.status !== 'completed';

      if (!justCompleted) return visit;

      return {
        ...visit,
        completed_at: visit.completed_at || completedAt,
        completed_date: visit.completed_date || completedDate,
        completed_late: Boolean(visit.visit_date && visit.visit_date < completedDate)
      };
    })
  };
}

localStorage.setItem = function setItemWithActualCompletionTracking(key, value) {
  if (key !== STORAGE_KEY) {
    originalSetItem(key, value);
    return;
  }

  try {
    const nextState = JSON.parse(value);
    const trackedState = withActualCompletionTracking(nextState);
    originalSetItem(key, JSON.stringify(trackedState));
  } catch {
    originalSetItem(key, value);
  }
};
