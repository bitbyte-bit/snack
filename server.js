const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const cors = require('cors');
const multer = require('multer');
const { v4: uuidv4 } = require('uuid');
const path = require('path');
const { createServer } = require('http');
const { Server } = require('socket.io');

const app = express();
const PORT = process.env.PORT || 5505;

// Create HTTP server and Socket.IO first
const server = createServer(app);
const io = new Server(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

// Middleware
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ limit: '10mb', extended: true }));
app.use(express.static('.')); // Serve static files from current directory

// Multer for file uploads
const storage = multer.memoryStorage();
const upload = multer({ storage: storage, limits: { fileSize: 5 * 1024 * 1024 } }); // 5MB limit

// SQLite database setup
const db = new sqlite3.Database('./snack_dashboard.db', (err) => {
    if (err) {
        console.error('Error opening database:', err.message);
    } else {
        console.log('Connected to SQLite database.');
        initializeDatabase();
    }
});

// Initialize database tables
function initializeDatabase() {
    db.serialize(() => {
        const tables = [
            `CREATE TABLE IF NOT EXISTS snacks (
                 id TEXT PRIMARY KEY,
                 name TEXT NOT NULL,
                 price REAL NOT NULL,
                 stock INTEGER NOT NULL DEFAULT 0,
                 imageUrl TEXT,
                 category TEXT DEFAULT 'Uncategorized',
                 discount REAL DEFAULT 0,
                 discountStart TEXT,
                 discountEnd TEXT,
                 description TEXT,
                 created_at TEXT DEFAULT CURRENT_TIMESTAMP,
                 updated_at TEXT DEFAULT CURRENT_TIMESTAMP
             )`,
            `CREATE TABLE IF NOT EXISTS users (
                 id TEXT PRIMARY KEY,
                 name TEXT NOT NULL,
                 email TEXT NOT NULL UNIQUE,
                 pin TEXT NOT NULL,
                 profilePic TEXT,
                 location TEXT,
                 status TEXT NOT NULL DEFAULT 'Active',
                 lastLogin TEXT,
                 created_at TEXT DEFAULT CURRENT_TIMESTAMP,
                 phone TEXT,
                 address TEXT
             )`,
            `CREATE TABLE IF NOT EXISTS orders (
                 id TEXT PRIMARY KEY,
                 userId TEXT NOT NULL,
                 total REAL NOT NULL,
                 status TEXT NOT NULL DEFAULT 'New',
                 date TEXT NOT NULL,
                 items TEXT NOT NULL,
                 paymentMethod TEXT,
                 deliveryAddress TEXT,
                 phone TEXT,
                 notes TEXT,
                 created_at TEXT DEFAULT CURRENT_TIMESTAMP,
                 FOREIGN KEY (userId) REFERENCES users (id)
             )`,
            `CREATE TABLE IF NOT EXISTS broadcasts (
                 id TEXT PRIMARY KEY,
                 fromAdminId TEXT,
                 subject TEXT NOT NULL,
                 content TEXT NOT NULL,
                 timestamp TEXT NOT NULL,
                 target TEXT DEFAULT 'ALL_USERS',
                 userCount INTEGER DEFAULT 0,
                 status TEXT DEFAULT 'sent',
                 created_at TEXT DEFAULT CURRENT_TIMESTAMP
             )`,
            `CREATE TABLE IF NOT EXISTS messages (
                 id TEXT PRIMARY KEY,
                 fromUserId TEXT NOT NULL,
                 toUserId TEXT NOT NULL,
                 subject TEXT,
                 content TEXT NOT NULL,
                 timestamp TEXT NOT NULL,
                 type TEXT DEFAULT 'message',
                 isRead INTEGER DEFAULT 0,
                 created_at TEXT DEFAULT CURRENT_TIMESTAMP
             )`,
            `CREATE TABLE IF NOT EXISTS payments (
                 id TEXT PRIMARY KEY,
                 orderId TEXT NOT NULL,
                 amount REAL NOT NULL,
                 method TEXT NOT NULL,
                 status TEXT NOT NULL DEFAULT 'pending',
                 transactionId TEXT,
                 timestamp TEXT NOT NULL,
                 created_at TEXT DEFAULT CURRENT_TIMESTAMP,
                 FOREIGN KEY (orderId) REFERENCES orders (id)
             )`,
            `CREATE TABLE IF NOT EXISTS reviews (
                 id TEXT PRIMARY KEY,
                 userId TEXT NOT NULL,
                 snackId TEXT NOT NULL,
                 rating INTEGER NOT NULL CHECK(rating >= 1 AND rating <= 5),
                 comment TEXT,
                 timestamp TEXT NOT NULL,
                 created_at TEXT DEFAULT CURRENT_TIMESTAMP,
                 FOREIGN KEY (userId) REFERENCES users (id),
                 FOREIGN KEY (snackId) REFERENCES snacks (id)
             )`,
            `CREATE TABLE IF NOT EXISTS categories (
                 id TEXT PRIMARY KEY,
                 name TEXT NOT NULL UNIQUE,
                 description TEXT,
                 imageUrl TEXT,
                 sortOrder INTEGER DEFAULT 0,
                 isActive INTEGER DEFAULT 1,
                 created_at TEXT DEFAULT CURRENT_TIMESTAMP
             )`,
            `CREATE TABLE IF NOT EXISTS inventory_log (
                 id TEXT PRIMARY KEY,
                 snackId TEXT NOT NULL,
                 action TEXT NOT NULL,
                 quantity INTEGER NOT NULL,
                 previousStock INTEGER,
                 newStock INTEGER,
                 userId TEXT,
                 timestamp TEXT NOT NULL,
                 notes TEXT,
                 FOREIGN KEY (snackId) REFERENCES snacks (id),
                 FOREIGN KEY (userId) REFERENCES users (id)
             )`,
            `CREATE TABLE IF NOT EXISTS notifications (
                 id TEXT PRIMARY KEY,
                 userId TEXT,
                 title TEXT NOT NULL,
                 message TEXT NOT NULL,
                 type TEXT DEFAULT 'info',
                 isRead INTEGER DEFAULT 0,
                 timestamp TEXT NOT NULL,
                 created_at TEXT DEFAULT CURRENT_TIMESTAMP,
                 FOREIGN KEY (userId) REFERENCES users (id)
             )`,
            `CREATE TABLE IF NOT EXISTS app_settings (
                 key TEXT PRIMARY KEY,
                 value TEXT NOT NULL,
                 description TEXT,
                 updated_at TEXT DEFAULT CURRENT_TIMESTAMP
             )`
        ];

        tables.forEach(sql => {
            db.run(sql, (err) => {
                if (err) console.error('Error creating table:', err.message);
            });
        });

        // Seed initial data if tables are empty
        seedData();
    });
}

