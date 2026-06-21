import { auth, db, storage } from './firebase-config.js';

import {
    signInWithEmailAndPassword, signOut, onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";

import {
    collection, doc, addDoc, updateDoc, deleteDoc,
    onSnapshot, query, orderBy, where, serverTimestamp, getDocs
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
            chip.addEventListener('click', () => {
                chip.classList.toggle('active');
                scheduleInvRefresh();
            });
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
const SECTIONS = ['dashboard','products','form','inquiries','categories','categoryForm','inventory','pos','orders','orderForm','coupons','couponForm','settings','customers','returns','returnForm','reviews'];
const TITLES   = {
    dashboard:'Dashboard', products:'Products', form:'',
    inquiries:'Inquiries', categories:'Categories', categoryForm:'',
    inventory:'Inventory', pos:'Point of Sale',
    orders:'Orders', orderForm:'', coupons:'Coupons', couponForm:'', settings:'Settings',
    customers:'Customers', returns:'Returns', returnForm:'', reviews:'Reviews'
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
    listenCategories();
    listenProducts();
    listenInquiries();
    listenOrders();
    listenCoupons();
    listenReturns();
    listenReviews();
    loadStaffRoles();
    syncOfflineSales();
    watchOnlineStatus();
    loadUpiSettings();
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

    const outCount = buildVariantList().filter(v => v.stock === 0).length;
    const badge    = document.getElementById('outOfStockCount');
    if (badge) { badge.textContent = outCount; badge.style.display = outCount ? 'inline-block' : 'none'; }
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
        renderInventory();
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
    setTimeout(buildInventoryInputs, 50);
    document.getElementById('pAvailable').checked   = p.available      !== false;

    /* Sizes */
    document.querySelectorAll('.size-chip').forEach(chip => {
        chip.classList.toggle('active', (p.sizes || []).includes(chip.dataset.size));
    });

    // Barcode
    const barcodeEl = document.getElementById('pBarcode');
    if (barcodeEl) barcodeEl.value = p.barcode || '';
    // Multi-images
    pendingImages = [null, null, null, null, null];
    const imgs = p.images || (p.imageUrl ? [p.imageUrl] : []);
    imgs.forEach((url, i) => { if (i < 5) { pendingImages[i] = url; updateSlotPreview(i, url); } });

    showSection('form');
};

function resetForm() {
    document.getElementById('productForm').reset();
    document.getElementById('editId').value = '';
    document.getElementById('uploadProgress').style.display = 'none';
    document.getElementById('pFabric').value = '';
    document.getElementById('pColors').value = '';
    document.getElementById('inventoryGrid').innerHTML = '';
    document.querySelectorAll('.size-chip').forEach(c => c.classList.remove('active'));
    const barcodeEl = document.getElementById('pBarcode');
    if (barcodeEl) barcodeEl.value = '';
    // Reset multi-images
    pendingImages = [null, null, null, null, null];
    activeSlot = 0;
    for (let i = 0; i < 5; i++) {
        const slot = document.getElementById(`imgSlot${i}`);
        if (slot) {
            slot.innerHTML = i === 0
                ? `<div class="img-slot-placeholder"><i class="fas fa-camera"></i><small>Main Photo</small></div>`
                : `<div class="img-slot-placeholder"><i class="fas fa-plus"></i></div>`;
            slot.style.backgroundImage = '';
        }
    }
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
    const barcode  = document.getElementById('pBarcode')?.value.trim() || null;

    try {
        // Upload all pending images
        const uploadedUrls = pendingImages.map(img => (img && typeof img === 'string') ? img : null);
        const uploadPromises = pendingImages.map(async (img, idx) => {
            if (img && img instanceof File) {
                uploadedUrls[idx] = await uploadImage(img, `${id || Date.now()}_${idx}`);
            }
        });
        await Promise.all(uploadPromises);
        const finalImages = uploadedUrls.filter(Boolean);
        const imageUrl = finalImages[0] || '';

        /* Collect inventory */
        const inventoryMap = {};
        document.querySelectorAll('#inventoryGrid .inv-input').forEach(inp => {
            if (inp.value !== '') inventoryMap[inp.dataset.key] = Number(inp.value);
        });

        const data = {
            name, category, badge, price, description: desc,
            fabric:        fabric || null,
            colors:        colors && colors.length ? colors : null,
            sizes:         sizes.length ? sizes : null,
            inventory:     Object.keys(inventoryMap).length ? inventoryMap : null,
            order, available: avail,
            imageUrl:      imageUrl || '',
            images:        finalImages.length ? finalImages : null,
            barcode:       barcode || null,
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
        buildCharts();
        buildCustomerDatabase();
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
                    <button class="btn-invoice" onclick='generateGSTInvoice(${JSON.stringify(o).replace(/'/g,"&#39;")})'><i class="fas fa-file-invoice"></i></button>
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
    window._filteredOrders = status ? allOrders.filter(o => o.status === status) : null;
    renderOrders(window._filteredOrders || allOrders);
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
   INVENTORY MANAGEMENT
   ============================================================ */

/* Helper: inventory key for a size + colour combination */
function invKey(size, color) {
    return color ? `${size}_${color}` : size;
}

/* Flatten all product variants into a list for overview / dashboard */
function buildVariantList() {
    const rows = [];
    allProducts.forEach(p => {
        const inv    = p.inventory || {};
        const sizes  = p.sizes  || [];
        const colors = p.colors || [];

        if (sizes.length && colors.length) {
            sizes.forEach(s => colors.forEach(c => {
                const k = invKey(s, c);
                if (k in inv) rows.push({ p, size: s, color: c, key: k, stock: inv[k] });
            }));
        } else if (sizes.length) {
            sizes.forEach(s => {
                if (s in inv) rows.push({ p, size: s, color: '', key: s, stock: inv[s] });
            });
        } else {
            Object.entries(inv).forEach(([k, stock]) => {
                const [s, ...rest] = k.split('_');
                rows.push({ p, size: s, color: rest.join('_'), key: k, stock });
            });
        }
        return rows;
    });
    return rows;
}

/* Stock availability helpers used by POS and modal */
function sizeHasStock(p, size) {
    const inv = p.inventory;
    if (!inv) return true;
    if (p.colors && p.colors.length) {
        return p.colors.some(c => { const s = inv[invKey(size, c)]; return s === undefined || s > 0; });
    }
    const s = inv[size];
    return s === undefined || s > 0;
}

function colorHasStock(p, size, color) {
    const inv = p.inventory;
    if (!inv) return true;
    const s = inv[invKey(size, color)];
    return s === undefined || s > 0;
}

window.getStock = function(p, size, color) {
    if (!p.inventory) return null;
    const k = invKey(size, color);
    return p.inventory[k] ?? null;
};

/* Build inventory input grid in product form */
let invRefreshTimer = null;
window.scheduleInvRefresh = () => {
    clearTimeout(invRefreshTimer);
    invRefreshTimer = setTimeout(buildInventoryInputs, 600);
};

window.buildInventoryInputs = function() {
    const grid   = document.getElementById('inventoryGrid');
    if (!grid) return;

    const sizes  = Array.from(document.querySelectorAll('.size-chip.active')).map(c => c.dataset.size);
    const colRaw = document.getElementById('pColors').value;
    const colors = colRaw ? colRaw.split(',').map(c => c.trim()).filter(Boolean) : [];

    /* Current inventory from the product being edited */
    const pid    = document.getElementById('editId').value;
    const curInv = (pid ? allProducts.find(x => x.id === pid)?.inventory : null) || {};

    if (!sizes.length) {
        grid.innerHTML = '<p style="color:#9ca3af;font-size:.8rem;">Select sizes above, then click Refresh Grid.</p>';
        return;
    }

    if (colors.length) {
        /* Grid: rows = sizes, columns = colors */
        let html = `<div class="inv-grid-table">
            <div class="inv-grid-header">
                <span class="inv-size-label"></span>
                ${colors.map(c => `<span class="inv-col-head">${c}</span>`).join('')}
            </div>`;
        sizes.forEach(s => {
            html += `<div class="inv-grid-row">
                <span class="inv-size-label">${s}</span>
                ${colors.map(c => {
                    const k = invKey(s, c);
                    const v = curInv[k] ?? '';
                    return `<input type="number" class="inv-input" data-key="${k}"
                        value="${v}" min="0" step="1" placeholder="—"
                        title="${s} / ${c}">`;
                }).join('')}
            </div>`;
        });
        html += '</div>';
        grid.innerHTML = html;
    } else {
        /* Simple list: size → stock */
        let html = '<div class="inv-simple-list">';
        sizes.forEach(s => {
            const v = curInv[s] ?? '';
            html += `<div class="inv-simple-row">
                <span class="inv-size-label">${s}</span>
                <input type="number" class="inv-input" data-key="${s}"
                    value="${v}" min="0" step="1" placeholder="—">
            </div>`;
        });
        html += '</div>';
        grid.innerHTML = html;
    }
};

/* Inventory Overview Page */
function renderInventory() {
    const container = document.getElementById('inventoryTable');
    const cards     = document.getElementById('invStatCards');
    if (!container) return;

    const all  = buildVariantList();
    const out  = all.filter(v => v.stock === 0).length;
    const low  = all.filter(v => v.stock > 0 && v.stock <= 5).length;
    const ok   = all.filter(v => v.stock > 5).length;

    if (cards) {
        cards.innerHTML = `
        <div class="inv-stat ok"><i class="fas fa-check-circle"></i><span>${ok}</span><small>In Stock</small></div>
        <div class="inv-stat low"><i class="fas fa-exclamation-triangle"></i><span>${low}</span><small>Low Stock</small></div>
        <div class="inv-stat out"><i class="fas fa-times-circle"></i><span>${out}</span><small>Out of Stock</small></div>
        <div class="inv-stat total"><i class="fas fa-layer-group"></i><span>${all.length}</span><small>Total Variants</small></div>`;
    }

    if (!all.length) {
        container.innerHTML = `
        <div class="empty-state">
            <i class="fas fa-warehouse"></i>
            <p>No inventory tracked yet.</p>
            <p style="font-size:.82rem;color:#9ca3af;">Edit a product → select sizes → set stock numbers.</p>
        </div>`;
        return;
    }

    window._allVariants = all;
    renderInventoryTable(all);
    checkLowStock();
}

function renderInventoryTable(rows) {
    const container = document.getElementById('inventoryTable');
    if (!container) return;
    if (!rows.length) {
        container.innerHTML = `<div class="empty-state"><i class="fas fa-search"></i><p>No variants match.</p></div>`;
        return;
    }
    const tableRows = rows.map(v => {
        const statusClass = v.stock === 0 ? 'inv-out' : v.stock <= 5 ? 'inv-low' : 'inv-ok';
        const statusText  = v.stock === 0 ? 'Out of Stock' : v.stock <= 5 ? `Low (${v.stock})` : `In Stock (${v.stock})`;
        return `
        <tr>
            <td>
                ${v.p.imageUrl ? `<img src="${v.p.imageUrl}" class="prod-thumb" alt="">` : `<div class="prod-thumb-placeholder"><i class="fas fa-${iconFor(v.p.category)}"></i></div>`}
            </td>
            <td><div class="prod-name">${v.p.name}</div><div class="prod-cat">${v.p.category}</div></td>
            <td><span class="inv-chip">${v.size}</span></td>
            <td>${v.color ? `<span class="inv-chip colour">${v.color}</span>` : '<span style="color:#9ca3af">—</span>'}</td>
            <td>
                <input type="number" class="inv-stock-input" value="${v.stock}" min="0" step="1"
                    onchange="updateVariantStock('${v.p.id}','${v.key}',this.value)"
                    title="Click to edit stock">
            </td>
            <td><span class="inv-status ${statusClass}">${statusText}</span></td>
            <td><button class="btn-edit" onclick="editProduct('${v.p.id}')"><i class="fas fa-pen"></i></button></td>
        </tr>`;
    }).join('');

    container.innerHTML = `
    <table class="products-table">
        <thead>
            <tr><th>Photo</th><th>Product</th><th>Size</th><th>Colour</th><th>Stock</th><th>Status</th><th></th></tr>
        </thead>
        <tbody>${tableRows}</tbody>
    </table>`;
}

window.filterInventory = () => {
    const status = document.getElementById('filterInvStatus')?.value || '';
    const search = (document.getElementById('invSearch')?.value || '').toLowerCase();
    let rows = window._allVariants || [];
    if (search) rows = rows.filter(v => v.p.name.toLowerCase().includes(search));
    if (status === 'out') rows = rows.filter(v => v.stock === 0);
    if (status === 'low') rows = rows.filter(v => v.stock > 0 && v.stock <= 5);
    if (status === 'ok')  rows = rows.filter(v => v.stock > 5);
    renderInventoryTable(rows);
};

/* Inline stock update from inventory table */
window.updateVariantStock = async (productId, key, value) => {
    const stock = Number(value);
    try {
        await updateDoc(doc(db, 'products', productId), { [`inventory.${key}`]: stock });
        toast('Stock updated', 'success');
    } catch (err) {
        console.error(err);
        toast('Error updating stock', 'error');
    }
};

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
        sizes.map(s => {
            const inStock = sizeHasStock(p, s);
            const stockVal = p.inventory ? (p.colors?.length ? null : p.inventory[s]) : null;
            const label = stockVal !== null && stockVal !== undefined
                ? (stockVal === 0 ? `${s} <small>Out</small>` : `${s} <small>(${stockVal})</small>`)
                : s;
            return `<button class="pos-chip ${inStock ? '' : 'oos'}" ${inStock ? `onclick="selectPosSize('${s}',this)"` : 'disabled'}>${label}</button>`;
        }).join('');

    renderPosColorChips(p, '');

    document.getElementById('posItemModal').style.display = 'flex';
};

window.closePosItemModal = () => {
    document.getElementById('posItemModal').style.display = 'none';
    posCurProduct = null;
};

function renderPosColorChips(p, selectedSize) {
    if (p.colors && p.colors.length) {
        document.getElementById('posItemColorBtns').innerHTML =
            p.colors.map(c => {
                const inStock = selectedSize ? colorHasStock(p, selectedSize, c) : true;
                const stockVal = selectedSize && p.inventory ? p.inventory[invKey(selectedSize, c)] : null;
                const label = stockVal !== null && stockVal !== undefined
                    ? (stockVal === 0 ? `${c} <small>Out</small>` : `${c} <small>(${stockVal})</small>`)
                    : c;
                return `<button class="pos-chip ${inStock ? '' : 'oos'}" ${inStock ? `onclick="selectPosColor('${c}',this)"` : 'disabled'}>${label}</button>`;
            }).join('');
    } else {
        document.getElementById('posItemColorBtns').innerHTML =
            `<span style="color:#999;font-size:.8rem;">All colours available — note in cart</span>`;
    }
}

window.selectPosSize = (s, el) => {
    document.querySelectorAll('#posItemSizeBtns .pos-chip').forEach(b => b.classList.remove('active'));
    el.classList.add('active');
    posSelSize = s;
    if (posCurProduct) renderPosColorChips(posCurProduct, s);
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
    posLoyaltyRedemption = 0;
    if (document.getElementById('posCustomerName'))  document.getElementById('posCustomerName').value  = '';
    if (document.getElementById('posCustomerPhone')) document.getElementById('posCustomerPhone').value = '';
    if (document.getElementById('posCouponInput'))   document.getElementById('posCouponInput').value   = '';
    if (document.getElementById('posCashTendered'))  document.getElementById('posCashTendered').value  = '';
    document.getElementById('posDiscountRow').style.display = 'none';
    document.getElementById('posChange').innerHTML = '';
    const loyaltyInfo = document.getElementById('posLoyaltyInfo');
    if (loyaltyInfo) loyaltyInfo.style.display = 'none';
    const redeemBtn = document.getElementById('posRedeemBtn');
    if (redeemBtn) redeemBtn.disabled = false;
    const upiQr = document.getElementById('posUpiQr');
    if (upiQr) upiQr.style.display = 'none';
    const pointsEarn = document.getElementById('posPointsEarn');
    if (pointsEarn) pointsEarn.style.display = 'none';
    renderPosCart();
};

function updatePosTotals() {
    updatePosTotalsWithLoyalty();
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
    const loyalty = typeof posLoyaltyRedemption !== 'undefined' ? posLoyaltyRedemption : 0;
    const total   = Math.max(0, sub - disc - loyalty);
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
    const total = Math.max(0, sub - disc - posLoyaltyRedemption);
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
        await decrementInventory(posCart);
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
        posLoyaltyRedemption = 0;
        const redeemBtn = document.getElementById('posRedeemBtn');
        if (redeemBtn) redeemBtn.disabled = false;
    }
};

