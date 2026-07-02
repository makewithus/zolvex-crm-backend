# API Verification Sprint Report

### 1. Edit User - Success (Partial Update)
**Endpoint:** `PATCH /users/faa81bdf-4b7e-4e33-8ed6-41587a57248d`

**Request Payload:**
```json
{
  "name": "UpdatedName"
}
```

**Database State (Before):**
```json
{
  "name": "TestUser_API",
  "phone": "1111111111"
}
```

**Response (Status: 200):**
```json
{
  "status": "success",
  "message": "User updated",
  "data": {
    "id": "faa81bdf-4b7e-4e33-8ed6-41587a57248d",
    "name": "UpdatedName",
    "phone": "1111111111",
    "is_active": true,
    "joining_date": null,
    "skill_tags": [],
    "role": {
      "id": "b1c3ce5c-8fe5-4f9a-bfc3-39fb2b194039",
      "name": "City Manager"
    },
    "city": null
  }
}
```

**Database State (After):**
```json
{
  "name": "UpdatedName",
  "phone": "1111111111"
}
```

✅ Test Passed (Expected 200, got 200)

---

### 1. Edit User - Validation (Invalid Phone length)
**Endpoint:** `PATCH /users/faa81bdf-4b7e-4e33-8ed6-41587a57248d`

**Request Payload:**
```json
{
  "phone": "123"
}
```

**Database State (Before):**
```json
{
  "phone": "1111111111"
}
```

**Response (Status: 400):**
```json
{
  "status": "error",
  "message": "Validation failed",
  "errors": [
    {
      "origin": "string",
      "code": "too_small",
      "minimum": 10,
      "inclusive": true,
      "path": [
        "body",
        "phone"
      ],
      "message": "Too small: expected string to have >=10 characters"
    }
  ]
}
```

**Database State (After):**
```json
{
  "phone": "1111111111"
}
```

✅ Test Passed (Expected 400, got 400)

---

### 1. Edit User - Not Found
**Endpoint:** `PATCH /users/00000000-0000-0000-0000-000000000000`

**Request Payload:**
```json
{
  "name": "Ghost"
}
```

**Database State (Before):**
```json
null
```

**Response (Status: 404):**
```json
{
  "status": "error",
  "message": "User not found"
}
```

**Database State (After):**
```json
null
```

✅ Test Passed (Expected 404, got 404)

---

### 2. Reset Password - Success
**Endpoint:** `PATCH /users/faa81bdf-4b7e-4e33-8ed6-41587a57248d/reset-password`

**Request Payload:**
```json
{
  "new_password": "newSecurePassword123"
}
```

**Database State (Before):**
```json
{
  "password_hash": "dummy"
}
```

**Response (Status: 200):**
```json
{
  "status": "success",
  "message": "Password updated successfully"
}
```

**Database State (After):**
```json
{
  "password_hash": "$2b$10$jqddssWnq39/76CoIfBKPO2K2NNO9LEM9s/0OMvlPt.TalNLWt0c6"
}
```

✅ Test Passed (Expected 200, got 200)

---

### 3. Edit City - Success
**Endpoint:** `PATCH /cities/366dabe0-04c6-4fd9-a03d-7c71717e8d3d`

**Request Payload:**
```json
{
  "is_active": false
}
```

**Database State (Before):**
```json
{
  "is_active": true
}
```

**Response (Status: 200):**
```json
{
  "status": "success",
  "message": "City updated",
  "data": {
    "id": "366dabe0-04c6-4fd9-a03d-7c71717e8d3d",
    "name": "TestCity_API",
    "is_active": false
  }
}
```

**Database State (After):**
```json
{
  "is_active": false
}
```

✅ Test Passed (Expected 200, got 200)

---

### 4. Edit Service - Success
**Endpoint:** `PATCH /services/bdfc823a-2adb-491d-8a3a-fe01129f9fdc`

**Request Payload:**
```json
{
  "base_price": 150
}
```

**Database State (Before):**
```json
{
  "base_price": 100
}
```

**Response (Status: 200):**
```json
{
  "status": "success",
  "message": "Service updated",
  "data": {
    "id": "bdfc823a-2adb-491d-8a3a-fe01129f9fdc",
    "name": "TestService_API",
    "description": null,
    "base_price": 150,
    "is_active": true
  }
}
```

**Database State (After):**
```json
{
  "base_price": 150
}
```

✅ Test Passed (Expected 200, got 200)

---

### 5. Edit Pricing Rule - Success
**Endpoint:** `PATCH /pricing-rules/458ea451-4b7a-4da5-ae79-d817df9b94e3`

**Request Payload:**
```json
{
  "base_price": 200,
  "bhk_type": "3BHK"
}
```

**Database State (Before):**
```json
{
  "base_price": 120,
  "bhk_type": null
}
```

**Response (Status: 200):**
```json
{
  "status": "success",
  "message": "Pricing rule updated",
  "data": {
    "id": "458ea451-4b7a-4da5-ae79-d817df9b94e3",
    "service_id": "bdfc823a-2adb-491d-8a3a-fe01129f9fdc",
    "city_id": null,
    "bhk_type": "3BHK",
    "tank_size": null,
    "base_price": 200
  }
}
```

**Database State (After):**
```json
{
  "base_price": 200,
  "bhk_type": "3BHK"
}
```

✅ Test Passed (Expected 200, got 200)

---

### 6. Delete Pricing Rule - Success
**Endpoint:** `DELETE /pricing-rules/458ea451-4b7a-4da5-ae79-d817df9b94e3`

**Request Payload:**
```json
{}
```

**Database State (Before):**
```json
{
  "id": "458ea451-4b7a-4da5-ae79-d817df9b94e3",
  "service_id": "bdfc823a-2adb-491d-8a3a-fe01129f9fdc",
  "city_id": null,
  "bhk_type": "3BHK",
  "tank_size": null,
  "base_price": 200
}
```

**Response (Status: 204):**
```json
null
```

**Database State (After):**
```json
null
```

✅ Test Passed (Expected 204, got 204)

---

### 6. Delete Pricing Rule - Second Delete Returns 404
**Endpoint:** `DELETE /pricing-rules/458ea451-4b7a-4da5-ae79-d817df9b94e3`

**Request Payload:**
```json
{}
```

**Database State (Before):**
```json
null
```

**Response (Status: 404):**
```json
{
  "status": "error",
  "message": "Pricing rule not found"
}
```

**Database State (After):**
```json
null
```

✅ Test Passed (Expected 404, got 404)

---

