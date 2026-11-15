// Navegación: fondo suave al hacer scroll
  const nav = document.getElementById('nav');
  const onScroll = () => nav.classList.toggle('scrolled', window.scrollY > 40);
  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();

  // Animaciones de entrada al hacer scroll
  const items = document.querySelectorAll('.reveal');
  if ('IntersectionObserver' in window) {
    const io = new IntersectionObserver((entries) => {
      entries.forEach(e => {
        if (e.isIntersecting) {
          e.target.classList.add('in');
          io.unobserve(e.target);
        }
      });
    }, { threshold: 0.15, rootMargin: '0px 0px -40px 0px' });
    items.forEach(el => io.observe(el));
  } else {
    items.forEach(el => el.classList.add('in'));
  }

  // Parallax muy sutil en el resplandor del hero
  const glow = document.querySelector('.hero .glow');
  window.addEventListener('scroll', () => {
    if (window.scrollY < window.innerHeight) {
      glow.style.marginTop = (window.scrollY * 0.15) + 'px';
    }
  }, { passive: true });


// Movimiento suave de los granos de la portada al mover el puntero (solo si el usuario acepta animaciones)
(() => {
  const hero = document.querySelector('.hero');
  const beans = document.querySelector('.beans');
  if (!hero || !beans || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  hero.addEventListener('pointermove', (e) => {
    const r = hero.getBoundingClientRect();
    const x = (e.clientX - r.left) / r.width - 0.5;
    const y = (e.clientY - r.top) / r.height - 0.5;
    beans.style.transform = `translate(${(-x * 36).toFixed(1)}px, ${(-y * 26).toFixed(1)}px)`;
  });
  hero.addEventListener('pointerleave', () => { beans.style.transform = ''; });
})();
