import { db } from './firebase-config.js';
import {
    collection, onSnapshot, query, orderBy,
    addDoc, serverTimestamp, getDocs, where
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
let searchQuery    = '';

/* ============================================================
   SEARCH
   ============================================================ */
window.handleSearch = function() {
    const input = document.getElementById('siteSearch');
    const clearBtn = document.getElementById('searchClear');
    searchQuery = input.value.trim().toLowerCase();
    clearBtn.style.display = searchQuery ? 'flex' : 'none';
    renderProducts();
};

window.clearSearch = function() {
    const input = document.getElementById('siteSearch');
    const clearBtn = document.getElementById('searchClear');
    input.value = '';
    searchQuery = '';
    clearBtn.style.display = 'none';
    renderProducts();
};

/* ============================================================
   CATEGORY FILTER FROM CATEGORY CARDS
   ============================================================ */
window.filterByCategory = function(cat) {
    activeCat = cat;
    // Update filter buttons
    document.querySelectorAll('.cat-filter-btn').forEach(b => {
        b.classList.toggle('active', b.dataset.cat === cat);
    });
    renderProducts();
    // Smooth scroll to products
    const sec = document.getElementById('products');
    if (sec) sec.scrollIntoView({ behavior: 'smooth' });
};

/* ============================================================
   WISHLIST
   ============================================================ */
function getWishlist() {
    try { return JSON.parse(localStorage.getItem('lfp_wishlist') || '[]'); } catch { return []; }
}
function saveWishlist(ids) {
    localStorage.setItem('lfp_wishlist', JSON.stringify(ids));
    updateWishlistCount();
}
function updateWishlistCount() {
    const ids = getWishlist();
    const badge = document.getElementById('wishlistCount');
    if (!badge) return;
    if (ids.length) {
        badge.textContent = ids.length;
        badge.style.display = 'flex';
    } else {
        badge.style.display = 'none';
    }
}
window.isWishlisted = function(id) {
    return getWishlist().includes(id);
};
window.toggleWishlist = function(id, el) {
    let ids = getWishlist();
    if (ids.includes(id)) {
        ids = ids.filter(i => i !== id);
        el.classList.remove('active');
        el.querySelector('i').className = 'far fa-heart';
        showToast('Removed from wishlist');
    } else {
        ids.push(id);
        el.classList.add('active');
        el.querySelector('i').className = 'fas fa-heart';
        showToast('Added to wishlist ♥');
    }
    saveWishlist(ids);
};
window.openWishlist = function() {
    renderWishlistModal();
    const ov = document.getElementById('wishlistOverlay');
    ov.style.display = 'flex';
    requestAnimationFrame(() => requestAnimationFrame(() => ov.classList.add('open')));
    document.body.style.overflow = 'hidden';
};
window.closeWishlist = function() {
    const ov = document.getElementById('wishlistOverlay');
    ov.classList.remove('open');
    ov.addEventListener('transitionend', () => { ov.style.display = 'none'; }, { once: true });
    document.body.style.overflow = '';
};
function renderWishlistModal() {
    const ids = getWishlist();
    const content = document.getElementById('wishlistContent');
    if (!ids.length) {
        content.innerHTML = '<div class="wishlist-empty"><i class="far fa-heart"></i><p>Your wishlist is empty.</p></div>';
        return;
    }
    const items = ids.map(id => productsCache[id]).filter(Boolean);
    if (!items.length) {
        content.innerHTML = '<div class="wishlist-empty"><i class="far fa-heart"></i><p>Products not loaded yet.</p></div>';
        return;
    }
    content.innerHTML = items.map(p => `
        <div class="wishlist-item">
            <div class="wishlist-item-img ${p.imageUrl ? '' : catBgClass(p.category)}">
                ${p.imageUrl ? `<img src="${p.imageUrl}" alt="${p.name}">` : `<i class="fas fa-${iconFor(p.category)}"></i>`}
            </div>
            <div class="wishlist-item-info">
                <p class="wishlist-item-cat">${p.category}</p>
                <h4>${p.name}</h4>
                <p class="wishlist-item-price">₹${p.price.toLocaleString('en-IN')}</p>
            </div>
            <div class="wishlist-item-actions">
                <button class="btn-gold btn-sm" onclick="closeWishlist();openProductModal('${p.id}')">View</button>
                <button class="btn-wishlist-remove" onclick="removeFromWishlistModal('${p.id}')"><i class="fas fa-trash-alt"></i></button>
            </div>
        </div>
    `).join('');
}
window.removeFromWishlistModal = function(id) {
    let ids = getWishlist().filter(i => i !== id);
    saveWishlist(ids);
    renderWishlistModal();
    const btn = document.querySelector(`.wishlist-btn[onclick*="'${id}'"]`);
    if (btn) {
        btn.classList.remove('active');
        btn.querySelector('i').className = 'far fa-heart';
    }
};

/* ============================================================
   PRODUCT CARD
   ============================================================ */
function productCard(p) {
    const discount = p.originalPrice && p.originalPrice > p.price
        ? Math.round((1 - p.price / p.originalPrice) * 100) : null;

    // Images: prefer first of images[], else imageUrl
    const images = (p.images && p.images.length) ? p.images : (p.imageUrl ? [p.imageUrl] : []);
    const img1 = images[0] || null;
    const img2 = images[1] || img1;

    // Gradient bg class for no-image products
    const bgClass = img1 ? '' : catBgClass(p.category);

    // Badge HTML
    let badgeHtml = '';
    if (p.badge) {
        const bClass = p.badge.toLowerCase() === 'new' ? 'new' : p.badge.toLowerCase() === 'hot' ? 'sale' : 'best';
        badgeHtml = `<span class="product-badge ${bClass}">${p.badge}</span>`;
    }
    const discBadgeHtml = discount ? `<span class="product-badge sale" style="left:auto;right:14px;">−${discount}%</span>` : '';

    // Image HTML
    const imgHtml = img1
        ? `<img src="${img1}" alt="${p.name}" loading="lazy" style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover;transition:opacity .5s;">`
        : `<div class="product-icon-wrap"><i class="fas fa-${iconFor(p.category)}"></i></div>`;
    const imgAltHtml = img2
        ? `<img src="${img2}" alt="${p.name}" loading="lazy" style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover;opacity:0;transition:opacity .5s;">`
        : '';

    const wishlisted = isWishlisted(p.id);
    const origPriceHtml = (p.originalPrice && p.originalPrice > p.price)
        ? `<span class="product-price-orig">₹${p.originalPrice.toLocaleString('en-IN')}</span>` : '';
    const discPctHtml = discount ? `<span class="product-disc-pct">${discount}% off</span>` : '';
    const starsHtml = p.averageRating
        ? `<div class="product-stars">${'★'.repeat(Math.round(p.averageRating))}${'☆'.repeat(5 - Math.round(p.averageRating))}</div>` : '';

    return `
<div class="product-card reveal" onclick="openProductModal('${p.id}')">
    <div class="product-img-wrap ${bgClass}">
        ${imgHtml}
        ${imgAltHtml}
        ${badgeHtml}
        ${discBadgeHtml}
        <button class="wishlist-btn ${wishlisted ? 'active' : ''}"
            onclick="event.stopPropagation();toggleWishlist('${p.id}',this)"
            title="Add to wishlist">
            <i class="${wishlisted ? 'fas' : 'far'} fa-heart"></i>
        </button>
        <button class="quick-add" onclick="event.stopPropagation();openProductModal('${p.id}')">View Details</button>
    </div>
    <div class="product-info">
        <p class="product-cat-sm">${p.category}</p>
        <div class="product-name">${p.name}</div>
        <div class="product-pricing">
            <span class="product-price">₹${p.price.toLocaleString('en-IN')}</span>
            ${origPriceHtml}
            ${discPctHtml}
        </div>
        ${starsHtml}
    </div>
</div>`;
}

/* Hover image swap via CSS classes */
document.addEventListener('mouseover', function(e) {
    const card = e.target.closest('.product-card');
    if (!card) return;
    const wrap = card.querySelector('.product-img-wrap');
    if (!wrap) return;
    const imgs = wrap.querySelectorAll('img');
    if (imgs.length >= 2) {
        imgs[0].style.opacity = '0';
        imgs[1].style.opacity = '1';
    }
});
document.addEventListener('mouseout', function(e) {
    const card = e.target.closest('.product-card');
    if (!card) return;
    const wrap = card.querySelector('.product-img-wrap');
    if (!wrap) return;
    const imgs = wrap.querySelectorAll('img');
    if (imgs.length >= 2) {
        imgs[0].style.opacity = '1';
        imgs[1].style.opacity = '0';
    }
});

function iconFor(cat) {
    return { 'T-Shirt':'tshirt', 'Shirt':'user-tie', 'Hoodie':'hat-wizard', 'Jeans':'drafting-compass' }[cat] || 'tshirt';
}
function catBgClass(cat) {
    return { 'T-Shirt':'p-tshirt', 'Shirt':'p-shirt', 'Hoodie':'p-hoodie', 'Jeans':'p-jeans' }[cat] || 'p-tshirt';
}

/* ============================================================
   RENDER WITH FILTER / SORT / SEARCH
   ============================================================ */
function renderProducts() {
    let products = [...allProducts];
    if (activeCat) products = products.filter(p => p.category === activeCat);
    if (searchQuery) {
        products = products.filter(p =>
            (p.name || '').toLowerCase().includes(searchQuery) ||
            (p.category || '').toLowerCase().includes(searchQuery) ||
            (p.description || '').toLowerCase().includes(searchQuery)
        );
    }
    if (activeSort === 'low')  products.sort((a, b) => a.price - b.price);
    if (activeSort === 'high') products.sort((a, b) => b.price - a.price);

    grid.style.display  = 'grid';
    empty.style.display = 'none';

    if (!products.length) {
        grid.innerHTML = `<div style="grid-column:1/-1;text-align:center;padding:80px 24px;color:var(--ink-mid);">
            <i class="fas fa-box-open" style="font-size:3rem;color:var(--rule-strong);display:block;margin-bottom:16px;"></i>
            <p>No products found.</p></div>`;
    } else {
        grid.innerHTML = products.map(p => productCard(p)).join('');
        activateReveal(grid.querySelectorAll('.reveal'));
    }
}

const grid    = document.getElementById('productsGrid');
const loading = document.getElementById('productsLoading');
const empty   = document.getElementById('productsEmpty');

const q = query(collection(db, 'products'), orderBy('order', 'asc'));

onSnapshot(q, snap => {
    loading.style.display = 'none';
    if (snap.empty) { empty.style.display = 'block'; grid.style.display = 'none'; return; }
    allProducts   = snap.docs.map(d => ({ id: d.id, ...d.data() })).filter(p => p.available !== false);
    productsCache = {};
    allProducts.forEach(p => { productsCache[p.id] = p; });
    renderProducts();
    updateWishlistCount();
}, err => {
    console.error('Firestore error:', err);
    loading.style.display = 'none';
    empty.style.display   = 'block';
});

/* Filter bar tabs are wired dynamically in renderFilterTabs() above */

const sortSelect = document.getElementById('sortSelect');
if (sortSelect) {
    sortSelect.addEventListener('change', () => {
        activeSort = sortSelect.value;
        renderProducts();
    });
}

/* ============================================================
   CATEGORIES — load from Firestore, render cards + filter tabs
   ============================================================ */
const DEFAULT_CATEGORIES = [
    { name:'T-Shirt', displayName:'T-Shirts', description:'Everyday Comfort',  color:'#c8d8ec' },
    { name:'Shirt',   displayName:'Shirts',   description:'Sharp & Stylish',   color:'#e0e0e0' },
    { name:'Hoodie',  displayName:'Hoodies',  description:'Warm & Premium',    color:'#c8d4d0' },
    { name:'Jeans',   displayName:'Jeans',    description:'Premium Denim',     color:'#aac4dc' },
];

function hexDarken(hex, amt) {
    const n = parseInt(hex.replace('#',''),16);
    const r = Math.max(0,((n>>16)&0xff)-amt);
    const g = Math.max(0,((n>>8)&0xff)-amt);
    const b = Math.max(0,(n&0xff)-amt);
    return `#${r.toString(16).padStart(2,'0')}${g.toString(16).padStart(2,'0')}${b.toString(16).padStart(2,'0')}`;
}

function renderCategoryCards(cats) {
    const grid = document.getElementById('categoriesGrid');
    if (!grid) return;
    grid.innerHTML = cats.map(c => {
        const bg  = c.color ? `linear-gradient(145deg,${c.color},${hexDarken(c.color,30)})` : 'linear-gradient(145deg,#c8d8ec,#7aa3c4)';
        return `
        <div class="cat-card reveal" onclick="filterByCategory('${c.name}')">
            <div class="cat-bg" style="background:${bg};position:absolute;inset:0;"></div>
            <div class="cat-overlay"></div>
            <div class="cat-body">
                <div>
                    <div class="cat-name">${c.displayName||c.name}</div>
                    <div class="cat-count">${c.description||''}</div>
                </div>
                <div class="cat-arrow">
                    <svg viewBox="0 0 24 24"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg>
                </div>
            </div>
        </div>`;
    }).join('');
    activateReveal(grid.querySelectorAll('.reveal'));
}

function renderFilterTabs(cats) {
    const row = document.getElementById('catFilterRow');
    if (!row) return;
    row.innerHTML = `<button class="cat-filter-btn ${activeCat===''?'active':''}" data-cat="">All</button>` +
        cats.map(c => `<button class="cat-filter-btn ${activeCat===c.name?'active':''}" data-cat="${c.name}">${c.displayName||c.name}</button>`).join('');
    row.querySelectorAll('.cat-filter-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            row.querySelectorAll('.cat-filter-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            activeCat = btn.dataset.cat;
            renderProducts();
        });
    });
}

