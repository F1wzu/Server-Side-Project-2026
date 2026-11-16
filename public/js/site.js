// Small progressive enhancements. Every page works without this file.

// One polite live region for messages that appear after the page has loaded.
const live = document.createElement('div');
live.className = 'sr-only';
live.setAttribute('role', 'status');
document.body.append(live);
const announce = (message) => {
  live.textContent = '';
  setTimeout(() => {
    live.textContent = message;
  }, 100);
};

// Mobile menu.
const menu = document.querySelector('[data-menu]');
const setMenu = (expanded) => {
  menu.setAttribute('aria-expanded', String(expanded));
  menu.setAttribute('aria-label', expanded ? 'ปิดเมนู' : 'เปิดเมนู');
  document.getElementById('site-nav')?.classList.toggle('open', expanded);
};
menu?.addEventListener('click', () => setMenu(menu.getAttribute('aria-expanded') !== 'true'));
// Escape closes the open menu. Focus goes back to its button only when focus was
// inside the menu (or on the button), so keyboard users are never left inside a panel
// they cannot dismiss, without yanking focus away from wherever it already is.
document.addEventListener('keydown', (event) => {
  if (event.key !== 'Escape' || !menu || menu.getAttribute('aria-expanded') !== 'true') return;
  // Read focus before closing: hiding the panel can drop focus to the body.
  const focusInMenu = document.getElementById('site-nav')?.contains(document.activeElement) || document.activeElement === menu;
  setMenu(false);
  if (focusInMenu) menu.focus();
});

// A broken image becomes a neutral placeholder instead of a broken-image icon.
// A place photo first falls back to its category's illustration (for
// example a photo saved on another computer before cloud storage was used).
const replaceBroken = (img) => {
  const fallback = img.dataset.fallback;
  if (fallback && img.getAttribute('src') !== fallback) {
    img.alt = '';
    img.src = fallback;
    return;
  }
  const placeholder = document.createElement('span');
  placeholder.className = 'image-placeholder';
  placeholder.textContent = 'ยังไม่สามารถแสดงภาพได้';
  img.replaceWith(placeholder);
};
document.querySelectorAll('img').forEach((img) => {
  // An image can fail before this deferred script runs; its error event is gone.
  // (An SVG without width/height can load fine yet report naturalWidth 0, so those are skipped.)
  const src = img.getAttribute('src') || '';
  if (src && !src.endsWith('.svg') && img.complete && img.naturalWidth === 0) replaceBroken(img);
  // Not `once`: after a switch to the fallback, a failing fallback still ends as the placeholder.
  img.addEventListener('error', () => replaceBroken(img));
});

// Opening-hours editor: time inputs are only active on days marked "open".
document.querySelectorAll('[data-hours-day]').forEach((row) => {
  const state = row.querySelector('[data-hours-state]');
  const update = () => {
    const open = state.value === 'open';
    row.querySelectorAll('[data-hours-time]').forEach((input) => {
      input.disabled = !open;
      input.required = open;
    });
    row.querySelector('[data-hours-next]').disabled = !open;
  };
  state.addEventListener('change', update);
  update();
});

// A live region that arrives with the page is often not announced, so the flash notice
// is repeated through the shared region once the page has settled.
const flash = document.querySelector('[data-flash]');
if (flash) {
  flash.removeAttribute('role');
  setTimeout(() => announce(flash.textContent.trim()), 250);
  // A success message ("เข้าสู่ระบบแล้ว") has done its job once read, so it
  // fades away after a few seconds. Errors stay until the member leaves the
  // page, since they may need them to fix something. The timer waits while
  // the pointer rests on the message, so a slow reader keeps it.
  if (!flash.classList.contains('notice-error')) {
    const box = flash.parentElement; // the .container wrapper around the message
    let timer;
    const start = () => {
      timer = setTimeout(() => {
        flash.classList.add('is-leaving');
        // Removed on a timer matching the 0.4s fade, not on transitionend,
        // which never fires in a background tab or with reduced motion.
        setTimeout(() => box.remove(), matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 450);
      }, 5000);
    };
    flash.addEventListener('mouseenter', () => clearTimeout(timer));
    flash.addEventListener('mouseleave', start);
    start();
  }
}

// Send focus to a server-rendered form error and tie it to the field that failed.
const formError = document.querySelector('.form-error[tabindex="-1"]');
if (formError) {
  formError.focus();
  const form = [...document.forms].find(
    (candidate) => formError.compareDocumentPosition(candidate) & Node.DOCUMENT_POSITION_FOLLOWING
  );
  const field = formError.dataset.field && form?.elements.namedItem(formError.dataset.field);
  if (field instanceof Element) {
    field.setAttribute('aria-invalid', 'true');
    const describedBy = [field.getAttribute('aria-describedby'), formError.id];
    field.setAttribute('aria-describedby', describedBy.filter(Boolean).join(' '));
  }
}

