/* Servidor de DigitalRO: sirve la tienda estática y crea preferencias de pago con MercadoPago. */

const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const express = require('express');
const multer = require('multer');
const { MercadoPagoConfig, Preference, Payment } = require('mercadopago');
const { getPool, sql } = require('./db');

require('dotenv').config({ path: path.join(__dirname, '.env') });

const ROOT_DIR = path.join(__dirname, '..');
const PRODUCTS_PATH = path.join(ROOT_DIR, 'data', 'products.json');
const PORT = process.env.PORT || 3000;
const ACCESS_TOKEN = process.env.MP_ACCESS_TOKEN;
const WHATSAPP_BUSINESS_NUMBER = String(process.env.WHATSAPP_BUSINESS_NUMBER || '51918544859').replace(/\D/g, '');
const proofUpload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 5 * 1024 * 1024, files: 1, fields: 5, fieldSize: 16 * 1024 }
});

if (!ACCESS_TOKEN) {
    console.warn('[DigitalRO] Falta MP_ACCESS_TOKEN en server/.env — copia .env.example y coloca tus credenciales.');
}

const mpClient = new MercadoPagoConfig({ accessToken: ACCESS_TOKEN || 'TEST-INVALID' });

function isAdminRequest(req) {
    const adminKey = process.env.ADMIN_API_KEY || '';
    const suppliedKey = req.get('x-admin-key') || '';
    const expected = Buffer.from(adminKey);
    const supplied = Buffer.from(suppliedKey);
    return Boolean(adminKey && expected.length === supplied.length && crypto.timingSafeEqual(expected, supplied));
}

