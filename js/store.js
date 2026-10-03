/* Renderiza el catálogo de productos y controla el carrito lateral en index.html */

let PRODUCTS = [];
const CATEGORIES = ['software', 'suscripciones', 'juegos'];
const activeFilters = { software: 'Todos', suscripciones: 'Todos', juegos: 'Todos' };
let searchTerm = '';

const ICONS = {
    windows: 'Imagenes/Iconos/windows-icon.png',
    key: 'Imagenes/Iconos/llave-icon.png',
    account: 'Imagenes/Iconos/cajita-icon.png',
    verified: 'Imagenes/Iconos/verificado-icon.png'
};

function typeIcon(product) {
    return product.type === 'Cuenta' ? ICONS.account : ICONS.key;
}

function skeletonCardHTML() {
    return `
        <div class="product-card skeleton-card">
            <div class="skeleton-block skeleton-thumb"></div>
            <div class="product-body">
                <div class="skeleton-block skeleton-line" style="width:60%"></div>
                <div class="skeleton-block skeleton-line" style="width:90%"></div>
                <div class="skeleton-block skeleton-line" style="width:40%"></div>
            </div>
        </div>
    `;
}

function renderSkeletons() {
    CATEGORIES.forEach((category) => {
        const grid = document.getElementById(`grid-${category}`);
        if (grid) grid.innerHTML = Array(4).fill(skeletonCardHTML()).join('');
    });
}

function productCardHTML(product) {
    return `
        <article class="product-card" data-id="${product.id}">
            <a class="product-link" href="producto.html?id=${encodeURIComponent(product.id)}">
                <div class="product-thumb" style="--glow:${product.color};">
                    <img src="${product.logo}" alt="${product.title}" loading="lazy">
                </div>
            </a>
            <div class="product-body">
                <div class="product-badges">
                    ${product.platform === 'Windows' ? `<span class="badge"><img src="${ICONS.windows}" alt="">${product.platform}</span>` : `<span class="badge">${product.platform}</span>`}
                    <span class="badge"><img src="${typeIcon(product)}" alt="">${product.type}</span>
                    <span class="badge"><img src="${ICONS.verified}" alt="">Entrega por WhatsApp</span>
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

function platformsInCategory(category) {
    const platforms = PRODUCTS
        .filter((p) => p.category === category)
        .map((p) => p.platform);
    return ['Todos', ...new Set(platforms)];
}

function renderFilterPills() {
    CATEGORIES.forEach((category) => {
        const container = document.getElementById(`filters-${category}`);
        if (!container) return;
        const platforms = platformsInCategory(category);
        if (platforms.length <= 2) {
            container.innerHTML = '';
            return;
        }
        container.innerHTML = platforms.map((platform) => `
            <button type="button" class="filter-pill ${activeFilters[category] === platform ? 'active' : ''}" data-category="${category}" data-platform="${platform}">${platform}</button>
        `).join('');
    });

    document.querySelectorAll('.filter-pill').forEach((btn) => {
        btn.addEventListener('click', () => {
            activeFilters[btn.dataset.category] = btn.dataset.platform;
            renderFilterPills();
            renderCatalog();
        });
    });
}

function renderCatalog() {
    let totalMatches = 0;

    CATEGORIES.forEach((category) => {
        const grid = document.getElementById(`grid-${category}`);
        if (!grid) return;

        const items = PRODUCTS.filter((p) => {
            if (p.category !== category) return false;
            if (activeFilters[category] !== 'Todos' && p.platform !== activeFilters[category]) return false;
            if (searchTerm && !p.title.toLowerCase().includes(searchTerm)) return false;
            return true;
        });

        totalMatches += items.length;

        const section = document.getElementById(category);
        if (section) section.hidden = Boolean(searchTerm) && items.length === 0;

        grid.innerHTML = items.length
            ? items.map(productCardHTML).join('')
            : '<p class="cart-empty">No hay productos que coincidan con tu búsqueda.</p>';
    });

    const infoEl = document.getElementById('searchResultsInfo');
    if (infoEl) {
        if (searchTerm) {
            infoEl.hidden = false;
            infoEl.textContent = `${totalMatches} resultado(s) para "${searchTerm}"`;
        } else {
            infoEl.hidden = true;
        }
    }

    document.querySelectorAll('.add-to-cart').forEach((btn) => {
        btn.addEventListener('click', () => {
            const product = PRODUCTS.find((p) => p.id === btn.dataset.id);
            CartStore.addItem(btn.dataset.id, 1);
            btn.textContent = 'Añadido ✓';
            btn.classList.add('added');
            setTimeout(() => {
                btn.textContent = 'Añadir';
                btn.classList.remove('added');
            }, 1200);
            CartUI.render();
            if (product) CartUI.showToast(product);
        });
    });
}

function setupFAQ() {
    document.querySelectorAll('.faq-question').forEach((button) => {
        button.addEventListener('click', () => {
            const item = button.closest('.faq-item');
            const isActive = item.classList.contains('active');
            document.querySelectorAll('.faq-item').forEach((other) => other.classList.remove('active'));
            if (!isActive) item.classList.add('active');
        });
    });
}

function setupSearch() {
    const input = document.getElementById('searchInput');
    if (!input) return;
    input.addEventListener('input', () => {
        searchTerm = input.value.trim().toLowerCase();
        renderCatalog();
    });
}

function setupMobileNav() {
    const toggle = document.getElementById('navToggle');
    const nav = document.getElementById('mainNav');
    if (!toggle || !nav) return;

    toggle.addEventListener('click', () => {
        const isOpen = nav.classList.toggle('open');
        toggle.classList.toggle('open', isOpen);
        toggle.setAttribute('aria-expanded', String(isOpen));
    });

    nav.querySelectorAll('a').forEach((link) => {
        link.addEventListener('click', () => {
            nav.classList.remove('open');
            toggle.classList.remove('open');
            toggle.setAttribute('aria-expanded', 'false');
        });
    });
}

document.addEventListener('DOMContentLoaded', async () => {
    renderSkeletons();
    PRODUCTS = await fetchProducts();
    CartUI.setProducts(PRODUCTS);
    renderFilterPills();
    renderCatalog();
    CartUI.render();
    CartUI.setupDrawer();
    setupSearch();
    setupMobileNav();
    setupFAQ();
});
