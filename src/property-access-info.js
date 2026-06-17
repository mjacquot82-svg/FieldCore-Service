import {
  getProperty,
  listProperties,
  updateAccessInfo
} from './data/repositories/propertyRepository.js';
import {
  getStateSnapshot
} from './data/repositories/visitReadRepository.js';

function propertyMap(state) {
  return Object.fromEntries((state.properties || []).map((property) => [property.property_id, property]));
}

function routeVisitCards() {
  return [...document.querySelectorAll('article.panel')].filter((card) => {
    const text = card.textContent || '';
    return text.includes('Visit date ') && text.includes('Status:');
  });
}

function findVisitForCard(card, state) {
  const text = card.textContent || '';
  return (state.visits || []).find((visit) =>
    text.includes(`Visit date ${visit.visit_date}`)
    && text.includes(visit.service_description || '')
    && text.includes(`Status: ${visit.status}`)
  );
}

function accessInfoLines(property) {
  const lines = [];
  if (property?.gate_code) lines.push(`Gate code: ${property.gate_code}`);
  if (property?.access_notes) lines.push(`Access: ${property.access_notes}`);
  if (property?.parking_notes) lines.push(`Parking: ${property.parking_notes}`);
  if (property?.hazards) lines.push(`Hazards: ${property.hazards}`);
  return lines;
}

function showAccessInfoOnRouteCards() {
  const state = getStateSnapshot();
  if (!state) return;

  const properties = propertyMap(state);

  routeVisitCards().forEach((card) => {
    if (card.querySelector('[data-property-access-info]')) return;

    const visit = findVisitForCard(card, state);
    const property = properties[visit?.property_id];
    const lines = accessInfoLines(property);
    if (!lines.length) return;

    const block = document.createElement('div');
    block.className = 'property-access-info';
    block.setAttribute('data-property-access-info', 'true');
    block.innerHTML = `
      <strong>Access Info</strong>
      ${lines.map((line) => `<p>${line}</p>`).join('')}
    `;

    const actions = card.querySelector('.actions');
    if (actions) {
      actions.insertAdjacentElement('beforebegin', block);
    } else {
      card.appendChild(block);
    }
  });
}

function findPropertyForPropertyCard(card, state) {
  const heading = card.querySelector('h3')?.textContent.trim();
  if (!heading) return null;
  return (state.properties || []).find((property) => property.service_address === heading);
}

function addAccessEditButtonsToPropertyCards() {
  const state = { properties: listProperties() };

  document.querySelectorAll('article.panel').forEach((card) => {
    if (card.querySelector('[data-edit-access-info]')) return;

    const property = findPropertyForPropertyCard(card, state);
    if (!property) return;

    const actions = card.querySelector('.actions');
    if (!actions) return;

    const button = document.createElement('button');
    button.setAttribute('data-edit-access-info', property.property_id);
    button.textContent = 'Access Info';
    button.addEventListener('click', () => editAccessInfo(property.property_id));
    actions.appendChild(button);
  });
}

async function editAccessInfo(propertyId) {
  const property = getProperty(propertyId);
  if (!property) return;

  const gateCode = window.prompt('Gate code:', property.gate_code || '');
  if (gateCode === null) return;

  const accessNotes = window.prompt('Access notes:', property.access_notes || '');
  if (accessNotes === null) return;

  const parkingNotes = window.prompt('Parking notes:', property.parking_notes || '');
  if (parkingNotes === null) return;

  const hazards = window.prompt('Hazards / warnings:', property.hazards || '');
  if (hazards === null) return;

  await updateAccessInfo(propertyId, {
    gate_code: gateCode.trim(),
    access_notes: accessNotes.trim(),
    parking_notes: parkingNotes.trim(),
    hazards: hazards.trim()
  });
  window.location.reload();
}

function enhancePropertyAccessInfo() {
  addAccessEditButtonsToPropertyCards();
  showAccessInfoOnRouteCards();
}

const observer = new MutationObserver(enhancePropertyAccessInfo);
observer.observe(document.querySelector('#app'), { childList: true, subtree: true });

enhancePropertyAccessInfo();
