import { debugLog, debugError } from '../constants';

/**
 * Screenshot utilities for capturing and processing page screenshots
 * SIMPLIFIED for Service Worker (no DOM APIs available)
 */

export interface ScreenshotOptions {
  quality?: 'low' | 'medium' | 'high' | 'adaptive';
  format?: 'png' | 'jpeg';
}

/**
 * Rate limiter for screenshot capture
 * Chrome limits captureVisibleTab to 2 calls per second
 */
class ScreenshotRateLimiter {
  private lastCaptureTime: number = 0;
  // ULTRA SPEED: Reduced to Chrome's minimum (500ms limit)
  private readonly minIntervalMs: number = 500;

  async waitIfNeeded(): Promise<void> {
    const now = Date.now();
    const elapsed = now - this.lastCaptureTime;

    if (elapsed < this.minIntervalMs) {
      const waitTime = this.minIntervalMs - elapsed;
      debugLog('Screenshot', `Rate limiting: waiting ${waitTime}ms`);
      await new Promise(resolve => setTimeout(resolve, waitTime));
    }

    this.lastCaptureTime = Date.now();
  }

  // M32 Fix: Add reset method for cleanup
  reset(): void {
    this.lastCaptureTime = 0;
  }
}

const screenshotRateLimiter = new ScreenshotRateLimiter();

/**
 * Estimate screenshot file size in KB
 */
export function estimateScreenshotSize(dataUrl: string): number {
  // Base64 data URL format: data:image/jpeg;base64,<data>
  // Remove the prefix to get actual data length
  const base64Data = dataUrl.split(',')[1] || '';

  // Base64 encoding increases size by ~33%
  // Each base64 char represents 6 bits, so 4 chars = 3 bytes
  const sizeBytes = (base64Data.length * 3) / 4;

  return Math.round(sizeBytes / 1024); // Convert to KB
}

/**
 * Check if screenshot size is within API limits
 */
export function isScreenshotSizeValid(dataUrl: string, maxSizeMB: number = 5): boolean {
  const sizeKB = estimateScreenshotSize(dataUrl);
  const sizeMB = sizeKB / 1024;

  debugLog('Screenshot', 'Size check', {
    sizeKB,
    sizeMB: sizeMB.toFixed(2),
    maxSizeMB,
    valid: sizeMB <= maxSizeMB,
  });

  return sizeMB <= maxSizeMB;
}

/**
 * Adaptive quality adjustment based on screenshot size
 * P2 - Issue #11: Dynamic quality reduction loop until < 4MB
 * Includes rate limiting to avoid Chrome's MAX_CAPTURE_VISIBLE_TAB_CALLS_PER_SECOND quota
 */
export async function captureWithAdaptiveQuality(
  _tabId?: number,
  maxSizeMB: number = 4 // Gemini limit is 4MB, Claude is 5MB
): Promise<string> {
  try {
    let quality = 90; // Start high
    // M14 Fix: Initialize dataUrl to empty string
    let dataUrl: string = '';

    // Dynamic quality reduction loop
    for (let attempt = 1; attempt <= 5; attempt++) {
      // Rate limiting to avoid Chrome's 2 calls/second limit
      await screenshotRateLimiter.waitIfNeeded();

      debugLog('Screenshot', `Capturing screenshot (attempt ${attempt}/5, quality ${quality})`);

      // M15 Fix: Validate Chrome API return
      const capturedUrl = await chrome.tabs.captureVisibleTab({
        format: 'jpeg',
        quality: quality,
      });

      if (!capturedUrl || typeof capturedUrl !== 'string') {
        throw new Error('Chrome captureVisibleTab returned invalid data');
      }

      dataUrl = capturedUrl;

      const sizeKB = estimateScreenshotSize(dataUrl);
      const sizeMB = sizeKB / 1024;

      debugLog('Screenshot', 'Screenshot captured', {
        attempt,
        quality,
        sizeKB,
        sizeMB: sizeMB.toFixed(2),
        maxSizeMB,
      });

      if (sizeMB <= maxSizeMB) {
        debugLog('Screenshot', `Screenshot within limit at quality ${quality}`, { sizeMB: sizeMB.toFixed(2) });
        return dataUrl;
      }

      // Reduce quality for next attempt
      quality = Math.max(30, quality - 15);
      debugLog('Screenshot', `Screenshot too large (${sizeMB.toFixed(2)}MB), reducing quality to ${quality}`);
    }

    // If still too large after 5 attempts, throw error
    throw new Error(`Screenshot exceeds ${maxSizeMB}MB limit even at minimum quality`);
  } catch (error) {
    debugError('Screenshot', 'Failed to capture screenshot', error);
    throw new Error(`Failed to capture screenshot: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}
