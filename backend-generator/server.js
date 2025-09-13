// server.js
// Minimal Node/Express backend for Porter Saathi MVP.
// - Serves static client from /public
// - Provides /api/v1/interpret and simple form endpoints
// - Rule-based NLU + in-memory session/form state
// No external credentials, no cloud services.

const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// --- Load demo data (earnings) ---
const earningsData = JSON.parse(
  fs.readFileSync(path.join(__dirname, 'data', 'earnings.json'), 'utf8')
);

// --- In-memory session store (for forms/dialog state) ---
const sessions = {}; // sessionId -> { formState, lastIntent, locale }

// --- Utilities ---
function genSessionId() {
  return 's_' + Math.random().toString(36).substr(2, 9);
}

function detectDateRange(text) {
  text = text.toLowerCase();
  if (text.includes('today') || text.includes('aaj')) return 'today';
  if (text.includes('yesterday') || text.includes('kal')) return 'yesterday';
  if (text.includes('week') || text.includes('hafta') || text.includes('pichle hafta')) return 'last_week';
  return 'today'; // default
}

function parseCurrency(text) {
  // find numbers like 1200, 1,200, ₹1200
  const m = text.replace(/,/g, '').match(/₹?\s*([0-9]+(\.[0-9]+)?)/);
  if (m) return Number(m[1]);
  return null;
}

// --- Simple NLU (rule-based) ---
function nlu(transcript) {
  const t = transcript.toLowerCase();

  // intents prioritized
  if (t.includes('help') || t.includes('sahayata') || t.includes('emergency') || t.includes('madad')) {
    return { intent: 'sahayata', entities: {} };
  }
  if (t.includes('form') || t.includes('onboard') || t.includes('form bhar') || t.includes('form bharna') || t.includes('onboarding')) {
    return { intent: 'start_form', entities: {} };
  }
  if (t.includes('earn') || t.includes('kamai') || t.includes('kitni') || t.includes('net ka') || t.includes('net kamai') || t.includes('after expenses') || t.includes('baad')) {
    const dr = detectDateRange(t);
    const afterExpenses = t.includes('after expenses') || t.includes('baad') || t.includes('net');
    return { intent: 'query_earnings', entities: { date_range: dr, after_expenses: afterExpenses } };
  }
  if (t.includes('compare') || t.includes('behtar') || t.includes('pichle') || t.includes('better')) {
    return { intent: 'compare_period', entities: { date_range: detectDateRange(t) } };
  }
  // form field answers: numbers, vehicle numbers
  if (t.match(/[a-zA-Z]{2}\d{1,2}[A-Z]{1,2}\d{1,4}/) || t.match(/\d{4}/) || t.match(/[0-9]+/)) {
    // treat as form_field_answer in context if a session expects
    return { intent: 'form_field_answer', entities: {} , raw: transcript};
  }

  // fallback
  return { intent: 'small_talk', entities: {} };
}

// --- Business logic: earnings summary ---
function computeEarningsSummary(driverId = 'D1', dateRange = 'today') {
  // For demo we only have simple daily entries; in real world you'd aggregate
  const rec = earningsData.find(r => r.driver_id === driverId);
  if (!rec) {
    return { found: false };
  }
  // In this demo data, we use the single record as "today"
  const gross = rec.gross_earnings || 0;
  const expenses = rec.expenses || 0;
  const penalty = (rec.penalties || []).reduce((s,p)=>s+p.amount,0);
  const rewards = (rec.rewards || []).reduce((s,r)=>s+r.amount,0);
  const net = gross - expenses - penalty + rewards;
  const breakdown = {
    gross, expenses, penalty, rewards, net
  };
  return { found: true, breakdown, reason: rec.reason || '' };
}

