#!/usr/bin/env node
/**
 * Static site generator for the Fernwork storefront.
 * Zero dependencies: reads src/, writes a complete static site into dist/.
 *
 * Every page is real HTML (works without JavaScript for content/navigation);
 * src/js/app.js progressively enhances it with the cart, search, sorting, etc.
 * All internal links are relative, so dist/ can be hosted at any URL path.
 */
const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, 'src');
const DIST = path.join(__dirname, 'dist');

/* -------------------------------------------------------------------------- */
/*  Site data                                                                 */
/* -------------------------------------------------------------------------- */

const BUSINESS = JSON.parse(fs.readFileSync(path.join(SRC, 'data', 'business.json'), 'utf8'));
const B = BUSINESS;

const SITE = {
  name: "Fernwork",
  email: BUSINESS.email,
  company: BUSINESS.legalName,
  address: BUSINESS.address,
  year: new Date().getFullYear(),
  phone: BUSINESS.phone,
  legalName: BUSINESS.legalName,
  bankFacing: BUSINESS.bankFacing,
  desc: "Houseplants, planters, vases, lanterns and baskets for calm, green homes.",
};

const products = require('./src/data/products.json').products.map((p) => ({
  handle: p.handle,
  title: p.title,
  type: p.product_type,
  tags: p.tags,
  created: p.created_at,
  price: p.price,
  html: p.body_html,
  images: Array.from({ length: p.images }, (_, i) => ({
    full: `assets/img/products/${p.handle}/${i + 1}.webp`,
    sm: `assets/img/products/${p.handle}/${i + 1}-sm.webp`,
  })),
}));

const byTitle = (a, b) => a.title.localeCompare(b.title);

const collections = [
  { handle: 'all', title: 'Products', match: () => true },
  { handle: 'shop-all', title: 'Shop All', match: () => true },
  { handle: 'plants', title: 'Plants', match: (p) => p.type === 'Plants' },
  { handle: 'planters-vases', title: 'Planters & Vases', match: (p) => p.type === 'Planters & Vases' },
  { handle: 'lighting', title: 'Lighting', match: (p) => p.type === 'Lighting' },
  { handle: 'baskets-garden', title: 'Baskets & Garden', match: (p) => p.type === 'Baskets & Garden' },
];

const policies = fs
  .readdirSync(path.join(SRC, 'content', 'policies'))
  .map((f) => JSON.parse(fs.readFileSync(path.join(SRC, 'content', 'policies', f), 'utf8')));
const policyOrder = [
  'privacy-policy', 'terms-of-service', 'shipping-policy', 'refund-policy', 'payments-and-billing',
  'contact-information', 'legal-notice', 'cookies-and-privacy-choices', 'about-the-store', 'common-questions',
];
policies.sort((a, b) => policyOrder.indexOf(a.slug) - policyOrder.indexOf(b.slug));

const faqs = [
  ['What will the charge on my statement look like?', `Charges from this store appear as ${B.statementDescriptor}. Compare the amount and date with your order confirmation; if they do not match, email ${B.email} and we will trace it.`],
  ['How do I choose the right size?', "Every product page lists approximate dimensions in the specifications. Measure the space where you want to place the item, and remember that plants will grow and spread over time. If you're unsure, feel free to contact us."],
  ['How long does shipping take?', `We prepare orders in ${B.handlingDays} business days; carrier transit then usually takes ${B.transitDays} business days, so expect ${B.totalDeliveryDays} business days in total. Orders placed after ${B.cutoff} enter processing the next business day. See Shipping and delivery.`],
  ['How much does shipping cost?', "Shipping costs are calculated at checkout based on your delivery address and the items in your order. You'll see the available shipping options and charges before completing your purchase."],
  ['Can I return or exchange an item?', "You can return unused items in their original packaging within 30 days of delivery, and send them back within 14 days of asking. A plant you have clearly repotted or pruned counts as used. If something arrives damaged or wrong, email us with the order number and a description; a photo helps. See Returns, refunds and order cancellations."],
  ['How do you pack plants and fragile items?', "Plants ship in protective sleeves and sturdy boxes, early in the week to limit time in transit. Ceramics, glass and lanterns are wrapped individually and packed with protective padding."],
  ['How can I contact Fernwork?', `Email ${B.email} or call ${B.phone} during ${B.supportHours}; we usually reply ${B.responseTime}.` + " We can help with product questions, plant care advice, order concerns or general inquiries. Simply visit our Contact Us page and send us a message."],
];

/* -------------------------------------------------------------------------- */
/*  Helpers                                                                   */
/* -------------------------------------------------------------------------- */

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const money = (n) => '$' + n.toFixed(2);
const rootFor = (depth) => (depth ? '../'.repeat(depth) : './');
const plain = (html) => html.replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();

const svg = (inner, size = 20, extra = '') =>
  `<svg class="icon" width="${size}" height="${size}" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false" ${extra}>${inner}</svg>`;

