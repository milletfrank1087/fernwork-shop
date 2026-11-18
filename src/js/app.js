/* Fernwork — progressive enhancement. Plain JS, no dependencies.
   The pages are complete static HTML; this file adds the interactive layer. */
(() => {
  'use strict';

  /* ------------------------------------------------------------------ utils */
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const ROOT = document.documentElement.dataset.root || './';
  const PRODUCTS = window.FW_PRODUCTS || [];
  const bySlug = Object.fromEntries(PRODUCTS.map((p) => [p.handle, p]));
  const money = (n) => '$' + Number(n).toFixed(2);
  const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const isDesktop = () => matchMedia('(min-width: 750px)').matches;

  const store = {
    get(key, fallback) {
      try { const v = JSON.parse(localStorage.getItem(key)); return v == null ? fallback : v; } catch { return fallback; }
    },
    set(key, value) { try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* storage unavailable */ } },
  };

  let toastTimer;
  function toast(message) {
    const el = $('[data-toast]');
    el.textContent = message;
    el.hidden = false;
    requestAnimationFrame(() => el.classList.add('is-visible'));
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      el.classList.remove('is-visible');
      setTimeout(() => { el.hidden = true; }, 300);
    }, 3200);
  }

  /* ------------------------------------------------------------------- cart */
  const CART_KEY = 'fw_cart_v1';
  const cart = {
    read() {
      const lines = store.get(CART_KEY, []);
      return Array.isArray(lines) ? lines.filter((l) => bySlug[l.h] && l.q > 0) : [];
    },
    write(lines) { store.set(CART_KEY, lines); renderCart(); },
    add(handle, qty = 1) {
      const lines = this.read();
      const line = lines.find((l) => l.h === handle);
      if (line) line.q = Math.min(99, line.q + qty); else lines.push({ h: handle, q: Math.min(99, qty) });
      this.write(lines);
    },
    set(handle, qty) {
      const lines = this.read();
      const line = lines.find((l) => l.h === handle);
      if (!line) return;
      line.q = Math.max(0, Math.min(99, qty));
      this.write(lines.filter((l) => l.q > 0));
    },
    remove(handle) { this.write(this.read().filter((l) => l.h !== handle)); },
  };

  function renderCart() {
    const lines = cart.read().map((l) => ({ p: bySlug[l.h], q: l.q }));
    const count = lines.reduce((n, l) => n + l.q, 0);
    const total = lines.reduce((n, l) => n + l.p.price * l.q, 0);

    $$('[data-cart-count]').forEach((b) => { b.textContent = count > 99 ? '99+' : count; b.hidden = count === 0; });
    renderCheckout();

    const title = $('#cart-title'), body = $('[data-cart-body]'), foot = $('[data-cart-footer]');

    if (!lines.length) {
      title.textContent = 'Your cart is empty';
      body.innerHTML = `<div class="cart-empty"><p>Have an account? <a href="#" data-account>Log in</a> to check out faster.</p><a class="btn" href="${ROOT}collections/all/">Continue shopping</a></div>`;
      foot.hidden = true;
      return;
    }

    title.textContent = 'Cart';
    body.innerHTML = lines.map(({ p, q }) => `
      <div class="cart-line" data-line="${p.handle}">
        <a href="${ROOT}products/${p.handle}/"><img class="cart-line__img" src="${ROOT}${p.img}" alt="${esc(p.title)}" width="84" height="84"></a>
        <div>
          <a class="cart-line__title" href="${ROOT}products/${p.handle}/">${esc(p.title)}</a>
          <p class="cart-line__price">${money(p.price)}</p>
          <div class="qty qty--sm">
            <button type="button" aria-label="Decrease quantity of ${esc(p.title)}" data-line-dec="${p.handle}">−</button>
            <input type="number" value="${q}" min="1" max="99" aria-label="Quantity of ${esc(p.title)}" data-line-input="${p.handle}">
            <button type="button" aria-label="Increase quantity of ${esc(p.title)}" data-line-inc="${p.handle}">+</button>
          </div>
        </div>
        <div class="cart-line__total">
          <div>${money(p.price * q)}</div>
          <button class="cart-line__remove" type="button" data-line-remove="${p.handle}">Remove</button>
        </div>
      </div>`).join('');
    foot.innerHTML = `
      <div class="cart-total"><span>Estimated total</span><span>${money(total)}</span></div>
      <p class="cart-note">Taxes and shipping calculated at checkout.</p>
      <a class="btn cart-checkout" href="${ROOT}checkout/">Checkout</a>`;
    foot.hidden = false;
  }

  /* ---------------------------------------------------------------- drawers */
  let activeDrawer = null;
  let lastFocus = null;
  const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])';

  function openDrawer(id) {
    const drawer = document.getElementById(id);
    if (activeDrawer && activeDrawer !== drawer) closeDrawer(true);
    const backdrop = $('[data-backdrop]');
    lastFocus = document.activeElement;
    activeDrawer = drawer;
    backdrop.hidden = false;
    drawer.setAttribute('aria-hidden', 'false');
    document.documentElement.classList.add('is-locked');
    $$(`[aria-controls="${id}"]`).forEach((b) => b.setAttribute('aria-expanded', 'true'));
    requestAnimationFrame(() => {
      drawer.classList.add('is-open');
      backdrop.classList.add('is-open');
    });
    setTimeout(() => drawer.focus({ preventScroll: true }), 60);
  }

  function closeDrawer(skipRestore) {
    if (!activeDrawer) return;
    const drawer = activeDrawer;
    const backdrop = $('[data-backdrop]');
    activeDrawer = null;
    drawer.classList.remove('is-open');
    backdrop.classList.remove('is-open');
    drawer.setAttribute('aria-hidden', 'true');
    $$(`[aria-controls="${drawer.id}"]`).forEach((b) => b.setAttribute('aria-expanded', 'false'));
    setTimeout(() => { if (!activeDrawer) backdrop.hidden = true; }, 260);
    if (!$('#search-modal').open) document.documentElement.classList.remove('is-locked');
    if (!skipRestore && lastFocus && document.contains(lastFocus)) lastFocus.focus({ preventScroll: true });
  }

  document.addEventListener('keydown', (e) => {
    // Escape closes whatever is open (search is explicit so it doesn't rely only on native <dialog> behaviour).
    if (e.key === 'Escape') { closeDrawer(); closePolicy(); closeDropdowns(); closeSearch(); return; }
    if (e.key !== 'Tab' || !activeDrawer) return;
    // keep Tab inside the open drawer
    const items = $$(FOCUSABLE, activeDrawer).filter((el) => el.offsetParent !== null);
    if (!items.length) return;
    const first = items[0], last = items[items.length - 1];
    if (e.shiftKey && (document.activeElement === first || document.activeElement === activeDrawer)) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  });

  /* ----------------------------------------------------------------- search */
  const searchDlg = $('#search-modal');
  const searchInput = $('#search-input');
  const searchResults = $('[data-search-results]');
  const searchClear = $('[data-search-clear]');

  const tokens = (q) => q.toLowerCase().split(/\s+/).filter(Boolean);
  const haystack = (p) => `${p.title} ${p.type} ${(p.tags || []).join(' ')}`.toLowerCase();
  const matches = (p, toks) => toks.every((t) => haystack(p).includes(t));

  const searchCard = (p) => `
    <a class="search-card" href="${ROOT}products/${p.handle}/">
      <div class="search-card__media"><img src="${ROOT}${p.img}" alt="" loading="lazy"><img src="${ROOT}${p.img2}" alt="" loading="lazy"></div>
      <div class="search-card__body"><p>${esc(p.title)}</p><p>${money(p.price)}</p></div>
    </a>`;

  function renderSearch(q) {
    const toks = tokens(q);
    searchClear.hidden = !q;
    if (!toks.length) {
      const recent = store.get('fw_recent', []).map((h) => bySlug[h]).filter(Boolean).slice(0, 4);
      const popular = PRODUCTS.slice().sort((a, b) => a.title.localeCompare(b.title)).slice(0, 4);
      searchResults.innerHTML =
        (recent.length ? `<div class="search-group"><div class="search-group__head"><h3 class="search-group__title">Recently viewed</h3><button type="button" class="link-btn" data-recent-clear>Clear</button></div><div class="search-grid">${recent.map(searchCard).join('')}</div></div>` : '') +
        `<div class="search-group"><div class="search-group__head"><h3 class="search-group__title">Products</h3></div><div class="search-grid">${popular.map(searchCard).join('')}</div></div>`;
      return;
    }
    const found = PRODUCTS.filter((p) => matches(p, toks));
    searchResults.innerHTML = found.length
      ? `<div class="search-group"><div class="search-group__head"><h3 class="search-group__title">Products</h3></div><div class="search-grid">${found.slice(0, 8).map(searchCard).join('')}</div></div>`
      : `<p class="search-empty">No results found for “${esc(q)}”. Check the spelling or try a different word.</p>`;
  }

  function openSearch() {
    if (searchDlg.open) return;
    if (activeDrawer) closeDrawer(true);
    searchDlg.showModal();
    document.documentElement.classList.add('is-locked');
    searchInput.value = '';
    renderSearch('');
    searchInput.focus();
  }
  function closeSearch() { if (searchDlg.open) searchDlg.close(); }

  searchInput.addEventListener('input', () => renderSearch(searchInput.value.trim()));
  searchDlg.addEventListener('close', () => { if (!activeDrawer) document.documentElement.classList.remove('is-locked'); });
  searchDlg.addEventListener('click', (e) => { if (e.target === searchDlg) closeSearch(); });

  /* ----------------------------------------------------------------- header */
  const header = $('[data-header]');
  let lastY = window.scrollY;
  let ticking = false;
  const updateHeader = () => {
    ticking = false;
    const y = Math.max(0, window.scrollY);
    if (y <= 0) {
      header.classList.remove('is-fixed', 'is-hidden', 'is-animated');
    } else if (y < lastY - 2) {
      // scrolling up -> reveal a fixed header
      if (!header.classList.contains('is-fixed')) {
        header.classList.add('is-fixed', 'is-hidden');
        void header.offsetHeight;
        header.classList.add('is-animated');
      }
      header.classList.remove('is-hidden');
    } else if (y > lastY + 2 && y > header.offsetHeight) {
      // scrolling down -> tuck it away
      if (header.classList.contains('is-fixed')) header.classList.add('is-hidden');
    }
    lastY = y;
  };
  window.addEventListener('scroll', () => { if (!ticking) { ticking = true; requestAnimationFrame(updateHeader); } }, { passive: true });

  /* --------------------------------------------------------- card slideshows */
  $$('[data-gallery]').forEach((gallery) => {
    const track = $('[data-track]', gallery);
    if (!track) return;
    const count = track.children.length;
    const index = () => Math.round(track.scrollLeft / (track.clientWidth || 1));
    const go = (i) => track.scrollTo({ left: i * track.clientWidth, behavior: reduced ? 'auto' : 'smooth' });
    let previewing = false, userMoved = false;

    gallery.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-slide]');
      if (!btn) return;
      e.preventDefault();
      userMoved = true;
      let i = index() + Number(btn.dataset.slide);
      if (i < 0) i = count - 1;
      if (i >= count) i = 0;
      go(i);
    });

    // hovering with a mouse previews the second photo, like the original
    gallery.addEventListener('pointerenter', (e) => {
      if (e.pointerType !== 'mouse' || count < 2) return;
      if (track.children[1]) track.children[1].loading = 'eager';
      if (index() === 0) { previewing = true; go(1); }
    });
    gallery.addEventListener('pointerleave', (e) => {
      if (e.pointerType !== 'mouse') return;
      if (previewing && !userMoved) go(0);
      previewing = false;
      userMoved = false;
    });
  });

  /* ------------------------------------------------------- global click hub */
  document.addEventListener('click', (e) => {
    const t = e.target;
    const hit = (sel) => t.closest(sel);
    let el;

    if ((el = hit('[data-open-drawer]'))) { e.preventDefault(); openDrawer(el.dataset.openDrawer); return; }
    if (hit('[data-close-drawer]') || hit('[data-backdrop]')) { e.preventDefault(); closeDrawer(); return; }
    if (hit('[data-open-search]')) { e.preventDefault(); openSearch(); return; }
    if (hit('[data-search-close]')) { e.preventDefault(); closeSearch(); return; }
    if (hit('[data-search-clear]')) { searchInput.value = ''; renderSearch(''); searchInput.focus(); return; }
    if (hit('[data-recent-clear]')) { store.set('fw_recent', []); renderSearch(searchInput.value.trim()); return; }

    if (hit('[data-account]')) { e.preventDefault(); toast('Accounts are not available yet — please check out as a guest.'); return; }

    if ((el = hit('[data-quick-add]'))) {
      e.preventDefault();
      cart.add(el.dataset.quickAdd, 1);
      el.classList.add('is-added');
      setTimeout(() => el.classList.remove('is-added'), 1600);
      setTimeout(() => openDrawer('cart-drawer'), reduced ? 0 : 420);
      return;
    }

    // cart line controls
    if ((el = hit('[data-line-inc]'))) { const l = cart.read().find((x) => x.h === el.dataset.lineInc); if (l) cart.set(l.h, l.q + 1); return; }
    if ((el = hit('[data-line-dec]'))) { const l = cart.read().find((x) => x.h === el.dataset.lineDec); if (l) cart.set(l.h, l.q - 1); return; }
    if ((el = hit('[data-line-remove]'))) { cart.remove(el.dataset.lineRemove); return; }

    // popovers / dropdowns close on outside click
    if (!hit('.policy-popover')) closePolicy();
    if (!hit('[data-dropdown]')) closeDropdowns();
  });

  document.addEventListener('change', (e) => {
    const input = e.target.closest('[data-line-input]');
    if (input) cart.set(input.dataset.lineInput, parseInt(input.value, 10) || 1);
  });

  /* ------------------------------------------------------ footer + popovers */
  $$('.footer-menu').forEach((d) => {
    $('summary', d).addEventListener('click', (e) => { if (isDesktop()) e.preventDefault(); });
  });
  matchMedia('(min-width: 750px)').addEventListener('change', (m) => {
    if (m.matches) $$('.footer-menu').forEach((d) => { d.open = true; });
  });

  const policyBtn = $('[data-policy-toggle]');
  const policyList = $('#policy-list');
  function closePolicy() { if (!policyList.hidden) { policyList.hidden = true; policyBtn.setAttribute('aria-expanded', 'false'); } }
  policyBtn.addEventListener('click', () => {
    const open = policyList.hidden;
    policyList.hidden = !open;
    policyBtn.setAttribute('aria-expanded', String(open));
  });
  /* ---------------------------------------------------------------- forms */
  const validEmail = (v) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim());

  $$('[data-signup]').forEach((form) => {
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const input = form.elements.email;
      const msg = $('.signup-form__msg', form);
      msg.hidden = false;
      if (!validEmail(input.value)) { msg.textContent = 'Please enter a valid email address.'; input.focus(); return; }
      // no backend: the address goes to the monitored inbox as a subscription request
      const to = form.dataset.signupTo;
      const href = `mailto:${to}?subject=${encodeURIComponent(form.dataset.brand + ' newsletter sign-up')}&body=${encodeURIComponent('Please add ' + input.value + ' to the list.')}`;
      msg.innerHTML = `Thanks — ${input.value} is on the list. If no email opens, send it to <a href="${href}">${to}</a>.`;
      window.location.href = href;
      form.reset();
    });
  });

  const contact = $('[data-contact]');
  if (contact) {
    contact.addEventListener('submit', (e) => {
      e.preventDefault();
      const msg = $('.contact-form__msg', contact);
      msg.hidden = false;
      const email = contact.elements.email.value;
      if (!validEmail(email)) { msg.textContent = 'Please enter a valid email address.'; contact.elements.email.focus(); return; }
      const body = contact.elements.body.value.trim();
      if (!body) { msg.textContent = 'Please add a comment.'; contact.elements.body.focus(); return; }
      // no backend: hand the message to the visitor's mail client, addressed to the monitored inbox
      const to = contact.dataset.contactTo;
      const subject = `${contact.dataset.brand} enquiry from ${contact.elements.name.value || email}`;
      const lines = [`Name: ${contact.elements.name.value || '-'}`, `Email: ${email}`];
      if (contact.elements.phone && contact.elements.phone.value) lines.push(`Phone: ${contact.elements.phone.value}`);
      lines.push('', body);
      const href = `mailto:${to}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(lines.join('\n'))}`;
      msg.innerHTML = `Opening your email app. If nothing happens, mail <a href="${href}">${to}</a> directly.`;
      window.location.href = href;
    });
  }

  /* ---------------------------------------------------------- checkout */
  const checkoutForm = $('[data-checkout-form]');
  function renderCheckout() {
    if (!checkoutForm) return;
    const linesEl = $('[data-checkout-lines]');
    const emptyEl = $('[data-checkout-empty]');
    const totalsEl = $('[data-checkout-totals]');
    const payBtn = $('[data-pay-button]');
    if (!linesEl || !totalsEl || !payBtn) return;

    const lines = cart.read().map((l) => ({ p: bySlug[l.h], q: l.q }));
    const subtotal = lines.reduce((n, l) => n + l.p.price * l.q, 0);
    const deliveryEl = $('input[name="delivery"]:checked', checkoutForm);
    const shipping = lines.length && deliveryEl ? Number(deliveryEl.dataset.delivery || 0) : 0;
    const state = checkoutForm.elements.state ? checkoutForm.elements.state.value : '';
    const taxRate = state === 'MI' ? 0.06 : 0;
    const tax = Math.round(subtotal * taxRate * 100) / 100;
    const total = subtotal + shipping + tax;

    linesEl.innerHTML = lines.map(({ p, q }) => `
      <div class="co-line">
        <img src="${ROOT}${p.img}" alt="${esc(p.title)}" width="64" height="64">
        <div class="co-line__info">
          <p class="co-line__title">${esc(p.title)}</p>
          <div class="qty qty--sm">
            <button type="button" aria-label="Decrease quantity of ${esc(p.title)}" data-line-dec="${p.handle}">−</button>
            <input type="number" value="${q}" min="1" max="99" aria-label="Quantity of ${esc(p.title)}" data-line-input="${p.handle}">
            <button type="button" aria-label="Increase quantity of ${esc(p.title)}" data-line-inc="${p.handle}">+</button>
          </div>
          <button class="co-line__remove" type="button" data-line-remove="${p.handle}">Remove</button>
        </div>
        <b>${money(p.price * q)}</b>
      </div>`).join('');
    emptyEl.hidden = lines.length > 0;
    totalsEl.innerHTML = `
      <div><dt>Subtotal</dt><dd>${money(subtotal)}</dd></div>
      <div><dt>Shipping</dt><dd>${lines.length ? money(shipping) : '—'}</dd></div>
      <div><dt>Estimated tax${taxRate ? ' (MI 6%)' : ''}</dt><dd>${money(tax)}</dd></div>
      <div class="co-totals__total"><dt>Total</dt><dd>${money(total)}</dd></div>`;
    payBtn.disabled = !lines.length;
    payBtn.textContent = lines.length ? `Pay ${money(total)}` : 'Pay now';
  }

  if (checkoutForm) {
    const payBtn = $('[data-pay-button]');
    const maintenance = $('[data-checkout-maintenance]');
    const formMsg = $('[data-checkout-msg]');
    const errFor = (name) => $(`[data-error-for="${name}"]`, checkoutForm);
    const setError = (input, message) => {
      const box = errFor(input.name);
      if (box) { box.textContent = message || ''; box.hidden = !message; }
      input.setAttribute('aria-invalid', message ? 'true' : 'false');
      input.classList.toggle('is-invalid', !!message);
      return !message;
    };
    const digits = (v) => String(v || '').replace(/\D/g, '');
    const luhnOk = (num) => {
      let sum = 0, dbl = false;
      for (let i = num.length - 1; i >= 0; i--) {
        let d = Number(num[i]);
        if (dbl) { d *= 2; if (d > 9) d -= 9; }
        sum += d; dbl = !dbl;
      }
      return num.length >= 12 && sum % 10 === 0;
    };
    const validate = (input) => {
      const v = input.value.trim();
      const name = input.name;
      if (input.disabled) return true;
      if (name === 'address2') return setError(input, '');
      if (!v) return setError(input, 'This field is required.');
      if (name === 'email' && !validEmail(v)) return setError(input, 'Enter a valid email address.');
      if (name === 'phone' && digits(v).length < 10) return setError(input, 'Enter a valid phone number.');
      if ((name === 'postal' || name === 'billingPostal') && !/^\d{5}(-\d{4})?$/.test(v)) return setError(input, 'Enter a valid ZIP code.');
      if (name === 'cardNumber' && !luhnOk(digits(v))) return setError(input, 'Enter a valid card number.');
      if (name === 'cardExpiry') {
        const m = v.match(/^(0[1-9]|1[0-2])\/(\d{2})$/);
        if (!m) return setError(input, 'Use MM/YY.');
        const exp = new Date(2000 + Number(m[2]), Number(m[1]), 0, 23, 59, 59);
        if (exp < new Date()) return setError(input, 'This card has expired.');
      }
      if (name === 'cardCvc' && !/^\d{3,4}$/.test(v)) return setError(input, 'Enter the 3–4 digit code.');
      return setError(input, '');
    };

    // summary + totals stay in sync with the cart drawer controls and options
    $$('input[name="delivery"]', checkoutForm).forEach((el) => el.addEventListener('change', renderCheckout));
    checkoutForm.elements.state.addEventListener('change', renderCheckout);

    const billingSame = $('[data-billing-same]', checkoutForm);
    const billingFields = $('[data-billing-fields]', checkoutForm);
    const syncBilling = () => {
      const same = billingSame.checked;
      billingFields.hidden = same;
      $$('input', billingFields).forEach((i) => { i.disabled = same; if (same) setError(i, ''); });
    };
    billingSame.addEventListener('change', syncBilling);
    syncBilling();

    // input formatting (values are only used for local validation; nothing is sent or stored)
    checkoutForm.elements.cardNumber.addEventListener('input', (e) => {
      const d = digits(e.target.value).slice(0, 19);
      e.target.value = d.replace(/(.{4})/g, '$1 ').trim();
    });
    checkoutForm.elements.cardExpiry.addEventListener('input', (e) => {
      const d = digits(e.target.value).slice(0, 4);
      e.target.value = d.length > 2 ? `${d.slice(0, 2)}/${d.slice(2)}` : d;
    });
    checkoutForm.elements.cardCvc.addEventListener('input', (e) => { e.target.value = digits(e.target.value).slice(0, 4); });
    $$('input, select', checkoutForm).forEach((el) => el.addEventListener('blur', () => { if (el.name) validate(el); }));

    const promoBtn = $('[data-promo-apply]');
    if (promoBtn) promoBtn.addEventListener('click', () => {
      const input = $('[data-promo-input]');
      const msg = $('[data-promo-msg]');
      msg.hidden = false;
      msg.textContent = input.value.trim() ? 'That discount code is not valid.' : 'Enter a discount code first.';
      if (input.value.trim()) input.focus();
    });

    checkoutForm.addEventListener('submit', (e) => {
      e.preventDefault();
      maintenance.hidden = true;
      formMsg.hidden = true;
      if (!cart.read().length) {
        formMsg.textContent = 'Your cart is empty. Add an item before checking out.';
        formMsg.hidden = false;
        formMsg.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'center' });
        return;
      }
      const fields = $$('input, select', checkoutForm).filter((el) => el.name && el.type !== 'radio' && el.type !== 'checkbox');
      let firstInvalid = null;
      fields.forEach((el) => { if (!validate(el) && !firstInvalid) firstInvalid = el; });
      if (firstInvalid) {
        formMsg.textContent = 'Please check the highlighted fields and try again.';
        formMsg.hidden = false;
        firstInvalid.focus();
        firstInvalid.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'center' });
        return;
      }
      // Checkout is paused for maintenance: never transmit or store payment details, never clear the cart.
      maintenance.hidden = false;
      maintenance.focus();
      maintenance.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'center' });
      toast('Checkout is temporarily under maintenance — please try again later.');
    });
    renderCheckout();
  }

  /* ------------------------------------------------------ collection page */
  function closeDropdowns(except) {
    $$('[data-dropdown]').forEach((d) => {
      if (d === except) return;
      const btn = $('[data-dropdown-toggle]', d), panel = $('.dropdown__panel', d);
      if (panel && !panel.hidden) { panel.hidden = true; btn.setAttribute('aria-expanded', 'false'); }
    });
  }

  $$('[data-dropdown]').forEach((d) => {
    const btn = $('[data-dropdown-toggle]', d), panel = $('.dropdown__panel', d);
    btn.addEventListener('click', () => {
      const open = panel.hidden;
      closeDropdowns(d);
      panel.hidden = !open;
      btn.setAttribute('aria-expanded', String(open));
    });
  });

  const grid = $('[data-grid]');
  if (grid) {
    const cards = $$('.card', grid);
    const minEl = $('[data-price-min]'), maxEl = $('[data-price-max]');
    const countEl = $('[data-count]'), emptyEl = $('[data-empty]');
    const clearBtns = $$('[data-clear-filters]');
    const featuredIdx = (c) => PRODUCTS.findIndex((p) => p.handle === c.dataset.handle);
    const num = (c) => Number(c.dataset.price);
    const time = (c) => new Date(c.dataset.created).getTime();
    // "Featured", "Most relevant" and "Best selling" all mean the catalogue order (the default below).
    const comparators = {
      az: (a, b) => a.dataset.title.localeCompare(b.dataset.title),
      za: (a, b) => b.dataset.title.localeCompare(a.dataset.title),
      'price-asc': (a, b) => num(a) - num(b),
      'price-desc': (a, b) => num(b) - num(a),
      'date-asc': (a, b) => time(a) - time(b),
      'date-desc': (a, b) => time(b) - time(a),
    };
    let sort = 'az';

    const apply = () => {
      const min = parseFloat(minEl.value) || 0;
      const max = maxEl.value === '' ? Infinity : parseFloat(maxEl.value);
      let shown = 0;
      cards.slice().sort(comparators[sort] || ((a, b) => featuredIdx(a) - featuredIdx(b))).forEach((c) => {
        grid.appendChild(c);
        const ok = num(c) >= min && num(c) <= max;
        c.hidden = !ok;
        if (ok) shown++;
      });
      countEl.textContent = `${shown} ${shown === 1 ? 'item' : 'items'}`;
      emptyEl.hidden = shown > 0;
      clearBtns[0].hidden = !(minEl.value || maxEl.value);
    };

    minEl.addEventListener('input', apply);
    maxEl.addEventListener('input', apply);
    clearBtns.forEach((b) => b.addEventListener('click', () => { minEl.value = ''; maxEl.value = ''; apply(); }));

    $$('[data-sort-value]').forEach((opt) => {
      opt.addEventListener('click', () => {
        sort = opt.dataset.sortValue;
        $$('[data-sort-value]').forEach((o) => o.setAttribute('aria-selected', String(o === opt)));
        closeDropdowns();
        apply();
      });
    });

    $$('[data-view]').forEach((b) => {
      b.addEventListener('click', () => {
        grid.dataset.view = b.dataset.view;
        $$('[data-view]').forEach((x) => x.setAttribute('aria-checked', String(x === b)));
      });
    });
  }

  /* ---------------------------------------------------------- search page */
  const searchGrid = $('[data-search-grid]');
  if (searchGrid) {
    const q = (new URLSearchParams(location.search).get('q') || '').trim();
    const input = $('[data-search-page-input]');
    const summary = $('[data-search-summary]');
    input.value = q;
    const toks = tokens(q);
    let n = 0;
    $$('.card', searchGrid).forEach((c) => {
      const p = bySlug[c.dataset.handle];
      const ok = !toks.length || matches(p, toks);
      c.hidden = !ok;
      if (ok) n++;
    });
    summary.textContent = q
      ? (n ? `${n} ${n === 1 ? 'result' : 'results'} for “${q}”` : `No results found for “${q}”. Check the spelling or use a different word or phrase.`)
      : `${n} products`;
  }

  /* ---------------------------------------------------------- product page */
  const product = $('[data-product]');
  if (product) {
    const handle = product.dataset.product;

    // recently viewed (feeds the search modal)
    store.set('fw_recent', [handle, ...store.get('fw_recent', []).filter((h) => h !== handle)].slice(0, 8));

    // quantity stepper
    const qtyInput = $('[data-qty-input]'), dec = $('[data-qty-dec]'), inc = $('[data-qty-inc]');
    const readQty = () => Math.max(1, Math.min(99, parseInt(qtyInput.value, 10) || 1));
    const syncQty = () => { qtyInput.value = readQty(); dec.disabled = readQty() <= 1; inc.disabled = readQty() >= 99; };
    dec.addEventListener('click', () => { qtyInput.value = readQty() - 1; syncQty(); });
    inc.addEventListener('click', () => { qtyInput.value = readQty() + 1; syncQty(); });
    qtyInput.addEventListener('change', syncQty);

    // add to cart (main button + sticky bar)
    const addToCart = () => { cart.add(handle, readQty()); openDrawer('cart-drawer'); };
    const buy = $('[data-buy]');
    buy.addEventListener('submit', (e) => { e.preventDefault(); addToCart(); });
    $$('[data-sticky-bar] [data-add-main]').forEach((b) => b.addEventListener('click', addToCart));

    // sticky quick-add bar: appears once the main buy box has scrolled out of view
    const bar = $('[data-sticky-bar]');
    new IntersectionObserver(([entry]) => {
      const show = !entry.isIntersecting && entry.boundingClientRect.top < 0;
      bar.classList.toggle('is-visible', show);
      bar.setAttribute('aria-hidden', String(!show));
      $$('button', bar).forEach((b) => { b.tabIndex = show ? 0 : -1; });
    }).observe(buy);

    // image zoom
    const zoom = $('#zoom');
    const imgs = $$('[data-zoom] img');
    let zoomIndex = 0;
    const showZoom = (i) => {
      zoomIndex = (i + imgs.length) % imgs.length;
      const src = imgs[zoomIndex];
      $('.zoom__img', zoom).src = src.currentSrc || src.src;
      $('.zoom__img', zoom).alt = src.alt;
    };
    $$('[data-zoom]').forEach((b) => b.addEventListener('click', () => { showZoom(Number(b.dataset.zoom)); zoom.showModal(); }));
    $$('[data-zoom-nav]', zoom).forEach((b) => b.addEventListener('click', () => showZoom(zoomIndex + Number(b.dataset.zoomNav))));
    $('[data-zoom-close]', zoom).addEventListener('click', () => zoom.close());
    zoom.addEventListener('click', (e) => { if (e.target === zoom) zoom.close(); });
    zoom.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowLeft') showZoom(zoomIndex - 1);
      if (e.key === 'ArrowRight') showZoom(zoomIndex + 1);
    });

    // mobile gallery dots
    const track = $('[data-gallery-grid]');
    const dots = $$('[data-dot]');
    track.addEventListener('scroll', () => {
      if (isDesktop()) return;
      const i = Math.round(track.scrollLeft / (track.clientWidth || 1));
      dots.forEach((d, n) => d.setAttribute('aria-current', String(n === i)));
    }, { passive: true });
    dots.forEach((d) => d.addEventListener('click', () => track.scrollTo({ left: Number(d.dataset.dot) * track.clientWidth, behavior: reduced ? 'auto' : 'smooth' })));
  }

  /* ------------------------------------------------------------------ init */
  renderCart();
  // Coming back via the browser's Back button can restore a frozen page with an old cart badge.
  window.addEventListener('pageshow', (e) => { if (e.persisted) renderCart(); });
})();
