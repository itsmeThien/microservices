# Hệ Thống E-Commerce MVP Microservices (Node.js + DDD + Database-per-Service)

Dự án triển khai backend RESTful API cho hệ thống thương mại điện tử theo kiến trúc Microservices hiện đại, dựa trên các tài liệu phân tích và thiết kế kiến trúc chuẩn Domain-Driven Design (DDD):
- Sơ đồ kiến trúc: `Microservice-Architecture-Design.jpg`
- Sơ đồ Bounded Context: `Bounded-Context.jpg`
- Sơ đồ quy trình: `Business-Process-Model.png`
- Đặc tả API: `API_Specification_Ecommerce_MVP.xlsx`
- Bộ 25 Test Cases: `25_TestCases_5_BoundedContexts.xlsx`

---

## 1. Kiến Trúc Tổng Quan & Bounded Contexts

Hệ thống được thiết kế theo nguyên tắc **Database-per-Service** với 5 Bounded Contexts độc lập và 1 API Gateway:

```
[ Client (Web / Mobile) ]
           │
      REST (HTTP/JSON)
           ▼
┌────────────────────────────────────────────────────────┐
│                      API Gateway                       │
│  - JWT Authentication & RBAC Authorization             │
│  - Redis Rate Limiting (Token Bucket / Sliding Window) │
│  - Redis Cache (GET /api/products)                     │
│  - Logging & Health Check (/api/health)                │
└────┬───────────┬───────────┬───────────┬───────────┬───┘
     │ gRPC      │ gRPC      │ gRPC      │ gRPC      │ gRPC
     ▼           ▼           ▼           ▼           ▼
┌──────────┐┌──────────┐┌──────────┐┌──────────┐┌──────────┐
│   Auth   ││ Customer ││ Product  ││  Order   ││ Shipment │
│ Service  ││ Service  ││ Service  ││ Service  ││ Service  │
└────┬─────┘└────┬─────┘└────┬─────┘└────┬─────┘└────┬─────┘
     │           │           │           │           │
[PostgreSQL] [PostgreSQL] [MongoDB]  [PostgreSQL] [MongoDB]
 (auth_db)  (customer_db)(product_db) (order_db) (shipment_db)
                                         │           ▲
                                      Outbox         │
                                      Publish     Consume
                                         ▼           │
                                   [ Apache Kafka ]──┘
                                   Topic: order-created
```

### Các Dịch Vụ:
1. **API Gateway** (`Port 8080`):
   * Tiếp nhận request REST từ Client.
   * Xác thực JWT Token và phân quyền vai trò (Admin, Customer, Shipment Staff).
   * Giới hạn tần suất gọi API (Rate Limiting) lưu trạng thái trên Redis.
   * Bộ đệm Redis Cache cho danh mục sản phẩm.
   * Giao tiếp đồng bộ sang các Microservice backend thông qua **gRPC**.
2. **Auth Service** (`gRPC Port 50051`):
   * Bounded Context: *Identity & Access*.
   * Quản lý thực thể `User`, `Role`.
   * Cơ sở dữ liệu: PostgreSQL riêng (`auth_db`, container `postgres-auth`).
   * Mã hóa mật khẩu an toàn với `bcryptjs`, sinh JWT Bearer token.
3. **Customer Service** (`gRPC Port 50052`):
   * Bounded Context: *Customer & Membership*.
   * Quản lý thực thể `Customer`, `Membership` (hạng thành viên và điểm tích lũy `score`).
   * Cơ sở dữ liệu: PostgreSQL riêng (`customer_db`, container `postgres-customer`).
4. **Product Service** (`gRPC Port 50053`):
   * Bounded Context: *Product Catalog*.
   * Quản lý danh mục sản phẩm và kiểm tra/trừ tồn kho tức thời (atomic inventory decrement).
   * Cơ sở dữ liệu: MongoDB (`product_db`).
5. **Order Service** (`gRPC Port 50054`):
   * Bounded Context: *Order Management*.
   * Quản lý `Order`, `OrderDetail`.
   * Gọi đồng bộ gRPC sang Customer Service để lấy điểm tích lũy `score` và tính giảm giá `discount`.
   * Gọi đồng bộ gRPC sang Product Service để kiểm tra tồn kho và trừ kho.
   * **Transactional Outbox Pattern**: Lưu thông tin đơn hàng và bảng `outbox_events` trong cùng 1 Transaction database để đảm bảo tính nhất quán (Eventual Consistency), sau đó background worker phát sự kiện `OrderCreated` lên Kafka.
   * Cơ sở dữ liệu: PostgreSQL riêng (`order_db`, container `postgres-order`).
