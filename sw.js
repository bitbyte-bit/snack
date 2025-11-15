const CACHE_NAME = 'maricafe-v2.0';
const STATIC_CACHE = 'maricafe-static-v2.0';
const DYNAMIC_CACHE = 'maricafe-dynamic-v2.0';
const API_CACHE = 'maricafe-api-v2.0';

// Static assets to cache
const STATIC_ASSETS = [
  '/cafe',
  '/manifest.json',
  '/style.css',
  'https://fonts.googleapis.com/icon?family=Material+Icons',
  'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.0.0-beta3/css/all.min.css',
  'https://cdnjs.cloudflare.com/ajax/libs/tone/14.8.49/Tone.min.js'
];

// API endpoints to cache
const API_ENDPOINTS = [
  '/api/snacks'
];

// Install event - cache static assets
self.addEventListener('install', event => {
  console.log('[SW] Installing service worker');
  event.waitUntil(
    Promise.all([
      caches.open(STATIC_CACHE).then(cache => {
        console.log('[SW] Caching static assets');
        return cache.addAll(STATIC_ASSETS);
      }),
      // Skip waiting to activate immediately
      self.skipWaiting()
    ])
  );
});

// Activate event - clean up old caches
self.addEventListener('activate', event => {
  console.log('[SW] Activating service worker');
  event.waitUntil(
    Promise.all([
      // Clean up old caches
      caches.keys().then(cacheNames => {
        return Promise.all(
          cacheNames.map(cacheName => {
            if (cacheName !== STATIC_CACHE && cacheName !== DYNAMIC_CACHE && cacheName !== API_CACHE) {
              console.log('[SW] Deleting old cache:', cacheName);
              return caches.delete(cacheName);
            }
          })
        );
      }),
      // Take control of all clients
      self.clients.claim()
    ])
  );
});

// Fetch event - handle different types of requests
self.addEventListener('fetch', event => {
  const { request } = event;
  const url = new URL(request.url);

  // Handle API requests
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(handleApiRequest(request));
    return;
  }

  // Handle static assets
  if (STATIC_ASSETS.some(asset => request.url.includes(asset))) {
    event.respondWith(
      caches.match(request).then(response => {
        return response || fetch(request).then(response => {
          // Cache successful responses
          if (response.status === 200) {
            const responseClone = response.clone();
            caches.open(STATIC_CACHE).then(cache => {
              cache.put(request, responseClone);
            });
          }
          return response;
        });
      })
    );
    return;
  }

  // Handle other requests with cache-first strategy
  event.respondWith(
    caches.match(request).then(response => {
      if (response) {
        return response;
      }

      return fetch(request).then(response => {
        // Don't cache non-GET requests or error responses
        if (request.method !== 'GET' || !response.ok) {
          return response;
        }

        // Cache successful responses
        const responseClone = response.clone();
        caches.open(DYNAMIC_CACHE).then(cache => {
          cache.put(request, responseClone);
        });

        return response;
      }).catch(() => {
        // Return offline fallback for navigation requests
        if (request.mode === 'navigate') {
          return caches.match('/cafe');
        }
      });
    })
  );
});