/* — Inventory decrement — */
async function decrementInventory(cart) {
    /* Group updates by product ID */
    const byProduct = {};
    cart.forEach(item => {
        const p  = allProducts.find(x => x.id === item.id);
        if (!p || !p.inventory) return;
        const k  = invKey(item.size || '', item.color || '');
        const cur = p.inventory[k];
        if (cur === undefined) return;
        if (!byProduct[item.id]) byProduct[item.id] = {};
        byProduct[item.id][`inventory.${k}`] = Math.max(0, cur - item.qty);
    });
    await Promise.all(
        Object.entries(byProduct).map(([id, upd]) => updateDoc(doc(db, 'products', id), upd))
    );
}

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

/* ============================================================
   POS — LOAD ONLINE ORDER (website reservation → POS cart)
   ============================================================ */
let loadedReservationRef = null;

window.toggleOrderLoader = () => {
    const body    = document.getElementById('polBody');
    const chevron = document.getElementById('polChevron');
    if (!body) return;
    const opening = body.style.display === 'none';
    body.style.display = opening ? 'block' : 'none';
    if (chevron) chevron.style.transform = opening ? 'rotate(180deg)' : '';
};

window.loadOnlineOrder = async () => {
    const code = (document.getElementById('orderCodeInput')?.value || '').trim().toUpperCase();
    if (!code) { toast('Enter an order code', 'error'); return; }

    const btn = document.querySelector('#polBody button');
    if (btn) { btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i>'; btn.disabled = true; }

    try {
        const snap = await getDocs(
            query(collection(db, 'reservations'), where('code', '==', code), where('status', '==', 'pending'))
        );

        if (snap.empty) {
            toast(`Code "${code}" not found or already used`, 'error');
            return;
        }

        const resDoc = snap.docs[0];
        const data   = resDoc.data();

        /* Check 24-hour expiry */
        if (data.expiresAt && new Date(data.expiresAt) < new Date()) {
            toast('This reservation expired (24 hours limit)', 'error');
            return;
        }

        /* Clear current cart and load reservation items */
        clearPosCart();
        loadedReservationRef = resDoc.ref;

        for (const item of (data.items || [])) {
            posCart.push({
                id:    item.productId || '',
                name:  item.name      || 'Product',
                price: item.price     || 0,
                size:  item.size      || '',
                color: item.color     || '',
                qty:   item.qty       || 1,
            });
        }

        /* Prefill customer details */
        const nameEl  = document.getElementById('posCustomerName');
        const phoneEl = document.getElementById('posCustomerPhone');
        if (nameEl)  nameEl.value  = data.customerName  || '';
        if (phoneEl) phoneEl.value = data.customerPhone || '';

        /* Mark reservation as loaded so it can't be double-loaded */
        await updateDoc(resDoc.ref, { status: 'loaded', loadedAt: serverTimestamp() });

        renderPosCart();

        /* Close the loader panel */
        document.getElementById('polBody').style.display = 'none';
        document.getElementById('polChevron').style.transform = '';
        if (document.getElementById('orderCodeInput')) document.getElementById('orderCodeInput').value = '';

        toast(`Order ${code} loaded — ${data.items.length} item(s) for ${data.customerName}`, 'success');

    } catch (err) {
        console.error(err);
        toast('Error loading order — check connection', 'error');
    } finally {
        if (btn) { btn.innerHTML = '<i class="fas fa-arrow-right"></i> Load'; btn.disabled = false; }
    }
};

/* When a sale completes, mark the reservation as completed too */
const _originalCompleteSale = window.completeSale;
window.completeSale = async function() {
    await _originalCompleteSale();
    if (loadedReservationRef) {
        try { await updateDoc(loadedReservationRef, { status: 'completed', completedAt: serverTimestamp() }); }
        catch (_) {}
        loadedReservationRef = null;
    }
};

/* ============================================================
   CATEGORIES — dynamic category management
   ============================================================ */
let allCategories    = [];
let selectedCatColor = '#c8d8ec';

const DEFAULT_CATEGORIES = [
    { name:'T-Shirt', displayName:'T-Shirts', description:'Everyday Comfort',  color:'#c8d8ec', order:1, active:true },
    { name:'Shirt',   displayName:'Shirts',   description:'Sharp & Stylish',   color:'#e0e0e0', order:2, active:true },
    { name:'Hoodie',  displayName:'Hoodies',  description:'Warm & Premium',    color:'#c8d4d0', order:3, active:true },
    { name:'Jeans',   displayName:'Jeans',    description:'Premium Denim',     color:'#c8d8ec', order:4, active:true },
];

function listenCategories() {
    const q = query(collection(db, 'categories'), orderBy('order', 'asc'));
    onSnapshot(q, snap => {
        allCategories = snap.empty
            ? DEFAULT_CATEGORIES
            : snap.docs.map(d => ({ id: d.id, ...d.data() }));
        renderCategoriesTable(allCategories);
        populateCategorySelects();
    }, () => {
        allCategories = DEFAULT_CATEGORIES;
        populateCategorySelects();
    });
}

/* Populate every place that lists categories */
function populateCategorySelects() {
    const active = allCategories.filter(c => c.active !== false);

    /* Product form select */
    const pCat = document.getElementById('pCategory');
    if (pCat) {
        const cur = pCat.value;
        pCat.innerHTML = '<option value="">Select…</option>' +
            active.map(c => `<option value="${c.name}"${c.name===cur?' selected':''}>${c.displayName||c.name}</option>`).join('');
    }

    /* Order form product select (re-populates in openOrderForm) */

    /* POS category tabs */
    const tabs = document.getElementById('posCatTabs');
    if (tabs) {
        const cur = tabs.querySelector('.pos-cat.active')?.dataset?.cat || '';
        tabs.innerHTML = `<button class="pos-cat${cur===''?' active':''}" onclick="setPosCategory(this,'')">All</button>` +
            active.map(c => `<button class="pos-cat${cur===c.name?' active':''}" data-cat="${c.name}" onclick="setPosCategory(this,'${c.name}')">${c.displayName||c.name}</button>`).join('');
    }
}

function renderCategoriesTable(cats) {
    const container = document.getElementById('categoriesList');
    if (!container) return;

    if (!cats.length) {
        container.innerHTML = `
        <div class="empty-state">
            <i class="fas fa-tags"></i>
            <p>No categories yet. Add your first category!</p>
            <button class="btn-add" onclick="openCategoryForm()"><i class="fas fa-plus"></i> Add Category</button>
        </div>`;
        return;
    }

    const rows = cats.map(c => `
    <tr>
        <td>
            <div class="cat-color-swatch" style="background:${catGradient(c.color||'#c8d8ec')};width:36px;height:36px;border-radius:6px;border:1px solid rgba(0,0,0,.08);"></div>
        </td>
        <td><div class="prod-name">${c.name}</div></td>
        <td>${c.displayName||c.name}</td>
        <td style="color:#6b7280;font-size:.82rem;">${c.description||'—'}</td>
        <td style="font-size:.78rem;color:#6b7280;">${c.icon||'—'}</td>
        <td>${c.order||99}</td>
        <td><span class="status-dot ${c.active!==false?'on':'off'}">${c.active!==false?'Active':'Hidden'}</span></td>
        <td>
            <div class="row-actions">
                ${c.id ? `<button class="btn-edit" onclick="editCategory('${c.id}')"><i class="fas fa-pen"></i> Edit</button>
                <button class="btn-del" onclick="confirmDeleteCat('${c.id}','${c.name}')"><i class="fas fa-trash"></i></button>` : '<span style="color:#9ca3af;font-size:.75rem;">Default</span>'}
            </div>
        </td>
    </tr>`).join('');

    container.innerHTML = `
    <table class="products-table">
        <thead>
            <tr><th>Color</th><th>Name</th><th>Label</th><th>Description</th><th>Icon</th><th>Order</th><th>Status</th><th>Actions</th></tr>
        </thead>
        <tbody>${rows}</tbody>
    </table>`;
}

function catGradient(hex) {
    const r = parseInt(hex.slice(1,3),16), g = parseInt(hex.slice(3,5),16), b = parseInt(hex.slice(5,7),16);
    const d = (v) => Math.max(0,v-30).toString(16).padStart(2,'0');
    return `linear-gradient(135deg,${hex},#${d(r)}${d(g)}${d(b)})`;
}

window.filterCategoriesTable = () => {
    const s = (document.getElementById('searchCategories')?.value||'').toLowerCase();
    renderCategoriesTable(s ? allCategories.filter(c =>
        c.name.toLowerCase().includes(s) || (c.displayName||'').toLowerCase().includes(s)
    ) : allCategories);
};

window.openCategoryForm = () => {
    resetCategoryForm();
    document.getElementById('categoryFormTitle').textContent = 'Add Category';
    document.getElementById('pageTitle').textContent         = 'Add Category';
    showSection('categoryForm');
};

window.editCategory = id => {
    const c = allCategories.find(x => x.id === id);
    if (!c) return;
    resetCategoryForm();
    document.getElementById('categoryFormTitle').textContent = 'Edit Category';
    document.getElementById('pageTitle').textContent         = 'Edit Category';

    document.getElementById('editCategoryId').value = id;
    document.getElementById('catName').value        = c.name        || '';
    document.getElementById('catLabel').value       = c.displayName || '';
    document.getElementById('catDesc').value        = c.description || '';
    document.getElementById('catIcon').value        = c.icon        || '';
    document.getElementById('catColor').value       = c.color       || '';
    document.getElementById('catOrder').value       = c.order       || 99;
    document.getElementById('catActive').checked   = c.active !== false;
    selectedCatColor = c.color || '#c8d8ec';

    showSection('categoryForm');
};

function resetCategoryForm() {
    document.getElementById('categoryForm').reset();
    document.getElementById('editCategoryId').value = '';
    document.getElementById('catActive').checked    = true;
    document.getElementById('catOrder').value       = 99;
    selectedCatColor = '#c8d8ec';
    document.querySelectorAll('.color-preset').forEach(b => b.classList.remove('active'));
}

window.selectCatColor = (color, el) => {
    selectedCatColor = color;
    document.getElementById('catColor').value = color;
    document.querySelectorAll('.color-preset').forEach(b => b.classList.remove('active'));
    el.classList.add('active');
};

window.saveCategory = async e => {
    e.preventDefault();
    const btn = document.getElementById('saveCategoryBtn');
    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Saving…';
    btn.disabled  = true;

    const id    = document.getElementById('editCategoryId').value;
    const color = document.getElementById('catColor').value.trim() || selectedCatColor || '#c8d8ec';
    const name  = document.getElementById('catName').value.trim();
    const data  = {
        name,
        displayName: document.getElementById('catLabel').value.trim() || name,
        description: document.getElementById('catDesc').value.trim(),
        icon:        document.getElementById('catIcon').value.trim(),
        color,
        order:       Number(document.getElementById('catOrder').value) || 99,
        active:      document.getElementById('catActive').checked,
        updatedAt:   serverTimestamp(),
    };

    try {
        if (id) {
            await updateDoc(doc(db, 'categories', id), data);
            toast('Category updated!', 'success');
        } else {
            data.createdAt = serverTimestamp();
            await addDoc(collection(db, 'categories'), data);
            toast(`Category "${name}" added!`, 'success');
        }
        showSection('categories');
    } catch (err) {
        console.error(err);
        toast('Error saving category', 'error');
    } finally {
        btn.innerHTML = '<i class="fas fa-save"></i> Save Category';
        btn.disabled  = false;
    }
};

let pendingDeleteCatId = null;
window.confirmDeleteCat = (id, name) => {
    pendingDeleteCatId = id;
    const modal = document.getElementById('deleteModal');
    modal.querySelector('h3').textContent = 'Delete Category?';
    modal.querySelector('p').textContent  = `"${name}" will be removed from filters. Existing products keep their category value.`;
    document.getElementById('confirmDeleteBtn').onclick = doDeleteCategory;
    modal.style.display = 'flex';
};

async function doDeleteCategory() {
    if (!pendingDeleteCatId) return;
    const btn = document.getElementById('confirmDeleteBtn');
    btn.textContent = 'Deleting…';
    btn.disabled    = true;
    try {
        await deleteDoc(doc(db, 'categories', pendingDeleteCatId));
        toast('Category deleted', 'success');
    } catch (err) {
        toast('Error deleting category', 'error');
    } finally {
        closeDeleteModal();
        btn.textContent = 'Delete';
        btn.disabled    = false;
    }
}

/* ============================================================
   FEATURE 1: SALES CHARTS
   ============================================================ */
let revenueChartInst = null;
let paymentChartInst = null;
let topProductsChartInst = null;

function buildCharts() {
    try {
        if (typeof Chart === 'undefined') return;

        // Revenue last 30 days
        const now = new Date();
        const labels = [];
        const revenueData = [];
        for (let i = 29; i >= 0; i--) {
            const d = new Date(now);
            d.setDate(d.getDate() - i);
            const key = d.toLocaleDateString('en-IN', { day:'2-digit', month:'short' });
            labels.push(key);
            const dayStart = new Date(d.getFullYear(), d.getMonth(), d.getDate());
            const dayEnd   = new Date(dayStart); dayEnd.setDate(dayEnd.getDate() + 1);
            const total = allOrders
                .filter(o => {
                    const t = o.createdAt?.toDate ? o.createdAt.toDate() : (o.createdAt ? new Date(o.createdAt) : null);
                    return t && t >= dayStart && t < dayEnd;
                })
                .reduce((s, o) => s + (Number(o.amount) || 0), 0);
            revenueData.push(total);
        }

        const rCanvas = document.getElementById('revenueChart');
        if (rCanvas) {
            if (revenueChartInst) revenueChartInst.destroy();
            revenueChartInst = new Chart(rCanvas, {
                type: 'line',
                data: {
                    labels,
                    datasets: [{ label: 'Revenue (₹)', data: revenueData, borderColor: '#C9A84C', backgroundColor: 'rgba(201,168,76,.1)', fill: true, tension: 0.3 }]
                },
                options: { responsive: true, plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true } } }
            });
        }

        // Payment methods
        const payMap = { Cash: 0, UPI: 0, Card: 0 };
        allOrders.forEach(o => { const m = o.payment || o.paymentMethod || 'Cash'; if (payMap[m] !== undefined) payMap[m]++; else payMap['Cash']++; });
        const pCanvas = document.getElementById('paymentChart');
        if (pCanvas) {
            if (paymentChartInst) paymentChartInst.destroy();
            paymentChartInst = new Chart(pCanvas, {
                type: 'doughnut',
                data: {
                    labels: Object.keys(payMap),
                    datasets: [{ data: Object.values(payMap), backgroundColor: ['#C9A84C','#3b82f6','#22c55e'] }]
                },
                options: { responsive: true, plugins: { legend: { position: 'bottom' } } }
            });
        }

        // Top 5 products
        const productCount = {};
        allOrders.forEach(o => {
            const name = o.product || '';
            if (!name) return;
            const parts = name.split(', ');
            parts.forEach(p => { productCount[p] = (productCount[p] || 0) + 1; });
        });
        const sorted = Object.entries(productCount).sort((a,b) => b[1]-a[1]).slice(0, 5);
        const tCanvas = document.getElementById('topProductsChart');
        if (tCanvas) {
            if (topProductsChartInst) topProductsChartInst.destroy();
            topProductsChartInst = new Chart(tCanvas, {
                type: 'bar',
                data: {
                    labels: sorted.map(e => e[0]),
                    datasets: [{ label: 'Orders', data: sorted.map(e => e[1]), backgroundColor: '#C9A84C' }]
                },
                options: { indexAxis: 'y', responsive: true, plugins: { legend: { display: false } }, scales: { x: { beginAtZero: true } } }
            });
        }
    } catch(err) { console.error('Chart error:', err); }
}