6. **Shipment Service** (`gRPC Port 50055`):
   * Bounded Context: *Shipment*.
   * Lắng nghe sự kiện `OrderCreated` từ Kafka để tự động tạo đơn giao hàng (`status: PENDING`).
   * Hỗ trợ cơ chế Idempotent tránh xử lý sự kiện trùng lặp.
   * Cho phép cập nhật trạng thái vận chuyển (`SHIPPING`, `DELIVERED`, `CANCELLED`).
   * Cơ sở dữ liệu: MongoDB (`shipment_db`).

---

## 2. Hướng Dẫn Cài Đặt & Chạy Local Bằng Docker Compose

### Yêu cầu môi trường:
* Docker & Docker Compose (hoặc Docker Desktop).
* Node.js phiên bản 20 trở lên (nếu muốn chạy file kiểm thử độc lập).

### Bước 1: Khởi động toàn bộ hệ thống
Tại thư mục gốc `d:/microservices`, thực thi lệnh:
```bash
docker compose up --build -d
```

Lệnh này sẽ tự động:
1. Khởi động 7 container hạ tầng: 3 PostgreSQL 16 instance (Auth, Customer, Order), MongoDB 7, Redis 7, Zookeeper và Apache Kafka.
2. Tự động chạy script khởi tạo Database schemas và Seed data:
   * Mỗi PostgreSQL instance khởi tạo schema riêng; Auth tạo roles/users và tài khoản Admin, Customer tạo customers/memberships, Order tạo orders/order_details/outbox_events.
   * MongoDB: Khởi tạo collections `products`, `shipments` và nạp danh sách sản phẩm mẫu (`Laptop`, `Mouse`, `Mechanical Keyboard`).
3. Build và khởi chạy 5 Microservices (gRPC) và API Gateway (REST).

Toàn bộ Compose có **13 container**: 5 Microservices + 1 API Gateway + 7 container hạ tầng. Các PostgreSQL instance được ánh xạ ra máy host lần lượt tại cổng `5432`, `5433` và `5434`; bên trong Docker, từng service kết nối qua tên host riêng (`postgres-auth`, `postgres-customer`, `postgres-order`) trên cổng `5432`.

### Bước 2: Kiểm tra trạng thái hệ thống
Kiểm tra Health check endpoint của API Gateway:
```bash
curl http://localhost:8080/api/health
```
Kết quả phản hồi HTTP 200:
```json
{
  "status": "UP",
  "message": "E-commerce API is running",
  "timestamp": "2026-10-24T...",
  "components": {
    "apiGateway": "UP",
    "redis": "UP"
  }
}
```

### Bước 3: Chạy bộ kiểm thử tự động 25 Test Cases
Chạy file kiểm thử tích hợp mô phỏng đúng các ca kiểm thử trong `25_TestCases_5_BoundedContexts.xlsx`:
```bash
node test-suite.js
```

---

## 3. Danh Sách RESTful API

| Method | Endpoint | Bounded Context | Mô tả | Quyền truy cập |
| :--- | :--- | :--- | :--- | :--- |
| `GET` | `/api/health` | System | Kiểm tra sức khỏe hệ thống | Public |
| `POST` | `/api/auth/register` | Identity & Access | Đăng ký tài khoản người dùng mới | Public |
| `POST` | `/api/auth/login` | Identity & Access | Đăng nhập và nhận Bearer JWT | Public |
| `GET` | `/api/customers/:uid` | Customer & Membership | Xem thông tin khách hàng và điểm score | Bearer JWT (Owner/Admin) |
| `PUT` | `/api/customers/:uid` | Customer & Membership | Cập nhật thông tin khách hàng | Bearer JWT (Owner/Admin) |
| `GET` | `/api/products` | Product Catalog | Xem danh sách sản phẩm (có Redis Cache) | Bearer JWT |
| `GET` | `/api/products/:pid` | Product Catalog | Xem chi tiết sản phẩm theo ID | Bearer JWT |
| `POST` | `/api/products` | Product Catalog | Thêm sản phẩm mới | Admin |
| `PUT` | `/api/products/:pid` | Product Catalog | Cập nhật thông tin / tồn kho sản phẩm | Admin |
| `DELETE`| `/api/products/:pid` | Product Catalog | Xóa sản phẩm khỏi danh mục | Admin |
| `POST` | `/api/orders` | Order Management | Đặt đơn hàng (gRPC trừ kho, Outbox -> Kafka) | Bearer JWT |
| `GET` | `/api/orders` | Order Management | Lấy danh sách đơn hàng | Bearer JWT |
| `GET` | `/api/orders/:oid` | Order Management | Xem chi tiết đơn hàng | Bearer JWT (Owner/Admin) |
| `GET` | `/api/shipments/:shipid` | Shipment | Tra cứu trạng thái vận chuyển | Bearer JWT |
| `PATCH`| `/api/shipments/:shipid/status`| Shipment | Cập nhật trạng thái giao hàng | Shipment Staff / Admin |
