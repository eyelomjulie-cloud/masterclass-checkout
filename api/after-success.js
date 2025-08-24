// api/after-success.js
import Stripe from 'stripe';

function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: '2023-10-16' });

// Map PriceID -> Tag
const PRICE_TO_TAG = {
  'price_1RyfvYBuJldFrY1HUhhozNq1': 'paid: Introduction au massage sportif',
  'price_1RyfwWBuJldFrY1HvfnzyJjB': 'paid: Massage à 4 mains',
  'price_1RyfwrBuJldFrY1H4sF9UUn9': 'paid: Massage adapté pour la femme enceinte',
  'price_1Ryfx8BuJldFrY1H08EEYsQj': 'paid: Points gâchettes',
  'price_1RyfxNBuJldFrY1HATKXKVTb': 'paid: Taping niveau 1',
  'price_1RyfxZBuJldFrY1H3QPLPA86': 'paid: Massage crânio-sacré',
  'price_1RyfxpBuJldFrY1HUOo162Df': 'paid: Massage sur chaise avancé',
  'price_1Ryfy4BuJldFrY1HhpWVvLLh': 'paid: Massage viscéral',
};

const GHL_API_BASE = 'https://services.leadconnectorhq.com';
const GHL_HEADERS = {
  'Content-Type': 'application/json',
  'Authorization': `Bearer ${process.env.GHL_API_KEY}`,
  'Version': '2021-07-28',
  'Accept': 'application/json',
};

export default async function handler(req, res) {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { sessionId } = req.body || {};
    if (!sessionId) return res.status(400).json({ error: 'missing_session_id' });

    // 1) Récupérer la session Stripe (email + line items)
    const session = await stripe.checkout.sessions.retrieve(sessionId);
    if (!session) return res.status(404).json({ error: 'session_not_found' });

    // Stripe peut nécessiter une page supplémentaire pour les line items
    const lineItems = await stripe.checkout.sessions.listLineItems(sessionId, { limit: 100 });
    const priceIds = (lineItems?.data || [])
      .map(li => li.price?.id)
      .filter(Boolean);

    const email = session.customer_details?.email || session.customer_email;
    if (!email) return res.status(400).json({ error: 'no_email_on_session' });

    // 2) Upsert contact dans GHL
    const contactResp = await fetch(`${GHL_API_BASE}/contacts/`, {
      method: 'POST',
      headers: GHL_HEADERS,
      body: JSON.stringify({
        email,
        locationId: process.env.GHL_LOCATION_ID,
        // optionnel: prénom/nom si dispo dans session.customer_details
        firstName: session.customer_details?.name || undefined,
      }),
    });
    const contactData = await contactResp.json();
    if (!contactResp.ok) {
      console.error('GHL upsert error:', contactData);
      return res.status(500).json({ error: 'ghl_upsert_failed', detail: contactData });
    }
    const contactId = contactData?.contact?.id || contactData?.id;
    if (!contactId) {
      return res.status(500).json({ error: 'ghl_no_contact_id' });
    }

    // 3) Pour chaque price → ajouter le Tag correspondant
    const tagsToAdd = [...new Set(priceIds.map(pid => PRICE_TO_TAG[pid]).filter(Boolean))];
    for (const tag of tagsToAdd) {
      const tagResp = await fetch(`${GHL_API_BASE}/contacts/${contactId}/tags`, {
        method: 'POST',
        headers: GHL_HEADERS,
        body: JSON.stringify({ tags: [tag] }),
      });
      if (!tagResp.ok) {
        const t = await tagResp.json().catch(() => ({}));
        console.error('GHL add tag error:', tag, t);
      }
    }

    // 4) (Optionnel) Mettre l’opportunité dans un pipeline/stage
    // await fetch(`${GHL_API_BASE}/opportunities/`, { ... });

    return res.status(200).json({ ok: true, tagged: tagsToAdd, email });
  } catch (e) {
    console.error('after-success error:', e);
    return res.status(500).json({ error: 'server_error', message: e.message });
  }
}