function identifyImage(buffer) {
    if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return 'image/png';
    if (buffer.length >= 3 && buffer[0] === 255 && buffer[1] === 216 && buffer[2] === 255) return 'image/jpeg';
    if (buffer.length >= 12 && buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
    return null;
}

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

async function updateOrderStatus({ externalReference, preferenceId, status, paymentId }) {
    const pool = await getPool();
    await pool.request()
        .input('externalReference', sql.NVarChar(100), externalReference)
        .input('preferenceId', sql.NVarChar(100), preferenceId)
        .input('status', sql.NVarChar(30), status)
        .input('paymentId', sql.NVarChar(100), paymentId || null)
        .query(`
            UPDATE Orders
            SET Status = @status, PaymentId = @paymentId, UpdatedAt = SYSUTCDATETIME()
            WHERE ExternalReference = @externalReference AND PreferenceId = @preferenceId;
        `);
}

const app = express();
app.use(express.json());
app.use(express.static(ROOT_DIR));

app.get('/api/products', async (req, res) => {
    res.json(await loadProducts());
});

app.post('/api/whatsapp-orders', proofUpload.single('proof'), async (req, res) => {
    let transaction;
    try {
        const fullName = String(req.body.fullName || '').trim();
        const email = String(req.body.email || '').trim().toLowerCase();
        const whatsapp = String(req.body.whatsapp || '').replace(/\D/g, '');
        const privacyConsent = req.body.privacyConsent === 'true';
        let requestedItems;

        try {
            requestedItems = JSON.parse(req.body.items || '[]');
        } catch {
            return res.status(400).json({ error: 'La lista de productos no es válida.' });
        }

        if (fullName.length < 2 || fullName.length > 160) {
            return res.status(400).json({ error: 'Ingresa tu nombre completo.' });
        }
        if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
            return res.status(400).json({ error: 'Ingresa un correo electrónico válido.' });
        }
        if (!/^\d{8,15}$/.test(whatsapp)) {
            return res.status(400).json({ error: 'Ingresa un número de WhatsApp con código de país.' });
        }
        if (!privacyConsent) {
            return res.status(400).json({ error: 'Debes aceptar el aviso de privacidad para registrar el pedido.' });
        }
        if (!Array.isArray(requestedItems) || requestedItems.length === 0 || requestedItems.length > 30) {
            return res.status(400).json({ error: 'El pedido no contiene productos válidos.' });
        }

        if (req.file) {
            const detectedType = identifyImage(req.file.buffer);
            if (!detectedType || detectedType !== req.file.mimetype) {
                return res.status(400).json({ error: 'El comprobante debe ser una imagen PNG, JPG o WebP válida.' });
            }
        }

        const products = await loadProducts();
        const items = requestedItems.map((entry) => {
            const product = products.find((candidate) => candidate.id === entry.id);
            const quantity = Number(entry.quantity);
            if (!product || !Number.isInteger(quantity) || quantity < 1 || quantity > 20) {
                throw new Error('Hay un producto o cantidad no válida en el pedido.');
            }
            return {
                id: product.id,
                title: product.title,
                quantity,
                unit_price: Number(product.price)
            };
        });

        const total = Math.round(items.reduce((sum, item) => sum + item.unit_price * item.quantity, 0) * 100) / 100;
        const externalReference = `digitalro-wa-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
        const pool = await getPool();
        transaction = new sql.Transaction(pool);
        await transaction.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);

        const customerResult = await new sql.Request(transaction)
            .input('fullName', sql.NVarChar(160), fullName)
            .input('email', sql.NVarChar(254), email)
            .input('whatsapp', sql.NVarChar(20), whatsapp)
            .query(`
                DECLARE @CustomerId INT;
                SELECT @CustomerId = Id FROM Customers WITH (UPDLOCK, HOLDLOCK) WHERE Email = @email;
                IF @CustomerId IS NULL
                BEGIN
                    INSERT INTO Customers (FullName, Email, WhatsApp) VALUES (@fullName, @email, @whatsapp);
                    SET @CustomerId = CONVERT(INT, SCOPE_IDENTITY());
                END
                ELSE
                    UPDATE Customers SET FullName = @fullName, WhatsApp = @whatsapp, UpdatedAt = SYSUTCDATETIME() WHERE Id = @CustomerId;
                SELECT @CustomerId AS Id;
            `);
        const customerId = customerResult.recordset[0].Id;

        const orderResult = await new sql.Request(transaction)
            .input('externalReference', sql.NVarChar(100), externalReference)
            .input('customerId', sql.Int, customerId)
            .input('fullName', sql.NVarChar(100), fullName.slice(0, 100))
            .input('email', sql.NVarChar(200), email.slice(0, 200))
            .input('whatsapp', sql.NVarChar(30), whatsapp)
            .input('total', sql.Decimal(10, 2), total)
            .query(`
                INSERT INTO Orders (
                    ExternalReference, CustomerId, PayerName, PayerEmail, PayerPhone,
                    Status, PaymentMethod, FulfillmentStatus, ConsentAt, Total
                )
                OUTPUT INSERTED.Id
                VALUES (
                    @externalReference, @customerId, @fullName, @email, @whatsapp,
                    'pending_manual_review', 'Yape', 'pending', SYSUTCDATETIME(), @total
                );
            `);
        const orderId = orderResult.recordset[0].Id;

        for (const item of items) {
            await new sql.Request(transaction)
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

        if (req.file) {
            await new sql.Request(transaction)
                .input('orderId', sql.Int, orderId)
                .input('originalName', sql.NVarChar(255), path.basename(req.file.originalname).slice(0, 255))
                .input('contentType', sql.NVarChar(40), req.file.mimetype)
                .input('imageData', sql.VarBinary(sql.MAX), req.file.buffer)
                .query(`
                    INSERT INTO OrderProofs (OrderId, OriginalName, ContentType, ImageData)
                    VALUES (@orderId, @originalName, @contentType, @imageData);
                `);
        }

        await transaction.commit();

        const itemSummary = items.map((item) => `- ${item.title} x${item.quantity}: S/ ${(item.unit_price * item.quantity).toFixed(2)}`).join('\n');
        const proofMessage = req.file
            ? 'Adjunté el comprobante al pedido y también lo enviaré como imagen por este chat para su verificación.'
            : 'Enviaré mi comprobante como imagen por este chat para su verificación.';
        const message = [
            `Hola, registré el pedido #${orderId} en DigitalRO.`,
            `Nombre: ${fullName}`,
            `Correo: ${email}`,
            `WhatsApp: +${whatsapp}`,
            '',
            'Productos:',
            itemSummary,
            `Total: S/ ${total.toFixed(2)}`,
            'Medio de pago: Yape',
            proofMessage
        ].join('\n');
        const whatsappUrl = `https://wa.me/${WHATSAPP_BUSINESS_NUMBER}?text=${encodeURIComponent(message)}`;

        res.status(201).json({ orderId, externalReference, total, proofSaved: Boolean(req.file), whatsappUrl });
    } catch (err) {
        if (transaction && transaction._aborted !== true) {
            try { await transaction.rollback(); } catch {}
        }
        if (err.message === 'Hay un producto o cantidad no válida en el pedido.') {
            return res.status(400).json({ error: err.message });
        }
        console.error('[DigitalRO] Error registrando pedido WhatsApp:', err.message);
        res.status(500).json({ error: 'No se pudo guardar el pedido. Inténtalo nuevamente.' });
    }
});

