/* Servidor de DigitalRO: sirve la tienda estática y crea preferencias de pago con MercadoPago. */

require('dotenv').config();

const path = require('path');
const fs = require('fs');
const express = require('express');
const { MercadoPagoConfig, Preference, Payment } = require('mercadopago');
const { getPool, sql } = require('./db');

const ROOT_DIR = path.join(__dirname, '..');
const PRODUCTS_PATH = path.join(ROOT_DIR, 'data', 'products.json');
const PORT = process.env.PORT || 3000;
const ACCESS_TOKEN = process.env.MP_ACCESS_TOKEN;

if (!ACCESS_TOKEN) {
    console.warn('[DigitalRO] Falta MP_ACCESS_TOKEN en server/.env — copia .env.example y coloca tus credenciales.');
}

const mpClient = new MercadoPagoConfig({ accessToken: ACCESS_TOKEN || 'TEST-INVALID' });

function loadProductsFromFile() {
    const raw = fs.readFileSync(PRODUCTS_PATH, 'utf-8');
    return JSON.parse(raw);
}

async function loadProducts() {
    try {
        const pool = await getPool();
        const result = await pool.request().query('SELECT Id AS id, Category AS category, Title AS title, Platform AS platform, Type AS type, Price AS price, Logo AS logo, Color AS color FROM Products');
        if (result.recordset.length > 0) return result.recordset;
    } catch (err) {
        console.warn('[DigitalRO] No se pudo leer Products desde SQL Server, usando data/products.json:', err.message);
    }
    return loadProductsFromFile();
}

async function saveOrder({ externalReference, payer, total, preferenceId, items }) {
    const pool = await getPool();
    const orderResult = await pool.request()
        .input('externalReference', sql.NVarChar(100), externalReference)
        .input('payerName', sql.NVarChar(100), payer.name || null)
        .input('payerLastName', sql.NVarChar(100), payer.lastName || null)
        .input('payerEmail', sql.NVarChar(200), payer.email || null)
        .input('payerPhone', sql.NVarChar(30), payer.phone || null)
        .input('total', sql.Decimal(10, 2), total)
        .input('preferenceId', sql.NVarChar(100), preferenceId)
        .query(`
            INSERT INTO Orders (ExternalReference, PayerName, PayerLastName, PayerEmail, PayerPhone, Status, Total, PreferenceId)
            OUTPUT INSERTED.Id
            VALUES (@externalReference, @payerName, @payerLastName, @payerEmail, @payerPhone, 'pending', @total, @preferenceId);
        `);

    const orderId = orderResult.recordset[0].Id;

    for (const item of items) {
        await pool.request()
            .input('orderId', sql.Int, orderId)
            .input('productId', sql.NVarChar(60), item.id)
            .input('title', sql.NVarChar(200), item.title)
            .input('quantity', sql.Int, item.quantity)
            .input('unitPrice', sql.Decimal(10, 2), item.unit_price)
            .query(`
                INSERT INTO OrderItems (OrderId, ProductId, Title, Quantity, UnitPrice)
                VALUES (@orderId, @productId, @title, @quantity, @unitPrice);
            `);
    }

    return orderId;
}

async function updateOrderStatus({ externalReference, status, paymentId }) {
    const pool = await getPool();
    await pool.request()
        .input('externalReference', sql.NVarChar(100), externalReference)
        .input('status', sql.NVarChar(30), status)
        .input('paymentId', sql.NVarChar(100), paymentId || null)
        .query(`
            UPDATE Orders
            SET Status = @status, PaymentId = @paymentId, UpdatedAt = SYSUTCDATETIME()
            WHERE ExternalReference = @externalReference;
        `);
}

const app = express();
app.use(express.json());
app.use(express.static(ROOT_DIR));

app.get('/api/products', async (req, res) => {
    res.json(await loadProducts());
});

