/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useEffect } from 'react';
import { Settings, Server, ExternalLink, Package, RefreshCw, Smartphone } from 'lucide-react';

export default function App() {
  const [stockData, setStockData] = useState<any[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [webhookUrl, setWebhookUrl] = useState('Memuat URL...');

  const fetchStock = async (query = '') => {
    setLoading(true);
    try {
      const res = await fetch(`/api/stock/search?q=${encodeURIComponent(query)}`);
      const data = await res.json();
      setStockData(data);
    } catch (error) {
      console.error("Failed to load stock data", error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchStock();
    // Get correct webhook URL from server config to bypass Iframe origin
    fetch('/api/config')
      .then(r => r.json())
      .then(data => setWebhookUrl(data.webhookUrl))
      .catch(console.error);
  }, []);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    fetchStock(searchQuery);
  };

  return (
    <div className="min-h-screen bg-neutral-50 text-neutral-900 font-sans p-6 md:p-12">
      <div className="max-w-5xl mx-auto space-y-8">
        {/* Header */}
        <header className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-neutral-200 pb-6">
          <div>
            <h1 className="text-3xl font-bold tracking-tight mb-2">WhatsApp Stock Monitor</h1>
            <p className="text-neutral-500">Live synchronized with Google Sheets via Twilio</p>
          </div>
          <a
            href="https://console.twilio.com/"
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-2 bg-[#F22F46] hover:bg-[#D12B3E] text-white px-5 py-2.5 rounded-lg font-medium transition-colors w-fit"
          >
            Twilio Console <ExternalLink className="w-4 h-4" />
          </a>
        </header>

        <div className="grid md:grid-cols-3 gap-8">
          {/* Setup Instructions */}
          <div className="md:col-span-1 space-y-6">
            <div className="bg-white rounded-xl shadow-sm border border-neutral-200 p-6">
              <h2 className="flex items-center gap-2 text-lg font-semibold mb-4 text-neutral-800">
                <Settings className="w-5 h-5 text-blue-500" />
                Setup Webhook (Wajib Diperbarui)
              </h2>
              <ol className="space-y-4 text-sm text-neutral-600 list-decimal list-inside">
                <li>Buka console Twilio dan navigasikan ke <strong>Messaging {'>'} Try it out {'>'} Send a WhatsApp message {'>'} Sandbox settings</strong>.</li>
                <li>Pada bagian "Sandbox Configuration", temukan field <strong>"When a message comes in"</strong>.</li>
                <li><strong>Hapus URL lama (misal: railway.app) dan Ganti dengan URL baru di bawah ini secara utuh:</strong></li>
              </ol>
              <div className="mt-4 break-all bg-yellow-50 border border-yellow-200 rounded-lg p-3 text-xs font-mono text-yellow-900 select-all cursor-pointer">
                {webhookUrl}
              </div>
              <div className="mt-4 bg-red-50 border border-red-200 text-red-800 text-xs p-3 rounded-lg">
                <strong>PENTING:</strong> URL di atas menggunakan <code>ais-pre-</code> (Shared URL). Anda <strong>WAJIB menekan tombol Share / Deploy</strong> di AI Studio agar Twilio bisa mengakses Webhook ini tanpa terhalang halaman Login.
              </div>
              <p className="mt-4 text-sm text-neutral-600 font-medium">
                Setelah disave di Twilio, silakan ketik pesan WhatsApp: <strong>menu</strong>
              </p>
            </div>

            <div className="bg-white rounded-xl shadow-sm border border-neutral-200 p-6">
              <h2 className="flex items-center gap-2 text-lg font-semibold mb-4 text-neutral-800">
                <Smartphone className="w-5 h-5 text-green-500" />
                Contoh Pesan
              </h2>
              <div className="space-y-3">
                <div className="flex gap-3">
                  <div className="bg-green-100 text-green-800 px-3 py-2 rounded-lg rounded-tl-none inline-block max-w-[85%] text-sm">
                    barang elbow
                  </div>
                </div>
                <div className="flex gap-3 justify-end">
                  <div className="bg-neutral-100 text-neutral-800 px-3 py-2 rounded-lg rounded-tr-none inline-block max-w-[85%] text-sm whitespace-pre-wrap font-mono overflow-x-auto">
                    *Hasil Limit 8 Data untuk "elbow"*<br/><br/>
                    ```<br/>
                    Barang       | Lokasi            | Stok<br/>
                    -------------+-------------------+------<br/>
                    1" PVC ELBOW | PSN-JKT P5 PROD   | 1200<br/>
                    1" PVC ELBOW | PSN-JKT A5-1      | 27274<br/>
                    ```<br/>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Live Data Testing */}
          <div className="md:col-span-2 space-y-6">
            <div className="bg-white rounded-xl shadow-sm border border-neutral-200 overflow-hidden flex flex-col h-full max-h-[800px]">
              <div className="p-6 border-b border-neutral-200 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 bg-neutral-50/50">
                <h2 className="flex items-center gap-2 text-lg font-semibold text-neutral-800">
                  <Server className="w-5 h-5 text-purple-500" />
                  Live Google Sheet Data
                </h2>
                
                <form onSubmit={handleSearch} className="flex gap-2 w-full sm:w-auto">
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Test pencarian barang..."
                    className="flex-1 sm:w-64 px-4 py-2 text-sm border border-neutral-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  />
                  <button
                    type="submit"
                    disabled={loading}
                    className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors disabled:opacity-50 flex items-center justify-center"
                  >
                    {loading ? <RefreshCw className="w-4 h-4 animate-spin" /> : "Cari"}
                  </button>
                </form>
              </div>

              <div className="overflow-auto bg-white p-0 flex-1">
                {loading && stockData.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-20 text-neutral-400">
                    <RefreshCw className="w-8 h-8 animate-spin mb-4 text-blue-500" />
                    <p>Memuat data stok dari Google Sheets...</p>
                  </div>
                ) : stockData.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-20 text-neutral-400">
                    <Package className="w-12 h-12 mb-4 text-neutral-300" />
                    <p>Tidak ada data ditemukan.</p>
                  </div>
                ) : (
                  <table className="w-full text-sm text-left">
                    <thead className="text-xs text-neutral-500 bg-neutral-50 uppercase sticky top-0 border-b border-neutral-200">
                      <tr>
                        <th className="px-6 py-4 font-medium">Item & SKU</th>
                        <th className="px-6 py-4 font-medium">Area / Lokasi</th>
                        <th className="px-6 py-4 font-medium text-right">Stok (UOM)</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-neutral-100">
                      {stockData.map((item, idx) => (
                        <tr key={idx} className="hover:bg-neutral-50 transition-colors">
                          <td className="px-6 py-4">
                            <div className="font-medium text-neutral-900">{item.name}</div>
                            <div className="text-xs text-neutral-500 tracking-wider font-mono">{item.searchKey}</div>
                          </td>
                          <td className="px-6 py-4">
                            <div className="text-neutral-800">{item.area}</div>
                            <div className="text-xs text-neutral-500">{item.locator}</div>
                          </td>
                          <td className="px-6 py-4 text-right">
                            <span className="inline-flex items-center justify-center px-2.5 py-1 text-sm font-medium bg-blue-50 text-blue-700 rounded-full">
                              {item.lastQty} {item.uom}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
              <div className="p-4 border-t border-neutral-200 bg-neutral-50 text-xs text-neutral-500 flex justify-between items-center">
                <span>{stockData.length} hasil ditampilkan (Maks 50 UI Preview)</span>
                {lastUpdate && <span>Source: Google Sheets API</span>}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// Dummy variable definition to fix the lastUpdate reference in the footer
const lastUpdate = true;
