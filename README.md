# GSM Shop – NorGSM Clone

A full-stack GSM unlocking shop with public storefront, user auth, admin panel, and NorGSM API integration.

---

## 🚀 Deploy to Render (Free)

### Step 1 — Push to GitHub
1. Create a new repo on [github.com](https://github.com)
2. Run these commands in the project folder:
```bash
git init
git add .
git commit -m "initial commit"
git remote add origin https://github.com/YOUR_USERNAME/gsm-shop.git
git push -u origin main
```

### Step 2 — Deploy on Render
1. Go to [render.com](https://render.com) and sign up (free)
2. Click **New → Web Service**
3. Connect your GitHub repo
4. Render auto-detects settings from `render.yaml`
5. Click **Deploy**
6. Your site will be live at: `https://gsm-shop.onrender.com`

---

## ⚙️ API Setup (after deploy)

1. Visit `https://your-site.onrender.com/admin`
2. Login: **JEPFX** / **JEPFXADMIN**
3. Go to **⚙️ API Setup**
4. Fill in:
   - **API URL:** `https://norgsm.com/public`
   - **API Username:** your norgsm.com username
   - **API Key:** your norgsm.com API key/password
5. Click **Test Connection** to verify
6. Click **Save Settings**

Services will now load live from the NorGSM API.

---

## 🔐 Admin Panel

URL: `/admin`  
Username: `JEPFX`  
Password: `JEPFXADMIN`

Features:
- 📊 Dashboard with stats
- ⚙️ API setup & connection test
- 👥 User management (activate/suspend/balance/delete)
- 📦 Order management
- 📋 Live service list from API

---

## 🌐 Public Shop

- Login / Register with USD or PHP currency
- Browse services (live from API or mock data)
- Search & filter by category
- Place orders (IMEI / link input)
- View order history
- Free IMEI checker

---

## 📁 File Structure

```
gsm-shop/
├── server.js          ← Express backend + API proxy
├── package.json
├── render.yaml        ← Render deploy config
├── .gitignore
├── public/
│   └── index.html     ← Full frontend (NorGSM clone)
└── data/              ← Auto-created on first run
    ├── settings.json  ← API credentials
    ├── users.json     ← Registered users
    └── orders.json    ← Order history
```

---

## 💡 Notes

- Data is stored in JSON files (works fine for small-medium load)
- `data/` folder is in `.gitignore` — credentials stay local/on server
- If API is not configured, shop shows built-in mock services
- Currency toggle (USD/PHP) works at ₱56 rate

---

## 🔧 Local Development

```bash
npm install
node server.js
# Open http://localhost:3000
# Admin: http://localhost:3000/admin
```
