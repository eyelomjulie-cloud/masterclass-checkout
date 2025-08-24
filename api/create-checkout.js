// api/create-checkout.js
import Stripe from 'stripe';

// --- CORS helper ---
function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
}

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: '2023-10-16' });

// --- Whitelist sécurité : TES Price IDs LIVE ---
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

const TOTAL_MASTERCLASSES = 8;

export default async function handler(req, res) {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const body = req.body || {};
    const priceIds = Array.isArray(body.priceIds) ? body.priceIds
                   : Array.isArray(body.prices)   ? body.prices
                   : null;
    const customerEmail = body.customerEmail || body.email || undefined;

    if (!Array.isArray(priceIds) || priceIds.length < 1) {
      return res.status(400).json({ error: 'Sélection invalide' });
    }

    // --- Sécurité + déduplication ---
    const clean = [...new Set(priceIds)].filter(id => ALLOWED.has(id));
    if (clean.length !== priceIds.length) {
      return res.status(400).json({
        error: 'Price ID non autorisé',
        detail: `Envoyés: ${priceIds.join(',')}`
      });
    }

    // --- Remises automatiques ---
    let discounts = [];
    if (clean.length === 3 && process.env.COUPON_3_ID) {
      discounts = [{ coupon: process.env.COUPON_3_ID }]; // −15%
    } else if (clean.length === TOTAL_MASTERCLASSES && process.env.COUPON_ALL_ID) {
      discounts = [{ coupon: process.env.COUPON_ALL_ID }]; // −30%
    }

    // --- Paramètres de la session ---
    const sessionParams = {
      mode: 'payment',
      line_items: clean.map(p => ({ price: p, quantity: 1 })),
      automatic_tax: { enabled: true },
      customer_email: customerEmail,
      success_url: 'https://www.ecole-de-massotherapie.com/merci-pack?session_id={CHECKOUT_SESSION_ID}',
      cancel_url: 'https://www.ecole-de-massotherapie.com/masterclass',
      metadata: {
        selected_prices: clean.join(','),
        pack_logic: clean.length === 3
          ? 'PACK3_15'
          : (clean.length === TOTAL_MASTERCLASSES ? 'ALL_30' : 'NONE')
      }
    };

    // --- Ajout des remises (sans allow_promotion_codes en doublon) ---
    if (discounts.length > 0) {
      sessionParams.discounts = discounts;
    }

    const session = await stripe.checkout.sessions.create(sessionParams);
    return res.status(200).json({ url: session.url });

  } catch (e) {
    console.error('Stripe error:', e);
    return res.status(500).json({
      error: 'server_error',
      message: e.message,
      detail: e?.raw?.message || e?.raw?.code || null,
    });
  }
}
