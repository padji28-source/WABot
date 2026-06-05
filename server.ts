import express from 'express';
import bodyParser from 'body-parser';
import twilio from 'twilio';
import Papa from 'papaparse';
import path from 'path';
import { createServer as createViteServer } from 'vite';

const app = express();
const PORT = 3000;

const CSV_URL = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vSbvA_5FOxi2-nkfz8iJbptOhDfBCLM5LnTwrVLeJ4pf1hlGjSBywsTXQYYtEjuo0DY2M63wcJmc0tP/pub?gid=263347272&single=true&output=csv';

// A simple in-memory cache to avoid hitting the CSV on every single query
let cachedData: any[] = [];
let lastFetchTime = 0;
const CACHE_TTL = 1000 * 60 * 5; // 5 minutes

// Enable URL-encoded parsing (Twilio uses this)
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

async function fetchStockData() {
  const now = Date.now();
  if (cachedData.length > 0 && (now - lastFetchTime) < CACHE_TTL) {
    return cachedData;
  }

  try {
    const response = await fetch(CSV_URL);
    if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
    const csvText = await response.text();
    
    return new Promise<any[]>((resolve, reject) => {
      Papa.parse(csvText, {
        header: false,
        skipEmptyLines: true,
        complete: (results) => {
          // The actual data starts at row 4 (index 3)
          // Index 7: Search Key, Index 8: Name, Index 3: Area, Index 4: Locator, Index 23: Last Qty
          const rows = results.data as string[][];
          if (rows.length > 3) {
            const dataRows = rows.slice(3);
            cachedData = dataRows.map(row => ({
              whGroup: row[0],
              area: row[3],
              locator: row[4],
              searchKey: row[7],
              name: row[8],
              uom: row[9],
              lastQty: row[row.length - 1] // Last column should be Last Qty
            }));
            lastFetchTime = now;
            resolve(cachedData);
          } else {
            reject(new Error("CSV text doesn't contain enough rows"));
          }
        },
        error: (error: any) => {
          reject(error);
        }
      });
    });
  } catch (error) {
    console.error("Error fetching stock data:", error);
    return cachedData; // Fallback to stale cache if fetch fails
  }
}

