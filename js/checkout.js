/* Registra el pedido Yape en el backend y luego abre el chat de WhatsApp con su resumen. */

let PRODUCTS = [];

function cartEntries() {
    const cart = CartStore.getCart();
    return Object.entries(cart)
        .map(([id, quantity]) => ({ product: PRODUCTS.find((item) => item.id === id), quantity }))
        .filter((entry) => entry.product && Number.isInteger(entry.quantity) && entry.quantity > 0);
}

function renderSummary() {
    const entries = cartEntries();
    const itemsElement = document.getElementById('summaryItems');
    const totalElement = document.getElementById('summaryTotal');
    const submitButton = document.getElementById('payBtn');

    itemsElement.replaceChildren();
    if (entries.length === 0) {
        const emptyMessage = document.createElement('p');
        emptyMessage.className = 'cart-empty';
        emptyMessage.textContent = 'Tu carrito está vacío. Vuelve a la tienda para elegir productos.';
        itemsElement.append(emptyMessage);
        totalElement.textContent = formatPEN(0);
        submitButton.disabled = true;
        return;
    }

    const total = entries.reduce((sum, entry) => sum + Number(entry.product.price) * entry.quantity, 0);
    entries.forEach(({ product, quantity }) => {
        const row = document.createElement('div');
        row.className = 'summary-item';
        const description = document.createElement('span');
        description.textContent = `${product.title} × ${quantity}`;
        const price = document.createElement('span');
        price.textContent = formatPEN(Number(product.price) * quantity);
        row.append(description, price);
        itemsElement.append(row);
    });

    totalElement.textContent = formatPEN(total);
}

function showError(message) {
    const errorElement = document.getElementById('formError');
    errorElement.textContent = message;
    errorElement.classList.add('visible');
}

function hideError() {
    document.getElementById('formError').classList.remove('visible');
}

function setupProofPreview() {
    const input = document.getElementById('proof');
    const preview = document.getElementById('proofPreview');
    input.addEventListener('change', () => {
        const file = input.files[0];
        preview.hidden = true;
        preview.removeAttribute('src');
        if (!file) return;

        const allowedTypes = ['image/png', 'image/jpeg', 'image/webp'];
        if (!allowedTypes.includes(file.type) || file.size > 5 * 1024 * 1024) {
            input.value = '';
            showError('El comprobante debe ser PNG, JPG o WebP y no superar 5 MB.');
            return;
        }

        hideError();
        preview.src = URL.createObjectURL(file);
        preview.hidden = false;
    });
}

async function submitOrder(event) {
    event.preventDefault();
    hideError();

    const entries = cartEntries();
    if (entries.length === 0) {
        showError('Agrega al menos un producto antes de registrar el pedido.');
        return;
    }

    const form = document.getElementById('checkoutForm');
    const submitButton = document.getElementById('payBtn');
    submitButton.disabled = true;
    submitButton.textContent = 'Registrando pedido…';

    const payload = new FormData();
    payload.append('fullName', document.getElementById('fullName').value.trim());
    payload.append('email', document.getElementById('email').value.trim());
    payload.append('whatsapp', document.getElementById('whatsapp').value.trim());
    payload.append('privacyConsent', String(document.getElementById('privacyConsent').checked));
    payload.append('items', JSON.stringify(entries.map(({ product, quantity }) => ({ id: product.id, quantity }))));
    const proof = document.getElementById('proof').files[0];
    if (proof) payload.append('proof', proof, proof.name);

    try {
        const response = await fetch('/api/whatsapp-orders', { method: 'POST', body: payload });
        const result = await response.json();
        if (!response.ok || !result.whatsappUrl) {
            throw new Error(result.error || 'No se pudo registrar el pedido.');
        }

        CartStore.clear();
        submitButton.textContent = `Pedido #${result.orderId} registrado`;
        submitButton.classList.add('order-submitted');
        const confirmation = document.getElementById('orderConfirmation');
        confirmation.textContent = `Pedido #${result.orderId} guardado. Se abrirá WhatsApp para que envíes el mensaje y la captura del comprobante.`;
        confirmation.hidden = false;
        form.reset();
        window.location.assign(result.whatsappUrl);
    } catch (error) {
        showError(error.message || 'No se pudo conectar con el servidor. Inténtalo de nuevo.');
        submitButton.disabled = false;
        submitButton.textContent = 'Registrar pedido y abrir WhatsApp';
    }
}

document.addEventListener('DOMContentLoaded', async () => {
    PRODUCTS = await fetchProducts();
    renderSummary();
    setupProofPreview();
    document.getElementById('checkoutForm').addEventListener('submit', submitOrder);
});
