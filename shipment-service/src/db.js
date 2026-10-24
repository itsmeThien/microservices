import { MongoClient } from 'mongodb';

const MONGO_URI = process.env.MONGO_URI || 'mongodb://admin:admin123@mongo:27017/shipment_db?authSource=admin';
const DB_NAME = process.env.DB_NAME || 'shipment_db';

let dbInstance = null;

export async function connectDB() {
  if (dbInstance) return dbInstance;

  const client = new MongoClient(MONGO_URI);
  await client.connect();
  console.log('[Shipment Service] Connected to MongoDB successfully');
  dbInstance = client.db(DB_NAME);
  return dbInstance;
}
