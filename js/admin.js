const currencyFormatter = new Intl.NumberFormat('es-PE', { style: 'currency', currency: 'PEN' });
const dateFormatter = new Intl.DateTimeFormat('es-PE', { dateStyle: 'medium', timeStyle: 'short' });

let adminKey = '';
let orders = [];
let products = [];
let proofObjectUrl = '';
let productPreviewUrl = '';

function formatCurrency(amount) {
    return currencyFormatter.format(Number(amount) || 0);
}

function escapeHTML(value) {
    return String(value ?? '').replace(/[&<>"']/g, (character) => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;'
    })[character]);
}

function statusLabel(status) {
    const labels = {
        pending: 'Pendiente',
        pending_manual_review: 'Por verificar',
        approved: 'Aprobado',
        rejected: 'Rechazado',
        cancelled: 'Cancelado',
        in_process: 'En proceso',
        refunded: 'Reembolsado',
        charged_back: 'Contracargo'
    };
    return labels[status] || status || 'Sin estado';
}

function showLoginError(message) {
    document.getElementById('loginError').textContent = message;
}

function setConnectionState(message, connected = false) {
    const state = document.getElementById('connectionState');
    state.textContent = message;
    state.classList.toggle('is-connected', connected);
}

async function loadOrders() {
    setConnectionState('Actualizando…');
    try {
        const view = document.getElementById('archiveFilter')?.value || 'active';
        const response = await fetch(`/api/orders?view=${encodeURIComponent(view)}`, {
            headers: { 'x-admin-key': adminKey },
            cache: 'no-store'
        });

        if (response.status === 404) {
            adminKey = '';
            document.getElementById('adminDashboard').hidden = true;
            document.getElementById('adminLogin').hidden = false;
            showLoginError('Clave incorrecta o ADMIN_API_KEY sin configurar en server/.env.');
            setConnectionState('Sin acceso');
            return false;
        }

        if (!response.ok) throw new Error('No se pudo consultar el historial.');
        orders = await response.json();
        document.getElementById('adminLogin').hidden = true;
        document.getElementById('adminDashboard').hidden = false;
        setConnectionState('Servidor conectado', true);
        renderOrders();
        return true;
    } catch (error) {
        setConnectionState('Error de conexión');
        showLoginError('No se pudo conectar con el servidor o la base de datos.');
        return false;
    }
}

async function loadProducts() {
    setConnectionState('Cargando catálogo…');
    try {
        const response = await fetch('/api/admin/products', {
            headers: { 'x-admin-key': adminKey },
            cache: 'no-store'
        });
        if (response.status === 404) {
            adminKey = '';
            document.getElementById('adminDashboard').hidden = true;
            document.getElementById('adminLogin').hidden = false;
            showLoginError('Clave incorrecta o ADMIN_API_KEY sin configurar en server/.env.');
            setConnectionState('Sin acceso');
            return false;
        }
        if (!response.ok) throw new Error('No se pudo consultar el catálogo.');
        products = await response.json();
        setConnectionState('Servidor conectado', true);
        renderProducts();
        return true;
    } catch (error) {
        setConnectionState('Error de conexión');
        document.getElementById('productResultCount').textContent = error.message;
        return false;
    }
}

function filteredProducts() {
    const search = document.getElementById('productSearch').value.trim().toLowerCase();
    const visibility = document.getElementById('productVisibility').value;
    return products.filter((product) => {
        const isActive = product.isActive === true || product.isActive === 1;
        const matchesVisibility = visibility === 'all' || (visibility === 'active' ? isActive : !isActive);
        const haystack = [product.title, product.category, product.platform, product.id].join(' ').toLowerCase();
        return matchesVisibility && (!search || haystack.includes(search));
    });
}

