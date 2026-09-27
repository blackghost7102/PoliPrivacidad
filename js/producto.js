/* Renderiza la página de detalle de un producto (producto.html?id=...) */

const CATEGORY_LABELS = {
    software: 'Software y licencias',
    suscripciones: 'Suscripciones',
    juegos: 'Videojuegos'
};

const CATEGORY_DESCRIPTIONS = {
    software: 'Clave digital original para activar tu producto. Recibirás el código y las instrucciones de activación en tu correo electrónico apenas se confirme el pago.',
    suscripciones: 'Acceso digital a la plataforma mediante cuenta o clave de activación, según el proveedor. La entrega es inmediata tras la confirmación del pago.',
    juegos: 'Clave o cuenta para disfrutar el juego en la plataforma indicada. Verifica la región y los requisitos antes de comprar.'
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

function bindAddToCartButtons(onAdd) {
    document.querySelectorAll('.add-to-cart').forEach((btn) => {
        btn.addEventListener('click', () => {
            CartStore.addItem(btn.dataset.id, 1);
            btn.textContent = 'Añadido ✓';
            btn.classList.add('added');
            setTimeout(() => {
                btn.textContent = 'Añadir';
                btn.classList.remove('added');
            }, 1200);
            CartUI.render();
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
                    <span class="badge"><img src="Imagenes/Iconos/verificado-icon.png" alt="">Entrega inmediata</span>
                </div>
                <h1>${product.title}</h1>
                <p class="product-detail-price">${formatPEN(product.price)}</p>
                <p class="product-detail-description">${CATEGORY_DESCRIPTIONS[product.category] || ''}</p>
                <div class="product-detail-actions">
                    <button type="button" class="add-to-cart" data-id="${product.id}">Añadir al carrito</button>
                    <a href="checkout.html" class="checkout-btn" id="buyNowBtn">Comprar ahora</a>
                </div>
                <p class="pay-provider-note">🔒 Pago procesado de forma segura por MercadoPago. DigitalRO no almacena datos de tarjetas.</p>
            </div>
        </div>
    `;

    bindAddToCartButtons();

    document.getElementById('buyNowBtn').addEventListener('click', () => {
        CartStore.addItem(product.id, 1);
    });

    const related = allProducts.filter((p) => p.category === product.category && p.id !== product.id).slice(0, 4);
    document.getElementById('relatedGrid').innerHTML = related.map(relatedCardHTML).join('');
    bindAddToCartButtons();
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
