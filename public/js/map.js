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
  // On a phone a finger resting on a map would move the map instead of
  // scrolling the page, trapping the reader on it. So there one finger scrolls
  // the page and two fingers move and zoom the map (taps and dragging a pin
  // still work), and a short line under the map says so.
  const touch = L.Browser.mobile;
  const touchOptions = touch ? { dragging: false } : {};
  const touchHint = (element) => {
    if (!touch) return;
    const hint = document.createElement('p');
    hint.className = 'map-touch-hint';
    hint.textContent = 'ใช้สองนิ้วเพื่อเลื่อนและซูมแผนที่';
    element.after(hint);
  };
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
    const map = L.map(element, { zoomControl: false, scrollWheelZoom: false, ...touchOptions }).setView(position, 16);
    touchHint(element);
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
    // Half-step zoom so the district can fill the picker snugly, and no
    // zooming out past the district's surroundings. The picker sits in the
    // middle of a long form, so the mouse wheel only zooms once the member
    // has clicked the map; until then, and again after the pointer leaves
    // it, the wheel scrolls the page past it.
    const map = L.map(element, { maxBounds: area.pad(0.3), minZoom: 10, zoomSnap: 0.5, scrollWheelZoom: false, ...touchOptions });
    touchHint(element);
    if (!touch) {
      map.on('mousedown focus', () => map.scrollWheelZoom.enable());
      element.addEventListener('mouseleave', () => map.scrollWheelZoom.disable());
      const hint = document.createElement('p');
      hint.className = 'map-touch-hint';
      hint.textContent = 'คลิกที่แผนที่ก่อน แล้วเลื่อนลูกกลิ้งเมาส์เพื่อซูม';
      element.after(hint);
    }
    tiles().addTo(map);
    // The district's real border, so a member sees where a pin is accepted
    // (the server checks the same shape). Falls back to the rectangle.
    const boundary = element.dataset.boundary ? JSON.parse(element.dataset.boundary) : null;
    const outline = boundary
      ? L.polygon(boundary, { color: '#f97316', weight: 4, opacity: 0.9, fillColor: '#f97316', fillOpacity: 0.05, interactive: false })
      : L.rectangle(area, { color: '#f97316', weight: 4, opacity: 0.9, fill: false, interactive: false });
    outline.addTo(map);
    // Start with the whole district in view, at any picker width. The fit
    // waits a frame and re-measures the map, which can be sized before the
    // page has finished its layout (that made it start far too zoomed out).
    const fitDistrict = () => {
      map.invalidateSize({ animate: false });
      map.fitBounds(outline.getBounds(), { padding: [8, 8], animate: false });
    };
    map.setView(outline.getBounds().getCenter(), 12);
    let touched = false;
    map.on('dragstart', () => {
      touched = true;
    });
    requestAnimationFrame(() => {
      if (!marker) fitDistrict();
    });
    // The picker can change size after load (fonts, phone layout); keep the
    // district fitted until the member pins or moves the map themself.
    if ('ResizeObserver' in window) {
      new ResizeObserver(() => {
        if (!marker && !touched) fitDistrict();
      }).observe(element);
    }
    // Tell the member straight away when a tap lands outside the border;
    // the server refuses such a pin anyway.
    const inside = (latlng) => {
      if (!boundary) return area.contains(latlng);
      let result = false;
      for (let i = 0, j = boundary.length - 1; i < boundary.length; j = i, i += 1) {
        const [latI, lngI] = boundary[i];
        const [latJ, lngJ] = boundary[j];
        if (latI > latlng.lat !== latJ > latlng.lat && latlng.lng < ((lngJ - lngI) * (latlng.lat - latI)) / (latJ - latI) + lngI) result = !result;
      }
      return result;
    };
    const warning = document.createElement('p');
    warning.className = 'field-error';
    warning.setAttribute('role', 'status');
    warning.hidden = true;
    const OUTSIDE_TEXT = 'ตำแหน่งนี้อยู่นอกเขตลาดกระบัง กรุณาปักหมุดภายในเส้นสีส้ม';
    warning.textContent = OUTSIDE_TEXT;
    element.after(warning);
    const check = (latlng) => {
      warning.hidden = inside(latlng);
      warning.textContent = OUTSIDE_TEXT;
      if (warning.hidden) element.classList.remove('is-invalid');
    };

    let marker = null;
    const fix = (value) => Number(value).toFixed(6);
    function place(latlng, { pan = false } = {}) {
      if (!marker) {
        marker = L.marker(latlng, { icon: pin(element.dataset.kind || 'other', true), draggable: true, keyboard: false }).addTo(map);
        marker.on('dragend', () => {
          write(marker.getLatLng());
          check(marker.getLatLng());
        });
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
      check(event.latlng);
    });
    [latInput, lngInput].forEach((input) =>
      input.addEventListener('input', () => {
        const latlng = read();
        if (latlng) {
          place(latlng, { pan: true });
          check(latlng);
        }
      })
    );
    // Stop the form before it is sent when the pin is outside the border:
    // the member keeps everything they typed and sees why at once, instead
    // of a round trip that only says so after the upload. An empty pin is
    // left to the server (an admin may save a place without one).
    form.addEventListener('submit', (event) => {
      const latlng = read();
      if (!latlng || inside(latlng)) return;
      event.preventDefault();
      warning.hidden = false;
      warning.textContent = 'ยังส่งไม่ได้: หมุดอยู่นอกเขตลาดกระบัง กรุณาย้ายหมุดให้อยู่ภายในเส้นสีส้มก่อนส่ง';
      element.classList.add('is-invalid');
      element.scrollIntoView({ behavior: 'smooth', block: 'center' });
      // Show the pin and the whole border together, so it is clear which way to move it.
      map.fitBounds(outline.getBounds().extend(latlng), { padding: [16, 16], animate: false });
      latInput.focus({ preventScroll: true });
    });
  });

  // District map: markers come from the JSON API, the list beside it is server-rendered.
  const page = document.querySelector('[data-map-page]');
  if (!page) return;
  const status = page.querySelector('[data-map-status]');
  const empty = page.querySelector('[data-map-empty]');
  const items = new Map(
    [...page.querySelectorAll('[data-map-item]')].map((item) => [item.dataset.mapItem, item])
  );
  const canvas = page.querySelector('[data-map-canvas]');
  const map = L.map(canvas, touchOptions).setView([13.7245, 100.765], 13);
  touchHint(canvas);
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
      if (data.length) {
        // Re-measure first: the map can be created before the page has its
        // final width, and a fit against the old size left pins cut off at
        // the edge. The top padding is larger because a pin stands above its point.
        map.invalidateSize({ animate: false });
        map.fitBounds(
          data.map((place) => [place.latitude, place.longitude]),
          { paddingTopLeft: [28, 48], paddingBottomRight: [28, 20], maxZoom: 15, animate: false }
        );
      } else {
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
