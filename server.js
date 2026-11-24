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
  media: { type: Array, default: [] }
}, { strict: false });

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
    const rawItems = items.map(item => ({
      id: String(item.id || ''),
      filename: String(item.filename || ''),
      originalName: String(item.originalName || ''),
      mimeType: String(item.mimeType || ''),
      type: String(item.type || 'photo'),
      size: Number(item.size || 0),
      url: String(item.url || ''),
      publicId: String(item.publicId || ''),
      uploadedAt: String(item.uploadedAt || new Date().toISOString())
    }));

    // Update using native collection or model to avoid array nesting issues
    const updated = await Room.findOneAndUpdate(
      { pin },
      { $push: { media: { $each: rawItems, $position: 0 } } },
      { new: true, runValidators: false }
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

async function togglePinMediaInRoom(pin, mediaId) {
  const hasDB = await connectDB();
  if (hasDB) {
    const room = await Room.findOne({ pin });
    if (!room) return null;
    const item = room.media.find(m => m.id === mediaId);
    if (!item) return null;

    const newPinned = !item.pinned;
    await Room.updateOne(
      { pin, 'media.id': mediaId },
      { $set: { 'media.$.pinned': newPinned } }
    );
    item.pinned = newPinned;
    return item;
  } else {
    if (!localRooms[pin] || !localRooms[pin].media) return null;
    const item = localRooms[pin].media.find(m => m.id === mediaId);
    if (!item) return null;
    item.pinned = !item.pinned;
    return item;
  }
}

async function toggleLikeMediaInRoom(pin, mediaId) {
  const hasDB = await connectDB();
  if (hasDB) {
    const room = await Room.findOne({ pin });
    if (!room) return null;
    const item = room.media.find(m => m.id === mediaId);
    if (!item) return null;

    const newLikes = (item.likes || 0) + 1;
    await Room.updateOne(
      { pin, 'media.id': mediaId },
      { $set: { 'media.$.likes': newLikes } }
    );
    item.likes = newLikes;
    return item;
  } else {
    if (!localRooms[pin] || !localRooms[pin].media) return null;
    const item = localRooms[pin].media.find(m => m.id === mediaId);
    if (!item) return null;
    item.likes = (item.likes || 0) + 1;
    return item;
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

// Debug DB & Cloudinary Configuration
app.get('/api/debug-config', async (req, res) => {
  const uri = process.env.MONGODB_URI;
  const hasDB = await connectDB();
  const hasCloudinaryKey = !!process.env.CLOUDINARY_API_KEY;
  const hasCloudinarySecret = !!process.env.CLOUDINARY_API_SECRET;
  const cloudName = process.env.CLOUDINARY_CLOUD_NAME || 'diubhg6ri';
  
  return res.json({
    database: {
      connected: hasDB,
      hasUri: !!uri
    },
    cloudinary: {
      cloudName,
      hasApiKey: hasCloudinaryKey,
      hasApiSecret: hasCloudinarySecret,
      deletionReady: hasCloudinaryKey && hasCloudinarySecret
    }
  });
});

// Storage Usage API (Queries Cloudinary Usage API directly when credentials exist, with DB fallback)
const TOTAL_STORAGE_LIMIT_BYTES = 25 * 1024 * 1024 * 1024; // 25 GB free tier

app.get('/api/storage-stats', async (req, res) => {
  try {
    const apiKey = process.env.CLOUDINARY_API_KEY;
    const apiSecret = process.env.CLOUDINARY_API_SECRET;
    const cloudName = process.env.CLOUDINARY_CLOUD_NAME || 'diubhg6ri';

    // 1. If Cloudinary credentials are provided, fetch live account usage from Cloudinary Admin API
    if (apiKey && apiSecret && cloudinary) {
      try {
        cloudinary.config({
          cloud_name: cloudName,
          api_key: apiKey,
          api_secret: apiSecret
        });

        const usageData = await cloudinary.api.usage();
        console.log('[Cloudinary Usage API] Live usage response:', usageData?.storage);

        // usageData.storage typically contains { usage: bytes, limit: bytes, used_percent: float }
        const usedBytes = usageData?.storage?.usage || 0;
        const totalLimitBytes = usageData?.storage?.limit || TOTAL_STORAGE_LIMIT_BYTES;
        const remainingBytes = Math.max(0, totalLimitBytes - usedBytes);
        const usedPercentage = usageData?.storage?.used_percent || ((usedBytes / totalLimitBytes) * 100);

        return res.json({
          source: 'cloudinary',
          totalLimitBytes,
          usedBytes,
          remainingBytes,
          usedPercentage: parseFloat(Number(usedPercentage).toFixed(2)),
          credits: usageData?.credits || null
        });
      } catch (cErr) {
        console.warn('[Cloudinary Usage API Error] Falling back to database sum:', cErr.message);
      }
    }

    // 2. Fallback: Calculate from MongoDB Atlas or local memory
    const hasDB = await connectDB();
    let totalBytesUsed = 0;
    let totalFilesCount = 0;
    let totalRoomsCount = 0;

    if (hasDB) {
      const rooms = await Room.find({}, { media: 1 }).lean();
      totalRoomsCount = rooms.length;
      rooms.forEach(r => {
        if (Array.isArray(r.media)) {
          r.media.forEach(m => {
            totalFilesCount++;
            totalBytesUsed += Number(m.size || 0);
          });
        }
      });
    } else {
      const roomKeys = Object.keys(localRooms);
      totalRoomsCount = roomKeys.length;
      roomKeys.forEach(k => {
        const r = localRooms[k];
        if (Array.isArray(r.media)) {
          r.media.forEach(m => {
            totalFilesCount++;
            totalBytesUsed += Number(m.size || 0);
          });
        }
      });
    }

    const remainingBytes = Math.max(0, TOTAL_STORAGE_LIMIT_BYTES - totalBytesUsed);
    const usedPercentage = Math.min(100, (totalBytesUsed / TOTAL_STORAGE_LIMIT_BYTES) * 100);

    return res.json({
      source: 'database',
      totalLimitBytes: TOTAL_STORAGE_LIMIT_BYTES,
      usedBytes: totalBytesUsed,
      remainingBytes,
      usedPercentage: parseFloat(usedPercentage.toFixed(2)),
      totalFiles: totalFilesCount,
      totalRooms: totalRoomsCount
    });
  } catch (err) {
    console.error('Storage stats error:', err);
    return res.status(500).json({ error: 'Failed to calculate storage stats' });
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

  let cloudinaryResult = null;
  let cloudinaryError = null;

  // Check if Cloudinary credentials are configured
  const apiKey = process.env.CLOUDINARY_API_KEY;
  const apiSecret = process.env.CLOUDINARY_API_SECRET;
  const cloudName = process.env.CLOUDINARY_CLOUD_NAME || 'diubhg6ri';

  if (!apiKey || !apiSecret) {
    cloudinaryError = 'Missing CLOUDINARY_API_KEY or CLOUDINARY_API_SECRET in Vercel environment variables';
    console.warn(`[Cloudinary Warning] Cannot delete asset ${removed.publicId}: ${cloudinaryError}`);
  } else if (removed.publicId && cloudinary) {
    try {
      cloudinary.config({
        cloud_name: cloudName,
        api_key: apiKey,
        api_secret: apiSecret
      });
      const resourceType = removed.type === 'video' ? 'video' : 'image';
      cloudinaryResult = await cloudinary.uploader.destroy(removed.publicId, {
        resource_type: resourceType,
        invalidate: true
      });
      console.log(`[Cloudinary Success] Destroyed ${removed.publicId} (${resourceType}):`, cloudinaryResult);
    } catch (cErr) {
      cloudinaryError = cErr.message;
      console.error(`[Cloudinary Error] Failed to destroy ${removed.publicId}:`, cErr);
    }
  }

  broadcastToPin(pin, { type: 'DELETE_MEDIA', id });
  res.json({
    success: true,
    removedPermanently: !!cloudinaryResult && cloudinaryResult.result === 'ok',
    cloudinaryResult,
    cloudinaryError,
    missingCloudinaryKeys: !apiKey || !apiSecret
  });
});

// 8. Batch Delete Media (Multiple items in a single click)
app.post('/api/room/:pin/media-batch-delete', async (req, res) => {
  const pin = req.params.pin.trim();
  const { ids } = req.body;
  if (!ids || !Array.isArray(ids) || ids.length === 0) {
    return res.status(400).json({ error: 'No media IDs provided' });
  }

  const apiKey = process.env.CLOUDINARY_API_KEY;
  const apiSecret = process.env.CLOUDINARY_API_SECRET;
  const cloudName = process.env.CLOUDINARY_CLOUD_NAME || 'diubhg6ri';

  const deletedIds = [];

  for (const id of ids) {
    const removed = await removeMediaFromRoom(pin, id);
    if (removed) {
      deletedIds.push(id);
      if (removed.publicId && cloudinary && apiKey && apiSecret) {
        try {
          cloudinary.config({ cloud_name: cloudName, api_key: apiKey, api_secret: apiSecret });
          const resourceType = removed.type === 'video' ? 'video' : 'image';
          await cloudinary.uploader.destroy(removed.publicId, { resource_type: resourceType, invalidate: true });
        } catch (cErr) {
          console.warn(`[Batch Destroy Warning] Could not destroy ${removed.publicId}:`, cErr.message);
        }
      }
    }
  }

  deletedIds.forEach(id => broadcastToPin(pin, { type: 'DELETE_MEDIA', id }));
  res.json({ success: true, count: deletedIds.length, deletedIds });
});

// 9. Batch Pin Media (Pin or Unpin multiple selected items in one click)
app.post('/api/room/:pin/media-batch-pin', async (req, res) => {
  const pin = req.params.pin.trim();
  const { ids, pinState } = req.body;
  if (!ids || !Array.isArray(ids) || ids.length === 0) {
    return res.status(400).json({ error: 'No media IDs provided' });
  }

  const targetPinState = typeof pinState === 'boolean' ? pinState : true;
  const updatedIds = [];

  const hasDB = await connectDB();
  if (hasDB) {
    for (const id of ids) {
      await Room.updateOne(
        { pin, 'media.id': id },
        { $set: { 'media.$.pinned': targetPinState } }
      );
      updatedIds.push(id);
      broadcastToPin(pin, { type: 'PIN_MEDIA', id, pinned: targetPinState });
    }
  } else if (localRooms[pin] && Array.isArray(localRooms[pin].media)) {
    ids.forEach(id => {
      const item = localRooms[pin].media.find(m => m.id === id);
      if (item) {
        item.pinned = targetPinState;
        updatedIds.push(id);
        broadcastToPin(pin, { type: 'PIN_MEDIA', id, pinned: targetPinState });
      }
    });
  }

  res.json({ success: true, count: updatedIds.length, pinned: targetPinState });
});

// 10. Toggle Pin on Media (Puts favorite at top of feed)
app.post('/api/room/:pin/media/:id/pin', async (req, res) => {
  const pin = req.params.pin.trim();
  const { id } = req.params;

  const item = await togglePinMediaInRoom(pin, id);
  if (!item) {
    return res.status(404).json({ error: 'Media not found' });
  }

  broadcastToPin(pin, { type: 'PIN_MEDIA', id, pinned: item.pinned });
  res.json({ success: true, pinned: item.pinned });
});

// 9. Like Media
app.post('/api/room/:pin/media/:id/like', async (req, res) => {
  const pin = req.params.pin.trim();
  const { id } = req.params;

  const item = await toggleLikeMediaInRoom(pin, id);
  if (!item) {
    return res.status(404).json({ error: 'Media not found' });
  }

  broadcastToPin(pin, { type: 'LIKE_MEDIA', id, likes: item.likes });
  res.json({ success: true, likes: item.likes });
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