const I = {
  search: svg('<circle cx="9" cy="9" r="6.25"/><path d="M13.75 13.75L18 18"/>'),
  account: svg('<circle cx="10" cy="6.5" r="3.25"/><path d="M3.5 17c.6-3.2 3.3-5 6.5-5s5.9 1.8 6.5 5"/>'),
  bag: svg('<path d="M4 6.5h12l-.9 10.2a1 1 0 0 1-1 .8H5.9a1 1 0 0 1-1-.8L4 6.5z"/><path d="M7 8.5V5.8a3 3 0 0 1 6 0v2.7"/>'),
  menu: svg('<path d="M3 7h14M3 13h14"/>'),
  close: svg('<path d="M5 5l10 10M15 5L5 15"/>'),
  caret: svg('<path d="M4.5 7.5L10 13l5.5-5.5"/>', 14),
  caretSm: svg('<path d="M4.5 7.5L10 13l5.5-5.5"/>', 12),
  arrow: svg('<path d="M3.5 10h13M11 4.5L16.5 10 11 15.5"/>', 22),
  prev: svg('<path d="M12.5 4.5L7 10l5.5 5.5"/>', 24),
  next: svg('<path d="M7.5 4.5L13 10l-5.5 5.5"/>', 24),
  plus: svg('<path d="M10 4.5v11M4.5 10h11"/>', 16),
  minus: svg('<path d="M4.5 10h11"/>', 16),
  check: svg('<path d="M4.5 10.5l3.5 3.5 7.5-8"/>'),
  gridDefault: svg('<rect x="3" y="3" width="5.5" height="5.5" rx="1"/><rect x="11.5" y="3" width="5.5" height="5.5" rx="1"/><rect x="3" y="11.5" width="5.5" height="5.5" rx="1"/><rect x="11.5" y="11.5" width="5.5" height="5.5" rx="1"/>', 18),
  gridZoom: svg('<circle cx="4.5" cy="4.5" r="1.1"/><circle cx="10" cy="4.5" r="1.1"/><circle cx="15.5" cy="4.5" r="1.1"/><circle cx="4.5" cy="10" r="1.1"/><circle cx="10" cy="10" r="1.1"/><circle cx="15.5" cy="10" r="1.1"/><circle cx="4.5" cy="15.5" r="1.1"/><circle cx="10" cy="15.5" r="1.1"/><circle cx="15.5" cy="15.5" r="1.1"/>', 18),
};

/* -------------------------------------------------------------------------- */
/*  Components                                                                */
/* -------------------------------------------------------------------------- */

function header(R, o) {
  const item = (href, label, key) =>
    `<li><a href="${href}" class="nav__link${o.active === key ? ' is-active' : ''}"${o.active === key ? ' aria-current="page"' : ''}>${label}</a></li>`;
  const nav = [
    item(R, 'Home', 'home'),
    item(`${R}collections/all/`, 'Shop', 'shop'),
    item(`${R}pages/about/`, 'About Us', 'about'),
    item(`${R}pages/faq/`, 'FAQ', 'faq'),
    item(`${R}pages/contact/`, 'Contact', 'contact'),
  ].join('');
  const searchBtn = (cls) =>
    `<button class="icon-btn ${cls}" type="button" aria-label="Search" aria-haspopup="dialog" data-open-search>${I.search}</button>`;

  return `<div class="header-group${o.overlay ? ' header-group--overlay' : ''}">
<header class="header" data-header>
  <div class="header__inner">
    <div class="header__side">
      <button class="icon-btn header__menu" type="button" aria-label="Menu" aria-controls="menu-drawer" aria-expanded="false" data-open-drawer="menu-drawer">${I.menu}</button>
      ${searchBtn('header__search--mobile')}
    </div>
    <nav class="nav" aria-label="Primary"><ul class="nav__list">${nav}</ul></nav>
    <div class="header__side header__side--right">
      ${searchBtn('header__search--desktop')}
      <button class="icon-btn" type="button" aria-label="Account" data-account>${I.account}</button>
      <button class="icon-btn" type="button" aria-label="Cart" aria-haspopup="dialog" aria-controls="cart-drawer" data-open-drawer="cart-drawer">${I.bag}<span class="cart-bubble" data-cart-count hidden>0</span></button>
    </div>
  </div>
</header>
</div>`;
}

function signup(R) {
  return `<section class="signup" aria-labelledby="signup-title">
  <div class="signup__media"><img src="${R}assets/img/newsletter.webp" alt="" width="1600" height="638" loading="lazy" decoding="async"></div>
  <div class="signup__content">
    <h2 class="h2" id="signup-title">Join the Fernwork Garden Club</h2>
    <form class="signup-form" data-signup data-signup-to="${BUSINESS.email}" data-brand="${SITE.name}" novalidate>
      <label class="visually-hidden" for="signup-email">Email</label>
      <input id="signup-email" type="email" name="email" placeholder="Email address" autocomplete="email" autocapitalize="off" autocorrect="off" required>
      <button type="submit" aria-label="Sign up">${I.arrow}</button>
      <p class="signup-form__msg" role="status" aria-live="polite" hidden></p>
    </form>
  </div>
</section>`;
}

function footer(R) {
  const col = (title, links) => `<details class="footer-menu" open>
    <summary class="footer-menu__title h4"><span>${title}</span><span class="footer-menu__caret">${I.caret}</span></summary>
    <ul class="footer-menu__list">${links.map(([l, h]) => `<li><a href="${h}">${l}</a></li>`).join('')}</ul>
  </details>`;

  return `<footer class="footer">
  <div class="footer__grid">
    ${col('Shop', [
      ['Search', `${R}search/`],
      ['Shop All', `${R}collections/shop-all/`],
      ['Plants', `${R}collections/plants/`],
      ['Planters &amp; Vases', `${R}collections/planters-vases/`],
      ['Lighting', `${R}collections/lighting/`],
      ['Baskets &amp; Garden', `${R}collections/baskets-garden/`],
    ])}
    ${col('Help', [
      ['Contact Us', `${R}policies/contact-information/`],
      ['FAQ', `${R}pages/faq/`],
      ['Shipping &amp; Delivery', `${R}policies/shipping-policy/`],
      ['Returns &amp; Refunds', `${R}policies/refund-policy/`],
      ['Payments &amp; Billing', `${R}policies/payments-and-billing/`],
      ['Common Questions', `${R}policies/common-questions/`],
    ])}
    ${col('About', [
      ['Our Story', `${R}pages/about/`],
      ['Privacy Policy', `${R}policies/privacy-policy/`],
      ['Terms of Service', `${R}policies/terms-of-service/`],
      ['Contact Details', `${R}policies/contact-information/`],
      ['About the Store', `${R}policies/about-the-store/`],
    ])}
    <div class="footer-info">
      <h4 class="footer-info__title">Business Information</h4>
      <p>${BUSINESS.legalName}</p>
      <p>${BUSINESS.address}</p>
      <p><a href="mailto:${BUSINESS.email}">${BUSINESS.email}</a></p>
      <p><a href="tel:${BUSINESS.phone.replace(/[^\d+]/g, '')}">${BUSINESS.phone}</a></p>
      <p>${BUSINESS.supportHours}</p>
    </div>
  </div>
  <div class="footer__utilities">
    <span class="footer__copy">&copy; ${SITE.year} <a href="${R}">${SITE.name}</a></span>
    <div class="policy-popover">
      <button class="policy-popover__btn" type="button" aria-expanded="false" aria-controls="policy-list" data-policy-toggle>Terms and Policies</button>
      <ul class="policy-popover__list" id="policy-list" hidden>
        ${policies.map((p) => `<li><a href="${R}policies/${p.slug}/">${esc(p.title)}</a></li>`).join('')}
      </ul>
    </div>
  </div>
</footer>`;
}