function renderProducts() {
    const list = filteredProducts();
    const tbody = document.getElementById('productsTableBody');
    document.getElementById('productResultCount').textContent = `${list.length} ${list.length === 1 ? 'producto' : 'productos'}`;
    document.getElementById('productsEmpty').hidden = list.length > 0;

    tbody.innerHTML = list.map((product) => {
        const active = product.isActive === true || product.isActive === 1;
        const visibility = active
            ? '<span class="status-badge status-approved">Activo</span>'
            : '<span class="status-badge status-pending">Retirado</span>';
        const action = active
            ? `<button class="row-action danger" type="button" data-product-action="retire" data-product-id="${escapeHTML(product.id)}">Retirar</button>`
            : `<button class="row-action" type="button" data-product-action="restore" data-product-id="${escapeHTML(product.id)}">Reactivar</button>`;
        return `
            <tr>
                <td>
                    <div class="admin-product-cell">
                        <span class="admin-product-thumb" style="--product-glow:${escapeHTML(product.color)}"><img src="${escapeHTML(product.logo)}" alt="" loading="lazy"></span>
                        <span><strong>${escapeHTML(product.title)}</strong><span class="table-subtext">${escapeHTML(product.id)}</span></span>
                    </div>
                </td>
                <td>${escapeHTML(product.category)}</td>
                <td>${escapeHTML(product.platform)}</td>
                <td>${escapeHTML(product.type)}</td>
                <td class="numeric">${formatCurrency(product.price)}</td>
                <td>${visibility}</td>
                <td><div class="admin-product-actions"><button class="row-action" type="button" data-product-action="edit" data-product-id="${escapeHTML(product.id)}">Editar</button>${action}</div></td>
            </tr>
        `;
    }).join('');

    tbody.querySelectorAll('[data-product-action]').forEach((button) => {
        button.addEventListener('click', () => {
            const product = products.find((item) => item.id === button.dataset.productId);
            if (!product) return;
            if (button.dataset.productAction === 'edit') openProductEditor(product);
            if (button.dataset.productAction === 'retire') retireProduct(product);
            if (button.dataset.productAction === 'restore') restoreProduct(product);
        });
    });
}

function releaseProductPreview() {
    if (productPreviewUrl) URL.revokeObjectURL(productPreviewUrl);
    productPreviewUrl = '';
}

function openProductEditor(product = null) {
    const form = document.getElementById('productForm');
    const dialog = document.getElementById('productDialog');
    const imageInput = document.getElementById('productImage');
    const preview = document.getElementById('productImagePreview');
    releaseProductPreview();
    form.reset();
    document.getElementById('productFormError').textContent = '';
    document.getElementById('productId').value = product?.id || '';
    document.getElementById('productDialogTitle').textContent = product ? 'Editar producto' : 'Añadir producto';
    document.getElementById('productTitle').value = product?.title || '';
    document.getElementById('productCategory').value = product?.category || 'software';
    document.getElementById('productPlatform').value = product?.platform || '';
    document.getElementById('productType').value = product?.type || 'Clave de CD';
    document.getElementById('productPrice').value = product?.price ?? '';
    document.getElementById('productColor').value = product?.color || '#2563eb';
    imageInput.required = !product;
    preview.hidden = !product;
    if (product) preview.src = product.logo;
    dialog.showModal();
}

async function saveProduct(event) {
    event.preventDefault();
    const form = document.getElementById('productForm');
    const errorElement = document.getElementById('productFormError');
    const button = document.getElementById('saveProductButton');
    errorElement.textContent = '';

    const file = document.getElementById('productImage').files[0];
    if (file && (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || file.size > 5 * 1024 * 1024)) {
        errorElement.textContent = 'La imagen debe ser PNG, JPG o WebP y no superar 5 MB.';
        return;
    }

    button.disabled = true;
    button.textContent = 'Guardando…';
    const productId = document.getElementById('productId').value;
    const payload = new FormData(form);
    const url = productId ? `/api/admin/products/${encodeURIComponent(productId)}` : '/api/admin/products';

    try {
        const response = await fetch(url, {
            method: productId ? 'PUT' : 'POST',
            headers: { 'x-admin-key': adminKey },
            body: payload
        });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || 'No se pudo guardar el producto.');
        document.getElementById('productDialog').close();
        await loadProducts();
    } catch (error) {
        errorElement.textContent = error.message;
    } finally {
        button.disabled = false;
        button.textContent = 'Guardar producto';
    }
}

async function retireProduct(product) {
    if (!confirm(`¿Retirar "${product.title}" del catálogo? El historial de pedidos se conservará.`)) return;
    try {
        const response = await fetch(`/api/admin/products/${encodeURIComponent(product.id)}`, {
            method: 'DELETE',
            headers: { 'x-admin-key': adminKey }
        });
        if (!response.ok) throw new Error('No se pudo retirar el producto.');
        await loadProducts();
    } catch (error) {
        alert(error.message);
    }
}

