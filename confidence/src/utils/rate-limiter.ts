/*
 * Copyright 2025, Salesforce, Inc.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

/* eslint-disable no-await-in-loop */

import makeDebug from 'debug';

const debug = makeDebug('confidence:rate-limiter');

type QueuedRequest<T extends Response> = {
  execute: () => Promise<T>;
  resolve: (value: T | PromiseLike<T>) => void;
  reject: (error: unknown) => void;
};

/**
 * A rate limiter that controls the frequency of requests using a sliding window approach with adaptive burst control.
 *
 * This class implements a queue-based rate limiter that ensures no more than a specified
 * number of requests are executed within a given time window. It features intelligent burst
 * detection that allows rapid execution of small batches while maintaining rate limit compliance
 * for larger workloads.
 *
 * Key Features:
 * - Sliding window rate limiting
 * - Adaptive burst control for small request batches
 * - Gradual transition from burst to controlled spacing as utilization increases
 * - Comprehensive monitoring and debugging information
 *
 * @example
 * ```typescript
 * // Create a rate limiter that allows 10 requests per minute
 * const rateLimiter = new RateLimiter(10, 60_000);
 *
 * // Small batches execute immediately in burst mode
 * const results = await Promise.all([
 *   rateLimiter.enqueue(() => fetch('/api/data1')),
 *   rateLimiter.enqueue(() => fetch('/api/data2')),
 *   rateLimiter.enqueue(() => fetch('/api/data3'))
 * ]);
 *
 * // Check current status including burst mode information
 * const status = rateLimiter.getStatus();
 * console.log(`Burst mode active: ${status.burstModeActive}`);
 * console.log(`Utilization: ${(status.utilizationRatio * 100).toFixed(1)}%`);
 * ```
 */
export class RateLimiter {
  private static completed: number = 0;
  private static failed: number = 0;

  private readonly requestTimestamps: number[] = [];
  private readonly queue: Array<QueuedRequest<Response>> = [];
  private isProcessing = false;

  /**
   * Utilization threshold below which burst mode is allowed.
   * When current window utilization is below this ratio, requests can execute immediately.
   */
  private readonly burstUtilizationThreshold = 0.5;

  /**
   * Total work threshold (current + queued requests) for burst mode.
   * Burst mode is only allowed when predicted total utilization is below this ratio.
   */
  private readonly burstQueueThreshold = 0.75;

  /**
   * Minimum delay between requests during controlled (non-burst) execution.
   * Provides a baseline spacing to prevent overwhelming the target service.
   */
  private readonly minDelayMs = 50;

  public constructor(private readonly maxRequests = 40, private readonly windowMs = 60_000) {}

  /**
   * Utility function to sleep for a given number of milliseconds
   */
  private static sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Executes a single request and handles its completion
   */
  private static async executeRequest(request: QueuedRequest<Response>): Promise<void> {
    try {
      const result = await request.execute();
      this.completed++;
      request.resolve(result);
    } catch (error) {
      this.failed++;
      request.reject(error);
    }
  }

  /**
   * Enqueues a request to be executed when rate limit allows
   *
   * @param requestFn Function that returns a promise for the actual request
   * @returns Promise that resolves when the request is executed
   */
  public async enqueue(requestFn: () => Promise<Response>): Promise<Response> {
    debug('Enqueuing request: %O', this.getStatus());
    return new Promise<Response>((resolve, reject) => {
      this.queue.push({
        execute: requestFn,
        resolve,
        reject,
      });

      // Start processing if not already running
      if (!this.isProcessing) {
        void this.processQueue();
      }
    });
  }

  /**
   * Gets current queue status for monitoring/debugging
   */
  public getStatus(): {
    queueLength: number;
    requestsInWindow: number;
    maxRequests: number;
    canExecute: boolean;
    nextAvailableSlot?: number;
    isProcessing: boolean;
    completed: number;
    failed: number;
    burstModeActive: boolean;
    utilizationRatio: number;
    predictedUtilization: number;
    timeUntilWindowReset: number;
  } {
    const now = Date.now();
    this.cleanupOldTimestamps(now);

    return {
      queueLength: this.queue.length,
      requestsInWindow: this.requestTimestamps.length,
      maxRequests: this.maxRequests,
      canExecute: this.canExecuteRequest(),
      nextAvailableSlot: this.requestTimestamps.length > 0 ? this.requestTimestamps[0] + this.windowMs : undefined,
      isProcessing: this.isProcessing,
      completed: RateLimiter.completed,
      failed: RateLimiter.failed,
      burstModeActive: this.shouldAllowBurst(),
      utilizationRatio: this.requestTimestamps.length / this.maxRequests,
      predictedUtilization: this.getPredictedWindowUtilization(),
      timeUntilWindowReset: this.getTimeUntilWindowReset(),
    };
  }

