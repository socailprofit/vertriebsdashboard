// Delegated activation survives chart rerenders; values are inserted as text.
export function installChartPopover() {
  const popup = document.createElement('aside');
  popup.className = 'chart-popover';
  popup.hidden = true;
  popup.setAttribute('role', 'dialog');
  popup.setAttribute('aria-label', 'Werte zum ausgewählten Zeitpunkt');
  document.body.append(popup);
  let trigger = null;
  function close(restoreFocus = false) {
    popup.hidden = true;
    if (restoreFocus && trigger?.isConnected) trigger.focus();
    trigger = null;
  }
  function open(target, event) {
    let point;
    try { point = JSON.parse(target.dataset.chartPoint); } catch { return; }
    trigger = target;
    popup.replaceChildren();
    const closeButton = document.createElement('button');
    closeButton.type = 'button';
    closeButton.className = 'chart-popover-close';
    closeButton.textContent = '×';
    closeButton.setAttribute('aria-label', 'Werte schließen');
    closeButton.addEventListener('click', () => close(true));
    const heading = document.createElement('strong');
    heading.textContent = target.closest('.chart-card')?.querySelector('h3')?.textContent || point.title;
    const time = document.createElement('p');
    time.className = 'chart-popover-time';
    time.textContent = point.time;
    const list = document.createElement('dl');
    for (const row of point.rows) {
      const label = document.createElement('dt');
      label.textContent = row.label;
      const value = document.createElement('dd');
      value.textContent = row.value;
      list.append(label, value);
    }
    const note = document.createElement('small');
    note.textContent = point.note;
    popup.append(closeButton, heading, time, list, note);
    popup.hidden = false;
    const bounds = target.getBoundingClientRect();
    const x = event.detail ? event.clientX : bounds.x + bounds.width / 2;
    const y = event.detail ? event.clientY : bounds.y + bounds.height / 2;
    const size = popup.getBoundingClientRect();
    popup.style.left = `${Math.max(12, Math.min(x + 12, innerWidth - size.width - 12))}px`;
    popup.style.top = `${Math.max(12, Math.min(y + 12, innerHeight - size.height - 12))}px`;
    if (event.type === 'keydown') closeButton.focus();
  }
  document.addEventListener('click', (event) => {
    const target = event.target.closest?.('[data-chart-point]');
    if (target) open(target, event);
    else if (!popup.contains(event.target)) close();
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') close(true);
    const target = event.target.closest?.('[data-chart-point]');
    if (target && (event.key === 'Enter' || event.key === ' ')) {
      event.preventDefault();
      open(target, event);
    }
  });
  document.addEventListener('dashboard-private-reset', () => { close(); popup.replaceChildren(); });
  window.addEventListener('resize', () => close());
  window.addEventListener('scroll', (event) => {
    if (!popup.contains(event.target)) close();
  }, true);
}
