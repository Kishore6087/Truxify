import axios from 'axios';
import crypto from 'crypto';
import { supabase, supabaseAdmin } from '../config/db.js';
const voiceDb = (supabaseAdmin && typeof supabaseAdmin.from === 'function') ? supabaseAdmin : supabase;
import logger from '../middleware/logger.js';

const MAX_CACHE_SIZE = 100;
const CACHE_TTL_MS = 10 * 60 * 1000;
const VOICE_API_TIMEOUT_MS = 10000;
const WHISPER_TIMEOUT_MS = 15000;
export const audioCache = new Map();

function trimCache() {
  const now = Date.now();
  // 1. Collect and purge expired entries first
  const expiredKeys = [];
  for (const [key, value] of audioCache.entries()) {
    if (now - value.timestamp >= CACHE_TTL_MS) {
      expiredKeys.push(key);
    }
  }
  for (const key of expiredKeys) {
    audioCache.delete(key);
  }

  // 2. If capacity still exceeds MAX_CACHE_SIZE, evict oldest remaining entries
  if (audioCache.size > MAX_CACHE_SIZE) {
    const oldest = [...audioCache.entries()]
      .sort(([, a], [, b]) => a.timestamp - b.timestamp);
    const toDelete = audioCache.size - MAX_CACHE_SIZE;
    for (let i = 0; i < toDelete && i < oldest.length; i++) {
      audioCache.delete(oldest[i][0]);
    }
  }
}

function cacheAudio(id, buffer, userId) {
  audioCache.set(id, { buffer, userId, timestamp: Date.now() });
  trimCache();
}

async function getBookingContext(bookingId, userId) {
  if (!userId) {
    return null;
  }

  if (bookingId == null) {
    return null;
  }

  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const isUuid = uuidRegex.test(bookingId);

  // Orders table is the real order model (there is no bookings table).
  try {
    let orderQuery = voiceDb.from('orders').select('*');
    if (isUuid) {
      orderQuery = orderQuery
        .eq('id', bookingId)
        .or(`customer_id.eq.${userId},driver_id.eq.${userId}`);
    } else {
      orderQuery = orderQuery
        .or(`customer_id.eq.${userId},driver_id.eq.${userId}`)
        .order('created_at', { ascending: false })
        .limit(1);
    }

    const { data: order, error } = await orderQuery.maybeSingle();
    if (error) {
      logger.warn('Orders table check failed in voiceService:', error?.message ?? String(error));
      return null;
    }

    return order;
  } catch (err) {
    logger.warn('Orders table check failed in voiceService:', err?.message ?? String(err));
  }
  return null;
}

export const LOGISTICS_VOICE_INTENTS = {
  ACCEPT_LOAD: 'ACCEPT_LOAD',
  REPORT_DELAY: 'REPORT_DELAY',
  CHECK_EARNINGS: 'CHECK_EARNINGS',
  PAYMENT_STATUS: 'PAYMENT_STATUS',
  ETA: 'ETA',
  GENERAL_INQUIRY: 'GENERAL_INQUIRY',
};

function detectQueryIntent(transcript) {
  const text = (transcript || '').toLowerCase();
  if (text.includes('accept') || text.includes('agree') || text.includes('karo') || text.includes('take load') || text.includes('le lo')) {
    return LOGISTICS_VOICE_INTENTS.ACCEPT_LOAD;
  }
  if (text.includes('delay') || text.includes('traffic') || text.includes('late') || text.includes('breakdown') || text.includes('puncture')) {
    return LOGISTICS_VOICE_INTENTS.REPORT_DELAY;
  }
  if (text.includes('earning') || text.includes('balance') || text.includes('wallet') || text.includes('paisa') || text.includes('kamai')) {
    return LOGISTICS_VOICE_INTENTS.CHECK_EARNINGS;
  }
  if (text.includes('payment') || text.includes('release') || text.includes('paid')) {
    return LOGISTICS_VOICE_INTENTS.PAYMENT_STATUS;
  }
  if (text.includes('arrive') || text.includes('arrival') || text.includes('eta') || text.
