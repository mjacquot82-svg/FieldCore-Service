import { reorderRouteStops } from './services/routeService.js';

async function moveVisit(direction, visitId) {
  const state = await reorderRouteStops(visitId, direction);
  if (!state) return;
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