/* ============================================================
   FEATURE 2: EXPORT ORDERS CSV
   ============================================================ */
window.exportOrdersCSV = () => {
    const orders = window._filteredOrders || allOrders;
    const headers = ['Date','Order ID','Customer','Phone','Product','Size','Colour','Qty','Amount','Payment','Status','Coupon','Notes','Source'];
    const rows = orders.map(o => {
        const date = o.createdAt?.toDate ? o.createdAt.toDate().toLocaleDateString('en-IN') : '';
        return [
            date, o.orderId || o.id, o.name || '', o.phone || '',
            o.product || '', o.size || '', o.color || '',
            o.qty || 1, o.amount || 0, o.payment || o.paymentMethod || '',
            o.status || '', o.coupon || '', (o.notes || '').replace(/\n/g,' '), o.source || ''
        ].map(v => `"${String(v).replace(/"/g,'""')}"`).join(',');
    });
    const csv = [headers.join(','), ...rows].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href = url;
    a.download = `orders_${new Date().toISOString().slice(0,10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast('CSV exported!', 'success');
};

/* ============================================================
   FEATURE 3: CUSTOMER DATABASE
   ============================================================ */
let allCustomers = [];

function buildCustomerDatabase() {
    const map = {};
    allOrders.forEach(o => {
        const phone = (o.phone || '').replace(/\D/g,'');
        if (!phone) return;
        if (!map[phone]) {
            map[phone] = { name: o.name || 'Unknown', phone, totalOrders: 0, totalSpent: 0, lastOrderDate: null };
        }
        map[phone].totalOrders++;
        map[phone].totalSpent += Number(o.amount) || 0;
        const d = o.createdAt?.toDate ? o.createdAt.toDate() : (o.createdAt ? new Date(o.createdAt) : null);
        if (d && (!map[phone].lastOrderDate || d > map[phone].lastOrderDate)) {
            map[phone].lastOrderDate = d;
            map[phone].name = o.name || map[phone].name;
        }
    });
    allCustomers = Object.values(map).map(c => ({
        ...c,
        points: Math.floor(c.totalSpent / 10)
    })).sort((a,b) => b.totalSpent - a.totalSpent);
    renderCustomers(allCustomers);
}

function renderCustomers(customers) {
    const container = document.getElementById('customersList');
    if (!container) return;
    if (!customers.length) {
        container.innerHTML = `<div class="empty-state"><i class="fas fa-users"></i><p>No customers yet. Orders will populate this list.</p></div>`;
        return;
    }
    const rows = customers.map(c => `
    <tr>
        <td>
            <div class="customer-avatar">${(c.name||'?').charAt(0).toUpperCase()}</div>
        </td>
        <td><div class="prod-name">${c.name}</div></td>
        <td>${c.phone}</td>
        <td>${c.totalOrders}</td>
        <td>₹${c.totalSpent.toLocaleString('en-IN')}</td>
        <td><span class="loyalty-badge"><i class="fas fa-star"></i> ${c.points} pts</span></td>
        <td>${c.lastOrderDate ? c.lastOrderDate.toLocaleDateString('en-IN') : '—'}</td>
        <td>
            <a href="https://wa.me/91${c.phone}" target="_blank" class="btn-wa-reply" style="font-size:.75rem;padding:5px 10px;">
                <i class="fab fa-whatsapp"></i> WhatsApp
            </a>
        </td>
    </tr>`).join('');
    container.innerHTML = `
    <table class="products-table">
        <thead><tr><th></th><th>Name</th><th>Phone</th><th>Orders</th><th>Spent</th><th>Points</th><th>Last Order</th><th>Action</th></tr></thead>
        <tbody>${rows}</tbody>
    </table>`;
}

window.filterCustomers = () => {
    const q = (document.getElementById('customerSearch')?.value || '').toLowerCase();
    renderCustomers(q ? allCustomers.filter(c =>
        c.name.toLowerCase().includes(q) || c.phone.includes(q)
    ) : allCustomers);
};

/* ============================================================
   FEATURE 4: RETURNS & EXCHANGE
   ============================================================ */
let allReturns = [];

function listenReturns() {
    try {
        const q = query(collection(db, 'returns'), orderBy('createdAt', 'desc'));
        onSnapshot(q, snap => {
            allReturns = snap.docs.map(d => ({ id: d.id, ...d.data() }));
            renderReturns(allReturns);
        });
    } catch(err) { console.error('listenReturns:', err); }
}

function renderReturns(returns) {
    const container = document.getElementById('returnsList');
    if (!container) return;
    if (!returns.length) {
        container.innerHTML = `<div class="empty-state"><i class="fas fa-undo-alt"></i><p>No returns logged yet.</p></div>`;
        return;
    }
    const statusClass = { Pending:'order-pending', Refunded:'order-delivered', Exchanged:'order-shipped', Rejected:'order-pending' };
    const rows = returns.map(r => {
        const date = r.createdAt?.toDate ? r.createdAt.toDate().toLocaleDateString('en-IN') : '—';
        const sc = statusClass[r.status] || 'order-pending';
        return `<tr>
            <td><div class="prod-name">${r.name||'—'}</div><div class="prod-cat">${r.phone||''}</div></td>
            <td>${r.product||'—'}</td>
            <td>${r.reason||'—'}</td>
            <td>${r.amount ? `₹${Number(r.amount).toLocaleString('en-IN')}` : '—'}</td>
            <td><span class="order-status ${sc}">${r.status||'Pending'}</span></td>
            <td>${date}</td>
            <td>
                <div class="row-actions">
                    <button class="btn-del" onclick="confirmDeleteReturn('${r.id}')"><i class="fas fa-trash"></i></button>
                </div>
            </td>
        </tr>`;
    }).join('');
    container.innerHTML = `<table class="products-table"><thead><tr><th>Customer</th><th>Product</th><th>Reason</th><th>Amount</th><th>Status</th><th>Date</th><th>Actions</th></tr></thead><tbody>${rows}</tbody></table>`;
}

window.openReturnForm = () => {
    document.getElementById('returnForm')?.reset();
    document.getElementById('editReturnId').value = '';
    document.getElementById('returnFormTitle').textContent = 'Log Return';
    // populate product select
    const sel = document.getElementById('rProduct');
    if (sel) sel.innerHTML = '<option value="">— Select —</option>' + allProducts.map(p => `<option value="${p.name}">${p.name}</option>`).join('');
    showSection('returnForm');
};

window.saveReturn = async e => {
    e.preventDefault();
    const btn = document.getElementById('saveReturnBtn');
    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Saving…';
    btn.disabled = true;
    const restock = document.getElementById('rRestock').checked;
    const productName = document.getElementById('rProduct').value;
    const size = document.getElementById('rSize').value.trim();
    const color = document.getElementById('rColor').value.trim();
    const data = {
        name: document.getElementById('rName').value.trim(),
        phone: document.getElementById('rPhone').value.trim(),
        orderRef: document.getElementById('rOrderRef').value.trim(),
        product: productName,
        size, color,
        reason: document.getElementById('rReason').value,
        amount: Number(document.getElementById('rAmount').value) || 0,
        status: document.getElementById('rStatus').value,
        restock,
        notes: document.getElementById('rNotes').value.trim(),
        updatedAt: serverTimestamp(),
    };
    try {
        await addDoc(collection(db, 'returns'), { ...data, createdAt: serverTimestamp() });
        if (restock && productName) {
            const p = allProducts.find(x => x.name === productName);
            if (p && p.inventory) {
                const k = invKey(size || 'Free Size', color || '');
                const cur = p.inventory[k] ?? 0;
                await updateDoc(doc(db, 'products', p.id), { [`inventory.${k}`]: cur + 1 });
            }
        }
        toast('Return logged!', 'success');
        showSection('returns');
    } catch(err) {
        console.error(err);
        toast('Error saving return', 'error');
    } finally {
        btn.innerHTML = '<i class="fas fa-save"></i> Save Return';
        btn.disabled = false;
    }
};

window.filterReturns = () => {
    const status = document.getElementById('filterReturnStatus')?.value || '';
    renderReturns(status ? allReturns.filter(r => r.status === status) : allReturns);
};

window.confirmDeleteReturn = id => {
    const modal = document.getElementById('deleteModal');
    modal.querySelector('h3').textContent = 'Delete Return?';
    modal.querySelector('p').textContent = 'This return record will be permanently deleted.';
    document.getElementById('confirmDeleteBtn').onclick = async () => {
        try { await deleteDoc(doc(db, 'returns', id)); toast('Return deleted', 'success'); } catch(e) { toast('Error', 'error'); }
        closeDeleteModal();
    };
    modal.style.display = 'flex';
};

/* ============================================================
   FEATURE 5: GST INVOICE (jsPDF)
   ============================================================ */
window.generateGSTInvoice = (orderData) => {
    try {
        if (typeof window.jspdf === 'undefined' && typeof jsPDF === 'undefined') {
            toast('PDF library loading, please try again', 'error'); return;
        }
        const { jsPDF } = window.jspdf || window;
        const doc = new jsPDF();
        const margin = 15;
        let y = 20;

        // Header
        doc.setFontSize(18); doc.setFont('helvetica','bold');
        doc.text('LaFashionPoint', margin, y); y += 8;
        doc.setFontSize(9); doc.setFont('helvetica','normal');
        doc.text('Village Khara Khera, Tehsil Tibbi, Hanumangarh, Rajasthan', margin, y); y += 5;
        doc.text('WhatsApp: +91 9079661164  |  lafashionpoint.com', margin, y); y += 5;
        doc.text('GSTIN: [TO BE ADDED BY OWNER]', margin, y); y += 10;

        // Line
        doc.setLineWidth(0.5); doc.line(margin, y, 195, y); y += 7;

        // Invoice details
        doc.setFontSize(14); doc.setFont('helvetica','bold');
        doc.text('GST INVOICE', margin, y); y += 8;
        doc.setFontSize(9); doc.setFont('helvetica','normal');
        const invNo = orderData.orderId || orderData.id || `INV-${Date.now()}`;
        const invDate = orderData.createdAt instanceof Date
            ? orderData.createdAt.toLocaleDateString('en-IN')
            : (orderData.createdAt?.toDate ? orderData.createdAt.toDate().toLocaleDateString('en-IN') : new Date().toLocaleDateString('en-IN'));
        doc.text(`Invoice No: ${invNo}`, margin, y); y += 5;
        doc.text(`Date: ${invDate}`, margin, y); y += 5;
        doc.text(`Customer: ${orderData.name || 'Walk-in'}`, margin, y); y += 5;
        doc.text(`Phone: ${orderData.phone || '—'}`, margin, y); y += 8;

        // Items table header
        doc.setLineWidth(0.3); doc.line(margin, y, 195, y); y += 5;
        doc.setFont('helvetica','bold'); doc.setFontSize(8);
        doc.text('Item', margin, y);
        doc.text('HSN', 85, y);
        doc.text('Qty', 105, y);
        doc.text('Rate', 120, y);
        doc.text('GST%', 140, y);
        doc.text('GST Amt', 158, y);
        doc.text('Total', 180, y); y += 4;
        doc.line(margin, y, 195, y); y += 5;

        // Items
        doc.setFont('helvetica','normal');
        const items = orderData.items || [{ name: orderData.product || 'Item', qty: orderData.qty || 1, price: orderData.amount || 0, size: orderData.size || '' }];
        let subtotal = 0;
        let totalGst = 0;
        items.forEach(item => {
            const rate = Number(item.price) || 0;
            const qty  = Number(item.qty) || 1;
            const lineAmt = rate * qty;
            const gstPct = lineAmt > 999 ? 12 : 5;
            const gstAmt = Math.round(lineAmt * gstPct / (100 + gstPct));
            const baseAmt = lineAmt - gstAmt;
            subtotal += baseAmt;
            totalGst += gstAmt;
            const nameStr = item.name + (item.size ? ` (${item.size})` : '');
            doc.text(nameStr.substring(0, 28), margin, y);
            doc.text('6101', 85, y);
            doc.text(String(qty), 105, y);
            doc.text(`${rate.toLocaleString('en-IN')}`, 120, y);
            doc.text(`${gstPct}%`, 140, y);
            doc.text(`${gstAmt.toLocaleString('en-IN')}`, 158, y);
            doc.text(`${lineAmt.toLocaleString('en-IN')}`, 180, y);
            y += 6;
        });

        doc.line(margin, y, 195, y); y += 5;

        // Totals
        const grandTotal = subtotal + totalGst;
        doc.setFont('helvetica','normal');
        doc.text(`Subtotal (excl. GST): INR ${subtotal.toLocaleString('en-IN')}`, 120, y); y += 5;
        doc.text(`GST Amount: INR ${totalGst.toLocaleString('en-IN')}`, 120, y); y += 5;
        doc.setFont('helvetica','bold');
        doc.text(`Grand Total: INR ${grandTotal.toLocaleString('en-IN')}`, 120, y); y += 10;

        // Footer
        doc.setFont('helvetica','italic'); doc.setFontSize(9);
        doc.text('Thank you for your business!', margin, y); y += 5;
        doc.text('For queries: wa.me/919079661164', margin, y);

        doc.save(`invoice_${invNo}.pdf`);
        toast('Invoice PDF downloaded!', 'success');
    } catch(err) {
        console.error('Invoice error:', err);
        toast('Error generating invoice: ' + err.message, 'error');
    }
};

/* ============================================================
   FEATURE 6: BARCODE SCANNER
   ============================================================ */
let barcodeReader = null;

window.startBarcodeScanner = async () => {
    const modal = document.getElementById('scannerModal');
    if (!modal) return;
    modal.style.display = 'flex';
    const status = document.getElementById('scannerStatus');
    if (status) status.textContent = 'Starting camera…';
    try {
        if (typeof ZXingBrowser === 'undefined' && typeof window.ZXing === 'undefined') {
            if (status) status.textContent = 'ZXing library not loaded.';
            return;
        }
        const ZXing = window.ZXingBrowser || window.ZXing;
        barcodeReader = new ZXing.BrowserMultiFormatReader();
        const preview = document.getElementById('scannerPreview');
        if (preview) preview.innerHTML = '<video id="scannerVideo" style="width:100%;border-radius:8px;"></video>';
        if (status) status.textContent = 'Scanning…';
        await barcodeReader.decodeFromVideoDevice(null, 'scannerVideo', (result, err) => {
            if (result) {
                const code = result.getText();
                stopBarcodeScanner();
                const p = allProducts.find(x => x.barcode === code);
                if (p) {
                    openPosItem(p.id);
                } else {
                    toast(`Product not found — barcode: ${code}`, 'error');
                }
            }
        });
    } catch(err) {
        console.error('Scanner error:', err);
        if (status) status.textContent = 'Camera error: ' + err.message;
    }
};

window.stopBarcodeScanner = () => {
    try { if (barcodeReader) { barcodeReader.reset(); barcodeReader = null; } } catch(_) {}
    const modal = document.getElementById('scannerModal');
    if (modal) modal.style.display = 'none';
    const preview = document.getElementById('scannerPreview');
    if (preview) preview.innerHTML = '';
};

/* ============================================================
   FEATURE 7: MULTIPLE PRODUCT IMAGES
   ============================================================ */
let pendingImages = [null, null, null, null, null];
let activeSlot = 0;

window.triggerImageUpload = (slotIndex) => {
    activeSlot = slotIndex;
    document.getElementById('multiImageInput')?.click();
};

window.handleMultiImageSelect = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) { toast('Image must be under 5 MB', 'error'); return; }
    pendingImages[activeSlot] = file;
    const reader = new FileReader();
    reader.onload = ev => updateSlotPreview(activeSlot, ev.target.result);
    reader.readAsDataURL(file);
    e.target.value = '';
};

function updateSlotPreview(idx, src) {
    const slot = document.getElementById(`imgSlot${idx}`);
    if (!slot) return;
    slot.innerHTML = `<img src="${src}" style="width:100%;height:100%;object-fit:cover;border-radius:6px;">
        <button type="button" class="slot-remove-btn" onclick="removeSlotImage(${idx},event)"><i class="fas fa-times"></i></button>`;
}

window.removeSlotImage = (idx, e) => {
    e.stopPropagation();
    pendingImages[idx] = null;
    const slot = document.getElementById(`imgSlot${idx}`);
    if (slot) {
        slot.innerHTML = idx === 0
            ? `<div class="img-slot-placeholder"><i class="fas fa-camera"></i><small>Main Photo</small></div>`
            : `<div class="img-slot-placeholder"><i class="fas fa-plus"></i></div>`;
    }
};

/* ============================================================
   FEATURE 8: REVIEWS MODERATION
   ============================================================ */
let allReviews = [];

function listenReviews() {
    try {
        const q = query(collection(db, 'reviews'), orderBy('createdAt', 'desc'));
        onSnapshot(q, snap => {
            allReviews = snap.docs.map(d => ({ id: d.id, ...d.data() }));
            const pending = allReviews.filter(r => !r.approved).length;
            const badge = document.getElementById('reviewsCount');
            if (badge) { badge.textContent = pending; badge.style.display = pending ? 'inline-block' : 'none'; }
            renderReviews(allReviews);
        });
    } catch(err) { console.error('listenReviews:', err); }
}

function renderReviews(reviews) {
    const container = document.getElementById('reviewsList');
    if (!container) return;
    if (!reviews.length) {
        container.innerHTML = `<div class="empty-state"><i class="fas fa-star"></i><p>No reviews yet.</p></div>`;
        return;
    }
    container.innerHTML = reviews.map(r => {
        const prod = allProducts.find(p => p.id === r.productId || p.name === r.product);
        const stars = '★'.repeat(r.rating || 0) + '☆'.repeat(5 - (r.rating || 0));
        const date = r.createdAt?.toDate ? r.createdAt.toDate().toLocaleDateString('en-IN') : '—';
        return `
        <div class="review-card ${r.approved ? 'approved' : 'pending-review'}">
            <div class="review-header">
                <span class="review-product">${prod?.name || r.product || 'Unknown Product'}</span>
                <span class="review-stars">${stars}</span>
                <span class="review-date">${date}</span>
                ${r.approved ? '<span class="review-badge approved-badge">Approved</span>' : '<span class="review-badge pending-badge">Pending</span>'}
            </div>
            <div class="review-author">${r.customerName || r.name || 'Anonymous'}</div>
            <div class="review-comment">${r.comment || r.review || ''}</div>
            <div class="review-actions">
                ${!r.approved ? `<button class="btn-edit" onclick="approveReview('${r.id}')"><i class="fas fa-check"></i> Approve</button>` : ''}
                <button class="btn-del" onclick="rejectReview('${r.id}')"><i class="fas fa-trash"></i> ${r.approved ? 'Delete' : 'Reject'}</button>
            </div>
        </div>`;
    }).join('');
}

window.filterReviews = () => {
    const status = document.getElementById('filterReviewStatus')?.value || '';
    if (!status) { renderReviews(allReviews); return; }
    renderReviews(allReviews.filter(r => status === 'approved' ? r.approved : !r.approved));
};

window.approveReview = async id => {
    try { await updateDoc(doc(db, 'reviews', id), { approved: true }); toast('Review approved!', 'success'); }
    catch(err) { toast('Error approving review', 'error'); }
};

window.rejectReview = async id => {
    try { await deleteDoc(doc(db, 'reviews', id)); toast('Review deleted', 'success'); }
    catch(err) { toast('Error deleting review', 'error'); }
};

/* ============================================================
   FEATURE 9: STAFF ROLE MANAGEMENT
   ============================================================ */
let staffRoleMap = {};

async function loadStaffRoles() {
    try {
        const snap = await getDocs(collection(db, 'staff'));
        staffRoleMap = {};
        const staffList = [];
        snap.forEach(d => {
            const data = { id: d.id, ...d.data() };
            staffRoleMap[data.email] = data.role || 'staff';
            staffList.push(data);
        });
        renderStaffList(staffList);
    } catch(err) { console.error('loadStaffRoles:', err); }
}

function renderStaffList(staffList) {
    const container = document.getElementById('staffList');
    if (!container) return;
    if (!staffList.length) { container.innerHTML = '<p style="color:#9ca3af;font-size:.82rem;">No staff added yet.</p>'; return; }
    container.innerHTML = staffList.map(s => `
    <div class="staff-row">
        <span><i class="fas fa-user"></i> ${s.email}</span>
        <span class="staff-role">${s.role || 'staff'}</span>
        <button class="btn-del" style="padding:4px 10px;font-size:.75rem;" onclick="removeStaff('${s.id}')"><i class="fas fa-times"></i></button>
    </div>`).join('');
}

window.addStaff = async () => {
    const email = document.getElementById('staffEmail')?.value.trim();
    if (!email) { toast('Enter staff email', 'error'); return; }
    try {
        await addDoc(collection(db, 'staff'), { email, role: 'staff', addedAt: serverTimestamp() });
        document.getElementById('staffEmail').value = '';
        toast('Staff added!', 'success');
        loadStaffRoles();
    } catch(err) { toast('Error adding staff', 'error'); }
};

window.removeStaff = async id => {
    try { await deleteDoc(doc(db, 'staff', id)); toast('Staff removed', 'success'); loadStaffRoles(); }
    catch(err) { toast('Error removing staff', 'error'); }
};

/* ============================================================
   FEATURE 10: LOYALTY POINTS IN POS
   ============================================================ */
let posLoyaltyRedemption = 0;

window.checkPosLoyalty = () => {
    const phone = (document.getElementById('posCustomerPhone')?.value || '').replace(/\D/g,'');
    const loyaltyInfo = document.getElementById('posLoyaltyInfo');
    const loyaltyPts  = document.getElementById('posLoyaltyPoints');
    if (!phone || phone.length < 10) {
        if (loyaltyInfo) loyaltyInfo.style.display = 'none';
        return;
    }
    const customer = allCustomers.find(c => c.phone === phone || c.phone.endsWith(phone));
    if (customer && customer.points > 0) {
        if (loyaltyInfo)  loyaltyInfo.style.display = 'flex';
        if (loyaltyPts)   loyaltyPts.textContent = `${customer.points} points (worth ₹${(customer.points * 0.1).toFixed(0)})`;
    } else {
        if (loyaltyInfo) loyaltyInfo.style.display = 'none';
    }
};

window.redeemLoyaltyPoints = () => {
    const phone = (document.getElementById('posCustomerPhone')?.value || '').replace(/\D/g,'');
    const customer = allCustomers.find(c => c.phone === phone || c.phone.endsWith(phone));
    if (!customer || !customer.points) { toast('No points to redeem', 'error'); return; }
    const discount = Math.floor(customer.points * 0.1);
    posLoyaltyRedemption = discount;
    toast(`₹${discount} loyalty discount applied!`, 'success');
    updatePosTotalsWithLoyalty();
    document.getElementById('posRedeemBtn').disabled = true;
};

function updatePosTotalsWithLoyalty() {
    const sub   = posCart.reduce((s, i) => s + i.price * i.qty, 0);
    const disc  = posCouponDisc > 0 ? Math.round(sub * posCouponDisc / 100) : 0;
    const total = Math.max(0, sub - disc - posLoyaltyRedemption);
    document.getElementById('posSubtotal').textContent   = `₹${sub.toLocaleString('en-IN')}`;
    document.getElementById('posGrandTotal').textContent = `₹${total.toLocaleString('en-IN')}`;
    const dr = document.getElementById('posDiscountRow');
    if (disc > 0 || posLoyaltyRedemption > 0) {
        const label = [posAppliedCoupon ? `${posAppliedCoupon} (${posCouponDisc}% off)` : null, posLoyaltyRedemption > 0 ? `Loyalty -₹${posLoyaltyRedemption}` : null].filter(Boolean).join(' + ');
        document.getElementById('posDiscountLabel').textContent = label;
        document.getElementById('posDiscountAmt').textContent   = `-₹${(disc + posLoyaltyRedemption).toLocaleString('en-IN')}`;
        dr.style.display = 'flex';
    } else { dr.style.display = 'none'; }
    // Points to earn
    const earnEl = document.getElementById('posPointsEarn');
    const earnTxt = document.getElementById('posPointsEarnText');
    if (earnEl && earnTxt && total > 0) {
        earnTxt.textContent = `You'll earn ${Math.floor(total / 10)} points on this purchase`;
        earnEl.style.display = 'block';
    } else if (earnEl) { earnEl.style.display = 'none'; }
    calcPosChange();
    // UPI QR
    if (posPayMethod === 'UPI') showPosUpiQr(total);
}