onSnapshot(
    query(collection(db, 'categories'), orderBy('order', 'asc')),
    snap => {
        const cats = (snap.empty ? DEFAULT_CATEGORIES : snap.docs.map(d => d.data())).filter(c => c.active !== false);
        renderCategoryCards(cats);
        renderFilterTabs(cats);
    },
    () => {
        renderCategoryCards(DEFAULT_CATEGORIES);
        renderFilterTabs(DEFAULT_CATEGORIES);
    }
);

/* ============================================================
   PRODUCT DETAIL MODAL — CAROUSEL
   ============================================================ */
let selectedSize   = '';
let selectedColor  = '';
let currentProduct = null;
let carouselImages = [];
window.currentCarouselIdx = 0;

window.changeModalImage = function(idx) {
    if (!carouselImages.length) return;
    idx = (idx + carouselImages.length) % carouselImages.length;
    window.currentCarouselIdx = idx;
    const mainImg = document.getElementById('pdImg');
    mainImg.src = carouselImages[idx];
    document.querySelectorAll('.pd-car-thumb').forEach((t, i) => {
        t.classList.toggle('active', i === idx);
    });
};

function buildCarousel(p) {
    const images = (p.images && p.images.length) ? p.images : (p.imageUrl ? [p.imageUrl] : []);
    carouselImages = images;
    window.currentCarouselIdx = 0;

    const placeholder = document.getElementById('pdImgPlaceholder');
    const carousel    = document.getElementById('pdCarousel');
    const imgCol      = document.getElementById('pdImageCol');

    if (!images.length) {
        carousel.style.display    = 'none';
        placeholder.innerHTML     = `<i class="fas fa-${iconFor(p.category)}"></i>`;
        placeholder.style.display = 'flex';
        imgCol.className = 'pd-image-col ' + catBgClass(p.category);
        return;
    }

    placeholder.style.display = 'none';
    carousel.style.display    = 'flex';
    imgCol.className          = 'pd-image-col';

    const mainImg = document.getElementById('pdImg');
    mainImg.src   = images[0];
    mainImg.alt   = p.name;

    const thumbsEl = document.getElementById('pdCarThumbs');
    if (images.length > 1) {
        thumbsEl.innerHTML = images.map((src, i) =>
            `<img src="${src}" alt="Image ${i+1}" class="pd-car-thumb ${i===0?'active':''}" onclick="changeModalImage(${i})">`
        ).join('');
        thumbsEl.style.display = 'flex';
    } else {
        thumbsEl.innerHTML = '';
        thumbsEl.style.display = 'none';
    }
    const arrows = carousel.querySelectorAll('.pd-car-arrow');
    arrows.forEach(a => { a.style.display = images.length > 1 ? 'flex' : 'none'; });
}

