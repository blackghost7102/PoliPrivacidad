/* Lógica de carrito compartida entre la tienda y el checkout (localStorage). */

const CART_STORAGE_KEY = 'digitalro_cart';

const CartStore = {
    getCart() {
        try {
            const raw = localStorage.getItem(CART_STORAGE_KEY);
            return raw ? JSON.parse(raw) : {};
        } catch (err) {
            return {};
        }
    },

    saveCart(cart) {
        localStorage.setItem(CART_STORAGE_KEY, JSON.stringify(cart));
    },

    addItem(productId, quantity = 1) {
        const cart = this.getCart();
        cart[productId] = (cart[productId] || 0) + quantity;
        this.saveCart(cart);
        return cart;
    },

    setQuantity(productId, quantity) {
        const cart = this.getCart();
        if (quantity <= 0) {
            delete cart[productId];
        } else {
            cart[productId] = quantity;
        }
        this.saveCart(cart);
        return cart;
    },

    removeItem(productId) {
        const cart = this.getCart();
        delete cart[productId];
        this.saveCart(cart);
        return cart;
    },

    clear() {
        localStorage.removeItem(CART_STORAGE_KEY);
    },

    totalCount() {
        const cart = this.getCart();
        return Object.values(cart).reduce((sum, qty) => sum + qty, 0);
    }
};

function formatPEN(amount) {
    return new Intl.NumberFormat('es-PE', { style: 'currency', currency: 'PEN' }).format(amount);
}

async function fetchProducts() {
    const endpoints = ['/api/products', 'data/products.json'];
    for (const url of endpoints) {
        try {
            const res = await fetch(url);
            if (res.ok) return await res.json();
        } catch (err) {
            /* intenta el siguiente origen de datos */
        }
    }
    return [];
}
