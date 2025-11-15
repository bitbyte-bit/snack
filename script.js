// --- GLOBAL VARIABLES (Frontend Only) ---
let currentView = 'dashboard';
let isAuthReady = true; // Always true in local mode
let userId = 'loading...';
let isLocked = true; // Security state variable
let adminPin = '1234'; // Default PIN
const APP_ID = 'local-snack-app'; // LocalStorage key prefix

// Data arrays stored in memory, updated from localStorage
let snacks = [];
let users = [];
let orders = [];
let broadcasts = []; // New local array for broadcasts

// Audio synthesis
let deleteSynth;
let unlockSynth;

// Socket.IO
let socket;

// --- API & DATA UTILITIES ---
// Use a same-origin relative API base so the frontend and backend share the same port
const API_BASE = '/api';

const generateId = () => {
    return crypto.randomUUID();
};

const getTimestamp = () => {
    return new Date().toISOString();
};

const formatCurrency = (amount) => {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(amount);
};

// Function to save the current PIN to localStorage
const savePin = (pin) => {
    localStorage.setItem('admin_pin', pin);
    adminPin = pin;
};

// --- API HANDLERS ---
const fetchData = async (endpoint) => {
    const response = await fetch(`${API_BASE}/${endpoint}`);
    if (!response.ok) throw new Error(`Failed to fetch ${endpoint}`);
    return await response.json();
};

const postData = async (endpoint, data) => {
    const response = await fetch(`${API_BASE}/${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
    });
    if (!response.ok) throw new Error(`Failed to post to ${endpoint}`);
    return await response.json();
};

const putData = async (endpoint, data) => {
    const response = await fetch(`${API_BASE}/${endpoint}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
    });
    if (!response.ok) throw new Error(`Failed to put to ${endpoint}`);
    return await response.json();
};

const deleteData = async (endpoint) => {
    const response = await fetch(`${API_BASE}/${endpoint}`, {
        method: 'DELETE'
    });
    if (!response.ok) throw new Error(`Failed to delete ${endpoint}`);
    return await response.json();
};

// Updates the in-memory array via API, then re-renders the current view
const updateViaAPI = async (collectionName, operation, data = null) => {
    try {
        let result;
        switch (operation) {
            case 'create':
                result = await postData(collectionName, data);
                break;
            case 'update':
                result = await putData(`${collectionName}/${data.id}`, data);
                break;
            case 'delete':
                result = await deleteData(`${collectionName}/${data.id}`);
                break;
        }
        // Reload data from API to keep in-memory arrays updated
        await loadDataFromAPI();
        if (!isLocked) renderApp();
        return result;
    } catch (error) {
        console.error(`Error updating ${collectionName}:`, error);
        showMessage(`Error updating ${collectionName}: ${error.message}`, 'error');
        throw error;
    }
};

// Converts a File object to a Base64 data URL string.
const fileToBase64 = (file) => new Promise((resolve, reject) => {
    if (!file) {
        resolve(null);
        return;
    }
    if (file.size > 1024 * 1024) {
        reject(new Error("File size exceeds 1MB. Please choose a smaller image."));
        return;
    }
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = () => resolve(reader.result);
    reader.onerror = error => reject(error);
});

// --- UI UTILITIES (Toast and Modal) ---
let toastCounter = 0;

const showToast = (message, type = 'success', duration = 4000) => {
    const container = document.getElementById('toast-container');
    if (!container) return;

    const id = `toast-${toastCounter++}`;
    let bgColor, iconName, iconColor;

    switch (type) {
        case 'error': bgColor = 'bg-red-600'; iconName = 'x-circle'; iconColor = 'text-red-300'; break;
        case 'warning': bgColor = 'bg-yellow-600'; iconName = 'alert-triangle'; iconColor = 'text-yellow-300'; break;
        case 'info': bgColor = 'bg-blue-600'; iconName = 'info'; iconColor = 'text-blue-300'; break;
        case 'success': default: bgColor = 'bg-green-600'; iconName = 'check-circle'; iconColor = 'text-green-300'; break;
    }

    const toastHtml = `
                <div id="${id}" class="flex items-center w-full max-w-xs p-4 text-white ${bgColor} rounded-lg shadow-xl transform transition-all duration-300 opacity-0 translate-x-full pointer-events-auto">
                    <div class="inline-flex flex-shrink-0 justify-center items-center w-8 h-8 rounded-lg ${iconColor} bg-white bg-opacity-10">
                        <i data-lucide="${iconName}" class="w-5 h-5"></i>
                    </div>
                    <div class="ml-3 text-sm font-normal">${message}</div>
                    <button type="button" class="ml-auto -mx-1.5 -my-1.5 bg-transparent text-white hover:text-gray-200 rounded-lg focus:ring-2 focus:ring-gray-300 p-1.5 hover:bg-white hover:bg-opacity-10 inline-flex items-center justify-center h-8 w-8" onclick="document.getElementById('${id}').remove()">
                        <i data-lucide="x" class="w-4 h-4"></i>
                    </button>
                </div>
            `;

    container.insertAdjacentHTML('beforeend', toastHtml);
    lucide.createIcons();

    const toastElement = document.getElementById(id);

    setTimeout(() => {
        toastElement.classList.remove('opacity-0', 'translate-x-full');
        toastElement.classList.add('opacity-100', 'translate-x-0');
    }, 10);

    setTimeout(() => {
        toastElement.classList.remove('opacity-100', 'translate-x-0');
        toastElement.classList.add('opacity-0', 'translate-x-full');

        setTimeout(() => {
            toastElement.remove();
        }, 300);
    }, duration);
};


const showMessage = (message, type = 'success') => {
    const statusElement = document.getElementById('connection-status');
    const statusTextElement = document.getElementById('user-display');

    showToast(message, type);

    statusTextElement.textContent = message;
    statusElement.className = `inline-block w-3 h-3 rounded-full ${type === 'success' ? 'bg-green-500' : 'bg-red-500'}`;

    if (type === 'success' && !message.includes("Connecting...")) {
        setTimeout(() => {
            statusTextElement.textContent = `DB Admin: ${userId.substring(0, 8)}...`;
            statusElement.className = 'inline-block w-3 h-3 rounded-full bg-green-500';
        }, 3000);
    }
};

const showModal = (title, content, actions = '') => {
    const modal = document.getElementById('global-modal');
    const modalContent = document.getElementById('modal-content');

    modalContent.innerHTML = `
                <div class="flex justify-between items-center pb-3 border-b border-gray-100 mb-4">
                    <h3 class="text-xl font-bold text-secondary">${title}</h3>
                    <button onclick="hideModal()" class="text-gray-400 hover:text-gray-600">
                        <i data-lucide="x" class="w-6 h-6"></i>
                        </button>
                </div>
                <div>${content}</div>
                <div class="mt-6 flex justify-end space-x-3">${actions}</div>
            `;

    lucide.createIcons();

    modal.classList.remove('hidden');
    modal.classList.add('flex');

    setTimeout(() => {
        modalContent.classList.remove('scale-95', 'opacity-0');
        modalContent.classList.add('scale-100', 'opacity-100');

        const fileInput = document.getElementById('snack-image-file');
        if (fileInput) {
            fileInput.addEventListener('change', (e) => {
                const file = e.target.files[0];
                const preview = document.getElementById('snack-image-preview');
                if (file) {
                    preview.src = URL.createObjectURL(file);
                    preview.classList.remove('hidden');
                } else {
                    preview.src = '';
                    preview.classList.add('hidden');
                }
            });
        }
    }, 10);
};

const hideModal = () => {
    const modal = document.getElementById('global-modal');
    const modalContent = document.getElementById('modal-content');

    modalContent.classList.remove('scale-100', 'opacity-100');
    modalContent.classList.add('scale-95', 'opacity-0');

    setTimeout(() => {
        modal.classList.remove('flex');
        modal.classList.add('hidden');
    }, 300);
};

