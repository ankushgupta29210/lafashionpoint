import { auth, db, storage } from './firebase-config.js';

import {
    signInWithEmailAndPassword, signOut, onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";

import {
    collection, doc, addDoc, updateDoc, deleteDoc,
    onSnapshot, query, orderBy, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

import {
    ref, uploadBytesResumable, getDownloadURL, deleteObject
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-storage.js";

/* ============================================================
   STATE
   ============================================================ */
let allProducts  = [];
let allOrders    = [];
let allCoupons   = [];
let totalInquiries  = 0;
let unreadInquiries = 0;
let pendingImageFile = null;
let pendingDeleteId  = null;
let pendingImageUrl  = '';
let pendingDeleteOrderId  = null;
let pendingDeleteCouponId = null;

/* ============================================================
   AUTH
   ============================================================ */
onAuthStateChanged(auth, user => {
    if (user) {
        document.getElementById('loginScreen').style.display = 'none';
        document.getElementById('adminApp').style.display    = 'flex';
        document.getElementById('adminEmail').textContent    = user.email;
        startListeners();
        // Wire up size chips once DOM is visible
        document.querySelectorAll('.size-chip').forEach(chip => {
            chip.addEventListener('click', () => chip.classList.toggle('active'));
        });
    } else {
        document.getElementById('loginScreen').style.display = 'flex';
        document.getElementById('adminApp').style.display    = 'none';
    }
});

document.getElementById('loginForm').addEventListener('submit', async e => {
    e.preventDefault();
    const email = document.getElementById('loginEmail').value.trim();
    const pass  = document.getElementById('loginPass').value;
    const btn   = document.getElementById('loginBtn');
    const errEl = document.getElementById('loginError');

    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Signing in…';
    btn.disabled  = true;
    errEl.style.display = 'none';

    try {
        await signInWithEmailAndPassword(auth, email, pass);
    } catch (err) {
        errEl.textContent   = friendlyAuthError(err.code);
        errEl.style.display = 'block';
        btn.innerHTML = '<i class="fas fa-sign-in-alt"></i> Sign In';
        btn.disabled  = false;
    }
});

window.handleLogout = async () => { await signOut(auth); toast('Logged out', 'success'); };

function friendlyAuthError(code) {
    const map = {
        'auth/invalid-email':          'Please enter a valid email address.',
        'auth/user-not-found':         'No account found with this email.',
        'auth/wrong-password':         'Incorrect password. Please try again.',
        'auth/invalid-credential':     'Incorrect email or password.',
        'auth/too-many-requests':      'Too many attempts. Please wait a moment.',
        'auth/network-request-failed': 'Network error. Check your internet connection.',
    };
    return map[code] || 'Sign-in failed. Please try again.';
}

window.togglePass = () => {
    const inp  = document.getElementById('loginPass');
    const icon = document.getElementById('eyeIcon');
    const show = inp.type === 'password';
    inp.type       = show ? 'text' : 'password';
    icon.className = show ? 'fas fa-eye-slash' : 'fas fa-eye';
};

/* ============================================================
   NAVIGATION
   ============================================================ */
const SECTIONS = ['dashboard','products','form','inquiries','pos','orders','orderForm','coupons','couponForm','settings'];
const TITLES   = {
    dashboard:'Dashboard', products:'Products', form:'',
    inquiries:'Inquiries', pos:'Point of Sale', orders:'Orders', orderForm:'',
    coupons:'Coupons', couponForm:'', settings:'Settings'
};

window.showSection = name => {
    SECTIONS.forEach(s => {
        const el = document.getElementById(`section${cap(s)}`);
        if (el) el.classList.toggle('active', s === name);
    });
    document.querySelectorAll('.nav-item').forEach(n => {
        n.classList.toggle('active', n.dataset.section === name);
    });
    document.getElementById('pageTitle').textContent = TITLES[name] || '';
    closeSidebar();
};

window.openSidebar  = () => document.getElementById('sidebar').classList.add('open');
window.closeSidebar = () => document.getElementById('sidebar').classList.remove('open');
function cap(s) { return s.charAt(0).toUpperCase() + s.slice(1); }

/* ============================================================
   REAL-TIME LISTENERS
   ============================================================ */
function startListeners() {
    listenProducts();
    listenInquiries();
    listenOrders();
    listenCoupons();
    syncOfflineSales();
    watchOnlineStatus();
}

/* ============================================================
   DASHBOARD
   ============================================================ */
function updateDashboard() {
    const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
    set('dTotalProducts',   allProducts.length);
    set('dTotalInquiries',  totalInquiries);
    set('dUnreadInquiries', unreadInquiries);
    set('dTotalOrders',     allOrders.length);
}

/* ============================================================
   PRODUCTS — FIRESTORE
   ============================================================ */
function listenProducts() {
    const q = query(collection(db, 'products'), orderBy('order', 'asc'));
    onSnapshot(q, snap => {
        allProducts = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        renderProductTable(allProducts);
        renderPosProducts();
        updateDashboard();
    });
}

function renderProductTable(products) {
    const container = document.getElementById('productsList');
    if (!products.length) {
        container.innerHTML = `
        <div class="empty-state">
            <i class="fas fa-box-open"></i>
            <p>No products yet. Add your first product!</p>
            <button class="btn-add" onclick="openProductForm()"><i class="fas fa-plus"></i> Add Product</button>
        </div>`;
        return;
    }
    const rows = products.map(p => `
    <tr>
        <td>
            ${p.imageUrl
                ? `<img src="${p.imageUrl}" class="prod-thumb" alt="${p.name}">`
                : `<div class="prod-thumb-placeholder"><i class="fas fa-${iconFor(p.category)}"></i></div>`}
        </td>
        <td>
            <div class="prod-name">${p.name}</div>
            <div class="prod-cat">${p.category}</div>
        </td>
        <td>
            <div class="price-tag">₹${(p.price || 0).toLocaleString('en-IN')}</div>
            ${p.originalPrice && p.originalPrice > p.price
                ? `<div class="price-original-s">₹${p.originalPrice.toLocaleString('en-IN')}</div>` : ''}
        </td>
        <td><span class="badge-pill ${(p.badge||'none').toLowerCase()}">${p.badge||'—'}</span></td>
        <td>
            <span class="status-dot ${p.available ? 'on' : 'off'}">
                ${p.available ? 'Available' : 'Hidden'}
            </span>
        </td>
        <td>
            <div class="row-actions">
                <button class="btn-edit" onclick="editProduct('${p.id}')"><i class="fas fa-pen"></i> Edit</button>
                <button class="btn-del"  onclick="confirmDelete('${p.id}')"><i class="fas fa-trash"></i></button>
            </div>
        </td>
    </tr>`).join('');

    container.innerHTML = `
    <table class="products-table">
        <thead>
            <tr><th>Photo</th><th>Name / Category</th><th>Price</th><th>Badge</th><th>Status</th><th>Actions</th></tr>
        </thead>
        <tbody>${rows}</tbody>
    </table>`;
}

window.filterProducts = () => {
    const search = document.getElementById('searchProducts').value.toLowerCase();
    const cat    = document.getElementById('filterCategory').value;
    renderProductTable(allProducts.filter(p =>
        p.name.toLowerCase().includes(search) && (!cat || p.category === cat)
    ));
};

function iconFor(cat) {
    return { 'T-Shirt':'tshirt', 'Shirt':'user-tie', 'Hoodie':'hat-wizard', 'Jeans':'drafting-compass' }[cat] || 'tshirt';
}

/* ============================================================
   PRODUCT FORM
   ============================================================ */
window.openProductForm = () => {
    resetForm();
    document.getElementById('formTitle').textContent = 'Add New Product';
    document.getElementById('pageTitle').textContent = 'Add Product';
    showSection('form');
};

window.editProduct = async id => {
    const p = allProducts.find(x => x.id === id);
    if (!p) return;
    resetForm();
    document.getElementById('formTitle').textContent = 'Edit Product';
    document.getElementById('pageTitle').textContent = 'Edit Product';

    document.getElementById('editId').value          = id;
    document.getElementById('pName').value           = p.name          || '';
    document.getElementById('pCategory').value       = p.category      || '';
    document.getElementById('pBadge').value          = p.badge         || '';
    document.getElementById('pPrice').value          = p.price         ?? '';
    document.getElementById('pOriginalPrice').value  = p.originalPrice ?? '';
    document.getElementById('pDescription').value    = p.description   || '';
    document.getElementById('pFabric').value         = p.fabric        || '';
    document.getElementById('pColors').value         = (p.colors || []).join(', ');
    document.getElementById('pOrder').value          = p.order         ?? 99;
    document.getElementById('pAvailable').checked   = p.available      !== false;

    /* Sizes */
    document.querySelectorAll('.size-chip').forEach(chip => {
        chip.classList.toggle('active', (p.sizes || []).includes(chip.dataset.size));
    });

    if (p.imageUrl) {
        pendingImageUrl = p.imageUrl;
        const img = document.getElementById('imagePreviewImg');
        img.src = p.imageUrl;
        img.style.display = 'block';
        document.getElementById('imagePreview').style.display  = 'none';
        document.getElementById('imageActions').style.display  = 'flex';
    }
    showSection('form');
};

function resetForm() {
    document.getElementById('productForm').reset();
    document.getElementById('editId').value                    = '';
    document.getElementById('imagePreviewImg').style.display   = 'none';
    document.getElementById('imagePreview').style.display      = 'flex';
    document.getElementById('imageActions').style.display      = 'none';
    document.getElementById('uploadProgress').style.display    = 'none';
    document.getElementById('pFabric').value                   = '';
    document.getElementById('pColors').value                   = '';
    document.querySelectorAll('.size-chip').forEach(c => c.classList.remove('active'));
    pendingImageFile = null;
    pendingImageUrl  = '';
}

window.handleImageSelect = e => {
    const file = e.target.files[0];
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) { toast('Image must be under 5 MB', 'error'); return; }
    pendingImageFile = file;
    const reader = new FileReader();
    reader.onload = ev => {
        const img = document.getElementById('imagePreviewImg');
        img.src = ev.target.result;
        img.style.display = 'block';
        document.getElementById('imagePreview').style.display = 'none';
        document.getElementById('imageActions').style.display = 'flex';
    };
    reader.readAsDataURL(file);
};

window.removeImage = () => {
    pendingImageFile = null;
    pendingImageUrl  = '';
    document.getElementById('imageInput').value                = '';
    document.getElementById('imagePreviewImg').style.display   = 'none';
    document.getElementById('imagePreview').style.display      = 'flex';
    document.getElementById('imageActions').style.display      = 'none';
};

window.saveProduct = async e => {
    e.preventDefault();
    const btn = document.getElementById('saveBtn');
    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Saving…';
    btn.disabled  = true;

    const id       = document.getElementById('editId').value;
    const name     = document.getElementById('pName').value.trim();
    const category = document.getElementById('pCategory').value;
    const badge    = document.getElementById('pBadge').value;
    const price    = Number(document.getElementById('pPrice').value);
    const orig     = Number(document.getElementById('pOriginalPrice').value) || null;
    const desc     = document.getElementById('pDescription').value.trim();
    const fabric   = document.getElementById('pFabric').value.trim() || null;
    const colorsRaw = document.getElementById('pColors').value;
    const colors   = colorsRaw ? colorsRaw.split(',').map(c => c.trim()).filter(Boolean) : null;
    const sizes    = Array.from(document.querySelectorAll('.size-chip.active')).map(c => c.dataset.size);
    const order    = Number(document.getElementById('pOrder').value) || 99;
    const avail    = document.getElementById('pAvailable').checked;

    let imageUrl = pendingImageUrl;

    try {
        if (pendingImageFile) {
            imageUrl = await uploadImage(pendingImageFile, id || Date.now().toString());
        }
        const data = {
            name, category, badge, price, description: desc,
            fabric:        fabric || null,
            colors:        colors && colors.length ? colors : null,
            sizes:         sizes.length ? sizes : null,
            order, available: avail,
            imageUrl:      imageUrl || '',
            originalPrice: orig && orig > price ? orig : null,
            updatedAt:     serverTimestamp(),
        };
        if (id) {
            await updateDoc(doc(db, 'products', id), data);
            toast('Product updated!', 'success');
        } else {
            data.createdAt = serverTimestamp();
            await addDoc(collection(db, 'products'), data);
            toast('Product added!', 'success');
        }
        showSection('products');
    } catch (err) {
        console.error(err);
        toast('Error saving product. Please try again.', 'error');
    } finally {
        btn.innerHTML = '<i class="fas fa-save"></i> Save Product';
        btn.disabled  = false;
    }
};

async function uploadImage(file, productId) {
    return new Promise((resolve, reject) => {
        const ext        = file.name.split('.').pop();
        const storageRef = ref(storage, `products/${productId}_${Date.now()}.${ext}`);
        const task       = uploadBytesResumable(storageRef, file);
        const progressWrap = document.getElementById('uploadProgress');
        const fill         = document.getElementById('progressFill');
        const text         = document.getElementById('progressText');
        progressWrap.style.display = 'block';

        task.on('state_changed',
            snap => {
                const pct = Math.round((snap.bytesTransferred / snap.totalBytes) * 100);
                fill.style.width = pct + '%';
                text.textContent = `Uploading… ${pct}%`;
            },
            err => reject(err),
            async () => {
                const url = await getDownloadURL(task.snapshot.ref);
                progressWrap.style.display = 'none';
                resolve(url);
            }
        );
    });
}

/* Delete product */
window.confirmDelete = id => {
    pendingDeleteId = id;
    const modal = document.getElementById('deleteModal');
    modal.querySelector('h3').textContent = 'Delete Product?';
    modal.querySelector('p').textContent  = 'This will permanently delete the product and its image. This cannot be undone.';
    document.getElementById('confirmDeleteBtn').onclick = doDelete;
    modal.style.display = 'flex';
};

window.closeDeleteModal = () => {
    document.getElementById('deleteModal').style.display = 'none';
    pendingDeleteId = pendingDeleteOrderId = pendingDeleteCouponId = null;
};

async function doDelete() {
    if (!pendingDeleteId) return;
    const btn = document.getElementById('confirmDeleteBtn');
    btn.textContent = 'Deleting…';
    btn.disabled    = true;
    try {
        const p = allProducts.find(x => x.id === pendingDeleteId);
        if (p?.imageUrl) {
            try { await deleteObject(ref(storage, p.imageUrl)); } catch (_) {}
        }
        await deleteDoc(doc(db, 'products', pendingDeleteId));
        toast('Product deleted', 'success');
    } catch (err) {
        console.error(err);
        toast('Error deleting product', 'error');
    } finally {
        closeDeleteModal();
        btn.textContent = 'Delete';
        btn.disabled    = false;
    }
}

/* ============================================================
   INQUIRIES
   ============================================================ */
function listenInquiries() {
    const q = query(collection(db, 'inquiries'), orderBy('createdAt', 'desc'));
    onSnapshot(q, snap => {
        const docs = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        totalInquiries  = docs.length;
        unreadInquiries = docs.filter(d => !d.read).length;
        const countEl = document.getElementById('inquiryCount');
        countEl.textContent   = unreadInquiries;
        countEl.style.display = unreadInquiries ? 'inline-block' : 'none';
        updateDashboard();
        renderInquiries(docs);
    });
}

function renderInquiries(docs) {
    const container = document.getElementById('inquiriesList');
    if (!docs.length) {
        container.innerHTML = `<div class="empty-state"><i class="fas fa-inbox"></i><p>No inquiries yet.</p></div>`;
        return;
    }
    container.innerHTML = docs.map(d => {
        const date  = d.createdAt?.toDate ? d.createdAt.toDate().toLocaleString('en-IN') : 'Just now';
        const waMsg = encodeURIComponent(`Hi ${d.name}! Thanks for your inquiry${d.product ? ' about ' + d.product : ''}. `);
        return `
        <div class="inquiry-card ${d.read ? 'read' : ''}" id="inq-${d.id}">
            <div>
                <div class="inquiry-name">${d.name || 'Unknown'}</div>
                <div class="inquiry-meta">
                    ${d.phone   ? `<span><i class="fas fa-phone"></i> ${d.phone}</span>`   : ''}
                    ${d.email   ? `<span><i class="fas fa-envelope"></i> ${d.email}</span>` : ''}
                    ${d.product ? `<span><i class="fas fa-box"></i> ${d.product}</span>`   : ''}
                    ${d.coupon  ? `<span><i class="fas fa-tag"></i> ${d.coupon}</span>`    : ''}
                </div>
                ${d.message ? `<div class="inquiry-msg">${d.message}</div>` : ''}
            </div>
            <div class="inquiry-actions">
                <span class="inquiry-date">${date}</span>
                ${d.phone
                    ? `<a href="https://wa.me/91${d.phone.replace(/\D/g,'')}?text=${waMsg}" target="_blank" rel="noopener" class="btn-wa-reply">
                           <i class="fab fa-whatsapp"></i> Reply
                       </a>` : ''}
                ${!d.read
                    ? `<button class="btn-edit" onclick="markRead('${d.id}')"><i class="fas fa-check"></i> Mark Read</button>`
                    : ''}
            </div>
        </div>`;
    }).join('');
}

window.markRead = async id => { await updateDoc(doc(db, 'inquiries', id), { read: true }); };

/* ============================================================
   ORDERS
   ============================================================ */
function listenOrders() {
    const q = query(collection(db, 'orders'), orderBy('createdAt', 'desc'));
    onSnapshot(q, snap => {
        allOrders = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        const el = document.getElementById('ordersCount');
        const pending = allOrders.filter(o => o.status === 'Pending').length;
        if (el) { el.textContent = pending; el.style.display = pending ? 'inline-block' : 'none'; }
        updateDashboard();
        renderOrders(allOrders);
    });
}

function renderOrders(orders) {
    const container = document.getElementById('ordersList');
    if (!container) return;
    if (!orders.length) {
        container.innerHTML = `
        <div class="empty-state">
            <i class="fas fa-shopping-bag"></i>
            <p>No orders yet. Log your first WhatsApp order!</p>
            <button class="btn-add" onclick="openOrderForm()"><i class="fas fa-plus"></i> Log Order</button>
        </div>`;
        return;
    }
    const statusClass = { Pending:'order-pending', Shipped:'order-shipped', Delivered:'order-delivered' };
    const rows = orders.map(o => {
        const date = o.createdAt?.toDate ? o.createdAt.toDate().toLocaleDateString('en-IN') : '—';
        const sc   = statusClass[o.status] || 'order-pending';
        return `
        <tr>
            <td>
                <div class="prod-name">${o.name || '—'}</div>
                <div class="prod-cat">${o.phone || ''}</div>
            </td>
            <td>${o.product || '—'}</td>
            <td>${[o.size, o.color].filter(Boolean).join(' / ') || '—'}</td>
            <td>${o.qty || 1}</td>
            <td>${o.amount ? `₹${Number(o.amount).toLocaleString('en-IN')}` : '—'}</td>
            <td><span class="order-status ${sc}">${o.status || 'Pending'}</span></td>
            <td><span class="inquiry-date">${date}</span></td>
            <td>
                <div class="row-actions">
                    <button class="btn-edit" onclick="editOrder('${o.id}')"><i class="fas fa-pen"></i> Edit</button>
                    <button class="btn-del"  onclick="confirmDeleteOrder('${o.id}')"><i class="fas fa-trash"></i></button>
                </div>
            </td>
        </tr>`;
    }).join('');

    container.innerHTML = `
    <table class="products-table">
        <thead>
            <tr>
                <th>Customer</th><th>Product</th><th>Size / Colour</th>
                <th>Qty</th><th>Amount</th><th>Status</th><th>Date</th><th>Actions</th>
            </tr>
        </thead>
        <tbody>${rows}</tbody>
    </table>`;
}

window.filterOrders = () => {
    const status = document.getElementById('filterOrderStatus').value;
    renderOrders(status ? allOrders.filter(o => o.status === status) : allOrders);
};

window.openOrderForm = () => {
    resetOrderForm();
    document.getElementById('orderFormTitle').textContent = 'Log New Order';
    document.getElementById('pageTitle').textContent      = 'Log Order';
    populateProductSelect();
    showSection('orderForm');
};

window.editOrder = id => {
    const o = allOrders.find(x => x.id === id);
    if (!o) return;
    resetOrderForm();
    document.getElementById('orderFormTitle').textContent = 'Edit Order';
    document.getElementById('pageTitle').textContent      = 'Edit Order';

    document.getElementById('editOrderId').value = id;
    document.getElementById('oName').value   = o.name    || '';
    document.getElementById('oPhone').value  = o.phone   || '';
    document.getElementById('oSize').value   = o.size    || '';
    document.getElementById('oColor').value  = o.color   || '';
    document.getElementById('oQty').value    = o.qty     || 1;
    document.getElementById('oAmount').value = o.amount  || '';
    document.getElementById('oStatus').value = o.status  || 'Pending';
    document.getElementById('oCoupon').value = o.coupon  || '';
    document.getElementById('oNotes').value  = o.notes   || '';

    populateProductSelect(o.product);
    showSection('orderForm');
};

function populateProductSelect(selected = '') {
    const sel = document.getElementById('oProduct');
    sel.innerHTML = '<option value="">— Select product —</option>' +
        allProducts.map(p =>
            `<option value="${p.name}"${p.name === selected ? ' selected' : ''}>${p.name}</option>`
        ).join('');
}

function resetOrderForm() {
    document.getElementById('orderForm').reset();
    document.getElementById('editOrderId').value = '';
    document.getElementById('oStatus').value     = 'Pending';
    document.getElementById('oQty').value        = 1;
}

window.saveOrder = async e => {
    e.preventDefault();
    const btn = document.getElementById('saveOrderBtn');
    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Saving…';
    btn.disabled  = true;

    const id   = document.getElementById('editOrderId').value;
    const data = {
        name:      document.getElementById('oName').value.trim(),
        phone:     document.getElementById('oPhone').value.trim(),
        product:   document.getElementById('oProduct').value,
        size:      document.getElementById('oSize').value.trim(),
        color:     document.getElementById('oColor').value.trim(),
        qty:       Number(document.getElementById('oQty').value) || 1,
        amount:    Number(document.getElementById('oAmount').value) || 0,
        status:    document.getElementById('oStatus').value,
        coupon:    document.getElementById('oCoupon').value.trim(),
        notes:     document.getElementById('oNotes').value.trim(),
        updatedAt: serverTimestamp(),
    };

    try {
        if (id) {
            await updateDoc(doc(db, 'orders', id), data);
            toast('Order updated!', 'success');
        } else {
            data.createdAt = serverTimestamp();
            await addDoc(collection(db, 'orders'), data);
            toast('Order logged!', 'success');
        }
        showSection('orders');
    } catch (err) {
        console.error(err);
        toast('Error saving order', 'error');
    } finally {
        btn.innerHTML = '<i class="fas fa-save"></i> Save Order';
        btn.disabled  = false;
    }
};

window.confirmDeleteOrder = id => {
    pendingDeleteOrderId = id;
    const modal = document.getElementById('deleteModal');
    modal.querySelector('h3').textContent = 'Delete Order?';
    modal.querySelector('p').textContent  = 'This order record will be permanently deleted.';
    document.getElementById('confirmDeleteBtn').onclick = doDeleteOrder;
    modal.style.display = 'flex';
};

async function doDeleteOrder() {
    if (!pendingDeleteOrderId) return;
    const btn = document.getElementById('confirmDeleteBtn');
    btn.textContent = 'Deleting…';
    btn.disabled    = true;
    try {
        await deleteDoc(doc(db, 'orders', pendingDeleteOrderId));
        toast('Order deleted', 'success');
    } catch (err) {
        toast('Error deleting order', 'error');
    } finally {
        closeDeleteModal();
        btn.textContent = 'Delete';
        btn.disabled    = false;
    }
}

/* ============================================================
   COUPONS
   ============================================================ */
function listenCoupons() {
    const q = query(collection(db, 'coupons'), orderBy('createdAt', 'desc'));
    onSnapshot(q, snap => {
        allCoupons = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        renderCoupons(allCoupons);
    });
}

function renderCoupons(coupons) {
    const container = document.getElementById('couponsList');
    if (!container) return;
    if (!coupons.length) {
        container.innerHTML = `
        <div class="empty-state">
            <i class="fas fa-tag"></i>
            <p>No coupons yet. Create your first discount code!</p>
            <button class="btn-add" onclick="openCouponForm()"><i class="fas fa-plus"></i> Add Coupon</button>
        </div>`;
        return;
    }
    const rows = coupons.map(c => `
    <tr>
        <td><strong class="coupon-code-text">${c.code}</strong></td>
        <td><strong>${c.discount}%</strong></td>
        <td style="color:#6b7280;font-size:.85rem;">${c.description || '—'}</td>
        <td>${c.minOrder ? `₹${c.minOrder}` : '—'}</td>
        <td>${c.expiry || '—'}</td>
        <td><span class="status-dot ${c.active !== false ? 'on' : 'off'}">${c.active !== false ? 'Active' : 'Inactive'}</span></td>
        <td>
            <div class="row-actions">
                <button class="btn-edit" onclick="editCoupon('${c.id}')"><i class="fas fa-pen"></i> Edit</button>
                <button class="btn-del"  onclick="confirmDeleteCoupon('${c.id}')"><i class="fas fa-trash"></i></button>
            </div>
        </td>
    </tr>`).join('');

    container.innerHTML = `
    <table class="products-table">
        <thead>
            <tr><th>Code</th><th>Discount</th><th>Title</th><th>Min Order</th><th>Expiry</th><th>Status</th><th>Actions</th></tr>
        </thead>
        <tbody>${rows}</tbody>
    </table>`;
}

window.openCouponForm = () => {
    resetCouponForm();
    document.getElementById('couponFormTitle').textContent = 'Add Coupon';
    document.getElementById('pageTitle').textContent       = 'Add Coupon';
    showSection('couponForm');
};

window.editCoupon = id => {
    const c = allCoupons.find(x => x.id === id);
    if (!c) return;
    resetCouponForm();
    document.getElementById('couponFormTitle').textContent = 'Edit Coupon';
    document.getElementById('pageTitle').textContent       = 'Edit Coupon';

    document.getElementById('editCouponId').value = id;
    document.getElementById('cCode').value     = c.code        || '';
    document.getElementById('cDiscount').value = c.discount    || '';
    document.getElementById('cDesc').value     = c.description || '';
    document.getElementById('cMinOrder').value = c.minOrder    || '';
    document.getElementById('cExpiry').value   = c.expiry      || '';
    document.getElementById('cActive').checked = c.active !== false;

    showSection('couponForm');
};

function resetCouponForm() {
    document.getElementById('couponForm').reset();
    document.getElementById('editCouponId').value = '';
    document.getElementById('cActive').checked    = true;
}

window.saveCoupon = async e => {
    e.preventDefault();
    const btn = document.getElementById('saveCouponBtn');
    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Saving…';
    btn.disabled  = true;

    const id   = document.getElementById('editCouponId').value;
    const data = {
        code:        document.getElementById('cCode').value.trim().toUpperCase(),
        discount:    Number(document.getElementById('cDiscount').value),
        description: document.getElementById('cDesc').value.trim(),
        minOrder:    Number(document.getElementById('cMinOrder').value) || null,
        expiry:      document.getElementById('cExpiry').value || null,
        active:      document.getElementById('cActive').checked,
        updatedAt:   serverTimestamp(),
    };

    try {
        if (id) {
            await updateDoc(doc(db, 'coupons', id), data);
            toast('Coupon updated!', 'success');
        } else {
            data.createdAt = serverTimestamp();
            await addDoc(collection(db, 'coupons'), data);
            toast('Coupon added!', 'success');
        }
        showSection('coupons');
    } catch (err) {
        console.error(err);
        toast('Error saving coupon', 'error');
    } finally {
        btn.innerHTML = '<i class="fas fa-save"></i> Save Coupon';
        btn.disabled  = false;
    }
};

window.confirmDeleteCoupon = id => {
    pendingDeleteCouponId = id;
    const modal = document.getElementById('deleteModal');
    modal.querySelector('h3').textContent = 'Delete Coupon?';
    modal.querySelector('p').textContent  = 'This coupon code will be permanently deleted.';
    document.getElementById('confirmDeleteBtn').onclick = doDeleteCoupon;
    modal.style.display = 'flex';
};

async function doDeleteCoupon() {
    if (!pendingDeleteCouponId) return;
    const btn = document.getElementById('confirmDeleteBtn');
    btn.textContent = 'Deleting…';
    btn.disabled    = true;
    try {
        await deleteDoc(doc(db, 'coupons', pendingDeleteCouponId));
        toast('Coupon deleted', 'success');
    } catch (err) {
        toast('Error deleting coupon', 'error');
    } finally {
        closeDeleteModal();
        btn.textContent = 'Delete';
        btn.disabled    = false;
    }
}

/* ============================================================
   TOAST
   ============================================================ */
function toast(msg, type = '') {
    const t = document.getElementById('adminToast');
    t.textContent = msg;
    t.className   = `admin-toast ${type} show`;
    clearTimeout(t._timer);
    t._timer = setTimeout(() => t.classList.remove('show'), 2800);
}

/* ============================================================
   POS — POINT OF SALE
   ============================================================ */
const POS_DEFAULT_SIZES = {
    'T-Shirt':['S','M','L','XL','XXL'],
    'Shirt':  ['S','M','L','XL','XXL'],
    'Hoodie': ['S','M','L','XL','XXL','3XL'],
    'Jeans':  ['28','30','32','34','36','38'],
};

let posCart          = [];
let posPayMethod     = 'Cash';
let posActiveCat     = '';
let posCurProduct    = null;
let posItemQty       = 1;
let posSelSize       = '';
let posSelColor      = '';
let posAppliedCoupon = null;
let posCouponDisc    = 0;
let posLastSale      = null;

/* — Catalog — */
window.renderPosProducts = function() {
    const grid = document.getElementById('posProductsGrid');
    if (!grid) return;
    const search = (document.getElementById('posSearch')?.value || '').toLowerCase();
    let list = allProducts.filter(p => p.available !== false);
    if (posActiveCat) list = list.filter(p => p.category === posActiveCat);
    if (search) list = list.filter(p => p.name.toLowerCase().includes(search));

    if (!list.length) {
        grid.innerHTML = `<div class="pos-grid-empty"><i class="fas fa-box-open"></i><p>No products</p></div>`;
        return;
    }
    grid.innerHTML = list.map(p => {
        const bg  = {'T-Shirt':'bg-tshirt','Shirt':'bg-shirt','Hoodie':'bg-hoodie','Jeans':'bg-jeans'}[p.category]||'bg-tshirt';
        const img = p.imageUrl
            ? `<img src="${p.imageUrl}" alt="${p.name}" loading="lazy">`
            : `<div class="pos-icon-bg ${bg}"><i class="fas fa-${iconFor(p.category)}"></i></div>`;
        const disc = p.originalPrice && p.originalPrice > p.price
            ? Math.round((1-p.price/p.originalPrice)*100) : null;
        return `
        <div class="pos-prod-card" onclick="openPosItem('${p.id}')">
            <div class="pos-prod-img ${p.imageUrl ? 'has-img' : bg}">${img}</div>
            <div class="pos-prod-info">
                <p class="pos-prod-name">${p.name}</p>
                <div class="pos-prod-price-row">
                    <span class="pos-prod-price">₹${p.price.toLocaleString('en-IN')}</span>
                    ${disc ? `<span class="pos-prod-disc">${disc}% off</span>` : ''}
                </div>
            </div>
        </div>`;
    }).join('');
};

window.setPosCategory = (el, cat) => {
    document.querySelectorAll('.pos-cat').forEach(b => b.classList.remove('active'));
    el.classList.add('active');
    posActiveCat = cat;
    renderPosProducts();
};

/* — Item modal — */
window.openPosItem = id => {
    const p = allProducts.find(x => x.id === id);
    if (!p) return;
    posCurProduct = p;
    posItemQty    = 1;
    posSelSize    = '';
    posSelColor   = '';

    const bg = {'T-Shirt':'bg-tshirt','Shirt':'bg-shirt','Hoodie':'bg-hoodie','Jeans':'bg-jeans'}[p.category]||'bg-tshirt';
    document.getElementById('posItemImgWrap').innerHTML = p.imageUrl
        ? `<img src="${p.imageUrl}" alt="${p.name}" class="pos-modal-img">`
        : `<div class="pos-modal-icon ${bg}"><i class="fas fa-${iconFor(p.category)}"></i></div>`;

    document.getElementById('posItemName').textContent  = p.name;
    document.getElementById('posItemPrice').textContent = `₹${p.price.toLocaleString('en-IN')}${p.originalPrice&&p.originalPrice>p.price ? ` (was ₹${p.originalPrice.toLocaleString('en-IN')})` : ''}`;
    document.getElementById('posItemQtyDisplay').textContent = 1;

    const sizes = (p.sizes&&p.sizes.length) ? p.sizes : (POS_DEFAULT_SIZES[p.category]||['S','M','L','XL','XXL']);
    document.getElementById('posItemSizeBtns').innerHTML =
        sizes.map(s => `<button class="pos-chip" onclick="selectPosSize('${s}',this)">${s}</button>`).join('');

    if (p.colors && p.colors.length) {
        document.getElementById('posItemColorBtns').innerHTML =
            p.colors.map(c => `<button class="pos-chip" onclick="selectPosColor('${c}',this)">${c}</button>`).join('');
    } else {
        document.getElementById('posItemColorBtns').innerHTML =
            `<span style="color:#999;font-size:.8rem;">All colours available — note in cart</span>`;
    }

    document.getElementById('posItemModal').style.display = 'flex';
};

window.closePosItemModal = () => {
    document.getElementById('posItemModal').style.display = 'none';
    posCurProduct = null;
};

window.selectPosSize = (s, el) => {
    document.querySelectorAll('#posItemSizeBtns .pos-chip').forEach(b => b.classList.remove('active'));
    el.classList.add('active');
    posSelSize = s;
};

window.selectPosColor = (c, el) => {
    document.querySelectorAll('#posItemColorBtns .pos-chip').forEach(b => b.classList.remove('active'));
    el.classList.add('active');
    posSelColor = c;
};

window.changePosQty = delta => {
    posItemQty = Math.max(1, posItemQty + delta);
    document.getElementById('posItemQtyDisplay').textContent = posItemQty;
};

window.addToCart = () => {
    if (!posCurProduct) return;
    const existing = posCart.find(i =>
        i.id === posCurProduct.id && i.size === posSelSize && i.color === posSelColor
    );
    if (existing) {
        existing.qty += posItemQty;
    } else {
        posCart.push({
            id: posCurProduct.id, name: posCurProduct.name,
            price: posCurProduct.price, size: posSelSize,
            color: posSelColor, qty: posItemQty,
        });
    }
    closePosItemModal();
    renderPosCart();
    toast(`Added: ${posCurProduct.name}`, 'success');
};

/* — Cart — */
function renderPosCart() {
    const el = document.getElementById('posCartItems');
    if (!el) return;
    if (!posCart.length) {
        el.innerHTML = `<div class="pos-cart-empty"><i class="fas fa-hand-pointer"></i><p>Tap a product to add</p></div>`;
        updatePosTotals();
        return;
    }
    el.innerHTML = posCart.map((item, i) => `
    <div class="pos-cart-row">
        <div class="pos-cart-info">
            <div class="pos-cart-name">${item.name}</div>
            <div class="pos-cart-meta">${[item.size,item.color].filter(Boolean).join(' · ') || 'No size/colour'}</div>
        </div>
        <div class="pos-qty-inline">
            <button onclick="changePosCartQty(${i},-1)">−</button>
            <span>${item.qty}</span>
            <button onclick="changePosCartQty(${i},1)">+</button>
        </div>
        <div class="pos-cart-line-price">₹${(item.price*item.qty).toLocaleString('en-IN')}</div>
        <button class="pos-cart-del" onclick="removeFromPosCart(${i})"><i class="fas fa-times"></i></button>
    </div>`).join('');
    updatePosTotals();
}

window.changePosCartQty = (i, d) => { posCart[i].qty = Math.max(1, posCart[i].qty + d); renderPosCart(); };
window.removeFromPosCart = i => { posCart.splice(i, 1); renderPosCart(); };
window.clearPosCart = () => {
    posCart = [];
    posAppliedCoupon = null;
    posCouponDisc    = 0;
    if (document.getElementById('posCustomerName'))  document.getElementById('posCustomerName').value  = '';
    if (document.getElementById('posCustomerPhone')) document.getElementById('posCustomerPhone').value = '';
    if (document.getElementById('posCouponInput'))   document.getElementById('posCouponInput').value   = '';
    if (document.getElementById('posCashTendered'))  document.getElementById('posCashTendered').value  = '';
    document.getElementById('posDiscountRow').style.display = 'none';
    document.getElementById('posChange').innerHTML = '';
    renderPosCart();
};

function updatePosTotals() {
    const sub  = posCart.reduce((s, i) => s + i.price * i.qty, 0);
    const disc = posCouponDisc > 0 ? Math.round(sub * posCouponDisc / 100) : 0;
    const total = sub - disc;
    document.getElementById('posSubtotal').textContent  = `₹${sub.toLocaleString('en-IN')}`;
    document.getElementById('posGrandTotal').textContent = `₹${total.toLocaleString('en-IN')}`;
    const dr = document.getElementById('posDiscountRow');
    if (disc > 0) {
        document.getElementById('posDiscountLabel').textContent = `${posAppliedCoupon} (${posCouponDisc}% off)`;
        document.getElementById('posDiscountAmt').textContent   = `-₹${disc.toLocaleString('en-IN')}`;
        dr.style.display = 'flex';
    } else {
        dr.style.display = 'none';
    }
    calcPosChange();
}

/* — Coupon — */
window.applyPosCoupon = () => {
    const code = (document.getElementById('posCouponInput')?.value || '').trim().toUpperCase();
    if (!code) return;
    const c = allCoupons.find(x => x.code === code && x.active !== false);
    if (c) {
        posAppliedCoupon = c.code;
        posCouponDisc    = c.discount;
        updatePosTotals();
        toast(`Coupon applied: ${c.discount}% off!`, 'success');
    } else {
        toast('Invalid or expired coupon', 'error');
    }
};

/* — Payment — */
window.setPosPayMethod = el => {
    document.querySelectorAll('.pos-pay-btn').forEach(b => b.classList.remove('active'));
    el.classList.add('active');
    posPayMethod = el.dataset.method;
    const cashRow = document.getElementById('posCashRow');
    if (cashRow) cashRow.style.display = posPayMethod === 'Cash' ? 'block' : 'none';
    calcPosChange();
};

window.calcPosChange = () => {
    const el = document.getElementById('posChange');
    if (!el || posPayMethod !== 'Cash') { if(el) el.innerHTML=''; return; }
    const sub     = posCart.reduce((s, i) => s + i.price * i.qty, 0);
    const disc    = posCouponDisc > 0 ? Math.round(sub * posCouponDisc / 100) : 0;
    const total   = sub - disc;
    const tendered = Number(document.getElementById('posCashTendered')?.value) || 0;
    if (total === 0) { el.innerHTML = ''; return; }
    if (tendered >= total) {
        el.innerHTML = `<span class="pos-change-ok"><i class="fas fa-check-circle"></i> Change: ₹${(tendered-total).toLocaleString('en-IN')}</span>`;
    } else if (tendered > 0) {
        el.innerHTML = `<span class="pos-change-due"><i class="fas fa-exclamation-circle"></i> Still due: ₹${(total-tendered).toLocaleString('en-IN')}</span>`;
    } else {
        el.innerHTML = '';
    }
};

/* — Complete Sale — */
window.completeSale = async () => {
    if (!posCart.length) { toast('Cart is empty', 'error'); return; }
    const name  = document.getElementById('posCustomerName')?.value.trim()  || 'Walk-in';
    const phone = document.getElementById('posCustomerPhone')?.value.trim() || '';
    const sub   = posCart.reduce((s, i) => s + i.price * i.qty, 0);
    const disc  = posCouponDisc > 0 ? Math.round(sub * posCouponDisc / 100) : 0;
    const total = sub - disc;
    const orderId = `POS-${Date.now()}`;

    const sale = {
        orderId,
        name, phone,
        product:  posCart.map(i => i.name).join(', '),
        items:    posCart.map(i => ({ name:i.name, size:i.size||'', color:i.color||'', qty:i.qty, price:i.price })),
        qty:      posCart.reduce((s, i) => s + i.qty, 0),
        subtotal: sub, discount: disc, amount: total,
        coupon:   posAppliedCoupon || '',
        payment:  posPayMethod,
        status:   'Delivered',
        source:   'pos',
        updatedAt: serverTimestamp(),
    };

    const btn = document.querySelector('.pos-complete-btn');
    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Processing…';
    btn.disabled  = true;

    try {
        await addDoc(collection(db, 'orders'), { ...sale, createdAt: serverTimestamp() });
        posLastSale = { ...sale, createdAt: new Date() };
        showPosReceipt();
        toast('Sale completed!', 'success');
    } catch (err) {
        /* Offline — queue locally */
        const q = JSON.parse(localStorage.getItem('lfp_pos_queue') || '[]');
        q.push({ ...sale, createdAt: new Date().toISOString(), offline: true });
        localStorage.setItem('lfp_pos_queue', JSON.stringify(q));
        posLastSale = { ...sale, createdAt: new Date() };
        showPosReceipt();
        toast('Saved offline — will sync when connected', 'success');
    } finally {
        btn.innerHTML = '<i class="fas fa-check-circle"></i> Complete Sale';
        btn.disabled  = false;
    }
};

/* — Receipt — */
function showPosReceipt() {
    if (!posLastSale) return;
    const s = posLastSale;
    const date = (s.createdAt instanceof Date ? s.createdAt : new Date()).toLocaleString('en-IN');
    document.getElementById('receiptDate').textContent   = date;
    document.getElementById('receiptOrderId').textContent = s.orderId || '';

    document.getElementById('receiptItems').innerHTML = `
    <table class="receipt-table">
        <thead><tr><th>Item</th><th>Sz</th><th>Qty</th><th>Amt</th></tr></thead>
        <tbody>${s.items.map(i => `
        <tr>
            <td>${i.name}</td>
            <td>${i.size||'—'}</td>
            <td>${i.qty}</td>
            <td>₹${(i.price*i.qty).toLocaleString('en-IN')}</td>
        </tr>`).join('')}</tbody>
    </table>`;

    document.getElementById('receiptTotals').innerHTML = `
        ${s.discount > 0 ? `
        <div class="rt-row"><span>Subtotal</span><span>₹${s.subtotal.toLocaleString('en-IN')}</span></div>
        <div class="rt-row rt-disc"><span>Discount (${s.coupon})</span><span>−₹${s.discount.toLocaleString('en-IN')}</span></div>` : ''}
        <div class="rt-row rt-total"><span>Total</span><span>₹${s.amount.toLocaleString('en-IN')}</span></div>
        <div class="rt-row"><span>Payment</span><span>${s.payment}</span></div>
        <div class="rt-row"><span>Customer</span><span>${s.name}</span></div>`;

    document.getElementById('receiptModal').style.display = 'flex';
}

window.printReceipt = () => {
    const html = document.getElementById('receiptContent').innerHTML;
    const win  = window.open('', '_blank', 'width=400,height=600');
    win.document.write(`<!DOCTYPE html><html><head><title>Receipt</title>
    <style>
      body{font-family:monospace;max-width:320px;margin:auto;padding:16px;font-size:13px}
      h2{text-align:center;font-size:1.1rem}p{text-align:center;margin:2px 0}
      table{width:100%;border-collapse:collapse;margin:10px 0}
      th,td{padding:3px 2px;font-size:.8rem}th{border-bottom:1px solid #000}
      .receipt-totals{margin-top:8px;border-top:1px dashed #000;padding-top:8px}
      .rt-row{display:flex;justify-content:space-between;padding:2px 0}
      .rt-total{font-weight:bold;border-top:1px solid #000;padding-top:5px;margin-top:4px}
      .rt-disc{color:green}.receipt-footer{text-align:center;margin-top:12px;border-top:1px dashed #000;padding-top:8px;font-size:.75rem;color:#555}
      .receipt-header{border-bottom:1px dashed #000;padding-bottom:8px;margin-bottom:8px}
    </style></head><body>${html}</body></html>`);
    win.document.close();
    setTimeout(() => win.print(), 300);
};

window.whatsappReceipt = () => {
    if (!posLastSale) return;
    const s    = posLastSale;
    const lines = s.items.map(i => `• ${i.name} (${i.size||'OS'}) ×${i.qty} = ₹${(i.price*i.qty).toLocaleString('en-IN')}`).join('\n');
    const disc  = s.discount > 0 ? `\nDiscount (${s.coupon}): −₹${s.discount.toLocaleString('en-IN')}` : '';
    const msg   = `*LaFashionPoint — Receipt*\n${new Date().toLocaleString('en-IN')}\n\n${lines}${disc}\n\n*Total: ₹${s.amount.toLocaleString('en-IN')}*\nPayment: ${s.payment}\n\nThank you, ${s.name}! 🙏`;
    const num   = s.phone ? `91${s.phone.replace(/\D/g,'')}` : '919079661164';
    window.open(`https://wa.me/${num}?text=${encodeURIComponent(msg)}`, '_blank', 'noopener');
};

window.startNewSale = () => {
    document.getElementById('receiptModal').style.display = 'none';
    clearPosCart();
    posLastSale = null;
    syncOfflineSales();
};

/* — Offline sync — */
async function syncOfflineSales() {
    const queue = JSON.parse(localStorage.getItem('lfp_pos_queue') || '[]');
    if (!queue.length) return;
    const synced = [];
    for (const sale of queue) {
        try {
            const { offline, createdAt, ...data } = sale;
            await addDoc(collection(db, 'orders'), { ...data, createdAt: serverTimestamp(), synced: true });
            synced.push(sale);
        } catch (_) {}
    }
    if (synced.length) {
        const remaining = queue.filter(s => !synced.includes(s));
        localStorage.setItem('lfp_pos_queue', JSON.stringify(remaining));
        toast(`${synced.length} offline sale(s) synced to Firebase!`, 'success');
    }
}

function watchOnlineStatus() {
    const badge = document.getElementById('offlineBadge');
    const update = () => { if (badge) badge.style.display = navigator.onLine ? 'none' : 'block'; };
    window.addEventListener('online',  () => { update(); syncOfflineSales(); });
    window.addEventListener('offline', update);
    update();
}