window.openProductModal = function(id) {
    const p = productsCache[id];
    if (!p) return;
    currentProduct = p;
    selectedSize   = '';
    selectedColor  = '';

    buildCarousel(p);

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
        origEl.textContent       = `₹${p.originalPrice.toLocaleString('en-IN')}`;
        origEl.style.display     = 'inline';
        discountEl.textContent   = `${Math.round((1 - p.price / p.originalPrice) * 100)}% OFF`;
        discountEl.style.display = 'inline-block';
    } else {
        origEl.style.display     = 'none';
        discountEl.style.display = 'none';
    }

    document.getElementById('pdDesc').textContent = p.description || '';
    const fabricEl = document.getElementById('pdFabric');
    if (p.fabric) {
        fabricEl.innerHTML     = `<strong>Fabric:</strong> ${p.fabric}`;
        fabricEl.style.display = 'block';
    } else {
        fabricEl.style.display = 'none';
    }

    buildSizeGuide(p.category);

    const sizes = (p.sizes && p.sizes.length) ? p.sizes : (DEFAULT_SIZES[p.category] || ['S','M','L','XL','XXL']);
    renderModalSizeChips(p, sizes, '');
    renderModalColorChips(p, '');

    /* Reset tabs */
    document.querySelectorAll('.pd-tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.pd-tab-content').forEach(c => c.classList.remove('active'));
    document.querySelector('.pd-tab[data-tab="details"]').classList.add('active');
    document.getElementById('pdTabDetails').classList.add('active');

    buildRelatedProducts(p);
    loadReviews(p.id);
    resetReviewForm();

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

