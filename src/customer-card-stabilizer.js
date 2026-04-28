function stabilizeCustomerCards() {
  document.querySelectorAll('.customer-card .actions').forEach((actions) => {
    if (actions.dataset.stabilized === 'true') return;

    const buttons = [...actions.querySelectorAll('button')];
    const ledger = buttons.find((button) => button.textContent.trim() === 'View Ledger');
    const services = buttons.find((button) => button.textContent.trim() === 'Manage Services');
    const activity = buttons.find((button) => button.textContent.trim() === 'Customer Activity');
    const edit = buttons.find((button) => button.textContent.trim() === 'Edit Customer');
    const remove = buttons.find((button) => button.textContent.trim() === 'Remove Customer');

    if (activity) activity.textContent = 'Open';
    if (services) services.textContent = 'Properties';
    if (ledger) ledger.textContent = 'Ledger';
    if (edit) edit.textContent = 'Edit';
    if (remove) remove.textContent = 'Remove';

    actions.innerHTML = '';
    [activity, services, ledger].filter(Boolean).forEach((button) => {
      button.classList.add('customer-primary-action');
      actions.appendChild(button);
    });

    if (edit || remove) {
      const more = document.createElement('details');
      more.className = 'card-more-menu';
      const summary = document.createElement('summary');
      summary.textContent = 'More';
      more.appendChild(summary);
      [edit, remove].filter(Boolean).forEach((button) => {
        button.classList.add('customer-secondary-action');
        more.appendChild(button);
      });
      actions.appendChild(more);
    }

    actions.dataset.stabilized = 'true';
  });
}

const observer = new MutationObserver(stabilizeCustomerCards);
observer.observe(document.querySelector('#app'), { childList: true, subtree: true });
stabilizeCustomerCards();
