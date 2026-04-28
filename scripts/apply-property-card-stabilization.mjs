import { readFileSync, writeFileSync } from 'node:fs';

const path = 'src/main.js';
const source = readFileSync(path, 'utf8');

function replaceFunction(text, functionName, replacement) {
  const start = text.indexOf(`function ${functionName}(`);
  if (start === -1) {
    throw new Error(`Could not find function ${functionName}`);
  }

  let index = start;
  let braceStart = text.indexOf('{', start);
  if (braceStart === -1) {
    throw new Error(`Could not find opening brace for ${functionName}`);
  }

  let depth = 0;
  let inString = false;
  let stringQuote = '';
  let inTemplate = false;
  let escaped = false;

  for (index = braceStart; index < text.length; index += 1) {
    const char = text[index];
    const previous = text[index - 1];

    if (escaped) {
      escaped = false;
      continue;
    }

    if (char === '\\') {
      escaped = true;
      continue;
    }

    if (inString) {
      if (char === stringQuote) inString = false;
      continue;
    }

    if (inTemplate) {
      if (char === '`' && previous !== '\\') inTemplate = false;
      // Still count template interpolation braces roughly enough for these simple replacements.
      continue;
    }

    if (char === '"' || char === "'") {
      inString = true;
      stringQuote = char;
      continue;
    }

    if (char === '`') {
      inTemplate = true;
      continue;
    }

    if (char === '{') depth += 1;
    if (char === '}') {
      depth -= 1;
      if (depth === 0) {
        return text.slice(0, start) + replacement + text.slice(index + 1);
      }
    }
  }

  throw new Error(`Could not find closing brace for ${functionName}`);
}

const groupedQuickCards = String.raw`function renderPropertyQuickActionCards(properties, customerMap) {
  if (!properties.length) return '<article class="panel"><p>No properties found for this customer.</p></article>';

  const grouped = properties.reduce((groups, property) => {
    const key = `${property.customer_id}::${(property.service_address || '').trim().toLowerCase()}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(property);
    return groups;
  }, new Map());

  return [...grouped.values()].map((services) => {
    const primary = services[0];
    const customerName = customerMap[primary.customer_id]?.name ?? 'Unknown Customer';
    const activeCount = services.filter((service) => service.status === 'active').length;
    const statusLabel = activeCount > 0 ? 'active' : 'inactive';
    const statusClass = activeCount > 0 ? 'paid-up' : 'outstanding';
    const nextSignal = services.map((service) => renderVisitStatusLine(service.property_id)).join('');
    const serviceRows = services.map((service) => `<div class="service-summary-row"><span><strong>${service.service_type}</strong> · ${service.recurring_frequency}</span><span>${currency(service.default_price)}</span></div>`).join('');
    const notes = services.map((service) => service.notes).filter(Boolean)[0] || 'None';

    return `<article class="panel property-compact-card">
      <div class="customer-card-header">
        <div><h3>${primary.service_address}</h3><p>${customerName}</p></div>
        <span class="badge ${statusClass}">${statusLabel}</span>
      </div>
      <div class="property-compact-body">
        ${nextSignal}
        <div class="service-summary-list">${serviceRows}</div>
        <p>Notes: ${notes}</p>
      </div>
      <div class="actions"><button data-customer-nav="timeline:${primary.customer_id}">Open</button><button data-service-schedule="${primary.property_id}">Schedule Visit</button><button data-service-pause="${primary.property_id}">Pause Service</button><button data-service-frequency="${primary.property_id}">Change Frequency</button><button data-service-price="${primary.property_id}">Adjust Price</button></div>
    </article>`;
  }).join('');
}`;

const groupedRenderProperties = String.raw`function renderProperties(customerMap) {
  const customer = selectedCustomer();
  const properties = selectedCustomerId ? customerProperties(selectedCustomerId) : state.properties;
  const serviceForms = customer ? `<div class="service-layout"><form id="service-form" class="panel service-form"><h3>Add Recurring Service or Property</h3><label>Property / Service Location<input name="service_address" placeholder="123 Main St or Backyard" required /></label><label>Service Type<input name="service_type" placeholder="Mowing, Garden Care, Snow Removal" required /></label><label>Frequency<select name="recurring_frequency" required><option value="weekly">Weekly</option><option value="biweekly">Biweekly</option><option value="monthly">Monthly</option><option value="one-time">One-time / odd job location</option></select></label><label>Default Price<input name="default_price" type="number" min="0" step="0.01" required /></label><label>Notes<input name="notes" placeholder="Gate code, preferred day, service notes" /></label><button class="primary" type="submit">Add Service</button></form><form id="one-off-form" class="panel service-form"><h3>Schedule One-Off Job</h3>${properties.length ? `<label>Property / Service Location<select name="property_id" required>${properties.map((p) => `<option value="${p.property_id}">${p.service_address} · ${p.service_type}</option>`).join('')}</select></label>` : '<p>Add a property before scheduling a one-off job.</p>'}<label>Job Date<input name="visit_date" type="date" required /></label><label>Job Description<input name="service_description" placeholder="Mulch install, weeding, cleanup" required /></label><label>Price<input name="price" type="number" min="0" step="0.01" required /></label><label>Notes<input name="notes" placeholder="Materials, access notes, special instructions" /></label><button class="primary" type="submit" ${properties.length ? '' : 'disabled'}>Schedule One-Off Job</button></form></div>` : '';

  const groupedCards = properties.length ? renderPropertyQuickActionCards(properties, customerMap) : '<article class="panel"><p>No properties found for this customer.</p></article>';

  return `<section><h2>${customer ? `${customer.name} Properties / Services` : 'Properties / Services'}</h2>${customer ? '<button class="primary" data-nav="customers">Back to Customers</button>' : ''}${serviceForms}<div class="stack">${groupedCards}</div></section>`;
}`;

let updated = source;
updated = replaceFunction(updated, 'renderPropertyQuickActionCards', groupedQuickCards);
updated = replaceFunction(updated, 'renderProperties', groupedRenderProperties);

writeFileSync(path, updated);
console.log('Applied FieldCore property-card stabilization to src/main.js');