// Support both GET and POST in case user misconfigures the webhook in Twilio
app.all(['/api/webhook/twilio', '/webhook/whatsapp'], async (req, res) => {
  console.log(`[Twilio Webhook] Received ${req.method} request!`);
  console.log("[Twilio Webhook] Body:", req.body);
  console.log("[Twilio Webhook] Query:", req.query);
  
  // Extract message from either POST body or GET query
  const rawBody = req.method === 'GET' ? req.query.Body : req.body.Body;
  const rawFrom = req.method === 'GET' ? req.query.From : req.body.From;

  const incomingMsg = typeof rawBody === 'string' ? rawBody.trim().toLowerCase() : '';
  const from = typeof rawFrom === 'string' ? rawFrom : 'Unknown';

  const twiml = new twilio.twiml.MessagingResponse();

  if (!incomingMsg || incomingMsg === "menu" || incomingMsg === "help") {
    const menuMessage = `*🤖 BANTUAN PENCARIAN STOK*\n\n` +
      `Silakan gunakan salah satu format perintah berikut:\n\n` +
      `📦 *Cari berdasarkan Nama Barang:*\n` +
      `Ketik: *barang [nama barang]*\n` +
      `Contoh: _barang elbow_\n\n` +
      `📍 *Cari berdasarkan Locator:*\n` +
      `Ketik: *locator [nama locator]*\n` +
      `Contoh: _locator PSN-JKT_\n\n` +
      `⚡ *Pencarian Cepat:*\n` +
      `Langsung ketik nama barang atau kata kunci bebas.\n` +
      `Contoh: _pvc_`;
    twiml.message(menuMessage);
    res.type('text/xml').send(twiml.toString());
    return;
  }

  let searchQuery = incomingMsg;
  let searchType = 'all'; // can be 'locator', 'item', 'all'

  if (incomingMsg.startsWith('locator ')) {
    searchQuery = incomingMsg.replace(/^locator\s+/i, '').trim();
    searchType = 'locator';
  } else if (incomingMsg.startsWith('barang ')) {
    searchQuery = incomingMsg.replace(/^barang\s+/i, '').trim();
    searchType = 'item';
  } else {
    // try to remove basic prefixes that users might type
    searchQuery = incomingMsg.replace(/^(stok|stock|cek|cari)\s+/i, '').trim();
  }

  try {
    const data = await fetchStockData();
    
    let results = [];
    if (searchType === 'locator') {
      results = data.filter(item => 
        (item.locator && item.locator.toLowerCase().includes(searchQuery)) ||
        (item.area && item.area.toLowerCase().includes(searchQuery))
      );
    } else if (searchType === 'item') {
      results = data.filter(item => 
        (item.name && item.name.toLowerCase().includes(searchQuery)) ||
        (item.searchKey && item.searchKey.toLowerCase().includes(searchQuery))
      );
    } else {
      results = data.filter(item => 
        (item.name && item.name.toLowerCase().includes(searchQuery)) ||
        (item.searchKey && item.searchKey.toLowerCase().includes(searchQuery)) ||
        (item.locator && item.locator.toLowerCase().includes(searchQuery))
      );
    }

    if (results.length === 0) {
      twiml.message(`Maaf, data dengan kata kunci "${searchQuery}" tidak ditemukan.`);
    } else {
      const limitedResults = results.slice(0, 8); // Limit to avoid hitting message size limits
      
      let messageBody = `*Hasil Limit 8 Data untuk "${searchQuery}"*\n\n`;
      
      // We will generate an ASCII table in a code block for WhatsApp
      // Note: WhatsApp supports monospaced text via ```
      
      // Find max lengths for padding (with hard limits for mobile screens)
      const maxNameLen = 15;
      const maxLocLen = 12;
      const maxQtyLen = 6;
      
      const padText = (text: string, max: number) => {
        let str = String(text || '').trim();
        if (str.length > max) return str.substring(0, max - 1) + '…';
        return str.padEnd(max, ' ');
      };

      messageBody += "```\n";
      messageBody += "Barang          | Lokasi       | Stok  \n";
      messageBody += "----------------+--------------+-------\n";
      
      limitedResults.forEach(item => {
        const nam = padText(item.name, maxNameLen);
        const loc = padText(item.locator, maxLocLen);
        const qty = padText(item.lastQty, maxQtyLen);
        messageBody += `${nam} | ${loc} | ${qty}\n`;
      });
      messageBody += "```\n";

      if (results.length > 8) {
        messageBody += `_Ditemukan total ${results.length} hasil. Harap gunakan kata kunci yang lebih spesifik._`;
      }

      twiml.message(messageBody);
    }
  } catch (error) {
    console.error("Webhook processing error:", error);
    twiml.message("Maaf, terjadi kesalahan saat mengambil data stok. Coba lagi nanti.");
  }

  res.type('text/xml').send(twiml.toString());
});

// Used for testing without Twilio
app.get('/api/stock/search', async (req, res) => {
  const query = (req.query.q as string || '').toLowerCase();
  try {
    const data = await fetchStockData();
    if (!query) return res.json(data.slice(0, 50));
    
    const results = data.filter(item => 
      (item.name && item.name.toLowerCase().includes(query)) ||
      (item.searchKey && item.searchKey.toLowerCase().includes(query))
    );
    res.json(results);
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch data" });
  }
});

app.get('/api/config', (req, res) => {
  // Use APP_URL if available, otherwise try to replace dev URL with pre (Shared) URL
  const host = req.get('host') || '';
  const publicHost = host.replace('ais-dev-', 'ais-pre-');
  const baseUrl = process.env.APP_URL || `https://${publicHost}`;
  res.json({ webhookUrl: `${baseUrl}/api/webhook/twilio` });
});

async function startServer() {
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa'
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on port ${PORT}`);
  });
}

startServer();
