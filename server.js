require('dotenv').config();
const express = require('express');
const http = require('http');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const { WebSocketServer, WebSocket } = require('ws');
const os = require('os');
const mongoose = require('mongoose');

// Vercel Blob client upload helpers
let handleUpload = null;
let generateClientTokenFromReadWriteToken = null;
try {
  const blobClient = require('@vercel/blob/client');
  handleUpload = blobClient.handleUpload;
  generateClientTokenFromReadWriteToken = blobClient.generateClientTokenFromReadWriteToken;
} catch (e) {}

const app = express();
const server = http.createServer(app);

// WebSockets for local/VPS
let wss = null;
try {
  wss = new WebSocketServer({ server });
} catch (e) {}

const PORT = process.env.PORT || 3000;
const IS_VERCEL = !!process.env.VERCEL;

// MongoDB Room Schema
const roomSchema = new mongoose.Schema({
  pin: { type: String, required: true, unique: true, index: true },
  createdAt: { type: Date, default: Date.now },
  media: [
    {
      id: String,
      filename: String,
      originalName: String,
      mimeType: String,
      type: String, // 'photo' or 'video'
      size: Number,
      url: String, // Permanent CDN url
      publicId: String, // Cloudinary public_id for permanent deletion
      uploadedAt: { type: String, default: () => new Date().toISOString() }
    }
  ]
});

// Clear existing compiled model to avoid schema mismatch
if (mongoose.models.Room) {
  delete mongoose.models.Room;
}
const Room = mongoose.model('Room', roomSchema);

// MongoDB Connection with Serverless Cache
let isConnected = false;
async function connectDB() {
  if (isConnected || mongoose.connection.readyState === 1) {
    return true;
  }
  const uri = process.env.MONGODB_URI;
  if (!uri) return false;

  try {
    await mongoose.connect(uri, {
      bufferCommands: false,
      serverSelectionTimeoutMS: 5000
    });
    isConnected = true;
    console.log('🍃 MongoDB Atlas connected! Permanent room database active.');
    return true;
  } catch (err) {
    console.error('MongoDB connection error:', err.message);
    return false;
  }
}

// Local fallback store
const localRooms = {};

async function getRoom(pin) {
  const hasDB = await connectDB();
  if (hasDB) {
    return await Room.findOne({ pin }).lean();
  }
  return localRooms[pin] || null;
}

async function createRoom(pin) {
  const hasDB = await connectDB();
  if (hasDB) {
    const existing = await Room.findOne({ pin });
    if (existing) return null;
    const room = await Room.create({ pin, media: [] });
    return room.toObject();
  } else {
    if (localRooms[pin]) return null;
    localRooms[pin] = { pin, createdAt: new Date().toISOString(), media: [] };
    return localRooms[pin];
  }
}

async function addMediaToRoom(pin, items) {
  const hasDB = await connectDB();
  if (hasDB) {
    const updated = await Room.findOneAndUpdate(
      { pin },
      { $push: { media: { $each: items, $position: 0 } } },
      { new: true }
    );
    return updated ? updated.media : [];
  } else {
    if (!localRooms[pin]) localRooms[pin] = { pin, media: [] };
    localRooms[pin].media.unshift(...items);
    return localRooms[pin].media;
  }
}

async function removeMediaFromRoom(pin, mediaId) {
  const hasDB = await connectDB();
  if (hasDB) {
    const room = await Room.findOne({ pin });
    if (!room) return null;
    const item = room.media.find(m => m.id === mediaId);
    if (!item) return null;

    await Room.updateOne({ pin }, { $pull: { media: { id: mediaId } } });
    return item;
  } else {
    if (!localRooms[pin] || !localRooms[pin].media) return null;
    const index = localRooms[pin].media.findIndex(m => m.id === mediaId);
    if (index === -1) return null;
    const [removed] = localRooms[pin].media.splice(index, 1);
    return removed;
  }
}