function overlays(R) {
  const menuLinks = [
    ['Home', R], ['Shop', `${R}collections/all/`], ['About Us', `${R}pages/about/`], ['FAQ', `${R}pages/faq/`], ['Contact', `${R}pages/contact/`],
  ].map(([l, h]) => `<li><a href="${h}">${l}</a></li>`).join('');

  return `<div class="backdrop" data-backdrop hidden></div>

<aside class="drawer drawer--left" id="menu-drawer" role="dialog" aria-modal="true" aria-label="Menu" aria-hidden="true" tabindex="-1">
  <div class="drawer__header"><button class="icon-btn" type="button" aria-label="Close menu" data-close-drawer>${I.close}</button></div>
  <nav class="drawer__body" aria-label="Mobile"><ul class="menu-list">${menuLinks}</ul></nav>
</aside>

<aside class="drawer drawer--right" id="cart-drawer" role="dialog" aria-modal="true" aria-labelledby="cart-title" aria-hidden="true" tabindex="-1">
  <div class="drawer__header">
    <h2 class="h4" id="cart-title">Your cart is empty</h2>
    <button class="icon-btn" type="button" aria-label="Close cart" data-close-drawer>${I.close}</button>
  </div>
  <div class="drawer__body" data-cart-body></div>
  <div class="drawer__footer" data-cart-footer hidden></div>
</aside>

<dialog class="search-modal" id="search-modal" aria-labelledby="search-title">
  <h2 class="visually-hidden" id="search-title">Search</h2>
  <form class="search-modal__form" action="${R}search/" method="get" role="search">
    <div class="search-modal__bar">
      <span class="search-modal__icon">${I.search}</span>
      <input class="search-modal__input" id="search-input" type="search" name="q" placeholder="Search" autocomplete="off" aria-label="Search" role="combobox" aria-expanded="true" aria-controls="search-results">
      <button class="search-modal__clear" type="button" hidden data-search-clear>Clear</button>
      <button class="icon-btn" type="button" aria-label="Close search" data-search-close>${I.close}</button>
    </div>
    <div class="search-modal__results" id="search-results" data-search-results></div>
    <div class="search-modal__footer"><button class="btn btn--sm" type="submit">View all</button></div>
  </form>
</dialog>

<div class="toast" role="status" aria-live="polite" data-toast hidden></div>`;
}

function layout(o) {
  const R = rootFor(o.depth);
  const desc = o.desc || SITE.desc;
  return `<!doctype html>
<html lang="en" data-root="${R}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(o.title)}</title>
<meta name="description" content="${esc(desc)}">
<meta name="theme-color" content="#ffffff">
<meta property="og:site_name" content="${SITE.name}">
<meta property="og:title" content="${esc(o.title)}">
<meta property="og:description" content="${esc(desc)}">
<meta property="og:type" content="${o.ogType || 'website'}">
<link rel="icon" href="${R}assets/favicon.svg" type="image/svg+xml">
<link rel="preload" href="${R}assets/fonts/instrument-sans-400.woff2" as="font" type="font/woff2" crossorigin>
${o.head || ''}
<link rel="stylesheet" href="${R}assets/css/style.css">
</head>
<body>
<a class="skip-link" href="#MainContent">Skip to content</a>
${header(R, o)}
<main id="MainContent">
${o.body}
</main>
${o.noSignup ? '' : signup(R)}
${footer(R)}
${overlays(R)}
<script src="${R}assets/js/products-data.js"></script>
<script src="${R}assets/js/app.js" defer></script>
</body>
</html>`;
}

/** A product card. `size` only affects typography (lg = homepage, md = collection). */
function card(R, p, { size = 'md', eager = false } = {}) {
  const href = `${R}products/${p.handle}/`;
  const imgs = p.images
    .map((im, i) => {
      const alt = i === 0 ? p.title : `${p.title} – image ${i + 1}`;
      const load = i === 0 && eager ? 'fetchpriority="high"' : 'loading="lazy"';
      return `<img class="card__img" src="${R}${im.sm}" alt="${esc(alt)}" width="640" height="640" ${load} decoding="async">`;
    })
    .join('');
  return `<article class="card card--${size}" data-handle="${p.handle}" data-title="${esc(p.title)}" data-price="${p.price}" data-created="${p.created}">
  <div class="card__gallery" data-gallery>
    <a class="card__media" href="${href}" tabindex="-1" aria-hidden="true"><div class="card__track" data-track>${imgs}</div></a>
    <button class="card__arrow card__arrow--prev" type="button" aria-label="Previous slide" data-slide="-1">${I.prev}</button>
    <button class="card__arrow card__arrow--next" type="button" aria-label="Next slide" data-slide="1">${I.next}</button>
    <div class="quick-add">
      <button class="quick-add__btn" type="button" aria-label="Add ${esc(p.title)} to cart" data-quick-add="${p.handle}">
        <span class="quick-add__icon">${I.bag}${I.check}</span><span class="quick-add__label">Add</span>
      </button>
    </div>
  </div>
  <a class="card__info" href="${href}">
    <h3 class="card__title">${esc(p.title)}</h3>
    <p class="price"><bdi>${money(p.price)}</bdi></p>
  </a>
</article>`;
}

