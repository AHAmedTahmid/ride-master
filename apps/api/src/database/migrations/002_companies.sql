-- =============================================================================
-- Migration 002: Companies
-- =============================================================================

USE ride_master;

-- ── companies ─────────────────────────────────────────────────────────────────
CREATE TABLE companies (
  id                       BIGINT UNSIGNED  NOT NULL AUTO_INCREMENT,
  public_id                CHAR(26)         NOT NULL,
  owner_user_id            BIGINT UNSIGNED  NOT NULL,
  type                     VARCHAR(20)      NOT NULL DEFAULT 'company',
  name                     VARCHAR(200)     NOT NULL,
  trade_name               VARCHAR(200)     NULL,
  registration_number      VARCHAR(100)     NULL,
  licence_number           VARCHAR(100)     NOT NULL,
  phone                    VARCHAR(20)      NOT NULL,
  email                    VARCHAR(320)     NULL,
  logo_key                 VARCHAR(500)     NULL     COMMENT 'S3 object key for logo',
  status                   VARCHAR(32)      NOT NULL DEFAULT 'pending',
  commission_override_bps  INT UNSIGNED     NULL     COMMENT 'NULL = use global rate',
  balance_limit_laari      BIGINT           NOT NULL DEFAULT 50000 COMMENT 'Max negative balance (laari)',
  rating_avg               DECIMAL(3,2)     NULL,
  approved_by              BIGINT UNSIGNED  NULL,
  approved_at              DATETIME(3)      NULL,
  is_demo                  TINYINT(1)       NOT NULL DEFAULT 0,
  deleted_at               DATETIME(3)      NULL,
  created_at               DATETIME(3)      NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at               DATETIME(3)      NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_companies_public_id (public_id),
  CONSTRAINT chk_companies_type   CHECK (type IN ('company', 'individual')),
  CONSTRAINT chk_companies_status CHECK (status IN ('pending', 'approved', 'rejected', 'suspended')),
  CONSTRAINT fk_companies_owner   FOREIGN KEY (owner_user_id) REFERENCES users (id) ON DELETE RESTRICT,
  CONSTRAINT fk_companies_approver FOREIGN KEY (approved_by)  REFERENCES users (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE INDEX idx_companies_owner_user_id ON companies (owner_user_id);
CREATE INDEX idx_companies_status        ON companies (status);

-- ── company_documents ─────────────────────────────────────────────────────────
CREATE TABLE company_documents (
  id           BIGINT UNSIGNED  NOT NULL AUTO_INCREMENT,
  public_id    CHAR(26)         NOT NULL,
  company_id   BIGINT UNSIGNED  NOT NULL,
  type         VARCHAR(32)      NOT NULL,
  file_key     VARCHAR(500)     NOT NULL COMMENT 'S3 object key',
  expiry_date  DATE             NULL,
  status       VARCHAR(32)      NOT NULL DEFAULT 'pending',
  verified_by  BIGINT UNSIGNED  NULL,
  verified_at  DATETIME(3)      NULL,
  created_at   DATETIME(3)      NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at   DATETIME(3)      NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_company_documents_public_id (public_id),
  CONSTRAINT chk_company_documents_type   CHECK (type IN ('licence', 'registration', 'insurance')),
  CONSTRAINT chk_company_documents_status CHECK (status IN ('pending', 'verified', 'rejected', 'expired')),
  CONSTRAINT fk_company_documents_company FOREIGN KEY (company_id)  REFERENCES companies (id) ON DELETE RESTRICT,
  CONSTRAINT fk_company_documents_verifier FOREIGN KEY (verified_by) REFERENCES users     (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE INDEX idx_company_documents_company_id ON company_documents (company_id);
CREATE INDEX idx_company_documents_expiry_date ON company_documents (expiry_date);

-- ── company_service_areas ─────────────────────────────────────────────────────
-- Populated after areas table is created (migration 004), FKs added then.
CREATE TABLE company_service_areas (
  company_id BIGINT UNSIGNED NOT NULL,
  area_id    BIGINT UNSIGNED NOT NULL,
  PRIMARY KEY (company_id, area_id),
  CONSTRAINT fk_csa_company FOREIGN KEY (company_id) REFERENCES companies (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- ── company_staff ─────────────────────────────────────────────────────────────
CREATE TABLE company_staff (
  id          BIGINT UNSIGNED  NOT NULL AUTO_INCREMENT,
  public_id   CHAR(26)         NOT NULL,
  company_id  BIGINT UNSIGNED  NOT NULL,
  user_id     BIGINT UNSIGNED  NOT NULL,
  staff_role  VARCHAR(32)      NOT NULL DEFAULT 'manager',
  created_at  DATETIME(3)      NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_company_staff_public_id (public_id),
  UNIQUE KEY uq_company_staff_combo (company_id, user_id),
  CONSTRAINT chk_company_staff_role FOREIGN KEY (company_id) REFERENCES companies (id) ON DELETE CASCADE,
  CONSTRAINT fk_company_staff_user  FOREIGN KEY (user_id)    REFERENCES users     (id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

INSERT INTO schema_migrations (version) VALUES ('002_companies');
