function renderPaymentResult({ icon, title, message, status }) {
    document.querySelector('.result-icon').textContent = icon;
    document.querySelector('.result-card h1').textContent = title;
    document.querySelector('.result-card > p').textContent = message;
    document.getElementById('paymentStatus').textContent = status;
    document.title = `${title} | DigitalRO`;
}

async function verifyReturnedPayment() {
    const params = new URLSearchParams(window.location.search);
    const paymentId = params.get('payment_id') || params.get('collection_id');

    if (!paymentId || !/^\d{1,30}$/.test(paymentId)) {
        renderPaymentResult({
            icon: '⏳',
            title: 'Pago sin confirmar',
            message: 'No recibimos un identificador de pago verificable. Tu carrito se conserva; revisa el estado en MercadoPago antes de volver a intentar.',
            status: 'No se confirmó ningún estado de pago.'
        });
        return;
    }

    renderPaymentResult({
        icon: '⏳',
        title: 'Verificando pago…',
        message: 'Estamos consultando el estado directamente con MercadoPago.',
        status: 'La comprobación puede tardar unos segundos.'
    });

    try {
        const response = await fetch(`/api/payment-status?payment_id=${encodeURIComponent(paymentId)}`, {
            cache: 'no-store'
        });
        const result = await response.json();

        if (!response.ok) {
            throw new Error(result.error || 'No se pudo verificar el pago.');
        }

        if (result.status === 'approved') {
            CartStore.clear();
            renderPaymentResult({
                icon: '✅',
                title: '¡Pago aprobado!',
                message: 'MercadoPago confirmó el pago. En esta demostración no se entregan claves reales.',
                status: `Pago confirmado por ${new Intl.NumberFormat('es-PE', { style: 'currency', currency: 'PEN' }).format(result.total)}.`
            });
            return;
        }

        if (result.status === 'pending' || result.status === 'in_process' || result.status === 'authorized') {
            renderPaymentResult({
                icon: '⏳',
                title: 'Pago pendiente',
                message: 'MercadoPago aún está procesando la operación. El carrito se conserva y el estado puede actualizarse cuando se acredite.',
                status: `Estado verificado: ${result.status}.`
            });
            return;
        }

        renderPaymentResult({
            icon: '❌',
            title: 'Pago no aprobado',
            message: 'MercadoPago no confirmó el pago. Tu carrito se conserva para que puedas revisarlo antes de intentar otra vez.',
            status: `Estado verificado: ${result.status}.`
        });
    } catch (error) {
        renderPaymentResult({
            icon: '⚠️',
            title: 'No pudimos verificar el pago',
            message: 'El servidor no pudo confirmar el resultado con MercadoPago. Tu carrito se conserva; revisa tu cuenta antes de hacer otro intento para evitar un cobro duplicado.',
            status: 'La confirmación no está disponible en este momento.'
        });
    }
}

document.addEventListener('DOMContentLoaded', verifyReturnedPayment);
