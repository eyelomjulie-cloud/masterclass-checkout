// api/create-checkout.js
import Stripe from 'stripe';

// CORS
function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
}

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: '2023-10-16' });

// ===== CONFIG À REMPLIR =====
// Whitelist sécurité : TES Price IDs (paiement comptant)
const ALLOWED = new Set([
  'price_1RyfvYBuJldFrY1HUhhozNq1', // Intro massage sportif (300)
  'price_1RyfwWBuJldFrY1HvfnzyJjB', // 4 mains (550)
  'price_1RyfwrBuJldFrY1H4sF9UUn9', // Femme enceinte (550)
  'price_1Ryfx8BuJldFrY1H08EEYsQj', // Points gâchettes (550)
  'price_1RyfxNBuJldFrY1HATKXKVTb', // Taping N1 (795)
  'price_1RyfxZBuJldFrY1H3QPLPA86', // Crânio-sacré (550)
  'price_1RyfxpBuJldFrY1HUOo162Df', // (remplacé) → Chaise AV (300) — désactivé si non utilisé
  'price_1Ryfy4BuJldFrY1HhpWVvLLh'  // Viscéral (550)
]);

// Map "comptant" -> "mensuel" (3x). METS ICI tes Price IDs d'abonnement mensuel (ex: 200$/mois)
const INSTALLMENT_MAP = {
  // exemple (à REMPLIR) :
  // 'price_1Ryfy4BuJldFrY1HhpWVvLLh': 'price_MENSUEL_200CAD_visc', // Viscéral 3×200$
  // 'price_XXXX_comptant': 'price_YYYY_mensuel',
};

// Pack logic (réduction auto pour multi-sélection comptant)
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
    const plan = (body.plan || '').toLowerCase(); // "3x" pour mensualités

    if (!Array.isArray(priceIds) || priceIds.length < 1) {
      return res.status(400).json({ error: 'Sélection invalide' });
    }

    // Sécurité + dédup
    const clean = [...new Set(priceIds)].filter(id => ALLOWED.has(id));
    if (clean.length !== priceIds.length) {
      return res.status(400).json({ error: 'Price ID non autorisé', detail: `Envoyés: ${priceIds.join(',')}` });
    }

    // ====== BRANCHE 1 : Paiement en 3× (un seul cours à la fois) ======
    if (plan === '3x') {
      if (clean.length !== 1) {
        return res.status(400).json({ error: 'Les mensualités 3× ne sont possibles que pour 1 cours à la fois.' });
      }
      const oneShot = clean[0];
      const monthlyPrice = INSTALLMENT_MAP[oneShot];
      if (!monthlyPrice) {
        return res.status(400).json({ error: 'Pas de plan 3× configuré pour ce cours.' });
      }

      const session = await stripe.checkout.sessions.create({
        mode: 'subscription',
        line_items: [{ price: monthlyPrice, quantity: 1 }],
        customer_email: customerEmail,
        automatic_tax: { enabled: true },
        // Pas de coupons auto ici (sinon ça s’applique chaque mois).
        success_url: 'https://www.ecole-de-massotherapie.com/merci-pack?session_id={CHECKOUT_SESSION_ID}',
        cancel_url: 'https://www.ecole-de-massotherapie.com/masterclass',
        metadata: {
          installments_months: '3',
          base_one_time_price: oneShot
        },
        subscription_data: {
          metadata: {
            installments_months: '3',
            base_one_time_price: oneShot
          }
          // NB: on ne peut pas mettre cancel_at ici via Checkout; on le fera en post-traitement sur /api/after-success
        }
      });

      return res.status(200).json({ url: session.url });
    }

    // ====== BRANCHE 2 : Paiement comptant (multi-sélection possible + remises auto) ======
    let discounts = [];
    if (clean.length === 3 && process.env.COUPON_3_ID) {
      discounts = [{ coupon: process.env.COUPON_3_ID }];      // −15%
    } else if (clean.length === TOTAL_MASTERCLASSES && process.env.COUPON_ALL_ID) {
      discounts = [{ coupon: process.env.COUPON_ALL_ID }];    // −30%
    }

    const sessionParams = {
      mode: 'payment',
      line_items: clean.map(p => ({ price: p, quantity: 1 })),
      automatic_tax: { enabled: true },
      customer_email: customerEmail,
      success_url: 'https://www.ecole-de-massotherapie.com/merci-pack?session_id={CHECKOUT_SESSION_ID}',
      cancel_url: 'https://www.ecole-de-massotherapie.com/masterclass',
      metadata: {
        selected_prices: clean.join(','),
        pack_logic:
          clean.length === 3 ? 'PACK3_15' :
          (clean.length === TOTAL_MASTERCLASSES ? 'ALL_30' : 'NONE'),
      }
    };

    if (discounts.length > 0) {
      sessionParams.discounts = discounts; // ⚠️ pas de allow_promotion_codes en même temps
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
