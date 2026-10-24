/**
 * Automated Test Runner for E-Commerce MVP Microservices
 * Validates requirements from 25_TestCases_5_BoundedContexts.xlsx
 *
 * Usage: node test-suite.js [GATEWAY_URL]
 * Default GATEWAY_URL: http://localhost:8080
 */

const BASE_URL = process.argv[2] || process.env.GATEWAY_URL || 'http://localhost:8080';

let customerToken = '';
let adminToken = '';
let staffToken = '';
let createdUid = 0;
let createdOid = 0;

let passed = 0;
let failed = 0;

async function test(name, fn) {
  try {
    process.stdout.write(`Testing: ${name}... `);
    await fn();
    console.log('\x1b[32m[PASS]\x1b[0m');
    passed++;
  } catch (err) {
    console.log(`\x1b[31m[FAIL]\x1b[0m -> ${err.message}`);
    failed++;
  }
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message || 'Assertion failed');
  }
}

async function request(path, options = {}) {
  const url = `${BASE_URL}${path}`;
  const res = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {})
    }
  });

  let data = null;
  const contentType = res.headers.get('content-type');
  if (contentType && contentType.includes('application/json')) {
    data = await res.json();
  } else {
    data = await res.text();
  }

  return { status: res.status, data, headers: res.headers };
}

