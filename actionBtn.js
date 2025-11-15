/**
 * Action Buttons Handler
 * Manages event listeners for product action buttons (add to cart, buy now, share)
 */

// Initialize action button event listeners
function initActionButtons() {
    // Buy now functionality
    document.querySelectorAll('.buy-now').forEach(button => {
        button.addEventListener('click', (e) => {
            const productId = e.currentTarget.dataset.id;
            const product = window.products ? window.products.find(p => p.id == productId) : null;
            if (product && window.Cart) {
                window.Cart.addItem(product);
                if (window.openModal) {
                    window.openModal('cart-modal');
                }
            }
        });
    });

    // Share functionality
    document.querySelectorAll('.share-btn').forEach(button => {
        button.addEventListener('click', (e) => {
            const productId = e.currentTarget.dataset.productId;
            if (window.shareProduct) {
                window.shareProduct(productId);
            }
        });
    });
}

// Make function globally available
window.initActionButtons = initActionButtons;