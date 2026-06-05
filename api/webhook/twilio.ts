import twilio from 'twilio';
import Papa from 'papaparse';

const CSV_URL = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vSbvA_5FOxi2-nkfz8iJbptOhDfBCLM5LnTwrVLeJ4pf1hlGjSBywsTXQYYtEjuo0DY2M63wcJmc0tP/pub?gid=263347272&single=true&output=csv';

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST' && req.method !== 'GET') {
    return res.status(405).end();
  }

  const rawBody = req.method === 'GET' ? req.query.Body : req.body.Body;
  const incomingMsg = typeof rawBody === 'string' ? rawBody.trim().toLowerCase() : '';

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
    res.setHeader('Content-Type', 'text/xml');
    return res.status(200).send(twiml.toString());
  }

  let searchQuery = incomingMsg;
  let searchType = 'all'; 

  if (incomingMsg.startsWith('locator ')) {
    searchQuery = incomingMsg.replace(/^locator\s+/i, '').trim();
    searchType = 'locator';
  } else if (incomingMsg.startsWith('barang ')) {
    searchQuery = incomingMsg.replace(/^barang\s+/i, '').trim();
    searchType = 'item';
  } else {
    searchQuery = incomingMsg.replace(/^(stok|stock|cek|cari)\s+/i, '').trim();
  }

  try {
    const response = await fetch(CSV_URL);
    const csvText = await response.text();
    
    Papa.parse(csvText, {
      header: false,
      skipEmptyLines: true,
      complete: (results) => {
        const rows = results.data as string[][];
        if (rows.length > 3) {
          const data = rows.slice(3).map(row => ({
            whGroup: row[0],
            area: row[3],
            locator: row[4],
            searchKey: row[7],
            name: row[8],
            uom: row[9],
            lastQty: row[row.length - 1]
          }));
          
          let matches = [];
          if (searchType === 'locator') {
            matches = data.filter(item => 
              (item.locator && item.locator.toLowerCase().includes(searchQuery)) ||
              (item.area && item.area.toLowerCase().includes(searchQuery))
            );
          } else if (searchType === 'item') {
            matches = data.filter(item => 
              (item.name && item.name.toLowerCase().includes(searchQuery)) ||
              (item.searchKey && item.searchKey.toLowerCase().includes(searchQuery))
            );
          } else {
            matches = data.filter(item => 
              (item.name && item.name.toLowerCase().includes(searchQuery)) ||
              (item.searchKey && item.searchKey.toLowerCase().includes(searchQuery)) ||
              (item.locator && item.locator.toLowerCase().includes(searchQuery))
            );
          }

          if (matches.length === 0) {
            twiml.message(`Maaf, data dengan kata kunci "${searchQuery}" tidak ditemukan.`);
          } else {
            const limitedResults = matches.slice(0, 8); 
            let messageBody = `*Hasil Limit 8 Data untuk "${searchQuery}"*\n\n`;
            
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
              messageBody += `_Ditemukan total ${matches.length} hasil. Harap gunakan kata kunci yang lebih spesifik._`;
            }

            twiml.message(messageBody);
          }
        } else {
           twiml.message("Maaf, data kosong.");
        }
        res.setHeader('Content-Type', 'text/xml');
        res.status(200).send(twiml.toString());
      },
      error: () => {
        twiml.message("Maaf, terjadi kesalahan saat mengambil data stok.");
        res.setHeader('Content-Type', 'text/xml');
        res.status(200).send(twiml.toString());
      }
    });

  } catch (error) {
    twiml.message("Maaf, terjadi kesalahan.");
    res.setHeader('Content-Type', 'text/xml');
    res.status(200).send(twiml.toString());
  }
}
