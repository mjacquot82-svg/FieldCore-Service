function ensureSidebarDock() {
  const sidebar = document.querySelector('.sidebar');
  if (!sidebar) return null;

  let dock = sidebar.querySelector('[data-sidebar-dock]');
  if (!dock) {
    dock = document.createElement('section');
    dock.className = 'sidebar-dock';
    dock.setAttribute('data-sidebar-dock', 'true');
    dock.innerHTML = '<h2>Notifications</h2><div class="sidebar-dock-items"></div>';
    sidebar.appendChild(dock);
  }

  return dock.querySelector('.sidebar-dock-items');
}

function moveUtilityBannersToSidebar() {
  const dockItems = ensureSidebarDock();
  if (!dockItems) return;

  const banners = document.querySelectorAll('main.content > .session-banner, main.content > .overdue-alert');
  banners.forEach((banner) => {
    if (banner.closest('[data-sidebar-dock]')) return;
    banner.classList.add('sidebar-dock-card');
    dockItems.appendChild(banner);
  });

  const dock = dockItems.closest('[data-sidebar-dock]');
  if (dock) dock.hidden = dockItems.children.length === 0;
}

function startSidebarNotificationDock() {
  const app = document.querySelector('#app');
  if (!app) return;

  const observer = new MutationObserver(() => {
    window.requestAnimationFrame(moveUtilityBannersToSidebar);
  });

  observer.observe(app, { childList: true, subtree: true });
  moveUtilityBannersToSidebar();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', startSidebarNotificationDock);
} else {
  startSidebarNotificationDock();
}