function renderModalSizeChips(p, sizes, selColor) {
    document.getElementById('pdSizeBtns').innerHTML = sizes.map(s => {
        const inStock = frontSizeHasStock(p, s);
        return `<button class="size-btn${inStock ? '' : ' oos'}"
            ${inStock ? `onclick="selectSize('${s}',this)"` : 'disabled'}
            title="${inStock ? s : s + ' — Out of Stock'}">
            ${s}${!inStock ? '<br><small>Out</small>' : ''}
        </button>`;
    }).join('');
}

function renderModalColorChips(p, selSize) {
    const colorBtns = document.getElementById('pdColorBtns');
    if (p.colors && p.colors.length) {
        colorBtns.innerHTML = p.colors.map(c => {
            const hex     = COLOR_HEX[c] || '#888';
            const inStock = selSize ? frontColorHasStock(p, selSize, c) : true;
            return `<button class="color-btn${inStock ? '' : ' oos'}"
                ${inStock ? `onclick="selectColor('${c}',this)"` : 'disabled'}>
                <span class="color-dot" style="background:${hex};${!inStock ? 'opacity:.35' : ''}"></span>
                <span class="color-label">${c}${!inStock ? '<br><small style=\'color:#ef4444\'>Out</small>' : ''}</span>
            </button>`;
        }).join('');
    } else {
        colorBtns.innerHTML = `<p class="pd-no-select">All colours available — mention your preference on WhatsApp</p>`;
    }
}

function frontSizeHasStock(p, size) {
    const inv = p.inventory;
    if (!inv) return true;
    if (p.colors && p.colors.length) {
        return p.colors.some(c => { const s = inv[`${size}_${c}`]; return s === undefined || s > 0; });
    }
    const s = inv[size];
    return s === undefined || s > 0;
}

function frontColorHasStock(p, size, color) {
    const inv = p.inventory;
    if (!inv) return true;
    const s = inv[`${size}_${color}`];
    return s === undefined || s > 0;
}

