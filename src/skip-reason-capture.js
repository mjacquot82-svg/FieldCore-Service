import { updateSkipReason } from './data/repositories/visitRepository.js';
import { isProductionMode } from './data/appMode.js';
import { escapeAttr, escapeHtml } from './utils/renderSecurity.js';

const STORAGE_KEY = 'servicebatch_invoice_mvp_v1';
const SKIP_REASONS = [
  'Rain / weather',
  'Customer not home',
  'Access blocked',
  'Equipment issue',
  'Material unavailable',
  'Other'
];

let pendingSkip = null;

function loadState() {
  if (isProductionMode()) return null;
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY));
  } catch {
    return null;
  }
}

function getVisitIdFromButton(button) {
  return button?.dataset?.visitAction?.split(':')?.[0] || '';
}

function getVisitActionFromButton(button) {
  return button?.dataset?.visitAction?.split(':')?.[1] || '';
}

function showSkipReasonModal(visitId, action) {
  closeSkipReasonModal();
  pendingSkip = { visitId, action };

  const modal = document.createElement('div');
  modal.className = 'skip-reason-overlay';
  modal.setAttribute('data-skip-reason-modal', 'true');
  modal.innerHTML = `
    <div class="panel skip-reason-modal">
      <h3>Why was this visit skipped?</h3>
      <p>This reason will be saved to the visit history.</p>
      <label>Skip reason
        <select id="skip-reason-select">
          ${SKIP_REASONS.map((reason) => `<option value="${escapeAttr(reason)}">${escapeHtml(reason)}</option>`).join('')}
        </select>
      </label>
      <label id="skip-reason-other-label" hidden>Other reason
        <input id="skip-reason-other" placeholder="Enter reason" />
      </label>
      <div class="actions">
        <button data-confirm-skip-reason class="primary">Save Reason</button>
        <button data-cancel-skip-reason>Cancel</button>
      </div>
    </div>
  `;

  document.body.appendChild(modal);
  bindSkipReasonModalEvents();
}

function closeSkipReasonModal() {
  document.querySelector('[data-skip-reason-modal]')?.remove();
  pendingSkip = null;
}

function bindSkipReasonModalEvents() {
  const select = document.querySelector('#skip-reason-select');
  const otherLabel = document.querySelector('#skip-reason-other-label');

  select?.addEventListener('change', () => {
    if (otherLabel) otherLabel.hidden = select.value !== 'Other';
  });

  document.querySelector('[data-cancel-skip-reason]')?.addEventListener('click', closeSkipReasonModal);

  document.querySelector('[data-confirm-skip-reason]')?.addEventListener('click', async () => {
    if (!pendingSkip) return;

    const selectedReason = select?.value || '';
    const otherReason = String(document.querySelector('#skip-reason-other')?.value || '').trim();
    const skipReason = selectedReason === 'Other' ? otherReason : selectedReason;

    if (!skipReason) {
      window.alert('Please enter a skip reason.');
      return;
    }

    await updateSkipReason(pendingSkip.visitId, skipReason);
    closeSkipReasonModal();
  });
}

function enhanceSkipButtons() {
  document.querySelectorAll('[data-visit-action]').forEach((button) => {
    const action = getVisitActionFromButton(button);
    if (!['skip', 'skip-reschedule'].includes(action)) return;
    if (button.dataset.skipReasonEnhanced === 'true') return;

    button.dataset.skipReasonEnhanced = 'true';
    button.addEventListener('click', () => {
      const visitId = getVisitIdFromButton(button);
      if (!visitId) return;
      setTimeout(() => showSkipReasonModal(visitId, action), 0);
    });
  });
}

function showSkipReasonsOnCards() {
  const state = loadState();
  if (!state) return;

  const skippedVisits = (state.visits || []).filter((visit) => visit.skip_reason);
  if (!skippedVisits.length) return;

  document.querySelectorAll('article.panel').forEach((card) => {
    if (card.querySelector('[data-skip-reason-badge]')) return;
    const text = card.textContent || '';

    const visit = skippedVisits.find((item) =>
      text.includes(`Visit date ${item.visit_date}`)
      && text.includes(item.service_description || '')
      && text.includes(`Status: ${item.status}`)
    );

    if (!visit) return;

    const statusLine = [...card.querySelectorAll('p')]
      .find((line) => line.textContent.trim().startsWith('Status:'));

    if (!statusLine) return;

    const badge = document.createElement('p');
    badge.setAttribute('data-skip-reason-badge', 'true');
    badge.innerHTML = `<span class="badge outstanding">Skip reason: ${escapeHtml(visit.skip_reason)}</span>`;
    statusLine.insertAdjacentElement('afterend', badge);
  });
}

const observer = new MutationObserver(() => {
  enhanceSkipButtons();
  showSkipReasonsOnCards();
});
observer.observe(document.querySelector('#app'), { childList: true, subtree: true });

enhanceSkipButtons();
showSkipReasonsOnCards();
