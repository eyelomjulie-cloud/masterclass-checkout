// api/create-checkout.js
import Stripe from 'stripe';

// --- CORS helper (autorise les requêtes depuis ta page GHL) ---
function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: '2023-10-16' });

// Whitelist sécurité : TES Price IDs LIVE (exactement ceux que tu m’as donnés)
const ALLOWED = new Set([
  'price_1RyfvYBuJldFrY1HUhhozNq1', // Intro massage sportif (300)
  'price_1RyfwWBuJldFrY1HvfnzyJjB', // Massage 4 mains (550)
  'price_1RyfwrBuJldFrY1H4sF9UUn9', // Femme enceinte (550)
  'price_1Ryfx8BuJldFrY1H08EEYsQj', // Points gâchettes (550)
  'price_1RyfxNBuJldFrY1HATKXKVTb', // Taping N1 (795)
  'price_1RyfxZBuJldFrY1H3QPLPA86', // Crânio-sacré (550)
  'price_1RyfxpBuJldFrY1HUOo162Df', // Chaise avancé (300)
  'price_1Ryfy4BuJldFrY1HhpWVvLLh'  // Viscéral (550)
]);

const TOTAL_MASTERCLASSES = 8; // −30% si tout (8)

export default async function handler(req, res) {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { priceIds, customerEmail } = req.body || {};
    if (!Array.isArray(priceIds) || priceIds.length < 1) {
      return res.status(400).json({ error: 'Sélection invalide' });
    }

    // Sécurité + dédup
    const clean = [...new Set(priceIds)].filter(id => ALLOWED.has(id));
    if (clean.length !== priceIds.length) {
      return res.status(400).json({ error: 'Price ID non autorisé' });
    }

    // Détermine la remise automatique
    // Ajoute dans Vercel les env COUPON_3_ID (−15%) et COUPON_ALL_ID (−30%)
    let discounts = [];
    if (clean.length === 3 && process.env.COUPON_3_ID) {
      discounts = [{ coupon: process.env.COUPON_3_ID }];
    } else if (clean.length === TOTAL_MASTERCLASSES && process.env.COUPON_ALL_ID) {
      discounts = [{ coupon: process.env.COUPON_ALL_ID }];
    }

    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      line_items: clean.map(p => ({ price: p, quantity: 1 })),
      discounts: discounts.length ? discounts : undefined,
      automatic_tax: { enabled: true },
      allow_promotion_codes: false,
      customer_email: customerEmail || undefined, // facultatif
      success_url: 'https://www.ecole-de-massotherapie.com/merci-pack?session_id={CHECKOUT_SESSION_ID}',
      cancel_url: 'https://www.ecole-de-massotherapie.com/masterclass',
      metadata: {
        selected_prices: clean.join(','),
        pack_logic: clean.length === 3 ? 'PACK3_15' : (clean.length === TOTAL_MASTERCLASSES ? 'ALL_30' : 'NONE')
      }
    });

    return res.status(200).json({ url: session.url });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: 'server_error', message: e.message });
  }
}
