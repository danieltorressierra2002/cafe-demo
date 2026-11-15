/* Carta para el código QR: lista del menú + botones de reservar y WhatsApp. Todo el texto con textContent (sin XSS). */
(() => {
  'use strict';
  const API = (window.CAFE_API_URL || '').replace(/\/$/, '');
  const node = (tag, cls, text) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text) n.textContent = text;
    return n;
  };
  const DAYS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];

  const list = document.getElementById('list');

  // ?mesa=5 (viene del QR de cada mesa): solo se aceptan 1 a 3 cifras
  const mesa = (new URLSearchParams(location.search).get('mesa') || '').match(/^\d{1,3}$/);
  if (mesa) {
    const t = document.getElementById('table');
    t.textContent = `Mesa ${mesa[0]}`;
    t.hidden = false;
  }

  fetch(`${API}/api/menu`)
    .then((r) => (r.ok ? r.json() : Promise.reject(new Error('menu'))))
    .then(({ data }) => {
      if (!data.length) return list.replaceChildren(node('p', 'status', 'La carta se está preparando. ¡Vuelve pronto!'));
      list.replaceChildren(
        ...data.map((item) => {
          const row = node('article', 'dish');
          if (item.image && /^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(item.image)) {
            const img = node('img');
            img.src = item.image;
            img.alt = item.name;
            img.loading = 'lazy';
            img.width = img.height = 88;
            row.append(img);
          }
          const body = node('div', 'body');
          body.append(node('h2', '', item.name));
          if (item.description) body.append(node('p', '', item.description));
          if (item.tag) body.append(node('span', 'tag', item.tag));
          row.append(body);
          if (item.price) row.append(node('div', 'price', item.price));
          return row;
        })
      );
    })
    .catch(() => list.replaceChildren(node('p', 'status', 'No pudimos cargar la carta. Intenta de nuevo en un momento.')));

  fetch(`${API}/api/settings/public`)
    .then((r) => (r.ok ? r.json() : Promise.reject(new Error('settings'))))
    .then(({ data: b }) => {
      if (b.businessName) {
        document.title = `Carta · ${b.businessName}`;
        document.getElementById('name').textContent = b.businessName;
      }
      const digits = String(b.whatsapp || '').replace(/\D/g, '');
      if (digits) {
        const wa = document.getElementById('wa');
        wa.href = `https://wa.me/${digits}?text=${encodeURIComponent('Hola, estoy viendo la carta y quisiera consultar algo.')}`;
        wa.hidden = false;
      }
      const hours = b.hours || {};
      const open = [1, 2, 3, 4, 5, 6, 0].filter((d) => hours[d]);
      const first = open[0] !== undefined ? hours[open[0]] : null;
      const same = first && open.every((d) => hours[d][0] === first[0] && hours[d][1] === first[1]);
      const hoursEl = document.querySelector('[data-info=hours]');
      if (same && open.length === 7) hoursEl.textContent = `Todos los días · ${first[0]} – ${first[1]}`;
      else if (open.length) hoursEl.textContent = open.map((d) => `${DAYS[d].slice(0, 3)} ${hours[d][0]}–${hours[d][1]}`).join(' · ');
      if (b.address) document.querySelector('[data-info=address]').textContent = b.address;
    })
    .catch(() => {});
})();
