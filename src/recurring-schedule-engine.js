import {
  createRecurringGeneratedVisits,
  saveRecurringSchedule
} from './services/scheduleService.js';

const STORAGE_KEY = 'servicebatch_invoice_mvp_v1';
const GENERATE_DAYS = 30;

const WEEKDAYS = [
  ['0', 'Sunday'],
  ['1', 'Monday'],
  ['2', 'Tuesday'],
  ['3', 'Wednesday'],
  ['4', 'Thursday'],
  ['5', 'Friday'],
  ['6', 'Saturday']
];

const CANADA_HOLIDAYS = {
  '2026-01-01': 'New Year’s Day',
  '2026-02-16': 'Family Day',
  '2026-04-03': 'Good Friday',
  '2026-05-18': 'Victoria Day',
  '2026-07-01': 'Canada Day',
  '2026-08-03': 'Civic Holiday',
  '2026-09-07': 'Labour Day',
  '2026-10-12': 'Thanksgiving',
  '2026-12-25': 'Christmas Day',
  '2026-12-26': 'Boxing Day'
};

function loadState() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY));
  } catch {
    return null;
  }
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

function toDate(dateString) {
  return new Date(`${dateString}T00:00:00`);
}

function toDateString(date) {
  return date.toISOString().slice(0, 10);
}

function addDays(date, days) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function makeVisitId() {
  return `visit_${crypto.randomUUID().slice(0, 8)}`;
}

function findPropertyForCard(card, state) {
  const heading = card.querySelector('h3')?.textContent.trim();
  if (!heading) return null;
  return (state.properties || []).find((property) => property.service_address === heading);
}

function addRecurringButtons() {
  const state = loadState();
  if (!state) return;

  document.querySelectorAll('article.panel').forEach((card) => {
    const property = findPropertyForCard(card, state);
    if (!property) return;

    const actions = card.querySelector('.actions');
    if (!actions) return;

    if (!actions.querySelector('[data-recurring-schedule]')) {
      const scheduleButton = document.createElement('button');
      scheduleButton.textContent = 'Recurring Schedule';
      scheduleButton.dataset.recurringSchedule = property.property_id;
      scheduleButton.addEventListener('click', () => editRecurringSchedule(property.property_id));
      actions.appendChild(scheduleButton);
    }

    if (!actions.querySelector('[data-generate-visits]')) {
      const generateButton = document.createElement('button');
      generateButton.textContent = 'Generate Upcoming Visits';
      generateButton.dataset.generateVisits = property.property_id;
      generateButton.addEventListener('click', () => generateUpcomingVisits(property.property_id));
      actions.appendChild(generateButton);
    }
  });
}

function editRecurringSchedule(propertyId) {
  const state = loadState();
  if (!state) return;

  const property = (state.properties || []).find((item) => item.property_id === propertyId);
  if (!property) return;

  const current = property.recurring_schedule || {};

  const frequency = window.prompt(
    'Frequency (weekly, biweekly, every-4-weeks, monthly):',
    current.frequency || property.recurring_frequency || 'weekly'
  );
  if (frequency === null) return;

  const weekday = window.prompt(
    'Preferred weekday number (0=Sun, 1=Mon, 2=Tue, 3=Wed, 4=Thu, 5=Fri, 6=Sat):',
    String(current.weekday ?? new Date().getDay())
  );
  if (weekday === null) return;

  const startDate = window.prompt('Schedule start date (YYYY-MM-DD):', current.start_date || today());
  if (startDate === null) return;

  const endDate = window.prompt('Optional schedule end date (YYYY-MM-DD, blank for none):', current.end_date || '');
  if (endDate === null) return;

  const normalizedFrequency = frequency.trim().toLowerCase();
  const validFrequencies = new Set(['weekly', 'biweekly', 'every-4-weeks', 'monthly']);
  if (!validFrequencies.has(normalizedFrequency)) {
    window.alert('Frequency must be weekly, biweekly, every-4-weeks, or monthly.');
    return;
  }

  const weekdayNumber = Number(weekday);
  if (!Number.isInteger(weekdayNumber) || weekdayNumber < 0 || weekdayNumber > 6) {
    window.alert('Preferred weekday must be a number from 0 to 6.');
    return;
  }

  saveRecurringSchedule(propertyId, {
    frequency: normalizedFrequency,
    weekday: weekdayNumber,
    start_date: startDate.trim(),
    end_date: endDate.trim(),
    holiday_policy: 'flag_only',
    status: 'active'
  });
  window.alert('Recurring schedule saved.');
  window.location.reload();
}

