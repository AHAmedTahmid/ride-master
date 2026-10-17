-- =============================================================================
-- Migration 003: Fleet and Drivers
-- Generated columns enforce:
--   • One active assignment per vehicle at a time
--   • One active assignment per driver at a time
--   • One active trip per driver at a time
-- =============================================================================

-- ── vehicle_types ─────────────────────────────────────────────────────────────
CREATE TABLE vehicle_types (
  id               BIGINT UNSIGNED  NOT NULL AUTO_INCREMENT,
  public_id        CHAR(26)         NOT NULL,
  name             VARCHAR(100)     NOT NULL,
  seats            TINYINT UNSIGNED NOT NULL,
  luggage_capacity TINYINT UNSIGNED NOT NULL DEFAULT 2,
  sort_order       SMALLINT         NOT NULL DEFAULT 0,
  is_demo          TINYINT(1)       NOT NULL DEFAULT 0,
  created_at       DATETIME(3)      NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at       DATETIME(3)      NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_vehicle_types_public_id (public_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- ── vehicles ──────────────────────────────────────────────────────────────────
CREATE TABLE vehicles (
  id               BIGINT UNSIGNED  NOT NULL AUTO_INCREMENT,
  public_id        CHAR(26)         NOT NULL,
  company_id       BIGINT UNSIGNED  NOT NULL,
  vehicle_type_id  BIGINT UNSIGNED  NOT NULL,
  plate_number     VARCHAR(20)      NOT NULL,
  make             VARCHAR(100)     NOT NULL,
  model            VARCHAR(100)     NOT NULL,
  year             SMALLINT UNSIGNED NOT NULL,
  colour           VARCHAR(50)      NOT NULL,
  insurance_expiry DATE             NOT NULL,
  status           VARCHAR(32)      NOT NULL DEFAULT 'active',
  is_demo          TINYINT(1)       NOT NULL DEFAULT 0,
  deleted_at       DATETIME(3)      NULL,
  created_at       DATETIME(3)      NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at       DATETIME(3)      NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_vehicles_public_id    (public_id),
  UNIQUE KEY uq_vehicles_plate_number (plate_number),
  CONSTRAINT chk_vehicles_status CHECK (status IN ('active', 'maintenance', 'retired')),
  CONSTRAINT fk_vehicles_company  FOREIGN KEY (company_id)      REFERENCES companies    (id) ON DELETE RESTRICT,
  CONSTRAINT fk_vehicles_type     FOREIGN KEY (vehicle_type_id) REFERENCES vehicle_types (id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE INDEX idx_vehicles_company_id ON vehicles (company_id);

-- ── drivers ───────────────────────────────────────────────────────────────────
CREATE TABLE drivers (
  id              BIGINT UNSIGNED  NOT NULL AUTO_INCREMENT,
  public_id       CHAR(26)         NOT NULL,
  user_id         BIGINT UNSIGNED  NOT NULL,
  company_id      BIGINT UNSIGNED  NOT NULL,
  licence_number  VARCHAR(100)     NOT NULL,
  licence_expiry  DATE             NOT NULL,
  id_card_number  VARCHAR(500)     NULL     COMMENT 'Encrypted at application layer',
  photo_key       VARCHAR(500)     NULL     COMMENT 'S3 object key',
  status          VARCHAR(32)      NOT NULL DEFAULT 'pending',
  rating_avg      DECIMAL(3,2)     NULL,
  is_demo         TINYINT(1)       NOT NULL DEFAULT 0,
  deleted_at      DATETIME(3)      NULL,
  created_at      DATETIME(3)      NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at      DATETIME(3)      NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_drivers_public_id (public_id),
  CONSTRAINT chk_drivers_status CHECK (status IN ('pending', 'active', 'suspended')),
  CONSTRAINT fk_drivers_user    FOREIGN KEY (user_id)    REFERENCES users     (id) ON DELETE RESTRICT,
  CONSTRAINT fk_drivers_company FOREIGN KEY (company_id) REFERENCES companies (id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE INDEX idx_drivers_user_id    ON drivers (user_id);
CREATE INDEX idx_drivers_company_id ON drivers (company_id);
CREATE INDEX idx_drivers_status     ON drivers (status);

-- ── driver_vehicle_assignments ────────────────────────────────────────────────
-- Generated columns enforce one open (assigned_to IS NULL) assignment per driver
-- and per vehicle using UNIQUE keys on generated columns.
-- NULL (not 0) marks closed rows: MySQL UNIQUE allows many NULLs, so history
-- rows never collide with each other — only the single open row per key matters.
CREATE TABLE driver_vehicle_assignments (
  id              BIGINT UNSIGNED  NOT NULL AUTO_INCREMENT,
  public_id       CHAR(26)         NOT NULL,
  driver_id       BIGINT UNSIGNED  NOT NULL,
  vehicle_id      BIGINT UNSIGNED  NOT NULL,
  assigned_from   DATETIME(3)      NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  assigned_to     DATETIME(3)      NULL     COMMENT 'NULL = currently active',
  -- Generated: driver_id while open, else NULL (UNIQUE ⇒ one open per driver)
  open_driver_key BIGINT UNSIGNED
    GENERATED ALWAYS AS (IF(assigned_to IS NULL, driver_id, NULL)) STORED,
  -- Generated: vehicle_id while open, else NULL (UNIQUE ⇒ one open per vehicle)
  open_vehicle_key BIGINT UNSIGNED
    GENERATED ALWAYS AS (IF(assigned_to IS NULL, vehicle_id, NULL)) STORED,
  created_at      DATETIME(3)      NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_dva_public_id        (public_id),
  UNIQUE KEY uq_dva_open_driver      (open_driver_key),
  UNIQUE KEY uq_dva_open_vehicle     (open_vehicle_key),
  CONSTRAINT fk_dva_driver  FOREIGN KEY (driver_id)  REFERENCES drivers  (id) ON DELETE RESTRICT,
  CONSTRAINT fk_dva_vehicle FOREIGN KEY (vehicle_id) REFERENCES vehicles (id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE INDEX idx_dva_driver_id  ON driver_vehicle_assignments (driver_id);
CREATE INDEX idx_dva_vehicle_id ON driver_vehicle_assignments (vehicle_id);

-- ── driver_status ─────────────────────────────────────────────────────────────
-- One row per driver. Hot data mirrored to Redis.
-- Generated column enforces one active trip per driver.
CREATE TABLE driver_status (
  driver_id          BIGINT UNSIGNED  NOT NULL,
  state              VARCHAR(20)      NOT NULL DEFAULT 'offline',
  current_vehicle_id BIGINT UNSIGNED  NULL,
  last_lat           DECIMAL(10,7)    NULL,
  last_lng           DECIMAL(10,7)    NULL,
  last_seen_at       DATETIME(3)      NULL,
  -- Generated: driver_id while on_trip, else NULL (UNIQUE ⇒ one active trip)
  on_trip_key        BIGINT UNSIGNED
    GENERATED ALWAYS AS (IF(state = 'on_trip', driver_id, NULL)) STORED,
  updated_at         DATETIME(3)      NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (driver_id),
  UNIQUE KEY uq_driver_status_on_trip (on_trip_key),
  CONSTRAINT chk_driver_status_state CHECK (state IN ('offline', 'online', 'on_trip')),
  CONSTRAINT fk_driver_status_driver  FOREIGN KEY (driver_id)          REFERENCES drivers  (id) ON DELETE RESTRICT,
  CONSTRAINT fk_driver_status_vehicle FOREIGN KEY (current_vehicle_id) REFERENCES vehicles (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE INDEX idx_driver_status_state ON driver_status (state);
