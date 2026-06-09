const express = require('express');
const session = require('express-session');
const axios = require('axios');
const bcrypt = require('bcryptjs');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// ── Middleware ──
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));
app.use(session({
  secret: process.env.SESSION_SECRET || 'gsmshop-secret-2026',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 24 * 60 * 60 * 1000 }
}));

// ── Data helpers ──
const DATA_DIR = path.join(__dirname, 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR);

function readJSON(file, def = []) {
  const p = path.join(DATA_DIR, file);
  if (!fs.existsSync(p)) return def;
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return def; }
}
function writeJSON(file, data) {
  fs.writeFileSync(path.join(DATA_DIR, file), JSON.stringify(data, null, 2));
}

// ── Init defaults ──
if (!readJSON('settings.json', null)) {
  writeJSON('settings.json', { apiUrl: 'https://norgsm.com/public', apiUser: '', apiKey: '', shopName: 'MyGSM Shop', currency: 'USD' });
}
if (readJSON('users.json').length === 0) {
  writeJSON('users.json', []);
}
if (readJSON('orders.json').length === 0) {
  writeJSON('orders.json', []);
}

// ── Auth helpers ──
const ADMIN_USER = process.env.ADMIN_USER || 'JEPFX';
const ADMIN_PASS = process.env.ADMIN_PASS || 'JEPFXADMIN';

function requireAdmin(req, res, next) {
  if (req.session.isAdmin) return next();
  res.redirect('/admin/login');
}
function requireUser(req, res, next) {
  if (req.session.userId) return next();
  res.status(401).json({ error: 'Unauthorized' });
}

// ── API proxy helper ──
async function callNorGSMApi(endpoint, params, settings) {
  const { apiUrl, apiUser, apiKey } = settings;
  if (!apiUser || !apiKey) throw new Error('API not configured');
  const url = `${apiUrl || 'https://norgsm.com/public'}`;
  const payload = { username: apiUser, password: apiKey, action: endpoint, ...params };
  const resp = await axios.post(url, new URLSearchParams(payload).toString(), {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    timeout: 15000
  });
  return resp.data;
}

// ══════════════════════════════════════════
//  PUBLIC API ROUTES
// ══════════════════════════════════════════

// Get services list
app.get('/api/services', async (req, res) => {
  const settings = readJSON('settings.json', {});
  try {
    const data = await callNorGSMApi('services', {}, settings);
    res.json({ success: true, data });
  } catch (e) {
    // Return mock services if API not configured
    res.json({ success: true, data: getMockServices(), mock: true });
  }
});

// Get single service
app.get('/api/services/:id', async (req, res) => {
  const settings = readJSON('settings.json', {});
  try {
    const data = await callNorGSMApi('services', { service: req.params.id }, settings);
    res.json({ success: true, data });
  } catch (e) {
    res.json({ success: false, error: e.message });
  }
});

// Check balance
app.get('/api/balance', requireUser, async (req, res) => {
  const settings = readJSON('settings.json', {});
  try {
    const data = await callNorGSMApi('balance', {}, settings);
    res.json({ success: true, data });
  } catch (e) {
    res.json({ success: false, error: e.message });
  }
});

// Place order
app.post('/api/order', requireUser, async (req, res) => {
  const settings = readJSON('settings.json', {});
  const { service, quantity, link } = req.body;
  try {
    const data = await callNorGSMApi('add', { service, quantity, link }, settings);
    // Save order locally
    const orders = readJSON('orders.json');
    const users = readJSON('users.json');
    const user = users.find(u => u.id === req.session.userId);
    orders.push({
      id: Date.now(),
      userId: req.session.userId,
      userEmail: user?.email,
      service, quantity, link,
      apiOrderId: data.order,
      status: 'Pending',
      createdAt: new Date().toISOString()
    });
    writeJSON('orders.json', orders);
    res.json({ success: true, data });
  } catch (e) {
    res.json({ success: false, error: e.message });
  }
});

// Check order status
app.get('/api/order/:id', requireUser, async (req, res) => {
  const settings = readJSON('settings.json', {});
  try {
    const data = await callNorGSMApi('status', { order: req.params.id }, settings);
    res.json({ success: true, data });
  } catch (e) {
    res.json({ success: false, error: e.message });
  }
});

// My orders
app.get('/api/my-orders', requireUser, (req, res) => {
  const orders = readJSON('orders.json').filter(o => o.userId === req.session.userId);
  res.json({ success: true, data: orders.reverse() });
});

