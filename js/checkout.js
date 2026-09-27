/* Resumen de pedido y creación de la preferencia de pago (MercadoPago) en checkout.html */

let PRODUCTS = [];

function getCartEntries() {
    const cart = CartStore.getCart();
    return Object.entries(cart)
        .map(([id, qty]) => ({ product: PRODUCTS.find((p) => p.id === id), qty }))
        .filter((entry) => entry.product);
}

function renderSummary() {
    const entries = getCartEntries();
    const itemsEl = document.getElementById('summaryItems');
    const totalEl = document.getElementById('summaryTotal');
    const payBtn = document.getElementById('payBtn');

    if (entries.length === 0) {
        itemsEl.innerHTML = '<p class="cart-empty">Tu carrito está vacío. <a href="index.html">Vuelve a la tienda</a>.</p>';
        totalEl.textContent = formatPEN(0);
        payBtn.disabled = true;
        return;
    }

    let total = 0;
    itemsEl.innerHTML = entries.map(({ product, qty }) => {
        const lineTotal = product.price * qty;
        total += lineTotal;
        return `
            <div class="summary-item">
                <span>${product.title} × ${qty}</span>
                <span>${formatPEN(lineTotal)}</span>
            </div>
        `;
    }).join('');

    totalEl.textContent = formatPEN(total);
}

function showError(message) {
    const errorEl = document.getElementById('formError');
    errorEl.textContent = message;
    errorEl.classList.add('visible');
}

function hideError() {
    const errorEl = document.getElementById('formError');
    errorEl.classList.remove('visible');
}

async function handleSubmit(event) {
    event.preventDefault();
    hideError();

    const entries = getCartEntries();
    if (entries.length === 0) {
        showError('Tu carrito está vacío.');
        return;
    }

    const payBtn = document.getElementById('payBtn');
    payBtn.disabled = true;
    payBtn.textContent = 'Redirigiendo a MercadoPago...';

    const payload = {
        items: entries.map(({ product, qty }) => ({ id: product.id, quantity: qty })),
        payer: {
            name: document.getElementById('firstName').value.trim(),
            lastName: document.getElementById('lastName').value.trim(),
            email: document.getElementById('email').value.trim(),
            phone: document.getElementById('phone').value.trim()
        }
    };

    try {
        const res = await fetch('/api/create-preference', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        const data = await res.json();

        if (!res.ok || !data.init_point) {
            throw new Error(data.error || 'No se pudo iniciar el pago.');
        }

        window.location.href = data.init_point;
    } catch (err) {
        showError('No se pudo conectar con el servidor de pagos. Verifica que el backend esté en ejecución y vuelve a intentarlo.');
        payBtn.disabled = false;
        payBtn.textContent = 'Continuar con el pago';
    }
}

document.addEventListener('DOMContentLoaded', async () => {
    PRODUCTS = await fetchProducts();
    renderSummary();
    document.getElementById('checkoutForm').addEventListener('submit', handleSubmit);
});