async function restoreProduct(product) {
    try {
        const response = await fetch(`/api/admin/products/${encodeURIComponent(product.id)}/restore`, {
            method: 'POST',
            headers: { 'x-admin-key': adminKey }
        });
        if (!response.ok) throw new Error('No se pudo reactivar el producto.');
        await loadProducts();
    } catch (error) {
        alert(error.message);
    }
}

function setupAdminTabs() {
    const ordersTab = document.getElementById('tabOrders');
    const productsTab = document.getElementById('tabProducts');
    ordersTab.addEventListener('click', () => {
        document.getElementById('ordersPanel').hidden = false;
        document.getElementById('productsPanel').hidden = true;
        ordersTab.classList.add('active');
        productsTab.classList.remove('active');
        ordersTab.setAttribute('aria-selected', 'true');
        productsTab.setAttribute('aria-selected', 'false');
    });
    productsTab.addEventListener('click', async () => {
        document.getElementById('ordersPanel').hidden = true;
        document.getElementById('productsPanel').hidden = false;
        productsTab.classList.add('active');
        ordersTab.classList.remove('active');
        productsTab.setAttribute('aria-selected', 'true');
        ordersTab.setAttribute('aria-selected', 'false');
        await loadProducts();
    });
}

function filteredOrders() {
    const search = document.getElementById('orderSearch').value.trim().toLowerCase();
    const status = document.getElementById('statusFilter').value;
    return orders.filter((order) => {
        const haystack = [
            order.ExternalReference,
            order.PayerName,
            order.PayerLastName,
            order.PayerEmail,
            order.PaymentId,
            order.PayerPhone,
            ...(order.Items || []).map((item) => item.Title)
        ].join(' ').toLowerCase();
        return (!search || haystack.includes(search)) && (status === 'all' || order.Status === status);
    });
}

function renderStats() {
    const approved = orders.filter((order) => order.Status === 'approved');
    const pending = orders.filter((order) => order.Status === 'pending' || order.Status === 'pending_manual_review');
    const revenue = approved.reduce((sum, order) => sum + Number(order.Total || 0), 0);

    document.getElementById('statOrders').textContent = orders.length;
    document.getElementById('statPending').textContent = pending.length;
    document.getElementById('statApproved').textContent = approved.length;
    document.getElementById('statRevenue').textContent = formatCurrency(revenue);
}

function renderOrders() {
    renderStats();
    const visibleOrders = filteredOrders();
    const tbody = document.getElementById('ordersTableBody');
    document.getElementById('resultCount').textContent = `${visibleOrders.length} ${visibleOrders.length === 1 ? 'pedido' : 'pedidos'}`;
    document.getElementById('ordersEmpty').hidden = visibleOrders.length !== 0;

    tbody.innerHTML = visibleOrders.map((order) => {
        const customer = [order.PayerName, order.PayerLastName].filter(Boolean).join(' ') || 'Cliente sin nombre';
        const date = order.CreatedAt ? dateFormatter.format(new Date(order.CreatedAt)) : 'Sin fecha';
        const fulfillment = order.FulfillmentStatus === 'delivered' ? 'Entregado' : 'Pendiente';
        return `
            <tr>
                <td><strong>#${escapeHTML(order.Id)}</strong><span class="table-subtext">${escapeHTML(order.ExternalReference)}</span>${order.ArchivedAt ? '<span class="table-subtext">Retirado</span>' : ''}</td>
                <td><strong>${escapeHTML(customer)}</strong><span class="table-subtext">${escapeHTML(order.PayerEmail || 'Sin correo')}</span></td>
                <td>${escapeHTML(date)}</td>
                <td><span class="status-badge status-${escapeHTML(order.Status)}">${escapeHTML(statusLabel(order.Status))}</span><span class="table-subtext">${order.HasProof ? 'Comprobante adjunto' : 'Sin comprobante'}</span></td>
            <td><span class="status-badge ${order.FulfillmentStatus === 'delivered' ? 'status-approved' : 'status-pending'}">${fulfillment}</span></td>
            <td>${escapeHTML(order.PaymentMethod || 'MercadoPago')}</td>
                <td class="numeric">${formatCurrency(order.Total)}</td>
                <td><button class="row-action" type="button" data-order-detail="${Number(order.Id)}">Ver</button></td>
                <td>${order.ArchivedAt
                    ? `<button class="row-action" type="button" data-order-action="restore" data-order-id="${Number(order.Id)}">Restaurar</button>`
                    : `<button class="row-action danger" type="button" data-order-action="archive" data-order-id="${Number(order.Id)}">Retirar</button>`}</td>
            </tr>
        `;
    }).join('');

    tbody.querySelectorAll('[data-order-detail]').forEach((button) => {
        button.addEventListener('click', () => showOrderDetail(Number(button.dataset.orderDetail)));
    });
    tbody.querySelectorAll('[data-order-action]').forEach((button) => {
        button.addEventListener('click', () => changeOrderArchiveState(Number(button.dataset.orderId), button.dataset.orderAction));
    });
}