// Seed data - Database starts with sample data for testing
function seedData() {
    // Seed essential app settings
    const checkSettings = 'SELECT COUNT(*) as count FROM app_settings';
    db.get(checkSettings, [], (err, row) => {
        if (err) return console.error(err.message);
        if (row.count === 0) {
            const settings = [
                { key: 'app_name', value: 'Maricafe', description: 'Application name' },
                { key: 'app_version', value: '2.0.0', description: 'Current application version' },
                { key: 'contact_email', value: 'support@maricafe.com', description: 'Support email address' },
                { key: 'contact_phone', value: '+256744759181', description: 'Support phone number' },
                { key: 'business_hours', value: 'Mon-Sun: 8AM-10PM', description: 'Business operating hours' },
                { key: 'delivery_fee', value: '2.50', description: 'Standard delivery fee' },
                { key: 'cod_surcharge', value: '3', description: 'Cash on delivery surcharge percentage' },
                { key: 'max_order_value', value: '500', description: 'Maximum order value allowed' }
            ];

            const insertSetting = 'INSERT INTO app_settings (key, value, description) VALUES (?, ?, ?)';
            settings.forEach(setting => {
                db.run(insertSetting, [setting.key, setting.value, setting.description]);
            });
        }
    });

    // Seed sample snacks for testing
    const checkSnacks = 'SELECT COUNT(*) as count FROM snacks';
    db.get(checkSnacks, [], (err, row) => {
        if (err) return console.error(err.message);
        if (row.count === 0) {
            const sampleSnacks = [
                {
                    id: 'snack-001',
                    name: 'Classic Chocolate Chip Cookies',
                    price: 5.99,
                    stock: 50,
                    imageUrl: 'https://placehold.co/400x200/8b5cf6/f1f5f9?text=Chocolate+Chip+Cookies',
                    category: 'Baked Goods',
                    description: 'Freshly baked chocolate chip cookies with premium chocolate chunks.',
                    discount: 0
                },
                {
                    id: 'snack-002',
                    name: 'Artisan Potato Chips',
                    price: 3.49,
                    stock: 75,
                    imageUrl: 'https://placehold.co/400x200/f97316/f1f5f9?text=Potato+Chips',
                    category: 'Chips & Crisps',
                    description: 'Crispy potato chips made with locally sourced potatoes.',
                    discount: 10
                },
                {
                    id: 'snack-003',
                    name: 'Premium Mixed Nuts',
                    price: 8.99,
                    stock: 30,
                    imageUrl: 'https://placehold.co/400x200/10b981/f1f5f9?text=Mixed+Nuts',
                    category: 'Nuts & Dried Fruits',
                    description: 'A perfect blend of almonds, walnuts, cashews, and pistachios.',
                    discount: 0
                },
                {
                    id: 'snack-004',
                    name: 'Strawberry Yogurt Parfait',
                    price: 4.99,
                    stock: 40,
                    imageUrl: 'https://placehold.co/400x200/ec4899/f1f5f9?text=Yogurt+Parfait',
                    category: 'Dairy & Yogurt',
                    description: 'Layers of Greek yogurt, fresh strawberries, and granola.',
                    discount: 5
                },
                {
                    id: 'snack-005',
                    name: 'Energy Trail Mix',
                    price: 6.49,
                    stock: 60,
                    imageUrl: 'https://placehold.co/400x200/f59e0b/f1f5f9?text=Trail+Mix',
                    category: 'Nuts & Dried Fruits',
                    description: 'Energizing mix of nuts, seeds, and dried fruits.',
                    discount: 0
                },
                {
                    id: 'snack-006',
                    name: 'Blueberry Muffins',
                    price: 4.29,
                    stock: 25,
                    imageUrl: 'https://placehold.co/400x200/3b82f6/f1f5f9?text=Blueberry+Muffins',
                    category: 'Baked Goods',
                    description: 'Moist blueberry muffins baked fresh daily.',
                    discount: 15
                }
            ];

            const insertSnack = 'INSERT INTO snacks (id, name, price, stock, imageUrl, category, description, discount, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)';
            const now = new Date().toISOString();
            sampleSnacks.forEach(snack => {
                db.run(insertSnack, [snack.id, snack.name, snack.price, snack.stock, snack.imageUrl, snack.category, snack.description, snack.discount, now, now]);
            });
        }
    });
}

