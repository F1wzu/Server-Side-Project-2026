// Leaflet maps: a small one on each place page and the district map at /map.
// Tiles are © OpenStreetMap contributors. Loaded only on pages that include a map.
(() => {
  const L = window.L;
  if (!L) return;

  const tiles = () =>
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution:
        '&copy; ผู้ร่วมสร้าง <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a>',
      // The site sends no referrer to other origins; the tile server asks for one.
      referrerPolicy: 'strict-origin-when-cross-origin',
    });
  const pin = (kind, active = false) =>
    L.divIcon({
      className: '',
      html: `<span class="map-pin tone-${kind}${active ? ' is-active' : ''}"></span>`,
      iconSize: [30, 30],
      iconAnchor: [15, 34],
      popupAnchor: [0, -34],
    });

  // Place page: one fixed marker.
  document.querySelectorAll('[data-map-mini]').forEach((element) => {
    const position = [Number(element.dataset.lat), Number(element.dataset.lng)];
    const map = L.map(element, { zoomControl: false, scrollWheelZoom: false }).setView(position, 16);
    tiles().addTo(map);
    L.marker(position, { icon: pin(element.dataset.kind), keyboard: false }).addTo(map);
  });

  // Pin picker on the submission form: tap the map or drag the pin, and the
  // latitude and longitude boxes fill in. Typing in the boxes moves the pin.
  // Without JavaScript the boxes are still there and work on their own.
  document.querySelectorAll('[data-map-picker]').forEach((element) => {
    const form = element.closest('form');
    const latInput = form.elements.namedItem('latitude');
    const lngInput = form.elements.namedItem('longitude');
    const bounds = JSON.parse(element.dataset.bounds);
    const area = L.latLngBounds([bounds.minLat, bounds.minLng], [bounds.maxLat, bounds.maxLng]);
    const map = L.map(element, { maxBounds: area.pad(0.2) }).setView([13.7245, 100.765], 13);
    tiles().addTo(map);
    // The allowed area, so a member sees where a pin is accepted.
    L.rectangle(area, { color: '#0e5a52', weight: 1, fill: false, dashArray: '4 6', interactive: false }).addTo(map);

    let marker = null;
    const fix = (value) => Number(value).toFixed(6);
    function place(latlng, { pan = false } = {}) {
      if (!marker) {
        marker = L.marker(latlng, { icon: pin(element.dataset.kind || 'other', true), draggable: true, keyboard: false }).addTo(map);
        marker.on('dragend', () => write(marker.getLatLng()));
      } else marker.setLatLng(latlng);
      if (pan) map.setView(latlng, Math.max(map.getZoom(), 16));
    }
    function write(latlng) {
      latInput.value = fix(latlng.lat);
      lngInput.value = fix(latlng.lng);
      latInput.dispatchEvent(new Event('change', { bubbles: true }));
    }
    const read = () => {
      const lat = Number(latInput.value);
      const lng = Number(lngInput.value);
      return latInput.value !== '' && lngInput.value !== '' && Number.isFinite(lat) && Number.isFinite(lng) ? L.latLng(lat, lng) : null;
    };

    const start = read();
    if (start) place(start, { pan: true });
    map.on('click', (event) => {
      place(event.latlng);
      write(event.latlng);
    });
    [latInput, lngInput].forEach((input) =>
      input.addEventListener('input', () => {
        const latlng = read();
        if (latlng) place(latlng, { pan: true });
      })
    );
  });

  // District map: markers come from the JSON API, the list beside it is server-rendered.
  const page = document.querySelector('[data-map-page]');
  if (!page) return;
  const status = page.querySelector('[data-map-status]');
  const empty = page.querySelector('[data-map-empty]');
  const items = new Map(
    [...page.querySelectorAll('[data-map-item]')].map((item) => [item.dataset.mapItem, item])
  );
  const map = L.map(page.querySelector('[data-map-canvas]')).setView([13.7245, 100.765], 13);
  tiles().addTo(map);
  const markers = new Map();
  let activeId = null;

  const kindOf = (id) => items.get(id)?.dataset.kind || 'other';
  function popup(place) {
    const box = document.createElement('div');
    box.className = 'map-popup';
    const name = document.createElement('strong');
    name.textContent = place.name;
    const category = document.createElement('span');
    category.textContent = place.category.name;
    const link = document.createElement('a');
    link.href = '/places/' + place.id;
    link.textContent = 'ดูรายละเอียด';
    box.append(name, category, document.createElement('br'), link);
    return box;
  }
  function activate(id, { pan = false } = {}) {
    if (activeId && markers.has(activeId)) {
      markers.get(activeId).marker.setIcon(pin(kindOf(activeId)));
      items.get(activeId)?.classList.remove('is-active');
    }
    activeId = id;
    const entry = markers.get(id);
    if (!entry) return;
    entry.marker.setIcon(pin(kindOf(id), true));
    const item = items.get(id);
    item?.classList.add('is-active');
    if (pan) {
      map.setView(entry.marker.getLatLng(), Math.max(map.getZoom(), 16));
      entry.marker.openPopup();
    } else item?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }
  function applyFilter(filter) {
    let visible = 0;
    for (const [id, { marker, place }] of markers) {
      const show =
        filter === 'all' ||
        (filter === 'open' && place.openStatus?.state === 'open') ||
        filter === 'category-' + place.category.id;
      if (show) marker.addTo(map);
      else marker.remove();
      const item = items.get(id);
      if (item) item.hidden = !show;
      if (show) visible++;
    }
    empty.hidden = visible > 0;
    page.querySelectorAll('[data-map-filter]').forEach((chip) => {
      const on = chip.dataset.mapFilter === filter;
      chip.classList.toggle('is-active', on);
      chip.setAttribute('aria-pressed', String(on));
    });
  }

  fetch(page.dataset.endpoint, { headers: { Accept: 'application/json' } })
    .then((response) => (response.ok ? response.json() : Promise.reject(response.status)))
    .then(({ data }) => {
      status.hidden = true;
      for (const place of data) {
        const id = String(place.id);
        const marker = L.marker([place.latitude, place.longitude], {
          icon: pin(kindOf(id)),
          title: place.name,
          alt: place.name,
        })
          .bindPopup(popup(place))
          .addTo(map);
        marker.on('click', () => activate(id));
        markers.set(id, { marker, place });
      }
      if (data.length)
        map.fitBounds(
          data.map((place) => [place.latitude, place.longitude]),
          { padding: [40, 40], maxZoom: 15 }
        );
      else {
        status.hidden = false;
        status.textContent = 'ยังไม่มีสถานที่ที่มีพิกัดยืนยันแล้ว';
      }
    })
    .catch(() => {
      status.hidden = false;
      status.textContent = 'โหลดข้อมูลแผนที่ไม่สำเร็จ ลองเปิดหน้านี้ใหม่อีกครั้ง';
    });

  page.querySelectorAll('[data-map-focus]').forEach((button) =>
    button.addEventListener('click', () => activate(button.dataset.mapFocus, { pan: true }))
  );
  page.querySelectorAll('[data-map-filter]').forEach((chip) =>
    chip.addEventListener('click', () => applyFilter(chip.dataset.mapFilter))
  );
})();
