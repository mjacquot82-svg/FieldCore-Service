import { getLateCompletedVisitLookup } from './data/repositories/visitReadRepository.js';

function addLateCompletionBadges() {
  const timelineHeading = [...document.querySelectorAll('section h2')]
    .find((heading) => heading.textContent.includes('Customer Activity'));

  if (!timelineHeading) return;

  const lateCompletedVisits = getLateCompletedVisitLookup();
  if (!lateCompletedVisits.size) return;

  const section = timelineHeading.closest('section');
  if (!section) return;

  section.querySelectorAll('.timeline-event').forEach((eventCard) => {
    if (eventCard.querySelector('[data-completed-late-badge]')) return;

    const date = eventCard.querySelector('.timeline-date')?.textContent.trim();
    const title = eventCard.querySelector('h3')?.textContent.trim();
    const typeBadge = eventCard.querySelector('.badge')?.textContent.trim().toLowerCase();

    if (!date || !title || typeBadge !== 'visit completed') return;
    if (!lateCompletedVisits.has(`${date}|${title}`)) return;

    const badge = document.createElement('span');
    badge.className = 'badge overdue completed-late-badge';
    badge.setAttribute('data-completed-late-badge', 'true');
    badge.textContent = 'Completed late';

    eventCard.querySelector('.badge')?.insertAdjacentElement('afterend', badge);
  });
}

const observer = new MutationObserver(addLateCompletionBadges);
observer.observe(document.querySelector('#app'), { childList: true, subtree: true });

addLateCompletionBadges();
