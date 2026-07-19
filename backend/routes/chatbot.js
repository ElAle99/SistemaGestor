const express = require('express');
const { rateLimit } = require('../middleware/rateLimit');
require('../config/env');

const router = express.Router();
const DEFAULT_CHAT_WEBHOOK_URL = 'https://allfixbacalar.app.n8n.cloud/webhook/56b9eeb1-213a-4d41-ad72-b0a55fb13e21/chat';
const chatRateLimit = rateLimit({ windowMs: 60 * 1000, max: 30, keyPrefix: 'chatbot' });

function extractReply(payload) {
  if (!payload) return '';
  if (typeof payload === 'string') return payload;

  if (Array.isArray(payload)) {
    for (const item of payload) {
      const reply = extractReply(item);
      if (reply) return reply;
    }
    return '';
  }

  const keys = ['output', 'reply', 'response', 'answer', 'text', 'message', 'content'];
  for (const key of keys) {
    const value = payload[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
    if (value && typeof value === 'object') {
      const nested = extractReply(value);
      if (nested) return nested;
    }
  }

  if (payload.data) return extractReply(payload.data);
  if (payload.result) return extractReply(payload.result);
  return '';
}

router.post('/message', chatRateLimit, async (req, res) => {
  const message = String(req.body?.message || req.body?.chatInput || '').trim();
  const sessionId = String(req.body?.sessionId || '').trim();

  if (!message) {
    return res.status(400).json({ error: 'Escribe un mensaje para continuar.' });
  }

  const webhookUrl = process.env.N8N_CHAT_WEBHOOK_URL || DEFAULT_CHAT_WEBHOOK_URL;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 25000);

  try {
    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json'
      },
      body: JSON.stringify({
        action: 'sendMessage',
        sessionId,
        chatInput: message,
        message,
        source: 'sistema-gestor'
      }),
      signal: controller.signal
    });

    const responseText = await response.text();
    let payload = responseText;
    try {
      payload = responseText ? JSON.parse(responseText) : {};
    } catch (error) {
      payload = responseText;
    }

    if (!response.ok) {
      console.error('Error del webhook de chatbot:', response.status);
      return res.status(502).json({ error: 'El asistente no respondio correctamente.' });
    }

    const reply = extractReply(payload) || 'Recibi tu mensaje, pero no obtuve una respuesta del asistente.';
    return res.json({ reply });
  } catch (error) {
    if (error.name === 'AbortError') {
      return res.status(504).json({ error: 'El asistente tardo demasiado en responder.' });
    }
    console.error('Error al conectar con chatbot:', error);
    return res.status(502).json({ error: 'No se pudo conectar con el asistente.' });
  } finally {
    clearTimeout(timeout);
  }
});

module.exports = router;