window.selectSize = function(size, el) {
    document.querySelectorAll('.size-btn').forEach(b => b.classList.remove('active'));
    el.classList.add('active');
    selectedSize = size;
    if (currentProduct) renderModalColorChips(currentProduct, size);
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

document.addEventListener('keydown', e => {
    if (e.key === 'Escape') { closeProductModal(); closeWishlist(); }
});

/* ============================================================
   BUY NOW — RAZORPAY
   ============================================================ */
window.buyNow = function() {
    if (!currentProduct) return;
    if (!selectedSize && currentProduct.sizes && currentProduct.sizes.length) {
        showToast('Please select a size first');
        return;
    }
    if (typeof Razorpay === 'undefined') {
        showToast('Payment gateway loading… please try WhatsApp for now');
        window.open(`https://wa.me/${WA}?text=${encodeURIComponent('I want to order: ' + currentProduct.name)}`, '_blank');
        return;
    }
    const options = {
        key: window.RAZORPAY_KEY || 'rzp_test_PLACEHOLDER',
        amount: currentProduct.price * 100,
        currency: 'INR',
        name: 'LaFashionPoint',
        description: `${currentProduct.name} - Size: ${selectedSize || 'N/A'}`,
        image: 'logo.png',
        handler: function(response) {
            showToast('Payment successful! Order ID: ' + response.razorpay_payment_id);
            closeProductModal();
        },
        prefill: { contact: '' },
        theme: { color: '#2a4a6b' }
    };
    new Razorpay(options).open();
};

/* ============================================================
   RELATED PRODUCTS
   ============================================================ */
function buildRelatedProducts(p) {
    const related = allProducts
        .filter(x => x.category === p.category && x.id !== p.id)
        .slice(0, 3);
    const container = document.getElementById('pdRelated');
    const relGrid   = document.getElementById('pdRelatedGrid');
    if (!related.length) { container.style.display = 'none'; return; }
    container.style.display = 'block';
    relGrid.innerHTML = related.map(r => `
        <div class="pd-related-card" onclick="closeProductModal();setTimeout(()=>openProductModal('${r.id}'),200)">
            <div class="pd-related-img ${r.imageUrl ? '' : catBgClass(r.category)}">
                ${r.imageUrl ? `<img src="${r.imageUrl}" alt="${r.name}">` : `<i class="fas fa-${iconFor(r.category)}"></i>`}
            </div>
            <p class="pd-related-name">${r.name}</p>
            <p class="pd-related-price">₹${r.price.toLocaleString('en-IN')}</p>
        </div>
    `).join('');
}

/* ============================================================
   REVIEWS
   ============================================================ */
let reviewRating = 0;

function resetReviewForm() {
    reviewRating = 0;
    const nameEl    = document.getElementById('reviewName');
    const commentEl = document.getElementById('reviewComment');
    const thanks    = document.getElementById('reviewThanks');
    if (nameEl)    nameEl.value    = '';
    if (commentEl) commentEl.value = '';
    if (thanks)    thanks.style.display = 'none';
    buildStarInput();
}

function buildStarInput() {
    const container = document.getElementById('starInput');
    if (!container) return;
    container.innerHTML = [1,2,3,4,5].map(n =>
        `<i class="${n <= reviewRating ? 'fas' : 'far'} fa-star star-clickable" onclick="setReviewRating(${n})"></i>`
    ).join('');
}

window.setReviewRating = function(n) {
    reviewRating = n;
    buildStarInput();
};

function starsHtml(rating) {
    return [1,2,3,4,5].map(n =>
        `<i class="${n <= rating ? 'fas' : 'far'} fa-star" style="color:${n <= rating ? '#b8962a' : '#ddd'};font-size:.85rem;"></i>`
    ).join('');
}

async function loadReviews(productId) {
    const listEl = document.getElementById('pdReviewsList');
    const avgEl  = document.getElementById('pdAvgRating');
    if (!listEl || !avgEl) return;
    listEl.innerHTML = '<p style="font-size:.8rem;color:var(--ink-faint);">Loading reviews…</p>';
    avgEl.innerHTML  = '';
    try {
        const snap = await getDocs(
            query(collection(db, 'reviews'),
                where('productId', '==', productId),
                where('approved', '==', true),
                orderBy('createdAt', 'desc')
            )
        );
        const reviews = snap.docs.map(d => d.data());
        if (!reviews.length) {
            listEl.innerHTML = '<p class="no-reviews">No reviews yet. Be the first!</p>';
            avgEl.innerHTML  = '';
            return;
        }
        const avg = (reviews.reduce((s, r) => s + (r.rating || 0), 0) / reviews.length).toFixed(1);
        avgEl.innerHTML = `${starsHtml(Math.round(avg))} <span class="avg-num">${avg}</span> <span class="avg-count">(${reviews.length})</span>`;
        listEl.innerHTML = reviews.map(r => `
            <div class="review-card">
                <div class="review-top">
                    <span class="review-name">${r.name || 'Anonymous'}</span>
                    <span class="review-stars">${starsHtml(r.rating || 0)}</span>
                </div>
                <p class="review-comment">${r.comment || ''}</p>
                <p class="review-date">${r.createdAt?.toDate ? r.createdAt.toDate().toLocaleDateString('en-IN') : ''}</p>
            </div>
        `).join('');
    } catch (err) {
        console.warn('Reviews load error:', err);
        listEl.innerHTML = '<p class="no-reviews">Could not load reviews.</p>';
    }
}

window.submitReview = function() {
    if (!currentProduct) return;
    if (!reviewRating) { showToast('Please select a star rating'); return; }
    const name    = (document.getElementById('reviewName').value || '').trim();
    const comment = (document.getElementById('reviewComment').value || '').trim();
    if (!name)    { showToast('Please enter your name'); return; }
    if (!comment) { showToast('Please write a comment'); return; }

    addDoc(collection(db, 'reviews'), {
        productId: currentProduct.id,
        name, rating: reviewRating, comment,
        approved: false, createdAt: serverTimestamp()
    }).then(() => {
        document.getElementById('reviewThanks').style.display = 'block';
        document.getElementById('reviewName').value    = '';
        document.getElementById('reviewComment').value = '';
        reviewRating = 0;
        buildStarInput();
    }).catch(err => {
        console.error(err);
        showToast('Could not submit review. Try again.');
    });
};

/* ============================================================
   ORDER TRACKING
   ============================================================ */
window.trackOrder = function() {
    const raw   = (document.getElementById('trackPhone').value || '').trim();
    const phone = raw.replace(/[\s\-\+]/g, '').replace(/^91/, '');
    const resultsEl = document.getElementById('trackResults');
    if (phone.length < 10) { showToast('Please enter a valid phone number'); return; }
    resultsEl.style.display = 'block';
    resultsEl.innerHTML = '<div class="track-loading"><div class="spinner"></div><p>Searching…</p></div>';

    getDocs(query(collection(db, 'tracking'), orderBy('createdAt', 'desc')))
        .then(snap => {
            const orders = snap.docs
                .map(d => d.data())
                .filter(o => {
                    const p = (o.phone || '').replace(/[\s\-\+]/g, '').replace(/^91/, '');
                    return p === phone;
                });
            if (!orders.length) {
                resultsEl.innerHTML = '<div class="track-empty"><i class="fas fa-search"></i><p>No orders found for this number.</p></div>';
                return;
            }
            const statusColor = { Pending:'#f59e0b', Shipped:'#3b82f6', Delivered:'#22c55e', Cancelled:'#ef4444' };
            resultsEl.innerHTML = orders.map(o => {
                const col  = statusColor[o.status] || '#888';
                const date = o.createdAt?.toDate ? o.createdAt.toDate().toLocaleDateString('en-IN') : '';
                return `
                <div class="track-card">
                    <div class="track-card-top">
                        <div>
                            <p class="track-product">${o.productName || 'Order'}</p>
                            <p class="track-date">${date}</p>
                        </div>
                        <span class="track-badge" style="background:${col}20;color:${col};border:1px solid ${col}40;">${o.status || 'Pending'}</span>
                    </div>
                    ${o.note ? `<p class="track-note">${o.note}</p>` : ''}
                </div>`;
            }).join('');
        })
        .catch(err => {
            console.error(err);
            resultsEl.innerHTML = '<div class="track-empty"><i class="fas fa-exclamation-circle"></i><p>Could not fetch orders. Please try again.</p></div>';
        });
};

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
    const cGrid = document.getElementById('couponsGrid');
    if (!cGrid) return;
    const mid = Math.floor(coupons.length / 2);
    cGrid.innerHTML = coupons.map((c, i) => couponCard(c, i === mid)).join('');
}