/* -------------------------------------------------------------------------- */
/*  Pages                                                                     */
/* -------------------------------------------------------------------------- */

function homePage() {
  const R = rootFor(0);
  const body = `<section class="hero" aria-labelledby="hero-title">
  <picture>
    <source media="(max-width: 749px)" srcset="${R}assets/img/hero-mobile.webp">
    <img class="hero__img" src="${R}assets/img/hero-desktop.webp" alt="Terracotta pots, leafy plants, a cream pitcher vase, a wooden lantern and a woven basket arranged against a soft sage wall." width="1938" height="812" fetchpriority="high">
  </picture>
  <div class="hero__content">
    <h1 class="hero__title" id="hero-title">Soft light,<br>green things.</h1>
    <p class="hero__text">Plants, pots and lanterns for slower, greener homes.</p>
    <a class="btn" href="${R}collections/all/">Shop the collection</a>
  </div>
</section>
<section class="product-list" aria-labelledby="featured-title">
  <h2 class="h2 product-list__title" id="featured-title">Bring the Garden Indoors</h2>
  <div class="grid grid--home">
    ${products.map((p, i) => card(R, p, { size: 'lg', eager: i < 5 })).join('\n')}
  </div>
</section>`;
  return layout({ depth: 0, title: SITE.name, active: 'home', overlay: true, body });
}

function collectionPage(c) {
  const depth = 2;
  const R = rootFor(depth);
  const list = products.filter(c.match).sort(byTitle); // site default sort is A-Z
  const n = list.length;
  const maxPrice = Math.max(...list.map((p) => p.price));
  const body = `<div class="collection">
  <h1 class="h1 collection__title">${esc(c.title)}</h1>
  <div class="toolbar">
    <div class="toolbar__filters">
      <div class="dropdown" data-dropdown>
        <button class="toolbar__btn" type="button" aria-expanded="false" data-dropdown-toggle>Availability ${I.caretSm}</button>
        <div class="dropdown__panel" hidden>
          <label class="check"><input type="checkbox" checked disabled> <span>In stock (${n})</span></label>
          <label class="check check--disabled"><input type="checkbox" disabled> <span>Out of stock (0)</span></label>
        </div>
      </div>
      <div class="dropdown" data-dropdown>
        <button class="toolbar__btn" type="button" aria-expanded="false" data-dropdown-toggle>Price ${I.caretSm}</button>
        <div class="dropdown__panel" hidden>
          <p class="dropdown__note">The highest price is ${money(maxPrice)}</p>
          <div class="price-range">
            <label class="price-range__field"><span>$</span><input type="number" min="0" inputmode="decimal" placeholder="0" aria-label="Low price" data-price-min></label>
            <label class="price-range__field"><span>$</span><input type="number" min="0" inputmode="decimal" placeholder="${maxPrice}" aria-label="High price" data-price-max></label>
          </div>
        </div>
      </div>
      <button class="toolbar__clear" type="button" hidden data-clear-filters>Clear all</button>
    </div>
    <div class="toolbar__right">
      <span class="toolbar__count" data-count aria-live="polite">${n} ${n === 1 ? 'item' : 'items'}</span>
      <div class="dropdown dropdown--right" data-dropdown>
        <button class="toolbar__btn" type="button" aria-haspopup="listbox" aria-expanded="false" data-dropdown-toggle>Sort ${I.caretSm}</button>
        <ul class="dropdown__panel dropdown__panel--list" role="listbox" aria-label="Sort" hidden data-sort>
          ${[['featured', 'Featured'], ['relevant', 'Most relevant'], ['best', 'Best selling'], ['az', 'Alphabetically, A-Z'], ['za', 'Alphabetically, Z-A'], ['price-asc', 'Price, low to high'], ['price-desc', 'Price, high to low'], ['date-asc', 'Date, old to new'], ['date-desc', 'Date, new to old']]
            .map(([v, l]) => `<li><button type="button" role="option" data-sort-value="${v}" aria-selected="${v === 'az'}">${l}</button></li>`)
            .join('')}
        </ul>
      </div>
      <div class="view-toggle" role="radiogroup" aria-label="Grid view">
        <button type="button" role="radio" aria-checked="true" aria-label="Default" data-view="default">${I.gridDefault}</button>
        <button type="button" role="radio" aria-checked="false" aria-label="Zoom out" data-view="zoom-out">${I.gridZoom}</button>
      </div>
    </div>
  </div>
  <div class="grid grid--collection" data-grid data-view="default">
    ${list.map((p, i) => card(R, p, { size: 'md', eager: i < 5 })).join('\n')}
  </div>
  <p class="collection__empty" data-empty hidden>No products found. <button type="button" class="link-btn" data-clear-filters>Clear all</button></p>
</div>`;
  return layout({
    depth,
    title: `${c.title} – ${SITE.name}`,
    active: 'shop',
    body,
  });
}