// --- AUDIO & PIN LOGIC ---
const initializeAudio = () => {
    if (typeof Tone !== 'undefined') {
        document.body.addEventListener('click', () => {
            if (Tone.context.state !== 'running') { Tone.start(); }
        }, { once: true });

        deleteSynth = new Tone.Synth({
            oscillator: { type: "square" },
            envelope: { attack: 0.005, decay: 0.1, sustain: 0, release: 0.1 }
        }).toDestination();

        unlockSynth = new Tone.PolySynth(Tone.Synth).toDestination();
    } else {
        console.warn("Tone.js not loaded. Audio effects disabled.");
    }
};

const playDeleteSound = () => {
    if (deleteSynth && Tone.context.state === 'running') {
        deleteSynth.triggerAttackRelease("G4", "8n");
    }
};

const playUnlockSound = () => {
    if (unlockSynth && Tone.context.state === 'running') {
        const now = Tone.now();
        unlockSynth.triggerAttackRelease(["C5", "E5", "G5"], "8n", now);
    }
};

// Socket.IO functions
const initializeSocket = () => {
    // Connect to the same origin where the page was served (Socket.IO will use the page's origin)
    socket = io();

    socket.on('connect', () => {
        console.log('Admin connected to server with Socket.IO');
        socket.emit('join-admin');
    });

    socket.on('disconnect', () => {
        console.log('Admin disconnected from server');
    });

    socket.on('new-message', (messageData) => {
        console.log('New message for admin:', messageData);
        // Update inbox badge
        updateInboxBadge();
        // Show notification
        showToast(`New message from ${messageData.fromUserId}`, 'info');
        playNotificationSound();
    });

    socket.on('order-update', (orderData) => {
        console.log('Order update:', orderData);
        showToast(`Order ${orderData.id} status updated`, 'info');
        // Refresh orders if on orders view
        if (currentView === 'orders') {
            loadDataFromAPI();
            renderApp();
        }
    });
};

const checkPin = () => {
    const pinInput = document.getElementById('admin-pin');
    const errorMessage = document.getElementById('pin-error-message');
    const enteredPin = pinInput.value;

    if (enteredPin === adminPin) {
        isLocked = false;
        unlockDashboard();
    } else {
        errorMessage.classList.remove('hidden');
        pinInput.value = '';
        pinInput.focus();
        showToast("Access Denied: Incorrect PIN.", 'error');
    }
};

const forgotPin = () => {
    const content = `
                <p class="mb-4">Since this is a demo environment, there is no real PIN reset functionality. You can view the current local PIN below.</p>
                <p class="text-xl font-bold text-primary">Current Local PIN: ${adminPin}</p>
                <p class="mt-4 text-sm text-gray-600">Note: In a production environment, this would initiate an email recovery process.</p>
            `;
    const actions = `
                <button onclick="hideModal()" class="bg-gray-200 text-gray-700 py-2 px-4 rounded-lg font-medium hover:bg-gray-300 transition">Close</button>
            `;
    showModal('PIN Recovery', content, actions);
};

const unlockDashboard = () => {
    const overlay = document.getElementById('pin-lock-overlay');
    if (overlay) {
        overlay.classList.add('opacity-0');
        playUnlockSound();
        showMessage("Dashboard Unlocked!", 'success');

        setTimeout(() => {
            overlay.remove();
        }, 500);
    }

    // Render app immediately as local data is already loaded and Auth is true
    renderApp();
};

// --- DATA LOADING FROM API ---
const loadDataFromAPI = async () => {
    try {
        snacks = await fetchData('snacks');
        users = await fetchData('users');
        orders = await fetchData('orders');
        broadcasts = await fetchData('broadcasts');
    } catch (error) {
        console.error('Error loading data from API:', error);
        showMessage('Failed to load data from server. Check if backend is running.', 'error');
        // Fallback to empty arrays
        snacks = [];
        users = [];
        orders = [];
        broadcasts = [];
    }
};

// --- INITIALIZATION (Frontend Only) ---
window.onload = async () => {
    initializeAudio();
    initializeSocket();
    lucide.createIcons();

    // 1. Load dynamic PIN from localStorage, fallback to default '1234'
    adminPin = localStorage.getItem('admin_pin') || '1234';

    // 2. Load data from API
    await loadDataFromAPI();

    // 4. Set local identity and status
    userId = 'db_admin_' + adminPin;
    isAuthReady = true;
    document.getElementById('auth-uid').textContent = 'db_admin_' + adminPin.substring(0, 4) + '...';
    document.getElementById('app-id-display').textContent = APP_ID;

    showMessage(`Database Mode Ready! Default PIN: ${adminPin}`, 'info');

    // 5. Initial render (will be blocked by PIN overlay initially)
    if (!isLocked) {
        renderApp();
    }
};


// --- NAVIGATION & UI STATE ---
const changeView = (view) => {
    if (isLocked) {
        showToast("Enter PIN to access the dashboard.", 'warning');
        return;
    }
    currentView = view;
    const titleMap = {
        'dashboard': 'Dashboard Overview',
        'snacks': 'Snack Item Management (CRUD)',
        'snack-monitor': 'Snack Inventory Cards',
        'users': 'User Account Management',
        'orders': 'Real-Time Order Monitoring',
        'finance': 'Financial & Revenue Summary',
        'broadcast': 'Broadcast Message Center',
        'inbox': 'Admin Inbox',
        'messages': 'Direct Messages to Users',
        'settings': 'Security & App Settings'
    };
    if (view === 'inbox') {
        document.getElementById('page-title').textContent = 'Admin Inbox';
        loadAdminMessages();
    } else {
        document.getElementById('page-title').textContent = titleMap[view];
    }

    document.querySelectorAll('#sidebar button').forEach(btn => {
        btn.classList.remove('active-nav', 'bg-slate-700');
    });
    event.currentTarget.classList.add('active-nav', 'bg-slate-700');

    const sidebar = document.getElementById('sidebar');
    if (sidebar.classList.contains('translate-x-0') && window.innerWidth < 768) {
        sidebar.classList.add('-translate-x-full');
        sidebar.classList.remove('translate-x-0');
    }

    renderApp();
};

document.getElementById('sidebar-toggle').addEventListener('click', () => {
    const sidebar = document.getElementById('sidebar');
    sidebar.classList.toggle('-translate-x-full');
    sidebar.classList.toggle('translate-x-0');
});

// --- DASHBOARD RENDERING ---

const renderApp = () => {
    const container = document.getElementById('content-container');
    if (isLocked || !isAuthReady) {
        container.innerHTML = `<div class="p-8 text-center text-gray-500">${isLocked ? 'Access Locked by PIN.' : 'Loading local data...'}</div>`;
        return;
    }

    switch (currentView) {
        case 'dashboard':
            container.innerHTML = renderDashboardOverview();
            break;
        case 'snacks':
            container.innerHTML = renderSnackManagement();
            break;
        case 'snack-monitor':
            container.innerHTML = renderSnackInventoryMonitor();
            break;
        case 'users':
            container.innerHTML = renderUserManagement();
            break;
        case 'orders':
            container.innerHTML = renderOrderMonitoring();
            break;
        case 'finance':
            container.innerHTML = renderFinancialOverview();
            break;
        case 'broadcast':
            container.innerHTML = renderBroadcastCenter();
            // Render mock broadcasts locally
            document.getElementById('broadcast-log').innerHTML = broadcasts.map(b => `
                        <div class="p-3 bg-gray-50 border rounded-lg">
                            <p class="font-semibold text-sm">${b.subject}</p>
                            <p class="text-xs text-gray-600">${b.content}</p>
                            <p class="text-xs text-gray-400 mt-1">Sent: ${new Date(b.timestamp).toLocaleString()}</p>
                        </div>
                    `).join('');
            break;
        case 'inbox':
            container.innerHTML = renderAdminInbox();
            break;
        case 'messages':
            container.innerHTML = renderMessages();
            loadUsersForMessaging();
            break;
        case 'settings':
            container.innerHTML = renderSettings();
            break;
        default:
            container.innerHTML = renderDashboardOverview();
    }
    lucide.createIcons();
};

