/* Lógica compartida del carrito lateral (drawer), usada por index.html, checkout no la necesita pero producto.html sí */

const CartUI = (() => {
    let products = [];

    function setProducts(list) {
        products = list;
    }

    function render() {
        const cart = CartStore.getCart();
        const itemsEl = document.getElementById('cartItems');
        const totalEl = document.getElementById('cartTotal');
        const countEl = document.getElementById('cartCount');
        const checkoutBtn = document.getElementById('checkoutBtn');
        if (!itemsEl || !totalEl || !countEl || !checkoutBtn) return;

        checkoutBtn.textContent = 'Pedir por WhatsApp';

        const entries = Object.entries(cart)
            .map(([id, qty]) => ({ product: products.find((p) => p.id === id), qty }))
            .filter((entry) => entry.product);

        countEl.textContent = entries.reduce((sum, e) => sum + e.qty, 0);

        if (entries.length === 0) {
            itemsEl.innerHTML = '<p class="cart-empty">Tu carrito está vacío.</p>';
            totalEl.textContent = formatPEN(0);
            checkoutBtn.setAttribute('aria-disabled', 'true');
            return;
        }

        checkoutBtn.removeAttribute('aria-disabled');

        let total = 0;
        itemsEl.innerHTML = entries.map(({ product, qty }) => {
            total += product.price * qty;
            return `
                <div class="cart-item" data-id="${product.id}">
                    <div class="cart-item-thumb" style="--glow:${product.color};">
                        <img src="${product.logo}" alt="${product.title}">
                    </div>
                    <div class="cart-item-info">
                        <div class="cart-item-title">${product.title}</div>
                        <div class="cart-item-price">${formatPEN(product.price)} c/u</div>
                        <div class="cart-item-controls">
                            <button type="button" class="qty-btn" data-action="dec" data-id="${product.id}">−</button>
                            <span>${qty}</span>
                            <button type="button" class="qty-btn" data-action="inc" data-id="${product.id}">+</button>
                            <button type="button" class="remove-item" data-id="${product.id}">Eliminar</button>
                        </div>
                    </div>
                </div>
            `;
        }).join('');

        totalEl.textContent = formatPEN(total);

        itemsEl.querySelectorAll('.qty-btn').forEach((btn) => {
            btn.addEventListener('click', () => {
                const id = btn.dataset.id;
                const current = CartStore.getCart()[id] || 0;
                const next = btn.dataset.action === 'inc' ? current + 1 : current - 1;
                CartStore.setQuantity(id, next);
                render();
            });
        });

        itemsEl.querySelectorAll('.remove-item').forEach((btn) => {
            btn.addEventListener('click', () => {
                CartStore.removeItem(btn.dataset.id);
                render();
            });
        });
    }

    function openDrawer() {
        const toggle = document.getElementById('cartToggle');
        const drawer = document.getElementById('cartDrawer');
        const overlay = document.getElementById('cartOverlay');
        if (!drawer || !overlay) return;
        drawer.classList.add('open');
        overlay.classList.add('open');
        if (toggle) toggle.setAttribute('aria-expanded', 'true');
    }

    function closeDrawer() {
        const toggle = document.getElementById('cartToggle');
        const drawer = document.getElementById('cartDrawer');
        const overlay = document.getElementById('cartOverlay');
        if (!drawer || !overlay) return;
        drawer.classList.remove('open');
        overlay.classList.remove('open');
        if (toggle) toggle.setAttribute('aria-expanded', 'false');
    }

    function setupDrawer() {
        const toggle = document.getElementById('cartToggle');
        const overlay = document.getElementById('cartOverlay');
        const close = document.getElementById('cartClose');
        if (!toggle || !overlay || !close) return;

        toggle.addEventListener('click', openDrawer);
        close.addEventListener('click', closeDrawer);
        overlay.addEventListener('click', closeDrawer);
    }

    function showToast(product) {
        const container = document.getElementById('toastContainer');
        if (!container || !product) return;

        const toast = document.createElement('div');
        toast.className = 'toast';
        toast.innerHTML = `
            <img class="toast-thumb" src="${product.logo}" alt="${product.title}">
            <div class="toast-content">
                <strong>¡Agregado al carrito!</strong>
                <span>${product.title}</span>
            </div>
            <button type="button" class="toast-action">Ver carrito</button>
        `;

        toast.querySelector('.toast-action').addEventListener('click', () => {
            openDrawer();
            toast.remove();
        });

        container.appendChild(toast);

        setTimeout(() => {
            toast.classList.add('toast-out');
            setTimeout(() => toast.remove(), 250);
        }, 3200);
    }

    return { setProducts, render, setupDrawer, openDrawer, closeDrawer, showToast };
})();