// API Routes

// Snacks
app.get('/api/snacks', (req, res) => {
    db.all('SELECT * FROM snacks', [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

app.post('/api/snacks', (req, res) => {
    const { name, price, stock, imageUrl, category, description, discount } = req.body;
    const id = uuidv4();
    const created_at = new Date().toISOString();
    const updated_at = created_at;

    db.run('INSERT INTO snacks (id, name, price, stock, imageUrl, category, description, discount, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [id, name, price || 0, stock || 0, imageUrl || '', category || 'Uncategorized', description || '', discount || 0, created_at, updated_at], function (err) {
            if (err) {
                console.error('Error adding snack:', err);
                return res.status(500).json({ error: err.message });
            }

            const newSnack = { id, name, price: price || 0, stock: stock || 0, imageUrl: imageUrl || '', category: category || 'Uncategorized', description: description || '', discount: discount || 0 };

            // Emit real-time notification to all connected users
            io.emit('snack-notification', {
                type: 'new_snack',
                title: 'New Snack Available!',
                message: `${name} is now available for $${price || 0}`,
                snack: newSnack
            });

            res.json(newSnack);
        });
});

app.put('/api/snacks/:id', (req, res) => {
    const { name, price, stock, imageUrl } = req.body;
    db.run('UPDATE snacks SET name = ?, price = ?, stock = ?, imageUrl = ? WHERE id = ?',
        [name, price, stock, imageUrl, req.params.id], function (err) {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ message: 'Snack updated' });
        });
});

app.delete('/api/snacks/:id', (req, res) => {
    db.run('DELETE FROM snacks WHERE id = ?', [req.params.id], function (err) {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ message: 'Snack deleted' });
    });
});