/* ============================================================
   FEATURE 11: UPI QR CODE
   ============================================================ */
let currentUpiId = '';

function loadUpiSettings() {
    currentUpiId = localStorage.getItem('lfp_upi_id') || '';
    const el = document.getElementById('settingsUpiId');
    if (el) el.value = currentUpiId;
    if (currentUpiId) generateUpiQr('upiQrPreview', currentUpiId, 0);
}

window.saveUpiId = () => {
    currentUpiId = document.getElementById('settingsUpiId')?.value.trim() || '';
    localStorage.setItem('lfp_upi_id', currentUpiId);
    if (currentUpiId) generateUpiQr('upiQrPreview', currentUpiId, 0);
};

function generateUpiQr(containerId, upiId, amount) {
    try {
        if (typeof QRCode === 'undefined') return;
        const container = document.getElementById(containerId);
        if (!container) return;
        container.innerHTML = '';
        const upiUrl = `upi://pay?pa=${encodeURIComponent(upiId)}&pn=LaFashionPoint${amount > 0 ? `&am=${amount}` : ''}&cu=INR`;
        new QRCode(container, { text: upiUrl, width: 160, height: 160, correctLevel: QRCode.CorrectLevel.M });
        const label = document.createElement('p');
        label.style.cssText = 'font-size:.75rem;color:#666;margin-top:6px;';
        label.textContent = upiId;
        container.appendChild(label);
    } catch(err) { console.error('QR error:', err); }
}

