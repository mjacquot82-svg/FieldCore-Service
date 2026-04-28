const today = () => new Date().toISOString().slice(0, 10);

function daysOverdue(visitDate) {
  const todayDate = new Date(`${today()}T00:00:00`);
  const scheduledDate = new Date(`${visitDate}T00:00:00`);
  const diffMs = todayDate - scheduledDate;
  return Math.max(1, Math.round(diffMs / 86400000));
}

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

    const overdueDays = daysOverdue(visitDate);
    const dayLabel = overdueDays === 1 ? 'day' : 'days';
    const badge = document.createElement('p');
    badge.setAttribute('data-route-overdue-badge', 'true');
    badge.innerHTML = `<span class="badge overdue">⚠ Overdue by ${overdueDays} ${dayLabel}</span>`;

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