// Authentication
app.post('/api/auth/login', (req, res) => {
    const { pin } = req.body;
    if (!pin) return res.status(400).json({ error: 'PIN required' });

    db.get('SELECT * FROM users WHERE pin = ? AND status = "Active"', [pin], (err, row) => {
        if (err) return res.status(500).json({ error: err.message });
        if (!row) return res.status(401).json({ error: 'Invalid credentials' });

        // Update last login
        db.run('UPDATE users SET lastLogin = ? WHERE id = ?', [new Date().toISOString(), row.id]);

        res.json({
            id: row.id,
            name: row.name,
            email: row.email,
            pin: row.pin,
            profilePic: row.profilePic,
            location: row.location,
            status: row.status,
            lastLogin: row.lastLogin
        });
    });
});

app.post('/api/auth/register', (req, res) => {
    const { name, email, pin, location } = req.body;
    if (!name || !email || !pin) return res.status(400).json({ error: 'Name, email, and PIN required' });
    if (pin.length !== 4 || isNaN(pin)) return res.status(400).json({ error: 'PIN must be 4 digits' });

    // Check if PIN already exists
    db.get('SELECT id FROM users WHERE pin = ?', [pin], (err, row) => {
        if (err) return res.status(500).json({ error: err.message });
        if (row) return res.status(409).json({ error: 'PIN already exists' });

        const id = uuidv4();
        db.run('INSERT INTO users (id, name, email, pin, profilePic, location, status, lastLogin) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
            [id, name, email, pin, null, location || '', 'Active', new Date().toISOString()], function (err) {
                if (err) return res.status(500).json({ error: err.message });
                res.json({ id, name, email, pin, location, status: 'Active' });
            });
    });
});

// Users
app.get('/api/users', (req, res) => {
    db.all('SELECT * FROM users', [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

app.post('/api/users', (req, res) => {
    const { id, name, email, pin, profilePic, location, status, lastLogin } = req.body;
    db.run('INSERT INTO users (id, name, email, pin, profilePic, location, status, lastLogin) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        [id, name, email, pin, profilePic, location, status, lastLogin], function (err) {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ id, name, email, pin, profilePic, location, status, lastLogin });
        });
});

app.put('/api/users/:id', (req, res) => {
    const { name, email, pin, profilePic, location, status, lastLogin } = req.body;
    db.run('UPDATE users SET name = ?, email = ?, pin = ?, profilePic = ?, location = ?, status = ?, lastLogin = ? WHERE id = ?',
        [name, email, pin, profilePic, location, status, lastLogin, req.params.id], function (err) {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ message: 'User updated' });
        });
});

// Update user profile with file upload
app.put('/api/users/:id/profile', upload.single('profilePic'), (req, res) => {
    const { name, email, location } = req.body;
    let profilePic = null;

    if (req.file) {
        profilePic = req.file.buffer.toString('base64');
    }

    db.run('UPDATE users SET name = ?, email = ?, profilePic = ?, location = ? WHERE id = ?',
        [name, email, profilePic, location, req.params.id], function (err) {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ message: 'Profile updated' });
        });
});

app.delete('/api/users/:id', (req, res) => {
    db.run('DELETE FROM users WHERE id = ?', [req.params.id], function (err) {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ message: 'User deleted' });
    });
});

// Orders
app.get('/api/orders', (req, res) => {
    db.all('SELECT * FROM orders ORDER BY date DESC', [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        // Parse items JSON
        rows.forEach(row => {
            if (row.items) row.items = JSON.parse(row.items);
        });
        res.json(rows);
    });
});

app.post('/api/orders', (req, res) => {
    const { userId, total, items, paymentMethod } = req.body;
    if (!userId || !items || items.length === 0) return res.status(400).json({ error: 'User ID and items required' });

    const id = uuidv4();
    const date = new Date().toISOString();
    const status = paymentMethod === 'cod' ? 'Pending Payment' : 'New';

    db.run('INSERT INTO orders (id, userId, total, status, date, items) VALUES (?, ?, ?, ?, ?, ?)',
        [id, userId, total, status, date, JSON.stringify(items)], function (err) {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ id, userId, total, status, date, items });
        });
});

app.put('/api/orders/:id', (req, res) => {
    const { status } = req.body;
    db.run('UPDATE orders SET status = ? WHERE id = ?',
        [status, req.params.id], function (err) {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ message: 'Order updated' });
        });
});
                      
