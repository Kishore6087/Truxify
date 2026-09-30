import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import { mongoDb, redisClient, firebaseAdmin, supabase, supabaseAdmin } from '../config/db.js';
import logger from '../middleware/logger.js';
import { createLocationEventBus } from './locationEventBus.js';
import telemetryBuffer from './telemetryBuffer.js';
import GpsLog from '../models/GpsLog.js';
import { scheduleEtaRecalculationOnLocationUpdate } from '../services/order/etaService.js';
import DeliveryDelayService from '../services/order/deliveryDelayService.js';
import { calculateAdaptiveInterval, getQueueDepth } from './adaptivePoller.js';

// ============================================================================
// SCHEMA & VALIDATION DEFINITIONS
// ============================================================================

const locationChannels = new Map();
const displayIdToLocationChannelKeys = new Map();
const driverToLocationChannels = new Map();
const channelRetryStates = new Map();

const MAX_RETRY_ATTEMPTS = 5;
const BASE_RETRY_DELAY_MS = 1000;

/**
 * Safely cancels and removes any pending retry timers for a given channel key.
 */
function clearChannelRetryState(channelKey) {
  if (channelRetryStates.has(channelKey)) {
    const retryState = channelRetryStates.get(channelKey);
    if (retryState.timer) {
      clearTimeout(retryState.timer);
    }
    channelRetryStates.delete(channelKey);
  }
}

/**
 * Removes channel mapping references across all internal indexes.
 */
function unregisterChannelIndexes(channelKey, displayId, driverId) {
  locationChannels.delete(channelKey);

  if (displayId && displayIdToLocationChannelKeys.has(displayId)) {
    displayIdToLocationChannelKeys.delete(displayId);
  }

  if (driverId && driverToLocationChannels.has(driverId)) {
    driverToLocationChannels.delete(driverId);
  }
}

/**
 * Establishes or retries connection to a location channel with exponential backoff.
 */
export function connectChannel(channelKey, displayId, driverId, attempt = 0) {
  // Clear any existing timer to prevent stacked retries
  clearChannelRetryState(channelKey);

  if (attempt >= MAX_RETRY_ATTEMPTS) {
    logger.error(`[Tracker] Max retry attempts reached for channel key ${channelKey}.`);
    unregisterChannelIndexes(channelKey, displayId, driverId);
    return;
  }

  try {
    // Example socket/channel subscription logic
    const channel = {
      key: channelKey,
      displayId,
      driverId,
      status: 'connected',
    };

    locationChannels.set(channelKey, channel);
    if (displayId) displayIdToLocationChannelKeys.set(displayId, channelKey);
    if (driverId) driverToLocationChannels.set(driverId, channelKey);

    logger.info(`[Tracker] Channel ${channelKey} connected successfully.`);
  } catch (error) {
    logger.warn(`[Tracker] Failed to connect channel ${channelKey} (Attempt ${attempt + 1}/${MAX_RETRY_ATTEMPTS}): ${error.message}`);

    const backoffDelay = Math.pow(2, attempt) * BASE_RETRY_DELAY_MS;
    const timer = setTimeout(() => {
      connectChannel(channelKey, displayId, driverId, attempt + 1);
    }, backoffDelay);

    channelRetryStates.set(channelKey, { timer, attempt: attempt + 1 });
  }
}

/**
 * Handles explicit unsubscription cleanup.
 */
export function handleUnsubscribe(channelKey, displayId, driverId) {
  clearChannelRetryState(channelKey);
  unregisterChannelIndexes(channelKey, displayId, driverId);
  logger.info(`[Tracker] Unsubscribed and cleaned up channel ${channelKey}.`);
}

/**
 * Removes client subscriptions across all indexed channels.
 */
export function removeClientFromAllSubscriptions(clientId) {
  for (const [channelKey, channel] of locationChannels.entries()) {
    if (channel.clientId === clientId) {
      clearChannelRetryState(channelKey);
      unregisterChannelIndexes(channelKey, channel.displayId, channel.driverId);
    }
  }
  logger.info(`[Tracker] Removed all channel subscriptions for client ${clientId}.`);
}

/**
 * Complete service shutdown cleanup.
 */
export function shutdownCleanup() {
  for (const channelKey of channelRetryStates.keys()) {
    clearChannelRetryState(channelKey);
  }
  locationChannels.clear();
  displayIdToLocationChannelKeys.clear();
  driverToLocationChannels.clear();
  logger.info('[Tracker] Shutdown cleanup executed. All channel timers and references cleared.');
}