// ══════════════════════════════════════════
//  AUTH ROUTES
// ══════════════════════════════════════════

app.post('/api/auth/register', async (req, res) => {
  const { name, email, password, mobile, currency } = req.body;
  if (!name || !email || !password) return res.json({ success: false, error: 'Missing fields' });
  const users = readJSON('users.json');
  if (users.find(u => u.email === email)) return res.json({ success: false, error: 'Email already registered' });
  const hashed = await bcrypt.hash(password, 10);
  const user = { id: Date.now().toString(), name, email, mobile: mobile || '', currency: currency || 'USD', password: hashed, balance: 0, createdAt: new Date().toISOString(), active: true };
  users.push(user);
  writeJSON('users.json', users);
  req.session.userId = user.id;
  req.session.userName = user.name;
  res.json({ success: true, user: { id: user.id, name: user.name, email: user.email, currency: user.currency, balance: user.balance } });
});

app.post('/api/auth/login', async (req, res) => {
  const { email, password } = req.body;
  const users = readJSON('users.json');
  const user = users.find(u => u.email === email);
  if (!user) return res.json({ success: false, error: 'Invalid email or password' });
  const ok = await bcrypt.compare(password, user.password);
  if (!ok) return res.json({ success: false, error: 'Invalid email or password' });
  if (!user.active) return res.json({ success: false, error: 'Account not yet activated. Contact admin.' });
  req.session.userId = user.id;
  req.session.userName = user.name;
  res.json({ success: true, user: { id: user.id, name: user.name, email: user.email, currency: user.currency, balance: user.balance } });
});

app.post('/api/auth/logout', (req, res) => {
  req.session.destroy();
  res.json({ success: true });
});

app.get('/api/auth/me', (req, res) => {
  if (!req.session.userId) return res.json({ loggedIn: false });
  const users = readJSON('users.json');
  const user = users.find(u => u.id === req.session.userId);
  if (!user) return res.json({ loggedIn: false });
  res.json({ loggedIn: true, user: { id: user.id, name: user.name, email: user.email, currency: user.currency, balance: user.balance } });
});

// ══════════════════════════════════════════
//  ADMIN ROUTES
// ══════════════════════════════════════════

app.get('/admin/login', (req, res) => {
  res.send(adminLoginHTML());
});

app.post('/admin/login', (req, res) => {
  const { username, password } = req.body;
  if (username === ADMIN_USER && password === ADMIN_PASS) {
    req.session.isAdmin = true;
    res.redirect('/admin');
  } else {
    res.send(adminLoginHTML('Invalid credentials'));
  }
});

app.get('/admin/logout', (req, res) => {
  req.session.isAdmin = false;
  res.redirect('/admin/login');
});

app.get('/admin', requireAdmin, (req, res) => {
  res.send(adminDashboardHTML());
});

// Admin API - get settings
app.get('/admin/api/settings', requireAdmin, (req, res) => {
  res.json(readJSON('settings.json', {}));
});

// Admin API - save settings
app.post('/admin/api/settings', requireAdmin, (req, res) => {
  const { apiUrl, apiUser, apiKey, shopName, currency } = req.body;
  writeJSON('settings.json', { apiUrl, apiUser, apiKey, shopName, currency });
  res.json({ success: true });
});

// Admin API - test API connection
app.post('/admin/api/test-connection', requireAdmin, async (req, res) => {
  const settings = req.body;
  try {
    const data = await callNorGSMApi('balance', {}, settings);
    res.json({ success: true, data });
  } catch (e) {
    res.json({ success: false, error: e.message });
  }
});

// Admin API - users
app.get('/admin/api/users', requireAdmin, (req, res) => {
  const users = readJSON('users.json').map(u => ({ ...u, password: undefined }));
  res.json(users);
});

app.post('/admin/api/users/:id/toggle', requireAdmin, (req, res) => {
  const users = readJSON('users.json');
  const u = users.find(u => u.id === req.params.id);
  if (u) u.active = !u.active;
  writeJSON('users.json', users);
  res.json({ success: true, active: u?.active });
});

app.post('/admin/api/users/:id/balance', requireAdmin, (req, res) => {
  const users = readJSON('users.json');
  const u = users.find(u => u.id === req.params.id);
  if (u) u.balance = parseFloat(req.body.balance) || 0;
  writeJSON('users.json', users);
  res.json({ success: true });
});