async function changeOrderArchiveState(orderId, action) {
    if (action === 'archive' && !confirm(`¿Retirar el pedido #${orderId} de la lista activa? Se conservará en el historial y podrás restaurarlo.`)) return;
    try {
        const response = await fetch(`/api/orders/${orderId}/${action}`, {
            method: 'POST',
            headers: { 'x-admin-key': adminKey }
        });
        if (!response.ok) throw new Error(action === 'archive' ? 'No se pudo retirar el pedido.' : 'No se pudo restaurar el pedido.');
        await loadOrders();
    } catch (error) {
        alert(error.message);
    }
}

function getCustomerOrderCount(email) {
    if (!email) return 1;
    const clean = email.toLowerCase().trim();
    return orders.filter((o) => (o.PayerEmail || '').toLowerCase().trim() === clean).length;
}

function buildWhatsAppChatUrl(order) {
    const rawPhone = String(order.PayerPhone || '').replace(/\D/g, '');
    if (!rawPhone) return '';
    const customer = [order.PayerName, order.PayerLastName].filter(Boolean).join(' ') || 'Cliente';
    const itemsText = (order.Items || []).map((i) => `${i.Title} x${i.Quantity}`).join(', ') || 'Productos digitales';
    const msg = `Hola ${customer}, te saludamos de DigitalRO respecto a tu pedido #${order.Id} (${itemsText}).`;
    return `https://wa.me/${rawPhone}?text=${encodeURIComponent(msg)}`;
}

