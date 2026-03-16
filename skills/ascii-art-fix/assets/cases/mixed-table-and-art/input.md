# Architecture

## Components

| Component | Port | Role |
|-----------|------|------|
| API       | 3000 | HTTP gateway |
| Worker    | 3001 | Background jobs |
| DB        | 5432 | PostgreSQL |

## Data Flow

+------------------+
| API Server       |
+------------------+
        |
        v
+------------------+
| Message Queue|
+------------------+
        |
        v
+------------------+
| Worker     |
+------------------+
