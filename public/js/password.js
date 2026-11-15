// Show/hide button for password fields. Every form works without this file:
// the buttons are rendered `hidden` (views/partials/field.ejs) and only
// appear once this script runs.
document.querySelectorAll('[data-password-toggle]').forEach((button) => {
  const input = document.getElementById(button.getAttribute('aria-controls'));
  if (!input) return;

  const show = (visible) => {
    // Only the type changes; name, autocomplete and the error wiring stay,
    // so password managers and screen readers see the same field.
    input.type = visible ? 'text' : 'password';
    button.setAttribute('aria-pressed', String(visible));
    button.setAttribute('aria-label', visible ? 'ซ่อนรหัสผ่าน' : 'แสดงรหัสผ่าน');
  };

  button.addEventListener('click', () => show(input.type === 'password'));
  // A password left visible must not be sent as a text field: browsers may
  // remember text fields for autofill and restore them on "back".
  input.form?.addEventListener('submit', () => show(false));

  button.hidden = false;
});
