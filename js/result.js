/* Lee los parámetros que MercadoPago añade a la URL de retorno (success/failure/pending) */

document.addEventListener('DOMContentLoaded', () => {
    const params = new URLSearchParams(window.location.search);
    const statusEl = document.getElementById('paymentStatus');
    const status = params.get('status') || params.get('collection_status');

    if (statusEl && status) {
        statusEl.textContent = `Estado de MercadoPago: ${status}`;
    }

    if (document.body.dataset.result === 'success') {
        CartStore.clear();
    }
});