// Handle API requests with network-first strategy
async function handleApiRequest(request) {
  try {
    // Try network first
    const response = await fetch(request);

    // Cache successful GET responses
    if (request.method === 'GET' && response.ok) {
      const responseClone = response.clone();
      caches.open(API_CACHE).then(cache => {
        cache.put(request, responseClone);
      });
    }

    return response;
  } catch (error) {
    // Fallback to cache for GET requests
    if (request.method === 'GET') {
      const cachedResponse = await caches.match(request);
      if (cachedResponse) {
        return cachedResponse;
      }
    }

    // Return offline response for API calls
    return new Response(JSON.stringify({
      error: 'Offline',
      message: 'You are currently offline. Please check your internet connection.'
    }), {
      status: 503,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}

// Push notifications
self.addEventListener('push', event => {
  console.log('[SW] Push received:', event);

  let data = {};
  if (event.data) {
    try {
      data = event.data.json();
    } catch (e) {
      data = { body: event.data.text() };
    }
  }

  const options = {
    body: data.body || 'New update from Maricafe!',
    icon: 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 192 192" fill="%23f1f5f9"><circle cx="96" cy="96" r="88" fill="%231e293b"/><text x="96" y="120" font-family="Arial, sans-serif" font-size="120" text-anchor="middle" fill="%23f1f5f9">☕</text></svg>',
    badge: 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 192 192" fill="%23f1f5f9"><circle cx="96" cy="96" r="88" fill="%231e293b"/><text x="96" y="120" font-family="Arial, sans-serif" font-size="120" text-anchor="middle" fill="%23f1f5f9">☕</text></svg>',
    vibrate: [200, 100, 200],
    data: data.data || {},
    actions: data.actions || [],
    requireInteraction: true,
    silent: false
  };

  event.waitUntil(
    self.registration.showNotification(data.title || 'Maricafe', options)
  );
});

// Notification click handler
self.addEventListener('notificationclick', event => {
  console.log('[SW] Notification clicked:', event);
  event.notification.close();

  const action = event.action;
  const data = event.notification.data || {};

  if (action === 'view') {
    event.waitUntil(
      clients.openWindow(data.url || '/cafe')
    );
  } else {
    // Default action - open app
    event.waitUntil(
      clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clientList => {
        if (clientList.length > 0) {
          return clientList[0].focus();
        }
        return clients.openWindow('/cafe');
      })
    );
  }
});

// Background sync for offline orders and resource updates
self.addEventListener('sync', event => {
  console.log('[SW] Background sync:', event.tag);

  if (event.tag === 'sync-orders') {
    event.waitUntil(syncPendingOrders());
  }

  if (event.tag === 'sync-resources') {
    event.waitUntil(syncAllResources());
  }

  if (event.tag === 'sync-messages') {
    event.waitUntil(syncMessages());
  }
});

// Periodic background sync (if supported)
self.addEventListener('periodicsync', event => {
  console.log('[SW] Periodic sync:', event.tag);

  if (event.tag === 'update-products') {
    event.waitUntil(updateProductCache());
  }

  if (event.tag === 'update-resources') {
    event.waitUntil(updateAllResources());
  }

  if (event.tag === 'check-updates') {
    event.waitUntil(checkForUpdates());
  }
});

// Sync pending orders
async function syncPendingOrders() {
  try {
    // Get pending orders from IndexedDB or similar
    // This would need to be implemented based on your offline storage strategy
    console.log('[SW] Syncing pending orders...');

    // For now, just log - implement based on your offline storage
    return Promise.resolve();
  } catch (error) {
    console.error('[SW] Error syncing orders:', error);
  }
}

// Update product cache
async function updateProductCache() {
  try {
    console.log('[SW] Updating product cache...');

    const response = await fetch('/api/snacks');
    if (response.ok) {
      const cache = await caches.open(API_CACHE);
      await cache.put('/api/snacks', response);
      console.log('[SW] Product cache updated');

      // Notify clients about cache update
      notifyClients('cache-updated', { type: 'products' });
    }
  } catch (error) {
    console.error('[SW] Error updating product cache:', error);
  }
}

// Sync all resources when coming back online
async function syncAllResources() {
  console.log('[SW] Syncing all resources...');

  try {
    await Promise.all([
      updateProductCache(),
      syncMessages(),
      updateUserData(),
      updateOrders()
    ]);

    // Notify clients that sync is complete
    notifyClients('sync-complete', { timestamp: Date.now() });

    console.log('[SW] All resources synced successfully');
  } catch (error) {
    console.error('[SW] Error syncing resources:', error);
  }
}

// Sync messages
async function syncMessages() {
  try {
    console.log('[SW] Syncing messages...');

    // Get current user from clients
    const clients = await self.clients.matchAll();
    let currentUser = null;

    for (const client of clients) {
      try {
        const userData = await getClientData(client, 'currentUser');
        if (userData) {
          currentUser = userData;
          break;
        }
      } catch (e) {
        // Continue to next client
      }
    }

    if (currentUser) {
      const response = await fetch(`/api/messages/${currentUser.id}`);
      if (response.ok) {
        const cache = await caches.open(API_CACHE);
        await cache.put(`/api/messages/${currentUser.id}`, response);
        console.log('[SW] Messages synced');

        // Notify client about new messages
        notifyClients('messages-synced', { userId: currentUser.id });
      }
    }
  } catch (error) {
    console.error('[SW] Error syncing messages:', error);
  }
}

// Update user data
async function updateUserData() {
  try {
    console.log('[SW] Updating user data...');

    const clients = await self.clients.matchAll();
    for (const client of clients) {
      try {
        const userData = await getClientData(client, 'currentUser');
        if (userData) {
          const response = await fetch(`/api/users/${userData.id}`);
          if (response.ok) {
            const cache = await caches.open(API_CACHE);
            await cache.put(`/api/users/${userData.id}`, response);
            console.log('[SW] User data updated');
          }
        }
      } catch (e) {
        // Continue to next client
      }
    }
  } catch (error) {
    console.error('[SW] Error updating user data:', error);
  }
}

// Update orders
async function updateOrders() {
  try {
    console.log('[SW] Updating orders...');

    const response = await fetch('/api/orders');
    if (response.ok) {
      const cache = await caches.open(API_CACHE);
      await cache.put('/api/orders', response);
      console.log('[SW] Orders updated');
    }
  } catch (error) {
    console.error('[SW] Error updating orders:', error);
  }
}

// Update all resources periodically
async function updateAllResources() {
  console.log('[SW] Periodic resource update...');

  try {
    await Promise.all([
      updateProductCache(),
      updateStaticAssets(),
      checkForNewVersions()
    ]);

    console.log('[SW] Periodic update complete');
  } catch (error) {
    console.error('[SW] Error in periodic update:', error);
  }
}

// Update static assets
async function updateStaticAssets() {
  try {
    console.log('[SW] Updating static assets...');

    const cache = await caches.open(STATIC_CACHE);
    const updatePromises = STATIC_ASSETS.map(async (asset) => {
      try {
        const response = await fetch(asset, { cache: 'no-cache' });
        if (response.ok) {
          await cache.put(asset, response);
        }
      } catch (error) {
        console.warn(`[SW] Failed to update ${asset}:`, error);
      }
    });

    await Promise.all(updatePromises);
    console.log('[SW] Static assets updated');
  } catch (error) {
    console.error('[SW] Error updating static assets:', error);
  }
}

// Check for updates
async function checkForUpdates() {
  try {
    console.log('[SW] Checking for updates...');

    // Check if there's a new service worker version
    const response = await fetch('/manifest.json', { cache: 'no-cache' });
    if (response.ok) {
      const manifest = await response.json();
      const currentVersion = '2.0.0'; // This should match the app version

      if (manifest.version !== currentVersion) {
        console.log('[SW] New version available:', manifest.version);
        notifyClients('update-available', { newVersion: manifest.version });
      }
    }
  } catch (error) {
    console.error('[SW] Error checking for updates:', error);
  }
}

// Helper function to get data from client
async function getClientData(client, key) {
  return new Promise((resolve) => {
    const channel = new MessageChannel();
    channel.port1.onmessage = (event) => {
      resolve(event.data[key]);
    };

    client.postMessage({ type: 'GET_DATA', key }, [channel.port2]);

    // Timeout after 1 second
    setTimeout(() => resolve(null), 1000);
  });
}

// Notify all clients
function notifyClients(type, data) {
  self.clients.matchAll().then(clients => {
    clients.forEach(client => {
      client.postMessage({ type, data });
    });
  });
}

// Message handler for communication with main thread
self.addEventListener('message', event => {
  console.log('[SW] Message received:', event.data);

  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }

  if (event.data && event.data.type === 'GET_VERSION') {
    event.ports[0].postMessage({ version: '2.0.0' });
  }
});