function productPage(p) {
  const depth = 2;
  const R = rootFor(depth);
  const gallery = p.images
    .map((im, i) => {
      const alt = i === 0 ? p.title : `${p.title} – image ${i + 1}`;
      return `<button class="gallery__item${i === 0 ? ' gallery__item--main' : ''}" type="button" aria-label="Zoom media ${i + 1}" data-zoom="${i}">
        <img src="${R}${im.full}" alt="${esc(alt)}" width="1200" height="1200" ${i === 0 ? 'fetchpriority="high"' : 'loading="lazy"'} decoding="async">
      </button>`;
    })
    .join('');
  const dots = p.images.map((_, i) => `<li><button type="button" aria-label="Go to image ${i + 1}" aria-current="${i === 0}" data-dot="${i}"></button></li>`).join('');
  const related = products.filter((x) => x.handle !== p.handle).sort(byTitle).slice(0, 4);
  const desc = plain(p.html.split('</p>')[0]);

  const ld = {
    '@context': 'https://schema.org/',
    '@type': 'Product',
    name: p.title,
    image: p.images.map((im) => im.full),
    description: desc,
    brand: { '@type': 'Brand', name: SITE.name },
    offers: { '@type': 'Offer', priceCurrency: 'USD', price: p.price.toFixed(2), availability: 'https://schema.org/InStock' },
  };

  const body = `<div class="product" data-product="${p.handle}">
  <div class="product__gallery">
    <div class="gallery" data-gallery-grid>${gallery}</div>
    <ol class="gallery__dots">${dots}</ol>
  </div>
  <div class="product__info">
    <h1 class="h2 product__title">${esc(p.title)}</h1>
    <p class="product__price"><span class="price"><bdi>${money(p.price)}</bdi></span></p>
    <p class="product__ship">Shipping calculated at checkout.</p>
    <form class="buy" data-buy>
      <div class="qty" data-qty>
        <button type="button" aria-label="Decrease quantity" data-qty-dec disabled>${I.minus}</button>
        <input type="number" name="quantity" value="1" min="1" max="99" inputmode="numeric" aria-label="Quantity" data-qty-input>
        <button type="button" aria-label="Increase quantity" data-qty-inc>${I.plus}</button>
      </div>
      <button class="btn btn--buy" type="submit" data-add-main>${I.bag}<span>Add to cart</span></button>
    </form>
    <div class="rte product__desc">${p.html}</div>
    <div class="accordion">
      <details class="accordion__item"><summary>Details ${I.caret}</summary><div class="accordion__body"><p>Every Fernwork piece is chosen for its natural materials and lasting quality. Because plants, clay and woven goods are shaped by nature and by hand, small variations in colour, shape and texture are part of the charm.</p></div></details>
      <details class="accordion__item"><summary>Shipping &amp; Returns ${I.caret}</summary><div class="accordion__body"><p>Orders are packed within 1–2 business days. Live plants ship early in the week, and fragile items are wrapped and padded for the journey.</p><p>You can request a return within 30 days of delivery for unused items. Live plants can't be returned for a change of mind, but we'll replace or refund any that arrive damaged. Just get in touch and we'll be happy to help.</p></div></details>
    </div>
  </div>
</div>

<section class="related" aria-labelledby="related-title">
  <h2 class="h2 related__title" id="related-title">Shop The Full Collection</h2>
  <div class="grid grid--related">
    ${related.map((x) => card(R, x, { size: 'md' })).join('\n')}
  </div>
</section>

<div class="sticky-bar" data-sticky-bar aria-label="Quick add to cart bar" aria-hidden="true">
  <div class="sticky-bar__inner">
    <img src="${R}${p.images[0].sm}" alt="" width="52" height="52">
    <div class="sticky-bar__text"><strong>${esc(p.title)}</strong><span>${money(p.price)}</span></div>
    <button class="btn btn--sm" type="button" data-add-main tabindex="-1">${I.bag}<span>Add to cart</span></button>
  </div>
</div>

<dialog class="zoom" id="zoom" aria-label="Product image zoom">
  <button class="icon-btn zoom__close" type="button" aria-label="Close" data-zoom-close>${I.close}</button>
  <button class="icon-btn zoom__nav zoom__nav--prev" type="button" aria-label="Previous image" data-zoom-nav="-1">${I.prev}</button>
  <img class="zoom__img" src="" alt="">
  <button class="icon-btn zoom__nav zoom__nav--next" type="button" aria-label="Next image" data-zoom-nav="1">${I.next}</button>
</dialog>`;

  return layout({
    depth,
    title: `${p.title} | ${SITE.name}`,
    desc,
    active: 'shop',
    ogType: 'product',
    head: `<script type="application/ld+json">${JSON.stringify(ld)}</script>`,
    body,
  });
}

function aboutPage() {
  const depth = 2, R = rootFor(depth);
  const body = `<section class="band">
  <div class="band__inner">
    <div class="band__media"><img src="${R}assets/img/about.webp" alt="A tall leafy plant in a terracotta urn beside a blue and white vase, a woven basket and a wooden bowl on a light oak floor" width="1254" height="1254" decoding="async"></div>
    <div class="band__text">
      <h1 class="h2">A Little Green Makes Every Room Feel Like Home.</h1>
      <div class="rte rte--narrow">
        <p class="about-lede">${SITE.name} is a small online shop for houseplants, planters, vases, lanterns and baskets, sold to customers across ${B.serviceArea}.</p>
        <p> are the small ones: a plant leaning toward the window, a lantern glowing on the porch, a basket by the sofa that always has a throw in it.</p>
        <p>Those quiet details are what inspire <strong>Fernwork</strong>.</p>
        <p>We believe a home should feel calm, lived-in and a little bit alive. That's why we bring together plants, planters, vases, lanterns and baskets chosen for natural materials, honest craftsmanship and the way they look as they age.</p>
        <p><strong>That's where Fernwork comes in.</strong></p>
        <p>From a tall leafy plant for an empty corner to a hand-thrown pot for your herbs, our goal is to make it easy to fill your home with things that feel good to look at and good to live with.</p>
        <p>We're building Fernwork around a simple belief: <strong>homes are better with something growing in them.</strong></p>
        <p>Whether you're starting your first windowsill garden or styling a whole room, we're happy to be a small part of it.</p>
        <p><strong>Soft Light. Green Things.</strong></p>
        <p><em>— The Fernwork Team</em></p>
        <h3>Who you are buying from</h3>
        <p><strong>${BUSINESS.legalName}</strong>, formed in ${BUSINESS.state}, operates ${SITE.name} and handles orders, billing and returns. Our mailing address is ${BUSINESS.address}. Reach us at <a href="mailto:${BUSINESS.email}">${BUSINESS.email}</a> or <a href="tel:${BUSINESS.phone.replace(/[^\d+]/g, '')}">${BUSINESS.phone}</a> during ${BUSINESS.supportHours}.</p>
      </div>
    </div>
  </div>
</section>`;
  return layout({ depth, title: `About ${SITE.name}`, desc: `Who we are, how we ship and how to reach ${SITE.name}.`, active: 'about', body });
}

