// Initialize product_db
db = db.getSiblingDB('product_db');
db.createCollection('products');

db.products.createIndex({ pid: 1 }, { unique: true });

// Seed initial products matching API & test cases
db.products.deleteMany({});
db.products.insertMany([
  {
    pid: 1,
    pname: "Laptop",
    price: 1500.0,
    quantity: 10,
    created_at: new Date(),
    updated_at: new Date()
  },
  {
    pid: 2,
    pname: "Mouse",
    price: 25.0,
    quantity: 50,
    created_at: new Date(),
    updated_at: new Date()
  },
  {
    pid: 3,
    pname: "Mechanical Keyboard",
    price: 80.0,
    quantity: 20,
    created_at: new Date(),
    updated_at: new Date()
  }
]);

// Initialize shipment_db
db = db.getSiblingDB('shipment_db');
db.createCollection('shipments');
db.createCollection('processed_events'); // For Kafka consumer idempotency

db.shipments.createIndex({ shipid: 1 }, { unique: true });
db.shipments.createIndex({ oid: 1 });
db.processed_events.createIndex({ eventId: 1 }, { unique: true });

print("MongoDB initialization complete.");