app.get('/api/payment-status', async (req, res) => {
    const paymentId = String(req.query.payment_id || '');
    if (!/^\d{1,30}$/.test(paymentId)) {
        return res.status(400).json({ error: 'ID de pago inválido.' });
    }

    try {
        const payment = new Payment(mpClient);
        const info = await payment.get({ id: paymentId });
        const externalReference = String(info.external_reference || '');
        const preferenceId = String(info.preference_id || '');

        if (!externalReference.startsWith('digitalro-') || !preferenceId) {
            return res.status(404).json({ error: 'No se encontró un pedido asociado a este pago.' });
        }

        const pool = await getPool();
        const orderResult = await pool.request()
            .input('externalReference', sql.NVarChar(100), externalReference)
            .input('preferenceId', sql.NVarChar(100), preferenceId)
            .query(`
                SELECT Id, Total
                FROM Orders
                WHERE ExternalReference = @externalReference AND PreferenceId = @preferenceId;
            `);

        if (orderResult.recordset.length === 0) {
            return res.status(404).json({ error: 'No se encontró un pedido asociado a este pago.' });
        }

        const order = orderResult.recordset[0];
        const amountMatches = Math.abs(Number(info.transaction_amount) - Number(order.Total)) < 0.01;
        if (info.currency_id !== 'PEN' || !amountMatches) {
            return res.status(409).json({ error: 'Los datos del pago no coinciden con el pedido.' });
        }

        if (!info.status) {
            return res.status(502).json({ error: 'MercadoPago no devolvió un estado de pago.' });
        }

        await updateOrderStatus({
            externalReference,
            preferenceId,
            status: info.status,
            paymentId: String(info.id)
        });

        res.set('Cache-Control', 'no-store');
        res.json({
            status: info.status,
            status_detail: info.status_detail || null,
            external_reference: externalReference,
            total: Number(order.Total),
            currency_id: info.currency_id
        });
    } catch (err) {
        console.error('[DigitalRO] Error verificando pago:', err.message);
        res.status(502).json({ error: 'No se pudo verificar el pago con MercadoPago.' });
    }
});

app.post('/api/create-preference', async (req, res) => {
    if (process.env.MERCADOPAGO_CHECKOUT_ENABLED !== 'true') {
        return res.status(410).json({ error: 'El pago por MercadoPago está pausado. Realiza el pedido por WhatsApp.' });
    }

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
            preferenceBody.notification_url = `${baseUrl}/api/webhook`;
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
        preferenceId: info.preference_id,
        status: info.status,
        paymentId: String(info.id)
    });

    console.log(`[DigitalRO] Pedido ${info.external_reference} actualizado a estado "${info.status}".`);
}

// Historial de pedidos (uso interno/administrativo).
app.get('/api/orders', async (req, res) => {
    if (!isAdminRequest(req)) return res.sendStatus(404);

    try {
        res.set('Cache-Control', 'no-store');
        const pool = await getPool();
        const orders = await pool.request().query(`
            SELECT TOP (250) o.Id, o.ExternalReference, o.CustomerId, o.PayerName, o.PayerLastName, o.PayerEmail, o.PayerPhone,
                o.Status, o.PaymentMethod, o.FulfillmentStatus, o.Total, o.PreferenceId, o.PaymentId, o.CreatedAt,
                CASE WHEN EXISTS (SELECT 1 FROM OrderProofs p WHERE p.OrderId = o.Id) THEN CAST(1 AS BIT) ELSE CAST(0 AS BIT) END AS HasProof
            FROM Orders o ORDER BY o.CreatedAt DESC;
        `);

        const rows = orders.recordset;
        if (rows.length === 0) return res.json([]);

        const itemRequest = pool.request();
        const orderIds = rows.map((order, index) => {
            itemRequest.input(`orderId${index}`, sql.Int, order.Id);
            return `@orderId${index}`;
        });
        const items = await itemRequest.query(`
            SELECT OrderId, ProductId, Title, Quantity, UnitPrice
            FROM OrderItems
            WHERE OrderId IN (${orderIds.join(',')})
            ORDER BY Id;
        `);

        const itemsByOrder = new Map();
        for (const item of items.recordset) {
            const orderItems = itemsByOrder.get(item.OrderId) || [];
            orderItems.push(item);
            itemsByOrder.set(item.OrderId, orderItems);
        }

        res.json(rows.map((order) => ({
            ...order,
            Items: itemsByOrder.get(order.Id) || []
        })));
    } catch (err) {
        console.error('[DigitalRO] Error leyendo historial de pedidos:', err.message);
        res.status(500).json({ error: 'No se pudo leer el historial de pedidos.' });
    }
});

