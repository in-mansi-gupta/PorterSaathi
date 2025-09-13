// src/components/SaathiVoice.jsx
import React, { useEffect, useState } from 'react';
import SpeechRecognition, { useSpeechRecognition } from 'react-speech-recognition';

/**
 * SaathiVoice component
 * - Uses react-speech-recognition (wraps Web Speech API)
 * - Sends transcript to backend /api/v1/interpret
 * - Plays TTS via browser speechSynthesis and renders a simple card
 *
 * NOTE: Install dependency: npm i react-speech-recognition
 */

const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || 'http://localhost:3000';

export default function SaathiVoice() {
  const { transcript, listening, resetTranscript } = useSpeechRecognition();
  const [sessionId, setSessionId] = useState(null);
  const [responseText, setResponseText] = useState('—');
  const [card, setCard] = useState(null);
  const [lastQuery, setLastQuery] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    // when transcript changes (user stopped), auto-send if not empty
    if (transcript && transcript.trim().length > 0 && lastQuery !== transcript) {
      setLastQuery(transcript);
      sendTranscript(transcript);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [transcript]);

  async function sendTranscript(text) {
    setLoading(true);
    try {
      const res = await fetch(`${BACKEND_URL}/api/v1/interpret`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ transcript: text, session_id: sessionId })
      });
      const data = await res.json();
      if (data.session_id) setSessionId(data.session_id);
      setResponseText(data.responseText || '—');
      setCard(data.card || null);
      // speak
      speak(data.responseText || 'Main samajh nahi paaya.');
    } catch (err) {
      console.error('Error calling backend:', err);
      setResponseText('Server error. Dekh raha hoon console.');
      speak('Server error. Kripya thoda baad mein koshish karein.');
    } finally {
      setLoading(false);
      // keep transcript history but reset for new captures if desired
      // resetTranscript();
    }
  }

  function speak(text, lang = 'hi-IN') {
    if (!window.speechSynthesis) return;
    const utter = new SpeechSynthesisUtterance(text);
    utter.lang = lang;
    // choose a hi voice if available
    const voices = window.speechSynthesis.getVoices();
    const v = voices.find(v => v.lang && v.lang.startsWith('hi'));
    if (v) utter.voice = v;
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(utter);
  }

  // UI handlers
  function startListening() {
    // start continuous listening? we keep single-shot via interimResults=false in lib
    SpeechRecognition.startListening({ continuous: false, language: 'hi-IN' });
  }
  function stopListening() {
    SpeechRecognition.stopListening();
  }
  function handleSendTextManual() {
    const el = document.getElementById('manualQuery');
    if (!el) return;
    const txt = el.value.trim();
    if (!txt) return;
    resetTranscript();
    setLastQuery(txt);
    sendTranscript(txt);
    el.value = '';
  }

  // small visual card render
  function CardView({ card }) {
    if (!card) return null;
    return (
      <div style={{ marginTop: 12, padding: 12, borderRadius: 8, background: 'rgba(0,0,0,0.35)', border: '1px solid rgba(255,255,255,0.04)' }}>
        <div style={{ fontSize: 20, color: '#00c2a8', marginBottom: 8 }}>{card.title}</div>
        <ul style={{ margin: 0, paddingLeft: 18, color: '#cbdfe2' }}>
          {card.bullets && card.bullets.map((b, i) => <li key={i}>{b}</li>)}
        </ul>
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 760, margin: '20px auto', color: '#e6eef2', fontFamily: 'Inter, system-ui, sans-serif' }}>
      <h2 style={{ color: '#00c2a8' }}>Porter Saathi — Voice (Web Demo)</h2>

      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 8 }}>
        <button onClick={startListening} disabled={listening} style={{ padding: '10px 12px', borderRadius: 8 }}>
          {listening ? 'Listening…' : 'Start Listening 🎤'}
        </button>
        <button onClick={stopListening} disabled={!listening} style={{ padding: '10px 12px', borderRadius: 8 }}>
          Stop
        </button>
        <div style={{ marginLeft: 12, color: '#9aa8b2' }}>{loading ? 'Processing…' : 'Ready'}</div>
      </div>

      <div style={{ marginTop: 12 }}>
        <input id="manualQuery" placeholder="Type query, e.g., 'Aaj ka net kamai kitni hai'" style={{ padding: 8, width: '60%', borderRadius: 8 }} />
        <button onClick={handleSendTextManual} style={{ padding: 8, marginLeft: 8, borderRadius: 8 }}>Send</button>
      </div>

      <div style={{ marginTop: 14 }}>
        <strong>Transcript:</strong>
        <div style={{ marginTop: 6, padding: 10, background: 'rgba(255,255,255,0.02)', borderRadius: 6 }}>{transcript || '—'}</div>
      </div>

      <div style={{ marginTop: 12 }}>
        <strong>Saathi:</strong>
        <div style={{ marginTop: 6, padding: 10, background: 'rgba(255,255,255,0.02)', borderRadius: 6 }}>{responseText}</div>
        <CardView card={card} />
      </div>
    </div>
  );
}