  /**
   * Processes the queue, executing requests when rate limit allows
   */
  private async processQueue(): Promise<void> {
    this.isProcessing = true;

    while (this.queue.length > 0) {
      const now = Date.now();

      // Remove timestamps outside the current window
      this.cleanupOldTimestamps(now);

      if (this.canExecuteRequest()) {
        debug('Executing request: %O', this.getStatus());
        // Execute the next request without waiting for it to complete
        const request = this.queue.shift()!;
        this.recordRequest(now);

        // Execute the request asynchronously - don't await
        void RateLimiter.executeRequest(request);

        // Use adaptive delay instead of fixed delay
        const delay = this.calculateAdaptiveDelay();
        if (delay > 0) {
          await RateLimiter.sleep(delay);
        }
      } else {
        // Wait until we can make the next request
        await RateLimiter.sleep(this.calculateDelay(now));
      }
    }

    this.isProcessing = false;
  }

  /**
   * Determines if burst mode should be allowed based on current utilization
   */
  private shouldAllowBurst(): boolean {
    const utilizationRatio = this.requestTimestamps.length / this.maxRequests;
    const queueRatio = this.queue.length / this.maxRequests;
    const totalWorkRatio = utilizationRatio + queueRatio;

    // Allow bursts when:
    // 1. Current utilization is below the burst threshold
    // 2. Total work (current + queued) is below the queue threshold
    return utilizationRatio < this.burstUtilizationThreshold && totalWorkRatio < this.burstQueueThreshold;
  }

  /**
   * Calculates adaptive delay based on current utilization and queue state
   */
  private calculateAdaptiveDelay(): number {
    // Allow immediate execution during burst conditions
    if (this.shouldAllowBurst()) {
      return 0;
    }

    const utilizationRatio = this.requestTimestamps.length / this.maxRequests;
    const remainingCapacity = this.maxRequests - this.requestTimestamps.length;
    const queueLength = this.queue.length;

    // If we have enough capacity for all queued requests, use minimal spacing
    if (remainingCapacity >= queueLength) {
      return this.minDelayMs;
    }

    // Calculate base delay and scale it based on utilization
    const baseDelay = Math.ceil(this.windowMs / this.maxRequests);
    const scalingFactor = Math.min(utilizationRatio * 2, 1);

    return Math.max(this.minDelayMs, baseDelay * scalingFactor);
  }

  /**
   * Gets the time until the current rate limit window resets
   */
  private getTimeUntilWindowReset(): number {
    if (this.requestTimestamps.length === 0) {
      return 0;
    }
    const oldestRequest = this.requestTimestamps[0];
    return Math.max(0, oldestRequest + this.windowMs - Date.now());
  }

  /**
   * Calculates predicted window utilization including queued requests
   */
  private getPredictedWindowUtilization(): number {
    const currentUtilization = this.requestTimestamps.length;
    const queuedRequests = this.queue.length;
    return (currentUtilization + queuedRequests) / this.maxRequests;
  }

  /**
   * Checks if a request can be executed based on current rate limit
   */
  private canExecuteRequest(): boolean {
    return this.requestTimestamps.length < this.maxRequests;
  }

  /**
   * Records the timestamp of a request
   */
  private recordRequest(timestamp: number): void {
    this.requestTimestamps.push(timestamp);
  }

  /**
   * Removes timestamps that are outside the current window
   */
  private cleanupOldTimestamps(now: number): void {
    const cutoff = now - this.windowMs;
    while (this.requestTimestamps.length > 0 && this.requestTimestamps[0] < cutoff) {
      this.requestTimestamps.shift();
    }
  }

  /**
   * Calculates how long to wait before the next request can be made
   */
  private calculateDelay(now: number): number {
    if (this.requestTimestamps.length === 0) {
      return 0;
    }

    // If we're at the limit, wait until the oldest request expires
    if (this.requestTimestamps.length >= this.maxRequests) {
      const oldestRequest = this.requestTimestamps[0];
      const timeUntilExpiry = oldestRequest + this.windowMs - now;
      return Math.max(0, timeUntilExpiry + 100); // Add 100ms buffer
    }

    return 0;
  }
}
