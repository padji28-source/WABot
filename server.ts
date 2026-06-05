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
  
  const rawBody = req.method === 'GET' ? req.query.Body : req.body.Body;
  const incomingMsg = typeof rawBody === 'string' ? rawBody.trim() : '';
  const lowerMsg = incomingMsg.toLowerCase();

  // Parse cookies for state
  let cookies: any = {};
  const cookieHeader = req.headers.cookie;
  if (cookieHeader) {
      cookieHeader.split(';').forEach((cookie: string) => {
          const parts = cookie.split('=');
          if (parts.length >= 2) {
             const name = parts[0].trim();
             const value = parts.slice(1).join('=').trim();
             cookies[name] = decodeURIComponent(value);
          }
      });
  }

  let sessionStep = cookies['sessionStep'] || 'none';
  let selectedLocator = cookies['selectedLocator'] || '';

  if (lowerMsg === 'menu' || lowerMsg === 'help') {
      sessionStep = 'none';
  } else if (lowerMsg.startsWith('barang ') || lowerMsg.startsWith('locator ')) {
      sessionStep = 'none';
  }

  const twiml = new twilio.twiml.MessagingResponse();

  try {
    const data = await fetchStockData();
    const uniqueLocators = Array.from(new Set(data.map(item => item.locator).filter(Boolean))).sort();

    // 1. Show Menu
    if (sessionStep === 'none' && (lowerMsg === "menu" || lowerMsg === "help" || !lowerMsg)) {
        let msg = `*🤖 MENU PENCARIAN STOK*\n\n`;
        msg += `*Pilih Lokasi (Kirim Angka)*:\n`;
        uniqueLocators.forEach((loc, idx) => {
           if (idx < 25) msg += `${idx + 1}. ${loc}\n`;
        });
        msg += `\n_Atau pencarian langsung bebas:_\n`;
        msg += `📦 Ketik: *barang [nama]*\n`;
        msg += `📍 Ketik: *locator [nama]*`;
        
        twiml.message(msg);
        res.setHeader('Set-Cookie', [
          `sessionStep=waiting_locator; Path=/; Max-Age=3600`, 
          `selectedLocator=; Path=/; Max-Age=3600`
        ]);
        res.type('text/xml').send(twiml.toString());
        return;
    }

    // 2. Select Locator
    if (sessionStep === 'waiting_locator') {
        const choiceMatch = incomingMsg.match(/^\d+$/);
        if (choiceMatch) {
            const idx = parseInt(choiceMatch[0], 10) - 1;
            if (idx >= 0 && idx < uniqueLocators.length) {
                const chosenLoc = uniqueLocators[idx];
                twiml.message(`📍 Lokasi terpilih: *${chosenLoc}*\n\nSilakan ketik *nama barang* yang ingin dicari di lokasi ini.\n\n_Ketik *menu* kapan saja untuk kembali._`);
                res.setHeader('Set-Cookie', [
                  `sessionStep=waiting_item; Path=/; Max-Age=3600`, 
                  `selectedLocator=${encodeURIComponent(chosenLoc)}; Path=/; Max-Age=3600`
                ]);
                res.type('text/xml').send(twiml.toString());
                return;
            }
        }
        twiml.message(`⚠️ Pilihan tidak valid. Silakan balas dengan pilihan ANGKA yang sesuai, atau ketik *menu* untuk mengulang.`);
        res.type('text/xml').send(twiml.toString());
        return;
    }

    // 3. Search Data
    let matches = [];
    let contextMessage = "";

    if (lowerMsg.startsWith('locator ')) {
        const q = lowerMsg.replace(/^locator\s+/i, '').trim();
        matches = data.filter(item => 
            (item.locator && item.locator.toLowerCase().includes(q)) ||
            (item.area && item.area.toLowerCase().includes(q))
        );
        contextMessage = `*Pencarian Locator "${q}"*`;
    } else if (lowerMsg.startsWith('barang ')) {
        const q = lowerMsg.replace(/^barang\s+/i, '').trim();
        matches = data.filter(item => 
            (item.name && item.name.toLowerCase().includes(q)) ||
            (item.searchKey && item.searchKey.toLowerCase().includes(q))
        );
        contextMessage = `*Pencarian Barang "${q}"* (Semua Lokasi)`;
    } else {
        const q = lowerMsg.replace(/^(stok|stock|cek|cari)\s+/i, '').trim();
        if(!q) {
           twiml.message(`Silakan ketik *menu* untuk memulai pencarian.`);
           res.type('text/xml').send(twiml.toString());
           return;
        }

        if (sessionStep === 'waiting_item' && selectedLocator) {
            matches = data.filter(item => 
                item.locator === selectedLocator && 
                ((item.name && item.name.toLowerCase().includes(q)) ||
                 (item.searchKey && item.searchKey.toLowerCase().includes(q)))
            );
            contextMessage = `*Stok "${q}" di ${selectedLocator}*`;
        } else {
             matches = data.filter(item => 
                (item.name && item.name.toLowerCase().includes(q)) ||
                (item.searchKey && item.searchKey.toLowerCase().includes(q)) ||
                (item.locator && item.locator.toLowerCase().includes(q))
            );
            contextMessage = `*Pencarian Bebas "${q}"* (Semua Lokasi)`;
        }
    }

    if (matches.length === 0) {
        twiml.message(`Maaf, data tidak ditemukan.\n\n${contextMessage}\n_Ketik *menu* apabila ingin kembali ke menu awal._`);
    } else {
        const limitedResults = matches.slice(0, 8); 
        let messageBody = `${contextMessage}\n\n`;
        
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

        if (matches.length > 8) {
          messageBody += `_Ditemukan total ${matches.length} hasil. Gunakan nama spesifik._\n`;
        }

        if (sessionStep === 'waiting_item') {
          messageBody += `\n_Ketik barang lain untuk mencari lagi di lokasi ini, atau *menu*._`;
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
