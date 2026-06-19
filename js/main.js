import { db } from './firebase-config.js';
import { collection, onSnapshot, query, where, orderBy } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

/* ============================================================
   PRODUCTS — load from Firestore in real time
   ============================================================ */
const WA = '9190796611614';

function productCard(p) {
    const discount = p.originalPrice && p.originalPrice > p.price
        ? Math.round((1 - p.price / p.originalPrice) * 100)
        : null;

    const badgeHtml = p.badge
        ? `<span class="badge-${p.badge.toLowerCase()}">${p.badge}</span>`
        : '';

    const discountBadge = discount
        ? `<span class="badge-sale">-${discount}%</span>`
        : '';

    const imgHtml = p.imageUrl
        ? `<img src="${p.imageUrl}" alt="${p.name}" loading="lazy">`
        : `<div class="product-icon"><i class="fas fa-${iconFor(p.category)}"></i></div>`;

    const originalPriceHtml = p.originalPrice && p.originalPrice > p.price
        ? `<span class="price-original">₹${p.originalPrice.toLocaleString('en-IN')}</span>`
        : '';

    const waText = encodeURIComponent(`Hi! I want to order ${p.name} from LaFashionPoint`);

    return `
    <div class="product-card reveal">
        <div class="product-img ${p.imageUrl ? 'has-photo' : bgClass(p.category)}">
            ${imgHtml}
            <div class="product-hover">
                <a href="https://wa.me/${WA}?text=${waText}" target="_blank" rel="noopener" class="btn btn-gold">Order Now</a>
            </div>
            ${badgeHtml}${discountBadge}
        </div>
        <div class="product-body">
            <h3>${p.name}</h3>
            <p>${p.description}</p>
            <div class="product-price">
                <span class="price-main">₹${p.price.toLocaleString('en-IN')}</span>
                ${originalPriceHtml}
            </div>
            <a href="https://wa.me/${WA}?text=${waText}" target="_blank" rel="noopener" class="btn btn-outline-dark btn-sm">
                <i class="fab fa-whatsapp"></i> Enquire
            </a>
        </div>
    </div>`;
}

function iconFor(cat) {
    const map = { 'T-Shirt': 'tshirt', 'Shirt': 'user-tie', 'Hoodie': 'hat-wizard', 'Jeans': 'drafting-compass' };
    return map[cat] || 'tshirt';
}

function bgClass(cat) {
    const map = { 'T-Shirt': 'bg-tshirt', 'Shirt': 'bg-shirt', 'Hoodie': 'bg-hoodie', 'Jeans': 'bg-jeans' };
    return map[cat] || 'bg-tshirt';
}

const grid     = document.getElementById('productsGrid');
const loading  = document.getElementById('productsLoading');
const empty    = document.getElementById('productsEmpty');

const q = query(
    collection(db, 'products'),
    where('available', '==', true),
    orderBy('order', 'asc')
);

onSnapshot(q, snap => {
    loading.style.display = 'none';
    if (snap.empty) {
        empty.style.display = 'block';
        grid.style.display  = 'none';
        return;
    }
    empty.style.display = 'none';
    grid.style.display  = 'grid';
    grid.innerHTML = snap.docs.map(d => productCard({ id: d.id, ...d.data() })).join('');
    activateReveal(grid.querySelectorAll('.reveal'));
}, err => {
    console.error('Firestore error:', err);
    loading.style.display = 'none';
    empty.style.display   = 'block';
});

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

document.querySelectorAll('.coupon, .payment-card, .about-card, .stat').forEach(el => {
    el.classList.add('reveal');
});
activateReveal(document.querySelectorAll('.reveal'));

/* ============================================================
   STICKY HEADER
   ============================================================ */
const header = document.getElementById('header');
window.addEventListener('scroll', () => {
    header.classList.toggle('scrolled', window.scrollY > 40);
});

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

new IntersectionObserver(entries => {
    entries.forEach(e => {
        if (e.isIntersecting) {
            links.forEach(l => l.classList.remove('active'));
            const a = document.querySelector(`.nav-link[href="#${e.target.id}"]`);
            if (a) a.classList.add('active');
        }
    });
}, { rootMargin: '-40% 0px -55% 0px' }).observe
    // observe each section
; sections.forEach(s => {
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
        Object.assign(el.style, { position: 'fixed', opacity: '0' });
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
import { addDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

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