app.post('/api/create-preference', async (req, res) => {
    try {
        const { items, payer } = req.body || {};

        if (!Array.isArray(items) || items.length === 0) {
            return res.status(400).json({ error: 'El carrito está vacío.' });
        }

        const products = await loadProducts();
        // Los precios siempre se recalculan desde el catálogo del servidor: nunca se confía en el precio enviado por el cliente.
        const preferenceItems = items.map((entry) => {
            const product = products.find((p) => p.id === entry.id);
            const quantity = Number(entry.quantity);

            if (!product) {
                throw new Error(`Producto desconocido: ${entry.id}`);
            }
            if (!Number.isInteger(quantity) || quantity <= 0 || quantity > 20) {
                throw new Error(`Cantidad inválida para ${product.id}`);
            }

            return {
                id: product.id,
                title: product.title,
                quantity,
                unit_price: product.price,
                currency_id: 'PEN'
            };
        });

        const total = preferenceItems.reduce((sum, item) => sum + item.unit_price * item.quantity, 0);
        const externalReference = `digitalro-${Date.now()}`;

        const baseUrl = (process.env.BASE_URL || `${req.protocol}://${req.get('host')}`).replace(/\/$/, '');
        const isHttps = baseUrl.startsWith('https://');

        const preferenceBody = {
            items: preferenceItems,
            payer: {
                name: payer && payer.name ? String(payer.name) : undefined,
                surname: payer && payer.lastName ? String(payer.lastName) : undefined,
                email: payer && payer.email ? String(payer.email) : undefined,
                phone: payer && payer.phone ? { number: String(payer.phone) } : undefined
            },
            back_urls: {
                success: `${baseUrl}/success.html`,
                failure: `${baseUrl}/failure.html`,
                pending: `${baseUrl}/pending.html`
            },
            external_reference: externalReference
        };

        // auto_return solo funciona de forma confiable con back_urls https (producción o un túnel como ngrok).
        if (isHttps) {
            preferenceBody.auto_return = 'approved';
        }

        const preference = new Preference(mpClient);
        const result = await preference.create({ body: preferenceBody });

        try {
            await saveOrder({
                externalReference,
                payer: payer || {},
                total,
                preferenceId: result.id,
                items: preferenceItems
            });
        } catch (dbErr) {
            console.warn('[DigitalRO] No se pudo guardar el pedido en SQL Server:', dbErr.message);
        }

        res.json({ id: result.id, init_point: result.init_point });
    } catch (err) {
        console.error('[DigitalRO] Error creando preferencia:', err.message);
        res.status(400).json({ error: err.message || 'No se pudo crear la preferencia de pago.' });
    }
});

// Notificaciones (IPN/webhooks) de MercadoPago sobre el estado de un pago.
app.post('/api/webhook', (req, res) => {
    res.sendStatus(200);
    handleWebhook(req.query, req.body).catch((err) => {
        console.error('[DigitalRO] Error procesando webhook:', err.message);
    });
});

async function handleWebhook(query, body) {
    const paymentId = query.id || body?.data?.id;
    const topic = query.type || body?.type;
    if (topic !== 'payment' || !paymentId) {
        console.log('[DigitalRO] Webhook ignorado (no es notificación de pago):', topic);
        return;
    }

    const payment = new Payment(mpClient);
    const info = await payment.get({ id: paymentId });

    await updateOrderStatus({
        externalReference: info.external_reference,
        status: info.status,
        paymentId: String(info.id)
    });

    console.log(`[DigitalRO] Pedido ${info.external_reference} actualizado a estado "${info.status}".`);
}

// Historial de pedidos (uso interno/administrativo).
app.get('/api/orders', async (req, res) => {
    try {
        const pool = await getPool();
        const orders = await pool.request().query(`
            SELECT Id, ExternalReference, PayerName, PayerLastName, PayerEmail, Status, Total, PreferenceId, PaymentId, CreatedAt
            FROM Orders ORDER BY CreatedAt DESC;
        `);
        res.json(orders.recordset);
    } catch (err) {
        res.status(500).json({ error: 'No se pudo leer el historial de pedidos.' });
    }
});

app.listen(PORT, () => {
    console.log(`[DigitalRO] Servidor escuchando en http://localhost:${PORT}`);
});
