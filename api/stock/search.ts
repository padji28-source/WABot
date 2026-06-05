import Papa from 'papaparse';

const CSV_URL = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vSbvA_5FOxi2-nkfz8iJbptOhDfBCLM5LnTwrVLeJ4pf1hlGjSBywsTXQYYtEjuo0DY2M63wcJmc0tP/pub?gid=263347272&single=true&output=csv';

export default async function handler(req: any, res: any) {
  const query = (req.query.q as string || '').toLowerCase();
  try {
    const response = await fetch(CSV_URL);
    if (!response.ok) throw new Error('HTTP error');
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
          
          if (!query) {
            return res.status(200).json(data.slice(0, 50));
          }
          
          const filtered = data.filter(item => 
            (item.name && item.name.toLowerCase().includes(query)) ||
            (item.searchKey && item.searchKey.toLowerCase().includes(query))
          );
          res.status(200).json(filtered);
        } else {
          res.status(500).json({ error: "No data" });
        }
      },
      error: () => res.status(500).json({ error: "Parse error" })
    });
  } catch (error) {
    res.status(500).json({ error: "Fetch error" });
  }
}
