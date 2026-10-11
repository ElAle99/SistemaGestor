// Wrap existing async submit handlers; business validation and requests remain theirs.
function withFormFeedback(handler) {
  const active = new WeakSet();
  return async function (event) {
    event.preventDefault();
    const form = event.currentTarget;
    if (active.has(form)) return;
    active.add(form);
    const controls = [...form.querySelectorAll('button[type="submit"], input[type="submit"]')];
    const previous = controls.map(control => ({ control, disabled: control.disabled }));
    form.setAttribute('aria-busy', 'true');
    try {
      // Let the original synchronous validation run before changing button state.
      const result = handler.call(this, event);
      for (const { control } of previous) { control.disabled = true; control.setAttribute('aria-busy', 'true'); }
      await result;
    } catch (error) {
      console.error('No se pudo completar el formulario:', error);
      window.AllfixUI?.notify(error.message || 'No se pudo guardar. Intenta nuevamente.', 'error');
    } finally {
      for (const { control, disabled } of previous) { control.disabled = disabled; control.removeAttribute('aria-busy'); }
      form.removeAttribute('aria-busy'); active.delete(form);
    }
  };
}
