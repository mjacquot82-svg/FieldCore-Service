const today = () => new Date().toISOString().slice(0, 10);

function highlightOverdueRouteCards() {
  const routeHeading = [...document.querySelectorAll('section h2')]
    .find((heading) => ['Today’s Route / Daily Work List', 'Overdue Visits'].includes(heading.textContent.trim()));

  if (!routeHeading) return;

  const section = routeHeading.closest('section');
  if (!section) return;

  section.querySelectorAll('article.panel').forEach((card) => {
    const text = card.textContent || '';
    const visitDateMatch = text.match(/Visit date\s+(\d{4}-\d{2}-\d{2})/);
    const statusMatch = text.match(/Status:\s*([^\n]+)/);

    if (!visitDateMatch || !statusMatch) return;

    const visitDate = visitDateMatch[1];
    const status = statusMatch[1].trim().toLowerCase();
    const isOverdue = status === 'scheduled' && visitDate < today();

    card.classList.toggle('overdue-card', isOverdue);

    if (!isOverdue || card.querySelector('[data-route-overdue-badge]')) return;

    const badge = document.createElement('p');
    badge.setAttribute('data-route-overdue-badge', 'true');
    badge.innerHTML = `<span class="badge overdue">⚠ Overdue since ${visitDate}</span>`;

    const visitDateLine = [...card.querySelectorAll('p')]
      .find((line) => line.textContent.trim() === `Visit date ${visitDate}`);

    if (visitDateLine) {
      visitDateLine.insertAdjacentElement('afterend', badge);
    }
  });
}

const observer = new MutationObserver(highlightOverdueRouteCards);
observer.observe(document.querySelector('#app'), { childList: true, subtree: true });

highlightOverdueRouteCards();
