const STORAGE_KEY = 'servicebatch_invoice_mvp_v1';

function loadState() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY));
  } catch {
    return null;
  }
}

function customerMap(state) {
  return Object.fromEntries((state.customers || []).map((customer) => [customer.customer_id, customer]));
}

function propertyMap(state) {
  return Object.fromEntries((state.properties || []).map((property) => [property.property_id, property]));
}

function normalizePhone(phone) {
  return String(phone || '').replace(/[^0-9+]/g, '');
}

function isRouteVisitCard(card) {
  const text = card.textContent || '';
  return text.includes('Visit date ') && text.includes('Status:');
}

function findVisitForCard(card, state) {
  const text = card.textContent || '';
  return (state.visits || []).find((visit) =>
    text.includes(`Visit date ${visit.visit_date}`)
    && text.includes(visit.service_description || '')
    && text.includes(`Status: ${visit.status}`)
  );
}

function addQuickActionsToRouteCards() {
  const state = loadState();
  if (!state) return;

  const customers = customerMap(state);
  const properties = propertyMap(state);

  document.querySelectorAll('article.panel').forEach((card) => {
    if (!isRouteVisitCard(card)) return;
    if (card.querySelector('[data-route-card-quick-actions]')) return;

    const visit = findVisitForCard(card, state);
    if (!visit) return;

    const property = properties[visit.property_id];
    const customer = customers[property?.customer_id];
    const phone = normalizePhone(customer?.phone);
    const address = property?.service_address || '';

    if (!phone && !address) return;

    const wrapper = document.createElement('div');
    wrapper.className = 'actions route-card-quick-actions';
    wrapper.setAttribute('data-route-card-quick-actions', 'true');

    if (phone) {
      const callLink = document.createElement('a');
      callLink.href = `tel:${phone}`;
      callLink.className = 'button-link';
      callLink.textContent = '📞 Call Customer';
      wrapper.appendChild(callLink);
    }

    if (address) {
      const mapLink = document.createElement('a');
      mapLink.href = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`;
      mapLink.target = '_blank';
      mapLink.rel = 'noopener noreferrer';
      mapLink.className = 'button-link';
      mapLink.textContent = '📍 Navigate';
      wrapper.appendChild(mapLink);
    }

    const actions = card.querySelector('.actions');
    if (actions) {
      actions.insertAdjacentElement('beforebegin', wrapper);
    } else {
      card.appendChild(wrapper);
    }
  });
}

const observer = new MutationObserver(addQuickActionsToRouteCards);
observer.observe(document.querySelector('#app'), { childList: true, subtree: true });

addQuickActionsToRouteCards();