function frequencyIntervalDays(frequency) {
  if (frequency === 'biweekly') return 14;
  if (frequency === 'every-4-weeks') return 28;
  if (frequency === 'monthly') return null;
  return 7;
}

function firstMatchingWeekday(startDate, weekday) {
  let cursor = toDate(startDate);
  while (cursor.getDay() !== weekday) {
    cursor = addDays(cursor, 1);
  }
  return cursor;
}

function addMonths(date, months) {
  const next = new Date(date);
  next.setMonth(next.getMonth() + months);
  return next;
}

function generateDates(schedule) {
  const start = schedule.start_date || today();
  const endLimit = addDays(toDate(today()), GENERATE_DAYS);
  const explicitEnd = schedule.end_date ? toDate(schedule.end_date) : null;
  const finalEnd = explicitEnd && explicitEnd < endLimit ? explicitEnd : endLimit;

  const dates = [];
  let cursor = firstMatchingWeekday(start, Number(schedule.weekday ?? 1));

  if (cursor < toDate(today())) {
    while (cursor < toDate(today())) {
      cursor = schedule.frequency === 'monthly'
        ? addMonths(cursor, 1)
        : addDays(cursor, frequencyIntervalDays(schedule.frequency));
    }
  }

  while (cursor <= finalEnd) {
    dates.push(toDateString(cursor));
    cursor = schedule.frequency === 'monthly'
      ? addMonths(cursor, 1)
      : addDays(cursor, frequencyIntervalDays(schedule.frequency));
  }

  return dates;
}

function generateUpcomingVisits(propertyId) {
  const state = loadState();
  if (!state) return;

  const property = (state.properties || []).find((item) => item.property_id === propertyId);
  const schedule = property?.recurring_schedule;

  if (!property || !schedule || schedule.status !== 'active') {
    window.alert('Add an active recurring schedule first.');
    return;
  }

  const generatedDates = generateDates(schedule);
  let createdCount = 0;

  const newVisits = generatedDates
    .filter((visitDate) => !(state.visits || []).some((visit) =>
      visit.property_id === property.property_id && visit.visit_date === visitDate
    ))
    .map((visitDate) => {
      createdCount += 1;
      const holidayName = CANADA_HOLIDAYS[visitDate] || '';
      return {
        visit_id: makeVisitId(),
        company_id: state.company?.company_id,
        property_id: property.property_id,
        visit_date: visitDate,
        service_description: `${schedule.frequency} ${property.service_type.toLowerCase()} service`,
        price: property.default_price,
        status: 'scheduled',
        notes: property.notes || 'Generated recurring visit.',
        recurring_generated: true,
        holiday_conflict: Boolean(holidayName),
        holiday_name: holidayName,
        created_at: new Date().toISOString()
      };
    });

  createRecurringGeneratedVisits(newVisits);
  window.alert(`Generated ${createdCount} upcoming visit${createdCount === 1 ? '' : 's'} for the next ${GENERATE_DAYS} days.`);
  window.location.reload();
}

function showHolidayConflicts() {
  const state = loadState();
  if (!state) return;

  const holidayVisits = (state.visits || []).filter((visit) => visit.holiday_conflict);
  if (!holidayVisits.length) return;

  document.querySelectorAll('article.panel').forEach((card) => {
    if (card.querySelector('[data-holiday-conflict]')) return;
    const text = card.textContent || '';
    const visit = holidayVisits.find((item) =>
      text.includes(`Visit date ${item.visit_date}`)
      && text.includes(item.service_description || '')
      && text.includes(`Status: ${item.status}`)
    );
    if (!visit) return;

    const badge = document.createElement('p');
    badge.setAttribute('data-holiday-conflict', 'true');
    badge.innerHTML = `<span class="badge overdue">⚠ Holiday conflict: ${visit.holiday_name}</span>`;

    const statusLine = [...card.querySelectorAll('p')]
      .find((line) => line.textContent.trim().startsWith('Status:'));
    if (statusLine) statusLine.insertAdjacentElement('afterend', badge);
  });
}

function enhanceRecurringSchedules() {
  addRecurringButtons();
  showHolidayConflicts();
}

const observer = new MutationObserver(enhanceRecurringSchedules);
observer.observe(document.querySelector('#app'), { childList: true, subtree: true });

enhanceRecurringSchedules();