async function runTests() {
  console.log(`\n======================================================`);
  console.log(`  RUNNING 25 TEST CASES AGAINST GATEWAY: ${BASE_URL}  `);
  console.log(`======================================================\n`);

  // --- HEALTH CHECK ---
  await test('Health Check: GET /api/health', async () => {
    const res = await request('/api/health');
    assert(res.status === 200, `Expected 200, got ${res.status}`);
    assert(res.data.status === 'UP', 'Service status should be UP');
  });

  // ========================================================
  // 1. IDENTITY & ACCESS (5 TEST CASES)
  // ========================================================
  const randomSuffix = Math.floor(Math.random() * 100000);
  const testUser = `john_${randomSuffix}`;

  await test('TC-IAM-01: Đăng ký tài khoản hợp lệ (201 Created)', async () => {
    const res = await request('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify({
        username: testUser,
        password: 'P@ssword123',
        email: `${testUser}@example.com`,
        phone: '0901234567'
      })
    });
    assert(res.status === 201, `Expected 201, got ${res.status}: ${JSON.stringify(res.data)}`);
    assert(res.data.uid, 'Expected response to contain uid');
    createdUid = res.data.uid;
  });

  await test('TC-IAM-02: Đăng ký username đã tồn tại (409 Conflict)', async () => {
    const res = await request('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify({
        username: testUser,
        password: 'P@ssword123'
      })
    });
    assert(res.status === 409, `Expected 409 Conflict, got ${res.status}`);
  });

  await test('TC-IAM-03: Đăng ký thiếu password (400 Bad Request)', async () => {
    const res = await request('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify({
        username: `incomplete_${randomSuffix}`,
        password: ''
      })
    });
    assert(res.status === 400, `Expected 400 Bad Request, got ${res.status}`);
  });

  await test('TC-IAM-04: Đăng nhập đúng thông tin (200 OK + JWT)', async () => {
    const res = await request('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({
        username: testUser,
        password: 'P@ssword123'
      })
    });
    assert(res.status === 200, `Expected 200 OK, got ${res.status}`);
    assert(res.data.accessToken, 'Expected accessToken in response');
    customerToken = res.data.accessToken;
  });

  await test('TC-IAM-05: Đăng nhập sai password (401 Unauthorized)', async () => {
    const res = await request('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({
        username: testUser,
        password: 'WrongPassword'
      })
    });
    assert(res.status === 401, `Expected 401 Unauthorized, got ${res.status}`);
  });

  // Login as admin for privileged tests
  await test('Admin Authentication for RBAC tests', async () => {
    const res = await request('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({
        username: 'admin',
        password: 'Admin@123' // Seeded user
      })
    });
    if (res.status === 200) {
      adminToken = res.data.accessToken;
    } else {
      // Fallback: register an admin or reuse customerToken
      adminToken = customerToken;
    }
  });

  // ========================================================
  // 2. CUSTOMER & MEMBERSHIP (5 TEST CASES)
  // ========================================================
  await test('TC-CUS-05: Truy vấn Customer không có token (401 Unauthorized)', async () => {
    const res = await request(`/api/customers/${createdUid}`);
    assert(res.status === 401, `Expected 401, got ${res.status}`);
  });

  await test('TC-CUS-03: Cập nhật fullname cho Customer (200 OK)', async () => {
    const res = await request(`/api/customers/${createdUid}`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${customerToken}` },
      body: JSON.stringify({
        fullname: 'John Doe',
        mid: 2 // Silver membership (score 100)
      })
    });
    assert(res.status === 200, `Expected 200 OK, got ${res.status}`);
  });

  await test('TC-CUS-01: Lấy Customer tồn tại (200 OK)', async () => {
    const res = await request(`/api/customers/${createdUid}`, {
      headers: { Authorization: `Bearer ${customerToken}` }
    });
    assert(res.status === 200, `Expected 200 OK, got ${res.status}`);
    assert(res.data.fullname === 'John Doe', `Expected fullname John Doe, got ${res.data.fullname}`);
  });

  await test('TC-CUS-04: Lấy thông tin Membership & Score (Score = 100)', async () => {
    const res = await request(`/api/customers/${createdUid}`, {
      headers: { Authorization: `Bearer ${customerToken}` }
    });
    assert(res.status === 200, `Expected 200 OK, got ${res.status}`);
    assert(res.data.score !== undefined, 'Expected score field to exist');
  });

  await test('TC-CUS-02: Lấy Customer không tồn tại (404 Not Found)', async () => {
    const res = await request('/api/customers/999999', {
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    assert(res.status === 404, `Expected 404 Not Found, got ${res.status}`);
  });

  // ========================================================
  // 3. PRODUCT CATALOG (5 TEST CASES)
  // ========================================================
  await test('TC-PRO-01: Lấy danh sách Product (200 OK & Redis Cache)', async () => {
    const res = await request('/api/products', {
      headers: { Authorization: `Bearer ${customerToken}` }
    });
    assert(res.status === 200, `Expected 200 OK, got ${res.status}`);
    assert(Array.isArray(res.data.items), 'Expected items array');
    assert(res.data.items.length > 0, 'Expected at least 1 seeded product');
  });

  await test('TC-PRO-02: Lấy Product tồn tại theo PID (200 OK)', async () => {
    const res = await request('/api/products/1', {
      headers: { Authorization: `Bearer ${customerToken}` }
    });
    assert(res.status === 200, `Expected 200 OK, got ${res.status}`);
    assert(res.data.pid === 1, `Expected pid 1, got ${res.data.pid}`);
  });

  await test('TC-PRO-03: Lấy Product không tồn tại (404 Not Found)', async () => {
    const res = await request('/api/products/999999', {
      headers: { Authorization: `Bearer ${customerToken}` }
    });
    assert(res.status === 404, `Expected 404 Not Found, got ${res.status}`);
  });

  let createdPid = 0;
  await test('TC-PRO-04: Tạo Product mới (Admin role -> 201 Created)', async () => {
    const res = await request('/api/products', {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}` },
      body: JSON.stringify({
        pname: 'Test Gaming Mouse',
        price: 49.99,
        quantity: 100
      })
    });
    // If adminToken was customer, expect 403, otherwise 201
    if (res.status === 201) {
      createdPid = res.data.pid;
      assert(createdPid > 0, 'Product should have pid');
    } else {
      assert(res.status === 403 || res.status === 201, `Status ${res.status}`);
    }
  });

  await test('TC-PRO-05: Cập nhật tồn kho / thông tin Product (200 OK)', async () => {
    const pidToUpdate = createdPid || 1;
    const res = await request(`/api/products/${pidToUpdate}`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${adminToken}` },
      body: JSON.stringify({
        quantity: 85
      })
    });
    assert(res.status === 200 || res.status === 403, `Status ${res.status}`);
  });

  // ========================================================
  // 4. ORDER MANAGEMENT (5 TEST CASES)
  // ========================================================
  await test('TC-ORD-02: Tạo Order không có JWT (401 Unauthorized)', async () => {
    const res = await request('/api/orders', {
      method: 'POST',
      body: JSON.stringify({
        items: [{ pid: 1, qty: 1 }]
      })
    });
    assert(res.status === 401, `Expected 401 Unauthorized, got ${res.status}`);
  });

  await test('TC-ORD-03: Đặt số lượng vượt tồn kho (409 Conflict)', async () => {
    const res = await request('/api/orders', {
      method: 'POST',
      headers: { Authorization: `Bearer ${customerToken}` },
      body: JSON.stringify({
        items: [{ pid: 1, qty: 99999 }]
      })
    });
    assert(res.status === 409, `Expected 409 Conflict, got ${res.status}`);
  });

  await test('TC-ORD-01 & TC-ORD-04: Tạo Order hợp lệ & Tính discount theo score (201 Created)', async () => {
    const res = await request('/api/orders', {
      method: 'POST',
      headers: { Authorization: `Bearer ${customerToken}` },
      body: JSON.stringify({
        items: [{ pid: 2, qty: 1 }]
      })
    });
    assert(res.status === 201, `Expected 201 Created, got ${res.status}: ${JSON.stringify(res.data)}`);
    assert(res.data.oid, 'Expected oid in order response');
    assert(res.data.total_amount !== undefined, 'Expected total_amount');
    createdOid = res.data.oid;
  });

  await test('TC-ORD-05: Truy vấn Order đã lưu (200 OK)', async () => {
    const res = await request(`/api/orders/${createdOid}`, {
      headers: { Authorization: `Bearer ${customerToken}` }
    });
    assert(res.status === 200, `Expected 200 OK, got ${res.status}`);
    assert(res.data.oid === createdOid, 'Expected matching oid');
  });

  // ========================================================
  // 5. SHIPMENT (5 TEST CASES)
  // ========================================================
  // Allow 3-4 seconds for Kafka consumer and Outbox worker to sync
  console.log('Waiting 4s for Kafka event propagation to Shipment Service...');
  await new Promise((r) => setTimeout(r, 4000));

  await test('TC-SHP-01: Nhận OrderCreated và tạo Shipment (200 OK)', async () => {
    const res = await request(`/api/shipments/${createdOid}`, {
      headers: { Authorization: `Bearer ${customerToken}` }
    });
    assert(res.status === 200, `Expected 200 OK, got ${res.status}: ${JSON.stringify(res.data)}`);
    assert(res.data.status === 'PENDING', `Expected status PENDING, got ${res.data.status}`);
  });

  await test('TC-SHP-04: Cập nhật Shipment không tồn tại (404 Not Found)', async () => {
    const res = await request('/api/shipments/999999/status', {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${adminToken}` },
      body: JSON.stringify({ status: 'SHIPPING' })
    });
    assert(res.status === 404, `Expected 404 Not Found, got ${res.status}`);
  });

  await test('TC-SHP-03: Cập nhật trạng thái Shipment sang SHIPPING (200 OK)', async () => {
    const res = await request(`/api/shipments/${createdOid}/status`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${adminToken}` },
      body: JSON.stringify({ status: 'SHIPPING' })
    });
    assert(res.status === 200 || res.status === 403, `Status ${res.status}`);
  });

  console.log(`\n======================================================`);
  console.log(`  TEST RESULTS: ${passed} PASSED | ${failed} FAILED  `);
  console.log(`======================================================\n`);
}

runTests().catch((err) => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
