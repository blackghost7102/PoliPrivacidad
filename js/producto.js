/* Renderiza la página de detalle de un producto (producto.html?id=...) */

const CATEGORY_LABELS = {
    software: 'Software y licencias',
    suscripciones: 'Suscripciones',
    juegos: 'Videojuegos'
};

const CATEGORY_DESCRIPTIONS = {
    software: 'Clave digital para activar el producto. El pago se coordina por Yape y la entrega se confirma contigo por WhatsApp.',
    suscripciones: 'Acceso digital a la plataforma mediante cuenta o clave, según el producto. El pago y la entrega se coordinan por WhatsApp.',
    juegos: 'Clave o cuenta para la plataforma indicada. Revisa los detalles y coordina el pago por Yape y la entrega por WhatsApp.'
};

function typeIconFor(product) {
    return product.type === 'Cuenta' ? 'Imagenes/Iconos/cajita-icon.png' : 'Imagenes/Iconos/llave-icon.png';
}

function relatedCardHTML(product) {
    return `
        <article class="product-card" data-id="${product.id}">
            <a class="product-link" href="producto.html?id=${encodeURIComponent(product.id)}">
                <div class="product-thumb" style="--glow:${product.color};">
                    <img src="${product.logo}" alt="${product.title}" loading="lazy">
                </div>
            </a>
            <div class="product-body">
                <div class="product-badges">
                    <span class="badge">${product.platform}</span>
                    <span class="badge">${product.type}</span>
                </div>
                <h3 class="product-title">
                    <a class="product-link" href="producto.html?id=${encodeURIComponent(product.id)}">${product.title}</a>
                </h3>
                <div class="product-footer">
                    <span class="product-price">${formatPEN(product.price)}</span>
                    <button type="button" class="add-to-cart" data-id="${product.id}">Añadir</button>
                </div>
            </div>
        </article>
    `;
}

function renderNotFound() {
    document.getElementById('productDetail').innerHTML = `
        <div class="result-card">
            <div class="result-icon">🔍</div>
            <h1>Producto no encontrado</h1>
            <p>Puede que el enlace sea incorrecto o el producto ya no esté disponible.</p>
            <a href="index.html">Volver a la tienda</a>
        </div>
    `;
}

function bindAddToCartButtons(allProducts, onAdd) {
    document.querySelectorAll('.add-to-cart').forEach((btn) => {
        if (btn.dataset.cartBound === 'true') return;
        btn.dataset.cartBound = 'true';
        btn.addEventListener('click', () => {
            const product = allProducts ? allProducts.find((p) => p.id === btn.dataset.id) : null;
            CartStore.addItem(btn.dataset.id, 1);
            btn.textContent = 'Añadido ✓';
            btn.classList.add('added');
            setTimeout(() => {
                btn.textContent = 'Añadir al carrito';
                btn.classList.remove('added');
            }, 1200);
            CartUI.render();
            if (product) CartUI.showToast(product);
            if (onAdd) onAdd();
        });
    });
}

function renderProduct(product, allProducts) {
    document.title = `${product.title} | DigitalRO`;

    document.getElementById('breadcrumb').innerHTML = `
        <a href="index.html">Inicio</a> /
        <a href="index.html#${product.category}">${CATEGORY_LABELS[product.category] || product.category}</a> /
        <span>${product.title}</span>
    `;

    document.getElementById('productDetail').innerHTML = `
        <div class="product-detail-grid">
            <div class="product-detail-image" style="--glow:${product.color};">
                <img src="${product.logo}" alt="${product.title}">
            </div>
            <div class="product-detail-info">
                <div class="product-badges">
                    ${product.platform === 'Windows' ? `<span class="badge"><img src="Imagenes/Iconos/windows-icon.png" alt="">${product.platform}</span>` : `<span class="badge">${product.platform}</span>`}
                    <span class="badge"><img src="${typeIconFor(product)}" alt="">${product.type}</span>
                    <span class="badge"><img src="Imagenes/Iconos/verificado-icon.png" alt="">Entrega por WhatsApp</span>
                </div>
                <h1>${product.title}</h1>
                <p class="product-detail-price">${formatPEN(product.price)}</p>
                <p class="product-detail-description">${CATEGORY_DESCRIPTIONS[product.category] || ''}</p>
                <div class="product-detail-actions">
                    <button type="button" class="add-to-cart" data-id="${product.id}">Añadir al carrito</button>
                    <a href="checkout.html" class="checkout-btn" id="buyNowBtn">Pedir por WhatsApp</a>
                </div>
                <p class="pay-provider-note">Pago mediante QR de Yape. La entrega se coordina cuando verifiquemos el abono.</p>
            </div>
        </div>
    `;

    bindAddToCartButtons(allProducts);

    document.getElementById('buyNowBtn').addEventListener('click', () => {
        CartStore.addItem(product.id, 1);
    });

    const related = allProducts.filter((p) => p.category === product.category && p.id !== product.id).slice(0, 4);
    document.getElementById('relatedGrid').innerHTML = related.map(relatedCardHTML).join('');
    bindAddToCartButtons(allProducts);
}

document.addEventListener('DOMContentLoaded', async () => {
    const params = new URLSearchParams(window.location.search);
    const id = params.get('id');
    const products = await fetchProducts();
    CartUI.setProducts(products);
    CartUI.render();
    CartUI.setupDrawer();

    const product = products.find((p) => p.id === id);
    if (!product) {
        renderNotFound();
        return;
    }
    renderProduct(product, products);
});
