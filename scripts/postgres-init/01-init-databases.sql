-- Create separate databases for Database-per-Service pattern
CREATE DATABASE auth_db;
CREATE DATABASE customer_db;
CREATE DATABASE order_db;

-- Connect to auth_db and initialize schema
\c auth_db;

CREATE TABLE IF NOT EXISTS roles (
    roleid SERIAL PRIMARY KEY,
    rolename VARCHAR(50) NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS users (
    uid SERIAL PRIMARY KEY,
    username VARCHAR(50) NOT NULL UNIQUE,
    password VARCHAR(255) NOT NULL,
    email VARCHAR(100),
    phone VARCHAR(20),
    roleid INT NOT NULL REFERENCES roles(roleid) ON DELETE RESTRICT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Seed roles
INSERT INTO roles (roleid, rolename) VALUES
(1, 'Admin'),
(2, 'Customer'),
(3, 'Shipment Staff')
ON CONFLICT (roleid) DO NOTHING;

-- Seed default admin (password: Admin@123, bcrypt hash)
-- bcrypt hash for Admin@123: $2a$10$w8u33iB1Uj3R5OQeB2t/d.bZ1lV9K1lK9vY7yN1G8aQJ6wH9tI2W2
INSERT INTO users (uid, username, password, email, phone, roleid) VALUES
(1, 'admin', '$2a$10$7Z8KqD4V2Y8k2s.8bE6s2uD9e7kH1V3N5m9O8q2w4e6r8t0y2u4i6', 'admin@example.com', '0900000001', 1)
ON CONFLICT (uid) DO NOTHING;

SELECT setval('users_uid_seq', (SELECT MAX(uid) FROM users));


-- Connect to customer_db and initialize schema
\c customer_db;

CREATE TABLE IF NOT EXISTS memberships (
    mid SERIAL PRIMARY KEY,
    mname VARCHAR(50) NOT NULL,
    score INT NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS customers (
    uid INT PRIMARY KEY, -- Maps 1:1 to Identity User uid
    fullname VARCHAR(100) NOT NULL,
    mid INT NOT NULL REFERENCES memberships(mid) ON DELETE RESTRICT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Seed memberships
INSERT INTO memberships (mid, mname, score) VALUES
(1, 'Bronze', 50),
(2, 'Silver', 100),
(3, 'Gold', 200),
(4, 'Platinum', 500)
ON CONFLICT (mid) DO NOTHING;

-- Seed default customer for admin/sample user
INSERT INTO customers (uid, fullname, mid) VALUES
(1, 'Administrator', 4)
ON CONFLICT (uid) DO NOTHING;


-- Connect to order_db and initialize schema
\c order_db;

CREATE TABLE IF NOT EXISTS orders (
    oid SERIAL PRIMARY KEY,
    uid INT NOT NULL,
    discount DECIMAL(10, 2) NOT NULL DEFAULT 0.00,
    total_amount DECIMAL(10, 2) NOT NULL DEFAULT 0.00,
    status VARCHAR(50) NOT NULL DEFAULT 'CREATED',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS order_details (
    oid INT NOT NULL REFERENCES orders(oid) ON DELETE CASCADE,
    pid INT NOT NULL,
    qty INT NOT NULL,
    unit_price DECIMAL(10, 2) NOT NULL,
    PRIMARY KEY (oid, pid)
);

CREATE TABLE IF NOT EXISTS outbox_events (
    id SERIAL PRIMARY KEY,
    aggregate_type VARCHAR(50) NOT NULL,
    aggregate_id VARCHAR(50) NOT NULL,
    event_type VARCHAR(50) NOT NULL,
    payload JSONB NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'PENDING',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    processed_at TIMESTAMP
);