function showPosUpiQr(amount) {
    const container = document.getElementById('posUpiQr');
    if (!container) return;
    if (!currentUpiId || !amount) { container.style.display = 'none'; return; }
    container.style.display = 'block';
    generateUpiQr('posUpiQr', currentUpiId, amount);
}

// Hook into setPosPayMethod to show/hide UPI QR
const _origSetPosPayMethod = window.setPosPayMethod;
window.setPosPayMethod = el => {
    _origSetPosPayMethod(el);
    const sub  = posCart.reduce((s, i) => s + i.price * i.qty, 0);
    const disc = posCouponDisc > 0 ? Math.round(sub * posCouponDisc / 100) : 0;
    const total = Math.max(0, sub - disc - posLoyaltyRedemption);
    if (posPayMethod === 'UPI' && total > 0) {
        showPosUpiQr(total);
    } else {
        const qr = document.getElementById('posUpiQr');
        if (qr) qr.style.display = 'none';
    }
};

/* ============================================================
   FEATURE 12: LOW STOCK ALERTS
   ============================================================ */
function checkLowStock() {
    try {
        const variants = buildVariantList();
        const low = variants.filter(v => v.stock > 0 && v.stock <= 3);
        const alert = document.getElementById('lowStockAlert');
        const list  = document.getElementById('lowStockList');
        if (!alert || !list) return;
        if (!low.length) { alert.style.display = 'none'; return; }
        list.textContent = low.map(v => `${v.p.name} (${v.size}${v.color ? '/' + v.color : ''}): ${v.stock} left`).join(' · ');
        alert.style.display = 'flex';
    } catch(err) { console.error('checkLowStock:', err); }
}