// --- API: simple interpret endpoint ---
app.post('/api/v1/interpret', (req,res) => {
  // Expects: { transcript: string, session_id?: string, driver_id?: string }
  const { transcript = '', session_id, driver_id } = req.body;
  const sid = session_id || genSessionId();
  if (!sessions[sid]) sessions[sid] = { formState: null, lastIntent: null, locale: 'hi-IN' };

  const nluResult = nlu(transcript || '');
  sessions[sid].lastIntent = nluResult.intent;

  let responseText = "Maaf kijiye, main samajh nahi paaya. Dobara boliye ya type kar dijiye.";
  let card = null;
  let action = null;

  if (nluResult.intent === 'query_earnings') {
    const driver = driver_id || 'D1';
    const summary = computeEarningsSummary(driver, nluResult.entities.date_range);
    if (!summary.found) {
      responseText = "Koi earnings record nahi mila. Aapka driver ID dena padega.";
    } else {
      const b = summary.breakdown;
      responseText = `Aaj aapne ₹${b.net} kamaye — ismein gross ₹${b.gross}, kharche ₹${b.expenses}, penalty ₹${b.penalty}, rewards ₹${b.rewards}. Kya aap break-up sunna chahenge?`;
      card = {
        title: `Net earnings: ₹${b.net}`,
        bullets: [
          `Gross: ₹${b.gross}`,
          `Expenses: ₹${b.expenses}`,
          `Penalties: ₹${b.penalty}`,
          `Rewards: ₹${b.rewards}`
        ]
      };
      action = { type: 'show_card' };
    }
  } else if (nluResult.intent === 'start_form') {
    // start a simple onboarding form (3 fields): name, vehicle_registration, phone
    sessions[sid].formState = {
      formId: 'onboard_doc',
      currentField: 'name',
      values: {}
    };
    responseText = "Chaliye onboarding form shuru karte hain. Pehla sawaal: aapka poora naam bataiye.";
    action = { type: 'start_form', field: 'name' };
  } else if (nluResult.intent === 'form_field_answer') {
    // if a form is active, accept answer for current field
    const fs = sessions[sid].formState;
    if (!fs) {
      responseText = "Koi form chal nahi raha. Agar aap form bharna chahte hain to boliye 'Start form'.";
    } else {
      const ans = req.body.transcript;
      // simple validation & slot fill flow
      if (fs.currentField === 'name') {
        fs.values.name = ans;
        fs.currentField = 'vehicle_registration';
        responseText = `Naam set hua: ${ans}. Ab vehicle registration number bataiye.`;
        action = { type: 'form_next', nextField: 'vehicle_registration' };
      } else if (fs.currentField === 'vehicle_registration') {
        fs.values.vehicle_registration = ans;
        fs.currentField = 'phone';
        responseText = `Vehicle number liya: ${ans}. Ab phone number bataiye.`;
        action = { type: 'form_next', nextField: 'phone' };
      } else if (fs.currentField === 'phone') {
        // basic digits extraction
        const digits = (ans.match(/\d+/g) || []).join('');
        fs.values.phone = digits || ans;
        fs.completed = true;
        responseText = `Shukriya. Aapka form pura ho gaya. Naam: ${fs.values.name}, Vehicle: ${fs.values.vehicle_registration}, Phone: ${fs.values.phone}. Kya main submit kar doon?`;
        action = { type: 'form_completed', values: fs.values };
      } else {
        responseText = "Field samajh nahi aayi.";
      }
    }
  } else if (nluResult.intent === 'sahayata') {
    responseText = "Sahayata activated. Kya aapko ambulance chahiye, police chahiye, ya roadside help? Boliye 'ambulance', 'police', ya 'roadside'.";
    action = { type: 'sahayata_prompt' };
  } else if (nluResult.intent === 'compare_period') {
    // quick fake compare
    responseText = "Pichle hafte ke mukable aapka business lagbhag same raha — thoda sa increase mila. (Demo data)";
    action = { type: 'compare' };
  } else {
    // small talk or fallback
    responseText = "Main demo mode mein hoon. Aap bol sakte hain: 'Aaj ka net kamai kitni hai', 'Start form', ya 'Help'.";
  }

  res.json({
    session_id: sid,
    intent: nluResult.intent,
    entities: nluResult.entities || {},
    responseText,
    card,
    action
  });
});

// start form API (alternative)
app.post('/api/v1/forms/:formId/start', (req,res) => {
  const sid = req.body.session_id || genSessionId();
  sessions[sid] = sessions[sid] || {};
  sessions[sid].formState = { formId: req.params.formId, currentField: 'name', values: {} };
  res.json({ session_id: sid, prompt: "Pehela field: aapka poora naam bataiye." });
});

// public static
app.use('/', express.static(path.join(__dirname, 'public')));

// Start server
const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`Porter Saathi MVP running on http://localhost:${port}`);
});