onSnapshot(
    query(collection(db, 'coupons'), orderBy('createdAt', 'asc')),
    snap => {
        const active = snap.docs.map(d => d.data()).filter(c => c.active !== false);
        renderCoupons(active.length ? active : DEFAULT_COUPONS);
    },
    () => { renderCoupons(DEFAULT_COUPONS); }
);

/* ============================================================
   TESTIMONIALS
   ============================================================ */
const TESTIMONIALS = [
    { name:'Rahul Sharma',  location:'Jaipur',       text:'Ordered a polo T-shirt and received it in 4 days. Quality is amazing for the price!',           rating:5 },
    { name:'Vikram Singh',  location:'Delhi',         text:'The hoodie is super warm and the colour is exactly as shown. Will order again!',                rating:5 },
    { name:'Arjun Patel',   location:'Mumbai',        text:'Fast delivery, great packing, and the jeans fit perfectly. Highly recommended!',                rating:5 },
    { name:'Deepak Kumar',  location:'Chandigarh',    text:'Best men\'s fashion store for this price range. Already ordered 3 times!',                      rating:5 },
    { name:'Sunil Gupta',   location:'Hanumangarh',   text:'Local store but delivers all over India. Very proud to support local business!',                rating:5 },
];

let testimonialIdx   = 0;
let testimonialTimer = null;

function getTestimonialsPerView() {
    return window.innerWidth >= 768 ? 3 : 1;
}

function renderTestimonials() {
    const track = document.getElementById('testimonialsTrack');
    const dots  = document.getElementById('testDots');
    if (!track || !dots) return;

    const perView = getTestimonialsPerView();
    const total   = TESTIMONIALS.length;
    if (testimonialIdx < 0) testimonialIdx = total - 1;
    if (testimonialIdx >= total) testimonialIdx = 0;

    const visible = [];
    for (let i = 0; i < Math.min(perView, total); i++) {
        visible.push(TESTIMONIALS[(testimonialIdx + i) % total]);
    }

    track.innerHTML = visible.map(t => `
        <div class="test-card">
            <div class="test-quote"><i class="fas fa-quote-left"></i></div>
            <p class="test-text">${t.text}</p>
            <div class="test-stars">${starsHtml(t.rating)}</div>
            <div class="test-author">
                <span class="test-name">${t.name}</span>
                <span class="test-loc"><i class="fas fa-map-marker-alt"></i> ${t.location}</span>
            </div>
        </div>
    `).join('');

    dots.innerHTML = TESTIMONIALS.map((_, i) =>
        `<button class="test-dot ${i === testimonialIdx ? 'active' : ''}" onclick="goTestimonial(${i})"></button>`
    ).join('');
}

window.prevTestimonial = function() {
    testimonialIdx = (testimonialIdx - 1 + TESTIMONIALS.length) % TESTIMONIALS.length;
    renderTestimonials();
    resetTestimonialTimer();
};
window.nextTestimonial = function() {
    testimonialIdx = (testimonialIdx + 1) % TESTIMONIALS.length;
    renderTestimonials();
    resetTestimonialTimer();
};
window.goTestimonial = function(i) {
    testimonialIdx = i;
    renderTestimonials();
    resetTestimonialTimer();
};

function resetTestimonialTimer() {
    if (testimonialTimer) clearInterval(testimonialTimer);
    testimonialTimer = setInterval(() => {
        testimonialIdx = (testimonialIdx + 1) % TESTIMONIALS.length;
        renderTestimonials();
    }, 4000);
}

renderTestimonials();
resetTestimonialTimer();
window.addEventListener('resize', renderTestimonials);

/* ============================================================
   FAQ ACCORDION
   ============================================================ */
window.toggleFaq = function(btn) {
    const item   = btn.closest('.faq-item');
    const answer = item.querySelector('.faq-answer');
    const isOpen = item.classList.contains('open');

    document.querySelectorAll('.faq-item.open').forEach(i => {
        i.classList.remove('open');
        i.querySelector('.faq-answer').style.maxHeight = '0';
    });

    if (!isOpen) {
        item.classList.add('open');
        answer.style.maxHeight = answer.scrollHeight + 'px';
    }
};

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

// Initial reveal for all static elements
activateReveal(document.querySelectorAll('.reveal, .reveal-left, .reveal-right'));