window.whatsappLowStock = () => {
    const variants = buildVariantList().filter(v => v.stock > 0 && v.stock <= 3);
    const msg = `*LaFashionPoint — Low Stock Alert*\n\nThe following items are running low:\n\n${
        variants.map(v => `• ${v.p.name} (${v.size}${v.color ? '/' + v.color : ''}): ${v.stock} units left`).join('\n')
    }\n\nPlease reorder soon!`;
    window.open(`https://wa.me/919079661164?text=${encodeURIComponent(msg)}`, '_blank', 'noopener');
};

/* ============================================================
   FEATURE 13: END-OF-DAY POS SUMMARY
   ============================================================ */
window.showEODSummary = () => {
    const modal = document.getElementById('eodModal');
    if (!modal) return;
    const today = new Date();
    const todayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    const todayEnd   = new Date(todayStart); todayEnd.setDate(todayEnd.getDate() + 1);

    const todayOrders = allOrders.filter(o => {
        if (o.source !== 'pos') return false;
        const t = o.createdAt?.toDate ? o.createdAt.toDate() : (o.createdAt ? new Date(o.createdAt) : null);
        return t && t >= todayStart && t < todayEnd;
    });

    document.getElementById('eodDate').textContent = `Date: ${today.toLocaleDateString('en-IN', { weekday:'long', year:'numeric', month:'long', day:'numeric' })}`;

    if (!todayOrders.length) {
        document.getElementById('eodContent').innerHTML = '<p style="color:#9ca3af;text-align:center;padding:20px;">No POS sales today.</p>';
        modal.style.display = 'flex';
        return;
    }

    const totalRev  = todayOrders.reduce((s, o) => s + (Number(o.amount) || 0), 0);
    const avgOrder  = Math.round(totalRev / todayOrders.length);
    const payBreak  = {};
    todayOrders.forEach(o => {
        const m = o.payment || 'Cash';
        payBreak[m] = (payBreak[m] || 0) + (Number(o.amount) || 0);
    });
    const itemCount = {};
    todayOrders.forEach(o => {
        (o.items || [{ name: o.product }]).forEach(i => {
            if (i.name) itemCount[i.name] = (itemCount[i.name] || 0) + (i.qty || 1);
        });
    });
    const topItems = Object.entries(itemCount).sort((a,b) => b[1]-a[1]).slice(0, 5);

    document.getElementById('eodContent').innerHTML = `
    <div class="eod-stats">
        <div class="eod-stat"><strong>${todayOrders.length}</strong><small>Transactions</small></div>
        <div class="eod-stat"><strong>₹${totalRev.toLocaleString('en-IN')}</strong><small>Total Revenue</small></div>
        <div class="eod-stat"><strong>₹${avgOrder.toLocaleString('en-IN')}</strong><small>Avg Order Value</small></div>
    </div>
    <h4 style="margin:12px 0 6px;font-size:.82rem;color:#9ca3af;text-transform:uppercase;letter-spacing:.05em;">By Payment Method</h4>
    ${Object.entries(payBreak).map(([m, amt]) => `<div class="eod-row"><span>${m}</span><span>₹${amt.toLocaleString('en-IN')}</span></div>`).join('')}
    <h4 style="margin:12px 0 6px;font-size:.82rem;color:#9ca3af;text-transform:uppercase;letter-spacing:.05em;">Top Items Sold</h4>
    ${topItems.map(([name, qty]) => `<div class="eod-row"><span>${name}</span><span>${qty} units</span></div>`).join('')}`;

    modal.style.display = 'flex';
};