// Broadcasts
app.get('/api/broadcasts', (req, res) => {
    db.all('SELECT * FROM broadcasts ORDER BY timestamp DESC', [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

app.post('/api/broadcasts', (req, res) => {
    const { fromAdminId, subject, content, target, userCount } = req.body;
    const id = uuidv4();
    const timestamp = new Date().toISOString();
    db.run('INSERT INTO broadcasts (id, fromAdminId, subject, content, timestamp, target, userCount) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [id, fromAdminId, subject, content, timestamp, target, userCount], function (err) {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ id, fromAdminId, subject, content, timestamp, target, userCount });
        });
});

// Messages
app.get('/api/messages/admin', (req, res) => {
    db.all('SELECT * FROM messages WHERE toUserId = "admin" ORDER BY timestamp DESC', [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

app.get('/api/messages/:userId', (req, res) => {
    const userId = req.params.userId;
    db.all('SELECT * FROM messages WHERE toUserId = ? OR fromUserId = ? ORDER BY timestamp DESC', [userId, userId], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

app.post('/api/messages', (req, res) => {
    const { fromUserId, toUserId, subject, content, type } = req.body;
    const id = uuidv4();
    const timestamp = new Date().toISOString();
    db.run('INSERT INTO messages (id, fromUserId, toUserId, subject, content, timestamp, type) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [id, fromUserId, toUserId, subject, content, timestamp, type], function (err) {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ id, fromUserId, toUserId, subject, content, timestamp, type });
        });
});

app.put('/api/messages/:id/read', (req, res) => {
    db.run('UPDATE messages SET isRead = 1 WHERE id = ?', [req.params.id], function (err) {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ message: 'Message marked as read' });
    });
});


// Payments
app.get('/api/payments', (req, res) => {
    db.all('SELECT * FROM payments ORDER BY timestamp DESC', [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

app.post('/api/payments', (req, res) => {
    const { orderId, amount, method, status, transactionId } = req.body;
    const id = uuidv4();
    const timestamp = new Date().toISOString();
    db.run('INSERT INTO payments (id, orderId, amount, method, status, transactionId, timestamp) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [id, orderId, amount, method, status || 'pending', transactionId, timestamp], function (err) {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ id, orderId, amount, method, status, transactionId, timestamp });
        });
});

// Reviews
app.get('/api/reviews', (req, res) => {
    const { snackId } = req.query;
    let query = 'SELECT * FROM reviews ORDER BY timestamp DESC';
    let params = [];

    if (snackId) {
        query = 'SELECT * FROM reviews WHERE snackId = ? ORDER BY timestamp DESC';
        params = [snackId];
    }

    db.all(query, params, (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

app.post('/api/reviews', (req, res) => {
    const { userId, snackId, rating, comment } = req.body;
    const id = uuidv4();
    const timestamp = new Date().toISOString();
    db.run('INSERT INTO reviews (id, userId, snackId, rating, comment, timestamp) VALUES (?, ?, ?, ?, ?, ?)',
        [id, userId, snackId, rating, comment, timestamp], function (err) {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ id, userId, snackId, rating, comment, timestamp });
        });
});

// Categories
app.get('/api/categories', (req, res) => {
    db.all('SELECT * FROM categories WHERE isActive = 1 ORDER BY sortOrder, name', [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

app.post('/api/categories', (req, res) => {
    const { name, description, imageUrl, sortOrder } = req.body;
    const id = uuidv4();
    db.run('INSERT INTO categories (id, name, description, imageUrl, sortOrder) VALUES (?, ?, ?, ?, ?)',
        [id, name, description, imageUrl, sortOrder || 0], function (err) {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ id, name, description, imageUrl, sortOrder });
        });
});

// Inventory Log
app.get('/api/inventory-log', (req, res) => {
    const { snackId, limit = 50 } = req.query;
    let query = 'SELECT * FROM inventory_log ORDER BY timestamp DESC LIMIT ?';
    let params = [limit];

    if (snackId) {
        query = 'SELECT * FROM inventory_log WHERE snackId = ? ORDER BY timestamp DESC LIMIT ?';
        params = [snackId, limit];
    }

    db.all(query, params, (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

// Notifications
app.get('/api/notifications/:userId', (req, res) => {
    db.all('SELECT * FROM notifications WHERE userId = ? OR userId IS NULL ORDER BY timestamp DESC LIMIT 50',
        [req.params.userId], (err, rows) => {
            if (err) return res.status(500).json({ error: err.message });
            res.json(rows);
        });
});

app.post('/api/notifications', (req, res) => {
    const { userId, title, message, type } = req.body;
    const id = uuidv4();
    const timestamp = new Date().toISOString();
    db.run('INSERT INTO notifications (id, userId, title, message, type, timestamp) VALUES (?, ?, ?, ?, ?, ?)',
        [id, userId, title, message, type || 'info', timestamp], function (err) {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ id, userId, title, message, type, timestamp });
        });
});

app.put('/api/notifications/:id/read', (req, res) => {
    db.run('UPDATE notifications SET isRead = 1 WHERE id = ?', [req.params.id], function (err) {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ message: 'Notification marked as read' });
    });
});

// App Settings
app.get('/api/settings', (req, res) => {
    db.all('SELECT * FROM app_settings', [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        const settings = {};
        rows.forEach(row => {
            settings[row.key] = row.value;
        });
        res.json(settings);
    });
});

app.put('/api/settings/:key', (req, res) => {
    const { value, description } = req.body;
    db.run('INSERT OR REPLACE INTO app_settings (key, value, description, updated_at) VALUES (?, ?, ?, ?)',
        [req.params.key, value, description, new Date().toISOString()], function (err) {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ key: req.params.key, value, description });
        });
});

// Analytics/Dashboard Data
app.get('/api/analytics/summary', (req, res) => {
    const queries = {
        totalUsers: 'SELECT COUNT(*) as count FROM users',
        totalOrders: 'SELECT COUNT(*) as count FROM orders',
        totalRevenue: 'SELECT SUM(total) as total FROM orders WHERE status IN ("Delivered", "Completed")',
        pendingOrders: 'SELECT COUNT(*) as count FROM orders WHERE status = "New"',
        lowStockItems: 'SELECT COUNT(*) as count FROM snacks WHERE stock < 10',
        activeUsers: 'SELECT COUNT(DISTINCT userId) as count FROM orders WHERE date >= date("now", "-30 days")'
    };

    const results = {};

    const promises = Object.entries(queries).map(([key, query]) => {
        return new Promise((resolve, reject) => {
            db.get(query, [], (err, row) => {
                if (err) reject(err);
                else resolve({ key, value: row.count || row.total || 0 });
            });
        });
    });

    Promise.all(promises).then(data => {
        data.forEach(({ key, value }) => {
            results[key] = value;
        });
        res.json(results);
    }).catch(err => {
        res.status(500).json({ error: err.message });
    });
});

// Serve cafe.html
app.get('/cafe', (req, res) => {
    res.sendFile(__dirname + '/cafe.html');
});

// Socket.IO connection handling
io.on('connection', (socket) => {
    console.log('User connected:', socket.id);

    // Join user room for personalized notifications
    socket.on('join-user', (userId) => {
        socket.join(`user_${userId}`);
        console.log(`User ${userId} joined their room`);
    });

    // Join admin room
    socket.on('join-admin', () => {
        socket.join('admin');
        console.log('Admin joined admin room');
    });

    // Handle real-time messaging
    socket.on('send-message', async (data) => {
        try {
            const { fromUserId, toUserId, subject, content, type } = data;
            const id = uuidv4();
            const timestamp = new Date().toISOString();

            // Save to database
            db.run('INSERT INTO messages (id, fromUserId, toUserId, subject, content, timestamp, type) VALUES (?, ?, ?, ?, ?, ?, ?)',
                [id, fromUserId, toUserId, subject, content, timestamp, type]);

            // Emit to recipient
            const messageData = { id, fromUserId, toUserId, subject, content, timestamp, type, isRead: 0 };
            io.to(`user_${toUserId}`).emit('new-message', messageData);

            // If message is to admin, also emit to admin room
            if (toUserId === 'admin') {
                io.to('admin').emit('new-message', messageData);
            }

            // Emit to sender for confirmation
            socket.emit('message-sent', messageData);
        } catch (error) {
            console.error('Error sending message:', error);
            socket.emit('message-error', { error: 'Failed to send message' });
        }
    });

    // Handle new snack notifications
    socket.on('new-snack-added', (snackData) => {
        // Broadcast to all connected users
        io.emit('snack-notification', {
            type: 'new_snack',
            title: 'New Snack Available!',
            message: `${snackData.name} is now available for $${snackData.price}`,
            snack: snackData
        });
    });

    // Handle order updates
    socket.on('order-update', (orderData) => {
        io.to(`user_${orderData.userId}`).emit('order-status-update', orderData);
    });

    socket.on('disconnect', () => {
        console.log('User disconnected:', socket.id);
    });
});

// Start server
server.listen(PORT, () => {
    console.log(`Server running on port ${PORT} with Socket.IO`);
});