function faqPage() {
  const depth = 2;
  const body = `<section class="faq">
  <h1 class="faq__title">Frequently asked questions</h1>
  <div class="faq__list">
    ${faqs.map(([q, a]) => `<details class="faq__item"><summary>${esc(q)} ${I.caret}</summary><div class="faq__answer"><p>${esc(a)}</p></div></details>`).join('\n    ')}
  </div>
</section>`;
  return layout({ depth, title: `FAQ – ${SITE.name}`, active: 'faq', body });
}

function contactPage() {
  const depth = 2, R = rootFor(depth);
  const field = (id, name, label, type = 'text', extra = '') =>
    `<div class="field"><input id="${id}" name="${name}" type="${type}" placeholder=" " ${extra}><label for="${id}">${label}</label></div>`;
  const body = `<section class="band">
  <div class="band__inner band__inner--contact">
    <div class="band__media"><img src="${R}assets/img/contact.webp" alt="" width="1278" height="1230" decoding="async"></div>
    <div class="band__text">
      <h1 class="h2">Questions? We're Happy to Help You Grow.</h1>
      <div class="rte rte--narrow">
        <p>At Fernwork, we're here to make shopping for your home simple and stress-free.</p>
        <p>Whether you have questions about plants, sizing, shipping, or an existing order, we're always happy to help.</p>
        <p>Send us a message using the contact form below, and our team will get back to you as soon as possible.</p>
        <p><strong>Company Name:</strong> ${BUSINESS.legalName}</p>
        <p><strong>Business Address:</strong> ${BUSINESS.address}</p>
        <p><strong>Email:</strong> <a href="mailto:${BUSINESS.email}">${BUSINESS.email}</a></p>
        <p><strong>Phone:</strong> <a href="tel:${BUSINESS.phone.replace(/[^\d+]/g, '')}">${BUSINESS.phone}</a></p>
        <p><strong>Hours:</strong> ${BUSINESS.supportHours}</p>
      </div>
    </div>
  </div>
</section>
<section class="contact-form-section">
  <p class="contact-form__intro">Send a message and it opens in your email app, ready to go to ${BUSINESS.email}. Usual first reply: ${BUSINESS.responseTime}.</p>
  <form class="contact-form" data-contact data-contact-to="${BUSINESS.email}" data-brand="${SITE.name}" novalidate>
    <div class="contact-form__row">
      ${field('cf-name', 'name', 'Name', 'text', 'autocomplete="name"')}
      ${field('cf-email', 'email', 'Email<span aria-hidden="true">*</span>', 'email', 'autocomplete="email" autocapitalize="off" spellcheck="false" required')}
    </div>
    ${field('cf-phone', 'phone', 'Phone', 'tel', 'autocomplete="tel" pattern="[0-9\\-]*"')}
    <div class="field"><textarea id="cf-body" name="body" rows="10" placeholder=" "></textarea><label for="cf-body">Comment</label></div>
    <button class="btn" type="submit">Send</button>
    <p class="contact-form__msg" role="status" aria-live="polite" hidden></p>
  </form>
</section>`;
  return layout({ depth, title: `Contact – ${SITE.name}`, active: 'contact', body });
}

function policyPage(p) {
  const body = `<section class="policy">
  <h1 class="h2 policy__title">${esc(p.title)}</h1>
  <div class="rte policy__body">${p.html}</div>
</section>`;
  return layout({ depth: 2, title: `${p.title} – ${SITE.name}`, body });
}

