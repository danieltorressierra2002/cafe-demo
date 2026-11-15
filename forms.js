/*
 * Integración del frontend con el backend (sin librerías).
 *
 * Busca en la página dos formularios y, si existen, los conecta a la API:
 *   <form id="contact-form">      -> POST /api/contact
 *   <form id="reservation-form">  -> POST /api/reservations  (+ horarios disponibles en vivo)
 * Si la página no tiene esos formularios, este archivo simplemente no hace nada.
 *
 * Todo el texto que se muestra al usuario se inserta con textContent (nunca innerHTML) -> sin XSS.
 *
 * Si el frontend está alojado en OTRO dominio que el backend, define antes de cargar este archivo:
 *   <script>window.CAFE_API_URL = 'https://tu-backend.onrender.com';</script>
 * (y agrega ese dominio del frontend a ALLOWED_ORIGINS en el .env del backend).
 */
(() => {
  'use strict';

  const API = (window.CAFE_API_URL || '').replace(/\/$/, '') + '/api';

  async function request(path, options = {}) {
    const response = await fetch(API + path, {
      headers: { 'Content-Type': 'application/json' },
      ...options,
    });

    let body = null;
    try {
      body = await response.json();
    } catch {
      /* respuesta sin cuerpo */
    }

    if (!response.ok) {
      const first = body && body.error && body.error.details && body.error.details[0];
      const message = first ? first.message : (body && body.error && body.error.message) || 'Ocurrió un error. Inténtalo de nuevo.';
      throw new Error(message);
    }
    return body;
  }

  function showStatus(el, text, type) {
    if (!el) return;
    el.textContent = text; // textContent: seguro
    el.dataset.type = type; // para estilizar: [data-type="success"] / "error" / "info"
  }

  /** Conecta un formulario a un endpoint. `transform` ajusta los datos antes de enviarlos. */
  function bindForm(selector, path, transform = (d) => d, onSuccess = () => {}) {
    const form = document.querySelector(selector);
    if (!form) return null;

    const status = form.querySelector('[data-status]');
    const button = form.querySelector('button[type="submit"]');
    const openedAt = Date.now(); // el backend descarta envíos sospechosamente rápidos (bots)

    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      if (!form.reportValidity()) return;

      if (button) button.disabled = true;
      const wa = form.querySelector('[data-wa]');
      if (wa) wa.hidden = true;
      const waNote = form.querySelector('[data-wa-note]');
      if (waNote) waNote.hidden = true;
      showStatus(status, 'Enviando…', 'info');

      try {
        const data = transform(Object.fromEntries(new FormData(form).entries()));
        data.formStartedAt = openedAt;
        const result = await request(path, { method: 'POST', body: JSON.stringify(data) });
        showStatus(status, result.message || '¡Listo!', 'success');
        form.reset();
        onSuccess(result, data);
      } catch (err) {
        showStatus(status, err.message, 'error');
      } finally {
        if (button) button.disabled = false;
      }
    });

    return form;
  }

  // ---------- Formulario de contacto ----------
  bindForm('#contact-form', '/contact');

  // ---------- Formulario de reservas ----------
  const reservationForm = bindForm(
    '#reservation-form',
    '/reservations',
    (d) => ({ ...d, partySize: Number(d.partySize) }),
    (result, sent) => {
      loadSlots();
      showWhatsappButton(sent);
    }
  );

  async function loadSlots() {
    if (!reservationForm) return;
    const date = reservationForm.elements['date'].value;
    const partySize = reservationForm.elements['partySize'].value || '1';
    const select = reservationForm.elements['time'];
    if (!date || !select) return;

    select.replaceChildren(new Option('Cargando horarios…', ''));

    try {
      const { data } = await request(`/reservations/availability?date=${encodeURIComponent(date)}&partySize=${encodeURIComponent(partySize)}`);
      const free = data.slots.filter((s) => s.available);
      select.replaceChildren(new Option(free.length ? 'Elige una hora' : 'Sin horarios disponibles', ''));
      free.forEach((s) => select.add(new Option(s.time, s.time)));
    } catch (err) {
      select.replaceChildren(new Option('No se pudieron cargar los horarios', ''));
    }
  }

  // ---------- Datos del negocio (se editan desde el panel de administración) ----------
  const DAY_NAMES = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
  const cap = (t) => t.charAt(0).toUpperCase() + t.slice(1);
  const hourLabel = (hhmm) => String(Number(hhmm.slice(0, 2))) + hhmm.slice(2);

  /** Agrupa días seguidos con el mismo horario: "Lunes a viernes · 7:00 – 19:00". */
  function hoursLines(hours) {
    const order = [1, 2, 3, 4, 5, 6, 0]; // semana de lunes a domingo
    const groups = [];
    for (const day of order) {
      const h = hours[day];
      const key = h ? `${h[0]}-${h[1]}` : 'closed';
      const last = groups[groups.length - 1];
      if (last && last.key === key) last.days.push(day);
      else groups.push({ key, h, days: [day] });
    }
    return groups.map(({ h, days }) => {
      const first = DAY_NAMES[days[0]];
      const lastName = DAY_NAMES[days[days.length - 1]];
      const label = days.length === 1 ? first : days.length === 2 ? `${first} y ${lastName}` : `${first} a ${lastName}`;
      return `${cap(label)} · ${h ? `${hourLabel(h[0])} – ${hourLabel(h[1])}` : 'Cerrado'}`;
    });
  }

  // ---------- WhatsApp ----------
  let business = null; // datos públicos del negocio (se llenan al cargar /settings/public)

  const waDigits = (v) => String(v || '').replace(/\D/g, '');

  function waLink(number, text) {
    return `https://wa.me/${waDigits(number)}?text=${encodeURIComponent(text)}`;
  }

  /** Tras reservar, ofrece enviar la solicitud por WhatsApp al local (si tiene número configurado). */
  function showWhatsappButton(sent) {
    const link = reservationForm && reservationForm.querySelector('[data-wa]');
    if (!link || !business || !business.whatsapp || !sent) return;
    const fecha = new Intl.DateTimeFormat('es', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' }).format(new Date(`${sent.date}T00:00:00Z`));
    const text =
      `Hola, soy ${sent.name}. Acabo de reservar una mesa para ${sent.partySize} ` +
      `${Number(sent.partySize) === 1 ? 'persona' : 'personas'} el ${fecha} a las ${sent.time}. Mi teléfono: ${sent.phone}. ¡Gracias!`;
    link.href = waLink(business.whatsapp, text);
    link.hidden = false;
    const note = reservationForm.querySelector('[data-wa-note]');
    if (note) note.hidden = false;
  }

  /** Fecha de hoy (AAAA-MM-DD) en la zona horaria del negocio. */
  function todayIn(timeZone) {
    const p = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
    return p; // en-CA ya da AAAA-MM-DD
  }
  function addDaysTo(dateStr, days) {
    const d = new Date(`${dateStr}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + days);
    return d.toISOString().slice(0, 10);
  }

  function fill(name, apply) {
    document.querySelectorAll(`[data-fill="${name}"]`).forEach(apply);
  }
  const setOrHide = (node, text, href) => {
    node.hidden = !text;
    if (!text) return;
    node.textContent = text;
    if (href) node.setAttribute('href', href);
  };

  function applyBusiness(b) {
    business = b;
    if (b.businessName) document.title = b.businessName;

    fill('hours', (box) => {
      box.replaceChildren(...hoursLines(b.hours).map((line) => Object.assign(document.createElement('p'), { textContent: line })));
    });
    fill('address', (a) => setOrHide(a, b.address, b.address ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(b.address)}` : ''));
    fill('phone', (a) => setOrHide(a, b.phone, `tel:${String(b.phone).replace(/[^\d+]/g, '')}`));
    fill('email', (a) => setOrHide(a, b.email, `mailto:${b.email}`));
    fill('whatsapp', (a) => setOrHide(a, b.whatsapp ? 'WhatsApp' : '', `https://wa.me/${waDigits(b.whatsapp)}`));
    const float = document.querySelector('[data-wa-float]');
    if (float) {
      float.hidden = !b.whatsapp;
      if (b.whatsapp) float.href = waLink(b.whatsapp, `Hola${b.businessName ? ', les escribo desde la web de ' + b.businessName : ''}. Quisiera consultar algo.`);
    }
    fill('instagram', (a) => {
      const handle = b.instagram.replace(/^@/, '').replace(/^https?:\/\/(www\.)?instagram\.com\//, '').replace(/\/$/, '');
      setOrHide(a, handle ? `Instagram` : '', handle ? `https://instagram.com/${encodeURIComponent(handle)}` : '');
    });
    fill('copyright', (s) => {
      s.textContent = `© ${new Date().getFullYear()} · ${b.businessName || ''}`.replace(/ · $/, '');
    });

    if (reservationForm) {
      const party = reservationForm.elements['partySize'];
      const keep = Math.min(Number(party.value) || 2, b.maxPartySize);
      party.replaceChildren();
      for (let n = 1; n <= b.maxPartySize; n++) party.add(new Option(`${n} ${n === 1 ? 'persona' : 'personas'}`, String(n)));
      party.value = String(keep);

      const date = reservationForm.elements['date'];
      const today = todayIn(b.timezone);
      date.min = today;
      date.max = addDaysTo(today, b.maxDaysAhead);
    }
  }

  if (reservationForm) {
    // Valores provisionales mientras llegan los datos reales del negocio
    const fmt = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const lastDay = new Date();
    lastDay.setDate(lastDay.getDate() + 60);
    reservationForm.elements['date'].min = fmt(new Date());
    reservationForm.elements['date'].max = fmt(lastDay);

    reservationForm.elements['date'].addEventListener('change', loadSlots);
    reservationForm.elements['partySize'].addEventListener('change', loadSlots);
  }

  request('/settings/public')
    .then(({ data }) => applyBusiness(data))
    .catch(() => {
      /* si falla, la página se queda con los textos que ya trae */
    });
})();
