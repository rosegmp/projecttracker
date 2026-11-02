const dateLabel = document.getElementById('today-date');
if (dateLabel) dateLabel.textContent = new Intl.DateTimeFormat('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' }).format(new Date());

const viewButtons = document.querySelectorAll('[data-view]');
const mapCanvas = document.querySelector('.map-canvas');
const mapList = document.querySelector('.map-list');
viewButtons.forEach((button) => button.addEventListener('click', () => {
  const listMode = button.dataset.view === 'list';
  mapCanvas.hidden = listMode;
  mapList.hidden = !listMode;
  viewButtons.forEach((item) => {
    const active = item === button;
    item.classList.toggle('active', active);
    item.setAttribute('aria-pressed', String(active));
  });
}));

const search = document.getElementById('dashboard-search');
const searchableRows = [...document.querySelectorAll('.project-row,.document-list a,.activity-list > div')];
search?.addEventListener('input', () => {
  const query = search.value.trim().toLowerCase();
  searchableRows.forEach((row) => { row.hidden = Boolean(query) && !row.textContent.toLowerCase().includes(query); });
});

const map = document.querySelector('.map-canvas');
let zoom = 100;
document.querySelectorAll('.map-controls button').forEach((button) => button.addEventListener('click', () => {
  zoom = Math.min(140, Math.max(100, zoom + (button.textContent.trim() === '+' ? 10 : -10)));
  map.style.backgroundSize = `${zoom}% auto`;
}));
