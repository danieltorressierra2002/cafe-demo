/*
 * Menú dinámico: pide los platos a /api/menu y dibuja las tarjetas.
 * Si la API no responde, se queda el menú que ya trae la página.
 * Todo el texto se inserta con textContent (nunca innerHTML) -> sin XSS.
 */
(() => {
  'use strict';

  const container = document.getElementById('menu-cards');
  if (!container) return;

  const API = (window.CAFE_API_URL || '').replace(/\/$/, '') + '/api';

  const node = (tag, className, text) => {
    const n = document.createElement(tag);
    if (className) n.className = className;
    if (text !== undefined) n.textContent = text;
    return n;
  };

  function card(item, index) {
    const article = node('article', 'card reveal');
    article.style.setProperty('--d', `${Math.min(index, 6) * 0.12}s`);
    if (item.image && /^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(item.image)) {
      const img = node('img', 'dish-photo');
      img.src = item.image;
      img.alt = item.name;
      img.loading = 'lazy';
      img.width = 800;
      img.height = 600;
      article.classList.add('has-photo');
      article.append(img);
    }
    article.append(node('span', 'num', String(index + 1).padStart(2, '0')), node('h3', '', item.name), node('p', '', item.description));
    if (item.tag || item.price) {
      const price = node('div', 'price');
      price.append(node('span', '', item.tag), node('span', '', item.price));
      article.append(price);
    }
    return article;
  }

  function render(items) {
    const section = document.getElementById('menu');
    const navLink = document.querySelector('a[href="#menu"]');
    const empty = items.length === 0;
    if (section) section.hidden = empty; // sin platos visibles, se oculta toda la sección
    if (navLink) navLink.hidden = empty;
    container.replaceChildren(...items.map(card));

    const cards = container.querySelectorAll('.reveal');
    if ('IntersectionObserver' in window) {
      const io = new IntersectionObserver(
        (entries) =>
          entries.forEach((e) => {
            if (e.isIntersecting) {
              e.target.classList.add('in');
              io.unobserve(e.target);
            }
          }),
        { threshold: 0.15, rootMargin: '0px 0px -40px 0px' }
      );
      cards.forEach((c) => io.observe(c));
    } else {
      cards.forEach((c) => c.classList.add('in'));
    }
  }

  fetch(`${API}/menu`)
    .then((r) => (r.ok ? r.json() : Promise.reject(new Error('menu'))))
    .then((body) => render(body.data))
    .catch(() => {
      /* se queda el menú que ya trae la página */
    });
})();
