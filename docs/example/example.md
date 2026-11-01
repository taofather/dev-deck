---
title: System Architecture Example
reactflow:
  - "#/example/overview"
labels:
  - Architecture
  - Example
---

# System Architecture Example

This is a sample documentation page demonstrating the integration between Hugo Markdown documentation and interactive React Flow diagrams.

The diagram below visualizes the relationship between the frontend component, backend services, and the database schema.

{{< reactflow "#/example/overview" "500px" >}}

## Key Components

- **Frontend**: `FCOM-WebApp` client interface.
- **Backend**: `BFUN-AuthService` authentication logic and `BENT-Account` domain model.
- **Database**: `DBT-Users` PostgreSQL table.