// --- 7. Settings View (NEW) ---
const renderSettings = () => {
    return `
                <h3 class="text-2xl font-semibold mb-6">Security & Account Settings</h3>
                <div class="bg-white rounded-xl shadow-lg p-6 max-w-lg space-y-8">
                    <h4 class="text-xl font-bold text-secondary flex items-center">
                        <i data-lucide="key-round" class="w-6 h-6 mr-2 text-primary"></i> Change Administrator PIN
                    </h4>
                    <form id="change-pin-form" onsubmit="event.preventDefault(); updateAdminPin()">
                        <div class="space-y-4">
                            <div>
                                <label for="current-pin" class="block text-sm font-medium text-gray-700">Current PIN</label>
                                <input type="password" id="current-pin" maxlength="4" required class="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-primary focus:ring-primary p-2 border">
                            </div>
                            <hr class="my-4">
                            <div>
                                <label for="new-pin" class="block text-sm font-medium text-gray-700">New PIN (4 digits)</label>
                                <input type="password" id="new-pin" maxlength="4" required class="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-primary focus:ring-primary p-2 border">
                            </div>
                            <div>
                                <label for="confirm-pin" class="block text-sm font-medium text-gray-700">Confirm New PIN</label>
                                <input type="password" id="confirm-pin" maxlength="4" required class="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-primary focus:ring-primary p-2 border">
                            </div>
                        </div>
                        <button type="submit" class="w-full mt-6 bg-primary text-white py-3 rounded-lg font-semibold shadow-md hover:bg-orange-600 transition">Update PIN</button>
                    </form>
                </div>
            `;
};

// --- 8. Admin Inbox View ---
const renderAdminInbox = () => {
    return `
                <h3 class="text-2xl font-semibold mb-6">Admin Inbox</h3>
                <div class="bg-white rounded-xl shadow-lg p-6">
                    <div id="admin-messages-list" class="space-y-4">
                        <!-- Messages will be loaded here -->
                    </div>
                </div>
            `;
};

// --- 9. Direct Messages View ---
const renderMessages = () => {
    return `
                <div class="flex h-full">
                    <!-- Users List Sidebar -->
                    <div class="w-1/3 bg-white rounded-xl shadow-lg mr-6 p-6">
                        <h3 class="text-xl font-semibold mb-4 text-secondary">Select User to Message</h3>
                        <div id="users-list" class="space-y-2 max-h-96 overflow-y-auto">
                            <!-- Users will be loaded here -->
                        </div>
                    </div>

                    <!-- Message Thread -->
                    <div class="flex-1 bg-white rounded-xl shadow-lg p-6">
                        <div id="message-thread" class="hidden">
                            <div class="flex justify-between items-center mb-4 pb-4 border-b border-gray-200">
                                <h3 class="text-xl font-semibold text-secondary" id="message-user-name">User Name</h3>
                                <button onclick="closeMessageThread()" class="text-gray-500 hover:text-gray-700">
                                    <i data-lucide="x" class="w-6 h-6"></i>
                                </button>
                            </div>
                            <div id="message-history" class="space-y-4 mb-4 max-h-80 overflow-y-auto">
                                <!-- Messages will be loaded here -->
                            </div>
                            <div class="flex space-x-2">
                                <input type="text" id="message-subject" placeholder="Subject (optional)" class="flex-1 rounded-md border-gray-300 shadow-sm focus:border-primary focus:ring-primary p-2 border">
                                <textarea id="message-content" placeholder="Type your message..." rows="2" class="flex-1 rounded-md border-gray-300 shadow-sm focus:border-primary focus:ring-primary p-2 border"></textarea>
                                <button onclick="sendDirectMessage()" class="bg-primary text-white px-4 py-2 rounded-md hover:bg-orange-600 transition">
                                    <i data-lucide="send" class="w-5 h-5"></i>
                                </button>
                            </div>
                        </div>

                        <!-- Default state -->
                        <div id="message-placeholder" class="text-center text-gray-500 py-12">
                            <i data-lucide="message-square" class="w-16 h-16 mx-auto mb-4 text-gray-300"></i>
                            <h3 class="text-lg font-medium mb-2">Select a user to start messaging</h3>
                            <p>Choose a user from the list to send direct messages</p>
                        </div>
                    </div>
                </div>
            `;
};

const loadAdminMessages = async () => {
    try {
        const messages = await fetch(`${API_BASE}/messages/admin`);
        const data = await messages.json();
        const container = document.getElementById('admin-messages-list');

        if (data.length === 0) {
            container.innerHTML = '<p class="text-center text-gray-500 py-8">No messages yet.</p>';
        } else {
            container.innerHTML = data.map(msg => `
                        <div class="border rounded-lg p-4 ${msg.isRead ? 'bg-gray-50' : 'bg-blue-50 border-blue-200'}">
                            <div class="flex justify-between items-start mb-2">
                                <div class="font-semibold">${msg.subject}</div>
                                <div class="text-sm text-gray-500">${new Date(msg.timestamp).toLocaleString()}</div>
                            </div>
                            <div class="text-sm text-gray-600 mb-2">From: ${msg.fromUserId}</div>
                            <div class="mb-3">${msg.content}</div>
                            <div class="flex gap-2">
                                <button onclick="replyToMessage('${msg.id}', '${msg.fromUserId}')" class="bg-blue-500 text-white px-3 py-1 rounded text-sm hover:bg-blue-600">
                                    Reply
                                </button>
                                ${!msg.isRead ? `<button onclick="markAsRead('${msg.id}')" class="bg-green-500 text-white px-3 py-1 rounded text-sm hover:bg-green-600">
                                    Mark Read
                                </button>` : ''}
                            </div>
                        </div>
                    `).join('');
        }

        updateInboxBadge(data.filter(m => !m.isRead).length);
    } catch (error) {
        console.error('Error loading admin messages:', error);
    }
};

const replyToMessage = (messageId, toUserId) => {
    const reply = prompt('Enter your reply:');
    if (reply) {
        fetch(`${API_BASE}/messages`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                fromUserId: 'admin',
                toUserId: toUserId,
                subject: 'Re: Admin Reply',
                content: reply,
                type: 'reply'
            })
        }).then(() => {
            showMessage('Reply sent successfully!');
            loadAdminMessages();
        });
    }
};

const markAsRead = (messageId) => {
    fetch(`${API_BASE}/messages/${messageId}/read`, {
        method: 'PUT'
    }).then(() => {
        loadAdminMessages();
    });
};

const updateInboxBadge = (count) => {
    const badge = document.getElementById('inbox-badge');
    if (count > 0) {
        badge.textContent = count;
        badge.classList.remove('hidden');
    } else {
        badge.classList.add('hidden');
    }
};

const updateAdminPin = () => {
    const currentPinInput = document.getElementById('current-pin').value;
    const newPinInput = document.getElementById('new-pin').value;
    const confirmPinInput = document.getElementById('confirm-pin').value;

    // 1. Validate Current PIN
    if (currentPinInput !== adminPin) {
        showMessage("Error: The current PIN entered is incorrect.", 'error');
        return;
    }

    // 2. Validate New PIN format (4 digits)
    if (newPinInput.length !== 4 || isNaN(newPinInput)) {
        showMessage("Error: New PIN must be exactly 4 digits.", 'error');
        return;
    }

    // 3. Validate Confirmation
    if (newPinInput !== confirmPinInput) {
        showMessage("Error: New PIN and confirmation do not match.", 'error');
        return;
    }

    // 4. Update and Save
    savePin(newPinInput);

    // Update display ID to reflect new PIN (partial)
    userId = 'db_admin_' + newPinInput;
    document.getElementById('auth-uid').textContent = 'db_admin_' + newPinInput.substring(0, 4) + '...';

    // Reset lock screen input
    const pinLockInput = document.getElementById('admin-pin');
    if (pinLockInput) pinLockInput.value = '';

    showMessage("Success! Your administrator PIN has been updated and saved locally.", 'success');

    // Clear form fields
    document.getElementById('change-pin-form').reset();
};