// Upload configuration for local fallback
const UPLOADS_DIR = IS_VERCEL ? '/tmp/uploads' : path.join(__dirname, 'uploads');
if (!fs.existsSync(UPLOADS_DIR)) {
  try { fs.mkdirSync(UPLOADS_DIR, { recursive: true }); } catch (e) {}
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOADS_DIR),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const unique = Date.now() + '-' + Math.round(Math.random() * 1e9);
    cb(null, `${unique}${ext}`);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 100 * 1024 * 1024 }
});

// Middleware
const cors = require('cors');
app.use(cors({ origin: true, credentials: true }));
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(UPLOADS_DIR));
app.use(express.json());

// WebSocket helper
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
    if (client.readyState === WebSocket.OPEN && client.currentPin === pin) count++;
  });
  return Math.max(1, count);
}

function broadcastPinStats(pin) {
  broadcastToPin(pin, { type: 'ROOM_STATS', onlineCount: countClientsInPin(pin) });
}

// ==================== REST APIS ====================

// Debug DB Connection
app.get('/api/debug-db', async (req, res) => {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    return res.json({ connected: false, reason: 'MONGODB_URI is not set in environment' });
  }
  try {
    const ok = await connectDB();
    const count = ok ? await Room.countDocuments() : 0;
    const room2011 = ok ? await Room.findOne({ pin: '2011' }).lean() : null;
    return res.json({
      connected: ok,
      totalRooms: count,
      room2011: room2011 ? { pin: room2011.pin, mediaCount: room2011.media.length, media: room2011.media } : null
    });
  } catch (err) {
    return res.status(500).json({ error: err.message, stack: err.stack });
  }
});

// 1. Check PIN Status
app.get('/api/room/:pin/check', async (req, res) => {
  const pin = req.params.pin.trim();
  const room = await getRoom(pin);
  res.json({ exists: !!room, pin });
});

// 2. Create Room (Guaranteed permanent in MongoDB)
app.post('/api/room/create', async (req, res) => {
  const { pin } = req.body;
  if (!pin || typeof pin !== 'string') {
    return res.status(400).json({ error: 'PIN is required' });
  }

  const cleanPin = pin.trim();
  if (cleanPin.length < 3) {
    return res.status(400).json({ error: 'PIN must be at least 3 digits' });
  }

  const room = await createRoom(cleanPin);
  if (!room) {
    return res.status(409).json({
      error: `PIN "${cleanPin}" is already taken! Multiple users cannot create a room with the same PIN.`
    });
  }

  res.json({ success: true, pin: cleanPin });
});

// 3. Get Media for Room
app.get('/api/room/:pin/media', async (req, res) => {
  const pin = req.params.pin.trim();
  const room = await getRoom(pin);
  if (!room) {
    return res.status(404).json({ error: 'Room does not exist' });
  }
  res.json({ pin, media: room.media || [] });
});

// 4. Direct Client Upload Token Generator
app.post('/api/get-upload-url', async (req, res) => {
  try {
    const token = process.env.BLOB_READ_WRITE_TOKEN;
    if (!token) {
      return res.status(500).json({ error: 'BLOB_READ_WRITE_TOKEN is not configured in environment variables' });
    }
    const { filename } = req.body || {};
    const cleanName = filename ? filename.replace(/[^a-zA-Z0-9.-]/g, '_') : 'file';
    const pathname = `rooms/${Date.now()}-${cleanName}`;

    if (!generateClientTokenFromReadWriteToken) {
      const blobClient = require('@vercel/blob/client');
      generateClientTokenFromReadWriteToken = blobClient.generateClientTokenFromReadWriteToken;
    }

    const clientToken = await generateClientTokenFromReadWriteToken({
      token,
      pathname,
      validUntil: Date.now() + 3600 * 1000 // 1 hour
    });

    return res.json({
      uploadUrl: `https://blob.vercel-storage.com/${pathname}`,
      clientToken,
      pathname
    });
  } catch (err) {
    console.error('get-upload-url error:', err);
    return res.status(500).json({ error: err.message });
  }
});

