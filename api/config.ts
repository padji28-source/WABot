export default function handler(req: any, res: any) {
  const host = req.headers.host || '';
  const protocol = host.includes('localhost') ? 'http' : 'https';
  res.status(200).json({ webhookUrl: `${protocol}://${host}/api/webhook/twilio` });
}