app.delete('/admin/api/users/:id', requireAdmin, (req, res) => {
  let users = readJSON('users.json');
  users = users.filter(u => u.id !== req.params.id);
  writeJSON('users.json', users);
  res.json({ success: true });
});

// Admin API - orders
app.get('/admin/api/orders', requireAdmin, (req, res) => {
  res.json(readJSON('orders.json').reverse());
});

// ══════════════════════════════════════════
//  SERVE FRONTEND (SPA)
// ══════════════════════════════════════════
app.get('*', (req, res) => {
  if (req.path.startsWith('/admin')) return res.redirect('/admin');
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ══════════════════════════════════════════
//  MOCK DATA
// ══════════════════════════════════════════
function getMockServices() {
  return [
    { id: '1', name: 'Unlock Tool Rent [6 Hours] V2 ✅', rate: '2.50', min: 1, max: 1, type: 'Other', category: 'Rent Tools', description: 'Instant tool access for 6 hours', dripfeed: false },
    { id: '2', name: 'iRemoval PRO A12+ (All Supported iPhones/iPads) To iOS 26.0.1', rate: '8.00', min: 1, max: 1, type: 'Other', category: 'iPhone Unlock', description: 'Supports A12+ chipsets up to iOS 26', dripfeed: false },
    { id: '3', name: 'Xiaomi MiCloud Remove WorldWide — Direct Access Super Fast ☄️', rate: '5.00', min: 1, max: 1, type: 'Other', category: 'MiCloud Remove', description: '1-3-6 Hours delivery', dripfeed: false },
    { id: '4', name: 'AMT – Android Multi Tool Rent [3 Hours] V2 ✅', rate: '1.80', min: 1, max: 1, type: 'Other', category: 'Rent Tools', description: 'Instant access', dripfeed: false },
    { id: '5', name: 'PayJoy Lock 🔰 Tecno/Infinix/Itel AUTH Permanent Remove ✅', rate: '3.50', min: 1, max: 1, type: 'Other', category: 'PayJoy Remove', description: '1-10 Minutes', dripfeed: false },
    { id: '6', name: 'HFZ Activator A12+ Premium Tool BYPASS NO SIGNAL (Till iOS 26.1)', rate: '12.00', min: 1, max: 1, type: 'Other', category: 'iPhone Unlock', description: 'All A12 models', dripfeed: false },
    { id: '7', name: 'Honor FRP Key – Super Fast | 10-60Min/3Hrs [Auto API] ☢️', rate: '4.50', min: 1, max: 1, type: 'Other', category: 'Android FRP', description: '1-72 Hours', dripfeed: false },
    { id: '8', name: 'SIGMA PLUS (Dongle Rent) 30-60 Minutes V1 ✅', rate: '1.20', min: 1, max: 1, type: 'Other', category: 'Rent Tools', description: '1-10 Minutes', dripfeed: false },
    { id: '9', name: 'Samsung FRP Bypass All Models Android 11-14 ✅', rate: '2.00', min: 1, max: 1, type: 'Other', category: 'Android FRP', description: '1-6 Hours', dripfeed: false },
    { id: '10', name: 'Android Multi Tool (AMT) Credit – Any Qty ⚡', rate: '0.50', min: 1, max: 1000, type: 'Other', category: 'Server Credits', description: 'Instant delivery', dripfeed: false },
    { id: '11', name: 'iPhone Carrier Unlock Permanent – AT&T USA All Models', rate: '6.00', min: 1, max: 1, type: 'Other', category: 'iPhone Unlock', description: '1-24 Hours', dripfeed: false },
    { id: '12', name: 'Xiaomi MiCloud Remove (Turkey) Clean Only', rate: '3.00', min: 1, max: 1, type: 'Other', category: 'MiCloud Remove', description: 'Minutes', dripfeed: false },
    { id: '13', name: 'TSM Tool Rent [12 hours] V1 ✅', rate: '2.20', min: 1, max: 1, type: 'Other', category: 'Rent Tools', description: 'Instant', dripfeed: false },
    { id: '14', name: 'TFM Tool Pro Rent [6 Hours] V2 ✅', rate: '2.80', min: 1, max: 1, type: 'Other', category: 'Rent Tools', description: 'Minutes', dripfeed: false },
    { id: '15', name: 'PayJoy Lock 🔰 Realme/Redmi AUTH Permanent Remove ✅', rate: '3.50', min: 1, max: 1, type: 'Other', category: 'PayJoy Remove', description: '1-10 Minutes', dripfeed: false },
    { id: '16', name: 'Honor Info Check (IMEI and Serial) Instant', rate: '0.30', min: 1, max: 100, type: 'Other', category: 'IMEI Services', description: 'Minutes', dripfeed: false },
    { id: '17', name: 'Xiaomi MiCloud Remove (UAE/Dubai) Clean Only', rate: '4.00', min: 1, max: 1, type: 'Other', category: 'MiCloud Remove', description: '1-24 Hours', dripfeed: false },
    { id: '18', name: 'A12+ Tool China and Global All Models 18 to 26.1 Supported NO Signal Bypass', rate: '10.00', min: 1, max: 1, type: 'Other', category: 'iPhone Unlock', description: 'Minutes', dripfeed: false },
  ];
}

// ══════════════════════════════════════════
//  ADMIN HTML
// ══════════════════════════════════════════
function adminLoginHTML(error = '') {
  return `<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Admin Login – GSM Shop</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{background:#0d0f14;color:#e2e8f0;font-family:'Inter',sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh}
.card{background:#161a22;border:1px solid #2a3045;border-radius:14px;padding:40px;width:360px}
.logo{font-size:26px;font-weight:800;color:#00d4ff;margin-bottom:6px;letter-spacing:1px}
.logo span{color:#7c3aed}
p{color:#8892a4;font-size:13px;margin-bottom:28px}
label{display:block;font-size:11px;font-weight:700;color:#8892a4;text-transform:uppercase;letter-spacing:.05em;margin-bottom:6px}
input{width:100%;background:#1e2330;border:1px solid #2a3045;color:#e2e8f0;padding:11px 14px;border-radius:8px;font-size:14px;outline:none;margin-bottom:16px}
input:focus{border-color:#00d4ff}
button{width:100%;background:linear-gradient(135deg,#00d4ff,#7c3aed);color:#fff;border:none;padding:12px;border-radius:8px;font-size:14px;font-weight:700;cursor:pointer}
.err{background:rgba(239,68,68,.1);border:1px solid rgba(239,68,68,.3);color:#ef4444;padding:10px 14px;border-radius:8px;font-size:13px;margin-bottom:16px}
</style></head><body>
<div class="card">
  <div class="logo">MY<span>GSM</span> Admin</div>
  <p>Enter admin credentials to continue</p>
  ${error ? `<div class="err">⚠️ ${error}</div>` : ''}
  <form method="POST" action="/admin/login">
    <label>Username</label>
    <input name="username" placeholder="Admin username" autocomplete="off">
    <label>Password</label>
    <input type="password" name="password" placeholder="••••••••">
    <button type="submit">Login to Dashboard</button>
  </form>
</div>
</body></html>`;
}

function adminDashboardHTML() {
  return `<!DOCTYPE html><html lang="en"><head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Admin Dashboard – GSM Shop</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
:root{--bg:#0d0f14;--surf:#161a22;--surf2:#1e2330;--bord:#2a3045;--accent:#00d4ff;--accent2:#7c3aed;--green:#22c55e;--red:#ef4444;--yellow:#f59e0b;--text:#e2e8f0;--muted:#8892a4}
body{background:var(--bg);color:var(--text);font-family:'Inter',sans-serif;font-size:14px;display:flex;min-height:100vh}
/* Sidebar */
.sidebar{width:220px;background:var(--surf);border-right:1px solid var(--bord);display:flex;flex-direction:column;flex-shrink:0}
.sidebar-logo{padding:20px 18px;font-size:20px;font-weight:800;color:var(--accent);border-bottom:1px solid var(--bord);letter-spacing:1px}
.sidebar-logo span{color:var(--accent2)}
.sidebar-logo small{display:block;font-size:11px;color:var(--muted);font-weight:400;letter-spacing:0}
.nav-item{display:flex;align-items:center;gap:10px;padding:11px 18px;color:var(--muted);cursor:pointer;transition:all .15s;border-left:3px solid transparent}
.nav-item:hover,.nav-item.active{background:var(--surf2);color:var(--accent);border-left-color:var(--accent)}
.nav-item .icon{width:18px;text-align:center}
.logout{margin-top:auto;border-top:1px solid var(--bord);padding:16px 18px}
.logout a{color:var(--muted);font-size:13px;cursor:pointer}
.logout a:hover{color:var(--red)}
/* Main */
.main{flex:1;display:flex;flex-direction:column;overflow:hidden}
.topbar{background:var(--surf);border-bottom:1px solid var(--bord);padding:14px 24px;display:flex;align-items:center;justify-content:space-between}
.topbar h1{font-size:18px;font-weight:700}
.topbar .badge{background:rgba(0,212,255,.12);border:1px solid rgba(0,212,255,.25);color:var(--accent);padding:4px 12px;border-radius:20px;font-size:12px}
.content{flex:1;overflow-y:auto;padding:24px}
/* Tabs */
.tab-panel{display:none}.tab-panel.active{display:block}
/* Cards */
.stats-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:16px;margin-bottom:24px}
.stat-card{background:var(--surf);border:1px solid var(--bord);border-radius:10px;padding:20px}
.stat-card .val{font-size:28px;font-weight:800;color:var(--accent)}
.stat-card .lbl{color:var(--muted);font-size:12px;margin-top:4px}
/* Table */
.tbl-wrap{background:var(--surf);border:1px solid var(--bord);border-radius:10px;overflow:hidden}
.tbl-header{padding:14px 20px;border-bottom:1px solid var(--bord);font-weight:700;font-size:13px;display:flex;align-items:center;justify-content:space-between}
table{width:100%;border-collapse:collapse}
th,td{padding:11px 16px;text-align:left;font-size:13px;border-bottom:1px solid var(--bord)}
th{color:var(--muted);font-size:11px;text-transform:uppercase;letter-spacing:.05em;background:var(--surf2)}
tr:last-child td{border-bottom:none}
tr:hover td{background:rgba(255,255,255,.02)}
.badge-green{background:rgba(34,197,94,.12);color:var(--green);padding:2px 8px;border-radius:4px;font-size:11px;font-weight:700}
.badge-red{background:rgba(239,68,68,.12);color:var(--red);padding:2px 8px;border-radius:4px;font-size:11px;font-weight:700}
.badge-yellow{background:rgba(245,158,11,.12);color:var(--yellow);padding:2px 8px;border-radius:4px;font-size:11px;font-weight:700}
/* Forms */
.form-section{background:var(--surf);border:1px solid var(--bord);border-radius:10px;padding:24px;margin-bottom:20px}
.form-section h3{font-size:16px;font-weight:700;margin-bottom:18px;padding-bottom:12px;border-bottom:1px solid var(--bord)}
.form-grid{display:grid;grid-template-columns:1fr 1fr;gap:16px}
.field label{display:block;font-size:11px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:.05em;margin-bottom:6px}
.field input,.field select{width:100%;background:var(--surf2);border:1px solid var(--bord);color:var(--text);padding:10px 14px;border-radius:8px;font-size:13px;outline:none}
.field input:focus{border-color:var(--accent)}
.field.full{grid-column:1/-1}
.btn{padding:9px 18px;border-radius:7px;font-size:13px;font-weight:700;cursor:pointer;border:none;transition:all .2s}
.btn-primary{background:linear-gradient(135deg,#00d4ff,#7c3aed);color:#fff}
.btn-danger{background:rgba(239,68,68,.15);color:var(--red);border:1px solid rgba(239,68,68,.3)}
.btn-sm{padding:5px 11px;font-size:12px}
.btn-success{background:rgba(34,197,94,.15);color:var(--green);border:1px solid rgba(34,197,94,.3)}
.alert{padding:12px 16px;border-radius:8px;font-size:13px;margin-bottom:16px}
.alert-success{background:rgba(34,197,94,.1);border:1px solid rgba(34,197,94,.3);color:var(--green)}
.alert-error{background:rgba(239,68,68,.1);border:1px solid rgba(239,68,68,.3);color:var(--red)}
.alert-info{background:rgba(0,212,255,.1);border:1px solid rgba(0,212,255,.3);color:var(--accent)}
#msg{display:none}
@media(max-width:800px){.stats-grid{grid-template-columns:1fr 1fr}.form-grid{grid-template-columns:1fr}}
</style></head><body>

<div class="sidebar">
  <div class="sidebar-logo">MY<span>GSM</span><small>Admin Dashboard</small></div>
  <div class="nav-item active" onclick="showTab('dashboard',this)"><span class="icon">📊</span> Dashboard</div>
  <div class="nav-item" onclick="showTab('api-setup',this)"><span class="icon">⚙️</span> API Setup</div>
  <div class="nav-item" onclick="showTab('users',this)"><span class="icon">👥</span> Users</div>
  <div class="nav-item" onclick="showTab('orders',this)"><span class="icon">📦</span> Orders</div>
  <div class="nav-item" onclick="showTab('services',this)"><span class="icon">📋</span> Services</div>
  <div class="nav-item" onclick="window.open('/','_blank')"><span class="icon">🌐</span> View Shop</div>
  <div class="logout"><a href="/admin/logout">🚪 Logout</a></div>
</div>

<div class="main">
  <div class="topbar">
    <h1 id="page-title">Dashboard</h1>
    <div class="badge">👤 Logged in as JEPFX</div>
  </div>
  <div class="content">
    <div id="msg" class="alert"></div>

    <!-- DASHBOARD -->
    <div id="tab-dashboard" class="tab-panel active">
      <div class="stats-grid">
        <div class="stat-card"><div class="val" id="stat-users">—</div><div class="lbl">Total Users</div></div>
        <div class="stat-card"><div class="val" id="stat-orders">—</div><div class="lbl">Total Orders</div></div>
        <div class="stat-card"><div class="val" id="stat-api">—</div><div class="lbl">API Balance</div></div>
        <div class="stat-card"><div class="val" id="stat-status" style="font-size:16px">Checking…</div><div class="lbl">API Status</div></div>
      </div>
      <div class="tbl-wrap">
        <div class="tbl-header"><span>📦 Recent Orders</span></div>
        <table id="recent-orders-table">
          <thead><tr><th>Order ID</th><th>User</th><th>Service</th><th>Status</th><th>Date</th></tr></thead>
          <tbody id="recent-orders-body"><tr><td colspan="5" style="color:var(--muted);text-align:center;padding:24px">Loading…</td></tr></tbody>
        </table>
      </div>
    </div>

    <!-- API SETUP -->
    <div id="tab-api-setup" class="tab-panel">
      <div class="form-section">
        <h3>⚙️ API Configuration — norgsm.com/public</h3>
        <div id="api-msg"></div>
        <div class="form-grid">
          <div class="field full"><label>API URL</label><input id="apiUrl" placeholder="https://norgsm.com/public"></div>
          <div class="field"><label>API Username</label><input id="apiUser" placeholder="Your norgsm username"></div>
          <div class="field"><label>API Key / Password</label><input id="apiKey" type="password" placeholder="Your API key"></div>
          <div class="field"><label>Shop Name</label><input id="shopName" placeholder="MyGSM Shop"></div>
          <div class="field"><label>Default Currency</label>
            <select id="currency">
              <option value="USD">USD – US Dollar</option>
              <option value="PHP">PHP – Philippine Peso</option>
            </select>
          </div>
        </div>
        <div style="display:flex;gap:10px;margin-top:20px">
          <button class="btn btn-primary" onclick="saveSettings()">💾 Save Settings</button>
          <button class="btn btn-success" onclick="testConnection()">🔗 Test Connection</button>
        </div>
      </div>
      <div class="form-section">
        <h3>📋 API Endpoints Reference</h3>
        <div style="background:var(--surf2);border-radius:8px;padding:16px;font-size:12px;font-family:monospace;color:var(--muted);line-height:2">
          POST ${'{apiUrl}'} action=balance — Get balance<br>
          POST ${'{apiUrl}'} action=services — List all services<br>
          POST ${'{apiUrl}'} action=add &amp; service=ID&amp;quantity=1&amp;link=IMEI — Place order<br>
          POST ${'{apiUrl}'} action=status &amp; order=ORDER_ID — Check order status<br>
          POST ${'{apiUrl}'} action=orders — List all orders<br>
        </div>
      </div>
    </div>

    <!-- USERS -->
    <div id="tab-users" class="tab-panel">
      <div class="tbl-wrap">
        <div class="tbl-header"><span>👥 Registered Users</span><button class="btn btn-sm btn-primary" onclick="loadUsers()">🔄 Refresh</button></div>
        <table>
          <thead><tr><th>Name</th><th>Email</th><th>Mobile</th><th>Balance</th><th>Currency</th><th>Status</th><th>Actions</th></tr></thead>
          <tbody id="users-body"><tr><td colspan="7" style="color:var(--muted);text-align:center;padding:24px">Loading…</td></tr></tbody>
        </table>
      </div>
    </div>

    <!-- ORDERS -->
    <div id="tab-orders" class="tab-panel">
      <div class="tbl-wrap">
        <div class="tbl-header"><span>📦 All Orders</span><button class="btn btn-sm btn-primary" onclick="loadOrders()">🔄 Refresh</button></div>
        <table>
          <thead><tr><th>ID</th><th>User</th><th>Service</th><th>API Order ID</th><th>Status</th><th>Date</th></tr></thead>
          <tbody id="orders-body"><tr><td colspan="6" style="color:var(--muted);text-align:center;padding:24px">Loading…</td></tr></tbody>
        </table>
      </div>
    </div>

    <!-- SERVICES -->
    <div id="tab-services" class="tab-panel">
      <div class="alert alert-info" style="margin-bottom:16px">Services are loaded live from the configured API. Make sure your API credentials are saved in <strong>API Setup</strong> first.</div>
      <div class="tbl-wrap">
        <div class="tbl-header"><span>📋 Services from API</span><button class="btn btn-sm btn-primary" onclick="loadServicesAdmin()">🔄 Load from API</button></div>
        <table>
          <thead><tr><th>ID</th><th>Name</th><th>Category</th><th>Rate</th><th>Min</th><th>Max</th></tr></thead>
          <tbody id="services-body"><tr><td colspan="6" style="color:var(--muted);text-align:center;padding:24px">Click "Load from API" to fetch services</td></tr></tbody>
        </table>
      </div>
    </div>

  </div>
</div>

<script>
function showTab(id, el) {
  document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  document.getElementById('tab-' + id).classList.add('active');
  el.classList.add('active');
  document.getElementById('page-title').textContent = el.textContent.trim();
  if (id === 'users') loadUsers();
  if (id === 'orders') loadOrders();
  if (id === 'dashboard') loadDashboard();
  if (id === 'api-setup') loadSettings();
}

function showMsg(msg, type='success') {
  const el = document.getElementById('msg');
  el.className = 'alert alert-' + type;
  el.textContent = msg;
  el.style.display = 'block';
  setTimeout(() => el.style.display = 'none', 4000);
}

async function loadDashboard() {
  const [usersR, ordersR] = await Promise.all([fetch('/admin/api/users'), fetch('/admin/api/orders')]);
  const users = await usersR.json();
  const orders = await ordersR.json();
  document.getElementById('stat-users').textContent = users.length;
  document.getElementById('stat-orders').textContent = orders.length;
  // API balance
  fetch('/api/balance').then(r=>r.json()).then(d => {
    document.getElementById('stat-api').textContent = d.success ? '$' + (d.data?.balance || '0.00') : 'N/A';
    document.getElementById('stat-status').textContent = d.success ? '🟢 Online' : '🔴 Not Configured';
  });
  // Recent orders
  const tbody = document.getElementById('recent-orders-body');
  if (!orders.length) { tbody.innerHTML = '<tr><td colspan="5" style="color:var(--muted);text-align:center;padding:24px">No orders yet</td></tr>'; return; }
  tbody.innerHTML = orders.slice(0,10).map(o => \`<tr>
    <td>#\${o.id}</td><td>\${o.userEmail||'—'}</td>
    <td style="max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">\${o.service}</td>
    <td><span class="badge-yellow">\${o.status}</span></td>
    <td>\${new Date(o.createdAt).toLocaleDateString()}</td>
  </tr>\`).join('');
}

async function loadSettings() {
  const r = await fetch('/admin/api/settings');
  const s = await r.json();
  document.getElementById('apiUrl').value = s.apiUrl || 'https://norgsm.com/public';
  document.getElementById('apiUser').value = s.apiUser || '';
  document.getElementById('apiKey').value = s.apiKey || '';
  document.getElementById('shopName').value = s.shopName || '';
  document.getElementById('currency').value = s.currency || 'USD';
}

async function saveSettings() {
  const body = {
    apiUrl: document.getElementById('apiUrl').value,
    apiUser: document.getElementById('apiUser').value,
    apiKey: document.getElementById('apiKey').value,
    shopName: document.getElementById('shopName').value,
    currency: document.getElementById('currency').value,
  };
  const r = await fetch('/admin/api/settings', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(body) });
  const d = await r.json();
  showMsg(d.success ? '✅ Settings saved successfully!' : '❌ Failed to save');
}

async function testConnection() {
  const body = {
    apiUrl: document.getElementById('apiUrl').value,
    apiUser: document.getElementById('apiUser').value,
    apiKey: document.getElementById('apiKey').value,
  };
  const el = document.getElementById('api-msg');
  el.className = 'alert alert-info'; el.textContent = '⏳ Testing connection…'; el.style.display = 'block';
  const r = await fetch('/admin/api/test-connection', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(body) });
  const d = await r.json();
  if (d.success) {
    el.className = 'alert alert-success'; el.textContent = '✅ Connected! Balance: ' + JSON.stringify(d.data);
  } else {
    el.className = 'alert alert-error'; el.textContent = '❌ Failed: ' + d.error;
  }
}

async function loadUsers() {
  const r = await fetch('/admin/api/users');
  const users = await r.json();
  const tbody = document.getElementById('users-body');
  if (!users.length) { tbody.innerHTML = '<tr><td colspan="7" style="color:var(--muted);text-align:center;padding:24px">No users registered</td></tr>'; return; }
  tbody.innerHTML = users.map(u => \`<tr>
    <td>\${u.name}</td><td>\${u.email}</td><td>\${u.mobile||'—'}</td>
    <td>$\${(u.balance||0).toFixed(2)}</td><td>\${u.currency}</td>
    <td><span class="\${u.active?'badge-green':'badge-red'}">\${u.active?'Active':'Suspended'}</span></td>
    <td style="display:flex;gap:6px;flex-wrap:wrap">
      <button class="btn btn-sm \${u.active?'btn-danger':'btn-success'}" onclick="toggleUser('\${u.id}')">
        \${u.active?'Suspend':'Activate'}
      </button>
      <button class="btn btn-sm btn-primary" onclick="editBalance('\${u.id}',\${u.balance||0})">Balance</button>
      <button class="btn btn-sm btn-danger" onclick="deleteUser('\${u.id}')">Delete</button>
    </td>
  </tr>\`).join('');
}

async function toggleUser(id) {
  await fetch('/admin/api/users/'+id+'/toggle', {method:'POST'});
  loadUsers(); showMsg('User status updated');
}

async function editBalance(id, current) {
  const val = prompt('Set new balance (USD):', current);
  if (val === null) return;
  await fetch('/admin/api/users/'+id+'/balance', {method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({balance: parseFloat(val)})});
  loadUsers(); showMsg('Balance updated');
}

async function deleteUser(id) {
  if (!confirm('Delete this user?')) return;
  await fetch('/admin/api/users/'+id, {method:'DELETE'});
  loadUsers(); showMsg('User deleted', 'error');
}

async function loadOrders() {
  const r = await fetch('/admin/api/orders');
  const orders = await r.json();
  const tbody = document.getElementById('orders-body');
  if (!orders.length) { tbody.innerHTML = '<tr><td colspan="6" style="color:var(--muted);text-align:center;padding:24px">No orders yet</td></tr>'; return; }
  tbody.innerHTML = orders.map(o => \`<tr>
    <td>#\${o.id}</td><td>\${o.userEmail||'—'}</td>
    <td style="max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">\${o.service}</td>
    <td>\${o.apiOrderId||'—'}</td>
    <td><span class="badge-yellow">\${o.status}</span></td>
    <td>\${new Date(o.createdAt).toLocaleDateString()}</td>
  </tr>\`).join('');
}

async function loadServicesAdmin() {
  document.getElementById('services-body').innerHTML = '<tr><td colspan="6" style="color:var(--muted);text-align:center;padding:24px">⏳ Loading…</td></tr>';
  const r = await fetch('/api/services');
  const d = await r.json();
  const services = Array.isArray(d.data) ? d.data : Object.values(d.data||{});
  const tbody = document.getElementById('services-body');
  if (!services.length) { tbody.innerHTML = '<tr><td colspan="6" style="color:var(--muted);text-align:center;padding:24px">No services found</td></tr>'; return; }
  tbody.innerHTML = services.map(s => \`<tr>
    <td>\${s.service||s.id}</td>
    <td style="max-width:260px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">\${s.name}</td>
    <td>\${s.category||s.type||'—'}</td>
    <td>$\${parseFloat(s.rate||s.price||0).toFixed(2)}</td>
    <td>\${s.min||1}</td><td>\${s.max||1}</td>
  </tr>\`).join('');
}

loadDashboard();
</script>
</body></html>`;
}

app.listen(PORT, () => console.log(`GSM Shop running on port ${PORT}`));
