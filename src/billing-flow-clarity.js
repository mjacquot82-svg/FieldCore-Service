function relabelBillingNavigation() {
  document.querySelectorAll('[data-nav="batch"]').forEach((button) => {
    button.textContent = 'Billing Queue';
  });
}

function enhanceBillingQueue() {
  const section = Array.from(document.querySelectorAll('main.content section')).find((candidate) => {
    const title = candidate.querySelector('h2')?.textContent?.trim();
    return title === 'Ready to Bill' || title === 'Billing Queue';
  });
  if (!section || section.dataset.billingQueueClarity === 'true') return;

  const heading = section.querySelector('h2');
  if (heading) heading.textContent = 'Billing Queue';

  const intro = section.querySelector('p');
  if (intro) {
    intro.textContent = 'Completed work waits here until the office is ready to generate invoices. Use the date range to batch completed, uninvoiced visits into customer invoices.';
  }

  const form = section.querySelector('#batch-form');
  const submitButton = form?.querySelector('button[type="submit"], button');
  if (submitButton) submitButton.textContent = 'Generate Customer Invoices';

  const explainer = document.createElement('article');
  explainer.className = 'panel billing-flow-explainer';
  explainer.innerHTML = `
    <h3>How batch invoicing works</h3>
    <ol>
      <li><strong>Today’s Route:</strong> workers mark visits completed.</li>
      <li><strong>Billing Queue:</strong> completed, uninvoiced work collects here.</li>
      <li><strong>Generate Customer Invoices:</strong> visits are grouped by customer and turned into invoices.</li>
      <li><strong>Invoices:</strong> created invoices move to the invoice archive/control center.</li>
      <li><strong>Payments:</strong> record payment and track unpaid or overdue balances.</li>
    </ol>
  `;

  if (form) {
    section.insertBefore(explainer, form);
  } else {
    section.appendChild(explainer);
  }

  section.dataset.billingQueueClarity = 'true';
}

function enhanceInvoicesIntro() {
  const section = Array.from(document.querySelectorAll('main.content section')).find((candidate) =>
    candidate.querySelector('h2')?.textContent?.trim() === 'Invoices'
  );
  if (!section || section.dataset.invoicePurposeAdded === 'true') return;

  const heading = section.querySelector('h2');
  if (!heading) return;

  const purpose = document.createElement('article');
  purpose.className = 'panel invoice-purpose-panel';
  purpose.innerHTML = `
    <h3>What this page is for</h3>
    <p>Invoices is the archive and control center for invoices that already exist. Use Billing Queue to create invoices from completed work, then use this page to review totals, due dates, balances, and payment follow-up.</p>
  `;

  heading.insertAdjacentElement('afterend', purpose);
  section.dataset.invoicePurposeAdded = 'true';
}

let scheduled = false;
function scheduleBillingClarity() {
  if (scheduled) return;
  scheduled = true;
  window.requestAnimationFrame(() => {
    scheduled = false;
    relabelBillingNavigation();
    enhanceBillingQueue();
    enhanceInvoicesIntro();
  });
}

const app = document.querySelector('#app');
if (app) {
  const observer = new MutationObserver(scheduleBillingClarity);
  observer.observe(app, { childList: true, subtree: true });
}

scheduleBillingClarity();
