import pkg from 'kafkajs';
import { connectDB } from './db.js';

const { Kafka, logLevel } = pkg;
const KAFKA_BROKERS = (process.env.KAFKA_BROKERS || 'kafka:9092').split(',');

const kafka = new Kafka({
  clientId: 'shipment-service',
  brokers: KAFKA_BROKERS,
  logLevel: logLevel.WARN,
  retry: {
    initialRetryTime: 500,
    retries: 10
  }
});

const consumer = kafka.consumer({ groupId: 'shipment-consumer-group' });

export async function startKafkaConsumer() {
  try {
    await consumer.connect();
    console.log('[Shipment Service] Kafka Consumer connected');

    await consumer.subscribe({ topic: 'order-created', fromBeginning: true });

    await consumer.run({
      eachMessage: async ({ topic, partition, message }) => {
        try {
          const rawValue = message.value.toString();
          console.log(`[Shipment Service] Received event from topic ${topic}:`, rawValue);

          const payload = JSON.parse(rawValue);

          // TC-SHP-02: Missing oid check
          if (!payload || !payload.oid) {
            console.error('[Shipment Service] Rejected event: Missing oid in payload');
            return;
          }

          const oid = parseInt(payload.oid, 10);
          const db = await connectDB();

          // TC-SHP-05: Idempotency check - do not create duplicate shipment for same oid / eventId
          const existingShipment = await db.collection('shipments').findOne({ oid });
          if (existingShipment) {
            console.log(`[Shipment Service] Idempotent skip: Shipment already exists for order ${oid}`);
            return;
          }

          if (payload.eventId) {
            const processed = await db.collection('processed_events').findOne({ eventId: payload.eventId });
            if (processed) {
              console.log(`[Shipment Service] Idempotent skip: Event ${payload.eventId} already processed`);
              return;
            }
          }

          // Generate shipid (matching oid for MVP or incremental)
          const shipid = oid;

          const shipmentDoc = {
            shipid,
            oid,
            status: 'PENDING',
            created_at: new Date(),
            updated_at: new Date()
          };

          await db.collection('shipments').insertOne(shipmentDoc);

          if (payload.eventId) {
            await db.collection('processed_events').insertOne({
              eventId: payload.eventId,
              processedAt: new Date()
            });
          }

          console.log(`[Shipment Service] Successfully created shipment #${shipid} for order #${oid}`);
        } catch (msgErr) {
          console.error('[Shipment Service] Error processing Kafka message:', msgErr);
        }
      }
    });
  } catch (err) {
    console.error('[Shipment Service] Failed to initialize Kafka Consumer, will retry in 5s:', err.message);
    setTimeout(startKafkaConsumer, 5000);
  }
}
