/* Quita la pantalla de carga cuando la página terminó de abrir (con un desvanecimiento suave). */
(() => {
  'use strict';
  const el = document.getElementById('loader');
  if (!el) return;
  const nm = el.querySelector('[data-loader-name]');
  if (nm) nm.textContent = (document.title || '').split(/[—|·-]/)[0].trim();
  const hide = () => {
    el.classList.add('done');
    setTimeout(() => el.remove(), 700);
  };
  // Se muestra un mínimo de 0,9 s para que la animación se perciba, y nunca más de lo que tarde la página.
  const start = Date.now();
  const finish = () => setTimeout(hide, Math.max(0, 900 - (Date.now() - start)));
  if (document.readyState === 'complete') finish();
  else window.addEventListener('load', finish, { once: true });
})();
