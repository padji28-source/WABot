import twilio from 'twilio';
import Papa from 'papaparse';

const CSV_URL = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vSbvA_5FOxi2-nkfz8iJbptOhDfBCLM5LnTwrVLeJ4pf1hlGjSBywsTXQYYtEjuo0DY2M63wcJmc0tP/pub?gid=263347272&single=true&output=csv';

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST' && req.method !== 'GET') {
    return res.status(405).end();
  }

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
    const response = await fetch(CSV_URL);
    const csvText = await response.text();
    
    Papa.parse(csvText, {
      header: false,
      skipEmptyLines: true,
      complete: (results) => {
        const rows = results.data as string[][];
        if (rows.length <= 3) {
           twiml.message("Maaf, data kosong.");
           res.setHeader('Content-Type', 'text/xml');
           return res.status(200).send(twiml.toString());
        }

        const data = rows.slice(3).map(row => ({
          whGroup: row[0],
          area: row[3],
          locator: row[4],
          searchKey: row[7],
          name: row[8],
          uom: row[9],
          lastQty: row[row.length - 1]
        }));

        const uniqueLocators = Array.from(new Set(data.map(item => item.locator).filter(Boolean))).sort();

        // 1. Show Menu
        if (sessionStep === 'none' && (lowerMsg === "menu" || lowerMsg === "help")) {
            let msg = `*🤖 MENU PENCARIAN STOK*\n\n`;
            msg += `*Pilih Lokasi (Kirim Angka)*:\n`;
            uniqueLocators.forEach((loc, idx) => {
               // Limit to 25 items max to prevent too long message
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
            res.setHeader('Content-Type', 'text/xml');
            return res.status(200).send(twiml.toString());
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
                    res.setHeader('Content-Type', 'text/xml');
                    return res.status(200).send(twiml.toString());
                }
            }
            twiml.message(`⚠️ Pilihan tidak valid. Silakan balas dengan pilihan ANGKA yang sesuai, atau ketik *menu* untuk mengulang.`);
            res.setHeader('Content-Type', 'text/xml');
            return res.status(200).send(twiml.toString());
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
               res.setHeader('Content-Type', 'text/xml');
               return res.status(200).send(twiml.toString());
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

        res.setHeader('Content-Type', 'text/xml');
        res.status(200).send(twiml.toString());
      },
      error: () => {
        twiml.message("Maaf, terjadi kesalahan saat parsing data.");
        res.setHeader('Content-Type', 'text/xml');
        res.status(200).send(twiml.toString());
      }
    });

  } catch (error) {
    twiml.message("Maaf, terjadi kesalahan saat menghubungi server Google.");
    res.setHeader('Content-Type', 'text/xml');
    res.status(200).send(twiml.toString());
  }
}

