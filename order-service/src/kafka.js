import pkg from 'kafkajs';
const { Kafka, logLevel } = pkg;

const KAFKA_BROKERS = (process.env.KAFKA_BROKERS || 'kafka:9092').split(',');

export const kafka = new Kafka({
  clientId: 'order-service',
  brokers: KAFKA_BROKERS,
  logLevel: logLevel.WARN,
  retry: {
    initialRetryTime: 300,
    retries: 10
  }
});

export const producer = kafka.producer();
let isConnected = false;

export async function connectProducer() {
  if (isConnected) return;
  try {
    await producer.connect();
    isConnected = true;
    console.log('[Order Service] Kafka Producer connected successfully');
  } catch (err) {
    console.error('[Order Service] Kafka Producer connection error:', err.message);
  }
}