function checkoutPage() {
  const depth = 1, R = rootFor(depth);
  const states = ['AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA','HI','ID','IL','IN','IA','KS','KY','LA','ME','MD','MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ','NM','NY','NC','ND','OH','OK','OR','PA','RI','SC','SD','TN','TX','UT','VT','VA','WA','WV','WI','WY','DC'];
  const stateOptions = states.map((s) => `<option value="${s}">${s}</option>`).join('');
  const field = (id, name, label, attrs = '') => `<div class="co-field"><label for="${id}">${label}</label><input id="${id}" name="${name}" ${attrs}><p class="co-error" data-error-for="${name}" role="alert" hidden></p></div>`;
  const body = `<section class="checkout">
  <div class="checkout__head">
    <h1 class="h2">Checkout</h1>
    <p class="checkout__secure">${esc(BUSINESS.legalName)} · Secure checkout</p>
    <ol class="checkout__steps">
      <li><a href="#co-contact">1. Contact</a></li>
      <li><a href="#co-shipping">2. Shipping</a></li>
      <li><a href="#co-payment">3. Payment</a></li>
    </ol>
  </div>
  <div class="checkout__grid">
    <form class="checkout__main" data-checkout-form data-tax-state="${B.taxState}" data-tax-rate="${B.taxRate}" data-tax-label="${B.taxLabel}" novalidate>
      <div class="co-alert" data-checkout-maintenance role="alert" tabindex="-1" hidden>
        <h2>Checkout is temporarily under maintenance</h2>
        <p>Please try again later. No payment was taken, and your items are still in your cart.</p>
        <p>Need help with an order? Email <a href="mailto:${BUSINESS.email}">${BUSINESS.email}</a> or call <a href="tel:${BUSINESS.phone.replace(/[^\d+]/g, '')}">${BUSINESS.phone}</a>.</p>
      </div>

      <section class="co-section" id="co-contact" aria-labelledby="co-contact-title">
        <h2 class="co-section__title" id="co-contact-title"><span>1</span> Contact</h2>
        <div class="co-grid">
          ${field('co-email', 'email', 'Email address', 'type="email" autocomplete="email" autocapitalize="off" spellcheck="false" required')}
          ${field('co-phone', 'phone', 'Phone', 'type="tel" autocomplete="tel" required')}
        </div>
      </section>

      <section class="co-section" id="co-shipping" aria-labelledby="co-shipping-title">
        <h2 class="co-section__title" id="co-shipping-title"><span>2</span> Shipping address</h2>
        <div class="co-grid">
          ${field('co-first-name', 'firstName', 'First name', 'type="text" autocomplete="given-name" required')}
          ${field('co-last-name', 'lastName', 'Last name', 'type="text" autocomplete="family-name" required')}
        </div>
        ${field('co-address1', 'address1', 'Street address', 'type="text" autocomplete="address-line1" required')}
        ${field('co-address2', 'address2', 'Apartment, suite, etc. (optional)', 'type="text" autocomplete="address-line2"')}
        <div class="co-grid co-grid--3">
          ${field('co-city', 'city', 'City', 'type="text" autocomplete="address-level2" required')}
          <div class="co-field"><label for="co-state">State</label><select id="co-state" name="state" autocomplete="address-level1" required><option value="">Select state</option>${stateOptions}</select><p class="co-error" data-error-for="state" role="alert" hidden></p></div>
          ${field('co-postal', 'postal', 'ZIP code', 'type="text" inputmode="numeric" autocomplete="postal-code" required')}
        </div>
        <div class="co-field"><label for="co-country">Country</label><select id="co-country" name="country" autocomplete="country-name"><option value="US" selected>United States</option></select></div>

        <h3 class="co-subtitle">Delivery method</h3>
        <div class="co-options" role="radiogroup" aria-label="Delivery method">
          <label class="co-option"><input type="radio" name="delivery" value="standard" data-delivery="6.95" checked><span><strong>Standard delivery</strong><small>Prepared in ${BUSINESS.handlingDays} business days · ${BUSINESS.transitDays} business days in transit</small></span><b>$6.95</b></label>
          <label class="co-option"><input type="radio" name="delivery" value="express" data-delivery="14.95"><span><strong>Express delivery</strong><small>Prepared in ${BUSINESS.handlingDays} business days · 1–2 business days in transit</small></span><b>$14.95</b></label>
        </div>
      </section>

      <section class="co-section" id="co-payment" aria-labelledby="co-payment-title">
        <h2 class="co-section__title" id="co-payment-title"><span>3</span> Payment</h2>
        <p class="co-note">All transactions are encrypted. Card purchases appear as <strong>${esc(BUSINESS.statementDescriptor)}</strong>. We accept ${esc(BUSINESS.paymentMethods)}.</p>
        <div class="co-cards" aria-hidden="true"><span>VISA</span><span>Mastercard</span><span>AMEX</span><span>Discover</span></div>
        ${field('co-card-name', 'cardName', 'Name on card', 'type="text" autocomplete="cc-name" required')}
        ${field('co-card-number', 'cardNumber', 'Card number', 'type="text" inputmode="numeric" autocomplete="cc-number" placeholder="1234 5678 9012 3456" required')}
        <div class="co-grid">
          ${field('co-card-expiry', 'cardExpiry', 'Expiry (MM/YY)', 'type="text" inputmode="numeric" autocomplete="cc-exp" placeholder="MM/YY" required')}
          ${field('co-card-cvc', 'cardCvc', 'Security code', 'type="text" inputmode="numeric" autocomplete="cc-csc" placeholder="CVC" required')}
        </div>
        <label class="co-check"><input type="checkbox" name="billingSame" checked data-billing-same> Billing address is the same as shipping</label>
        <div class="co-billing" data-billing-fields hidden>
          ${field('co-billing-address', 'billingAddress', 'Billing street address', 'type="text" autocomplete="billing address-line1"')}
          <div class="co-grid co-grid--3">
            ${field('co-billing-city', 'billingCity', 'Billing city', 'type="text" autocomplete="billing address-level2"')}
            ${field('co-billing-state', 'billingState', 'Billing state', 'type="text" autocomplete="billing address-level1" placeholder="${B.state}"')}
            ${field('co-billing-postal', 'billingPostal', 'Billing ZIP', 'type="text" inputmode="numeric" autocomplete="billing postal-code"')}
          </div>
        </div>
        <p class="co-form-msg" data-checkout-msg role="alert" hidden></p>
        <button class="btn co-pay" type="submit" data-pay-button>Pay now</button>
        <p class="co-fineprint">By clicking Pay now, you agree to our <a href="${R}policies/terms-of-service/">Terms of Service</a>, <a href="${R}policies/shipping-policy/">Shipping Policy</a>, <a href="${R}policies/refund-policy/">Returns &amp; Refunds</a> and <a href="${R}policies/payments-and-billing/">Payments &amp; Billing</a>.</p>
        <a class="co-return" href="${R}collections/all/">&larr; Continue shopping</a>
      </section>
    </form>

    <aside class="checkout__summary" aria-labelledby="co-summary-title">
      <h2 class="h4" id="co-summary-title">Order summary</h2>
      <div data-checkout-lines></div>
      <div class="co-empty" data-checkout-empty hidden>
        <p>Your cart is empty.</p>
        <a class="btn btn--sm" href="${R}collections/all/">Continue shopping</a>
      </div>
      <div class="co-promo">
        <label class="visually-hidden" for="co-promo">Discount code</label>
        <input id="co-promo" type="text" placeholder="Discount code" data-promo-input>
        <button class="btn btn--sm" type="button" data-promo-apply>Apply</button>
        <p class="co-promo-msg" data-promo-msg role="status" aria-live="polite" hidden></p>
      </div>
      <dl class="co-totals" data-checkout-totals></dl>
      <p class="co-note">Tax is estimated here and confirmed before payment. Shipping follows our <a href="${R}policies/shipping-policy/">Shipping Policy</a>.</p>
      <ul class="co-assurances">
        <li>Ships to ${esc(BUSINESS.serviceArea)}</li>
        <li>Returns within ${BUSINESS.returnsWindowDays} days of delivery</li>
        <li>Support: ${esc(BUSINESS.supportHours)}</li>
      </ul>
    </aside>
  </div>
</section>`;
  return layout({ depth, title: `Checkout – ${SITE.name}`, desc: `Checkout for ${SITE.name}.`, body, noSignup: true });
}