/* ============================================================
   STICKY NAV
   ============================================================ */
const mainNav = document.getElementById('mainNav');
window.addEventListener('scroll', () => {
    mainNav.classList.toggle('scrolled', window.scrollY > 60);
});

/* ============================================================
   HAMBURGER / MOBILE DRAWER
   ============================================================ */
window.toggleDrawer = function() {
    const drawer = document.getElementById('mobileDrawer');
    const overlay = document.getElementById('overlayBg');
    const ham = document.getElementById('hamburger');
    drawer.classList.toggle('open');
    overlay.classList.toggle('show');
    if (ham) ham.classList.toggle('open');
    document.body.style.overflow = drawer.classList.contains('open') ? 'hidden' : '';
};

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
   BESTSELLERS CAROUSEL
   ============================================================ */
let carouselPos = 0;
const carTrack = document.getElementById('carouselTrack');
window.moveCarousel = function(dir) {
    if (!carTrack) return;
    const card = carTrack.querySelector('.carousel-card');
    if (!card) return;
    const gap  = parseFloat(window.getComputedStyle(carTrack).gap) || 24;
    const cardW = card.offsetWidth + gap;
    const max  = carTrack.children.length - Math.round(carTrack.parentElement.offsetWidth / cardW);
    carouselPos = Math.max(0, Math.min(carouselPos + dir, max));
    carTrack.style.transform = `translateX(-${carouselPos * cardW}px)`;
};

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
   SHOPPING BAG — in-store reservation (website → POS order code)
   ============================================================ */
function getBag()       { try { return JSON.parse(localStorage.getItem('lfp_bag')||'[]'); } catch { return []; } }
function saveBag(items) { localStorage.setItem('lfp_bag', JSON.stringify(items)); updateBagCount(); }

function updateBagCount() {
    const n = getBag().reduce((s,i) => s + (i.qty||1), 0);
    const el = document.getElementById('bagCount');
    if (!el) return;
    el.textContent = n;
    el.style.display = n ? 'flex' : 'none';
}

window.addToBag = function() {
    if (!currentProduct) return;
    const bag = getBag();
    const existing = bag.find(i => i.productId===currentProduct.id && i.size===selectedSize && i.color===selectedColor);
    if (existing) {
        existing.qty = (existing.qty||1) + 1;
        showToast('Quantity updated in bag');
    } else {
        const imgs = (currentProduct.images&&currentProduct.images.length) ? currentProduct.images : (currentProduct.imageUrl ? [currentProduct.imageUrl] : []);
        bag.push({
            productId: currentProduct.id,
            name:      currentProduct.name,
            price:     currentProduct.price,
            size:      selectedSize  || '',
            color:     selectedColor || '',
            imageUrl:  imgs[0] || '',
            category:  currentProduct.category || '',
            qty:       1,
        });
        showToast('Added to bag ✓ — open bag to reserve');
    }
    saveBag(bag);
    closeProductModal();
};

window.openBag = function() {
    renderBag();
    const ov = document.getElementById('bagOverlay');
    ov.style.display = 'flex';
    requestAnimationFrame(() => requestAnimationFrame(() => ov.classList.add('open')));
    document.body.style.overflow = 'hidden';
};

window.closeBag = function() {
    const ov = document.getElementById('bagOverlay');
    ov.classList.remove('open');
    ov.addEventListener('transitionend', () => { ov.style.display = 'none'; }, { once: true });
    document.body.style.overflow = '';
};

function renderBag() {
    const items   = getBag();
    const itemsEl = document.getElementById('bagItems');
    const footer  = document.getElementById('bagFooter');
    if (!itemsEl) return;

    if (!items.length) {
        itemsEl.innerHTML = `
        <div class="bag-empty">
            <i class="fas fa-shopping-bag"></i>
            <p>Your bag is empty</p>
            <small>Tap <strong>Add to Bag</strong> inside any product</small>
        </div>`;
        if (footer) footer.style.display = 'none';
        return;
    }

    if (footer) footer.style.display = 'block';
    const subtotal = items.reduce((s, i) => s + i.price * (i.qty||1), 0);

    itemsEl.innerHTML = items.map((item, idx) => `
    <div class="bag-item">
        <div class="bag-item-img">
            ${item.imageUrl
                ? `<img src="${item.imageUrl}" alt="${item.name}">`
                : `<i class="fas fa-tshirt"></i>`}
        </div>
        <div class="bag-item-info">
            <p class="bag-item-name">${item.name}</p>
            <p class="bag-item-meta">${[item.size,item.color].filter(Boolean).join(' · ')||'No size/colour'}</p>
            <p class="bag-item-price">₹${(item.price*(item.qty||1)).toLocaleString('en-IN')}</p>
        </div>
        <div class="bag-item-qty">
            <button onclick="changeBagQty(${idx},-1)">−</button>
            <span>${item.qty||1}</span>
            <button onclick="changeBagQty(${idx},1)">+</button>
        </div>
        <button class="bag-item-remove" onclick="removeBagItem(${idx})"><i class="fas fa-times"></i></button>
    </div>`).join('');

    const totalEl = document.getElementById('bagTotalRow');
    if (totalEl) totalEl.innerHTML = `<span>Total (${items.reduce((s,i)=>s+(i.qty||1),0)} items)</span><span>₹${subtotal.toLocaleString('en-IN')}</span>`;
}

window.changeBagQty = function(idx, d) {
    const bag = getBag();
    bag[idx].qty = Math.max(1, (bag[idx].qty||1) + d);
    saveBag(bag); renderBag();
};