function exportOrdersToCSV() {
    const list = filteredOrders();
    if (list.length === 0) {
        alert('No hay pedidos visibles para exportar.');
        return;
    }

    const headers = ['ID', 'Referencia', 'Cliente', 'Email', 'Telefono', 'Metodo', 'Estado_Pago', 'Estado_Entrega', 'Total_PEN', 'Fecha'];
    const rows = list.map((o) => {
        const customer = [o.PayerName, o.PayerLastName].filter(Boolean).join(' ') || '';
        const date = o.CreatedAt ? new Date(o.CreatedAt).toISOString().replace('T', ' ').slice(0, 19) : '';
        return [
            o.Id,
            `"${(o.ExternalReference || '').replace(/"/g, '""')}"`,
            `"${customer.replace(/"/g, '""')}"`,
            `"${(o.PayerEmail || '').replace(/"/g, '""')}"`,
            `"${(o.PayerPhone || '').replace(/"/g, '""')}"`,
            `"${(o.PaymentMethod || 'MercadoPago').replace(/"/g, '""')}"`,
            `"${(o.Status || '').replace(/"/g, '""')}"`,
            `"${(o.FulfillmentStatus || 'pending').replace(/"/g, '""')}"`,
            Number(o.Total || 0).toFixed(2),
            `"${date}"`
        ].join(',');
    });

    const csvContent = '\uFEFF' + [headers.join(','), ...rows].join('\r\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `pedidos-digitalro-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

function showOrderDetail(orderId) {
    const order = orders.find((item) => Number(item.Id) === orderId);
    if (!order) return;

    document.getElementById('dialogOrderId').textContent = `Pedido #${order.Id}`;
    const items = Array.isArray(order.Items) ? order.Items : [];
    const itemRows = items.length ? items.map((item) => `
        <div class="dialog-item-row">
            <span>${escapeHTML(item.Title)} <small>× ${Number(item.Quantity)}</small></span>
            <strong>${formatCurrency(Number(item.UnitPrice) * Number(item.Quantity))}</strong>
        </div>
    `).join('') : '<p class="admin-muted">No hay artículos asociados.</p>';

    const count = getCustomerOrderCount(order.PayerEmail);
    const customerBadge = count > 1 ? `Cliente recurrente (${count} pedidos)` : 'Primer pedido';
    const waChatUrl = buildWhatsAppChatUrl(order);
    const waChatButton = waChatUrl ? `
        <a class="admin-primary" style="display:inline-flex; align-items:center; justify-content:center; text-decoration:none; gap:6px; height:36px; padding:0 14px; width:auto; margin-top:10px;" href="${waChatUrl}" target="_blank" rel="noopener">
            💬 Abrir chat WhatsApp con cliente
        </a>
    ` : '';

    const isYapeOrder = order.PaymentMethod === 'Yape';
    const reviewControls = isYapeOrder ? `
        <section class="admin-review-box">
            <h3>Revisión del pedido</h3>
            <div class="review-form-grid">
                <label>Estado del pago
                    <select id="reviewPaymentStatus">
                        <option value="pending_manual_review">Por verificar</option>
                        <option value="approved">Pago confirmado</option>
                        <option value="rejected">No recibido / rechazado</option>
                    </select>
                </label>
                <label>Entrega
                    <select id="reviewFulfillmentStatus">
                        <option value="pending">Pendiente</option>
                        <option value="delivered">Entregado</option>
                    </select>
                </label>
            </div>
            <p class="admin-review-note">Confirma el dinero en la app de Yape; una captura por sí sola no prueba el abono.</p>
            <p class="admin-error" id="reviewError" role="alert"></p>
            <button class="admin-primary review-save-button" id="saveOrderReview" type="button">Guardar revisión</button>
        </section>
    ` : '<p class="admin-muted">Este pedido pertenece al flujo anterior de MercadoPago.</p>';

    document.getElementById('dialogContent').innerHTML = `
        <div class="dialog-meta-grid">
            <div><span>Cliente ID</span><strong>${escapeHTML(order.CustomerId || 'Histórico')} <small style="color:var(--admin-cyan);">(${customerBadge})</small></strong></div>
            <div><span>Cliente</span><strong>${escapeHTML([order.PayerName, order.PayerLastName].filter(Boolean).join(' ') || 'Sin nombre')}</strong></div>
            <div><span>Correo</span><strong>${escapeHTML(order.PayerEmail || 'Sin correo')}</strong></div>
            <div><span>Teléfono</span><strong>${escapeHTML(order.PayerPhone || 'No indicado')}</strong></div>
            <div><span>Medio de pago</span><strong>${escapeHTML(order.PaymentMethod || 'MercadoPago')}</strong></div>
            <div><span>Estado del pago</span><strong><span class="status-badge status-${escapeHTML(order.Status)}">${escapeHTML(statusLabel(order.Status))}</span></strong></div>
            <div><span>Entrega</span><strong>${escapeHTML(order.FulfillmentStatus === 'delivered' ? 'Entregado' : 'Pendiente')}</strong></div>
            <div><span>Referencia</span><strong>${escapeHTML(order.ExternalReference)}</strong></div>
            <div><span>WhatsApp</span><strong>${escapeHTML(order.PayerPhone || 'No indicado')}</strong></div>
        </div>
        ${waChatButton}
        <section class="admin-proof-box">
            <div class="proof-heading"><h3>Comprobante Yape</h3><button class="admin-secondary" id="loadOrderProof" type="button">Ver comprobante</button></div>
            <p class="admin-error" id="proofError" role="status"></p>
            <img id="orderProofImage" class="order-proof-image" alt="Comprobante adjuntado por el cliente" hidden>
        </section>
        <h3 class="dialog-items-title">Artículos</h3>
        ${itemRows}
        <div class="dialog-total"><span>Total</span><strong>${formatCurrency(order.Total)}</strong></div>
        ${reviewControls}
    `;

    document.getElementById('loadOrderProof').addEventListener('click', () => loadOrderProof(orderId));
    const reviewButton = document.getElementById('saveOrderReview');
    if (reviewButton) {
        document.getElementById('reviewPaymentStatus').value = order.Status === 'pending' ? 'pending_manual_review' : order.Status;
        document.getElementById('reviewFulfillmentStatus').value = order.FulfillmentStatus || 'pending';
        reviewButton.addEventListener('click', () => saveOrderReview(orderId));
    }
    document.getElementById('orderDialog').showModal();
}

async function loadOrderProof(orderId) {
    const errorElement = document.getElementById('proofError');
    const imageElement = document.getElementById('orderProofImage');
    errorElement.textContent = '';
    try {
        const response = await fetch(`/api/orders/${orderId}/proof`, {
            headers: { 'x-admin-key': adminKey },
            cache: 'no-store'
        });
        if (response.status === 404) throw new Error('Este pedido no tiene un comprobante adjunto.');
        if (!response.ok) throw new Error('No se pudo cargar el comprobante.');
        const imageBlob = await response.blob();
        if (proofObjectUrl) URL.revokeObjectURL(proofObjectUrl);
        proofObjectUrl = URL.createObjectURL(imageBlob);
        imageElement.src = proofObjectUrl;
        imageElement.hidden = false;
    } catch (error) {
        errorElement.textContent = error.message;
    }
}

async function saveOrderReview(orderId) {
    const errorElement = document.getElementById('reviewError');
    errorElement.textContent = '';
    try {
        const response = await fetch(`/api/orders/${orderId}/review`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json', 'x-admin-key': adminKey },
            body: JSON.stringify({
                paymentStatus: document.getElementById('reviewPaymentStatus').value,
                fulfillmentStatus: document.getElementById('reviewFulfillmentStatus').value
            })
        });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || 'No se pudo actualizar el pedido.');
        await loadOrders();
        showOrderDetail(orderId);
    } catch (error) {
        errorElement.textContent = error.message;
    }
}

