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
// Escape closes the open menu and puts focus back on its button, so keyboard users
// are never left inside a panel they cannot dismiss.
document.addEventListener('keydown', (event) => {
  if (event.key !== 'Escape' || !menu || menu.getAttribute('aria-expanded') !== 'true') return;
  setMenu(false);
  menu.focus();
});

// A broken image becomes a neutral placeholder instead of a broken-image icon.
document.querySelectorAll('img').forEach((img) =>
  img.addEventListener(
    'error',
    () => {
      const placeholder = document.createElement('span');
      placeholder.className = 'image-placeholder';
      placeholder.textContent = 'ยังไม่สามารถแสดงภาพได้';
      img.replaceWith(placeholder);
    },
    { once: true }
  )
);

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
      action.value = saving ? 'remove' : 'save';
      // Only the place page's text button swaps styles; the card heart is
      // styled from aria-pressed and must not pick up the big button colours.
      if (button.classList.contains('button')) {
        button.classList.toggle('button-primary', saving);
        button.classList.toggle('button-outline', !saving);
      }
      button.setAttribute('aria-pressed', String(saving));
      // The place page has a visible text label; the heart on a card has only an
      // icon, so its accessible name carries the place name instead.
      const label = form.querySelector('[data-favorite-label]');
      if (label) label.textContent = saving ? 'บันทึกแล้ว' : 'บันทึกสถานที่';
      if (button.dataset.name) button.setAttribute('aria-label', (saving ? 'เลิกบันทึก ' : 'บันทึก ') + button.dataset.name);
      announce(saving ? 'บันทึกสถานที่แล้ว' : 'นำออกจากรายการที่บันทึกแล้ว');
      button.disabled = false;
    } catch {
      HTMLFormElement.prototype.submit.call(form);
    }
  });
});