window.removeBagItem = function(idx) {
    const bag = getBag();
    bag.splice(idx, 1);
    saveBag(bag); renderBag();
};

window.submitReservation = async function() {
    const name  = document.getElementById('bagName')?.value.trim();
    const phone = document.getElementById('bagPhone')?.value.trim();
    const items = getBag();

    if (!name)         { showToast('Please enter your name');   return; }
    if (!phone)        { showToast('Please enter your phone');  return; }
    if (!items.length) { showToast('Your bag is empty');        return; }

    const btn = document.querySelector('.bag-reserve-btn');
    if (btn) { btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Reserving…'; btn.disabled = true; }

    const code     = generateOrderCode();
    const subtotal = items.reduce((s, i) => s + i.price * (i.qty||1), 0);
    const expires  = new Date(Date.now() + 24*60*60*1000).toISOString();

    try {
        await addDoc(collection(db, 'reservations'), {
            code,
            customerName:  name,
            customerPhone: phone,
            items: items.map(i => ({
                productId: i.productId,
                name:      i.name,
                size:      i.size  || '',
                color:     i.color || '',
                price:     i.price,
                qty:       i.qty  || 1,
                imageUrl:  i.imageUrl || '',
                category:  i.category || '',
            })),
            subtotal,
            status:    'pending',
            expiresAt: expires,
            createdAt: serverTimestamp(),
        });

        saveBag([]);
        closeBag();
        showReservationSuccess(code, name, phone, items, subtotal);

        /* WhatsApp confirmation to customer */
        const lines = items.map(i => `• ${i.name} (${i.size||'OS'}) ×${i.qty||1} = ₹${(i.price*(i.qty||1)).toLocaleString('en-IN')}`).join('\n');
        const msg   = `Hi ${name}! Your LaFashionPoint reservation is confirmed ✅\n\nOrder Code: *${code}*\n\n${lines}\n\nTotal: ₹${subtotal.toLocaleString('en-IN')}\n\nShow this code at our store. Items held for 24 hours.\n📍 Hanumangarh, Rajasthan`;
        setTimeout(() => window.open(`https://wa.me/91${phone.replace(/\D/g,'')}?text=${encodeURIComponent(msg)}`, '_blank', 'noopener'), 600);

    } catch (err) {
        console.error(err);
        showToast('Could not reserve — please WhatsApp us directly');
    } finally {
        if (btn) { btn.innerHTML = '<i class="fas fa-store"></i> Reserve for Pickup'; btn.disabled = false; }
    }
};

function generateOrderCode() {
    const chars = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
    return Array.from({length: 5}, () => chars[Math.floor(Math.random()*chars.length)]).join('');
}

function showReservationSuccess(code, name, phone, items, subtotal) {
    const el = document.getElementById('reservationSuccess');
    if (!el) return;
    document.getElementById('resOrderCode').textContent = code;
    document.getElementById('resDetails').innerHTML =
        `<strong>${name}</strong> · ${phone}<br>${items.reduce((s,i)=>s+(i.qty||1),0)} item(s) · ₹${subtotal.toLocaleString('en-IN')}`;
    el.style.display = 'flex';
}

window.copyOrderCode = function() {
    const code = document.getElementById('resOrderCode')?.textContent;
    if (code) navigator.clipboard.writeText(code).then(() => showToast('Order code copied!'));
};

window.closeReservationSuccess = function() {
    const el = document.getElementById('reservationSuccess');
    if (el) el.style.display = 'none';
};

/* init */
updateBagCount();

/* ============================================================
   COPY COUPON
   ============================================================ */
window.copyCoupon = function(code) {
    navigator.clipboard.writeText(code).then(() => showToast(`Coupon "${code}" copied!`)).catch(() => {
        const el = document.createElement('textarea');
        el.value = code;
        Object.assign(el.style, { position:'fixed', opacity:'0' });
        document.body.appendChild(el);
        el.select();
        document.execCommand('copy');
        document.body.removeChild(el);
        showToast(`Coupon "${code}" copied!`);
    });
};

/* ============================================================
   CONTACT FORM — saves inquiries to Firestore + WhatsApp
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

            const name     = data.name || 'there';
            const autoMsg  = encodeURIComponent(`Hi ${name}! Thank you for contacting LaFashionPoint. We received your inquiry${data.product ? ' about ' + data.product : ''}. We'll get back to you within minutes!\n\nFor faster response, reply here on WhatsApp.`);
            setTimeout(() => {
                window.open(`https://wa.me/${WA}?text=${autoMsg}`, '_blank', 'noopener');
            }, 500);
        } catch (err) {
            console.error(err);
            showToast('Could not send. Please WhatsApp us directly!');
            btn.innerHTML = orig;
            btn.disabled  = false;
        }
    });
}

/* ============================================================
   COOKIE CONSENT
   ============================================================ */
window.acceptCookies = function() {
    localStorage.setItem('lfp_cookies_accepted', '1');
    document.getElementById('cookieBanner').style.display = 'none';
};
window.declineCookies = function() {
    document.getElementById('cookieBanner').style.display = 'none';
};

if (!localStorage.getItem('lfp_cookies_accepted')) {
    setTimeout(() => {
        const banner = document.getElementById('cookieBanner');
        if (banner) banner.style.display = 'flex';
    }, 1000);
}

/* ============================================================
   PWA — Register Service Worker
   ============================================================ */
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('/sw.js').catch(err => {
            console.warn('SW registration failed:', err);
        });
    });
}

// Init wishlist badge on load
updateWishlistCount();