app.get('/api/orders/:id/proof', async (req, res) => {
    if (!isAdminRequest(req)) return res.sendStatus(404);
    const orderId = Number(req.params.id);
    if (!Number.isInteger(orderId) || orderId < 1) return res.sendStatus(400);

    try {
        const pool = await getPool();
        const result = await pool.request()
            .input('orderId', sql.Int, orderId)
            .query('SELECT OriginalName, ContentType, ImageData FROM OrderProofs WHERE OrderId = @orderId;');
        if (result.recordset.length === 0) return res.sendStatus(404);

        const proof = result.recordset[0];
        res.set({
            'Cache-Control': 'no-store',
            'X-Content-Type-Options': 'nosniff',
            'Content-Disposition': 'inline'
        });
        res.type(proof.ContentType).send(proof.ImageData);
    } catch (err) {
        console.error('[DigitalRO] Error leyendo comprobante:', err.message);
        res.sendStatus(500);
    }
});

app.patch('/api/orders/:id/review', async (req, res) => {
    if (!isAdminRequest(req)) return res.sendStatus(404);
    const orderId = Number(req.params.id);
    const paymentStatus = req.body?.paymentStatus;
    const fulfillmentStatus = req.body?.fulfillmentStatus;
    const validPaymentStatuses = ['pending_manual_review', 'approved', 'rejected'];
    const validFulfillmentStatuses = ['pending', 'delivered'];

    if (!Number.isInteger(orderId) || orderId < 1
        || (paymentStatus !== undefined && !validPaymentStatuses.includes(paymentStatus))
        || (fulfillmentStatus !== undefined && !validFulfillmentStatuses.includes(fulfillmentStatus))
        || (paymentStatus === undefined && fulfillmentStatus === undefined)) {
        return res.status(400).json({ error: 'Actualización de pedido inválida.' });
    }

    try {
        const pool = await getPool();
        const current = await pool.request()
            .input('orderId', sql.Int, orderId)
            .query('SELECT Status, PaymentMethod, FulfillmentStatus FROM Orders WHERE Id = @orderId;');
        if (current.recordset.length === 0 || current.recordset[0].PaymentMethod !== 'Yape') {
            return res.sendStatus(404);
        }

        const nextPaymentStatus = paymentStatus || current.recordset[0].Status;
        if (current.recordset[0].FulfillmentStatus === 'delivered' && nextPaymentStatus !== 'approved') {
            return res.status(409).json({ error: 'Un pedido entregado no puede dejar de figurar como pago aprobado.' });
        }
        if (fulfillmentStatus === 'delivered' && nextPaymentStatus !== 'approved') {
            return res.status(409).json({ error: 'Confirma el pago antes de marcar el pedido como entregado.' });
        }

        await pool.request()
            .input('orderId', sql.Int, orderId)
            .input('paymentStatus', sql.NVarChar(30), paymentStatus || null)
            .input('fulfillmentStatus', sql.NVarChar(30), fulfillmentStatus || null)
            .query(`
                UPDATE Orders
                SET Status = COALESCE(@paymentStatus, Status),
                    FulfillmentStatus = COALESCE(@fulfillmentStatus, FulfillmentStatus),
                    UpdatedAt = SYSUTCDATETIME()
                WHERE Id = @orderId AND PaymentMethod = 'Yape';
            `);

        res.json({ orderId, paymentStatus: nextPaymentStatus, fulfillmentStatus: fulfillmentStatus || null });
    } catch (err) {
        console.error('[DigitalRO] Error actualizando pedido:', err.message);
        res.status(500).json({ error: 'No se pudo actualizar el pedido.' });
    }
});

app.use((err, req, res, next) => {
    if (err instanceof multer.MulterError) {
        const status = err.code === 'LIMIT_FILE_SIZE' ? 413 : 400;
        return res.status(status).json({ error: status === 413 ? 'El comprobante no debe superar 5 MB.' : 'No se pudo procesar el archivo adjunto.' });
    }
    console.error('[DigitalRO] Error inesperado en la solicitud:', err.message);
    res.status(500).json({ error: 'Ocurrió un error interno.' });
});

app.listen(PORT, () => {
    console.log(`[DigitalRO] Servidor escuchando en http://localhost:${PORT}`);
});
