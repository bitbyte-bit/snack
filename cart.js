/**
 * Modern Shopping Cart System
 * Features: localStorage persistence, discount handling, tax calculation, quantity management
 */

class ShoppingCart {
    constructor(apiBase = '/api') {
        this.API_BASE = apiBase;
        this.STORAGE_KEY = 'maricafe_cart';
        this.items = [];
        this.discountRate = 0; // Global discount percentage
        this.taxRate = 0.1; // 10% tax rate
        this.init();
        // load persistent data after init to allow DOM-based initialization
        const stored = this.loadFromStorage();
        if (Array.isArray(stored)) {
            this.items = stored;
        } else if (stored && stored.items) {
            this.items = stored.items;
            this.discountRate = stored.discountRate || 0;
        }
    }

    /**
     * Initialize cart event listeners
     */
    init() {
        // Listen for storage changes (multi-tab sync)
        window.addEventListener('storage', (e) => {
            if (e.key === this.STORAGE_KEY) {
                this.items = this.loadFromStorage();
                this.render();
                this.updateCartBadge();
            }
        });
        // Attach discount apply and clear cart handlers if present
        const applyBtn = document.getElementById('cart-apply-discount');
        const clearBtn = document.getElementById('cart-clear-btn');
        if (applyBtn) {
            this._applyDiscountHandler = () => {
                const codeEl = document.getElementById('cart-discount-code');
                const code = codeEl ? codeEl.value : '';
                this.applyDiscountCode(code);
            };
            applyBtn.addEventListener('click', this._applyDiscountHandler);
        }
        if (clearBtn) {
            this._clearCartHandler = () => this.clear();
            clearBtn.addEventListener('click', this._clearCartHandler);
        }
    }

    /**
     * Add item to cart
     * @param {Object} product - Product object with id, name, price, etc.
     * @param {number} quantity - Quantity to add (default: 1)
     */
    addItem(product, quantity = 1) {
        if (!product || !product.id) {
            this.showMessage('Invalid product.', 'error');
            return false;
        }

        const existingItem = this.items.find(item => item.id === product.id);

        if (existingItem) {
            existingItem.quantity += quantity;
        } else {
            this.items.push({
                id: String(product.id),
                name: product.name,
                price: product.price,
                quantity: quantity,
                imageUrl: product.imageUrl || '',
                category: product.category || '',
                discount: product.discount || 0
            });
        }

        this.saveToStorage();
        this.updateCartBadge();
        this.playAddSound();
        this.showMessage(`✓ ${product.name} added to cart!`, 'success');
        return true;
    }

    /**
     * Remove item from cart by ID
     */
    removeItem(productId) {
        this.items = this.items.filter(item => item.id !== productId);
        this.saveToStorage();
        this.render();
        this.updateCartBadge();
        this.showMessage('Item removed from cart.', 'info');
    }

    /**
     * Update item quantity
     */
    updateQuantity(productId, quantity) {
        const item = this.items.find(item => item.id === productId);
        if (item) {
            if (quantity <= 0) {
                this.removeItem(productId);
            } else {
                item.quantity = quantity;
                this.saveToStorage();
                this.render();
                this.updateCartBadge();
            }
        }
    }

    /**
     * Clear entire cart
     */
    clear() {
        if (confirm('Are you sure you want to clear your cart?')) {
            this.items = [];
            this.saveToStorage();
            this.render();
            this.updateCartBadge();
            this.showMessage('Cart cleared.', 'info');
        }
    }

    /**
     * Get cart totals
     */
    getTotals() {
        let subtotal = 0;
        let discountAmount = 0; // per-item discount + global

        this.items.forEach(item => {
            const itemPrice = item.price;
            const itemDiscount = item.discount || 0;
            const itemDiscountAmount = itemPrice * (itemDiscount / 100) * item.quantity;
            subtotal += itemPrice * item.quantity;
            discountAmount += itemDiscountAmount;
        });

        // Apply any per-item discounts first, then global discount rate
        const afterItemDiscount = subtotal - discountAmount;
        const globalDiscountAmount = afterItemDiscount * (this.discountRate || 0);
        const totalDiscount = discountAmount + globalDiscountAmount;
        const discountedSubtotal = subtotal - totalDiscount;
        const tax = Math.max(0, discountedSubtotal) * this.taxRate;
        const total = discountedSubtotal + tax;

        return {
            subtotal: subtotal,
            discountAmount: totalDiscount,
            discountedSubtotal: discountedSubtotal,
            tax: tax,
            total: total,
            itemCount: this.items.reduce((sum, item) => sum + item.quantity, 0)
        };
    }

