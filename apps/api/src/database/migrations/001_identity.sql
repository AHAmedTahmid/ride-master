-- =============================================================================
-- Migration 001: Identity and Access
-- Engine: InnoDB, charset: utf8mb4_0900_ai_ci
-- All PKs: BIGINT UNSIGNED AUTO_INCREMENT
-- All public IDs: CHAR(26) ULID
-- All timestamps: DATETIME(3) UTC
-- =============================================================================

USE ride_master;

-- ── Schema version tracking ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS schema_migrations (
  id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  version     VARCHAR(50)     NOT NULL,
  applied_at  DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_schema_migrations_version (version)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- ── users ─────────────────────────────────────────────────────────────────────
CREATE TABLE users (
  id              BIGINT UNSIGNED  NOT NULL AUTO_INCREMENT,
  public_id       CHAR(26)         NOT NULL,
  full_name       VARCHAR(200)     NOT NULL,
  phone           VARCHAR(20)      NOT NULL COMMENT '+960XXXXXXX format',
  email           VARCHAR(320)     NULL,
  password_hash   VARCHAR(255)     NULL     COMMENT 'Only for superadmin accounts',
  totp_secret_enc VARCHAR(500)     NULL     COMMENT 'Encrypted TOTP secret, admin only',
  status          VARCHAR(32)      NOT NULL DEFAULT 'active',
  language        VARCHAR(10)      NOT NULL DEFAULT 'en',
  last_login_at   DATETIME(3)      NULL,
  deleted_at      DATETIME(3)      NULL,
  created_at      DATETIME(3)      NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at      DATETIME(3)      NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_users_public_id (public_id),
  UNIQUE KEY uq_users_phone (phone),
  UNIQUE KEY uq_users_email (email),
  CONSTRAINT chk_users_status CHECK (status IN ('active', 'suspended', 'deleted')),
  CONSTRAINT chk_users_language CHECK (language IN ('en', 'dv'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- ── user_roles ────────────────────────────────────────────────────────────────
-- One user can hold multiple roles (e.g. company_owner + driver on same company).
-- Uniqueness: (user_id, role, COALESCE(company_id, '')) must be unique.
-- MySQL does not support partial unique indexes, so we use a generated column.
CREATE TABLE user_roles (
  id                    BIGINT UNSIGNED  NOT NULL AUTO_INCREMENT,
  public_id             CHAR(26)         NOT NULL,
  user_id               BIGINT UNSIGNED  NOT NULL,
  role                  VARCHAR(32)      NOT NULL,
  company_id            BIGINT UNSIGNED  NULL     COMMENT 'NULL for rider and superadmin',
  admin_level           VARCHAR(32)      NULL     COMMENT 'super | verifier | support | finance',
  status                VARCHAR(32)      NOT NULL DEFAULT 'active',
  -- Generated column: coalesce company_id to 0 for uniqueness key
  company_id_key        BIGINT UNSIGNED  NOT NULL
    GENERATED ALWAYS AS (COALESCE(company_id, 0)) STORED,
  created_at            DATETIME(3)      NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at            DATETIME(3)      NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_user_roles_public_id (public_id),
  UNIQUE KEY uq_user_roles_combo (user_id, role, company_id_key),
  CONSTRAINT chk_user_roles_role CHECK (role IN ('superadmin', 'company_owner', 'driver', 'rider')),
  CONSTRAINT chk_user_roles_admin_level CHECK (
    admin_level IS NULL OR admin_level IN ('super', 'verifier', 'support', 'finance')
  ),
  CONSTRAINT chk_user_roles_status CHECK (status IN ('active', 'inactive', 'suspended')),
  CONSTRAINT fk_user_roles_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE INDEX idx_user_roles_user_id    ON user_roles (user_id);
CREATE INDEX idx_user_roles_company_id ON user_roles (company_id);

-- ── otp_codes ─────────────────────────────────────────────────────────────────
CREATE TABLE otp_codes (
  id          BIGINT UNSIGNED  NOT NULL AUTO_INCREMENT,
  public_id   CHAR(26)         NOT NULL,
  phone       VARCHAR(20)      NOT NULL,
  code_hash   VARCHAR(255)     NOT NULL COMMENT 'argon2id hash of the OTP code',
  purpose     VARCHAR(32)      NOT NULL DEFAULT 'login',
  expires_at  DATETIME(3)      NOT NULL,
  attempts    TINYINT UNSIGNED NOT NULL DEFAULT 0,
  used_at     DATETIME(3)      NULL,
  created_at  DATETIME(3)      NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_otp_codes_public_id (public_id),
  CONSTRAINT chk_otp_codes_purpose CHECK (purpose IN ('login', 'register', 'verify'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE INDEX idx_otp_codes_phone      ON otp_codes (phone, purpose, expires_at);
CREATE INDEX idx_otp_codes_expires_at ON otp_codes (expires_at);

-- ── sessions ──────────────────────────────────────────────────────────────────
CREATE TABLE sessions (
  id                  BIGINT UNSIGNED  NOT NULL AUTO_INCREMENT,
  public_id           CHAR(26)         NOT NULL,
  user_id             BIGINT UNSIGNED  NOT NULL,
  user_role_id        BIGINT UNSIGNED  NOT NULL COMMENT 'Active role for this session',
  refresh_token_hash  VARCHAR(255)     NOT NULL COMMENT 'argon2id hash of refresh token',
  device_info         JSON             NULL,
  ip_address          VARCHAR(45)      NULL,
  expires_at          DATETIME(3)      NOT NULL,
  revoked_at          DATETIME(3)      NULL,
  created_at          DATETIME(3)      NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at          DATETIME(3)      NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_sessions_public_id (public_id),
  CONSTRAINT fk_sessions_user      FOREIGN KEY (user_id)      REFERENCES users      (id) ON DELETE RESTRICT,
  CONSTRAINT fk_sessions_user_role FOREIGN KEY (user_role_id) REFERENCES user_roles (id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE INDEX idx_sessions_user_id    ON sessions (user_id);
CREATE INDEX idx_sessions_expires_at ON sessions (expires_at);

-- ── user_consents ─────────────────────────────────────────────────────────────
CREATE TABLE user_consents (
  id          BIGINT UNSIGNED  NOT NULL AUTO_INCREMENT,
  public_id   CHAR(26)         NOT NULL,
  user_id     BIGINT UNSIGNED  NOT NULL,
  document    VARCHAR(100)     NOT NULL COMMENT 'terms | privacy_policy | operator_agreement',
  version     VARCHAR(20)      NOT NULL,
  accepted_at DATETIME(3)      NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  ip_address  VARCHAR(45)      NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_user_consents_public_id (public_id),
  CONSTRAINT fk_user_consents_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE INDEX idx_user_consents_user_id ON user_consents (user_id);

-- Record this migration
INSERT INTO schema_migrations (version) VALUES ('001_identity');