function searchPage() {
  const depth = 1, R = rootFor(depth);
  const body = `<section class="search-page">
  <h1 class="h1">Search</h1>
  <form class="search-page__form" action="${R}search/" method="get" role="search">
    <span>${I.search}</span>
    <input type="search" name="q" placeholder="Search" aria-label="Search" autocomplete="off" data-search-page-input>
    <button type="submit" class="btn btn--sm">Search</button>
  </form>
  <p class="search-page__summary" data-search-summary aria-live="polite"></p>
  <div class="grid grid--collection" data-search-grid>
    ${products.sort(byTitle).map((p) => card(R, p, { size: 'md' })).join('\n')}
  </div>
</section>`;
  return layout({ depth, title: `Search – ${SITE.name}`, body });
}

function notFoundPage() {
  const R = './';
  const body = `<section class="notfound">
  <h1 class="h1">Page not found</h1>
  <p>The page you were looking for doesn't exist or has moved.</p>
  <a class="btn" href="/collections/all/">Continue shopping</a>
</section>`;
  // 404 may be served from any path, so it uses absolute asset URLs.
  return layout({ depth: 0, title: `Page not found – ${SITE.name}`, body, noSignup: true })
    .replace(/(href|src)="\.\//g, '$1="/')
    .replace('data-root="./"', 'data-root="/"');
}

/* -------------------------------------------------------------------------- */
/*  Output                                                                    */
/* -------------------------------------------------------------------------- */

function write(rel, content) {
  const file = path.join(DIST, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
}

function copyDir(from, to) {
  fs.mkdirSync(to, { recursive: true });
  for (const e of fs.readdirSync(from, { withFileTypes: true })) {
    const s = path.join(from, e.name), d = path.join(to, e.name);
    e.isDirectory() ? copyDir(s, d) : fs.copyFileSync(s, d);
  }
}

function build() {
  const t0 = Date.now();
  fs.rmSync(DIST, { recursive: true, force: true });

  // static assets
  copyDir(path.join(SRC, 'assets'), path.join(DIST, 'assets'));
  copyDir(path.join(SRC, 'css'), path.join(DIST, 'assets', 'css'));
  copyDir(path.join(SRC, 'js'), path.join(DIST, 'assets', 'js'));

  // product data for client-side cart + search
  write(
    'assets/js/products-data.js',
    'window.FW_PRODUCTS=' +
      JSON.stringify(
        products.map((p) => ({
          handle: p.handle,
          title: p.title,
          type: p.type,
          tags: p.tags,
          price: p.price,
          img: p.images[0].sm,
          img2: (p.images[1] || p.images[0]).sm,
        }))
      ) +
      ';'
  );

  write('index.html', homePage());
  collections.forEach((c) => write(`collections/${c.handle}/index.html`, collectionPage(c)));
  products.forEach((p) => write(`products/${p.handle}/index.html`, productPage(p)));
  write('pages/about/index.html', aboutPage());
  write('pages/faq/index.html', faqPage());
  write('pages/contact/index.html', contactPage());
  policies.forEach((p) => write(`policies/${p.slug}/index.html`, policyPage(p)));
  write('checkout/index.html', checkoutPage());
  write('search/index.html', searchPage());
  write('404.html', notFoundPage());

  const pages = 1 + collections.length + products.length + 4 + policies.length + 2;
  console.log(`Built ${pages} pages into dist/ in ${Date.now() - t0}ms`);
}

function assertBankReady() {
  if (!SITE.bankFacing) return;
  const problems = [];
  for (const [key, value] of Object.entries(SITE)) {
    if (typeof value === 'string' && /\{\{|\.example\b/.test(value)) problems.push(`${key}: ${value}`);
  }
  if (!SITE.phone) problems.push('phone is empty');
  if (!SITE.legalName) problems.push('legalName is empty');
  const policyText = policies.map((p) => p.html).join(' ');
  if (/\{\{/.test(policyText)) problems.push('policies contain {{placeholders}}');
  if (/\.example\b/.test(policyText)) problems.push('policies contain .example addresses');
  if (/demonstration storefront/i.test(policyText)) problems.push('policies still call the store a demonstration');
  if (problems.length) {
    console.error('\nBank-facing shop is not ready:\n  - ' + problems.join('\n  - ') + '\n');
    process.exit(1);
  }
}

assertBankReady();
build();