    /**
     * Get item count for badge
     */
    getItemCount() {
        return this.items.reduce((sum, item) => sum + item.quantity, 0);
    }

    /**
     * Render cart UI
     */
    render() {
        const cartItemsList = document.getElementById('cart-items-list');
        const cartSummary = document.getElementById('cart-summary-section');
        const cartEmpty = document.getElementById('cart-empty-message');

        if (!cartItemsList || !cartSummary || !cartEmpty) {
            console.error('Cart DOM elements not found');
            return;
        }

        if (this.items.length === 0) {
            cartItemsList.innerHTML = '';
            cartEmpty.style.display = 'block';
            cartSummary.style.display = 'none';
            return;
        }

        cartEmpty.style.display = 'none';
        cartSummary.style.display = 'block';

        // Render cart items
        cartItemsList.innerHTML = this.items.map(item => `
            <div class="cart-item" data-product-id="${item.id}">
                <div class="cart-item-details">
                    <h4>${this.escapeHtml(item.name)}</h4>
                    <p>$${item.price.toFixed(2)} each${item.discount ? ` <span class="item-discount" style="color: #10b981;">-${item.discount}%</span>` : ''}</p>
                </div>
                
                <div class="cart-item-controls">
                    <div class="quantity-control" data-id="${item.id}">
                        <button class="qty-decrease" aria-label="Decrease quantity">−</button>
                        <input class="qty-input" type="number" value="${item.quantity}" min="1">
                        <button class="qty-increase" aria-label="Increase quantity">+</button>
                    </div>
                    
                    <div class="cart-item-price">
                        $${(item.price * item.quantity).toFixed(2)}
                    </div>
                    
                    <button class="cart-item-remove remove-btn" data-id="${item.id}" title="Remove">×</button>
                </div>
            </div>
        `).join('');

        // Attach event listeners for the rendered controls
        const debounce = (fn, wait=250) => { let t; return (...args) => { clearTimeout(t); t = setTimeout(()=>fn(...args), wait); }; };

        cartItemsList.querySelectorAll('.qty-decrease').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const id = btn.closest('.quantity-control').dataset.id;
                const item = this.items.find(it => it.id === id);
                const newQty = (item ? item.quantity : 1) - 1;
                this.updateQuantity(id, newQty);
            });
        });

        cartItemsList.querySelectorAll('.qty-increase').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const id = btn.closest('.quantity-control').dataset.id;
                const item = this.items.find(it => it.id === id);
                const newQty = (item ? item.quantity : 0) + 1;
                this.updateQuantity(id, newQty);
            });
        });

        cartItemsList.querySelectorAll('.qty-input').forEach(input => {
            const id = input.closest('.quantity-control').dataset.id;
            const handler = debounce((ev) => {
                let v = parseInt(ev.target.value);
                if (isNaN(v) || v < 1) v = 1;
                this.updateQuantity(id, v);
            }, 350);
            input.addEventListener('input', handler);
            input.addEventListener('change', handler);
        });

        cartItemsList.querySelectorAll('.remove-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const id = btn.dataset.id;
                this.removeItem(id);
            });
        });

        // Update summary
        const totals = this.getTotals();
        document.getElementById('cart-subtotal').textContent = `$${totals.subtotal.toFixed(2)}`;
        document.getElementById('cart-discount').textContent = `-$${totals.discountAmount.toFixed(2)}`;
        document.getElementById('cart-tax').textContent = `$${totals.tax.toFixed(2)}`;
        document.getElementById('cart-total').textContent = `$${totals.total.toFixed(2)}`;

        // Update checkout button
        const checkoutBtn = document.querySelector('.cart-checkout');
        if (checkoutBtn) {
            checkoutBtn.textContent = `Checkout (${totals.itemCount} item${totals.itemCount === 1 ? '' : 's'})`;
        }
    }

    /**
     * Proceed to checkout
     */
    proceedToCheckout() {
        if (this.items.length === 0) {
            this.showMessage('Your cart is empty!', 'warning');
            return;
        }

        // Check if user is authenticated
        if (!window.currentUser || !window.currentUser.id) {
            this.showMessage('Please log in to proceed with checkout.', 'info');
            if (window.openModal) {
                window.openModal('login-modal');
            }
            return;
        }

        // Close cart modal and open payment modal
        if (window.closeModal) {
            window.closeModal('cart-modal');
        }

        if (window.openPaymentModal) {
            window.openPaymentModal();
        }
    }

    /**
     * Get cart data for API submission
     */
    getCheckoutData() {
        const totals = this.getTotals();
        return {
            items: this.items.map(item => ({
                id: item.id,
                name: item.name,
                price: item.price,
                quantity: item.quantity,
                discount: item.discount || 0
            })),
            subtotal: totals.subtotal,
            discount: totals.discountAmount,
            tax: totals.tax,
            total: totals.total,
            itemCount: totals.itemCount
        };
    }

    /**
     * Update cart badge with item count
     */
    updateCartBadge() {
        const badge = document.getElementById('cart-count');
        if (badge) {
            const count = this.getItemCount();
            badge.textContent = count;
            badge.style.display = count > 0 ? 'block' : 'none';
        }
    }

    /**
     * Play add to cart sound
     */
    playAddSound() {
        try {
            if (window.synth) {
                window.synth.triggerAttackRelease('C4', '8n');
            }
        } catch (e) {
            // Synth not available, silently fail
        }
    }

    /**
     * Show message notification
     */
    showMessage(message, type = 'info') {
        if (window.showMessageBox) {
            window.showMessageBox(message, type, 'top-notification');
        } else if (window.showToast) {
            window.showToast(message, type);
        } else {
            console.log(`[${type.toUpperCase()}] ${message}`);
        }
    }

    /**
     * Escape HTML to prevent XSS
     */
    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    /**
     * Save cart to localStorage
     */
    saveToStorage() {
        try {
            const payload = { items: this.items, discountRate: this.discountRate };
            localStorage.setItem(this.STORAGE_KEY, JSON.stringify(payload));
        } catch (e) {
            console.warn('Failed to save cart to localStorage:', e);
        }
    }

    /**
     * Load cart from localStorage
     */
    loadFromStorage() {
        try {
            const stored = localStorage.getItem(this.STORAGE_KEY);
            if (!stored) return [];
            const parsed = JSON.parse(stored);
            // Backwards compatibility: if old format (array) is stored
            if (Array.isArray(parsed)) return parsed;
            if (parsed && parsed.items) return parsed;
            return [];
        } catch (e) {
            console.warn('Failed to load cart from localStorage:', e);
            return [];
        }
    }

    /**
     * Apply a discount code (simple demo implementation)
     */
    applyDiscountCode(code) {
        if (!code || typeof code !== 'string') {
            this.showMessage('Please enter a discount code.', 'warning');
            return;
        }
        const normalized = code.trim().toUpperCase();
        // Example codes - expand as needed
        const codes = {
            'SAVE10': 0.10,
            'SAVE15': 0.15
        };
        if (codes[normalized]) {
            this.discountRate = codes[normalized];
            this.saveToStorage();
            this.render();
            this.showMessage(`Discount code ${normalized} applied!`, 'success');
            return true;
        } else {
            this.showMessage('Invalid discount code.', 'error');
            return false;
        }
    }

    /**
     * Export cart for API
     */
    toJSON() {
        return {
            items: this.items,
            totals: this.getTotals(),
            timestamp: new Date().toISOString()
        };
    }
}

// Initialize global cart instance when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    // Only initialize if cart elements exist on this page
    if (document.getElementById('cart-items-list') &&
        document.getElementById('cart-summary-section') &&
        document.getElementById('cart-empty-message')) {
        window.Cart = new ShoppingCart('/api');
        // Update badge on initial load
        window.Cart.updateCartBadge();
    }
});

// Also initialize if script is loaded after DOM ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
        if (!window.Cart &&
            document.getElementById('cart-items-list') &&
            document.getElementById('cart-summary-section') &&
            document.getElementById('cart-empty-message')) {
            window.Cart = new ShoppingCart('/api');
            window.Cart.updateCartBadge();
        }
    });
} else {
    if (!window.Cart &&
        document.getElementById('cart-items-list') &&
        document.getElementById('cart-summary-section') &&
        document.getElementById('cart-empty-message')) {
        window.Cart = new ShoppingCart('/api');
        window.Cart.updateCartBadge();
    }
}