// --- 1. Dashboard Overview View (Content is the same, data sourcing is local) ---
const renderDashboardOverview = () => {
    const totalUsers = users.length;
    const totalSnacks = snacks.length;
    const totalOrders = orders.length;
    const totalRevenue = orders.reduce((sum, order) => sum + (order.total || 0), 0);
    const pendingOrders = orders.filter(o => o.status === 'New').length;
    const recentOrders = orders.slice(0, 5);

    return `
                <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
                    ${createMetricCard('Total Revenue', formatCurrency(totalRevenue), 'dollar-sign', 'bg-green-100 text-green-600')}
                    ${createMetricCard('Total Users', totalUsers.toLocaleString(), 'users', 'bg-blue-100 text-blue-600')}
                    ${createMetricCard('Total Snacks', totalSnacks.toLocaleString(), 'popcorn', 'bg-indigo-100 text-indigo-600')}
                    ${createMetricCard('Pending Orders', pendingOrders.toLocaleString(), 'package', 'bg-red-100 text-red-600')}
                </div>
                
                <h3 class="text-2xl font-semibold mb-4 text-secondary">Recent Orders</h3>
                ${renderOrdersTable(recentOrders)}

                <h3 class="text-2xl font-semibold mt-8 mb-4 text-secondary">Security & Compliance (Database Mode)</h3>
                <div class="bg-white rounded-xl shadow-lg p-6 border-l-4 border-green-500">
                    <p class="font-bold text-lg text-green-700 mb-2">Data Protection Note</p>
                    <p class="text-sm text-gray-600">This application is running in **Database Mode** with a backend API and SQLite database. Data is persistent, secure, and can be shared across devices. The PIN lock is a frontend mechanism for UI access control.</p>
                </div>

                <h3 class="text-2xl font-semibold mt-8 mb-4 text-secondary">Financial Insights (Mock)</h3>
                <div class="bg-white rounded-xl shadow-lg p-6">
                    <p class="text-gray-600">This section simulates a deeper financial analysis based on processed order data.</p>
                    <ul class="mt-4 space-y-2 text-sm">
                        <li><strong>Highest Value Order:</strong> ${totalOrders > 0 ? formatCurrency(Math.max(...orders.map(o => o.total || 0))) : 'N/A'}</li>
                        <li><strong>Average Order Value:</strong> ${totalOrders > 0 ? formatCurrency(totalRevenue / totalOrders) : 'N/A'}</li>
                    </ul>
                </div>
            `;
};

const createMetricCard = (title, value, iconName, colorClasses) => `
            <div class="bg-white rounded-xl shadow-lg p-5 border-b-4 border-primary transition hover:shadow-xl">
                <div class="flex justify-between items-center">
                    <div>
                        <p class="text-sm font-medium text-gray-500">${title}</p>
                        <p class="text-3xl font-bold mt-1">${value}</p>
                    </div>
                    <div class="p-3 rounded-full ${colorClasses}">
                        <i data-lucide="${iconName}" class="w-6 h-6"></i>
                    </div>
                </div>
            </div>
        `;


// --- 2. Snack Management View (CRUD Table) ---

const renderSnackManagement = () => {
    return `
                <div class="flex justify-between items-center mb-6">
                    <h3 class="text-2xl font-semibold">Snack List (${snacks.length})</h3>
                    <button onclick="showSnackForm()" class="bg-primary text-white py-2 px-4 rounded-lg font-medium shadow-md hover:bg-orange-600 transition flex items-center">
                        <i data-lucide="plus" class="w-5 h-5 mr-2"></i> Add New Snack
                    </button>
                </div>
                <div class="bg-white rounded-xl shadow-lg overflow-x-auto">
                    ${renderSnacksTable()}
                </div>
            `;
};

