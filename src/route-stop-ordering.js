const STORAGE_KEY = 'servicebatch_invoice_mvp_v1';

function loadState() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY));
  } catch {
    return null;
  }
}

function saveState(state) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function moveVisit(direction, visitId) {
  const state = loadState();
  if (!state) return;

  const visits = [...(state.visits || [])];
  const index = visits.findIndex(v => v.visit_id === visitId);
  if (index === -1) return;

  const swapIndex = direction === 'up' ? index - 1 : index + 1;
  if (swapIndex < 0 || swapIndex >= visits.length) return;

  const temp = visits[index];
  visits[index] = visits[swapIndex];
  visits[swapIndex] = temp;

  state.visits = visits;
  saveState(state);
  location.reload();
}

function injectOrderingControls() {
  document.querySelectorAll('[data-visit-action]').forEach(button => {
    const visitId = button.dataset.visitAction?.split(':')[0];
    if (!visitId) return;

    const container = button.closest('.actions');
    if (!container) return;

    if (container.querySelector('[data-order-controls]')) return;

    const wrapper = document.createElement('div');
    wrapper.dataset.orderControls = 'true';
    wrapper.style.display = 'flex';
    wrapper.style.gap = '6px';

    const up = document.createElement('button');
    up.textContent = '↑ Move Up';
    up.addEventListener('click', () => moveVisit('up', visitId));

    const down = document.createElement('button');
    down.textContent = '↓ Move Down';
    down.addEventListener('click', () => moveVisit('down', visitId));

    wrapper.appendChild(up);
    wrapper.appendChild(down);
    container.appendChild(wrapper);
  });
}

const observer = new MutationObserver(injectOrderingControls);
observer.observe(document.querySelector('#app'), { childList: true, subtree: true });

injectOrderingControls();