// Save or remove a favourite through the JSON API without reloading the page:
// PUT and DELETE /api/v1/me/favorites/:placeId. If the request fails for any reason the
// ordinary form post takes over, so the action is never lost.
document.querySelectorAll('form[data-favorite]').forEach((form) => {
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const action = form.elements.namedItem('action');
    const saving = action.value === 'save';
    const button = form.querySelector('button');
    button.disabled = true;
    try {
      const response = await fetch('/api/v1/me/favorites/' + form.dataset.place, {
        method: saving ? 'PUT' : 'DELETE',
        headers: { 'X-CSRF-Token': form.elements.namedItem('_csrf').value },
        credentials: 'same-origin',
      });
      if (!response.ok) throw new Error('favorite request failed: ' + response.status);
      // The same place can be in several cards on one page, and each card's heart
      // (and the place page's button) must show the new state, not only the one clicked.
      const sameForms = [...document.querySelectorAll('form[data-favorite]')].filter((other) => other.dataset.place === form.dataset.place);
      for (const other of sameForms) {
        other.elements.namedItem('action').value = saving ? 'remove' : 'save';
        const otherButton = other.querySelector('button');
        // Only the place page's text button swaps styles; the card heart is
        // styled from aria-pressed and must not pick up the big button colours.
        if (otherButton.classList.contains('button')) {
          otherButton.classList.toggle('button-primary', saving);
          otherButton.classList.toggle('button-outline', !saving);
        }
        otherButton.setAttribute('aria-pressed', String(saving));
        // The place page has a visible text label. The heart on a card has only an
        // icon; its aria-label stays "บันทึก <name>" and aria-pressed carries the state.
        const label = other.querySelector('[data-favorite-label]');
        if (label) label.textContent = saving ? 'บันทึกแล้ว' : 'บันทึกสถานที่';
      }
      announce(saving ? 'บันทึกสถานที่แล้ว' : 'นำออกจากรายการที่บันทึกแล้ว');
      button.disabled = false;
    } catch {
      HTMLFormElement.prototype.submit.call(form);
    }
  });
});

// Place photo gallery. Without JavaScript the strip still swipes and the
// thumbnails are plain #photo-n links; here a thumbnail scrolls only the
// strip (not the whole page) and the thumbnail of the photo in view is marked.
document.querySelectorAll('[data-gallery]').forEach((gallery) => {
  const strip = gallery.querySelector('[data-gallery-strip]');
  const thumbs = [...gallery.querySelectorAll('[data-gallery-thumb]')];
  const mark = (index) => thumbs.forEach((thumb, i) => (i === index ? thumb.setAttribute('aria-current', 'true') : thumb.removeAttribute('aria-current')));
  thumbs.forEach((thumb, index) => {
    thumb.addEventListener('click', (event) => {
      event.preventDefault();
      strip.scrollTo({ left: strip.clientWidth * index, behavior: 'smooth' });
      mark(index);
    });
  });
  let timer;
  strip.addEventListener('scroll', () => {
    // A hidden strip (clientWidth 0) would divide by zero and mark no thumb at all.
    if (!strip.clientWidth) return;
    clearTimeout(timer);
    timer = setTimeout(() => mark(Math.round(strip.scrollLeft / strip.clientWidth)), 80);
  });
});

// A file input that takes several photos warns as soon as too many are
// picked, instead of after a slow upload. The server still enforces the
// limit; this only saves the member a wasted upload.
document.querySelectorAll('input[type="file"][data-max-files]').forEach((input) => {
  input.addEventListener('change', () => {
    const max = Number(input.dataset.maxFiles);
    input.setCustomValidity(input.files.length > max ? `แนบรูปได้ไม่เกิน ${max} รูป` : '');
    input.reportValidity();
  });
});

