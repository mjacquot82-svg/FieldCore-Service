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
  const state = loadState();
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
  const state = loadState();
  if (!state) return;

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

function editAccessInfo(propertyId) {
  const state = loadState();
  if (!state) return;

  const property = (state.properties || []).find((item) => item.property_id === propertyId);
  if (!property) return;

  const gateCode = window.prompt('Gate code:', property.gate_code || '');
  if (gateCode === null) return;

  const accessNotes = window.prompt('Access notes:', property.access_notes || '');
  if (accessNotes === null) return;

  const parkingNotes = window.prompt('Parking notes:', property.parking_notes || '');
  if (parkingNotes === null) return;

  const hazards = window.prompt('Hazards / warnings:', property.hazards || '');
  if (hazards === null) return;

  state.properties = (state.properties || []).map((item) =>
    item.property_id === propertyId
      ? {
          ...item,
          gate_code: gateCode.trim(),
          access_notes: accessNotes.trim(),
          parking_notes: parkingNotes.trim(),
          hazards: hazards.trim()
        }
      : item
  );

  saveState(state);
  window.location.reload();
}

function enhancePropertyAccessInfo() {
  addAccessEditButtonsToPropertyCards();
  showAccessInfoOnRouteCards();
}

const observer = new MutationObserver(enhancePropertyAccessInfo);
observer.observe(document.querySelector('#app'), { childList: true, subtree: true });

enhancePropertyAccessInfo();
