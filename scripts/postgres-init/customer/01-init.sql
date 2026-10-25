CREATE TABLE IF NOT EXISTS memberships (
    mid SERIAL PRIMARY KEY,
    mname VARCHAR(50) NOT NULL,
    score INT NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS customers (
    uid INT PRIMARY KEY,
    fullname VARCHAR(100) NOT NULL,
    mid INT NOT NULL REFERENCES memberships(mid) ON DELETE RESTRICT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO memberships (mid, mname, score) VALUES
(1, 'Bronze', 50),
(2, 'Silver', 100),
(3, 'Gold', 200),
(4, 'Platinum', 500)
ON CONFLICT (mid) DO NOTHING;

INSERT INTO customers (uid, fullname, mid) VALUES
(1, 'Administrator', 4)
ON CONFLICT (uid) DO NOTHING;
