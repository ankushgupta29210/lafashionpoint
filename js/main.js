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
        showToast('Added to wishlist');
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
            <div class="wishlist-item-img ${p.imageUrl ? '' : bgClass(p.category)}">
                ${p.imageUrl ? `<img src="${p.imageUrl}" alt="${p.name}">` : `<i class="fas fa-${iconFor(p.category)}"></i>`}
            </div>
            <div class="wishlist-item-info">
                <p class="wishlist-item-cat">${p.category}</p>
                <h4>${p.name}</h4>
                <p class="wishlist-item-price">₹${p.price.toLocaleString('en-IN')}</p>
            </div>
            <div class="wishlist-item-actions">
                <button class="btn btn-gold btn-sm" onclick="closeWishlist();openProductModal('${p.id}')">View</button>
                <button class="btn-wishlist-remove" onclick="removeFromWishlistModal('${p.id}')"><i class="fas fa-trash-alt"></i></button>
            </div>
        </div>
    `).join('');
}
window.removeFromWishlistModal = function(id) {
    let ids = getWishlist().filter(i => i !== id);
    saveWishlist(ids);
    renderWishlistModal();
    // update card heart if visible
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

    const badgeHtml    = p.badge ? `<span class="badge-${p.badge.toLowerCase()}">${p.badge}</span>` : '';
    const discountBadge = discount ? `<span class="badge-sale">-${discount}%</span>` : '';
    const imgHtml      = p.imageUrl
        ? `<img src="${p.imageUrl}" alt="${p.name}" loading="lazy">`
        : `<div class="product-icon"><i class="fas fa-${iconFor(p.category)}"></i></div>`;
    const origPriceHtml = p.originalPrice && p.originalPrice > p.price
        ? `<span class="price-original">₹${p.originalPrice.toLocaleString('en-IN')}</span>` : '';

    const wishlisted = isWishlisted(p.id);

    return `
    <div class="product-card reveal" onclick="openProductModal('${p.id}')">
        <div class="product-img ${p.imageUrl ? 'has-photo' : bgClass(p.category)}">
            ${imgHtml}
            ${badgeHtml}${discountBadge}
            <button class="wishlist-btn ${wishlisted ? 'active' : ''}"
                onclick="event.stopPropagation();toggleWishlist('${p.id}',this)"
                title="Add to wishlist">
                <i class="${wishlisted ? 'fas' : 'far'} fa-heart"></i>
            </button>
            <div class="product-hover"><span class="btn btn-gold btn-sm">View Details</span></div>
        </div>
        <div class="product-body">
            <p class="product-cat-tag">${p.category}</p>
            <h3>${p.name}</h3>
            <div class="product-price">
                <span class="price-main">₹${p.price.toLocaleString('en-IN')}</span>
                ${origPriceHtml}
                ${discount ? `<span class="price-discount-pct">${discount}% off</span>` : ''}
            </div>
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
        grid.innerHTML = `<div style="grid-column:1/-1;text-align:center;padding:60px 24px;color:#666;">
            <i class="fas fa-box-open" style="font-size:2.5rem;color:#ddd;display:block;margin-bottom:12px;"></i>
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

    // Update thumbs
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
        carousel.style.display  = 'none';
        placeholder.innerHTML   = `<i class="fas fa-${iconFor(p.category)}"></i>`;
        placeholder.style.display = 'flex';
        imgCol.className = 'pd-image-col ' + bgClass(p.category);
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

    // show/hide arrows
    const arrows = carousel.querySelectorAll('.pd-car-arrow');
    arrows.forEach(a => { a.style.display = images.length > 1 ? 'flex' : 'none'; });
}

window.openProductModal = function(id) {
    const p = productsCache[id];
    if (!p) return;
    currentProduct = p;
    selectedSize   = '';
    selectedColor  = '';

    /* Carousel / images */
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
    renderModalSizeChips(p, sizes, '');

    /* Colours */
    renderModalColorChips(p, '');

    /* Reset tabs */
    document.querySelectorAll('.pd-tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.pd-tab-content').forEach(c => c.classList.remove('active'));
    document.querySelector('.pd-tab[data-tab="details"]').classList.add('active');
    document.getElementById('pdTabDetails').classList.add('active');

    /* Related products */
    buildRelatedProducts(p);

    /* Reviews */
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

document.addEventListener('keydown', e => { if (e.key === 'Escape') { closeProductModal(); closeWishlist(); } });

/* ============================================================
   BUY NOW — RAZORPAY (Feature 12)
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
        theme: { color: '#C9A84C' }
    };
    new Razorpay(options).open();
};

/* ============================================================
   RELATED PRODUCTS (Feature 7)
   ============================================================ */
function buildRelatedProducts(p) {
    const related = allProducts
        .filter(x => x.category === p.category && x.id !== p.id)
        .slice(0, 3);
    const container = document.getElementById('pdRelated');
    const grid      = document.getElementById('pdRelatedGrid');
    if (!related.length) { container.style.display = 'none'; return; }
    container.style.display = 'block';
    grid.innerHTML = related.map(r => `
        <div class="pd-related-card" onclick="closeProductModal();setTimeout(()=>openProductModal('${r.id}'),200)">
            <div class="pd-related-img ${r.imageUrl ? '' : bgClass(r.category)}">
                ${r.imageUrl ? `<img src="${r.imageUrl}" alt="${r.name}">` : `<i class="fas fa-${iconFor(r.category)}"></i>`}
            </div>
            <p class="pd-related-name">${r.name}</p>
            <p class="pd-related-price">₹${r.price.toLocaleString('en-IN')}</p>
        </div>
    `).join('');
}

/* ============================================================
   REVIEWS (Feature 5)
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
        `<i class="${n <= rating ? 'fas' : 'far'} fa-star" style="color:${n <= rating ? '#f59e0b' : '#ddd'};font-size:.85rem;"></i>`
    ).join('');
}

async function loadReviews(productId) {
    const listEl  = document.getElementById('pdReviewsList');
    const avgEl   = document.getElementById('pdAvgRating');
    if (!listEl || !avgEl) return;
    listEl.innerHTML = '<p style="font-size:.8rem;color:#999;">Loading reviews…</p>';
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
        name,
        rating: reviewRating,
        comment,
        approved: false,
        createdAt: serverTimestamp()
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
   ORDER TRACKING (Feature 6)
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
                const col = statusColor[o.status] || '#888';
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
    const grid = document.getElementById('couponsGrid');
    if (!grid) return;
    /* mark the middle item as featured */
    const mid = Math.floor(coupons.length / 2);
    grid.innerHTML = coupons.map((c, i) => couponCard(c, i === mid)).join('');
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
   TESTIMONIALS (Feature 9)
   ============================================================ */
const TESTIMONIALS = [
    { name:'Rahul Sharma',  location:'Jaipur',       text:'Ordered a polo T-shirt and received it in 4 days. Quality is amazing for the price!',                          rating:5 },
    { name:'Vikram Singh',  location:'Delhi',         text:'The hoodie is super warm and the colour is exactly as shown. Will order again!',                               rating:5 },
    { name:'Arjun Patel',   location:'Mumbai',        text:'Fast delivery, great packing, and the jeans fit perfectly. Highly recommended!',                               rating:5 },
    { name:'Deepak Kumar',  location:'Chandigarh',    text:'Best men\'s fashion store for this price range. Already ordered 3 times!',                                     rating:5 },
    { name:'Sunil Gupta',   location:'Hanumangarh',   text:'Local store but delivers all over India. Very proud to support local business!',                               rating:5 },
];

let testimonialIdx = 0;
let testimonialTimer = null;

function getTestimonialsPerView() {
    return window.innerWidth >= 768 ? 3 : 1;
}

function renderTestimonials() {
    const track  = document.getElementById('testimonialsTrack');
    const dots   = document.getElementById('testDots');
    if (!track || !dots) return;

    const perView = getTestimonialsPerView();
    const total   = TESTIMONIALS.length;

    // Clamp index
    if (testimonialIdx < 0) testimonialIdx = total - 1;
    if (testimonialIdx >= total) testimonialIdx = 0;

    // Build visible group starting from testimonialIdx
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

    // Dots
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

// Init testimonials
renderTestimonials();
resetTestimonialTimer();

window.addEventListener('resize', renderTestimonials);

/* ============================================================
   FAQ ACCORDION (Feature 8)
   ============================================================ */
window.toggleFaq = function(btn) {
    const item   = btn.closest('.faq-item');
    const answer = item.querySelector('.faq-answer');
    const isOpen = item.classList.contains('open');

    // Close all
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
   CONTACT FORM — saves inquiries to Firestore + WhatsApp (Feature 13)
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

            // Auto-open WhatsApp with thank you + order prompt
            const name = data.name || 'there';
            const autoMsg = encodeURIComponent(`Hi ${name}! Thank you for contacting LaFashionPoint. We received your inquiry${data.product ? ' about ' + data.product : ''}. We'll get back to you within minutes!\n\nFor faster response, reply here on WhatsApp.`);
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
   COOKIE CONSENT (Feature 10)
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
   PWA — Register Service Worker (Feature 1)
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
