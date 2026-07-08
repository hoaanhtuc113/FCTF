# 4. Security Design

**Purpose**: Technical security mechanisms — implementation of security requirements from PRD §6.2. Authorization must be enforced at the Service layer, not only the Controller.

---

## 4.1 UI Authentication

| Setting | Value |
| :--- | :--- |
| **Mechanism** | `HttpSession` + `BCrypt` |
| **Session Storage** | In-memory (single server); use Redis if horizontal scaling is needed |
| **Session Timeout** | 30 minutes idle |
| **BCrypt Strength** | 12 (balance of security and login response time ~200–300 ms) |
| **Login Flow** | `POST /login` &rarr; validate credentials &rarr; create session with `userId` and `role` attributes &rarr; redirect to role dashboard |
| **Logout Flow** | Delete session &rarr; redirect to `/login` |

---

## 4.2 Authorization Layer

- **Primary Enforcement**: Service layer — all ownership and role checks happen here.
- **Controller Role Guard**: Quick pre-filter — rejects obviously wrong roles early.
- **Rule**: Service must re-validate even if Controller already checked — future API additions may skip Controller guards.

### Spring Security Path Rules

#### Public (No session required)
- `GET /login`, `POST /login`
- `GET /register`, `POST /register`
- `GET /jobs`, `GET /jobs/{id}`

#### Secured (Session required)
- `/admin/**` &rarr; `ADMIN` only
- `/hr/**` &rarr; `HR_MANAGER`, `ADMIN`
- `/candidate/**` &rarr; `CANDIDATE`
- `/api/**` &rarr; API Key filter (separate from session — see §4.8)

---

## 4.3 Password Policy

| Setting | Value |
| :--- | :--- |
| **Hashing Algorithm** | BCrypt |
| **BCrypt Strength** | 12 |
| **Minimum Length** | 8 characters |
| **Complexity** | At least 1 uppercase letter and 1 digit |
| **Maximum Length** | 72 characters (BCrypt limit) |

---

## 4.4 Account Lockout Policy

| Setting | Value |
| :--- | :--- |
| **Max Consecutive Failed Attempts** | 5 |
| **Counting Window** | Within 10 minutes |
| **Lockout Duration** | 10 minutes (auto-expires) |
| **Unlock by Admin** | Available at any time via Admin UC-18 |
| **Failure Message** | Generic — does not reveal whether username exists or password is wrong (see PRD GB-04) |

---

## 4.5 Secrets Management

- **Environment-based Secrets**: All secrets (DB password, API keys) must be stored in environment variables — never hardcoded.
- **Local Development**: Copy `.env.example` to `.env` (note: `.env` is git-ignored).
- **Production**: Environment variables injected by the deployment platform (or AWS Secrets Manager / HashiCorp Vault).

---

## 4.6 OWASP Top 10 Mitigation Checklist

| Risk | Mitigation |
| :--- | :--- |
| **A01 — Broken Access Control** | Authorization at Service layer; ownership checks; Interviewer scope enforcement (PRD GB-06) |
| **A02 — Cryptographic Failures** | BCrypt for passwords; HTTPS enforced in production; CV files not served via guessable URLs |
| **A03 — Injection** | Spring Data JPA parameterized queries; no string concatenation in JPQL |
| **A05 — Security Misconfiguration** | No default credentials; production error pages show generic messages only |
| **A07 — Auth Failures** | Account lockout (§4.4); session invalidated on logout; deactivated accounts blocked (PRD GB-05) |
| **A09 — Logging Failures** | Auth events audited (§8.3); no passwords or tokens in logs |

---

## 4.7 Security Filter Chain Configuration

```java
@Bean
public SecurityFilterChain filterChain(HttpSecurity http) throws Exception {
    http
        .authorizeHttpRequests(auth -> auth
            .requestMatchers("/login", "/register", "/jobs", "/jobs/**", "/css/**", "/js/**").permitAll()
            .requestMatchers("/admin/**").hasRole("ADMIN")
            .requestMatchers("/hr/**").hasAnyRole("HR_MANAGER", "ADMIN")
            .requestMatchers("/candidate/**").hasRole("CANDIDATE")
            .requestMatchers("/api/**").permitAll() // ApiKeyFilter handles /api/**
            .anyRequest().authenticated()
        )
        .formLogin(form -> form.loginPage("/login").defaultSuccessUrl("/dashboard"))
        .logout(logout -> logout.logoutUrl("/logout").invalidateHttpSession(true))
        .sessionManagement(s -> s.maximumSessions(1));
    return http.build();
}
```

---

## 4.8 External API Authentication (API-type UCs)

> [!NOTE]
> Fill this section only if the project has API-type UCs in UCS. Omit and mark N/A otherwise.

| Setting | Value |
| :--- | :--- |
| **Mechanism** | API Key passed in `X-API-Key` request header |
| **Key Storage** | Hashed keys stored in `api_keys` table (never store raw key) |
| **Key Issuance** | Admin generates keys via Admin panel or direct DB insert |
| **Validation** | `ApiKeyAuthFilter` runs before any `/api/**` request; validates key; attaches caller identity to request context |
| **Rate Limiting** | 60 requests per minute per API key; enforced via in-memory counter (or Redis for distributed) |
| **API Versioning** | All external endpoints prefixed with `/api/v{N}/` — current version: v1 |
| **IP Allowlist** | Not enforced in v1; configurable per key in future version |

### `api_keys` Table

| Column | Type | Notes |
| :--- | :--- | :--- |
| **id** | `BIGSERIAL` | Primary Key |
| **key_hash** | `VARCHAR(64)` | SHA-256 hash of the raw key |
| **caller_name** | `VARCHAR(100)` | e.g. 'HRM System', 'VietnamWorks' |
| **allowed_endpoints** | `TEXT` | Comma-separated endpoint prefixes or `*` for all |
| **is_active** | `BOOLEAN` | Inactive keys are rejected immediately |
| **created_at** | `TIMESTAMP` | |
| **last_used_at** | `TIMESTAMP` | Updated on each successful use |
