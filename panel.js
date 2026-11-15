/*
 * Panel de administración (sin librerías).
 * Usa la API /api/admin del backend. La sesión viaja en una cookie HttpOnly que JavaScript no puede leer;
 * el token CSRF se guarda solo en memoria y se envía en cada cambio (POST/PATCH/PUT/DELETE).
 * Todo el texto de la base de datos se inserta con nodos de texto (nunca innerHTML) -> sin XSS.
 */
(() => {
  'use strict';

  const API = (window.CAFE_API_URL || '').replace(/\/$/, '') + '/api/admin';
  const LIMIT = 15;

  const state = { csrf: null, tab: 'reservations', reservationsPage: 1, messagesPage: 1, activityPage: 1, countryCode: '' };

  const STATUS_LABELS = {
    pending: 'Pendiente',
    confirmed: 'Confirmada',
    cancelled: 'Cancelada',
    completed: 'Completada',
    no_show: 'No asistió',
  };

  const $ = (selector) => document.querySelector(selector);

  /** Crea un elemento. Los hijos de tipo texto se insertan como texto, nunca como HTML. */
  function el(tag, props = {}, ...children) {
    const node = document.createElement(tag);
    for (const [key, value] of Object.entries(props)) {
      if (value === null || value === undefined || value === false) continue;
      if (key === 'class') node.className = value;
      else if (key === 'text') node.textContent = value;
      else if (key.startsWith('on')) node.addEventListener(key.slice(2), value);
      else node.setAttribute(key, value === true ? '' : value);
    }
    for (const child of children.flat()) if (child !== null && child !== undefined) node.append(child);
    return node;
  }

  // ---------- Utilidades ----------
  let toastTimer;
  function toast(message, isError = false) {
    const box = $('#toast');
    box.textContent = message;
    box.classList.toggle('is-error', isError);
    box.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (box.hidden = true), 3800);
  }

  async function api(path, { method = 'GET', body } = {}) {
    const headers = {};
    if (body) headers['Content-Type'] = 'application/json';
    if (method !== 'GET') headers['X-CSRF-Token'] = state.csrf || '';

    const response = await fetch(API + path, {
      method,
      headers,
      credentials: window.CAFE_API_URL ? 'include' : 'same-origin',
      body: body ? JSON.stringify(body) : undefined,
    });

    let json = null;
    try {
      json = await response.json();
    } catch {
      /* sin cuerpo */
    }

    if (response.status === 401 && path !== '/login') {
      showLogin();
      throw new Error('Tu sesión expiró. Inicia sesión de nuevo.');
    }
    if (!response.ok) {
      const detail = json && json.error && json.error.details && json.error.details[0];
      throw new Error(detail ? detail.message : (json && json.error && json.error.message) || 'Ocurrió un error.');
    }
    return json ? json.data : undefined;
  }

  const localToday = () => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  };

  const formatDay = (dateStr) =>
    new Intl.DateTimeFormat('es', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' }).format(
      new Date(`${dateStr}T00:00:00Z`)
    );

  const formatStamp = (iso) =>
    new Date(iso).toLocaleString('es', { dateStyle: 'medium', timeStyle: 'short' });

  const digits = (phone) => String(phone).replace(/[^\d+]/g, '');

  // ---------- Vistas ----------
  function showLogin() {
    state.csrf = null;
    $('#app-view').hidden = true;
    $('#login-view').hidden = false;
  }

  async function showApp(data) {
    state.csrf = data.csrfToken;
    $('#admin-name').textContent = data.admin.name;
    $('#login-view').hidden = true;
    $('#app-view').hidden = false;
    // El código de país debe estar listo antes de dibujar los botones de WhatsApp.
    try { state.countryCode = (await api('/settings')).countryCode || ''; } catch { /* sin código: se usa el número tal cual */ }
    switchTab(state.tab);
    refreshUnread();
  }

  function switchTab(tab) {
    state.tab = tab;
    document.querySelectorAll('.tab').forEach((b) => b.classList.toggle('is-active', b.dataset.tab === tab));
    $('#tab-reservations').hidden = tab !== 'reservations';
    $('#tab-messages').hidden = tab !== 'messages';
    $('#tab-menu').hidden = tab !== 'menu';
    $('#tab-activity').hidden = tab !== 'activity';
    $('#tab-qr').hidden = tab !== 'qr';
    $('#tab-settings').hidden = tab !== 'settings';
    if (tab === 'reservations') loadReservations();
    else if (tab === 'messages') loadMessages();
    else if (tab === 'menu') loadMenu();
    else if (tab === 'activity') loadActivity();
    else if (tab === 'qr') loadQr();
    else loadSettings();
  }

  function renderPager(container, { page, limit, total }, onPage) {
    container.replaceChildren();
    const pages = Math.max(1, Math.ceil(total / limit));
    if (total === 0) return;
    container.append(
      el('button', { class: 'btn btn-ghost btn-small', type: 'button', text: 'Anterior', disabled: page <= 1, onclick: () => onPage(page - 1) }),
      el('span', { text: `Página ${page} de ${pages} · ${total} en total` }),
      el('button', { class: 'btn btn-ghost btn-small', type: 'button', text: 'Siguiente', disabled: page >= pages, onclick: () => onPage(page + 1) })
    );
  }

  // ---------- Reservas ----------
  async function loadReservations() {
    const list = $('#reservations-list');
    const params = new URLSearchParams({ page: state.reservationsPage, limit: LIMIT });
    if ($('#f-status').value) params.set('status', $('#f-status').value);
    if ($('#f-date').value) params.set('date', $('#f-date').value);

    try {
      const data = await api(`/reservations?${params}`);
      list.replaceChildren();
      if (data.items.length === 0) list.append(el('p', { class: 'empty', text: 'No hay reservas con esos filtros.' }));
      data.items.forEach((r) => list.append(reservationCard(r)));
      renderPager($('#reservations-pager'), data, (p) => {
        state.reservationsPage = p;
        loadReservations();
      });
    } catch (err) {
      toast(err.message, true);
    }
  }

  /** Número listo para wa.me: con +, tal cual; sin +, se antepone el código de país de los ajustes. */
  function waNumber(phone) {
    const raw = String(phone || '').trim();
    const d = raw.replace(/\D/g, '');
    if (raw.startsWith('+')) return d;
    if (d.startsWith('00')) return d.slice(2);
    if (state.countryCode && d.length <= 10) return state.countryCode + d.replace(/^0+/, '');
    return d;
  }

  const longDay = (dateStr) =>
    new Intl.DateTimeFormat('es', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' }).format(new Date(`${dateStr}T00:00:00Z`));

  /** Enlace a WhatsApp con un mensaje ya escrito para el cliente, según el estado de la reserva. */
  function waLinkFor(r) {
    const number = waNumber(r.phone);
    if (number.length < 8) return null;
    const people = `${r.partySize} ${r.partySize === 1 ? 'persona' : 'personas'}`;
    const when = `el ${longDay(r.date)} a las ${r.time}`;
    let text;
    if (r.status === 'confirmed') text = `Hola ${r.name}, tu reserva para ${people} ${when} está confirmada. ¡Te esperamos!`;
    else if (r.status === 'cancelled') text = `Hola ${r.name}, lamentamos avisarte que tu reserva ${when} fue cancelada. ¿Quieres que busquemos otro horario?`;
    else if (r.status === 'pending') text = `Hola ${r.name}, recibimos tu solicitud de reserva para ${people} ${when}. ¿Te la confirmamos?`;
    else text = `Hola ${r.name}, gracias por visitarnos.`;
    return `https://wa.me/${number}?text=${encodeURIComponent(text)}`;
  }

  function reservationCard(r) {
    const actions = [];
    const act = (label, status, extraClass = '') =>
      actions.push(el('button', { class: `btn btn-small ${extraClass}`.trim(), type: 'button', text: label, onclick: () => changeStatus(r, status) }));

    const wa = waLinkFor(r);
    if (wa) actions.push(el('a', { class: 'btn btn-small btn-wa-admin', href: wa, target: '_blank', rel: 'noopener', text: 'WhatsApp' }));

    if (r.status === 'pending') {
      act('Confirmar', 'confirmed');
      act('Cancelar', 'cancelled', 'btn-danger');
    } else if (r.status === 'confirmed') {
      act('Completada', 'completed');
      act('No asistió', 'no_show', 'btn-ghost');
      act('Cancelar', 'cancelled', 'btn-danger');
    }

    return el(
      'article',
      { class: 'item' },
      el('div', { class: 'when' }, el('div', { class: 'day', text: formatDay(r.date) }), el('div', { class: 'hour', text: r.time })),
      el(
        'div',
        {},
        el(
          'div',
          { class: 'who-line' },
          el('span', { class: 'name', text: r.name }),
          el('span', { class: `status ${r.status}`, text: STATUS_LABELS[r.status] || r.status })
        ),
        el(
          'div',
          { class: 'meta' },
          `${r.partySize} ${r.partySize === 1 ? 'persona' : 'personas'} · `,
          el('a', { href: `tel:${digits(r.phone)}`, text: r.phone }),
          r.email ? ' · ' : null,
          r.email ? el('a', { href: `mailto:${r.email}`, text: r.email }) : null
        ),
        r.notes ? el('p', { class: 'notes', text: r.notes }) : null
      ),
      el('div', { class: 'actions' }, actions)
    );
  }

  async function changeStatus(r, status) {
    if (status === 'cancelled' && !window.confirm(`¿Cancelar la reserva de ${r.name}? Se le avisará por email.`)) return;
    try {
      await api(`/reservations/${encodeURIComponent(r.id)}/status`, { method: 'PATCH', body: { status } });
      toast('Reserva actualizada');
      loadReservations();
    } catch (err) {
      toast(err.message, true);
    }
  }

  // ---------- Mensajes ----------
  async function refreshUnread() {
    try {
      const data = await api('/messages?unread=true&limit=1');
      const badge = $('#unread-badge');
      badge.textContent = String(data.total);
      badge.hidden = data.total === 0;
    } catch {
      /* el aviso de no leídos no es crítico */
    }
  }

  async function loadMessages() {
    const list = $('#messages-list');
    const params = new URLSearchParams({ page: state.messagesPage, limit: LIMIT });
    if ($('#f-unread').checked) params.set('unread', 'true');

    try {
      const data = await api(`/messages?${params}`);
      list.replaceChildren();
      if (data.items.length === 0) list.append(el('p', { class: 'empty', text: 'No hay mensajes.' }));
      data.items.forEach((m) => list.append(messageCard(m)));
      renderPager($('#messages-pager'), data, (p) => {
        state.messagesPage = p;
        loadMessages();
      });
      refreshUnread();
    } catch (err) {
      toast(err.message, true);
    }
  }

  function messageCard(m) {
    const reply = m.email ? `mailto:${m.email}?subject=${encodeURIComponent(`Re: ${m.subject || 'Tu sugerencia'}`)}` : null;
    return el(
      'article',
      { class: `item${m.isRead ? '' : ' is-unread'}` },
      el('div', { class: 'when' }, el('div', { class: 'day', text: formatStamp(m.createdAt) })),
      el(
        'div',
        {},
        el('div', { class: 'who-line' }, el('span', { class: 'name', text: m.name }), m.isRead ? null : el('span', { class: 'status pending', text: 'Nuevo' })),
        el('div', { class: 'meta' }, m.email ? el('a', { href: `mailto:${m.email}`, text: m.email }) : el('span', { text: 'Sin email (no se puede responder)' }), m.subject ? ` · ${m.subject}` : ''),
        el('p', { class: 'msg-body', text: m.message })
      ),
      el(
        'div',
        { class: 'actions' },
        reply ? el('a', { class: 'btn btn-small', href: reply, text: 'Responder' }) : null,
        m.isRead ? null : el('button', { class: 'btn btn-small btn-ghost', type: 'button', text: 'Marcar leído', onclick: () => markRead(m) }),
        el('button', { class: 'btn btn-small btn-danger', type: 'button', text: 'Eliminar', onclick: () => removeMessage(m) })
      )
    );
  }

  async function markRead(m) {
    try {
      await api(`/messages/${encodeURIComponent(m.id)}/read`, { method: 'PATCH' });
      loadMessages();
    } catch (err) {
      toast(err.message, true);
    }
  }

  async function removeMessage(m) {
    if (!window.confirm(`¿Eliminar el mensaje de ${m.name}? No se puede deshacer.`)) return;
    try {
      await api(`/messages/${encodeURIComponent(m.id)}`, { method: 'DELETE' });
      toast('Mensaje eliminado');
      loadMessages();
    } catch (err) {
      toast(err.message, true);
    }
  }

  // ---------- Actividad ----------
  const ACTION_LABELS = {
    login: 'Inicio de sesión', login_failed: 'Intento fallido', logout: 'Cierre de sesión',
    reservation_status: 'Reserva', message_read: 'Mensaje leído', message_deleted: 'Mensaje eliminado',
    settings_updated: 'Ajustes', menu_created: 'Menú · añadido', menu_updated: 'Menú · editado',
    menu_deleted: 'Menú · eliminado', menu_moved: 'Menú · orden',
  };

  async function loadActivity() {
    const list = $('#activity-list');
    try {
      const data = await api(`/activity?page=${state.activityPage}&limit=30`);
      list.replaceChildren();
      if (data.items.length === 0) list.append(el('p', { class: 'empty', text: 'Aún no hay actividad registrada.' }));
      data.items.forEach((a) =>
        list.append(
          el(
            'div',
            { class: `act${a.action === 'login_failed' ? ' is-bad' : ''}` },
            el('span', { class: 'when-s', text: formatStamp(a.createdAt) }),
            el('span', { class: 'what', text: ACTION_LABELS[a.action] || a.action }),
            el('span', { class: 'detail' }, a.detail, el('small', { text: a.admin }))
          )
        )
      );
      renderPager($('#activity-pager'), data, (p) => {
        state.activityPage = p;
        loadActivity();
      });
    } catch (err) {
      toast(err.message, true);
    }
  }

  // ---------- Menú ----------
  const menuState = { editing: null, items: [], photo: null, removePhoto: false, currentImage: null };

  /** Reduce la foto (lado mayor 900 px) y la convierte a JPEG liviano; devuelve base64 sin cabecera. */
  async function photoToBase64(file) {
    if (!/^image\/(jpeg|png|webp)$/.test(file.type)) throw new Error('Usa una foto JPG, PNG o WebP.');
    if (file.size > 15 * 1024 * 1024) throw new Error('La foto es demasiado grande (máximo 15 MB).');
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, 900 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff'; // los PNG con transparencia quedan sobre blanco
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    let quality = 0.82;
    let dataUrl = canvas.toDataURL('image/jpeg', quality);
    while (dataUrl.length > 420000 && quality > 0.4) {
      quality -= 0.1;
      dataUrl = canvas.toDataURL('image/jpeg', quality);
    }
    if (dataUrl.length > 520000) throw new Error('No se pudo reducir la foto lo suficiente. Prueba con otra.');
    return dataUrl.slice(dataUrl.indexOf(',') + 1);
  }

  function showPhotoPreview(src) {
    const img = $('#menu-photo-preview');
    img.hidden = !src;
    if (src) img.src = src;
    else img.removeAttribute('src');
    $('#menu-photo-remove').hidden = !src;
  }

  function resetMenuForm() {
    const f = $('#menu-form');
    menuState.editing = null;
    f.reset();
    f.elements.isVisible.checked = true;
    Object.assign(menuState, { photo: null, removePhoto: false, currentImage: null });
    $('#menu-photo').value = '';
    showPhotoPreview(null);
    $('#menu-form-title').textContent = 'Nuevo plato';
    $('#menu-submit').textContent = 'Añadir plato';
    $('#menu-cancel').hidden = true;
  }

  function editDish(item) {
    const f = $('#menu-form');
    menuState.editing = item.id;
    for (const key of ['name', 'price', 'tag', 'description']) f.elements[key].value = item[key];
    f.elements.isVisible.checked = item.isVisible;
    Object.assign(menuState, { photo: null, removePhoto: false, currentImage: item.image });
    $('#menu-photo').value = '';
    showPhotoPreview(item.image);
    $('#menu-form-title').textContent = 'Editar plato';
    $('#menu-submit').textContent = 'Guardar cambios';
    $('#menu-cancel').hidden = false;
    f.scrollIntoView({ behavior: 'smooth', block: 'center' });
    f.elements.name.focus();
  }

  const dishBody = (item, overrides = {}) => ({
    name: item.name, description: item.description, tag: item.tag, price: item.price, isVisible: item.isVisible, ...overrides,
  });

  async function menuAction(fn, okMessage) {
    try {
      await fn();
      if (okMessage) toast(okMessage);
      await loadMenu();
    } catch (err) {
      toast(err.message, true);
    }
  }

  function dishRow(item, index, total) {
    const b = (label, onclick, extra = '', disabled = false) =>
      el('button', { class: `btn btn-small ${extra}`.trim(), type: 'button', text: label, onclick, disabled });
    return el(
      'article',
      { class: `dish${item.isVisible ? '' : ' is-hidden'}`, 'data-dish': item.name },
      el(
        'div',
        {},
        el('div', { class: 'who-line' }, item.image ? el('img', { class: 'dish-thumb', src: item.image, alt: '' }) : null, el('span', { class: 'name', text: item.name }), item.isVisible ? null : el('span', { class: 'status pending', text: 'Oculto' })),
        el('div', { class: 'meta', text: [item.price, item.tag, item.description].filter(Boolean).join(' · ') })
      ),
      el(
        'div',
        { class: 'dish-actions' },
        b('Subir', () => menuAction(() => api(`/menu/${encodeURIComponent(item.id)}/move`, { method: 'PATCH', body: { direction: 'up' } })), 'btn-ghost', index === 0),
        b('Bajar', () => menuAction(() => api(`/menu/${encodeURIComponent(item.id)}/move`, { method: 'PATCH', body: { direction: 'down' } })), 'btn-ghost', index === total - 1),
        b('Editar', () => editDish(item), 'btn-ghost'),
        b(item.isVisible ? 'Ocultar' : 'Mostrar', () =>
          menuAction(() => api(`/menu/${encodeURIComponent(item.id)}`, { method: 'PUT', body: dishBody(item, { isVisible: !item.isVisible }) }), item.isVisible ? 'Plato oculto' : 'Plato visible'), 'btn-ghost'),
        b('Eliminar', () => {
          if (!window.confirm(`¿Eliminar "${item.name}"? No se puede deshacer.`)) return;
          menuAction(() => api(`/menu/${encodeURIComponent(item.id)}`, { method: 'DELETE' }), 'Plato eliminado');
        }, 'btn-danger')
      )
    );
  }

  async function loadMenu() {
    try {
      menuState.items = await api('/menu');
      const list = $('#menu-list');
      list.replaceChildren();
      if (menuState.items.length === 0) list.append(el('p', { class: 'empty', text: 'Aún no hay platos. Añade el primero arriba.' }));
      menuState.items.forEach((item, i) => list.append(dishRow(item, i, menuState.items.length)));
    } catch (err) {
      toast(err.message, true);
    }
  }

  $('#menu-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const f = event.currentTarget.elements;
    const body = {
      name: f.name.value, price: f.price.value, tag: f.tag.value, description: f.description.value, isVisible: f.isVisible.checked,
    };
    const editing = menuState.editing;
    const button = $('#menu-submit');
    button.disabled = true;
    try {
      let base64 = null;
      if (menuState.photo) base64 = await photoToBase64(menuState.photo); // si falla, no se guarda nada
      const saved = editing
        ? { id: editing, ...(await api(`/menu/${encodeURIComponent(editing)}`, { method: 'PUT', body })) }
        : await api('/menu', { method: 'POST', body });
      if (base64) await api(`/menu/${encodeURIComponent(saved.id)}/image`, { method: 'PUT', body: { image: base64 } });
      else if (menuState.removePhoto && editing) await api(`/menu/${encodeURIComponent(editing)}/image`, { method: 'DELETE' });
      toast(editing ? 'Plato actualizado' : 'Plato añadido');
      resetMenuForm();
      await loadMenu();
    } catch (err) {
      toast(err.message, true);
    } finally {
      button.disabled = false;
    }
  });
  $('#menu-cancel').addEventListener('click', resetMenuForm);
  $('#menu-photo').addEventListener('change', (e) => {
    const file = e.target.files[0];
    menuState.photo = file || null;
    menuState.removePhoto = false;
    showPhotoPreview(file ? URL.createObjectURL(file) : menuState.currentImage);
  });
  $('#menu-photo-remove').addEventListener('click', () => {
    menuState.photo = null;
    menuState.removePhoto = true;
    $('#menu-photo').value = '';
    showPhotoPreview(null);
  });

  // ---------- Código QR ----------
  // El color y el logo se guardan solo en este navegador (sirven para generar el cartel; no hacen falta en el servidor).
  const qrState = { name: '', logo: null };
  const QR_STORE = 'cafe_qr_style';
  const loadQrStyle = () => { try { return JSON.parse(localStorage.getItem(QR_STORE) || '{}'); } catch { return {}; } };
  const saveQrStyle = (patch) => { try { localStorage.setItem(QR_STORE, JSON.stringify({ ...loadQrStyle(), ...patch })); } catch { /* sin almacenamiento */ } };

  const qrBase = () => $('#qr-base').value.trim().replace(/\/+$/, '');
  const qrColor = () => $('#qr-color').value || '#25392a';
  const isLight = (hex) => {
    const n = parseInt(hex.slice(1), 16);
    return 0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255) > 150;
  };

  function qrTarget(kind, table) {
    const base = qrBase();
    if (kind === 'reservar') return `${base}/#reservas`;
    return `${base}/carta.html${table ? `?mesa=${encodeURIComponent(table)}` : ''}`;
  }

  function currentQrUrl() {
    const kind = $('#qr-kind').value;
    const table = $('#qr-table').value.replace(/\D/g, '').slice(0, 3);
    return qrTarget(kind, table);
  }

  function drawQr() {
    const kind = $('#qr-kind').value;
    $('#qr-table').disabled = kind === 'reservar';
    const base = qrBase();
    const warn = $('#qr-warn');
    warn.hidden = !/^(https?:\/\/)?(localhost|127\.|192\.168\.|10\.)/i.test(base);
    $('#qr-logo-remove').hidden = !qrState.logo;
    if (!base) {
      $('#qr-info').textContent = 'Escribe la dirección de tu web para generar el código.';
      return false;
    }
    if (isLight(qrColor())) {
      $('#qr-info').textContent = 'Ese color es muy claro y el QR no se leería bien. Elige uno más oscuro.';
      return false;
    }
    try {
      window.QR.draw($('#qr-canvas'), currentQrUrl(), 600, qrColor(), qrState.logo);
      $('#qr-info').textContent = `Abre: ${currentQrUrl()}`;
      return true;
    } catch (err) {
      $('#qr-info').textContent = err.message;
      return false;
    }
  }

  function siteBase() {
    return (window.CAFE_SITE_URL || (location.origin + location.pathname.replace(/(\/admin\/?(index\.html)?|\/panel\.html)$/, ''))).replace(/\/$/, '');
  }

  async function loadQr() {
    const style = loadQrStyle();
    if (!$('#qr-base').value) $('#qr-base').value = style.base || siteBase();
    if (style.color) $('#qr-color').value = style.color;
    if (style.logo && !qrState.logo) {
      const img = new Image();
      img.onload = () => { qrState.logo = img; drawQr(); };
      img.src = style.logo;
    }
    try {
      qrState.name = (await api('/settings')).businessName || '';
    } catch { /* sin nombre: el cartel sale sin él */ }
    drawQr();
  }

  function download(canvas, filename) {
    const a = document.createElement('a');
    a.href = canvas.toDataURL('image/png');
    a.download = filename;
    document.body.append(a);
    a.click();
    a.remove();
  }

  /** Reduce el logo a un PNG pequeño (máx. 240 px) para guardarlo en el navegador. */
  async function logoToDataUrl(file) {
    if (!/^image\/(png|jpeg|webp)$/.test(file.type)) throw new Error('Usa un logo PNG, JPG o WebP.');
    if (file.size > 8 * 1024 * 1024) throw new Error('El logo es demasiado grande.');
    const bmp = await createImageBitmap(file);
    const k = Math.min(1, 240 / Math.max(bmp.width, bmp.height));
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(bmp.width * k));
    c.height = Math.max(1, Math.round(bmp.height * k));
    c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
    return c.toDataURL('image/png');
  }

  function posterCanvas() {
    const kind = $('#qr-kind').value;
    const table = $('#qr-table').value.replace(/\D/g, '').slice(0, 3);
    const url = currentQrUrl();
    const color = qrColor();
    const W = 1200, H = 1700;
    const logo = qrState.logo;
    const headH = logo ? 490 : 330;
    const c = document.createElement('canvas');
    c.width = W; c.height = H;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#f7f1e6'; ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = color; ctx.fillRect(0, 0, W, headH);
    ctx.textAlign = 'center';
    let y = 110;
    if (logo) {
      const k = Math.min(190 / logo.width, 190 / logo.height);
      const w = logo.width * k, h = logo.height * k;
      ctx.fillStyle = '#fff';
      ctx.beginPath(); ctx.arc(W / 2, 135, 105, 0, Math.PI * 2); ctx.fill();
      ctx.drawImage(logo, W / 2 - w / 2, 135 - h / 2, w, h);
      y = 300;
    }
    ctx.fillStyle = 'rgba(255,255,255,.7)'; ctx.font = '500 34px system-ui, sans-serif';
    ctx.fillText(kind === 'reservar' ? 'R E S E R V A S' : 'C A R T A   Y   R E S E R V A S', W / 2, y);
    ctx.fillStyle = '#f7f1e6';
    let size = 110;
    const name = qrState.name || 'Nuestra carta';
    ctx.font = `${size}px Georgia, serif`;
    while (ctx.measureText(name).width > W - 160 && size > 40) { size -= 6; ctx.font = `${size}px Georgia, serif`; }
    ctx.fillText(name, W / 2, y + 135);
    const qr = document.createElement('canvas');
    window.QR.draw(qr, url, 880, color, logo);
    const top = headH + 90;
    ctx.fillStyle = '#fff'; ctx.fillRect(140, top, 920, 920);
    ctx.drawImage(qr, 160, top + 20, 880, 880);
    ctx.fillStyle = '#2f2219'; ctx.font = '60px Georgia, serif';
    let ty = top + 1030;
    if (table && kind === 'carta') { ctx.font = 'italic 80px Georgia, serif'; ctx.fillText(`Mesa ${table}`, W / 2, ty); ty += 85; ctx.font = '60px Georgia, serif'; }
    ctx.fillText(kind === 'reservar' ? 'Escanea y reserva tu mesa' : 'Escanea para ver la carta', W / 2, ty);
    if (kind === 'carta') ctx.fillText('y reservar tu mesa', W / 2, ty + 75);
    return c;
  }

  /** Hojas A4 (6 mesas por hoja): un QR distinto por mesa. */
  function sheetCanvases(from, to) {
    const W = 1240, H = 1754, cols = 2, rows = 3;
    const cw = W / cols, ch = H / rows;
    const color = qrColor();
    const pages = [];
    let page = null, i = 0;
    for (let t = from; t <= to; t++, i++) {
      if (i % (cols * rows) === 0) {
        page = document.createElement('canvas'); page.width = W; page.height = H;
        const g = page.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, W, H);
        pages.push(page);
      }
      const k = i % (cols * rows);
      const x = (k % cols) * cw, y = Math.floor(k / cols) * ch;
      const g = page.getContext('2d');
      g.strokeStyle = '#c9bca5'; g.setLineDash([10, 8]); g.lineWidth = 2; g.strokeRect(x + 12, y + 12, cw - 24, ch - 24); g.setLineDash([]);
      const qr = document.createElement('canvas');
      window.QR.draw(qr, qrTarget('carta', String(t)), 420, color, qrState.logo);
      g.drawImage(qr, x + (cw - 420) / 2, y + 40, 420, 420);
      g.textAlign = 'center'; g.fillStyle = '#2f2219';
      g.font = 'italic 64px Georgia, serif'; g.fillText(`Mesa ${t}`, x + cw / 2, y + 520);
      g.font = '28px system-ui, sans-serif'; g.fillStyle = '#6b5440';
      g.fillText(qrState.name ? `${qrState.name} · escanea para ver la carta` : 'Escanea para ver la carta', x + cw / 2, y + 562);
    }
    return pages;
  }

  ['#qr-base', '#qr-kind', '#qr-table', '#qr-color'].forEach((sel) =>
    $(sel).addEventListener('input', () => {
      saveQrStyle({ base: qrBase(), color: qrColor() });
      drawQr();
    })
  );
  $('#qr-logo').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const dataUrl = await logoToDataUrl(file);
      const img = new Image();
      await new Promise((ok, fail) => { img.onload = ok; img.onerror = fail; img.src = dataUrl; });
      qrState.logo = img;
      saveQrStyle({ logo: dataUrl });
      drawQr();
    } catch (err) {
      toast(err.message || 'No se pudo usar ese logo.', true);
    }
    e.target.value = '';
  });
  $('#qr-logo-remove').addEventListener('click', () => {
    qrState.logo = null;
    saveQrStyle({ logo: null });
    drawQr();
  });
  $('#qr-png').addEventListener('click', () => { if (drawQr()) download($('#qr-canvas'), 'qr.png'); });
  $('#qr-poster').addEventListener('click', () => { if (drawQr()) download(posterCanvas(), 'cartel-qr.png'); });
  $('#qr-sheet-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!drawQr()) return toast('Revisa la dirección y el color del QR arriba.', true);
    const from = Math.max(1, Math.min(99, parseInt($('#qr-from').value, 10) || 1));
    const to = Math.max(from, Math.min(99, parseInt($('#qr-to').value, 10) || from));
    const pages = sheetCanvases(from, to);
    for (const [i, page] of pages.entries()) {
      download(page, `mesas-hoja-${i + 1}.png`);
      await new Promise((r) => setTimeout(r, 400)); // pausa para que el navegador acepte varias descargas
    }
    toast(`${pages.length} ${pages.length === 1 ? 'hoja descargada' : 'hojas descargadas'}`);
  });

  // ---------- Ajustes ----------
  const DAYS = [
    [1, 'lunes'], [2, 'martes'], [3, 'miércoles'], [4, 'jueves'], [5, 'viernes'], [6, 'sábado'], [0, 'domingo'],
  ];
  const FALLBACK_ZONES = [
    'America/Havana', 'America/Mexico_City', 'America/Bogota', 'America/Lima', 'America/Caracas', 'America/Santiago',
    'America/Argentina/Buenos_Aires', 'America/New_York', 'America/Chicago', 'America/Los_Angeles', 'Europe/Madrid',
    'Europe/London', 'Europe/Paris', 'Europe/Rome', 'Asia/Tokyo', 'Australia/Sydney', 'UTC',
  ];

  function fillTimezones(current) {
    const select = $('#settings-form').elements.timezone;
    let zones = FALLBACK_ZONES;
    try {
      zones = Intl.supportedValuesOf('timeZone');
      if (!zones.includes('UTC')) zones = [...zones, 'UTC'];
    } catch {
      /* navegador antiguo: lista reducida */
    }
    if (!zones.includes(current)) zones = [current, ...zones];
    select.replaceChildren(...zones.map((z) => el('option', { value: z, text: z.replace(/_/g, ' ') })));
    select.value = current;
  }

  function renderHours(hours) {
    const grid = $('#hours-grid');
    grid.replaceChildren(
      ...DAYS.map(([num, label]) => {
        const h = hours[num];
        const open = el('input', { type: 'time', 'data-day': num, 'data-end': 'open', value: h ? h[0] : '08:00', disabled: !h, required: true });
        const close = el('input', { type: 'time', 'data-day': num, 'data-end': 'close', value: h ? h[1] : '20:00', disabled: !h, required: true });
        const toggle = el('input', {
          type: 'checkbox',
          checked: !!h,
          'aria-label': `${label} abierto`,
          onchange: (e) => {
            open.disabled = !e.target.checked;
            close.disabled = !e.target.checked;
          },
        });
        return el(
          'div',
          { class: 'hours-row', 'data-row': num },
          el('span', { class: 'day-name', text: label }),
          open,
          close,
          el('label', { class: 'check' }, toggle, el('span', { text: 'Abierto' }))
        );
      })
    );
  }

  async function loadSettings() {
    try {
      const s = await api('/settings');
      const f = $('#settings-form').elements;
      fillTimezones(s.timezone);
      state.countryCode = s.countryCode || '';
      for (const key of ['businessName', 'phone', 'email', 'address', 'instagram', 'whatsapp', 'countryCode', 'notifyEmail', 'totalSeats', 'maxPartySize', 'durationMinutes', 'slotMinutes', 'maxDaysAhead', 'minLeadMinutes']) {
        f[key].value = s[key];
      }
      f.autoConfirm.checked = s.autoConfirm;
      renderHours(s.hours);
    } catch (err) {
      toast(err.message, true);
    }
  }

  async function saveSettings(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const f = form.elements;
    const num = (name) => Number(f[name].value);

    const hours = {};
    for (const [n] of DAYS) {
      const row = form.querySelector(`[data-row="${n}"]`);
      const times = row.querySelectorAll('input[type="time"]');
      hours[n] = row.querySelector('input[type="checkbox"]').checked ? [times[0].value, times[1].value] : null;
    }

    const body = {
      businessName: f.businessName.value,
      timezone: f.timezone.value,
      phone: f.phone.value,
      email: f.email.value.trim(),
      address: f.address.value,
      instagram: f.instagram.value,
      whatsapp: f.whatsapp.value.replace(/\D/g, ''),
      countryCode: f.countryCode.value.replace(/\D/g, ''),
      notifyEmail: f.notifyEmail.value.trim(),
      autoConfirm: f.autoConfirm.checked,
      totalSeats: num('totalSeats'),
      maxPartySize: num('maxPartySize'),
      slotMinutes: num('slotMinutes'),
      durationMinutes: num('durationMinutes'),
      maxDaysAhead: num('maxDaysAhead'),
      minLeadMinutes: num('minLeadMinutes'),
      hours,
    };

    const button = form.querySelector('button[type="submit"]');
    button.disabled = true;
    try {
      await api('/settings', { method: 'PUT', body });
      toast('Ajustes guardados. La web ya usa los nuevos datos.');
    } catch (err) {
      toast(err.message, true);
    } finally {
      button.disabled = false;
    }
  }

  // ---------- Eventos ----------
  $('#settings-form').addEventListener('submit', saveSettings);
  $('#login-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const button = form.querySelector('button[type="submit"]');
    const error = $('#login-error');
    error.textContent = '';
    button.disabled = true;
    try {
      const data = await api('/login', {
        method: 'POST',
        body: { email: form.elements.email.value, password: form.elements.password.value },
      });
      form.reset();
      showApp(data);
    } catch (err) {
      error.textContent = err.message;
    } finally {
      button.disabled = false;
    }
  });

  $('#logout').addEventListener('click', async () => {
    try {
      await api('/logout', { method: 'POST' });
    } catch {
      /* si falla, igual cerramos la vista */
    }
    showLogin();
  });

  document.querySelectorAll('.tab').forEach((button) => button.addEventListener('click', () => switchTab(button.dataset.tab)));

  const resetAndLoadReservations = () => {
    state.reservationsPage = 1;
    loadReservations();
  };
  $('#f-status').addEventListener('change', resetAndLoadReservations);
  $('#f-date').addEventListener('change', resetAndLoadReservations);
  $('#f-today').addEventListener('click', () => {
    $('#f-date').value = localToday();
    resetAndLoadReservations();
  });
  $('#f-clear').addEventListener('click', () => {
    $('#f-status').value = '';
    $('#f-date').value = '';
    resetAndLoadReservations();
  });
  $('#f-unread').addEventListener('change', () => {
    state.messagesPage = 1;
    loadMessages();
  });

  // ---------- Inicio: ¿ya hay sesión? ----------
  api('/me')
    .then(showApp)
    .catch(showLogin);
})();