window.printEOD = () => {
    const content = document.getElementById('eodContent')?.innerHTML || '';
    const date = document.getElementById('eodDate')?.textContent || '';
    const win = window.open('', '_blank', 'width=400,height=600');
    win.document.write(`<!DOCTYPE html><html><head><title>EOD Summary</title>
    <style>body{font-family:sans-serif;max-width:360px;margin:auto;padding:16px;font-size:13px}
    h3{text-align:center}h4{margin:10px 0 4px;color:#666;font-size:.8rem;text-transform:uppercase}
    .eod-stats{display:flex;gap:10px;margin:10px 0}
    .eod-stat{flex:1;text-align:center;padding:10px;border:1px solid #eee;border-radius:6px}
    .eod-stat strong{display:block;font-size:1.1rem}
    .eod-stat small{color:#666;font-size:.75rem}
    .eod-row{display:flex;justify-content:space-between;padding:3px 0;border-bottom:1px solid #f0f0f0}
    </style></head><body>
    <h3>End of Day Summary</h3><p style="text-align:center;color:#666;font-size:.82rem;">${date}</p>
    ${content}</body></html>`);
    win.document.close();
    setTimeout(() => win.print(), 300);
};

/* ============================================================
   FEATURE 14: ENHANCED WHATSAPP INQUIRIES
   (renderInquiries already handles WhatsApp - enhancement is in the template)
   ============================================================ */
