import { auth, db, storage } from './firebase-config.js';

import {
    signInWithEmailAndPassword,
    signOut,
    onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";

import {
    collection, doc, addDoc, updateDoc, deleteDoc,
    onSnapshot, query, orderBy, serverTimestamp, getDoc
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

import {
    ref, uploadBytesResumable, getDownloadURL, deleteObject
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-storage.js";

/* ============================================================
   STATE
   ============================================================ */
let allProducts    = [];
let pendingImageFile = null;
let pendingDeleteId  = null;
let pendingImageUrl  = '';   // existing image URL when editing

/* ============================================================
   AUTH
   ============================================================ */
onAuthStateChanged(auth, user => {
    if (user) {
        document.getElementById('loginScreen').style.display = 'none';
        document.getElementById('adminApp').style.display    = 'flex';
        document.getElementById('adminEmail').textContent    = user.email;
        startListeners();
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
        errEl.textContent  = friendlyAuthError(err.code);
        errEl.style.display = 'block';
        btn.innerHTML = '<i class="fas fa-sign-in-alt"></i> Sign In';
        btn.disabled  = false;
    }
});

window.handleLogout = async () => {
    await signOut(auth);
    toast('Logged out', 'success');
};

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
    inp.type    = show ? 'text' : 'password';
    icon.className = show ? 'fas fa-eye-slash' : 'fas fa-eye';
};

/* ============================================================
   NAVIGATION
   ============================================================ */
const sections = ['products', 'form', 'inquiries', 'settings'];

window.showSection = name => {
    sections.forEach(s => {
        const el = document.getElementById(`section${cap(s)}`);
        if (el) el.classList.toggle('active', s === name);
    });

    document.querySelectorAll('.nav-item').forEach(n => {
        n.classList.toggle('active', n.dataset.section === name);
    });

    const titles = { products: 'Products', form: '', inquiries: 'Inquiries', settings: 'Settings' };
    document.getElementById('pageTitle').textContent = titles[name] || '';

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
}

/* ============================================================
   PRODUCTS — FIRESTORE
   ============================================================ */
function listenProducts() {
    const q = query(collection(db, 'products'), orderBy('order', 'asc'));
    onSnapshot(q, snap => {
        allProducts = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        renderProductTable(allProducts);
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
                ? `<div class="price-original-s">₹${p.originalPrice.toLocaleString('en-IN')}</div>`
                : ''}
        </td>
        <td>
            <span class="badge-pill ${(p.badge || 'none').toLowerCase()}">${p.badge || '—'}</span>
        </td>
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
            <tr>
                <th>Photo</th>
                <th>Name / Category</th>
                <th>Price</th>
                <th>Badge</th>
                <th>Status</th>
                <th>Actions</th>
            </tr>
        </thead>
        <tbody>${rows}</tbody>
    </table>`;
}

window.filterProducts = () => {
    const search = document.getElementById('searchProducts').value.toLowerCase();
    const cat    = document.getElementById('filterCategory').value;
    const filtered = allProducts.filter(p =>
        p.name.toLowerCase().includes(search) &&
        (!cat || p.category === cat)
    );
    renderProductTable(filtered);
};

function iconFor(cat) {
    return { 'T-Shirt': 'tshirt', 'Shirt': 'user-tie', 'Hoodie': 'hat-wizard', 'Jeans': 'drafting-compass' }[cat] || 'tshirt';
}

/* ============================================================
   PRODUCT FORM
   ============================================================ */
window.openProductForm = () => {
    resetForm();
    document.getElementById('formTitle').textContent  = 'Add New Product';
    document.getElementById('pageTitle').textContent  = 'Add Product';
    showSection('form');
};

window.editProduct = async id => {
    const p = allProducts.find(x => x.id === id);
    if (!p) return;

    resetForm();
    document.getElementById('formTitle').textContent = 'Edit Product';
    document.getElementById('pageTitle').textContent = 'Edit Product';

    document.getElementById('editId').value          = id;
    document.getElementById('pName').value           = p.name           || '';
    document.getElementById('pCategory').value       = p.category       || '';
    document.getElementById('pBadge').value          = p.badge          || '';
    document.getElementById('pPrice').value          = p.price          ?? '';
    document.getElementById('pOriginalPrice').value  = p.originalPrice  ?? '';
    document.getElementById('pDescription').value    = p.description    || '';
    document.getElementById('pOrder').value          = p.order          ?? 99;
    document.getElementById('pAvailable').checked    = p.available      !== false;

    if (p.imageUrl) {
        pendingImageUrl = p.imageUrl;
        const img = document.getElementById('imagePreviewImg');
        img.src   = p.imageUrl;
        img.style.display = 'block';
        document.getElementById('imagePreview').style.display = 'none';
        document.getElementById('imageActions').style.display = 'flex';
    }

    showSection('form');
};

function resetForm() {
    document.getElementById('productForm').reset();
    document.getElementById('editId').value           = '';
    document.getElementById('imagePreviewImg').style.display = 'none';
    document.getElementById('imagePreview').style.display    = 'flex';
    document.getElementById('imageActions').style.display    = 'none';
    document.getElementById('uploadProgress').style.display  = 'none';
    pendingImageFile = null;
    pendingImageUrl  = '';
}

/* Image handling */
window.handleImageSelect = e => {
    const file = e.target.files[0];
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) { toast('Image must be under 5 MB', 'error'); return; }

    pendingImageFile = file;

    const reader = new FileReader();
    reader.onload = ev => {
        const img = document.getElementById('imagePreviewImg');
        img.src   = ev.target.result;
        img.style.display = 'block';
        document.getElementById('imagePreview').style.display = 'none';
        document.getElementById('imageActions').style.display = 'flex';
    };
    reader.readAsDataURL(file);
};

window.removeImage = () => {
    pendingImageFile = null;
    pendingImageUrl  = '';
    document.getElementById('imageInput').value         = '';
    document.getElementById('imagePreviewImg').style.display = 'none';
    document.getElementById('imagePreview').style.display    = 'flex';
    document.getElementById('imageActions').style.display    = 'none';
};

/* Save product */
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
    const order    = Number(document.getElementById('pOrder').value) || 99;
    const avail    = document.getElementById('pAvailable').checked;

    let imageUrl = pendingImageUrl;

    try {
        // Upload new image if one was selected
        if (pendingImageFile) {
            imageUrl = await uploadImage(pendingImageFile, id || Date.now().toString());
        }

        const data = {
            name, category, badge, price, description: desc, order, available: avail,
            imageUrl: imageUrl || '',
            ...(orig && orig > price ? { originalPrice: orig } : { originalPrice: null }),
            updatedAt: serverTimestamp(),
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
        const ext      = file.name.split('.').pop();
        const path     = `products/${productId}_${Date.now()}.${ext}`;
        const storageRef = ref(storage, path);
        const task     = uploadBytesResumable(storageRef, file);

        const progressWrap = document.getElementById('uploadProgress');
        const fill         = document.getElementById('progressFill');
        const text         = document.getElementById('progressText');
        progressWrap.style.display = 'block';

        task.on('state_changed',
            snap => {
                const pct = Math.round((snap.bytesTransferred / snap.totalBytes) * 100);
                fill.style.width  = pct + '%';
                text.textContent  = `Uploading… ${pct}%`;
            },
            err => { reject(err); },
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
    document.getElementById('deleteModal').style.display    = 'flex';
    document.getElementById('confirmDeleteBtn').onclick = doDelete;
};

window.closeDeleteModal = () => {
    document.getElementById('deleteModal').style.display = 'none';
    pendingDeleteId = null;
};

async function doDelete() {
    if (!pendingDeleteId) return;
    const btn = document.getElementById('confirmDeleteBtn');
    btn.textContent = 'Deleting…';
    btn.disabled    = true;

    try {
        const p = allProducts.find(x => x.id === pendingDeleteId);
        // Delete image from storage if exists
        if (p?.imageUrl) {
            try {
                const imgRef = ref(storage, p.imageUrl);
                await deleteObject(imgRef);
            } catch (_) { /* image may already be gone */ }
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
        const docs    = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        const unread  = docs.filter(d => !d.read).length;
        const countEl = document.getElementById('inquiryCount');
        countEl.textContent    = unread;
        countEl.style.display  = unread ? 'inline-block' : 'none';
        renderInquiries(docs);
    });
}

function renderInquiries(docs) {
    const container = document.getElementById('inquiriesList');

    if (!docs.length) {
        container.innerHTML = `
        <div class="empty-state">
            <i class="fas fa-inbox"></i>
            <p>No inquiries yet.</p>
        </div>`;
        return;
    }

    container.innerHTML = docs.map(d => {
        const date = d.createdAt?.toDate ? d.createdAt.toDate().toLocaleString('en-IN') : 'Just now';
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
                       </a>`
                    : ''}
                ${!d.read
                    ? `<button class="btn-edit" onclick="markRead('${d.id}')"><i class="fas fa-check"></i> Mark Read</button>`
                    : ''}
            </div>
        </div>`;
    }).join('');
}

window.markRead = async id => {
    await updateDoc(doc(db, 'inquiries', id), { read: true });
};

/* ============================================================
   TOAST
   ============================================================ */
function toast(msg, type = '') {
    const t = document.getElementById('adminToast');
    t.textContent  = msg;
    t.className    = `admin-toast ${type} show`;
    clearTimeout(t._timer);
    t._timer = setTimeout(() => t.classList.remove('show'), 2800);
}