// 5. Save Uploaded Media Metadata to MongoDB & in-memory room
app.post('/api/room/:pin/media-saved', async (req, res) => {
  const pin = req.params.pin.trim();
  const { items } = req.body;
  if (!items || !Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: 'No media items provided' });
  }

  // Ensure room exists locally immediately
  if (!localRooms[pin]) {
    localRooms[pin] = { pin, createdAt: new Date().toISOString(), media: [] };
  }
  localRooms[pin].media.unshift(...items);

  let dbResult = null;
  let dbError = null;
  try {
    dbResult = await addMediaToRoom(pin, items);
  } catch (err) {
    dbError = err.message;
    console.error('Save to MongoDB failed:', err);
  }

  broadcastToPin(pin, { type: 'NEW_MEDIA', items });
  return res.json({ success: true, count: items.length, dbSaved: !!dbResult, dbError });
});

// 6. Fallback Upload Route (for local testing without Vercel Blob)
app.post('/api/room/:pin/upload', upload.array('files', 20), async (req, res) => {
  const pin = req.params.pin.trim();
  const room = await getRoom(pin);
  if (!room) {
    return res.status(404).json({ error: 'Room does not exist' });
  }

  if (!req.files || req.files.length === 0) {
    return res.status(400).json({ error: 'No media files received' });
  }

  const newItems = req.files.map(file => {
    const isVideo = file.mimetype.startsWith('video');
    return {
      id: path.parse(file.filename).name,
      filename: file.filename,
      originalName: file.originalname,
      mimeType: file.mimetype,
      type: isVideo ? 'video' : 'photo',
      size: file.size,
      url: `/uploads/${file.filename}`,
      uploadedAt: new Date().toISOString()
    };
  });

  await addMediaToRoom(pin, newItems);
  broadcastToPin(pin, { type: 'NEW_MEDIA', items: newItems });

  res.json({ success: true, count: newItems.length, items: newItems });
});

// Configure Cloudinary SDK if credentials exist
let cloudinary = null;
try {
  cloudinary = require('cloudinary').v2;
  if (process.env.CLOUDINARY_CLOUD_NAME || process.env.CLOUDINARY_API_KEY) {
    cloudinary.config({
      cloud_name: process.env.CLOUDINARY_CLOUD_NAME || 'diubhg6ri',
      api_key: process.env.CLOUDINARY_API_KEY,
      api_secret: process.env.CLOUDINARY_API_SECRET
    });
  }
} catch (e) {}

// 7. Delete media (removes from database AND permanently deletes from Cloudinary)
app.delete('/api/room/:pin/media/:id', async (req, res) => {
  const pin = req.params.pin.trim();
  const { id } = req.params;

  const removed = await removeMediaFromRoom(pin, id);
  if (!removed) {
    return res.status(404).json({ error: 'Media not found' });
  }

  // Permanently delete from Cloudinary
  if (removed.publicId && cloudinary && process.env.CLOUDINARY_API_KEY && process.env.CLOUDINARY_API_SECRET) {
    try {
      const resourceType = removed.type === 'video' ? 'video' : 'image';
      await cloudinary.uploader.destroy(removed.publicId, { resource_type: resourceType });
      console.log(`Permanently destroyed from Cloudinary: ${removed.publicId}`);
    } catch (cErr) {
      console.error('Cloudinary destroy error:', cErr.message);
    }
  }

  broadcastToPin(pin, { type: 'DELETE_MEDIA', id });
  res.json({ success: true, removedPermanently: true });
});

// WebSocket Server (local and VPS)
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
    console.log(`🚀 AlphaBeta Server is running!`);
    console.log(`💻 Local: http://localhost:${PORT}`);
    const ips = getLocalIpAddresses();
    if (ips.length > 0) {
      console.log(`📱 On Network:`);
      ips.forEach(ip => console.log(`   👉 http://${ip}:${PORT}`));
    }
    console.log(`======================================================\n`);
  });
}

module.exports = app;