document.getElementById('adminLoginForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    adminKey = document.getElementById('adminKey').value;
    showLoginError('');
    const authorized = await loadOrders();
    if (authorized) document.getElementById('adminKey').value = '';
});

document.getElementById('orderSearch').addEventListener('input', renderOrders);
document.getElementById('statusFilter').addEventListener('change', renderOrders);
document.getElementById('archiveFilter').addEventListener('change', loadOrders);
document.getElementById('refreshOrders').addEventListener('click', loadOrders);
const exportCsvBtn = document.getElementById('exportOrdersCsv');
if (exportCsvBtn) exportCsvBtn.addEventListener('click', exportOrdersToCSV);
document.getElementById('logoutAdmin').addEventListener('click', () => {
    adminKey = '';
    orders = [];
    document.getElementById('adminDashboard').hidden = true;
    document.getElementById('adminLogin').hidden = false;
    document.getElementById('adminKey').value = '';
    showLoginError('');
    setConnectionState('Sesión cerrada');
});
document.getElementById('dialogClose').addEventListener('click', () => document.getElementById('orderDialog').close());
document.getElementById('orderDialog').addEventListener('click', (event) => {
    if (event.target === event.currentTarget) event.currentTarget.close();
});
document.getElementById('orderDialog').addEventListener('close', () => {
    if (proofObjectUrl) URL.revokeObjectURL(proofObjectUrl);
    proofObjectUrl = '';
});

setupAdminTabs();
document.getElementById('addProductButton').addEventListener('click', () => openProductEditor());
document.getElementById('productForm').addEventListener('submit', saveProduct);
document.getElementById('closeProductDialog').addEventListener('click', () => document.getElementById('productDialog').close());
document.getElementById('cancelProductDialog').addEventListener('click', () => document.getElementById('productDialog').close());
document.getElementById('productDialog').addEventListener('close', releaseProductPreview);
document.getElementById('productSearch').addEventListener('input', renderProducts);
document.getElementById('productVisibility').addEventListener('change', renderProducts);
document.getElementById('productImage').addEventListener('change', (event) => {
    const file = event.target.files[0];
    const preview = document.getElementById('productImagePreview');
    if (!file) return;
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || file.size > 5 * 1024 * 1024) {
        event.target.value = '';
        document.getElementById('productFormError').textContent = 'La imagen debe ser PNG, JPG o WebP y no superar 5 MB.';
        return;
    }
    document.getElementById('productFormError').textContent = '';
    releaseProductPreview();
    productPreviewUrl = URL.createObjectURL(file);
    preview.src = productPreviewUrl;
    preview.hidden = false;
});