const renderSnacksTable = () => {
    if (snacks.length === 0) {
        return '<p class="p-6 text-center text-gray-500">No snacks found. Add one above!</p>';
    }

    return `
                <table class="min-w-full divide-y divide-gray-200">
                    <thead class="bg-gray-50">
                        <tr>
                            <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Image</th>
                            <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Name</th>
                            <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Category</th>
                            <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Price</th>
                            <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Stock</th>
                            <th class="px-6 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">Actions</th>
                        </tr>
                    </thead>
                    <tbody class="bg-white divide-y divide-gray-200">
                        ${snacks.map(snack => `
                            <tr>
                                <td class="px-6 py-4 whitespace-nowrap">
                                    <img src="${snack.imageUrl}" onerror="this.onerror=null;this.src='https://placehold.co/50x50/f97316/ffffff?text=IMG_ERR';" class="w-10 h-10 rounded-full object-cover">
                                </td>
                                <td class="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">${snack.name}</td>
                                <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-500">${snack.category || 'Uncategorized'}</td>
                                <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-500">${formatCurrency(snack.price)}</td>
                                <td class="px-6 py-4 whitespace-nowrap text-sm ${snack.stock < 10 && snack.stock > 0 ? 'text-yellow-600' : (snack.stock === 0 ? 'text-red-600 font-bold' : 'text-gray-500')}">${snack.stock === 0 ? 'Out of Stock' : snack.stock}</td>
                                <td class="px-6 py-4 whitespace-nowrap text-sm font-medium text-center space-x-2">
                                    <button onclick="showSnackForm('${snack.id}')" class="text-blue-600 hover:text-blue-900" title="Edit">
                                        <i data-lucide="square-pen" class="w-5 h-5"></i>
                                    </button>
                                    <button onclick="confirmDeleteSnack('${snack.id}', '${snack.name}')" class="text-red-600 hover:text-red-900" title="Delete">
                                        <i data-lucide="trash-2" class="w-5 h-5"></i>
                                    </button>
                                </td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>
            `;
};

const showSnackForm = (snackId = null) => {
    // ... (Form remains the same)
    const isEditing = !!snackId;
    const snack = isEditing ? snacks.find(s => s.id === snackId) : { name: '', price: 0.00, stock: 0, imageUrl: '', category: '', discount: 0, discountStart: '', discountEnd: '' };

    const formContent = `
                <form id="snack-form" class="space-y-4">
                    <input type="hidden" id="snack-id" value="${snackId || ''}">
                    <div>
                        <label for="snack-name" class="block text-sm font-medium text-gray-700">Name</label>
                        <input type="text" id="snack-name" value="${snack.name}" required class="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-primary focus:ring-primary p-2 border">
                    </div>
                    <div class="grid grid-cols-2 gap-4">
                        <div>
                            <label for="snack-price" class="block text-sm font-medium text-gray-700">Price ($)</label>
                            <input type="number" id="snack-price" value="${snack.price}" step="0.01" min="0" required class="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-primary focus:ring-primary p-2 border">
                        </div>
                        <div>
                            <label for="snack-stock" class="block text-sm font-medium text-gray-700">Stock Count</label>
                            <input type="number" id="snack-stock" value="${snack.stock}" min="0" required class="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-primary focus:ring-primary p-2 border">
                        </div>
                    </div>
                    <div>
                        <label for="snack-category" class="block text-sm font-medium text-gray-700">Category</label>
                        <select id="snack-category" class="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-primary focus:ring-primary p-2 border">
                            <option value="Crispy & Savory" ${snack.category === 'Crispy & Savory' ? 'selected' : ''}>Crispy & Savory</option>
                            <option value="Sweet Treats" ${snack.category === 'Sweet Treats' ? 'selected' : ''}>Sweet Treats</option>
                            <option value="Healthy Fuel" ${snack.category === 'Healthy Fuel' ? 'selected' : ''}>Healthy Fuel</option>
                            <option value="Other" ${snack.category === 'Other' ? 'selected' : ''}>Other</option>
                        </select>
                    </div>
                    <div class="grid grid-cols-3 gap-4">
                        <div>
                            <label for="snack-discount" class="block text-sm font-medium text-gray-700">Discount (%)</label>
                            <input type="number" id="snack-discount" value="${snack.discount || 0}" min="0" max="100" class="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-primary focus:ring-primary p-2 border">
                        </div>
                        <div>
                            <label for="snack-discount-start" class="block text-sm font-medium text-gray-700">Discount Start</label>
                            <input type="datetime-local" id="snack-discount-start" value="${snack.discountStart ? new Date(snack.discountStart).toISOString().slice(0, 16) : ''}" class="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-primary focus:ring-primary p-2 border">
                        </div>
                        <div>
                            <label for="snack-discount-end" class="block text-sm font-medium text-gray-700">Discount End</label>
                            <input type="datetime-local" id="snack-discount-end" value="${snack.discountEnd ? new Date(snack.discountEnd).toISOString().slice(0, 16) : ''}" class="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-primary focus:ring-primary p-2 border">
                        </div>
                    </div>
                    <div>
                        <label for="snack-image-file" class="block text-sm font-medium text-gray-700">Image File (Max 1MB)</label>
                        <input type="file" id="snack-image-file" accept="image/*" class="mt-1 block w-full text-sm text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-primary file:text-white hover:file:bg-orange-600">
                        ${isEditing && snack.imageUrl ? `<img id="snack-image-preview" src="${snack.imageUrl}" class="mt-2 w-16 h-16 object-cover rounded-md" alt="Image Preview">` : `<img id="snack-image-preview" class="mt-2 hidden w-16 h-16 object-cover rounded-md" alt="Image Preview">`}
                        <p class="text-xs text-gray-500 mt-1">Images are converted to Base64 and stored locally for demo purposes (limit 1MB).</p>
                    </div>
                </form>
            `;

    const actions = `
                <button onclick="hideModal()" class="bg-gray-200 text-gray-700 py-2 px-4 rounded-lg font-medium hover:bg-gray-300 transition">Cancel</button>
                <button onclick="saveSnack()" class="bg-primary text-white py-2 px-4 rounded-lg font-medium shadow-md hover:bg-orange-600 transition">${isEditing ? 'Save Changes' : 'Add Snack'}</button>
            `;

    showModal(isEditing ? `Edit Snack: ${snack.name}` : 'Add New Snack', formContent, actions);
};

const saveSnack = async () => {
    const id = document.getElementById('snack-id').value;
    const name = document.getElementById('snack-name').value;
    const price = parseFloat(document.getElementById('snack-price').value);
    const stock = parseInt(document.getElementById('snack-stock').value);
    const category = document.getElementById('snack-category').value;
    const discount = parseFloat(document.getElementById('snack-discount').value) || 0;
    const discountStart = document.getElementById('snack-discount-start').value;
    const discountEnd = document.getElementById('snack-discount-end').value;
    const imageFile = document.getElementById('snack-image-file').files[0];

    let imageUrlBase64 = null;

    if (!name || isNaN(price) || isNaN(stock)) {
        showMessage("Please fill all required fields correctly.", 'error');
        return;
    }

    try {
        const existingSnack = snacks.find(s => s.id === id);

        if (imageFile) {
            imageUrlBase64 = await fileToBase64(imageFile);
        } else if (existingSnack) {
            imageUrlBase64 = existingSnack.imageUrl;
        }

        const snackData = {
            id: id || generateId(),
            name,
            price,
            stock,
            category,
            discount,
            discountStart: discountStart ? new Date(discountStart).toISOString() : null,
            discountEnd: discountEnd ? new Date(discountEnd).toISOString() : null,
            imageUrl: imageUrlBase64 || 'https://placehold.co/50x50/f97316/ffffff?text=SNACK'
        };

        if (id) {
            snackData.id = id;
            await updateViaAPI('snacks', 'update', snackData);
            showMessage(`Snack '${name}' updated successfully!`);
        } else {
            await updateViaAPI('snacks', 'create', snackData);
            showMessage(`Snack '${name}' added successfully!`);
        }
        hideModal();
    } catch (error) {
        console.error("Error saving snack or converting image:", error);
        showMessage(`Error saving snack: ${error.message}`, 'error');
    }
};

const confirmDeleteSnack = (snackId, snackName) => {
    const content = `<p>Are you sure you want to delete the snack <strong>"${snackName}"</strong>? This action cannot be undone.</p>`;
    const actions = `
                <button onclick="hideModal()" class="bg-gray-200 text-gray-700 py-2 px-4 rounded-lg font-medium hover:bg-gray-300 transition">Cancel</button>
                <button onclick="deleteSnack('${snackId}')" class="bg-red-600 text-white py-2 px-4 rounded-lg font-medium shadow-md hover:bg-red-700 transition">Delete Permanently</button>
            `;
    showModal('Confirm Deletion', content, actions);
};

const deleteSnack = async (snackId) => {
    try {
        await updateViaAPI('snacks', 'delete', { id: snackId });
        playDeleteSound();
        showMessage("Snack deleted successfully!");
        hideModal();
    } catch (error) {
        console.error("Error deleting snack:", error);
        showMessage(`Error deleting snack: ${error.message}`, 'error');
    }
};

// --- NEW: Snack Inventory Monitor (Horizontal Cards) ---

/**
 * Toggles a snack's stock status between 0 (Out of Stock) and its last known value.
 * @param {string} snackId - The ID of the snack to toggle.
 */
const toggleSnackStock = async (snackId) => {
    const snack = snacks.find(s => s.id === snackId);
    if (!snack) {
        showMessage("Snack not found.", 'error');
        return;
    }

    let newStock;
    if (snack.stock > 0) {
        // Mark as out of stock (set to 0)
        newStock = 0;
        showMessage(`Snack '${snack.name}' marked as OUT OF STOCK.`, 'warning');
    } else {
        // Restore stock to a default (e.g., 10)
        newStock = 10;
        showMessage(`Snack '${snack.name}' stock restored to ${newStock}.`, 'success');
    }

    // Update via API
    try {
        await updateViaAPI('snacks', 'update', { id: snackId, stock: newStock });
    } catch (error) {
        showMessage(`Error updating stock: ${error.message}`, 'error');
    }
};

const renderSnackInventoryMonitor = () => {
    if (snacks.length === 0) {
        return '<div class="p-8 text-center text-gray-500">No snacks available to monitor.</div>';
    }

    return `
                <h3 class="text-2xl font-semibold mb-6">Snack Inventory Cards (${snacks.length})</h3>
                <p class="text-sm text-gray-600 mb-4">Scroll right to view all items. Use the toggle button to quickly mark items in or out of stock.</p>
                
                <!-- Horizontal Scrollable Container -->
                <div class="flex overflow-x-auto space-x-6 p-4 rounded-xl bg-white shadow-lg border border-gray-100 min-h-64">
                    ${snacks.map(snack => `
                        <div class="flex-none w-72 bg-gray-50 rounded-xl shadow-md overflow-hidden hover:shadow-xl transition duration-300 transform hover:-translate-y-0.5">
                            <div class="relative h-40">
                                <img src="${snack.imageUrl}" 
                                     onerror="this.onerror=null;this.src='https://placehold.co/288x160/1e293b/ffffff?text=${snack.name.replace(/\s/g, '+')}';" 
                                     class="w-full h-full object-cover">
                                <div class="absolute inset-0 bg-black bg-opacity-10"></div>
                                <span class="absolute top-2 right-2 px-3 py-1 text-xs font-bold rounded-full ${snack.stock > 0 ? 'bg-green-600 text-white' : 'bg-red-600 text-white'} shadow-lg">
                                    ${snack.stock > 0 ? `${snack.stock} in Stock` : 'OUT OF STOCK'}
                                </span>
                            </div>
                            
                            <div class="p-4">
                                <h4 class="text-lg font-bold text-secondary truncate mb-1" title="${snack.name}">${snack.name}</h4>
                                <p class="text-2xl font-extrabold text-primary">${formatCurrency(snack.price)}</p>
                                
                                <div class="mt-4 space-y-2">
                                    <button onclick="toggleSnackStock('${snack.id}')" 
                                            class="w-full py-2 rounded-lg text-sm font-semibold transition flex items-center justify-center ${snack.stock > 0 ? 'bg-yellow-500 hover:bg-yellow-600 text-white' : 'bg-green-500 hover:bg-green-600 text-white'}">
                                        <i data-lucide="${snack.stock > 0 ? 'toggle-right' : 'toggle-left'}" class="w-5 h-5 mr-2"></i>
                                        ${snack.stock > 0 ? 'Mark Out of Stock' : 'Restore Stock'}
                                    </button>
                                    
                                    <div class="flex space-x-2">
                                        <button onclick="showSnackForm('${snack.id}')" 
                                                class="flex-1 py-2 rounded-lg text-sm font-semibold bg-blue-500 text-white hover:bg-blue-600 transition flex items-center justify-center">
                                            <i data-lucide="square-pen" class="w-4 h-4 mr-1"></i> Edit
                                        </button>
                                        <button onclick="confirmDeleteSnack('${snack.id}', '${snack.name}')" 
                                                class="flex-1 py-2 rounded-lg text-sm font-semibold bg-red-500 text-white hover:bg-red-600 transition flex items-center justify-center">
                                            <i data-lucide="trash-2" class="w-4 h-4 mr-1"></i> Delete
                                        </button>
                                    </div>
                                </div>
                            </div>
                        </div>
                    `).join('')}
                </div>
            `;
};

// --- 3. User Management View CRUD (Local Mode) ---

const renderUserManagement = () => {
    // ... (HTML structure remains the same)
    return `
                <div class="flex justify-between items-center mb-6">
                    <h3 class="text-2xl font-semibold">Registered Users (${users.length})</h3>
                    <button onclick="showUserForm()" class="bg-primary text-white py-2 px-4 rounded-lg font-medium shadow-md hover:bg-orange-600 transition flex items-center">
                        <i data-lucide="user-plus" class="w-5 h-5 mr-2"></i> Add New User
                    </button>
                </div>
                <div class="bg-white rounded-xl shadow-lg overflow-x-auto">
                    ${renderUsersTable()}
                </div>
            `;
};

const renderUsersTable = () => {
    if (users.length === 0) {
        return '<p class="p-6 text-center text-gray-500">No user profiles found.</p>';
    }
    return `
                <table class="min-w-full divide-y divide-gray-200">
                    <thead class="bg-gray-50">
                        <tr>
                            <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">User ID (Local)</th>
                            <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Name/Email (Mock)</th>
                            <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Last Login</th>
                            <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Status</th>
                            <th class="px-6 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">Actions</th>
                        </tr>
                    </thead>
                    <tbody class="bg-white divide-y divide-gray-200">
                        ${users.map(user => `
                            <tr>
                                <td class="px-6 py-4 whitespace-nowrap text-sm font-mono text-gray-900" title="${user.id}">${user.id.substring(0, 8)}...</td>
                                <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-500">${user.name || 'N/A'} (${user.email || 'N/A'})</td>
                                <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-500">${user.lastLogin}</td>
                                <td class="px-6 py-4 whitespace-nowrap text-sm font-medium">
                                    <span class="px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${user.status === 'Active' ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}">
                                        ${user.status}
                                    </span>
                                </td>
                                <td class="px-6 py-4 whitespace-nowrap text-sm font-medium text-center space-x-2">
                                    <button onclick="showUserForm('${user.id}')" class="text-blue-600 hover:text-blue-900" title="Edit User">
                                        <i data-lucide="square-pen" class="w-5 h-5"></i>
                                    </button>
                                    <button onclick="showDirectMessageForm('${user.id}', '${user.name || user.email || user.id}')" class="text-primary hover:text-orange-600" title="Send Message">
                                        <i data-lucide="message-square" class="w-5 h-5"></i>
                                    </button>
                                    <button onclick="confirmDeleteUser('${user.id}', '${user.name || user.id}')" class="text-red-600 hover:text-red-900" title="Delete User">
                                        <i data-lucide="trash-2" class="w-5 h-5"></i>
                                    </button>
                                </td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>
            `;
};

const showUserForm = (userIdToEdit = null) => {
    // ... (Form remains the same)
    const isEditing = !!userIdToEdit;
    const user = isEditing ? users.find(u => u.id === userIdToEdit) : { id: '', name: '', email: '', status: 'Active' };

    const formContent = `
                <form id="user-form" class="space-y-4">
                    <input type="hidden" id="user-id-edit" value="${userIdToEdit || ''}">
                    ${isEditing ? `<div class="mb-4"><p class="text-xs text-gray-500">User ID: <code class="font-mono break-all">${userIdToEdit}</code></p></div>` : ''}
                    <div>
                        <label for="user-name" class="block text-sm font-medium text-gray-700">Name</label>
                        <input type="text" id="user-name" value="${user.name}" required class="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-primary focus:ring-primary p-2 border">
                    </div>
                    <div>
                        <label for="user-email" class="block text-sm font-medium text-gray-700">Email</label>
                        <input type="email" id="user-email" value="${user.email}" required class="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-primary focus:ring-primary p-2 border">
                    </div>
                    <div>
                        <label for="user-status" class="block text-sm font-medium text-gray-700">Status</label>
                        <select id="user-status" class="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-primary focus:ring-primary p-2 border">
                            <option value="Active" ${user.status === 'Active' ? 'selected' : ''}>Active</option>
                            <option value="Banned" ${user.status === 'Banned' ? 'selected' : ''}>Banned</option>
                        </select>
                    </div>
                    ${!isEditing ? `<div><label for="user-mock-uid" class="block text-sm font-medium text-gray-700">New Local ID (For New User)</label><input type="text" id="user-mock-uid" value="${generateId()}" required class="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-primary focus:ring-primary p-2 border"></div>` : ''}
                </form>
            `;

    const actions = `
                <button onclick="hideModal()" class="bg-gray-200 text-gray-700 py-2 px-4 rounded-lg font-medium hover:bg-gray-300 transition">Cancel</button>
                <button onclick="saveUser()" class="bg-primary text-white py-2 px-4 rounded-lg font-medium shadow-md hover:bg-orange-600 transition">${isEditing ? 'Save Changes' : 'Add User'}</button>
            `;

    showModal(isEditing ? `Edit User: ${user.name || user.email}` : 'Add New User', formContent, actions);
};

const saveUser = async () => {
    const id = document.getElementById('user-id-edit').value;
    const name = document.getElementById('user-name').value;
    const email = document.getElementById('user-email').value;
    const status = document.getElementById('user-status').value;

    if (!name || !email || !status) {
        showMessage("Please fill all user fields.", 'error');
        return;
    }

    const userData = { name, email, status, lastLogin: getTimestamp() };

    try {
        if (id) {
            userData.id = id;
            await updateViaAPI('users', 'update', userData);
            showMessage(`User '${name}' updated successfully!`);
        } else {
            const mockUid = document.getElementById('user-mock-uid').value;
            userData.id = mockUid;
            await updateViaAPI('users', 'create', userData);
            showMessage(`User '${name}' added successfully!`);
        }
        hideModal();
    } catch (error) {
        showMessage(`Error saving user: ${error.message}`, 'error');
    }
};

const confirmDeleteUser = (userIdToDelete, userName) => {
    const content = `<p>Are you sure you want to delete the user <strong>"${userName}"</strong> (ID: ${userIdToDelete.substring(0, 8)}...)? This is permanent.</p>`;
    const actions = `
                <button onclick="hideModal()" class="bg-gray-200 text-gray-700 py-2 px-4 rounded-lg font-medium hover:bg-gray-300 transition">Cancel</button>
                <button onclick="deleteUser('${userIdToDelete}')" class="bg-red-600 text-white py-2 px-4 rounded-lg font-medium shadow-md hover:bg-red-700 transition">Delete User</button>
            `;
    showModal('Confirm User Deletion', content, actions);
};

const deleteUser = async (userIdToDelete) => {
    try {
        await updateViaAPI('users', 'delete', { id: userIdToDelete });
        playDeleteSound();
        showMessage("User profile deleted successfully!");
        hideModal();
    } catch (error) {
        console.error("Error deleting user:", error);
        showMessage(`Error deleting user: ${error.message}`, 'error');
    }
};

// --- 4. Order Monitoring View (Local Mode) ---

const renderOrderMonitoring = () => {
    // ... (HTML structure remains the same)
    return `
                <h3 class="text-2xl font-semibold mb-6">Live Order Feed (${orders.length} Total)</h3>
                <div class="bg-white rounded-xl shadow-lg overflow-x-auto">
                    ${renderOrdersTable(orders, true)}
                </div>
            `;
};

const renderOrdersTable = (orderList, showActions = false) => {
    if (orderList.length === 0) {
        return '<p class="p-6 text-center text-gray-500">No orders found.</p>';
    }

    return `
                <table class="min-w-full divide-y divide-gray-200">
                    <thead class="bg-gray-50">
                        <tr>
                            <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Order ID (Partial)</th>
                            <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">User ID (Local)</th>
                            <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Total</th>
                            <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Status</th>
                            <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Date</th>
                            ${showActions ? '<th class="px-6 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">Details</th>' : ''}
                        </tr>
                    </thead>
                    <tbody class="bg-white divide-y divide-gray-200">
                        ${orderList.map(order => {
        let statusClass = 'bg-gray-100 text-gray-800';
        if (order.status === 'New') statusClass = 'bg-red-100 text-red-800';
        if (order.status === 'Processing') statusClass = 'bg-yellow-100 text-yellow-800';
        if (order.status === 'Delivered') statusClass = 'bg-green-100 text-green-800';

        return `
                                <tr>
                                    <td class="px-6 py-4 whitespace-nowrap text-sm font-mono text-gray-900" title="${order.id}">${order.id.substring(0, 8)}...</td>
                                    <td class="px-6 py-4 whitespace-nowrap text-sm font-mono text-gray-500" title="${order.userId || 'N/A'}">${(order.userId || 'N/A').substring(0, 8)}...</td>
                                    <td class="px-6 py-4 whitespace-nowrap text-sm font-bold text-gray-900">${formatCurrency(order.total || 0)}</td>
                                    <td class="px-6 py-4 whitespace-nowrap">
                                        <span class="px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${statusClass}">
                                            ${order.status}
                                        </span>
                                    </td>
                                    <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-500">${new Date(order.date).toLocaleString()}</td>
                                    ${showActions ? `
                                        <td class="px-6 py-4 whitespace-nowrap text-sm font-medium text-center">
                                            <button onclick="showOrderDetails('${order.id}')" class="text-blue-600 hover:text-blue-900" title="View Details">
                                                <i data-lucide="eye" class="w-5 h-5"></i>
                                            </button>
                                        </td>
                                    ` : ''}
                                </tr>
                            `;
    }).join('')}
                    </tbody>
                </table>
            `;
};

const showOrderDetails = (orderId) => {
    const order = orders.find(o => o.id === orderId);
    if (!order) {
        showMessage("Order not found.", 'error');
        return;
    }

    const itemsList = (order.items || []).map(item => `
                <li class="flex justify-between py-1 border-b border-gray-100">
                    <span class="text-gray-600">${item.name} (x${item.quantity})</span>
                    <span class="font-medium">${formatCurrency(item.price * item.quantity)}</span>
                </li>
            `).join('');

    const content = `
                <div class="space-y-4">
                    <p><strong>Date:</strong> ${new Date(order.date).toLocaleString()}</p>
                    <p><strong>Client ID:</strong> <code class="font-mono break-all">${order.userId || 'N/A'}</code></p>
                    <p><strong>Total Amount:</strong> <span class="text-xl font-bold text-primary">${formatCurrency(order.total || 0)}</span></p>
                    
                    <h4 class="text-lg font-semibold border-b pb-1 mt-4">Items Ordered:</h4>
                    <ul class="space-y-1">${itemsList || '<li class="text-gray-500">No items listed.</li>'}</ul>

                    <div>
                        <label for="order-status-select" class="block text-sm font-medium text-gray-700">Update Status</label>
                        <select id="order-status-select" class="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-primary focus:ring-primary p-2 border">
                            <option value="New" ${order.status === 'New' ? 'selected' : ''}>New</option>
                            <option value="Processing" ${order.status === 'Processing' ? 'selected' : ''}>Processing</option>
                            <option value="Shipped" ${order.status === 'Shipped' ? 'selected' : ''}>Shipped</option>
                            <option value="Delivered" ${order.status === 'Delivered' ? 'selected' : ''}>Delivered</option>
                            <option value="Cancelled" ${order.status === 'Cancelled' ? 'selected' : ''}>Cancelled</option>
                        </select>
                    </div>
                </div>
            `;
    const actions = `
                <button onclick="hideModal()" class="bg-gray-200 text-gray-700 py-2 px-4 rounded-lg font-medium hover:bg-gray-300 transition">Close</button>
                <button onclick="updateOrderStatus('${orderId}')" class="bg-primary text-white py-2 px-4 rounded-lg font-medium shadow-md hover:bg-orange-600 transition">Update Status</button>
            `;
    showModal(`Order Details: ${orderId.substring(0, 8)}...`, content, actions);
};

const updateOrderStatus = async (orderId) => {
    const newStatus = document.getElementById('order-status-select').value;
    try {
        await updateViaAPI('orders', 'update', { id: orderId, status: newStatus });
        showMessage(`Order ${orderId.substring(0, 8)}... status updated to ${newStatus}.`);
        hideModal();
    } catch (error) {
        console.error("Error updating order status:", error);
        showMessage(`Error updating status: ${error.message}`, 'error');
    }
};

// --- 5. Financial Overview View (Local Mode) ---
// ... (Logic remains the same, leveraging local arrays)

const renderFinancialOverview = () => {
    const totalRevenue = orders.reduce((sum, order) => sum + (order.total || 0), 0);
    const deliveredOrders = orders.filter(o => o.status === 'Delivered');
    const deliveredRevenue = deliveredOrders.reduce((sum, order) => sum + (order.total || 0), 0);
    const avgOrderValue = deliveredOrders.length > 0 ? deliveredRevenue / deliveredOrders.length : 0;
    const topSnack = (
        orders.flatMap(o => o.items || [])
            .reduce((acc, item) => {
                acc[item.name] = (acc[item.name] || 0) + (item.quantity || 1);
                return acc;
            }, {})
    );
    const topSnackName = Object.keys(topSnack).length > 0 ? Object.entries(topSnack).sort(([, a], [, b]) => b - a)[0][0] : 'N/A';
    const topSnackCount = Object.keys(topSnack).length > 0 ? Object.entries(topSnack).sort(([, a], [, b]) => b - a)[0][1] : 0;

    return `
                <h3 class="text-2xl font-semibold mb-6">Revenue and Transaction Summary</h3>

                <div class="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
                    ${createMetricCard('Total Revenue (All Orders)', formatCurrency(totalRevenue), 'piggy-bank', 'bg-purple-100 text-purple-600')}
                    ${createMetricCard('Delivered Revenue', formatCurrency(deliveredRevenue), 'check-circle', 'bg-emerald-100 text-emerald-600')}
                    ${createMetricCard('Avg. Order Value (Delivered)', formatCurrency(avgOrderValue), 'trending-up', 'bg-yellow-100 text-yellow-600')}
                </div>

                <div class="bg-white rounded-xl shadow-lg p-6">
                    <h4 class="text-xl font-semibold text-secondary mb-4">Top Performing Items & Metrics</h4>
                    <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div class="p-4 border rounded-lg">
                            <p class="text-gray-500 text-sm">Most Popular Snack</p>
                            <p class="text-lg font-bold">${topSnackName}</p>
                            <p class="text-sm text-gray-600">${topSnackCount} Units Sold</p>
                        </div>
                        <div class="p-4 border rounded-lg">
                            <p class="text-gray-500 text-sm">Transaction Volume</p>
                            <p class="text-lg font-bold">${orders.length} Transactions</p>
                            <p class="text-sm text-gray-600">${deliveredOrders.length} Completed</p>
                        </div>
                    </div>
                    <div class="mt-6 p-4 border rounded-lg bg-gray-50">
                        <p class="font-medium text-lg">Financial Note (Database Mode):</p>
                        <p class="text-sm text-gray-700">This section views transactions based on the database 'orders' data. Real-time financial analysis is supported with persistent storage.</p>
                    </div>
                </div>
            `;
};

// --- 6. Broadcast Center View CRUD (Local Mode) ---

const renderBroadcastCenter = () => {
    return `
                <h3 class="text-2xl font-semibold mb-6">Send Broadcast Message to All Active Users (${users.length} recipients)</h3>
                <div class="bg-white rounded-xl shadow-lg p-6 max-w-2xl mx-auto">
                    <form id="broadcast-form" class="space-y-4">
                        <div>
                            <label for="broadcast-subject" class="block text-sm font-medium text-gray-700">Subject</label>
                            <input type="text" id="broadcast-subject" required class="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-primary focus:ring-primary p-2 border">
                        </div>
                        <div>
                            <label for="broadcast-message" class="block text-sm font-medium text-gray-700">Message Content</label>
                            <textarea id="broadcast-message" rows="6" required class="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-primary focus:ring-primary p-2 border"></textarea>
                        </div>
                        <div class="flex justify-end">
                            <button type="button" onclick="sendBroadcast()" class="bg-primary text-white py-2 px-6 rounded-lg font-medium shadow-lg hover:bg-orange-600 transition flex items-center">
                                <i data-lucide="send-horizontal" class="w-5 h-5 mr-2"></i> Send Broadcast
                            </button>
                        </div>
                    </form>
                </div>
                
                <h3 class="text-xl font-semibold mt-8 mb-4 text-secondary">Recent Broadcasts (Local Log)</h3>
                <div class="bg-white rounded-xl shadow-lg p-4">
                    <p class="text-gray-500 text-sm">Broadcast messages are saved to your browser's local storage.</p>
                    <div id="broadcast-log" class="mt-4 space-y-3">
                        <!-- Broadcasts inserted by renderApp() -->
                    </div>
                </div>
            `;
};

const sendBroadcast = async () => {
    const subject = document.getElementById('broadcast-subject').value;
    const message = document.getElementById('broadcast-message').value;

    if (!subject || !message) {
        showMessage("Subject and message content are required.", 'error');
        return;
    }

    const content = `<p>You are about to send a broadcast message to **${users.length} users**. Confirm?</p><p class="mt-2 text-sm italic">Subject: ${subject}</p>`;
    const actions = `
                <button onclick="hideModal()" class="bg-gray-200 text-gray-700 py-2 px-4 rounded-lg font-medium hover:bg-gray-300 transition">Cancel</button>
                <button onclick="executeBroadcast('${subject}', '${message}')" class="bg-primary text-white py-2 px-4 rounded-lg font-medium shadow-md hover:bg-orange-600 transition">Confirm Send</button>
            `;
    showModal('Confirm Broadcast', content, actions);
};

const executeBroadcast = async (subject, message) => {
    hideModal();
    const broadcastData = {
        fromAdminId: userId,
        subject: subject,
        content: message,
        target: 'ALL_USERS',
        userCount: users.length
    };

    try {
        await updateViaAPI('broadcasts', 'create', broadcastData);
        showMessage(`Broadcast successfully sent to ${users.length} user profiles!`);
        document.getElementById('broadcast-form').reset();
    } catch (error) {
        console.error("Error sending broadcast:", error);
        showMessage(`Error sending broadcast: ${error.message}`, 'error');
    }
};


// --- Direct Messaging Functions ---
let selectedUserForMessaging = null;

const loadUsersForMessaging = async () => {
    try {
        const users = await fetchData('users');
        const usersList = document.getElementById('users-list');
        usersList.innerHTML = users.map(user => `
                    <div onclick="openMessageThread('${user.id}', '${user.name}')" class="p-3 rounded-lg cursor-pointer hover:bg-gray-50 transition border border-gray-200">
                        <div class="flex items-center space-x-3">
                            <div class="w-10 h-10 bg-primary rounded-full flex items-center justify-center text-white font-semibold">
                                ${user.name.charAt(0).toUpperCase()}
                            </div>
                            <div class="flex-1">
                                <div class="font-medium text-secondary">${user.name}</div>
                                <div class="text-sm text-gray-500">${user.email}</div>
                            </div>
                            <div class="text-xs px-2 py-1 rounded-full ${user.status === 'Active' ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}">
                                ${user.status}
                            </div>
                        </div>
                    </div>
                `).join('');
    } catch (error) {
        console.error('Error loading users for messaging:', error);
        showMessage('Error loading users for messaging.', 'error');
    }
};

const openMessageThread = async (userId, userName) => {
    selectedUserForMessaging = userId;
    document.getElementById('message-user-name').textContent = userName;
    document.getElementById('message-placeholder').classList.add('hidden');
    document.getElementById('message-thread').classList.remove('hidden');

    await loadMessageHistory(userId);
};

const closeMessageThread = () => {
    selectedUserForMessaging = null;
    document.getElementById('message-thread').classList.add('hidden');
    document.getElementById('message-placeholder').classList.remove('hidden');
    document.getElementById('message-history').innerHTML = '';
    document.getElementById('message-subject').value = '';
    document.getElementById('message-content').value = '';
};

const loadMessageHistory = async (userId) => {
    try {
        const messages = await fetchData(`messages/${userId}`);
        const messageHistory = document.getElementById('message-history');

        if (messages.length === 0) {
            messageHistory.innerHTML = '<p class="text-center text-gray-500 py-4">No messages yet. Start the conversation!</p>';
            return;
        }

        messageHistory.innerHTML = messages.map(msg => {
            const isFromAdmin = msg.fromUserId === 'admin';
            return `
                        <div class="flex ${isFromAdmin ? 'justify-end' : 'justify-start'} mb-4">
                            <div class="max-w-xs lg:max-w-md px-4 py-2 rounded-lg ${isFromAdmin ? 'bg-primary text-white' : 'bg-gray-200 text-gray-800'}">
                                ${msg.subject ? `<div class="font-semibold text-sm mb-1">${msg.subject}</div>` : ''}
                                <div class="text-sm">${msg.content}</div>
                                <div class="text-xs mt-1 opacity-70">${new Date(msg.timestamp).toLocaleString()}</div>
                            </div>
                        </div>
                    `;
        }).join('');

        // Scroll to bottom
        messageHistory.scrollTop = messageHistory.scrollHeight;
    } catch (error) {
        console.error('Error loading message history:', error);
        showMessage('Error loading message history.', 'error');
    }
};

const sendDirectMessage = async () => {
    if (!selectedUserForMessaging) {
        showMessage('Please select a user first.', 'error');
        return;
    }

    const subject = document.getElementById('message-subject').value.trim();
    const content = document.getElementById('message-content').value.trim();

    if (!content) {
        showMessage('Please enter a message.', 'error');
        return;
    }

    // Send via Socket.IO for real-time delivery
    if (socket && socket.connected) {
        socket.emit('send-message', {
            fromUserId: 'admin',
            toUserId: selectedUserForMessaging,
            subject: subject || null,
            content: content,
            type: 'admin_message'
        });

        // Clear form
        document.getElementById('message-subject').value = '';
        document.getElementById('message-content').value = '';

        showMessage('Message sent successfully!', 'success');
    } else {
        // Fallback to HTTP API
        try {
            await postData('messages', {
                fromUserId: 'admin',
                toUserId: selectedUserForMessaging,
                subject: subject || null,
                content: content,
                type: 'admin_message'
            });

            // Clear form
            document.getElementById('message-subject').value = '';
            document.getElementById('message-content').value = '';

            // Reload message history
            await loadMessageHistory(selectedUserForMessaging);

            showMessage('Message sent successfully!', 'success');
        } catch (error) {
            console.error('Error sending message:', error);
            showMessage('Error sending message.', 'error');
        }
    }
};

document.addEventListener('DOMContentLoaded', () => {
    lucide.createIcons();
});
