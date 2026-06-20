import { db } from './firebase-config.js';
import {
    collection, onSnapshot, query, where, orderBy,
    addDoc, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

const WA = '919079661164';

/* ============================================================
   COLOUR MAP  (name → hex for colour dots in modal)
   ============================================================ */
const COLOR_HEX = {
    'Black':    '#1a1a1a', 'White':   '#f0f0f0', 'Navy':    '#1e3a5f',
    'Blue':     '#2563eb', 'Sky Blue':'#38bdf8',  'Red':     '#dc2626',
    'Green':    '#16a34a', 'Grey':    '#6b7280',  'Gray':    '#6b7280',
    'Yellow':   '#f59e0b', 'Orange':  '#ea580c',  'Pink':    '#ec4899',
    'Purple':   '#9333ea', 'Brown':   '#92400e',  'Maroon':  '#881337',
    'Olive':    '#808000', 'Beige':   '#d4c5a9',  'Cream':   '#fffdd0',
    'Khaki':    '#c3b091', 'Teal':    '#0f766e',  'Mint':    '#34d399',
    'Burgundy': '#7f1d1d', 'Mustard': '#d97706',  'Charcoal':'#374151',
    'Off White':'#f5f5dc',
};

/* Default sizes shown in modal when product has none set */
const DEFAULT_SIZES = {
    'T-Shirt': ['S','M','L','XL','XXL'],
    'Shirt':   ['S','M','L','XL','XXL'],
    'Hoodie':  ['S','M','L','XL','XXL','3XL'],
    'Jeans':   ['28','30','32','34','36','38'],
};

/* ============================================================
   STATE
   ============================================================ */
let allProducts    = [];
let productsCache  = {};
let activeCat      = '';
let activeSort     = '';

/* ============================================================
   PRODUCT CARD
   ============================================================ */
function productCard(p) {
    const discount = p.originalPrice && p.originalPrice > p.price
        ? Math.round((1 - p.price / p.originalPrice) * 100) : null;

    const badgeHtml    = p.badge ? `<span class="badge-${p.badge.toLowerCase()}">${p.badge}</span>` : '';
    const discountBadge = discount ? `<span class="badge-sale">-${discount}%</span>` : '';
    const imgHtml      = p.imageUrl
        ? `<img src="${p.imageUrl}" alt="${p.name}" loading="lazy">`
        : `<div class="product-icon"><i class="fas fa-${iconFor(p.category)}"></i></div>`;
    const origPriceHtml = p.originalPrice && p.originalPrice > p.price
        ? `<span class="price-original">₹${p.originalPrice.toLocaleString('en-IN')}</span>` : '';

    return `
    <div class="product-card reveal" onclick="openProductModal('${p.id}')">
        <div class="product-img ${p.imageUrl ? 'has-photo' : bgClass(p.category)}">
            ${imgHtml}
            <div class="product-hover"><span class="btn btn-gold">View Details</span></div>
            ${badgeHtml}${discountBadge}
        </div>
        <div class="product-body">
            <h3>${p.name}</h3>
            <p>${p.description}</p>
            <div class="product-price">
                <span class="price-main">₹${p.price.toLocaleString('en-IN')}</span>
                ${origPriceHtml}
            </div>
            <button class="btn btn-outline-dark btn-sm"
                onclick="event.stopPropagation();openProductModal('${p.id}')">
                <i class="fas fa-ruler"></i> Select Size &amp; Colour
            </button>
        </div>
    </div>`;
}

function iconFor(cat) {
    return { 'T-Shirt':'tshirt', 'Shirt':'user-tie', 'Hoodie':'hat-wizard', 'Jeans':'drafting-compass' }[cat] || 'tshirt';
}
function bgClass(cat) {
    return { 'T-Shirt':'bg-tshirt', 'Shirt':'bg-shirt', 'Hoodie':'bg-hoodie', 'Jeans':'bg-jeans' }[cat] || 'bg-tshirt';
}

/* ============================================================
   RENDER WITH FILTER / SORT
   ============================================================ */
function renderProducts() {
    let products = [...allProducts];
    if (activeCat)          products = products.filter(p => p.category === activeCat);
    if (activeSort === 'low')  products.sort((a, b) => a.price - b.price);
    if (activeSort === 'high') products.sort((a, b) => b.price - a.price);

    grid.style.display  = 'grid';
    empty.style.display = 'none';

    if (!products.length) {
        grid.innerHTML = `<div style="grid-column:1/-1;text-align:center;padding:60px 24px;color:#666;">
            <i class="fas fa-box-open" style="font-size:2.5rem;color:#ddd;display:block;margin-bottom:12px;"></i>
            <p>No products in this category yet.</p></div>`;
    } else {
        grid.innerHTML = products.map(p => productCard(p)).join('');
        activateReveal(grid.querySelectorAll('.reveal'));
    }
}

const grid    = document.getElementById('productsGrid');
const loading = document.getElementById('productsLoading');
const empty   = document.getElementById('productsEmpty');

const q = query(collection(db, 'products'), where('available', '==', true), orderBy('order', 'asc'));

onSnapshot(q, snap => {
    loading.style.display = 'none';
    if (snap.empty) { empty.style.display = 'block'; grid.style.display = 'none'; return; }
    allProducts   = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    productsCache = {};
    allProducts.forEach(p => { productsCache[p.id] = p; });
    renderProducts();
}, err => {
    console.error('Firestore error:', err);
    loading.style.display = 'none';
    empty.style.display   = 'block';
});

/* ============================================================
   FILTER BAR
   ============================================================ */
document.querySelectorAll('.cat-tab').forEach(btn => {
    btn.addEventListener('click', () => {
        document.querySelectorAll('.cat-tab').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        activeCat = btn.dataset.cat;
        renderProducts();
    });
});

const sortSelect = document.getElementById('sortSelect');
if (sortSelect) {
    sortSelect.addEventListener('change', () => {
        activeSort = sortSelect.value;
        renderProducts();
    });
}

/* ============================================================
   PRODUCT DETAIL MODAL
   ============================================================ */
let selectedSize   = '';
let selectedColor  = '';
let currentProduct = null;

window.openProductModal = function(id) {
    const p = productsCache[id];
    if (!p) return;
    currentProduct = p;
    selectedSize   = '';
    selectedColor  = '';

    /* Image */
    const img = document.getElementById('pdImg');
    const placeholder = document.getElementById('pdImgPlaceholder');
    if (p.imageUrl) {
        img.src = p.imageUrl;
        img.alt = p.name;
        img.style.display = 'block';
        placeholder.style.display = 'none';
    } else {
        img.style.display = 'none';
        placeholder.innerHTML = `<i class="fas fa-${iconFor(p.category)}"></i>`;
        placeholder.style.display = 'flex';
    }
    const imgCol = document.getElementById('pdImageCol');
    imgCol.className = 'pd-image-col ' + (p.imageUrl ? '' : bgClass(p.category));

    /* Badge */
    const badge = document.getElementById('pdBadge');
    if (p.badge) {
        badge.textContent = p.badge;
        badge.className   = `pd-badge badge-${p.badge.toLowerCase()}`;
        badge.style.display = 'inline-block';
    } else {
        badge.style.display = 'none';
    }

    /* Texts */
    document.getElementById('pdCategory').textContent = p.category;
    document.getElementById('pdName').textContent     = p.name;
    document.getElementById('pdPrice').textContent    = `₹${p.price.toLocaleString('en-IN')}`;

    const origEl     = document.getElementById('pdPriceOrig');
    const discountEl = document.getElementById('pdDiscount');
    if (p.originalPrice && p.originalPrice > p.price) {
        origEl.textContent     = `₹${p.originalPrice.toLocaleString('en-IN')}`;
        origEl.style.display   = 'inline';
        discountEl.textContent = `${Math.round((1 - p.price / p.originalPrice) * 100)}% OFF`;
        discountEl.style.display = 'inline-block';
    } else {
        origEl.style.display     = 'none';
        discountEl.style.display = 'none';
    }

    document.getElementById('pdDesc').textContent = p.description || '';
    const fabricEl = document.getElementById('pdFabric');
    if (p.fabric) {
        fabricEl.innerHTML    = `<strong>Fabric:</strong> ${p.fabric}`;
        fabricEl.style.display = 'block';
    } else {
        fabricEl.style.display = 'none';
    }

    /* Size guide */
    buildSizeGuide(p.category);

    /* Sizes */
    const sizes = (p.sizes && p.sizes.length) ? p.sizes : (DEFAULT_SIZES[p.category] || ['S','M','L','XL','XXL']);
    document.getElementById('pdSizeBtns').innerHTML = sizes.map(s =>
        `<button class="size-btn" onclick="selectSize('${s}',this)">${s}</button>`
    ).join('');

    /* Colours */
    const colorBtns = document.getElementById('pdColorBtns');
    if (p.colors && p.colors.length) {
        colorBtns.innerHTML = p.colors.map(c => {
            const hex = COLOR_HEX[c] || '#888';
            return `<button class="color-btn" onclick="selectColor('${c}',this)">
                <span class="color-dot" style="background:${hex}"></span>
                <span class="color-label">${c}</span>
            </button>`;
        }).join('');
    } else {
        colorBtns.innerHTML = `<p class="pd-no-select">All colours available — mention your preference on WhatsApp</p>`;
    }

    /* Reset tabs */
    document.querySelectorAll('.pd-tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.pd-tab-content').forEach(c => c.classList.remove('active'));
    document.querySelector('.pd-tab[data-tab="details"]').classList.add('active');
    document.getElementById('pdTabDetails').classList.add('active');

    const overlay = document.getElementById('pdOverlay');
    overlay.style.display = 'flex';
    requestAnimationFrame(() => requestAnimationFrame(() => overlay.classList.add('open')));
    document.body.style.overflow = 'hidden';
};

window.closeProductModal = function() {
    const overlay = document.getElementById('pdOverlay');
    overlay.classList.remove('open');
    overlay.addEventListener('transitionend', () => { overlay.style.display = 'none'; }, { once: true });
    document.body.style.overflow = '';
};

window.switchPdTab = function(tab, el) {
    document.querySelectorAll('.pd-tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.pd-tab-content').forEach(c => c.classList.remove('active'));
    el.classList.add('active');
    document.getElementById('pdTab' + tab.charAt(0).toUpperCase() + tab.slice(1)).classList.add('active');
};

window.selectSize = function(size, el) {
    document.querySelectorAll('.size-btn').forEach(b => b.classList.remove('active'));
    el.classList.add('active');
    selectedSize = size;
};

window.selectColor = function(color, el) {
    document.querySelectorAll('.color-btn').forEach(b => b.classList.remove('active'));
    el.classList.add('active');
    selectedColor = color;
};

function buildSizeGuide(cat) {
    const t = document.getElementById('pdSizeTable');
    if (cat === 'Jeans') {
        t.innerHTML = `
        <thead><tr><th>Waist (in)</th><th>Hip (in)</th><th>Inseam (in)</th></tr></thead>
        <tbody>
            <tr><td>28</td><td>36</td><td>28.5</td></tr>
            <tr><td>30</td><td>38</td><td>29</td></tr>
            <tr><td>32</td><td>40</td><td>29.5</td></tr>
            <tr><td>34</td><td>42</td><td>30</td></tr>
            <tr><td>36</td><td>44</td><td>30.5</td></tr>
            <tr><td>38</td><td>46</td><td>30.5</td></tr>
        </tbody>`;
    } else {
        t.innerHTML = `
        <thead><tr><th>Size</th><th>Chest (in)</th><th>Length (in)</th><th>Shoulder (in)</th></tr></thead>
        <tbody>
            <tr><td>S</td><td>36–38</td><td>27</td><td>16.5</td></tr>
            <tr><td>M</td><td>38–40</td><td>28</td><td>17.5</td></tr>
            <tr><td>L</td><td>40–42</td><td>29</td><td>18.5</td></tr>
            <tr><td>XL</td><td>42–44</td><td>30</td><td>19.5</td></tr>
            <tr><td>XXL</td><td>44–46</td><td>31</td><td>20.5</td></tr>
            <tr><td>3XL</td><td>46–48</td><td>32</td><td>21.5</td></tr>
        </tbody>`;
    }
}

window.pdOrderNow = function() {
    if (!currentProduct) return;
    const sizePart  = selectedSize  ? `\nSize: ${selectedSize}`    : '';
    const colorPart = selectedColor ? `\nColour: ${selectedColor}` : '';
    const msg = encodeURIComponent(
        `Hi! I want to order *${currentProduct.name}* from LaFashionPoint${sizePart}${colorPart}\nPrice: ₹${currentProduct.price}`
    );
    window.open(`https://wa.me/${WA}?text=${msg}`, '_blank', 'noopener');
};

document.addEventListener('keydown', e => { if (e.key === 'Escape') closeProductModal(); });

/* ============================================================
   COUPONS — load from Firestore with hardcoded fallback
   ============================================================ */
const DEFAULT_COUPONS = [
    { code:'FIRST10', discount:10, description:'First Order Deal',  desc2:'For all new customers',         featured:false },
    { code:'WA20',    discount:20, description:'WhatsApp Order',    desc2:'Order via WhatsApp to claim',   featured:true  },
    { code:'FEST15',  discount:15, description:'Festive Sale',      desc2:'On orders above ₹999',          featured:false },
];

function couponCard(c, featured) {
    const desc = c.minOrder ? `On orders above ₹${c.minOrder}` : (c.desc2 || c.description || '');
    return `
    <div class="coupon ${featured ? 'featured' : ''}">
        <div class="coupon-left">
            <span class="pct">${c.discount}%</span>
            <span class="off">OFF</span>
        </div>
        <div class="coupon-divider"></div>
        <div class="coupon-right">
            <h4>${c.description}</h4>
            <p>${desc}</p>
            <div class="coupon-code-box">
                <span>${c.code}</span>
                <button onclick="copyCoupon('${c.code}')" aria-label="Copy coupon"><i class="far fa-copy"></i></button>
            </div>
        </div>
    </div>`;
}

function renderCoupons(coupons) {
    const grid = document.getElementById('couponsGrid');
    if (!grid) return;
    /* mark the middle item as featured */
    const mid = Math.floor(coupons.length / 2);
    grid.innerHTML = coupons.map((c, i) => couponCard(c, i === mid)).join('');
}

onSnapshot(
    query(collection(db, 'coupons'), where('active', '==', true), orderBy('createdAt', 'asc')),
    snap => { renderCoupons(snap.empty ? DEFAULT_COUPONS : snap.docs.map(d => d.data())); },
    ()   => { renderCoupons(DEFAULT_COUPONS); }
);

/* ============================================================
   SCROLL REVEAL
   ============================================================ */
function activateReveal(els) {
    const obs = new IntersectionObserver(entries => {
        entries.forEach((e, i) => {
            if (e.isIntersecting) {
                setTimeout(() => e.target.classList.add('visible'), i * 80);
                obs.unobserve(e.target);
            }
        });
    }, { rootMargin: '0px 0px -60px 0px' });
    els.forEach(el => obs.observe(el));
}
document.querySelectorAll('.coupon, .payment-card, .about-card, .stat').forEach(el => el.classList.add('reveal'));
activateReveal(document.querySelectorAll('.reveal'));

/* ============================================================
   STICKY HEADER
   ============================================================ */
const header = document.getElementById('header');
window.addEventListener('scroll', () => header.classList.toggle('scrolled', window.scrollY > 40));

/* ============================================================
   HAMBURGER MENU
   ============================================================ */
const hamburger = document.getElementById('hamburger');
const navLinks  = document.getElementById('navLinks');

hamburger.addEventListener('click', () => {
    hamburger.classList.toggle('open');
    navLinks.classList.toggle('open');
    document.body.style.overflow = navLinks.classList.contains('open') ? 'hidden' : '';
});
navLinks.querySelectorAll('.nav-link').forEach(link => {
    link.addEventListener('click', () => {
        hamburger.classList.remove('open');
        navLinks.classList.remove('open');
        document.body.style.overflow = '';
    });
});

/* ============================================================
   ACTIVE NAV ON SCROLL
   ============================================================ */
const sections = document.querySelectorAll('section[id]');
const links    = document.querySelectorAll('.nav-link');
sections.forEach(s => {
    new IntersectionObserver(entries => {
        entries.forEach(e => {
            if (e.isIntersecting) {
                links.forEach(l => l.classList.remove('active'));
                const a = document.querySelector(`.nav-link[href="#${e.target.id}"]`);
                if (a) a.classList.add('active');
            }
        });
    }, { rootMargin: '-40% 0px -55% 0px' }).observe(s);
});

/* ============================================================
   BACK TO TOP
   ============================================================ */
const backTop = document.getElementById('backTop');
window.addEventListener('scroll', () => backTop.classList.toggle('visible', window.scrollY > 400));
backTop.addEventListener('click', () => window.scrollTo({ top: 0, behavior: 'smooth' }));

/* ============================================================
   TOAST
   ============================================================ */
window.showToast = function(msg) {
    const t = document.getElementById('toast');
    t.textContent = msg;
    t.classList.add('show');
    setTimeout(() => t.classList.remove('show'), 2500);
};

/* ============================================================
   COPY COUPON
   ============================================================ */
window.copyCoupon = function(code) {
    navigator.clipboard.writeText(code).then(() => showToast(`✓ Coupon "${code}" copied!`)).catch(() => {
        const el = document.createElement('textarea');
        el.value = code;
        Object.assign(el.style, { position:'fixed', opacity:'0' });
        document.body.appendChild(el);
        el.select();
        document.execCommand('copy');
        document.body.removeChild(el);
        showToast(`✓ Coupon "${code}" copied!`);
    });
};

/* ============================================================
   CONTACT FORM — saves inquiries to Firestore
   ============================================================ */
const contactForm = document.getElementById('contactForm');
const formSuccess = document.getElementById('formSuccess');

if (contactForm) {
    contactForm.addEventListener('submit', async e => {
        e.preventDefault();
        const btn  = contactForm.querySelector('button[type="submit"]');
        const orig = btn.innerHTML;
        btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Sending…';
        btn.disabled  = true;

        const data = Object.fromEntries(new FormData(contactForm));
        data.createdAt = serverTimestamp();

        try {
            await addDoc(collection(db, 'inquiries'), data);
            contactForm.style.display = 'none';
            formSuccess.style.display = 'block';
        } catch (err) {
            console.error(err);
            showToast('Could not send. Please WhatsApp us directly!');
            btn.innerHTML = orig;
            btn.disabled  = false;
        }
    });
}
