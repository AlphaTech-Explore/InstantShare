const express = require('express');
const http = require('http');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const { WebSocketServer, WebSocket } = require('ws');
const os = require('os');

// Optional Vercel Blob SDK for permanent cloud object storage
let putBlob = null;
let delBlob = null;
try {
  const blobPkg = require('@vercel/blob');
  putBlob = blobPkg.put;
  delBlob = blobPkg.del;
} catch (e) {
  // Local fallback
}

const app = express();
const server = http.createServer(app);

// Initialize WebSocket server (gracefully skipped if running in serverless Vercel)
let wss = null;
try {
  wss = new WebSocketServer({ server });
} catch (e) {
  console.log('Running without standalone WebSocket server');
}

const PORT = process.env.PORT || 3000;
const IS_VERCEL = !!process.env.VERCEL;

// Temporary folder for local uploads
const UPLOADS_DIR = IS_VERCEL ? '/tmp/uploads' : path.join(__dirname, 'uploads');
const DB_FILE = IS_VERCEL ? '/tmp/rooms.json' : path.join(__dirname, 'rooms.json');

if (!fs.existsSync(UPLOADS_DIR)) {
  try { fs.mkdirSync(UPLOADS_DIR, { recursive: true }); } catch (e) {}
}

// In-memory Room Store (synced with KV/Redis if present, else JSON fallback)
let db = { rooms: {} };

function loadLocalDB() {
  if (fs.existsSync(DB_FILE)) {
    try {
      db = JSON.parse(fs.readFileSync(DB_FILE, 'utf-8'));
      if (!db.rooms) db.rooms = {};
    } catch (e) {
      db = { rooms: {} };
    }
  }
}
loadLocalDB();

