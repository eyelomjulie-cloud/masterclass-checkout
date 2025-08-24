// api/after-success.js
import Stripe from 'stripe';

function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
}

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: '2023-10-16' });

export default async function handler(req, res) {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { sessionId } = req.body || {};
    if (!sessionId) return res.status(400).json({ error: 'missing_session_id' });

    // 1) Récupère la session
    const session = await stripe.checkout.sessions.retrieve(sessionId, {
      expand: ['customer', 'discounts', 'total_details.breakdown.discounts']
    });

    // 2) Sécurité minimale : on ne renvoie des infos que si la session est payée
    if (session.payment_status !== 'paid') {
      return res.status(200).json({ status: 'not_paid_yet' });
    }

    // 3) Récupère les line items (produits/price achetés)
    const lineItems = await stripe.checkout.sessions.listLineItems(sessionId, {
      expand: ['data.price.product']
    });

    // 4) Formatte une réponse simple pour la page Merci
    const items = lineItems.data.map(li => ({
      priceId: li.price?.id || null,
      productId: li.price?.product?.id || null,
      name: (li.description || li.price?.product?.name || 'Masterclass'),
      unitAmount: li.price?.unit_amount || 0,
      currency: li.price?.currency || session.currency,
      quantity: li.quantity || 1
    }));

    // total/remise
    const subtotal = session.amount_subtotal || 0;
    const total = session.amount_total || 0;
    const currency = session.currency || 'cad';
    const discounts = (session.total_details?.breakdown?.discounts || []).map(d => ({
      amount: d.amount,
      coupon: d.discount?.coupon?.id || null,
      promoCode: d.discount?.promotion_code?.id || null
    }));

    return res.status(200).json({
      status: 'paid',
      sessionId,
      email: session.customer_details?.email || session.customer?.email || null,
      items,
      currency,
      subtotal,
      total,
      discounts
    });
  } catch (e) {
    console.error('after-success error:', e);
    return res.status(500).json({ error: 'server_error', message: e.message });
  }
}
