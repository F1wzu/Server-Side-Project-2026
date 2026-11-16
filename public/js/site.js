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

// Opening-hours editor: time inputs are only active on days marked "open",
// and a note says plainly when the times mean midnight, past midnight or
// 24 hours (the same wording as hoursNote in partials/place-fields.ejs).
document.querySelectorAll('[data-hours-day]').forEach((row) => {
  const state = row.querySelector('[data-hours-state]');
  const [opens, closes] = row.querySelectorAll('[data-hours-time]');
  const note = row.querySelector('[data-hours-note]');
  const noteText = () => {
    if (state.value !== 'open' || !opens.value || !closes.value) return '';
    if (opens.value === closes.value) return 'เปิด 24 ชั่วโมง';
    if (closes.value === '00:00') return 'ปิดตอนเที่ยงคืน';
    return closes.value < opens.value ? 'ปิดหลังเที่ยงคืน' : '';
  };
  const update = () => {
    const open = state.value === 'open';
    [opens, closes].forEach((input) => {
      input.disabled = !open;
      input.required = open;
    });
    if (note && note.textContent !== noteText()) note.textContent = noteText();
  };
  [state, opens, closes].forEach((control) => control.addEventListener('change', update));
  [opens, closes].forEach((input) => input.addEventListener('input', update));
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

// Photo picker on the submission form. The member can pick photos in several
// rounds (each round adds to the list instead of replacing it), remove any
// photo, and change the order; the first one is the cover. On the edit form
// the photos already attached join the same list, so they can be kept,
// removed or moved too. The chosen new files are put back into the file
// input in order, and a hidden `photoOrder` field tells the server how the
// kept and new photos are arranged. Without JavaScript (or without
// DataTransfer, needed to set input.files) the plain file input stays.
document.querySelectorAll('[data-photo-picker]').forEach((picker) => {
  const input = picker.closest('.field')?.querySelector('input[type="file"]');
  if (!input || typeof DataTransfer !== 'function') return;
  try {
    new DataTransfer();
  } catch {
    return;
  }
  input.dataset.pickerReady = '';
  const max = Number(picker.dataset.max) || 5;
  const MAX_BYTES = 5 * 1024 * 1024;
  const TYPES = ['image/jpeg', 'image/png', 'image/webp'];

  // Each item: { kind: 'keep', index, src } or { kind: 'new', file, src }.
  const items = [...picker.querySelectorAll('[data-current-photos] li[data-src]')].map((li, index) => ({ kind: 'keep', index, src: li.dataset.src }));
  picker.querySelector('[data-current-photos]')?.remove();
  picker.querySelector('[data-nojs-note]')?.remove();

  const order = document.createElement('input');
  order.type = 'hidden';
  order.name = 'photoOrder';
  input.form?.append(order);

  // The real input stays in the form (it carries the files) but is hidden;
  // the "add" tile opens it.
  // (hidden, not visually-hidden: a hidden input is still sent with the form
  // and click() still opens the file dialog.)
  input.hidden = true;

  const list = document.createElement('ol');
  list.className = 'photo-picker-list';
  list.setAttribute('aria-label', 'รูปที่จะแนบ เรียงตามลำดับ รูปแรกเป็นรูปหลัก');
  const message = document.createElement('p');
  message.className = 'photo-picker-message';
  message.hidden = true;
  picker.append(list, message);

  const say = (text, isError = false) => {
    message.textContent = text;
    message.hidden = !text;
    message.classList.toggle('is-error', isError);
    if (text) announce(text);
  };

  const button = (label, text, onClick, className) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'photo-picker-btn ' + className;
    b.setAttribute('aria-label', label);
    b.title = label;
    b.textContent = text;
    b.addEventListener('click', onClick);
    return b;
  };

  // Puts the new files back into the input in their chosen order and writes
  // photoOrder ("keep:0,new:1,...").
  const sync = () => {
    const transfer = new DataTransfer();
    const tokens = items.map((item) => {
      if (item.kind === 'keep') return `keep:${item.index}`;
      transfer.items.add(item.file);
      return `new:${transfer.files.length - 1}`;
    });
    input.files = transfer.files;
    order.value = tokens.join(',');
  };

  const addTile = document.createElement('button');
  addTile.type = 'button';
  addTile.className = 'photo-picker-add';
  addTile.innerHTML = '<span class="photo-picker-add-plus" aria-hidden="true">+</span><span>เพิ่มรูป</span><small class="photo-picker-add-count"></small>';
  addTile.addEventListener('click', () => input.click());
  // The field's label and hint now belong to the add button, the control the member uses.
  addTile.id = input.id + '-add';
  const label = input.id && document.querySelector(`label[for="${input.id}"]`);
  if (label) label.htmlFor = addTile.id;
  if (input.getAttribute('aria-describedby')) addTile.setAttribute('aria-describedby', input.getAttribute('aria-describedby'));

  let dragFrom = null;

  const move = (from, to, focusSelector) => {
    if (to < 0 || to >= items.length || from === to) return;
    const [item] = items.splice(from, 1);
    items.splice(to, 0, item);
    render();
    const target = list.children[to]?.querySelector(focusSelector);
    (target && !target.disabled ? target : list.children[to]?.querySelector('.is-remove'))?.focus();
    announce(to === 0 ? 'ตั้งเป็นรูปหลักแล้ว' : `ย้ายไปเป็นรูปที่ ${to + 1}`);
  };

  function render() {
    list.replaceChildren();
    items.forEach((item, index) => {
      const li = document.createElement('li');
      li.className = 'photo-picker-item';
      li.draggable = true;
      const img = document.createElement('img');
      if (item.src) img.src = item.src;
      img.alt = index === 0 ? 'รูปหลัก' : `รูปที่ ${index + 1}`;
      // Two plain choices per photo: remove it, or make it the cover. The
      // order of the other photos matters little, so it has no buttons of its
      // own (a mouse can still drag tiles to reorder them).
      li.append(img);
      if (index === 0) {
        const tag = document.createElement('span');
        tag.className = 'photo-picker-tag is-cover';
        tag.textContent = 'รูปหลัก';
        li.append(tag);
      } else {
        const cover = button(`ตั้งรูปที่ ${index + 1} เป็นรูปหลัก`, 'ตั้งเป็นรูปหลัก', () => move(index, 0, '.is-remove'), 'is-cover-btn');
        li.append(cover);
      }
      const remove = button(`ลบรูปที่ ${index + 1}`, '×', () => {
        items.splice(index, 1);
        render();
        say('');
        announce('ลบรูปแล้ว');
        (list.children[Math.min(index, items.length - 1)]?.querySelector('.is-remove') || addTile).focus();
      }, 'is-remove');
      li.append(remove);

      // Drag to reorder with a mouse; the arrow buttons do the same on touch and keyboard.
      li.addEventListener('dragstart', (event) => {
        dragFrom = index;
        li.classList.add('is-dragging');
        event.dataTransfer.effectAllowed = 'move';
        event.dataTransfer.setData('text/plain', String(index));
      });
      li.addEventListener('dragend', () => {
        li.classList.remove('is-dragging');
        dragFrom = null;
      });
      li.addEventListener('dragover', (event) => {
        if (dragFrom === null) return;
        event.preventDefault();
        li.classList.add('is-drop-target');
      });
      li.addEventListener('dragleave', () => li.classList.remove('is-drop-target'));
      li.addEventListener('drop', (event) => {
        if (dragFrom === null) return;
        event.preventDefault();
        event.stopPropagation();
        const from = dragFrom;
        dragFrom = null;
        move(from, index, '.is-remove');
      });
      list.append(li);
    });

    const left = max - items.length;
    if (left > 0) {
      const li = document.createElement('li');
      li.className = 'photo-picker-add-item';
      addTile.querySelector('.photo-picker-add-count').textContent = items.length ? `เพิ่มได้อีก ${left} รูป` : `สูงสุด ${max} รูป`;
      li.append(addTile);
      list.append(li);
    }
    sync();
  }

  const addFiles = (files) => {
    const problems = [];
    for (const file of files) {
      if (items.length >= max) {
        problems.push(`แนบรูปได้ไม่เกิน ${max} รูป รูปที่เกินไม่ได้ถูกเพิ่ม`);
        break;
      }
      if (!TYPES.includes(file.type)) {
        problems.push(`${file.name}: รองรับเฉพาะ JPEG PNG หรือ WebP`);
        continue;
      }
      if (file.size > MAX_BYTES) {
        problems.push(`${file.name}: ใหญ่เกิน 5 MB`);
        continue;
      }
      const item = { kind: 'new', file, src: '' };
      items.push(item);
      // data: URLs, which the page's image policy already allows.
      const reader = new FileReader();
      reader.addEventListener('load', () => {
        item.src = reader.result;
        const img = list.children[items.indexOf(item)]?.querySelector('img');
        if (img) img.src = item.src;
      });
      reader.readAsDataURL(file);
    }
    render();
    say(problems.join(' · '), problems.length > 0);
    if (!problems.length) announce(`มีรูปทั้งหมด ${items.length} รูป`);
  };

  // The "clear form" button empties the list too.
  input.form?.addEventListener('form:cleared', () => {
    items.length = 0;
    render();
    say('');
  });

  // Picking again ADDS to the list. The input's own file list is rebuilt
  // from `items` by sync(), so nothing picked earlier is lost.
  input.addEventListener('change', () => {
    const picked = [...input.files];
    sync();
    if (picked.length) addFiles(picked);
  });

  // Files dropped onto the picker from the computer are added too.
  picker.addEventListener('dragover', (event) => {
    if (dragFrom !== null || !event.dataTransfer?.types.includes('Files')) return;
    event.preventDefault();
    picker.classList.add('is-file-over');
  });
  picker.addEventListener('dragleave', (event) => {
    if (!picker.contains(event.relatedTarget)) picker.classList.remove('is-file-over');
  });
  picker.addEventListener('drop', (event) => {
    picker.classList.remove('is-file-over');
    if (dragFrom !== null || !event.dataTransfer?.files.length) return;
    event.preventDefault();
    addFiles([...event.dataTransfer.files]);
  });

  render();
});

// A file input that takes several photos warns as soon as too many are
// picked, instead of after a slow upload. The server still enforces the
// limit; this only saves the member a wasted upload.
document.querySelectorAll('input[type="file"][data-max-files]:not([data-picker-ready])').forEach((input) => {
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
document.querySelectorAll('input[type="file"][accept*="image"]:not([data-picker-ready])').forEach((input) => {
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

// "Clear form" on the new-request form: empties everything the member typed
// or picked (text, category, pin, photos, hours) so they can start on another
// place, after asking first. Hidden fields (CSRF token) are left alone.
document.querySelectorAll('[data-clear-form]').forEach((button) => {
  const form = button.form;
  if (!form) return;
  button.hidden = false;
  button.addEventListener('click', () => {
    if (!window.confirm('ล้างข้อมูลทั้งหมดในฟอร์มนี้ เพื่อเริ่มกรอกสถานที่ใหม่?')) return;
    for (const field of form.elements) {
      if (field.type === 'hidden' || field.type === 'submit' || field.type === 'button' || field.tagName === 'FIELDSET') continue;
      if (field.type === 'checkbox' || field.type === 'radio') field.checked = false;
      else if (field.tagName === 'SELECT') field.value = field.name.startsWith('state') ? 'unknown' : field.options[0]?.value ?? '';
      else field.value = '';
      field.removeAttribute('aria-invalid');
      field.dispatchEvent(new Event('input', { bubbles: true }));
      field.dispatchEvent(new Event('change', { bubbles: true }));
    }
    // Old error messages no longer apply to an empty form.
    document.querySelectorAll('.form-error, .field-error').forEach((message) => message.remove());
    form.dispatchEvent(new CustomEvent('form:cleared'));
    window.scrollTo({ top: 0, behavior: 'smooth' });
    form.elements.namedItem('name')?.focus({ preventScroll: true });
    announce('ล้างฟอร์มแล้ว');
  });
});