// Helper to save DB (supports Upstash/Vercel KV REST if env variables present)
async function saveDB() {
  const kvUrl = process.env.KV_REST_API_URL;
  const kvToken = process.env.KV_REST_API_TOKEN;

  if (kvUrl && kvToken) {
    try {
      await fetch(`${kvUrl}/set/rooms_db`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${kvToken}` },
        body: JSON.stringify(db)
      });
      return;
    } catch (err) {
      console.error('KV save error:', err);
    }
  }

  // File fallback
  try {
    fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2), 'utf-8');
  } catch (e) {}
}

async function syncFromKV() {
  const kvUrl = process.env.KV_REST_API_URL;
  const kvToken = process.env.KV_REST_API_TOKEN;
  if (kvUrl && kvToken) {
    try {
      const res = await fetch(`${kvUrl}/get/rooms_db`, {
        headers: { Authorization: `Bearer ${kvToken}` }
      });
      const data = await res.json();
      if (data && data.result) {
        db = typeof data.result === 'string' ? JSON.parse(data.result) : data.result;
        if (!db.rooms) db.rooms = {};
      }
    } catch (e) {
      console.error('KV fetch error:', e);
    }
  }
}

// Multer memory or disk storage
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOADS_DIR),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const unique = Date.now() + '-' + Math.round(Math.random() * 1e9);
    cb(null, `${unique}${ext}`);
  }
});

const fileFilter = (req, file, cb) => {
  if (/^(image|video)\//i.test(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error('Only photos and videos allowed!'), false);
  }
};

const upload = multer({
  storage,
  fileFilter,
  limits: { fileSize: 100 * 1024 * 1024 }
});

// Middleware
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(UPLOADS_DIR));
app.use(express.json());

// Broadcast helpers
function broadcastToPin(pin, payload) {
  if (!wss) return;
  const str = JSON.stringify(payload);
  wss.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN && client.currentPin === pin) {
      client.send(str);
    }
  });
}

function countClientsInPin(pin) {
  if (!wss) return 1;
  let count = 0;
  wss.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN && client.currentPin === pin) {
      count++;
    }
  });
  return Math.max(1, count);
}

function broadcastPinStats(pin) {
  const online = countClientsInPin(pin);
  broadcastToPin(pin, { type: 'ROOM_STATS', onlineCount: online });
}

// ==================== REST APIS ====================

// Check PIN
app.get('/api/room/:pin/check', async (req, res) => {
  await syncFromKV();
  const pin = req.params.pin.trim();
  const exists = !!db.rooms[pin];
  res.json({ exists, pin });
});

// Create Room
app.post('/api/room/create', async (req, res) => {
  await syncFromKV();
  const { pin } = req.body;
  if (!pin || typeof pin !== 'string') {
    return res.status(400).json({ error: 'PIN is required' });
  }

  const cleanPin = pin.trim();
  if (cleanPin.length < 3) {
    return res.status(400).json({ error: 'PIN must be at least 3 digits' });
  }

  if (db.rooms[cleanPin]) {
    return res.status(409).json({
      error: `PIN "${cleanPin}" is already taken! Multiple users cannot create a room with the same PIN.`
    });
  }

  db.rooms[cleanPin] = {
    pin: cleanPin,
    createdAt: new Date().toISOString(),
    media: []
  };
  await saveDB();

  res.json({ success: true, pin: cleanPin });
});

// Get Media for Room
app.get('/api/room/:pin/media', async (req, res) => {
  await syncFromKV();
  const pin = req.params.pin.trim();
  if (!db.rooms[pin]) {
    return res.status(404).json({ error: 'Room does not exist' });
  }
  res.json({ pin, media: db.rooms[pin].media || [] });
});

// Upload media
app.post('/api/room/:pin/upload', upload.array('files', 20), async (req, res) => {
  await syncFromKV();
  const pin = req.params.pin.trim();
  if (!db.rooms[pin]) {
    return res.status(404).json({ error: 'Room does not exist' });
  }

  if (!req.files || req.files.length === 0) {
    return res.status(400).json({ error: 'No media files received' });
  }

  const blobToken = process.env.BLOB_READ_WRITE_TOKEN;
  const newItems = [];

  for (const file of req.files) {
    const isVideo = file.mimetype.startsWith('video');
    let fileUrl = `/uploads/${file.filename}`;
    let blobDownloadUrl = null;

    // If Vercel Blob token is configured, upload directly to Vercel's permanent cloud storage
    if (blobToken && putBlob) {
      try {
        const fileStream = fs.createReadStream(file.path);
        const blobResult = await putBlob(`rooms/${pin}/${file.filename}`, fileStream, {
          access: 'public',
          token: blobToken,
          contentType: file.mimetype
        });
        fileUrl = blobResult.url;
        blobDownloadUrl = blobResult.downloadUrl;
      } catch (err) {
        console.error('Vercel Blob upload error:', err);
      }
    }

    newItems.push({
      id: path.parse(file.filename).name,
      filename: file.filename,
      originalName: file.originalname,
      mimeType: file.mimetype,
      type: isVideo ? 'video' : 'photo',
      size: file.size,
      url: fileUrl,
      downloadUrl: blobDownloadUrl || fileUrl,
      uploadedAt: new Date().toISOString()
    });
  }

  if (!db.rooms[pin].media) db.rooms[pin].media = [];
  db.rooms[pin].media.unshift(...newItems);
  await saveDB();

  broadcastToPin(pin, { type: 'NEW_MEDIA', items: newItems });

  res.json({ success: true, count: newItems.length, items: newItems });
});

// Delete media
app.delete('/api/room/:pin/media/:id', async (req, res) => {
  await syncFromKV();
  const pin = req.params.pin.trim();
  const { id } = req.params;

  if (!db.rooms[pin] || !db.rooms[pin].media) {
    return res.status(404).json({ error: 'Room not found' });
  }

  const index = db.rooms[pin].media.findIndex(m => m.id === id);
  if (index !== -1) {
    const [removed] = db.rooms[pin].media.splice(index, 1);
    await saveDB();

    // If Blob url, delete from Vercel Blob
    if (delBlob && removed.url && removed.url.includes('vercel-storage.com')) {
      try {
        await delBlob(removed.url, { token: process.env.BLOB_READ_WRITE_TOKEN });
      } catch (e) {}
    } else {
      const localP = path.join(UPLOADS_DIR, removed.filename);
      if (fs.existsSync(localP)) {
        try { fs.unlinkSync(localP); } catch (e) {}
      }
    }

    broadcastToPin(pin, { type: 'DELETE_MEDIA', id });
    return res.json({ success: true });
  }

  res.status(404).json({ error: 'Media not found' });
});

// WebSocket Server (local and Render)
if (wss) {
  wss.on('connection', ws => {
    ws.currentPin = null;
    ws.on('message', msg => {
      try {
        const data = JSON.parse(msg);
        if (data.type === 'JOIN_PIN') {
          const old = ws.currentPin;
          ws.currentPin = data.pin;
          if (old) broadcastPinStats(old);
          if (data.pin) broadcastPinStats(data.pin);
        }
      } catch (e) {}
    });
    ws.on('close', () => {
      if (ws.currentPin) {
        const p = ws.currentPin;
        ws.currentPin = null;
        broadcastPinStats(p);
      }
    });
  });
}

function getLocalIpAddresses() {
  const interfaces = os.networkInterfaces();
  const addresses = [];
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        addresses.push(iface.address);
      }
    }
  }
  return addresses;
}

if (!IS_VERCEL) {
  server.listen(PORT, '0.0.0.0', () => {
    console.log(`\n======================================================`);
    console.log(`🚀 InstantShare Server is running!`);
    console.log(`💻 Local: http://localhost:${PORT}`);
    const ips = getLocalIpAddresses();
    if (ips.length > 0) {
      console.log(`📱 On Network:`);
      ips.forEach(ip => console.log(`   👉 http://${ip}:${PORT}`));
    }
    console.log(`======================================================\n`);
  });
}

// Export app for Vercel Serverless
module.exports = app;
