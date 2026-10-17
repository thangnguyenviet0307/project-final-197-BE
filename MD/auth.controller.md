# Auth Controller API

This document describes the login and registration handlers in
`src/controllers/auth.controller.ts`.

## Route status

The router defines `POST /login` and `POST /register`. The intended API paths
are `POST /api/v1/auth/login` and `POST /api/v1/auth/register`, but
`src/app.ts` does not currently mount the auth router. These endpoints are
therefore not reachable through the application until that router is mounted.

## Login

**POST** `/api/v1/auth/login`

### Request body

```json
{
  "email": "staff@example.com",
  "password": "secret123"
}
```

Both fields are required. `email` must be a valid email address, and
`password` must contain at least 6 characters.

### Success response

HTTP `200`

```json
{
  "success": true,
  "message": "Đăng nhập thành công!",
  "data": {
    "token": "<jwt>",
    "user": {
      "_id": "<user-id>",
      "fullName": "Staff Member",
      "email": "staff@example.com",
      "role": "staff",
      "status": "active"
    }
  }
}
```

The JWT expires after one day and includes the user's ID and role. The user
model omits the password from JSON output.

### Errors

- HTTP `400`: request validation failed.
- HTTP `401` or `404`: email or password is incorrect.
- HTTP `403`: account is inactive.

## Register

**POST** `/api/v1/auth/register`

### Request body

The registration schema validates `name`, `email`, `password`, and optional
`role` (`admin` or `staff`). Name must contain at least 2 characters;
password must contain at least 6 characters.

```json
{
  "name": "New Staff Member",
  "email": "new.staff@example.com",
  "password": "secret123",
  "role": "staff"
}
```

### Success response

HTTP `201`

```json
{
  "success": true,
  "message": "Đăng ký thành công!",
  "data": {
    "_id": "<user-id>",
    "fullName": "New Staff Member",
    "email": "new.staff@example.com",
    "role": "staff",
    "status": "active"
  }
}
```

The response user omits the password. If no role is supplied, the user model
defaults it to `staff`.

### Errors

- HTTP `400`: request validation failed.
- HTTP `400`: email is already registered.

## Implementation notes

- The registration schema accepts `name`, but the controller currently reads
  `fullName` from the request body. As a result, a request matching the schema
  above does not pass a name to the service, and user creation can fail because
  `fullName` is required by the user model.
- The schema accepts an optional `role`, but the controller does not pass it
  to the registration service. New accounts therefore use the model's default
  role (`staff`).