// Two guards on every ordinary form.
// 1. A form marked data-confirm deletes something for good, so it asks first.
//    (Without JavaScript the button still works; it just does not ask.)
// 2. A form that is already on its way is not sent a second time by a double
//    tap, which matters most on a slow connection.
// This runs after the page's other submit handlers (the map's pin check, the
// heart button), so a submit they cancelled is left alone.
document.addEventListener('submit', (event) => {
  const form = event.target;
  if (!(form instanceof HTMLFormElement) || event.defaultPrevented) return;
  if (form.method.toLowerCase() !== 'post') return;
  if (form.getAttribute('aria-busy') === 'true') {
    event.preventDefault();
    return;
  }
  if (form.dataset.confirm && !window.confirm(form.dataset.confirm)) {
    event.preventDefault();
    return;
  }
  // Marked, not disabled: a disabled submit button would drop its own
  // name=value from the request the browser is about to send.
  form.setAttribute('aria-busy', 'true');
  // If the request never leaves the page (the connection dropped), let the
  // member try again instead of leaving the form stuck.
  setTimeout(() => form.removeAttribute('aria-busy'), 10000);
});
// Coming back with the Back button restores the page from memory with the
// mark still on it; clear it so the form can be sent again.
window.addEventListener('pageshow', () => {
  document.querySelectorAll('form[aria-busy="true"]').forEach((form) => form.removeAttribute('aria-busy'));
});

// On a phone a long search form would fill the first screen and hide the
// results, so it folds behind a button. It starts open when a search is in
// use (so the member sees what is filtering the list) and on wider screens
// the button is hidden by CSS and the form always shows.
document.querySelectorAll('form[data-collapsible]').forEach((panel, index) => {
  if (!panel.id) panel.id = 'filter-panel-' + index;
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'button button-outline filter-toggle';
  button.setAttribute('aria-controls', panel.id);
  const set = (open) => {
    panel.classList.toggle('is-collapsed', !open);
    button.setAttribute('aria-expanded', String(open));
    button.textContent = open ? 'ซ่อนตัวกรอง' : panel.dataset.collapsible || 'ค้นหาและกรอง';
  };
  button.addEventListener('click', () => set(button.getAttribute('aria-expanded') !== 'true'));
  panel.before(button);
  set(panel.hasAttribute('data-active'));
});

// Review order and star filter on a place page: choosing an option applies it
// at once. Without JavaScript the "แสดง" button does the same.
document.querySelectorAll('form.review-filter select').forEach((select) =>
  select.addEventListener('change', () => select.form.requestSubmit())
);

// A textarea with a length limit shows how much room is left, so a long
// review is not cut off by surprise. The count is announced to screen
// readers only near the limit; announcing every keystroke would be noise.
document.querySelectorAll('textarea[maxlength]').forEach((area) => {
  const max = Number(area.getAttribute('maxlength'));
  if (!max) return;
  const counter = document.createElement('small');
  counter.className = 'char-count';
  const update = () => {
    const used = area.value.length;
    counter.textContent = `${used.toLocaleString('th-TH')} / ${max.toLocaleString('th-TH')} ตัวอักษร`;
    const near = max - used <= Math.max(20, max * 0.05);
    counter.classList.toggle('is-near', near);
    if (near) counter.setAttribute('aria-live', 'polite');
    else counter.removeAttribute('aria-live');
  };
  area.addEventListener('input', update);
  area.after(counter);
  update();
});

// Photos picked for upload are shown as thumbnails before the form is sent,
// so a member can see what they chose (and which one comes first and becomes
// the cover) without waiting for the upload. Read as data: URLs, which the
// page's image policy already allows; nothing leaves the browser here.
document.querySelectorAll('input[type="file"][accept*="image"]').forEach((input) => {
  const list = document.createElement('ul');
  list.className = 'photo-preview';
  list.hidden = true;
  list.setAttribute('aria-label', 'รูปที่เลือกไว้ ยังไม่ได้อัปโหลด');
  input.after(list);
  input.addEventListener('change', () => {
    list.replaceChildren();
    const files = [...input.files].filter((file) => file.type.startsWith('image/'));
    list.hidden = files.length === 0;
    files.forEach((file, index) => {
      const item = document.createElement('li');
      const img = document.createElement('img');
      img.alt = `รูปที่เลือก ${index + 1}: ${file.name}`;
      const reader = new FileReader();
      reader.addEventListener('load', () => (img.src = reader.result));
      reader.readAsDataURL(file);
      item.append(img);
      // Same 5 MB limit the server enforces: say so now, not after the upload.
      const tooBig = file.size > 5 * 1024 * 1024;
      // data-cover-first: on this form the first photo becomes the cover.
      if ((input.hasAttribute('data-cover-first') && index === 0) || tooBig) {
        const tag = document.createElement('span');
        tag.className = tooBig ? 'photo-preview-tag is-error' : 'photo-preview-tag';
        tag.textContent = tooBig ? 'เกิน 5 MB' : 'รูปหลัก';
        item.append(tag);
      }
      list.append(item);
    });
    announce(files.length ? `เลือกรูปไว้ ${files.length} รูป` : '');
  });
});
