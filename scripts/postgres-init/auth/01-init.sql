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

INSERT INTO roles (roleid, rolename) VALUES
(1, 'Admin'),
(2, 'Customer'),
(3, 'Shipment Staff')
ON CONFLICT (roleid) DO NOTHING;

INSERT INTO users (uid, username, password, email, phone, roleid) VALUES
(1, 'admin', '$2a$10$eHKImiN5bQ6h6QilPEhoM.bIbTXYFl.CAdCExCScY660i0yVj5tE2', 'admin@example.com', '0900000001', 1)
ON CONFLICT (uid) DO NOTHING;

SELECT setval('users_uid_seq', (SELECT MAX(uid) FROM users));
