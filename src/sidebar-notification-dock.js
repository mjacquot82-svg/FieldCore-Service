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

  document.querySelectorAll('main.content > .session-banner, main.content > .overdue-alert').forEach((banner) => {
    banner.classList.add('sidebar-dock-card');
    dockItems.appendChild(banner);
  });

  const hasItems = dockItems.children.length > 0;
  const dock = dockItems.closest('[data-sidebar-dock]');
  if (dock) dock.hidden = !hasItems;
}

const observer = new MutationObserver(moveUtilityBannersToSidebar);
observer.observe(document.querySelector('#app'), { childList: true, subtree: true });
moveUtilityBannersToSidebar();
