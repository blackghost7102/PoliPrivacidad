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

    function setupDrawer() {
        const toggle = document.getElementById('cartToggle');
        const drawer = document.getElementById('cartDrawer');
        const overlay = document.getElementById('cartOverlay');
        const close = document.getElementById('cartClose');
        if (!toggle || !drawer || !overlay || !close) return;

        const open = () => {
            drawer.classList.add('open');
            overlay.classList.add('open');
            toggle.setAttribute('aria-expanded', 'true');
        };
        const closeDrawer = () => {
            drawer.classList.remove('open');
            overlay.classList.remove('open');
            toggle.setAttribute('aria-expanded', 'false');
        };

        toggle.addEventListener('click', open);
        close.addEventListener('click', closeDrawer);
        overlay.addEventListener('click', closeDrawer);
    }

    return { setProducts, render, setupDrawer };
})();
