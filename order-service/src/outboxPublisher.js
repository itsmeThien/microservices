import { pool } from './db.js';
import { producer, connectProducer } from './kafka.js';

let isRunning = false;

export async function processOutbox() {
  if (isRunning) return;
  isRunning = true;

  try {
    await connectProducer();

    const client = await pool.connect();
    try {
      const res = await client.query(
        `SELECT id, aggregate_id, event_type, payload
         FROM outbox_events
         WHERE status = 'PENDING'
         ORDER BY id ASC
         LIMIT 50`
      );

      for (const row of res.rows) {
        try {
          await producer.send({
            topic: 'order-created',
            messages: [
              {
                key: String(row.aggregate_id),
                value: JSON.stringify(row.payload)
              }
            ]
          });

          await client.query(
            `UPDATE outbox_events
             SET status = 'PUBLISHED', processed_at = CURRENT_TIMESTAMP
             WHERE id = $1`,
            [row.id]
          );

          console.log(`[Order Outbox] Published event ${row.event_type} for order ${row.aggregate_id}`);
        } catch (sendErr) {
          console.error(`[Order Outbox] Error publishing event ${row.id}:`, sendErr.message);
          break; // Stop batch and retry next interval
        }
      }
    } finally {
      client.release();
    }
  } catch (err) {
    console.error('[Order Outbox] Polling error:', err.message);
  } finally {
    isRunning = false;
  }
}

export function startOutboxWorker(intervalMs = 3000) {
  console.log('[Order Service] Outbox worker started, polling every', intervalMs, 'ms');
  setInterval(processOutbox, intervalMs);
}
